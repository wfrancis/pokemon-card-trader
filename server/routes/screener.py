"""Investment Screener API — Find cards that are liquid AND steadily appreciating."""
import json
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from server.database import get_db
from server.services.investment_screener import (
    get_investment_candidates,
    get_screener_stats,
    get_liquidity_trend,
)
from server.services.cache import get as cache_get, set as cache_set

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
    min_profit: float = Query(None, ge=-1000, description="Minimum estimated flip profit"),
    sort_by: str = Query(
        "investment_score",
        description="Sort by: investment_score, liquidity_score, appreciation_score, appreciation_slope, current_price, est_profit, name",
    ),
    sort_dir: str = Query("desc", description="Sort direction: asc, desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=250),
    db: Session = Depends(get_db),
):
    """Get investment candidates — cards filtered by liquidity and appreciation metrics."""
    # Build cache key from all params
    cache_key = f"screener:{q}:{min_liquidity}:{min_appreciation}:{regime}:{min_price}:{max_price}:{min_velocity}:{min_profit}:{sort_by}:{sort_dir}:{page}:{page_size}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    result = get_investment_candidates(
        db,
        min_liquidity=min_liquidity,
        min_appreciation_score=min_appreciation,
        regime=regime,
        min_price=min_price,
        max_price=max_price,
        min_velocity=min_velocity,
        min_profit=min_profit,
        sort_by=sort_by,
        sort_dir=sort_dir,
        page=page,
        page_size=page_size,
        q=q,
    )
    cache_set(cache_key, result, ttl=300)  # 5 min cache
    return result


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
