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
MIN_PRICE = 2.0  # Skip cards under $2


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


async def _fetch_with_retry(client: httpx.AsyncClient, url: str, params: dict, retries: int = 5) -> httpx.Response:
    """Fetch with aggressive retry logic for API issues (504, 502, timeouts)."""
    for attempt in range(retries):
        try:
            resp = await client.get(url, params=params)
            # Retry on server errors (502, 503, 504)
            if resp.status_code in (502, 503, 504) and attempt < retries - 1:
                delay = min(30, 3 * (2 ** attempt))  # 3s, 6s, 12s, 24s, 30s
                logger.warning(f"Got {resp.status_code} from API (attempt {attempt + 1}/{retries}), retrying in {delay}s...")
                await asyncio.sleep(delay)
                continue
            resp.raise_for_status()
            return resp
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout) as e:
            if attempt < retries - 1:
                delay = min(30, 3 * (2 ** attempt))
                logger.warning(f"API request failed (attempt {attempt + 1}/{retries}): {e}, retrying in {delay}s...")
                await asyncio.sleep(delay)
            else:
                raise
    raise httpx.HTTPStatusError("Max retries exceeded", request=None, response=None)


def _process_card_data(db: Session, card_data: dict, today: date, min_price: float) -> str:
    """Process a single card from the API. Returns: 'created', 'updated', 'skipped_cheap', 'skipped_no_price', or 'error'."""
    tcg_id = card_data["id"]
    variant, price_data = _get_best_price(card_data.get("tcgplayer", {}))

    if not price_data or not price_data.get("market"):
        return "skipped_no_price"

    market_price = price_data["market"]
    if market_price < min_price:
        return "skipped_cheap"

    existing = db.query(Card).filter(Card.tcg_id == tcg_id).first()
    if existing:
        existing.name = card_data.get("name", existing.name)
        existing.current_price = market_price
        existing.price_variant = variant or existing.price_variant
        existing.artist = card_data.get("artist") or existing.artist
        existing.updated_at = datetime.now(timezone.utc)
        card_obj = existing
        result = "updated"
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
            current_price=market_price,
            price_variant=variant,
            artist=card_data.get("artist"),
        )
        db.add(card_obj)
        db.flush()
        result = "created"

    if card_obj.id:
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

    return result


async def sync_cards(db: Session, page: int = 1, page_size: int = 100, min_price: float = MIN_PRICE) -> dict:
    """Sync one page of cards from Pokemon TCG API. Skips cards under min_price."""
    stats = {"created": 0, "updated": 0, "prices_recorded": 0, "skipped_cheap": 0, "skipped_no_price": 0, "errors": 0, "page": page}

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(180.0, connect=30.0),
        headers={"User-Agent": "PokemonCardTrader/1.0"},
        follow_redirects=True,
    ) as client:
        url = f"{POKEMON_TCG_API}/cards"
        params = {"page": page, "pageSize": page_size}
        logger.info(f"Fetching cards page {page} (size={page_size}) from Pokemon TCG API")

        resp = await _fetch_with_retry(client, url, params)
        data = resp.json()

        cards_data = data.get("data", [])
        total_count = data.get("totalCount", 0)
        stats["total_available"] = total_count
        stats["fetched"] = len(cards_data)

        today = date.today()

        for card_data in cards_data:
            try:
                result = _process_card_data(db, card_data, today, min_price)
                if result == "created":
                    stats["created"] += 1
                    stats["prices_recorded"] += 1
                elif result == "updated":
                    stats["updated"] += 1
                elif result == "skipped_cheap":
                    stats["skipped_cheap"] += 1
                elif result == "skipped_no_price":
                    stats["skipped_no_price"] += 1
            except Exception as e:
                logger.error(f"Error processing card {card_data.get('id', 'unknown')}: {e}")
                stats["errors"] += 1

        db.commit()

    logger.info(f"Sync page {page}: created={stats['created']} updated={stats['updated']} skipped_cheap={stats['skipped_cheap']}")
    return stats


async def sync_all_cards(db: Session, max_pages: int = 200) -> dict:
    """Sync ALL pages of cards from the API. Filters for price >= $2.

    Uses page_size=100 for reliability with the free API.
    """
    all_stats = {
        "total_created": 0, "total_updated": 0, "total_prices": 0,
        "total_skipped_cheap": 0, "total_skipped_no_price": 0,
        "pages_synced": 0, "failed_pages": [],
    }

    page_size = 100  # Smaller pages = more reliable with free API

    for page in range(1, max_pages + 1):
        try:
            stats = await sync_cards(db, page=page, page_size=page_size)
            all_stats["total_created"] += stats["created"]
            all_stats["total_updated"] += stats["updated"]
            all_stats["total_prices"] += stats["prices_recorded"]
            all_stats["total_skipped_cheap"] += stats["skipped_cheap"]
            all_stats["total_skipped_no_price"] += stats["skipped_no_price"]
            all_stats["pages_synced"] += 1

            logger.info(f"Progress: page {page}, total cards so far: {all_stats['total_created'] + all_stats['total_updated']}")

            # Stop when we've fetched all available cards
            if stats["fetched"] < page_size:
                logger.info(f"Last page reached (got {stats['fetched']} < {page_size}). Sync complete.")
                break

            # Delay between pages to respect API rate limits
            await asyncio.sleep(1.5)

        except Exception as e:
            logger.error(f"Failed to sync page {page}: {e}")
            all_stats["failed_pages"].append(page)
            # Continue to next page instead of aborting everything
            await asyncio.sleep(5)
            continue

    return all_stats
