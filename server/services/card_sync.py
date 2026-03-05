import httpx
import json
import logging
import asyncio
from datetime import date, datetime, timezone
from sqlalchemy.orm import Session
from server.models.card import Card
from server.models.price_history import PriceHistory

logger = logging.getLogger(__name__)

POKEMON_TCG_API = "https://api.pokemontcg.io/v2"


def _get_best_price(tcgplayer_data: dict) -> tuple[str | None, dict | None]:
    """Extract the best available price variant from tcgplayer data."""
    if not tcgplayer_data or "prices" not in tcgplayer_data:
        return None, None
    prices = tcgplayer_data["prices"]
    for variant in ["holofoil", "reverseHolofoil", "normal",
                     "1stEditionHolofoil", "1stEditionNormal"]:
        if variant in prices and prices[variant].get("market"):
            return variant, prices[variant]
    for variant, price_data in prices.items():
        if price_data.get("market"):
            return variant, price_data
    return None, None


async def _fetch_with_retry(client: httpx.AsyncClient, url: str, params: dict, retries: int = 3) -> httpx.Response:
    """Fetch with retry logic for intermittent API issues."""
    for attempt in range(retries):
        try:
            resp = await client.get(url, params=params)
            if resp.status_code == 404 and attempt < retries - 1:
                logger.warning(f"Got 404 from API (attempt {attempt + 1}/{retries}), retrying in {2 ** attempt}s...")
                await asyncio.sleep(2 ** attempt)
                continue
            resp.raise_for_status()
            return resp
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout) as e:
            if attempt < retries - 1:
                logger.warning(f"API request failed (attempt {attempt + 1}/{retries}): {e}")
                await asyncio.sleep(2 ** attempt)
            else:
                raise
    raise httpx.HTTPStatusError("Max retries exceeded", request=None, response=None)


async def sync_cards(db: Session, page: int = 1, page_size: int = 250) -> dict:
    """Sync cards from Pokemon TCG API. Returns stats about the sync."""
    stats = {"created": 0, "updated": 0, "prices_recorded": 0, "errors": 0, "page": page}

    async with httpx.AsyncClient(
        timeout=120.0,
        headers={"User-Agent": "PokemonCardTrader/1.0"},
        follow_redirects=True,
    ) as client:
        url = f"{POKEMON_TCG_API}/cards"
        params = {"page": page, "pageSize": page_size}
        logger.info(f"Fetching cards page {page} from Pokemon TCG API")

        resp = await _fetch_with_retry(client, url, params)
        data = resp.json()

        cards_data = data.get("data", [])
        total_count = data.get("totalCount", 0)
        stats["total_available"] = total_count
        stats["fetched"] = len(cards_data)

        today = date.today()

        for card_data in cards_data:
            try:
                tcg_id = card_data["id"]
                variant, price_data = _get_best_price(card_data.get("tcgplayer", {}))

                existing = db.query(Card).filter(Card.tcg_id == tcg_id).first()
                if existing:
                    existing.name = card_data.get("name", existing.name)
                    existing.current_price = price_data["market"] if price_data else existing.current_price
                    existing.price_variant = variant or existing.price_variant
                    existing.updated_at = datetime.now(timezone.utc)
                    card_obj = existing
                    stats["updated"] += 1
                else:
                    card_obj = Card(
                        tcg_id=tcg_id,
                        name=card_data.get("name", ""),
                        set_name=card_data.get("set", {}).get("name", ""),
                        set_id=card_data.get("set", {}).get("id", ""),
                        number=card_data.get("number", ""),
                        rarity=card_data.get("rarity", ""),
                        supertype=card_data.get("supertype", ""),
                        subtypes=json.dumps(card_data.get("subtypes", [])),
                        hp=card_data.get("hp", ""),
                        types=json.dumps(card_data.get("types", [])),
                        image_small=card_data.get("images", {}).get("small", ""),
                        image_large=card_data.get("images", {}).get("large", ""),
                        current_price=price_data["market"] if price_data else None,
                        price_variant=variant,
                    )
                    db.add(card_obj)
                    db.flush()
                    stats["created"] += 1

                if price_data and card_obj.id:
                    existing_price = db.query(PriceHistory).filter(
                        PriceHistory.card_id == card_obj.id,
                        PriceHistory.date == today,
                        PriceHistory.variant == variant,
                    ).first()

                    if not existing_price:
                        db.add(PriceHistory(
                            card_id=card_obj.id,
                            date=today,
                            variant=variant,
                            market_price=price_data.get("market"),
                            low_price=price_data.get("low"),
                            mid_price=price_data.get("mid"),
                            high_price=price_data.get("high"),
                        ))
                        stats["prices_recorded"] += 1

            except Exception as e:
                logger.error(f"Error processing card {card_data.get('id', 'unknown')}: {e}")
                stats["errors"] += 1

        db.commit()

    logger.info(f"Sync complete: {stats}")
    return stats


async def sync_all_cards(db: Session, max_pages: int = 10) -> dict:
    """Sync multiple pages of cards."""
    all_stats = {"total_created": 0, "total_updated": 0, "total_prices": 0, "pages_synced": 0}

    for page in range(1, max_pages + 1):
        stats = await sync_cards(db, page=page, page_size=250)
        all_stats["total_created"] += stats["created"]
        all_stats["total_updated"] += stats["updated"]
        all_stats["total_prices"] += stats["prices_recorded"]
        all_stats["pages_synced"] += 1

        if stats["fetched"] < 250:
            break

    return all_stats
