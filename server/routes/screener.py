"""Investment Screener API — Find cards that are liquid AND steadily appreciating."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from server.database import get_db
from server.services.investment_screener import (
    get_investment_candidates,
    get_screener_stats,
    get_liquidity_trend,
)

router = APIRouter(prefix="/api/market", tags=["screener"])


@router.get("/screener")
def screener(
    q: str = Query(None, description="Search by card name or set name"),
    min_liquidity: int = Query(0, ge=0, le=100, description="Minimum liquidity score"),
    min_appreciation: float = Query(0, ge=0, le=100, description="Minimum appreciation score"),
    regime: str = Query(None, description="Filter by regime: markup, accumulation, distribution, markdown"),
    min_price: float = Query(10.0, ge=0, description="Minimum card price"),
    max_price: float = Query(None, ge=0, description="Maximum card price"),
    min_velocity: float = Query(0, ge=0, le=50, description="Minimum sales per day (30d avg)"),
    sort_by: str = Query(
        "investment_score",
        description="Sort by: investment_score, liquidity_score, appreciation_score, appreciation_slope, current_price, name",
    ),
    sort_dir: str = Query("desc", description="Sort direction: asc, desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=250),
    db: Session = Depends(get_db),
):
    """Get investment candidates — cards filtered by liquidity and appreciation metrics."""
    return get_investment_candidates(
        db,
        min_liquidity=min_liquidity,
        min_appreciation_score=min_appreciation,
        regime=regime,
        min_price=min_price,
        max_price=max_price,
        min_velocity=min_velocity,
        sort_by=sort_by,
        sort_dir=sort_dir,
        page=page,
        page_size=page_size,
        q=q,
    )


@router.get("/screener/stats")
def screener_stats(db: Session = Depends(get_db)):
    """Summary statistics for the investment screener."""
    return get_screener_stats(db)


@router.get("/screener/liquidity-trend/{card_id}")
def liquidity_trend(
    card_id: int,
    days: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
):
    """Get liquidity score history for a card over time."""
    return get_liquidity_trend(db, card_id, days=days)
