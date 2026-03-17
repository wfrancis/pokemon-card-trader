import json
import re
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from server.database import get_db
from server.models.card import Card
from server.models.card_set import CardSet
from server.models.price_history import PriceHistory

router = APIRouter(prefix="/api/cards", tags=["cards"])


@router.get("")
def list_cards(
    q: str = Query(None, description="Search by name"),
    set_name: str = Query(None),
    rarity: str = Query(None),
    supertype: str = Query(None),
    sort_by: str = Query("name", description="Sort by: name, current_price, set_name, rarity"),
    sort_dir: str = Query("asc", description="Sort direction: asc, desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=250),
    has_price: bool = Query(False, description="Only show cards with prices"),
    db: Session = Depends(get_db),
):
    query = db.query(Card).filter(Card.is_tracked == True)

    if q:
        query = query.filter(Card.name.ilike(f"%{q}%"))
    if set_name:
        query = query.filter(Card.set_name == set_name)
    if rarity:
        query = query.filter(Card.rarity == rarity)
    if supertype:
        query = query.filter(Card.supertype == supertype)
    if has_price:
        query = query.filter(Card.current_price.isnot(None), Card.current_price > 0)

    # Sorting — validate sort_by against known columns
    allowed_sort = {"name", "current_price", "set_name", "rarity", "number"}
    if sort_by in allowed_sort:
        sort_column = getattr(Card, sort_by)
    else:
        sort_column = Card.name
    if sort_dir == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    total = query.count()
    cards = query.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "data": [_card_to_dict(c, db) for c in cards],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/filters")
def get_filters(
    set_name: str = Query(None, description="Filter rarities to this set"),
    db: Session = Depends(get_db),
):
    """Return distinct set names and rarities for filter dropdowns."""
    sets = (
        db.query(Card.set_name)
        .filter(Card.is_tracked == True, Card.set_name.isnot(None))
        .distinct()
        .order_by(Card.set_name.asc())
        .all()
    )
    rarity_query = db.query(Card.rarity).filter(
        Card.is_tracked == True, Card.rarity.isnot(None)
    )
    if set_name:
        rarity_query = rarity_query.filter(Card.set_name == set_name)
    rarities = rarity_query.distinct().order_by(Card.rarity.asc()).all()
    return {
        "sets": [s[0] for s in sets],
        "rarities": [r[0] for r in rarities],
    }


@router.get("/{card_id}")
def get_card(card_id: int, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Card not found")
    return _card_to_dict(card, db)


@router.get("/{card_id}/similar")
def get_similar_cards(card_id: int, db: Session = Depends(get_db)):
    """Return similar cards: same Pokemon from different sets + same set different Pokemon."""
    from fastapi import HTTPException

    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    # Extract the base Pokemon name from the card name
    # e.g. "Charizard ex" -> "Charizard", "Pikachu VMAX" -> "Pikachu"
    pokemon_name = re.split(r'\s+(ex|EX|GX|V|VMAX|VSTAR|BREAK|LV\.X|TAG TEAM|Prism Star)\b', card.name)[0].strip()
    if not pokemon_name:
        pokemon_name = card.name

    results = []

    # 1. Same Pokemon, different sets (up to 3)
    same_pokemon = (
        db.query(Card)
        .filter(
            Card.is_tracked == True,
            Card.id != card_id,
            Card.name.ilike(f"%{pokemon_name}%"),
            Card.set_name != card.set_name,
            Card.current_price.isnot(None),
            Card.current_price > 0,
        )
        .order_by(Card.current_price.desc())
        .limit(3)
        .all()
    )
    results.extend(same_pokemon)

    # 2. Same set, different Pokemon (up to 3)
    same_set = (
        db.query(Card)
        .filter(
            Card.is_tracked == True,
            Card.id != card_id,
            Card.set_name == card.set_name,
            ~Card.name.ilike(f"%{pokemon_name}%"),
            Card.current_price.isnot(None),
            Card.current_price > 0,
        )
        .order_by(Card.current_price.desc())
        .limit(3)
        .all()
    )
    results.extend(same_set)

    # Compute 7d price change for each result
    seven_days_ago = datetime.now(timezone.utc).date() - timedelta(days=7)
    similar = []
    seen_ids = set()
    for c in results:
        if c.id in seen_ids:
            continue
        seen_ids.add(c.id)

        price_change_7d = None
        if c.current_price:
            old_price = (
                db.query(PriceHistory.market_price)
                .filter(
                    PriceHistory.card_id == c.id,
                    PriceHistory.date <= seven_days_ago,
                    PriceHistory.market_price.isnot(None),
                )
                .order_by(PriceHistory.date.desc())
                .first()
            )
            if old_price and old_price[0] and old_price[0] > 0:
                price_change_7d = ((c.current_price - old_price[0]) / old_price[0]) * 100

        similar.append({
            "id": c.id,
            "name": c.name,
            "set_name": c.set_name,
            "image_small": c.image_small,
            "current_price": c.current_price,
            "price_change_7d": round(price_change_7d, 2) if price_change_7d is not None else None,
        })

    return {"similar": similar}


def _card_to_dict(card: Card, db: Session = None) -> dict:
    set_total = None
    if db and card.set_id:
        card_set = db.query(CardSet).filter(CardSet.id == card.set_id).first()
        if card_set:
            set_total = card_set.card_count
    return {
        "id": card.id,
        "tcg_id": card.tcg_id,
        "name": card.name,
        "set_name": card.set_name,
        "set_id": card.set_id,
        "number": card.number,
        "rarity": card.rarity,
        "supertype": card.supertype,
        "subtypes": json.loads(card.subtypes) if card.subtypes else [],
        "hp": card.hp,
        "types": json.loads(card.types) if card.types else [],
        "image_small": card.image_small,
        "image_large": card.image_large,
        "current_price": card.current_price,
        "price_variant": card.price_variant,
        "artist": card.artist,
        "tcgplayer_product_id": card.tcgplayer_product_id,
        "set_total_cards": set_total,
    }
