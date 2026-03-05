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
from server.services.card_sync import sync_all_cards
from server.services.price_collector import collect_prices_for_cards

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FRONTEND_BUILD = os.path.join(os.path.dirname(__file__), "..", "frontend", "build")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
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


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/sync/cards")
async def trigger_card_sync(
    pages: int = 3,
    db: Session = Depends(get_db),
):
    """Trigger a card sync from Pokemon TCG API."""
    stats = await sync_all_cards(db, max_pages=pages)
    return {"status": "complete", **stats}


@app.post("/api/sync/prices")
async def trigger_price_sync(
    limit: int = 250,
    db: Session = Depends(get_db),
):
    """Trigger a price update for existing cards."""
    stats = await collect_prices_for_cards(db, limit=limit)
    return {"status": "complete", **stats}


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
