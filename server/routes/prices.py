from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import asc
from server.database import get_db
from server.models.price_history import PriceHistory
from server.models.card import Card

router = APIRouter(prefix="/api/cards", tags=["prices"])


@router.get("/{card_id}/prices")
def get_price_history(
    card_id: int,
    db: Session = Depends(get_db),
):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Card not found")

    from server.services.market_analysis import _filter_dominant_variant

    records = (
        db.query(PriceHistory)
        .filter(PriceHistory.card_id == card_id, PriceHistory.market_price.isnot(None))
        .order_by(asc(PriceHistory.date))
        .all()
    )

    # Filter to dominant variant to avoid mixed-variant noise
    records = _filter_dominant_variant(records)

    # Deduplicate: one price per date (latest record wins)
    by_date: dict[str, dict] = {}
    for r in records:
        d = r.date.isoformat()
        by_date[d] = {
            "date": d,
            "market_price": r.market_price,
            "low_price": r.low_price,
            "mid_price": r.mid_price,
            "high_price": r.high_price,
        }

    return {
        "card_id": card_id,
        "card_name": card.name,
        "variant": card.price_variant,
        "current_price": card.current_price,
        "data": [by_date[d] for d in sorted(by_date.keys())],
    }
