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
    limit: int = Query(365, description="Max number of price records"),
    db: Session = Depends(get_db),
):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Card not found")

    records = (
        db.query(PriceHistory)
        .filter(PriceHistory.card_id == card_id, PriceHistory.market_price.isnot(None))
        .order_by(asc(PriceHistory.date))
        .limit(limit)
        .all()
    )

    return {
        "card_id": card_id,
        "card_name": card.name,
        "variant": card.price_variant,
        "current_price": card.current_price,
        "data": [
            {
                "date": r.date.isoformat(),
                "market_price": r.market_price,
                "low_price": r.low_price,
                "mid_price": r.mid_price,
                "high_price": r.high_price,
            }
            for r in records
        ],
    }
