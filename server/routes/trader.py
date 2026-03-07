from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from server.database import get_db
from server.services.trader_agent import (
    get_trader_analysis, get_card_trader_analysis, get_multi_persona_analysis,
)

router = APIRouter(prefix="/api/trader", tags=["trader"])


@router.get("/analysis")
async def trader_market_analysis(db: Session = Depends(get_db)):
    """Get the AI trader's full market analysis (legacy single persona)."""
    return await get_trader_analysis(db)


@router.get("/personas")
async def trader_personas_analysis(db: Session = Depends(get_db)):
    """Get multi-persona AI trading desk analysis (3 traders + consensus)."""
    return await get_multi_persona_analysis(db)


@router.get("/card/{card_id}")
async def trader_card_analysis(card_id: int, db: Session = Depends(get_db)):
    """Get the AI trader's analysis for a specific card."""
    return await get_card_trader_analysis(db, card_id)
