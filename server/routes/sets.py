"""Set-level analytics — aggregate metrics per card set."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from server.database import get_db
from server.models import Card
from server.services.cache import get as cache_get, set as cache_set

router = APIRouter(prefix="/api/sets", tags=["sets"])


@router.get("/analytics")
def set_analytics(
    min_cards: int = Query(5, ge=1, description="Minimum tracked cards per set"),
    db: Session = Depends(get_db),
):
    """Aggregate analytics for each set with tracked cards."""
    cache_key = f"set_analytics:{min_cards}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    # Query aggregates grouped by set_name for tracked cards with a price
    rows = (
        db.query(
            Card.set_name,
            func.count(Card.id).label("card_count"),
            func.avg(Card.current_price).label("avg_price"),
            func.sum(Card.current_price).label("total_value"),
            func.avg(Card.liquidity_score).label("avg_liquidity_score"),
            func.avg(Card.appreciation_score).label("avg_appreciation_score"),
        )
        .filter(Card.is_tracked == True, Card.current_price.isnot(None), Card.current_price > 0)
        .group_by(Card.set_name)
        .having(func.count(Card.id) >= min_cards)
        .order_by(func.sum(Card.current_price).desc())
        .all()
    )

    # For 7d change, we need price history. Compute from appreciation_slope as proxy.
    # appreciation_slope is daily % change from linear regression — multiply by 7 for weekly estimate.
    # We'll do a second query to get avg appreciation_slope per set.
    slope_rows = (
        db.query(
            Card.set_name,
            func.avg(Card.appreciation_slope).label("avg_slope"),
        )
        .filter(
            Card.is_tracked == True,
            Card.current_price.isnot(None),
            Card.current_price > 0,
            Card.appreciation_slope.isnot(None),
        )
        .group_by(Card.set_name)
        .all()
    )
    slope_map = {r.set_name: r.avg_slope for r in slope_rows}

    result = []
    for row in rows:
        avg_slope = slope_map.get(row.set_name)
        avg_7d_change = round(avg_slope * 7, 2) if avg_slope is not None else None
        result.append({
            "set_name": row.set_name,
            "card_count": row.card_count,
            "avg_price": round(row.avg_price, 2) if row.avg_price else 0,
            "total_value": round(row.total_value, 2) if row.total_value else 0,
            "avg_liquidity_score": round(row.avg_liquidity_score, 1) if row.avg_liquidity_score else None,
            "avg_appreciation_score": round(row.avg_appreciation_score, 1) if row.avg_appreciation_score else None,
            "avg_7d_change": avg_7d_change,
        })

    cache_set(cache_key, result, ttl=600)  # 10 min cache
    return result
