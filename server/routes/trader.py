import json
import re
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from server.database import get_db
from server.models.card import Card
from server.models.trader_snapshot import TraderAnalysisSnapshot
from server.services.trader_agent import (
    get_trader_analysis, get_card_trader_analysis, get_multi_persona_analysis,
    run_agent_analysis,
)
from server.services.trading_economics import calc_breakeven_appreciation, calc_roundtrip_pnl
from server.services.backtesting import run_backtest
from server.models.agent_prediction import AgentPrediction
from server.services.prediction_tracker import get_accuracy_report

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/trader", tags=["trader"])


def _parse_signal(strategy_text: str) -> str:
    """Map AI strategy text to a signal value for the frontend."""
    s = strategy_text.upper()
    if "BUY NOW" in s:
        return "buy"
    if "ACCUMULATE" in s and "PULLBACK" not in s:
        return "accumulate"
    if "ACCUMULATE" in s and "PULLBACK" in s:
        return "watch"
    if "WATCH" in s:
        return "watch"
    return "hold"


def _parse_tier(tier_text: str) -> str | None:
    """Map AI tier text to a price_tier value for the frontend."""
    t = tier_text.strip().lower()
    if "premium" in t:
        return "premium"
    if "mid-high" in t or "mid high" in t:
        return "mid_high"
    if "mid" in t:
        return "mid"
    return None


def _extract_picks_from_consensus(db: Session, consensus_text: str) -> list[dict]:
    """Extract recommended card picks from consensus text.

    Parses numbered recommendation BLOCKS (card info + Strategy line)
    and matches each to exactly one card in our database.
    Preserves the AI's tier assignment and strategy signal from the text.
    Only searches PORTFOLIO RECOMMENDATIONS, not watchlist/discussion sections.
    """
    if not consensus_text:
        return []

    # Trim to just the recommendation sections (exclude watchlist & later)
    rec_text = consensus_text
    lower_full = consensus_text.lower()

    rec_start = lower_full.find("portfolio recommendations")
    if rec_start == -1:
        rec_start = lower_full.find("core holdings")
    if rec_start > 0:
        rec_text = consensus_text[rec_start:]

    # Cut off at watchlist or later sections
    lower_rec = rec_text.lower()
    cutoff = len(rec_text)
    for marker in ["watchlist", "where the desk agrees", "key risks", "the honest answer"]:
        pos = lower_rec.find(marker)
        if 0 < pos < cutoff:
            cutoff = pos
    rec_text = rec_text[:cutoff]

    # Extract numbered recommendation BLOCKS (not just first lines)
    # Split on newlines before numbered items: "N. ..." or "**N) ..." or "N) ..."
    parts = re.split(r'\n(?=\s*\*{0,2}\d+[.)]\s)', rec_text)
    rec_blocks = []
    for part in parts:
        part = part.strip()
        m = re.match(r'\*{0,2}(\d+)[.)]\s*(.*?)(?:\n|$)', part)
        if not m:
            continue
        first_line = m.group(2).strip().strip('*').strip()
        rest = part[m.end():]

        # Parse tier from line (last segment after "—")
        tier = None
        segs = first_line.split('—')
        if len(segs) >= 2:
            tier = _parse_tier(segs[-1])

        # Parse strategy/signal from block
        signal = "hold"
        strat_m = re.search(
            r'Strategy:[*\s]*(.+?)(?:\s*\*{0,2}\s*$|\n)',
            rest, re.IGNORECASE | re.MULTILINE,
        )
        if strat_m:
            signal = _parse_signal(strat_m.group(1).strip())

        rec_blocks.append({
            "line": first_line,
            "tier": tier,
            "signal": signal,
        })

    if not rec_blocks:
        logger.warning("No numbered recommendation blocks found in consensus text")
        return []

    # Get ALL priced cards — not just tracked ones, since new sets
    # (e.g. Destined Rivals) may have priced cards not yet flagged as tracked
    all_priced_cards = db.query(Card).filter(Card.current_price > 0).all()

    # Build card lookup: sort by name length descending for longest-match-first
    card_entries = []
    for c in all_priced_cards:
        if not c.name:
            continue
        price = c.current_price
        be_pct = calc_breakeven_appreciation(price) if price > 0 else None

        card_entries.append({
            "card_id": c.id,
            "name": c.name,
            "set_name": c.set_name,
            "rarity": c.rarity,
            "image_small": c.image_small,
            "current_price": price,
            "price_tier": "mid",   # default — overridden from consensus
            "signal": "hold",      # default — overridden from consensus
            "breakeven_pct": round(be_pct, 1) if be_pct else None,
            "liquidity_score": None,
            "price_change_7d": None,
            "price_change_30d": None,
        })

    card_entries.sort(key=lambda c: len(c["name"]), reverse=True)

    # For each numbered block, find the best matching card
    picks = []
    seen_ids = set()

    # Max allowed price deviation (75%) — reject obvious mismatches
    MAX_PRICE_DIST = 0.75

    def _normalize(text: str) -> str:
        """Normalize unicode quotes/dashes so AI text matches DB names."""
        return (text
                .replace('\u2019', "'")   # curly right quote → straight
                .replace('\u2018', "'")   # curly left quote → straight
                .replace('\u201c', '"')   # curly double quotes
                .replace('\u201d', '"')
                .replace('\u2014', '-')   # em-dash → hyphen
                .replace('\u2013', '-'))  # en-dash → hyphen

    for block in rec_blocks:
        line = block["line"]
        line_lower = _normalize(line.lower().strip())

        # Parse the dollar price from the line (e.g. "$226.11", "$1,090")
        price_match = re.search(r'\$[\d,]+\.?\d*', line)
        line_price = None
        if price_match:
            try:
                line_price = float(price_match.group().replace('$', '').replace(',', ''))
            except ValueError:
                pass

        # Extract the card name segment (before first "—" or "-") for match quality scoring
        name_segment = line_lower.split('—')[0].strip() if '—' in line_lower else line_lower
        if '—' not in line_lower and '-' in line_lower:
            name_segment = line_lower.split('-')[0].strip()

        # Collect all candidate matches for this line
        candidates = []

        for cdata in card_entries:
            cid = cdata["card_id"]
            if cid in seen_ids:
                continue
            name_lower = _normalize(cdata["name"].lower())

            # Card name must appear in this specific recommendation line
            if name_lower not in line_lower:
                continue

            # Check if set name also appears in the line
            set_lower = _normalize((cdata["set_name"] or "").lower())
            set_match = set_lower and set_lower in line_lower

            # Compute price proximity score (lower = closer match)
            price_dist = float('inf')
            if line_price and cdata["current_price"]:
                price_dist = abs(cdata["current_price"] - line_price) / max(line_price, 1)

            # Reject candidates with extreme price mismatch
            if line_price and price_dist > MAX_PRICE_DIST:
                continue

            # Name coverage: fraction of name_segment covered by card name
            # Longer names = better match (e.g. "Cynthia's Garchomp ex" > "Garchomp ex")
            name_coverage = len(name_lower) / max(len(name_segment), 1)

            candidates.append((cdata, set_match, price_dist, name_coverage))

        if not candidates:
            logger.debug(f"No matching card for recommendation: {line[:80]}")
            continue

        # Sort: set_match (True first), then name_coverage (higher first), then price proximity
        candidates.sort(key=lambda x: (not x[1], -x[3], x[2]))
        best = candidates[0]

        # Copy card data and override tier + signal from consensus text
        pick = dict(best[0])
        if block["tier"]:
            pick["price_tier"] = block["tier"]
        pick["signal"] = block["signal"]

        seen_ids.add(pick["card_id"])
        picks.append(pick)

    logger.info(f"Re-extracted {len(picks)} consensus picks from {len(rec_blocks)} recommendation blocks")
    return picks


@router.get("/analysis")
async def trader_market_analysis(db: Session = Depends(get_db)):
    """Get the AI trader's full market analysis (legacy single persona)."""
    return await get_trader_analysis(db)


@router.get("/personas")
async def trader_personas_analysis(db: Session = Depends(get_db)):
    """Get multi-persona AI trading desk analysis (3 traders + consensus)."""
    result = await get_multi_persona_analysis(db)

    # Auto-save successful results
    if not result.get("error"):
        try:
            snapshot = TraderAnalysisSnapshot(
                personas_json=json.dumps(result.get("personas", {})),
                consensus=result.get("consensus"),
                consensus_picks_json=json.dumps(result.get("consensus_picks", [])),
                market_data_summary_json=json.dumps(result.get("market_data_summary", {})),
                trading_economics_json=json.dumps(result.get("trading_economics", {})),
                tokens_input=result.get("tokens_used", {}).get("input", 0),
                tokens_output=result.get("tokens_used", {}).get("output", 0),
            )
            db.add(snapshot)
            db.commit()
            logger.info(f"Saved trader analysis snapshot #{snapshot.id}")

            # Create AgentPrediction rows for consensus picks
            _create_predictions_from_picks(db, snapshot)
        except Exception as e:
            logger.error(f"Failed to save trader snapshot: {e}")
            db.rollback()

    return result


@router.get("/personas/history")
async def trader_personas_history(db: Session = Depends(get_db)):
    """List all saved analyses (lightweight summaries)."""
    snapshots = (
        db.query(TraderAnalysisSnapshot)
        .order_by(TraderAnalysisSnapshot.created_at.desc())
        .all()
    )
    result = []
    for s in snapshots:
        pick_count = 0
        if s.consensus_picks_json:
            try:
                pick_count = len(json.loads(s.consensus_picks_json))
            except Exception:
                pass
        result.append({
            "id": s.id,
            "created_at": s.created_at.isoformat() + "Z",
            "tokens_input": s.tokens_input or 0,
            "tokens_output": s.tokens_output or 0,
            "pick_count": pick_count,
        })
    return result


def _snapshot_to_response(snapshot: TraderAnalysisSnapshot, db: Session) -> dict:
    """Convert a snapshot ORM object to the standard API response shape.

    Re-extracts consensus picks from the consensus text at load time
    using name matching against current card data (fixes stale/wrong picks).
    """
    # Always re-extract picks from consensus text for accuracy
    picks = _extract_picks_from_consensus(db, snapshot.consensus or "")

    return {
        "personas": json.loads(snapshot.personas_json) if snapshot.personas_json else {},
        "consensus": snapshot.consensus,
        "consensus_picks": picks,
        "market_data_summary": json.loads(snapshot.market_data_summary_json) if snapshot.market_data_summary_json else None,
        "trading_economics": json.loads(snapshot.trading_economics_json) if snapshot.trading_economics_json else None,
        "tokens_used": {"input": snapshot.tokens_input or 0, "output": snapshot.tokens_output or 0},
        "created_at": snapshot.created_at.isoformat() + "Z",
    }


@router.get("/personas/latest")
async def trader_personas_latest(db: Session = Depends(get_db)):
    """Get the most recently saved multi-persona analysis (instant, no AI call)."""
    snapshot = (
        db.query(TraderAnalysisSnapshot)
        .order_by(TraderAnalysisSnapshot.created_at.desc())
        .first()
    )
    if not snapshot:
        return {"error": "No saved analysis found. Run the trading desk first."}
    return _snapshot_to_response(snapshot, db)


@router.get("/personas/snapshot/{snapshot_id}")
async def trader_personas_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    """Load a specific saved analysis by ID."""
    snapshot = db.query(TraderAnalysisSnapshot).filter_by(id=snapshot_id).first()
    if not snapshot:
        return {"error": f"Snapshot #{snapshot_id} not found."}
    return _snapshot_to_response(snapshot, db)


@router.get("/backtest-picks")
async def backtest_consensus_picks(db: Session = Depends(get_db)):
    """Run fee-aware buy & hold backtests on the latest consensus picks.

    For each pick, calculates: if you bought at the earliest price and sold
    at the latest price, what's the net return after TCGPlayer fees?
    This matches the AI's BUY/HOLD recommendations (not active trading).
    """
    from server.models.price_history import PriceHistory
    from sqlalchemy import asc

    snapshot = (
        db.query(TraderAnalysisSnapshot)
        .order_by(TraderAnalysisSnapshot.created_at.desc())
        .first()
    )
    if not snapshot:
        return {"error": "No saved analysis found. Run the trading desk first."}

    picks = _extract_picks_from_consensus(db, snapshot.consensus or "")
    if not picks:
        return {"error": "No picks found in consensus text."}

    results = {}
    for pick in picks[:18]:
        card_id = pick["card_id"]
        try:
            # Get price history for B&H calculation
            records = (
                db.query(PriceHistory)
                .filter(PriceHistory.card_id == card_id, PriceHistory.market_price.isnot(None))
                .order_by(asc(PriceHistory.date))
                .all()
            )
            if len(records) < 35:
                results[card_id] = {"error": "Insufficient price history (need 35+ days)"}
                continue

            initial_price = records[0].market_price
            final_price = records[-1].market_price
            start_date = str(records[0].date)
            end_date = str(records[-1].date)

            # Raw buy & hold return (no fees)
            bh_return_pct = ((final_price - initial_price) / initial_price) * 100

            # Fee-aware buy & hold: one roundtrip (buy once, sell once)
            roundtrip = calc_roundtrip_pnl(initial_price, final_price, platform="tcgplayer")
            net_return_pct = roundtrip["net_return_pct"]

            # Max drawdown from peak
            peak = initial_price
            max_dd = 0.0
            for r in records:
                if r.market_price > peak:
                    peak = r.market_price
                dd = (peak - r.market_price) / peak * 100
                if dd > max_dd:
                    max_dd = dd

            results[card_id] = {
                "strategy": "buy_and_hold",
                "buy_hold_return_pct": round(bh_return_pct, 2),
                "fee_adjusted_return_pct": round(net_return_pct, 2),
                "total_fees": round(roundtrip["total_fees"], 2),
                "max_drawdown_pct": round(max_dd, 2),
                "profitable_after_fees": net_return_pct > 0,
                "initial_price": round(initial_price, 2),
                "final_price": round(final_price, 2),
                "start_date": start_date,
                "end_date": end_date,
                "hold_days": len(records),
            }
        except Exception as e:
            logger.error(f"Backtest failed for card {card_id}: {e}")
            results[card_id] = {"error": str(e)}

    logger.info(f"Backtested {len(results)} consensus picks (buy & hold)")
    return results


@router.get("/agent")
async def trader_agent_analysis(
    model: str = "gpt-5",
    db: Session = Depends(get_db),
):
    """Run the autonomous tool-using agent. Uses function calling to investigate
    the market and produce investment recommendations.

    model: 'gpt-5' (daily deep analysis) or 'gpt-5-mini' (quick scans)
    """
    return await run_agent_analysis(db, model=model)


@router.get("/card/{card_id}")
async def trader_card_analysis(card_id: int, db: Session = Depends(get_db)):
    """Get the AI trader's analysis for a specific card."""
    return await get_card_trader_analysis(db, card_id)


# ── Prediction Tracking ─────────────────────────────────────────────────────

def _create_predictions_from_picks(db: Session, snapshot: TraderAnalysisSnapshot):
    """Create AgentPrediction rows from a saved snapshot's consensus picks."""
    picks = _extract_picks_from_consensus(db, snapshot.consensus or "")
    if not picks:
        return

    created = 0
    for pick in picks:
        # Only track actionable signals (buy/accumulate)
        if pick.get("signal") not in ("buy", "accumulate"):
            continue

        card = db.query(Card).filter_by(id=pick["card_id"]).first()
        if not card or not card.current_price:
            continue

        prediction = AgentPrediction(
            card_id=card.id,
            snapshot_id=snapshot.id,
            signal=pick["signal"],
            persona_source="consensus",
            entry_price=card.current_price,
            target_price=None,  # TODO: parse from consensus text
            stop_loss=None,     # TODO: parse from consensus text
        )
        db.add(prediction)
        created += 1

    if created > 0:
        db.commit()
        logger.info(f"Created {created} agent predictions from snapshot #{snapshot.id}")


@router.get("/accuracy")
async def trader_accuracy(db: Session = Depends(get_db)):
    """Get prediction accuracy report across all dimensions."""
    return get_accuracy_report(db)


@router.get("/predictions")
async def trader_predictions(
    outcome: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """List agent predictions, optionally filtered by outcome."""
    query = db.query(AgentPrediction).order_by(AgentPrediction.predicted_at.desc())
    if outcome:
        query = query.filter(AgentPrediction.outcome == outcome)
    predictions = query.limit(limit).all()

    results = []
    for p in predictions:
        card = db.query(Card).filter_by(id=p.card_id).first()
        results.append({
            "id": p.id,
            "card_id": p.card_id,
            "card_name": card.name if card else "Unknown",
            "card_image": card.image_small if card else None,
            "signal": p.signal,
            "persona_source": p.persona_source,
            "entry_price": p.entry_price,
            "current_price": card.current_price if card else None,
            "target_price": p.target_price,
            "stop_loss": p.stop_loss,
            "return_pct_7d": p.return_pct_7d,
            "return_pct_30d": p.return_pct_30d,
            "return_pct_90d": p.return_pct_90d,
            "outcome": p.outcome,
            "predicted_at": p.predicted_at.isoformat() + "Z" if p.predicted_at else None,
        })
    return results
