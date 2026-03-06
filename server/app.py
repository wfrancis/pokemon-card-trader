import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
import os

from server.database import engine, Base, get_db
from server.models import Card, PriceHistory
from server.routes import cards, prices, analysis
from server.routes import backtest
from server.routes import trader
from server.routes import signals
from server.services.card_sync import sync_all_cards
from server.services.price_collector import collect_prices_for_cards
from server.services.seed_data import seed_database
from server.services.tcgdex_sync import sync_tcgdex_cards, import_tcgdex_prices, sync_tcgdex_sets
from server.services.poketrace_sync import sync_poketrace_prices
from server.services.pricecharting_import import import_pricecharting_csv
from server.services.tracking import rebuild_tracked_cards, get_tracked_stats

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FRONTEND_BUILD = os.path.join(os.path.dirname(__file__), "..", "frontend", "build")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Migrations for existing tables (create_all won't add columns to existing tables)
    from sqlalchemy import text
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
    logger.info("Database tables created")
    yield


app = FastAPI(
    title="Pokemon Card Market Tracker",
    description="Wall Street-style trading terminal for Pokemon cards",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — needed for local dev, on Fly everything is same-origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routes (must be registered BEFORE static file mount)
app.include_router(cards.router)
app.include_router(prices.router)
app.include_router(analysis.router)
app.include_router(backtest.router)
app.include_router(trader.router)
app.include_router(signals.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/sync/cards")
async def trigger_card_sync(
    pages: int = 100,
    db: Session = Depends(get_db),
):
    """Sync ALL English cards from Pokemon TCG API (price >= $2)."""
    try:
        stats = await sync_all_cards(db, max_pages=pages)
        return {"status": "complete", **stats}
    except Exception as e:
        logger.error(f"Card sync failed: {e}")
        return {"status": "error", "message": str(e)}


@app.post("/api/sync/prices")
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
        return {"status": "error", "message": str(e)}


@app.post("/api/seed")
def seed_data(
    days: int = 90,
    db: Session = Depends(get_db),
):
    """Seed database with sample cards and simulated price history."""
    stats = seed_database(db, days=days)
    return {"status": "complete", **stats}


@app.post("/api/sync/tcgdex/cards")
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
        return {"status": "error", "message": str(e)}


@app.post("/api/sync/tcgdex/prices")
async def trigger_tcgdex_price_import(
    db: Session = Depends(get_db),
):
    """Import historical prices from TCGdex price-history GitHub repo."""
    try:
        stats = await import_tcgdex_prices(db)
        return {"status": "complete", "source": "tcgdex", **stats}
    except Exception as e:
        logger.error(f"TCGdex price import failed: {e}")
        return {"status": "error", "message": str(e)}


@app.post("/api/sync/poketrace")
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
        return {"status": "error", "message": str(e)}


@app.post("/api/sync/tcgplayer")
async def trigger_tcgplayer_sync(
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """Sync current prices from TCGPlayer marketplace API (no API key needed)."""
    from server.services.tcgplayer_sync import sync_tcgplayer_prices
    try:
        stats = await sync_tcgplayer_prices(db, limit=limit)
        return {"status": "complete", "source": "tcgplayer", **stats}
    except Exception as e:
        logger.error(f"TCGPlayer sync failed: {e}")
        return {"status": "error", "message": str(e)}


@app.post("/api/import/pricecharting")
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
        return {"status": "error", "message": str(e)}


import threading

_rebuild_status = {"running": False, "step": "", "stats": None, "error": None}


@app.post("/api/rebuild")
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


@app.get("/api/tracked/stats")
def tracked_stats(db: Session = Depends(get_db)):
    return get_tracked_stats(db)


# Serve React frontend — must be AFTER all API routes
if os.path.isdir(FRONTEND_BUILD):
    app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND_BUILD, "static")), name="static")

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        """Serve React app for all non-API routes (SPA catch-all)."""
        file_path = os.path.join(FRONTEND_BUILD, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_BUILD, "index.html"))
