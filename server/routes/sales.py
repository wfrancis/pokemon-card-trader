from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import asc, desc, func
from server.database import get_db
from server.models.sale import Sale
from server.models.card import Card

router = APIRouter(prefix="/api", tags=["sales"])


@router.get("/cards/{card_id}/sales")
def get_card_sales(
    card_id: int,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Get individual completed sales for a card, newest first."""
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Card not found")

    sales = (
        db.query(Sale)
        .filter(Sale.card_id == card_id)
        .order_by(desc(Sale.order_date))
        .limit(limit)
        .all()
    )

    # Compute median price across all conditions for "market price"
    all_prices = [s.purchase_price for s in sales if s.purchase_price]
    median_price = None
    if all_prices:
        sorted_prices = sorted(all_prices)
        mid = len(sorted_prices) // 2
        median_price = round(sorted_prices[mid], 2)

    return {
        "card_id": card_id,
        "card_name": card.name,
        "total_sales": len(sales),
        "median_price": median_price,
        "current_price": card.current_price,
        "sales": [
            {
                "id": s.id,
                "order_date": s.order_date.isoformat() if s.order_date else None,
                "purchase_price": s.purchase_price,
                "shipping_price": s.shipping_price,
                "condition": s.condition,
                "variant": s.variant,
                "source": s.source,
                "source_product_id": s.source_product_id,
                "listing_title": s.listing_title,
                "quantity": s.quantity,
            }
            for s in sales
        ],
    }


@router.get("/sales/stats")
def sales_stats(db: Session = Depends(get_db)):
    """Get overall sales collection stats."""
    total_sales = db.query(func.count(Sale.id)).scalar()
    cards_with_sales = db.query(func.count(func.distinct(Sale.card_id))).scalar()
    latest_sale = db.query(func.max(Sale.order_date)).scalar()
    oldest_sale = db.query(func.min(Sale.order_date)).scalar()

    return {
        "total_sales": total_sales,
        "cards_with_sales": cards_with_sales,
        "latest_sale": latest_sale.isoformat() if latest_sale else None,
        "oldest_sale": oldest_sale.isoformat() if oldest_sale else None,
    }
