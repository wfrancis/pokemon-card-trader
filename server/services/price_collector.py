import httpx
import logging
from datetime import date, datetime, timezone
from sqlalchemy.orm import Session
from server.models.card import Card
from server.models.price_history import PriceHistory
from server.services.card_sync import _get_best_price

logger = logging.getLogger(__name__)

POKEMON_TCG_API = "https://api.pokemontcg.io/v2"


async def collect_prices_for_cards(db: Session, card_ids: list[int] | None = None, limit: int = 250) -> dict:
    """
    Collect current prices for cards by re-fetching from Pokemon TCG API.
    If card_ids is None, collects for all cards (paginated).
    """
    stats = {"updated": 0, "prices_recorded": 0, "errors": 0}
    today = date.today()

    if card_ids:
        cards = db.query(Card).filter(Card.id.in_(card_ids)).all()
    else:
        cards = db.query(Card).filter(Card.current_price.isnot(None)).order_by(Card.updated_at.asc()).limit(limit).all()

    if not cards:
        return stats

    # Batch fetch by tcg_id
    tcg_ids = [c.tcg_id for c in cards]

    async with httpx.AsyncClient(
        timeout=120.0,
        headers={"User-Agent": "PokemonCardTrader/1.0"},
    ) as client:
        # Pokemon TCG API supports querying by id
        for i in range(0, len(tcg_ids), 25):
            batch = tcg_ids[i:i + 25]
            query = " OR ".join([f'id:"{tid}"' for tid in batch])
            try:
                resp = await client.get(
                    f"{POKEMON_TCG_API}/cards",
                    params={"q": query, "pageSize": 250}
                )
                resp.raise_for_status()
                data = resp.json()

                # Build lookup
                api_cards = {c["id"]: c for c in data.get("data", [])}

                for card in cards:
                    if card.tcg_id not in api_cards:
                        continue

                    api_card = api_cards[card.tcg_id]
                    variant, price_data = _get_best_price(api_card.get("tcgplayer", {}))

                    if not price_data:
                        continue

                    card.current_price = price_data.get("market", card.current_price)
                    card.price_variant = variant or card.price_variant
                    card.updated_at = datetime.now(timezone.utc)
                    stats["updated"] += 1

                    # Record price history
                    existing_price = db.query(PriceHistory).filter(
                        PriceHistory.card_id == card.id,
                        PriceHistory.date == today,
                        PriceHistory.variant == variant,
                    ).first()

                    if not existing_price:
                        db.add(PriceHistory(
                            card_id=card.id,
                            date=today,
                            variant=variant,
                            market_price=price_data.get("market"),
                            low_price=price_data.get("low"),
                            mid_price=price_data.get("mid"),
                            high_price=price_data.get("high"),
                        ))
                        stats["prices_recorded"] += 1

            except Exception as e:
                logger.error(f"Error fetching prices for batch: {e}")
                stats["errors"] += 1

    db.commit()
    logger.info(f"Price collection complete: {stats}")
    return stats
