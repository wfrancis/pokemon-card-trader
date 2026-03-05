from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from server.database import get_db
from server.models.card import Card
from server.services.market_analysis import analyze_card, get_top_movers, get_hot_cards

router = APIRouter(prefix="/api", tags=["analysis"])


@router.get("/cards/{card_id}/analysis")
def get_card_analysis(card_id: int, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Card not found")

    analysis = analyze_card(db, card_id)
    return {
        "card_id": card_id,
        "card_name": card.name,
        "current_price": card.current_price,
        "analysis": analysis.to_dict(),
    }


@router.get("/market/movers")
def market_movers(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    return get_top_movers(db, limit=limit)


@router.get("/market/index")
def market_index(db: Session = Depends(get_db)):
    """Aggregate Pokemon card market index — average price of all tracked cards."""
    from sqlalchemy import func
    result = db.query(
        func.avg(Card.current_price).label("avg_price"),
        func.count(Card.id).label("total_cards"),
        func.sum(Card.current_price).label("total_market_cap"),
    ).filter(Card.current_price.isnot(None), Card.current_price > 0).first()

    return {
        "avg_price": round(result.avg_price, 2) if result.avg_price else 0,
        "total_cards": result.total_cards or 0,
        "total_market_cap": round(result.total_market_cap, 2) if result.total_market_cap else 0,
    }


@router.get("/market/hot")
def hot_cards(
    limit: int = Query(12, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Get hottest cards ranked by activity score (volume proxy)."""
    return get_hot_cards(db, limit=limit)


@router.get("/market/ticker")
def market_ticker(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Cards for the scrolling ticker — top priced cards with their current values."""
    cards = (
        db.query(Card)
        .filter(Card.current_price.isnot(None), Card.current_price > 0)
        .order_by(Card.current_price.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": c.id,
            "name": c.name,
            "set_name": c.set_name,
            "price": c.current_price,
            "variant": c.price_variant,
        }
        for c in cards
    ]
