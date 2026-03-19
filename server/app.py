import logging
import asyncio
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
import os

from server.database import engine, Base, get_db
from server.models import Card, PriceHistory, Sale
from server.routes import cards, prices, analysis
from server.routes import trader
from server.routes import sales
from server.routes import agent
from server.routes import screener
from server.routes import alerts
from server.routes import sets
from server.routes import chart_image
from server.services.card_sync import sync_all_cards
from server.services.price_collector import collect_prices_for_cards
from server.services.tcgdex_sync import sync_tcgdex_cards, import_tcgdex_prices, sync_tcgdex_sets
from server.services.poketrace_sync import sync_poketrace_prices
from server.services.pricecharting_import import import_pricecharting_csv
from server.services.tracking import rebuild_tracked_cards, get_tracked_stats, enforce_data_quality, refresh_current_prices, backfill_prices_from_sales as _backfill_prices_from_sales

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FRONTEND_BUILD = os.path.join(os.path.dirname(__file__), "..", "frontend", "build")

ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY")


async def verify_admin_key(x_admin_key: str | None = Header(None)):
    """Check X-Admin-Key header for admin endpoints. Skips check if ADMIN_API_KEY is not set."""
    if ADMIN_API_KEY and x_admin_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing X-Admin-Key header")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Enable WAL mode for better concurrent read/write (agent writes during sync)
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            conn.execute(text("PRAGMA journal_mode=WAL"))
            conn.commit()
        except Exception:
            pass
    # Migrations for existing tables (create_all won't add columns to existing tables)
    with engine.connect() as conn:
        try:
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_price_history_card_date "
                "ON price_history (card_id, date)"
            ))
            conn.commit()
        except Exception:
            pass
        # Add is_tracked column if missing
        try:
            conn.execute(text("ALTER TABLE cards ADD COLUMN is_tracked BOOLEAN DEFAULT 0 NOT NULL"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cards_is_tracked ON cards (is_tracked)"))
            conn.commit()
        except Exception:
            pass
        # Add tcgplayer_product_id column if missing
        try:
            conn.execute(text("ALTER TABLE cards ADD COLUMN tcgplayer_product_id INTEGER"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cards_tcgplayer_product_id ON cards (tcgplayer_product_id)"))
            conn.commit()
        except Exception:
            pass
        # Add artist column if missing
        try:
            conn.execute(text("ALTER TABLE cards ADD COLUMN artist TEXT"))
            conn.commit()
        except Exception:
            pass
        # Add is_viable column if missing (sticky: once True, never reset)
        try:
            conn.execute(text("ALTER TABLE cards ADD COLUMN is_viable BOOLEAN DEFAULT 0 NOT NULL"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cards_is_viable ON cards (is_viable)"))
            conn.commit()
        except Exception:
            pass
        # Add condition column to price_history (default Near Mint for existing data)
        try:
            conn.execute(text("ALTER TABLE price_history ADD COLUMN condition TEXT DEFAULT 'Near Mint'"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_price_history_card_date_variant_condition "
                "ON price_history (card_id, date, variant, condition)"
            ))
            conn.commit()
        except Exception:
            pass
        # Add price_condition column to cards
        try:
            conn.execute(text("ALTER TABLE cards ADD COLUMN price_condition TEXT DEFAULT 'Near Mint'"))
            conn.commit()
        except Exception:
            pass
        # Add investment screener columns to cards
        for col_name, col_type, col_default in [
            ("liquidity_score", "INTEGER", None),
            ("appreciation_slope", "REAL", None),
            ("appreciation_consistency", "REAL", None),
            ("appreciation_win_rate", "REAL", None),
            ("appreciation_score", "REAL", None),
            ("cached_regime", "TEXT", None),
            ("cached_adx", "REAL", None),
            ("liquidity_updated_at", "TIMESTAMP", None),
        ]:
            try:
                default_clause = f" DEFAULT {col_default}" if col_default is not None else ""
                conn.execute(text(f"ALTER TABLE cards ADD COLUMN {col_name} {col_type}{default_clause}"))
                conn.commit()
            except Exception:
                pass
        # Create liquidity_history table if not exists
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS liquidity_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    card_id INTEGER NOT NULL REFERENCES cards(id),
                    date DATE NOT NULL,
                    liquidity_score INTEGER NOT NULL,
                    sales_30d INTEGER DEFAULT 0,
                    sales_90d INTEGER DEFAULT 0,
                    spread_pct REAL
                )
            """))
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_liquidity_history_card_date "
                "ON liquidity_history (card_id, date)"
            ))
            conn.commit()
        except Exception:
            pass
        # Add spread_threshold column to price_alerts if missing
        try:
            conn.execute(text("ALTER TABLE price_alerts ADD COLUMN spread_threshold REAL"))
            conn.commit()
        except Exception:
            pass
        # One-time cleanup: clear false anomaly insights from variant mixing
        try:
            conn.execute(text(
                "DELETE FROM agent_insights WHERE type = 'anomaly' AND created_at < '2026-03-13'"
            ))
            conn.commit()
        except Exception:
            pass
    logger.info("Database tables created")

    # Background price sync: runs TCGPlayer sync every 6 hours
    sync_task = asyncio.create_task(_background_price_sync())
    # Warm up cache for expensive endpoints
    warmup_task = asyncio.create_task(_warmup_cache())
    yield
    sync_task.cancel()
    warmup_task.cancel()


async def _warmup_cache():
    """Pre-compute and cache expensive endpoint responses on startup."""
    await asyncio.sleep(5)  # Let app fully initialize
    from server.database import SessionLocal
    from server.services.cache import set as cache_set
    try:
        db = SessionLocal()
        try:
            # Warm market index
            result = db.query(
                func.avg(Card.current_price).label("avg_price"),
                func.count(Card.id).label("total_cards"),
                func.sum(Card.current_price).label("total_market_cap"),
            ).filter(Card.current_price.isnot(None), Card.current_price > 0, Card.is_tracked == True).first()
            from server.models.price_history import PriceHistory
            last_sync = db.query(func.max(PriceHistory.date)).scalar()
            cache_set("market-index", {
                "avg_price": round(result.avg_price, 2) if result.avg_price else 0,
                "total_cards": result.total_cards or 0,
                "total_market_cap": round(result.total_market_cap, 2) if result.total_market_cap else 0,
                "last_sync_at": last_sync,
            }, ttl=300)
            logger.info("Cache warmup: market-index done")

            # Warm weekly recap
            from server.services.market_analysis import get_top_movers, get_hot_cards
            from datetime import datetime, timedelta, timezone
            today = datetime.now(timezone.utc).date()
            week_ago = today - timedelta(days=7)
            movers = get_top_movers(db, limit=5, days=7)
            hottest = get_hot_cards(db, limit=5)
            avg_price = round(result.avg_price, 2) if result.avg_price else 0
            avg_price_7d_ago = db.query(
                func.avg(PriceHistory.market_price)
            ).filter(
                PriceHistory.date == week_ago,
                PriceHistory.market_price.isnot(None),
                PriceHistory.market_price > 0,
            ).scalar()
            change_pct = None
            if avg_price_7d_ago and avg_price_7d_ago > 0:
                change_pct = round((avg_price - avg_price_7d_ago) / avg_price_7d_ago * 100, 2)
            cache_set("weekly-recap", {
                "period": {"start": str(week_ago), "end": str(today)},
                "market_index": {
                    "avg_price": avg_price,
                    "total_cards": result.total_cards or 0,
                    "total_market_cap": round(result.total_market_cap, 2) if result.total_market_cap else 0,
                    "change_pct": change_pct,
                },
                "gainers": movers.get("gainers", []),
                "losers": movers.get("losers", []),
                "hottest": hottest,
            }, ttl=600)
            logger.info("Cache warmup: weekly-recap done")

            # Warm top movers
            movers_10 = get_top_movers(db, limit=10, days=7)
            cache_set("movers:10:7", movers_10, ttl=300)
            logger.info("Cache warmup: movers done")

            # Warm hot cards
            hot_12 = get_hot_cards(db, limit=12)
            cache_set("hot:12", hot_12, ttl=300)
            logger.info("Cache warmup: hot cards done")

            # Warm default screener query
            from server.services.investment_screener import get_investment_candidates
            screener_result = get_investment_candidates(
                db, min_liquidity=0, min_appreciation_score=0,
                regime=None, min_price=10.0, max_price=None,
                min_velocity=0, min_profit=None,
                sort_by="investment_score", sort_dir="desc",
                page=1, page_size=50, q=None,
            )
            cache_set("screener:None:0:0:None:10.0:None:0:None:investment_score:desc:1:50", screener_result, ttl=300)
            logger.info("Cache warmup: default screener done")

            # Warm flip finder query
            flip_result = get_investment_candidates(
                db, min_liquidity=0, min_appreciation_score=0,
                regime=None, min_price=2.0, max_price=None,
                min_velocity=0.5, min_profit=0.01,
                sort_by="est_profit", sort_dir="desc",
                page=1, page_size=50, q=None,
            )
            cache_set("screener:None:0:0:None:2.0:None:0.5:0.01:est_profit:desc:1:50", flip_result, ttl=300)
            logger.info("Cache warmup: flip finder done")

        finally:
            db.close()
    except Exception as e:
        logger.error(f"Cache warmup failed: {e}")


async def _background_price_sync():
    """Background task: sync prices every 6 hours.

    Uses TCGCSV (bulk, fast) as primary source.
    Falls back to TCGPlayer per-card sync if TCGCSV fails.
    Always collects individual sales regardless.
    """
    SYNC_INTERVAL = 48 * 60 * 60  # 48 hours
    DISCOVERY_INTERVAL = 48 * 60 * 60  # 48 hours
    _last_discovery = 0.0
    # Wait 60s after startup before first sync (let app fully initialize)
    await asyncio.sleep(60)
    while True:
        from server.database import SessionLocal
        import time as _time

        # 0.5. Daily card discovery from TCGCSV (find new $10+ cards)
        if _time.time() - _last_discovery > DISCOVERY_INTERVAL:
            try:
                from server.services.tcgcsv_sync import discover_tcgcsv_cards
                db = SessionLocal()
                try:
                    logger.info("Background discovery: scanning TCGCSV for $10+ cards...")
                    dstats = await discover_tcgcsv_cards(db)
                    logger.info(f"Background discovery complete: {dstats}")
                    _last_discovery = _time.time()
                    # Create insight if notable new cards discovered (dedup: 1 per day)
                    if dstats.get("cards_created", 0) > 0:
                        from server.models.agent_insight import AgentInsight
                        from datetime import datetime, timedelta, timezone
                        recent = db.query(AgentInsight).filter(
                            AgentInsight.type == "milestone",
                            AgentInsight.title.like("Discovered%new $10+%"),
                            AgentInsight.created_at >= datetime.now(timezone.utc) - timedelta(hours=24),
                        ).first()
                        if not recent:
                            insight = AgentInsight(
                                type="milestone",
                                severity="notable",
                                title=f"Discovered {dstats['cards_created']} new $10+ cards",
                                message=f"TCGCSV scan found {dstats['cards_created']} new cards and updated {dstats.get('cards_updated', 0)} existing cards above $10 threshold.",
                            )
                            db.add(insight)
                            db.commit()
                finally:
                    db.close()
            except Exception as e:
                logger.error(f"Background discovery failed: {e}")

        # 1. Try TCGCSV bulk price sync (fast: ~30s for all cards)
        tcgcsv_success = False
        try:
            from server.services.tcgcsv_sync import sync_tcgcsv_prices
            db = SessionLocal()
            try:
                logger.info("Background sync: starting TCGCSV bulk price update...")
                stats = await sync_tcgcsv_prices(db)
                logger.info(f"TCGCSV background sync complete: {stats}")
                tcgcsv_success = stats.get("prices_updated", 0) > 0
            finally:
                db.close()
        except Exception as e:
            logger.error(f"TCGCSV background sync failed: {e}")
        # 2. Fallback: TCGPlayer per-card sync if TCGCSV didn't update anything
        if not tcgcsv_success:
            try:
                from server.services.tcgplayer_sync import sync_tcgplayer_prices
                db = SessionLocal()
                try:
                    logger.info("Background sync: falling back to TCGPlayer per-card...")
                    stats = await sync_tcgplayer_prices(db)
                    logger.info(f"TCGPlayer fallback sync complete: {stats}")
                finally:
                    db.close()
            except Exception as e:
                logger.error(f"TCGPlayer fallback sync failed: {e}")
        # 3. Sales history maintenance (daily aggregates for viable cards)
        try:
            from server.services.tcgplayer_history import sync_sales_history
            db = SessionLocal()
            try:
                logger.info("Background sync: updating sales history for viable cards...")
                stats = await sync_sales_history(db, limit=200)
                logger.info(f"Background sales history sync: {stats}")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Background sales history sync failed: {e}")
        # 4. Collect individual sales (always, regardless of price source)
        try:
            from server.services.sales_collector import collect_sales
            db = SessionLocal()
            try:
                logger.info("Background sync: collecting latest sales...")
                stats = await collect_sales(db)
                logger.info(f"Background sales collection complete: {stats}")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Background sales collection failed: {e}")
        # 5. Backfill price_history from sales data
        try:
            from server.services.tracking import backfill_prices_from_sales as _backfill_from_sales
            db = SessionLocal()
            try:
                stats = _backfill_from_sales(db)
                if stats["records_inserted"] > 0:
                    logger.info(f"Background sales→price backfill: {stats}")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Background sales→price backfill failed: {e}")
        # 5.5. Reconcile current_price with latest price_history
        try:
            db = SessionLocal()
            try:
                count = refresh_current_prices(db)
                if count > 0:
                    logger.info(f"Background price reconciliation: {count} cards updated")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Background price reconciliation failed: {e}")
        # 5.7. Batch compute investment metrics (liquidity + appreciation)
        try:
            from server.services.investment_screener import batch_compute_investment_metrics
            db = SessionLocal()
            try:
                logger.info("Background sync: computing investment metrics...")
                inv_stats = batch_compute_investment_metrics(db)
                logger.info(f"Investment metrics complete: {inv_stats}")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Investment metrics computation failed: {e}")
        # 5.8. Check and fire email alerts for price thresholds
        try:
            from server.services.alert_checker import check_and_fire_alerts
            db = SessionLocal()
            try:
                alert_stats = check_and_fire_alerts(db)
                if alert_stats.get("fired", 0) > 0:
                    logger.info(f"Price alerts fired: {alert_stats}")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Alert check failed: {e}")
        # 6. Backfill prediction prices (update agent accuracy tracking)
        try:
            from server.services.prediction_tracker import backfill_prediction_prices
            db = SessionLocal()
            try:
                stats = backfill_prediction_prices(db)
                if stats["predictions_updated"] > 0:
                    logger.info(f"Prediction backfill: {stats}")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Prediction backfill failed: {e}")
        # 6.5. Auto-populate predictions from signal engine
        try:
            from server.services.market_analysis import get_hot_cards as _get_hot_cards
            from server.models.agent_prediction import AgentPrediction
            from datetime import datetime, timezone
            db = SessionLocal()
            try:
                hot = _get_hot_cards(db, limit=20)
                created = 0
                for card_data in hot:
                    sig = card_data.get("signal", "hold")
                    if sig == "hold":
                        continue
                    # Skip if pending prediction already exists
                    existing = db.query(AgentPrediction).filter_by(
                        card_id=card_data["card_id"],
                        outcome="pending",
                    ).first()
                    if existing:
                        continue
                    pred = AgentPrediction(
                        card_id=card_data["card_id"],
                        signal=sig,
                        persona_source="signal_engine",
                        entry_price=card_data["current_price"],
                        predicted_at=datetime.now(timezone.utc),
                    )
                    db.add(pred)
                    created += 1
                if created > 0:
                    db.commit()
                    logger.info(f"Signal engine auto-predictions: {created} created")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Signal prediction auto-population failed: {e}")
        # 7. Autonomous agent scan
        try:
            await _autonomous_agent_scan()
        except Exception as e:
            logger.error(f"Autonomous agent scan failed: {e}")
        await asyncio.sleep(SYNC_INTERVAL)


async def _autonomous_agent_scan():
    """Autonomous agent scan — runs after each price sync.

    1. Anomaly detection (pure SQL, zero AI cost)
    2. Generate insights for notable changes
    3. Once daily: run full agent analysis (GPT-5)
    4. Other scans: quick anomaly analysis (GPT-5 mini) only if anomalies found
    """
    from server.database import SessionLocal
    from server.models.agent_insight import AgentInsight
    from server.models.agent_prediction import AgentPrediction
    from server.models.trader_snapshot import TraderAnalysisSnapshot
    from server.models.card import Card
    from server.models.price_history import PriceHistory
    from sqlalchemy import text
    from datetime import datetime, timedelta, timezone

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)

        # Check when last full analysis ran
        last_snapshot = (
            db.query(TraderAnalysisSnapshot)
            .order_by(TraderAnalysisSnapshot.created_at.desc())
            .first()
        )
        hours_since_last = 999
        if last_snapshot and last_snapshot.created_at:
            last_time = last_snapshot.created_at
            if last_time.tzinfo is None:
                last_time = last_time.replace(tzinfo=timezone.utc)
            hours_since_last = (now - last_time).total_seconds() / 3600

        # Anomaly detection (pure SQL — zero AI cost)
        anomalies = []

        # Find cards with >25% price change vs 7-day average (same variant + NM condition)
        try:
            seven_days_ago = (now - timedelta(days=7)).date()

            # Detect spikes (15%+ gain) and crashes (25%+ drop) across all tracked $10+ cards
            big_movers = db.execute(text("""
                SELECT c.id, c.name, c.current_price, c.price_variant,
                       AVG(ph_old.market_price) as avg_price,
                       ((c.current_price - AVG(ph_old.market_price)) / AVG(ph_old.market_price) * 100) as change_pct
                FROM cards c
                JOIN price_history ph_old ON ph_old.card_id = c.id
                  AND ph_old.variant = c.price_variant
                  AND (ph_old.condition = 'Near Mint' OR ph_old.condition IS NULL)
                WHERE c.is_tracked = 1
                  AND c.current_price >= 10
                  AND ph_old.market_price > 5
                  AND ph_old.date >= :seven_days_ago
                GROUP BY c.id
                HAVING COUNT(ph_old.id) >= 2
                  AND AVG(ph_old.market_price) > 5
                  AND (
                    (c.current_price - AVG(ph_old.market_price)) / AVG(ph_old.market_price) > 0.15
                    OR (c.current_price - AVG(ph_old.market_price)) / AVG(ph_old.market_price) < -0.25
                  )
                ORDER BY ABS((c.current_price - AVG(ph_old.market_price)) / AVG(ph_old.market_price)) DESC
                LIMIT 20
            """), {"seven_days_ago": seven_days_ago}).fetchall()

            for row in big_movers:
                if row.change_pct > 0:
                    severity = "urgent" if row.change_pct > 30 else "notable"
                    alert_type = "opportunity"
                    direction_label = "Up"
                else:
                    severity = "urgent" if row.change_pct < -40 else "notable"
                    alert_type = "warning"
                    direction_label = "Down"
                # Friendly price formatting (round to nearest dollar for > $10)
                def _fmt(p: float) -> str:
                    return f"${p:.0f}" if p >= 10 else f"${p:.2f}"
                anomalies.append({
                    "card_id": row.id,
                    "title": f"{row.name} {direction_label.lower()} {abs(row.change_pct):.0f}% this week",
                    "message": f"Price {'jumped' if row.change_pct > 0 else 'fell'} {abs(row.change_pct):.0f}% (was ~{_fmt(row.avg_price)}, now ~{_fmt(row.current_price)})",
                    "type": alert_type,
                    "severity": severity,
                })
        except Exception as e:
            logger.warning(f"Anomaly detection query failed: {e}")

        # Check predictions that hit targets or stop-losses
        try:
            active_preds = db.query(AgentPrediction).filter_by(outcome="pending").all()
            for pred in active_preds:
                card = db.query(Card).filter_by(id=pred.card_id).first()
                if not card or not card.current_price:
                    continue

                if pred.target_price and card.current_price >= pred.target_price:
                    anomalies.append({
                        "card_id": card.id,
                        "title": f"{card.name} hit target price ${pred.target_price:.2f}",
                        "message": f"Your BUY prediction on {card.name} hit the target. Entry: ${pred.entry_price:.2f}, Current: ${card.current_price:.2f}, Target: ${pred.target_price:.2f}.",
                        "type": "milestone",
                        "severity": "notable",
                    })
                elif pred.stop_loss and card.current_price <= pred.stop_loss:
                    anomalies.append({
                        "card_id": card.id,
                        "title": f"{card.name} hit stop-loss ${pred.stop_loss:.2f}",
                        "message": f"Your BUY prediction on {card.name} hit the stop-loss. Entry: ${pred.entry_price:.2f}, Current: ${card.current_price:.2f}, Stop: ${pred.stop_loss:.2f}.",
                        "type": "warning",
                        "severity": "urgent",
                    })
        except Exception as e:
            logger.warning(f"Prediction check failed: {e}")

        # Record anomaly insights (with dedup: skip if same card+type exists in last 24h)
        twenty_four_h_ago = now - timedelta(hours=24)
        recorded = 0
        for anomaly in anomalies:
            card_id = anomaly.get("card_id")
            # Check for recent duplicate
            existing = db.query(AgentInsight).filter(
                AgentInsight.card_id == card_id,
                AgentInsight.type == anomaly["type"],
                AgentInsight.created_at >= twenty_four_h_ago,
                AgentInsight.acknowledged == False,
            ).first()
            if existing:
                # Update the existing insight with latest data instead of creating duplicate
                existing.title = anomaly["title"]
                existing.message = anomaly["message"]
                existing.severity = anomaly["severity"]
                continue
            insight = AgentInsight(
                type=anomaly["type"],
                severity=anomaly["severity"],
                card_id=card_id,
                title=anomaly["title"],
                message=anomaly["message"],
            )
            db.add(insight)
            recorded += 1
        if anomalies:
            db.commit()
            logger.info(f"Agent scan: {recorded} new + {len(anomalies) - recorded} updated insights")

        # Daily full analysis (GPT-5) — run if >20 hours since last analysis
        if hours_since_last > 168:  # Weekly (7 days)
            logger.info("Agent scan: running daily full analysis (GPT-5)...")
            try:
                from server.services.trader_agent import run_agent_analysis
                result = await run_agent_analysis(db, model="gpt-5")
                if result.get("error"):
                    logger.error(f"Daily agent analysis failed: {result['error']}")
                else:
                    logger.info(
                        f"Daily agent analysis complete: {result.get('tool_calls', 0)} tool calls, "
                        f"{result.get('predictions_created', 0)} predictions"
                    )
            except Exception as e:
                logger.error(f"Daily agent analysis exception: {e}")

        # Quick anomaly scan (GPT-5 mini) — only if anomalies found and not doing daily
        elif anomalies and hours_since_last <= 20:
            logger.info(f"Agent scan: {len(anomalies)} anomalies found, running quick scan (GPT-5 mini)...")
            try:
                from server.services.trader_agent import run_agent_analysis
                result = await run_agent_analysis(db, model="gpt-5-mini")
                if result.get("error"):
                    logger.error(f"Quick agent scan failed: {result['error']}")
                else:
                    logger.info(
                        f"Quick agent scan complete: {result.get('tool_calls', 0)} tool calls"
                    )
            except Exception as e:
                logger.error(f"Quick agent scan exception: {e}")
        else:
            logger.info("Agent scan: no anomalies, skipping AI analysis (next daily in "
                        f"{max(0, 20 - hours_since_last):.1f}h)")

    finally:
        db.close()


app = FastAPI(
    title="Pokemon Card Market Tracker",
    description="Wall Street-style trading terminal for Pokemon cards",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — same-origin on Fly.io, allow localhost for dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://pokemon-card-trader.fly.dev",
        "http://localhost:3000",
        "http://localhost:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_cache_headers(request, call_next):
    """Add cache headers: long cache for hashed static assets, short for API."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static/"):
        # React build hashes filenames — safe to cache forever
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path.startswith("/api/"):
        # API responses: short cache to reduce repeated calls
        response.headers["Cache-Control"] = "public, max-age=60"
    return response


# API Routes (must be registered BEFORE static file mount)
app.include_router(cards.router)
app.include_router(prices.router)
app.include_router(analysis.router)
app.include_router(trader.router)
app.include_router(sales.router)
app.include_router(agent.router)
app.include_router(screener.router)
app.include_router(alerts.router)
app.include_router(sets.router)
app.include_router(chart_image.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/sync/cards", dependencies=[Depends(verify_admin_key)])
async def trigger_card_sync(
    pages: int = 100,
    db: Session = Depends(get_db),
):
    """Sync ALL English cards from Pokemon TCG API (price >= $2)."""
    try:
        stats = await sync_all_cards(db, max_pages=pages)
        refresh_current_prices(db)
        return {"status": "complete", **stats}
    except Exception as e:
        logger.error(f"Card sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/prices", dependencies=[Depends(verify_admin_key)])
async def trigger_price_sync(
    limit: int = 250,
    db: Session = Depends(get_db),
):
    """Trigger a price update for existing cards."""
    try:
        stats = await collect_prices_for_cards(db, limit=limit)
        return {"status": "complete", **stats}
    except Exception as e:
        logger.error(f"Price sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/tcgdex/cards", dependencies=[Depends(verify_admin_key)])
async def trigger_tcgdex_card_sync(
    max_cards: int = 25000,
    db: Session = Depends(get_db),
):
    """Sync cards from the TCGdex API (free, open source). Gets all 22K+ cards."""
    try:
        stats = await sync_tcgdex_cards(db, max_cards=max_cards)
        return {"status": "complete", "source": "tcgdex", **stats}
    except Exception as e:
        logger.error(f"TCGdex card sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/tcgdex/prices", dependencies=[Depends(verify_admin_key)])
async def trigger_tcgdex_price_import(
    db: Session = Depends(get_db),
):
    """Import historical prices from TCGdex price-history GitHub repo."""
    try:
        stats = await import_tcgdex_prices(db)
        return {"status": "complete", "source": "tcgdex", **stats}
    except Exception as e:
        logger.error(f"TCGdex price import failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/poketrace", dependencies=[Depends(verify_admin_key)])
async def trigger_poketrace_sync(
    tier: str = "tcgplayer",
    db: Session = Depends(get_db),
):
    """Sync price history from PokeTrace API (requires POKETRACE_API_KEY env var)."""
    try:
        stats = await sync_poketrace_prices(db, tier=tier)
        return {"status": "complete", "source": "poketrace", **stats}
    except Exception as e:
        logger.error(f"PokeTrace sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/tcgplayer", dependencies=[Depends(verify_admin_key)])
async def trigger_tcgplayer_sync(
    limit: int = 500,
    db: Session = Depends(get_db),
):
    """Sync current prices from TCGPlayer marketplace API (no API key needed)."""
    from server.services.tcgplayer_sync import sync_tcgplayer_prices
    try:
        stats = await sync_tcgplayer_prices(db, limit=limit)
        return {"status": "complete", "source": "tcgplayer", **stats}
    except Exception as e:
        logger.error(f"TCGPlayer sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/tcgplayer/history", dependencies=[Depends(verify_admin_key)])
async def trigger_tcgplayer_history(
    limit: int = 500,
    db: Session = Depends(get_db),
):
    """Backfill 12 months of weekly price history from TCGPlayer (no API key needed)."""
    from server.services.tcgplayer_sync import backfill_tcgplayer_history
    try:
        stats = await backfill_tcgplayer_history(db, limit=limit)
        return {"status": "complete", "source": "tcgplayer_history", **stats}
    except Exception as e:
        logger.error(f"TCGPlayer history backfill failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/tcgcsv/mapping", dependencies=[Depends(verify_admin_key)])
async def trigger_tcgcsv_mapping(db: Session = Depends(get_db)):
    """Build productId mapping from TCGCSV products to our cards (one-time)."""
    from server.services.tcgcsv_sync import sync_tcgcsv_mapping
    try:
        stats = await sync_tcgcsv_mapping(db)
        return {"status": "complete", "source": "tcgcsv_mapping", **stats}
    except Exception as e:
        logger.error(f"TCGCSV mapping failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/tcgcsv/prices", dependencies=[Depends(verify_admin_key)])
async def trigger_tcgcsv_prices(db: Session = Depends(get_db)):
    """Sync current prices from TCGCSV (daily bulk sync)."""
    from server.services.tcgcsv_sync import sync_tcgcsv_prices
    try:
        stats = await sync_tcgcsv_prices(db)
        return {"status": "complete", "source": "tcgcsv", **stats}
    except Exception as e:
        logger.error(f"TCGCSV price sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/tcgcsv/discover", dependencies=[Depends(verify_admin_key)])
async def trigger_tcgcsv_discovery(
    min_price: float = 10.0,
    db: Session = Depends(get_db),
):
    """Discover and import ALL cards with market price >= $min_price from TCGCSV."""
    from server.services.tcgcsv_sync import discover_tcgcsv_cards
    try:
        stats = await discover_tcgcsv_cards(db, min_price=min_price)
        return {"status": "complete", "source": "tcgcsv_discovery", **stats}
    except Exception as e:
        logger.error(f"TCGCSV discovery failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/investment-metrics", dependencies=[Depends(verify_admin_key)])
async def trigger_investment_metrics(db: Session = Depends(get_db)):
    """Batch compute investment metrics (liquidity + appreciation) for all tracked cards."""
    from server.services.investment_screener import batch_compute_investment_metrics
    try:
        stats = batch_compute_investment_metrics(db)
        return {"status": "complete", **stats}
    except Exception as e:
        logger.error(f"Investment metrics failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/fix/bad-prices", dependencies=[Depends(verify_admin_key)])
async def fix_bad_prices(db: Session = Depends(get_db)):
    """Remove price records that differ >3x from previous entry (likely variant mismatch)."""
    from sqlalchemy import text
    # Delete today's price records that differ >3x from previous price
    result = db.execute(text("""
        DELETE FROM price_history
        WHERE id IN (
            SELECT ph.id FROM price_history ph
            INNER JOIN (
                SELECT card_id, MAX(date) as max_date
                FROM price_history
                WHERE date < date('now')
                GROUP BY card_id
            ) prev ON ph.card_id = prev.card_id
            INNER JOIN price_history prev_ph
                ON prev_ph.card_id = prev.card_id AND prev_ph.date = prev.max_date
            WHERE ph.date = date('now')
                AND prev_ph.market_price > 0
                AND (
                    ph.market_price < prev_ph.market_price * 0.33
                    OR ph.market_price > prev_ph.market_price * 3.0
                )
        )
    """))
    deleted = result.rowcount
    # Also reset current_price for affected cards from their last good price
    if deleted > 0:
        db.execute(text("""
            UPDATE cards SET current_price = (
                SELECT ph.market_price FROM price_history ph
                WHERE ph.card_id = cards.id AND ph.market_price IS NOT NULL
                ORDER BY ph.date DESC LIMIT 1
            )
            WHERE is_tracked = 1
        """))
    db.commit()
    return {"status": "complete", "bad_prices_removed": deleted}


@app.post("/api/import/pricecharting", dependencies=[Depends(verify_admin_key)])
async def trigger_pricecharting_import(
    db: Session = Depends(get_db),
):
    """Import PriceCharting CSV data. Upload CSV to /data/pricecharting.csv first."""
    import os
    data_dir = os.environ.get("DATA_DIR", os.path.dirname(__file__))
    csv_path = os.path.join(data_dir, "pricecharting.csv")
    if not os.path.exists(csv_path):
        return {"status": "error", "message": f"CSV file not found at {csv_path}. Upload pricecharting.csv to the data directory."}
    try:
        stats = import_pricecharting_csv(db, csv_path=csv_path)
        return {"status": "complete", "source": "pricecharting", **stats}
    except Exception as e:
        logger.error(f"PriceCharting import failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


import threading

_rebuild_status = {"running": False, "step": "", "stats": None, "error": None}


@app.post("/api/rebuild", dependencies=[Depends(verify_admin_key)])
async def trigger_rebuild(db: Session = Depends(get_db)):
    """Full rebuild: sync sets → mark tracked → import prices for tracked cards."""
    if _rebuild_status["running"]:
        return {"status": "already_running", "step": _rebuild_status["step"]}

    def _run_rebuild():
        from server.database import SessionLocal
        db_local = SessionLocal()
        try:
            _rebuild_status["running"] = True
            _rebuild_status["error"] = None
            _rebuild_status["stats"] = {}

            import asyncio
            loop = asyncio.new_event_loop()

            # Step 1: Sync set metadata (release dates)
            _rebuild_status["step"] = "syncing_sets"
            logger.info("Rebuild step 1: Syncing set metadata...")
            set_stats = loop.run_until_complete(sync_tcgdex_sets(db_local))
            _rebuild_status["stats"]["sets"] = set_stats

            # Step 2: Mark tracked cards
            _rebuild_status["step"] = "marking_tracked"
            logger.info("Rebuild step 2: Marking tracked cards...")
            track_stats = rebuild_tracked_cards(db_local)
            _rebuild_status["stats"]["tracking"] = track_stats

            # Step 3: Import price history for tracked cards
            _rebuild_status["step"] = "importing_prices"
            logger.info("Rebuild step 3: Importing prices for tracked cards...")
            price_stats = loop.run_until_complete(
                import_tcgdex_prices(db_local, min_price_cents=0, tracked_only=True)
            )
            _rebuild_status["stats"]["prices"] = price_stats

            # Step 4: Refresh current_price from latest history
            _rebuild_status["step"] = "refreshing_prices"
            logger.info("Rebuild step 4: Refreshing current prices...")
            refresh_count = refresh_current_prices(db_local)
            _rebuild_status["stats"]["prices_refreshed"] = refresh_count

            _rebuild_status["step"] = "complete"
            logger.info(f"Rebuild complete: {_rebuild_status['stats']}")
            loop.close()
        except Exception as e:
            logger.error(f"Rebuild failed: {e}")
            _rebuild_status["error"] = str(e)
            _rebuild_status["step"] = "error"
        finally:
            db_local.close()
            _rebuild_status["running"] = False

    thread = threading.Thread(target=_run_rebuild, daemon=True)
    thread.start()
    return {"status": "started", "message": "Rebuild started in background. Poll /api/rebuild/status."}


@app.get("/api/rebuild/status")
def rebuild_status():
    return _rebuild_status


@app.post("/api/tracked/enforce-quality", dependencies=[Depends(verify_admin_key)])
def enforce_quality(db: Session = Depends(get_db)):
    """Remove cards without complete market data from tracked universe."""
    stats = enforce_data_quality(db)
    return {"status": "complete", **stats}


@app.post("/api/tracked/refresh-prices", dependencies=[Depends(verify_admin_key)])
def refresh_prices(db: Session = Depends(get_db)):
    """Update Card.current_price from latest PriceHistory for all tracked cards."""
    count = refresh_current_prices(db)
    return {"status": "complete", "cards_updated": count}


@app.post("/api/sync/stale-cards", dependencies=[Depends(verify_admin_key)])
async def sync_stale_cards(db: Session = Depends(get_db), days: int = 30):
    """Sync prices for cards with stale price history (older than N days).

    Uses TCGPlayer per-card API to find and update prices for cards
    that the bulk TCGCSV sync missed.
    """
    from server.services.tcgplayer_sync import _search_tcgplayer, _get_price
    from server.models.price_history import PriceHistory
    from sqlalchemy import func
    import httpx

    today = date.today()
    cutoff = today - timedelta(days=days)

    # Find cards where latest price history is before cutoff
    subq = (
        db.query(PriceHistory.card_id, func.max(PriceHistory.date).label("latest"))
        .group_by(PriceHistory.card_id)
        .subquery()
    )
    stale_cards = (
        db.query(Card)
        .join(subq, Card.id == subq.c.card_id)
        .filter(subq.c.latest < cutoff, Card.is_tracked == True)
        .all()
    )

    stats = {"stale_found": len(stale_cards), "updated": 0, "no_price": 0, "errors": 0}
    stale_ids = [c.id for c in stale_cards]
    logger.info(f"Stale card sync: found {len(stale_cards)} cards with data older than {days} days")
    logger.info(f"Stale card IDs (first 30): {stale_ids[:30]}")
    # Check specific cards we care about
    for target_id in [283, 287, 545, 402, 53]:
        if target_id in stale_ids:
            logger.info(f"  TARGET card {target_id} IS in stale list")
        else:
            logger.info(f"  TARGET card {target_id} NOT in stale list")

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        for card in stale_cards:
            try:
                # Get product ID (use stored or search)
                product_id = card.tcgplayer_product_id
                if not product_id:
                    product_data = await _search_tcgplayer(
                        client, card.name, card.set_name or "", card.number or ""
                    )
                    if product_data:
                        product_id = product_data.get("productId")
                        if product_id:
                            card.tcgplayer_product_id = int(product_id)

                if not product_id:
                    stats["no_price"] += 1
                    continue

                # Get current price
                price_data = await _get_price(client, product_id)
                if price_data and price_data.get("market_price"):
                    mp = price_data["market_price"]
                    card.current_price = round(mp, 2)
                    card.updated_at = datetime.now(timezone.utc)

                    # Update variant if TCGPlayer reports a different one
                    printing_type = (price_data.get("printing_type") or "").lower()
                    PRINTING_TO_VARIANT = {
                        "normal": "normal", "foil": "holofoil", "holofoil": "holofoil",
                        "1st edition holofoil": "1stEditionHolofoil",
                        "1st edition normal": "1stEditionNormal",
                        "reverse holofoil": "reverseHolofoil",
                    }
                    new_variant = PRINTING_TO_VARIANT.get(printing_type, card.price_variant or "normal")
                    if new_variant != card.price_variant:
                        logger.info(f"Stale sync: updating {card.name} variant {card.price_variant} -> {new_variant}")
                        card.price_variant = new_variant
                    variant = card.price_variant or "normal"
                    existing = db.query(PriceHistory).filter(
                        PriceHistory.card_id == card.id,
                        PriceHistory.date == today,
                    ).first()
                    if not existing:
                        db.add(PriceHistory(
                            card_id=card.id, date=today, variant=variant,
                            condition="Near Mint", market_price=round(mp, 2),
                        ))
                    stats["updated"] += 1
                else:
                    stats["no_price"] += 1
            except Exception as e:
                logger.error(f"Stale sync error for {card.name}: {e}")
                stats["errors"] += 1

            # Rate limit + commit every 10 cards
            if (stats["updated"] + stats["no_price"] + stats["errors"]) % 10 == 0:
                db.commit()
            await asyncio.sleep(1.0)  # Rate limit TCGPlayer API

    db.commit()
    logger.info(f"Stale card sync complete: {stats}")
    return {"status": "complete", **stats}


@app.post("/api/sync/top-cards", dependencies=[Depends(verify_admin_key)])
async def sync_top_cards(db: Session = Depends(get_db), n: int = 100):
    """Force-sync prices and sales for the top N most expensive tracked cards.

    Aggressively fetches data regardless of staleness:
    1. Searches TCGPlayer for each card's product ID
    2. Fetches price points and updates card/history
    3. Fetches latest sales and stores Sale records
    4. Handles variant mismatches (Normal/Foil mapping)
    """
    from server.services.tcgplayer_sync import _search_tcgplayer, _get_price
    from server.services.sales_collector import _fetch_latest_sales
    from server.models.price_history import PriceHistory
    import httpx

    today = date.today()

    PRINTING_TO_VARIANT = {
        "normal": "normal", "foil": "holofoil", "holofoil": "holofoil",
        "1st edition holofoil": "1stEditionHolofoil",
        "1st edition normal": "1stEditionNormal",
        "reverse holofoil": "reverseHolofoil",
    }

    # Get top N most expensive tracked cards
    top_cards = (
        db.query(Card)
        .filter(Card.is_tracked == True)
        .order_by(Card.current_price.desc().nullslast())
        .limit(n)
        .all()
    )

    stats = {
        "total": len(top_cards),
        "prices_updated": 0,
        "sales_added": 0,
        "product_ids_found": 0,
        "no_product": 0,
        "no_price": 0,
        "errors": 0,
    }
    details = []

    logger.info(f"Top-cards sync: processing {len(top_cards)} cards")

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        for idx, card in enumerate(top_cards):
            card_detail = {
                "id": card.id,
                "name": card.name,
                "set": card.set_name,
                "number": card.number,
                "old_price": card.current_price,
                "old_variant": card.price_variant,
                "status": "pending",
            }
            try:
                # Step 1: Get product ID (use stored or search)
                product_id = card.tcgplayer_product_id
                if not product_id:
                    product_data = await _search_tcgplayer(
                        client, card.name, card.set_name or "", card.number or ""
                    )
                    if product_data:
                        product_id = product_data.get("productId")
                        if product_id:
                            product_id = int(product_id)
                            card.tcgplayer_product_id = product_id
                            stats["product_ids_found"] += 1
                            logger.info(f"  [{idx+1}/{len(top_cards)}] {card.name} -> product_id={product_id}")

                if not product_id:
                    stats["no_product"] += 1
                    card_detail["status"] = "no_product"
                    details.append(card_detail)
                    await asyncio.sleep(1.0)
                    continue

                card_detail["product_id"] = product_id

                # Step 2: Fetch price points
                price_data = await _get_price(client, product_id)
                if price_data and price_data.get("market_price"):
                    mp = price_data["market_price"]
                    card.current_price = round(mp, 2)
                    card.updated_at = datetime.now(timezone.utc)

                    # Update variant if TCGPlayer reports a different one
                    printing_type = (price_data.get("printing_type") or "").lower()
                    new_variant = PRINTING_TO_VARIANT.get(printing_type, card.price_variant or "normal")
                    if new_variant != card.price_variant:
                        logger.info(f"  Variant update: {card.name} {card.price_variant} -> {new_variant}")
                        card.price_variant = new_variant

                    variant = card.price_variant or "normal"

                    # Create PriceHistory record for today
                    existing = db.query(PriceHistory).filter(
                        PriceHistory.card_id == card.id,
                        PriceHistory.date == today,
                    ).first()
                    if not existing:
                        db.add(PriceHistory(
                            card_id=card.id, date=today, variant=variant,
                            condition="Near Mint", market_price=round(mp, 2),
                        ))

                    stats["prices_updated"] += 1
                    card_detail["new_price"] = round(mp, 2)
                    card_detail["new_variant"] = variant
                    card_detail["status"] = "price_updated"
                else:
                    stats["no_price"] += 1
                    card_detail["status"] = "no_price"

                # Step 3: Fetch latest sales
                await asyncio.sleep(0.5)
                sales_data = await _fetch_latest_sales(client, product_id)
                new_sales = 0
                if sales_data:
                    for sale in sales_data:
                        order_date_str = sale.get("orderDate", "")
                        listing_id_raw = sale.get("customListingId") or ""
                        price = sale.get("purchasePrice", 0)
                        dedup_key = f"tcg-{product_id}-{order_date_str[:19]}-{price}-{listing_id_raw}"

                        existing_sale = db.query(Sale.id).filter(
                            Sale.listing_id == dedup_key
                        ).first()
                        if existing_sale:
                            continue

                        try:
                            order_dt = datetime.fromisoformat(
                                order_date_str.replace("Z", "+00:00")
                            )
                        except (ValueError, TypeError):
                            continue

                        db.add(Sale(
                            card_id=card.id,
                            source="tcgplayer",
                            source_product_id=str(product_id),
                            order_date=order_dt,
                            purchase_price=price,
                            shipping_price=sale.get("shippingPrice", 0),
                            condition=sale.get("condition", ""),
                            variant=sale.get("variant", ""),
                            language=sale.get("language", "English"),
                            quantity=sale.get("quantity", 1),
                            listing_title=sale.get("title", ""),
                            listing_id=dedup_key,
                        ))
                        new_sales += 1

                    stats["sales_added"] += new_sales
                    card_detail["sales_added"] = new_sales

            except Exception as e:
                logger.error(f"Top-cards sync error for {card.name}: {e}")
                stats["errors"] += 1
                card_detail["status"] = "error"
                card_detail["error"] = str(e)

            details.append(card_detail)

            # Commit every 5 cards
            if (idx + 1) % 5 == 0:
                try:
                    db.commit()
                    logger.info(f"  Progress: {idx+1}/{len(top_cards)} cards processed")
                except Exception as e:
                    logger.error(f"Commit error at card {idx+1}: {e}")
                    db.rollback()

            # Rate limit
            await asyncio.sleep(1.0)

    try:
        db.commit()
    except Exception as e:
        logger.error(f"Final commit error: {e}")
        db.rollback()

    logger.info(f"Top-cards sync complete: {stats}")
    return {"status": "complete", **stats, "details": details}


@app.post("/api/sync/card/{card_id}", dependencies=[Depends(verify_admin_key)])
async def sync_single_card(card_id: int, db: Session = Depends(get_db)):
    """Force-sync a single card by ID. Fetches product ID, price, and sales."""
    from server.services.tcgplayer_sync import _search_tcgplayer, _get_price
    from server.services.sales_collector import _fetch_latest_sales
    from server.models.price_history import PriceHistory
    import httpx

    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail=f"Card {card_id} not found")

    today = date.today()

    PRINTING_TO_VARIANT = {
        "normal": "normal", "foil": "holofoil", "holofoil": "holofoil",
        "1st edition holofoil": "1stEditionHolofoil",
        "1st edition normal": "1stEditionNormal",
        "reverse holofoil": "reverseHolofoil",
    }

    result = {
        "card_id": card.id, "name": card.name, "set": card.set_name,
        "number": card.number, "old_price": card.current_price,
        "old_variant": card.price_variant, "old_product_id": card.tcgplayer_product_id,
    }

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        product_id = card.tcgplayer_product_id
        if not product_id:
            search_result = await _search_tcgplayer(
                client, card.name, card.set_name or "", card.number or ""
            )
            if search_result:
                product_id = search_result.get("productId")
                if product_id:
                    product_id = int(product_id)
                    card.tcgplayer_product_id = product_id
                    result["search_match"] = {
                        "productName": search_result.get("productName"),
                        "setName": search_result.get("setName"),
                        "productId": product_id,
                    }

        result["product_id"] = product_id
        if not product_id:
            result["status"] = "no_product_found"
            return result

        price_data = await _get_price(client, product_id)
        result["price_data"] = price_data

        if price_data and price_data.get("market_price"):
            mp = price_data["market_price"]
            card.current_price = round(mp, 2)
            card.updated_at = datetime.now(timezone.utc)

            printing_type = (price_data.get("printing_type") or "").lower()
            new_variant = PRINTING_TO_VARIANT.get(printing_type, card.price_variant or "normal")
            if new_variant != card.price_variant:
                result["variant_changed"] = {"from": card.price_variant, "to": new_variant}
                card.price_variant = new_variant

            variant = card.price_variant or "normal"
            existing = db.query(PriceHistory).filter(
                PriceHistory.card_id == card.id, PriceHistory.date == today,
            ).first()
            if not existing:
                db.add(PriceHistory(
                    card_id=card.id, date=today, variant=variant,
                    condition="Near Mint", market_price=round(mp, 2),
                ))
                result["price_history_added"] = True

            result["new_price"] = round(mp, 2)
            result["new_variant"] = variant

        await asyncio.sleep(0.5)
        sales_data = await _fetch_latest_sales(client, product_id)
        result["sales_fetched"] = len(sales_data) if sales_data else 0

        new_sales = 0
        if sales_data:
            for sale in sales_data:
                order_date_str = sale.get("orderDate", "")
                listing_id_raw = sale.get("customListingId") or ""
                price = sale.get("purchasePrice", 0)
                dedup_key = f"tcg-{product_id}-{order_date_str[:19]}-{price}-{listing_id_raw}"

                existing_sale = db.query(Sale.id).filter(Sale.listing_id == dedup_key).first()
                if existing_sale:
                    continue

                try:
                    order_dt = datetime.fromisoformat(order_date_str.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    continue

                db.add(Sale(
                    card_id=card.id, source="tcgplayer", source_product_id=str(product_id),
                    order_date=order_dt, purchase_price=price,
                    shipping_price=sale.get("shippingPrice", 0),
                    condition=sale.get("condition", ""), variant=sale.get("variant", ""),
                    language=sale.get("language", "English"), quantity=sale.get("quantity", 1),
                    listing_title=sale.get("title", ""), listing_id=dedup_key,
                ))
                new_sales += 1

        result["sales_added"] = new_sales

    db.commit()
    result["status"] = "complete"
    return result


@app.get("/api/admin/data-audit", dependencies=[Depends(verify_admin_key)])
def data_audit(db: Session = Depends(get_db), limit: int = 100):
    """Run data quality audit on top N most expensive cards."""
    from server.services.data_quality import audit_top_cards
    return audit_top_cards(db, limit=limit)


@app.post("/api/admin/fix-variants", dependencies=[Depends(verify_admin_key)])
async def fix_variants(db: Session = Depends(get_db)):
    """Fix variant mismatches for modern common/uncommon cards."""
    from server.services.data_quality import fix_variant_mismatches
    return await fix_variant_mismatches(db)


@app.get("/api/tracked/stats", dependencies=[Depends(verify_admin_key)])
def tracked_stats(db: Session = Depends(get_db)):
    return get_tracked_stats(db)


@app.post("/api/fix/backfill-artists", dependencies=[Depends(verify_admin_key)])
async def backfill_artists(db: Session = Depends(get_db)):
    """Re-fetch artist data from Pokemon TCG API for cards with null artist."""
    import httpx
    cards = db.query(Card).filter(Card.artist.is_(None), Card.is_tracked == True).all()
    if not cards:
        return {"status": "complete", "updated": 0, "message": "No cards with missing artist"}
    updated = 0
    tcg_ids = [c.tcg_id for c in cards]
    async with httpx.AsyncClient(timeout=120.0, headers={"User-Agent": "PokemonCardTrader/1.0"}) as client:
        for i in range(0, len(tcg_ids), 25):
            batch = tcg_ids[i:i + 25]
            query = " OR ".join([f'id:"{tid}"' for tid in batch])
            try:
                resp = await client.get(f"https://api.pokemontcg.io/v2/cards", params={"q": query, "pageSize": 250})
                resp.raise_for_status()
                api_cards = {c["id"]: c for c in resp.json().get("data", [])}
                for card in cards:
                    if card.tcg_id in api_cards and api_cards[card.tcg_id].get("artist"):
                        card.artist = api_cards[card.tcg_id]["artist"]
                        updated += 1
            except Exception as e:
                logger.warning(f"Failed to fetch artists for batch: {e}")
            import asyncio
            await asyncio.sleep(1)
    db.commit()
    return {"status": "complete", "updated": updated, "total_missing": len(cards)}


@app.post("/api/fix/card-image/{card_id}", dependencies=[Depends(verify_admin_key)])
async def fix_card_image(card_id: int, image_url: str = "", db: Session = Depends(get_db)):
    """Override image_small and image_large for a specific card."""
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if image_url:
        card.image_small = image_url
        card.image_large = image_url
    else:
        # Re-fetch from Pokemon TCG API
        import httpx
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"https://api.pokemontcg.io/v2/cards/{card.tcg_id}")
            resp.raise_for_status()
            data = resp.json().get("data", {})
            card.image_small = data.get("images", {}).get("small", card.image_small)
            card.image_large = data.get("images", {}).get("large", card.image_large)
    db.commit()
    return {"status": "complete", "card_id": card_id, "image_small": card.image_small, "image_large": card.image_large}


@app.post("/api/fix/backfill-from-sales", dependencies=[Depends(verify_admin_key)])
async def backfill_from_sales_endpoint(db: Session = Depends(get_db)):
    """Backfill price_history from sales data for cards with sparse history."""
    try:
        stats = _backfill_prices_from_sales(db)
        return {"status": "complete", **stats}
    except Exception as e:
        logger.error(f"Backfill from sales failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/sales", dependencies=[Depends(verify_admin_key)])
async def trigger_sales_collection(
    limit: int = 500,
    force: bool = False,
    db: Session = Depends(get_db),
):
    """Collect latest completed sales from TCGPlayer for all tracked cards."""
    from server.services.sales_collector import collect_sales
    try:
        stats = await collect_sales(db, limit=limit, force=force)
        return {"status": "complete", "source": "tcgplayer_sales", **stats}
    except Exception as e:
        logger.error(f"Sales collection failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/sales-backfill", dependencies=[Depends(verify_admin_key)])
async def trigger_sales_backfill(
    db: Session = Depends(get_db),
):
    """Aggressively backfill sales for top 100 most expensive cards."""
    from server.services.sales_collector import backfill_sales
    try:
        stats = await backfill_sales(db)
        return {"status": "complete", "source": "sales_backfill", **stats}
    except Exception as e:
        logger.error(f"Sales backfill failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/sales-history", dependencies=[Depends(verify_admin_key)])
async def trigger_sales_history_sync(
    limit: int = 200,
    db: Session = Depends(get_db),
):
    """Backfill daily aggregated sales history for viable ($20+) cards from TCGPlayer."""
    from server.services.tcgplayer_history import sync_sales_history
    try:
        stats = await sync_sales_history(db, limit=limit)
        return {"status": "complete", "source": "tcgplayer_history", **stats}
    except Exception as e:
        logger.error(f"Sales history sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Serve React frontend — must be AFTER all API routes
if os.path.isdir(FRONTEND_BUILD):
    app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND_BUILD, "static")), name="static")

    def _build_og_html(card: Card) -> str | None:
        """Read index.html and inject OG meta tags for a card."""
        index_path = os.path.join(FRONTEND_BUILD, "index.html")
        if not os.path.isfile(index_path):
            return None
        with open(index_path, "r") as f:
            html = f.read()

        price_str = f"${card.current_price:.2f}" if card.current_price else "N/A"
        title = f"{card.name} - {card.set_name} | PKMN Trader"
        description = f"Market Price: {price_str}"
        image = card.image_large or card.image_small or ""
        card_url = f"https://pokemon-card-trader.fly.dev/card/{card.id}"

        # Escape HTML special chars in dynamic values
        import html as html_mod
        title = html_mod.escape(title)
        description = html_mod.escape(description)
        image = html_mod.escape(image)

        og_tags = f"""
    <!-- OG Meta Tags -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content="{title}" />
    <meta property="og:description" content="{description}" />
    <meta property="og:image" content="{image}" />
    <meta property="og:url" content="{card_url}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{title}" />
    <meta name="twitter:description" content="{description}" />
    <meta name="twitter:image" content="{image}" />"""

        # Inject before </head>
        html = html.replace("</head>", og_tags + "\n  </head>", 1)
        return html

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str, db: Session = Depends(get_db)):
        """Serve React app for all non-API routes (SPA catch-all)."""
        # Never serve HTML for API routes — if we got here, the route doesn't exist
        if full_path.startswith("api/") or full_path == "api":
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail=f"API route not found: /{full_path}")

        # Inject OG meta tags for card detail pages
        if full_path.startswith("card/"):
            try:
                card_id_str = full_path.split("/", 1)[1]
                card_id = int(card_id_str)
                card = db.query(Card).filter(Card.id == card_id).first()
                if card:
                    og_html = _build_og_html(card)
                    if og_html:
                        return HTMLResponse(content=og_html)
            except (ValueError, IndexError, Exception):
                pass

        file_path = os.path.join(FRONTEND_BUILD, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_BUILD, "index.html"))
