"""TCGPlayer price sync via their public marketplace API.

Uses two endpoints:
1. Search: POST mp-search-api.tcgplayer.com/v1/search/request — find product IDs
2. Price:  GET  mpapi.tcgplayer.com/v2/product/{id}/pricepoints — get current market price

No API key required. Rate limit is generous (~100 req/s) but we stay conservative.
"""
import httpx
import json
import logging
import asyncio
from datetime import date, datetime, timezone
from sqlalchemy.orm import Session
from server.models.card import Card
from server.models.price_history import PriceHistory

logger = logging.getLogger(__name__)

SEARCH_API = "https://mp-search-api.tcgplayer.com/v1/search/request"
PRICE_API = "https://mpapi.tcgplayer.com/v2/product"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


async def _search_tcgplayer(client: httpx.AsyncClient, card_name: str, set_name: str) -> dict | None:
    """Search TCGPlayer for a card, return best matching product."""
    query = f"{card_name} {set_name}".strip()
    payload = {
        "algorithm": "sales_synonym_v2",
        "from": 0,
        "size": 10,
        "filters": {
            "term": {
                "productLineName": ["pokemon"],
                "productTypeName": ["Cards"],
            },
            "range": {},
            "match": {},
        },
        "listingSearch": {
            "filters": {
                "term": {},
                "range": {},
                "exclude": {"channelExclusion": 0},
            },
            "context": {"cart": {}},
        },
    }

    try:
        resp = await client.post(
            f"{SEARCH_API}?q={query}&isList=false",
            json=payload,
            headers=HEADERS,
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        results = data.get("results", [])
        if not results:
            return None

        products = results[0].get("results", [])
        if not products:
            return None

        # Find best match: exact card name + set name match
        name_lower = card_name.lower().strip()
        set_lower = set_name.lower().strip()

        for p in products:
            pname = (p.get("productName") or "").lower().strip()
            pset = (p.get("setName") or "").lower().strip()
            if pname == name_lower and pset == set_lower:
                return p

        # Fallback: first result with matching card name
        for p in products:
            pname = (p.get("productName") or "").lower().strip()
            if pname == name_lower:
                return p

        # Last resort: first result
        return products[0] if products else None

    except Exception as e:
        logger.error(f"TCGPlayer search error for '{query}': {e}")
        return None


async def _get_price(client: httpx.AsyncClient, product_id: int) -> dict | None:
    """Get current price points for a TCGPlayer product."""
    try:
        resp = await client.get(
            f"{PRICE_API}/{product_id}/pricepoints",
            headers=HEADERS,
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        if not isinstance(data, list):
            return None

        # Find best variant with a market price
        for entry in data:
            ptype = (entry.get("printingType") or "").lower()
            market = entry.get("marketPrice")
            if market is not None and market > 0:
                return {
                    "market_price": market,
                    "listed_median": entry.get("listedMedianPrice"),
                    "buylist": entry.get("buylistMarketPrice"),
                    "printing_type": ptype,
                }

        return None

    except Exception as e:
        logger.error(f"TCGPlayer price error for product {product_id}: {e}")
        return None


async def sync_tcgplayer_prices(db: Session, limit: int = 100) -> dict:
    """Sync current prices from TCGPlayer for cards in our database.

    Searches for each card, gets the TCGPlayer product ID, then fetches
    the current market price. Updates both Card.current_price and creates
    a PriceHistory record for today.

    Args:
        db: SQLAlchemy session.
        limit: Max cards to sync (ordered by most price history).

    Returns:
        Stats dict.
    """
    stats = {
        "cards_processed": 0,
        "prices_updated": 0,
        "prices_recorded": 0,
        "search_misses": 0,
        "no_price": 0,
        "errors": 0,
    }

    today = date.today()

    # Get cards ordered by price history count (most data first = most valuable to update)
    from sqlalchemy import func, desc
    card_rows = (
        db.query(Card, func.count(PriceHistory.id).label("cnt"))
        .outerjoin(PriceHistory, PriceHistory.card_id == Card.id)
        .filter(Card.current_price.isnot(None))
        .group_by(Card.id)
        .order_by(desc("cnt"))
        .limit(limit)
        .all()
    )

    cards = [row[0] for row in card_rows]
    if not cards:
        logger.info("No cards to sync")
        return stats

    logger.info(f"TCGPlayer sync: processing {len(cards)} cards")

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
    ) as client:
        for card in cards:
            stats["cards_processed"] += 1

            try:
                # Search for the card
                product = await _search_tcgplayer(client, card.name, card.set_name or "")
                if not product:
                    stats["search_misses"] += 1
                    continue

                product_id = product.get("productId")
                market_from_search = product.get("marketPrice")

                # Get detailed price
                price_data = None
                if product_id:
                    price_data = await _get_price(client, int(product_id))

                market_price = None
                if price_data:
                    market_price = price_data["market_price"]
                elif market_from_search:
                    market_price = float(market_from_search)

                if not market_price or market_price <= 0:
                    stats["no_price"] += 1
                    continue

                # Update card current price
                card.current_price = round(market_price, 2)
                card.updated_at = datetime.now(timezone.utc)
                stats["prices_updated"] += 1

                # Record price history (avoid duplicates)
                variant = card.price_variant or "normal"
                existing = db.query(PriceHistory).filter(
                    PriceHistory.card_id == card.id,
                    PriceHistory.date == today,
                ).first()

                if not existing:
                    db.add(PriceHistory(
                        card_id=card.id,
                        date=today,
                        variant=variant,
                        market_price=round(market_price, 2),
                        low_price=None,
                        mid_price=None,
                        high_price=None,
                    ))
                    stats["prices_recorded"] += 1

            except Exception as e:
                logger.error(f"Error syncing {card.name}: {e}")
                stats["errors"] += 1

            # Rate limit: 0.5s between cards (conservative)
            await asyncio.sleep(0.5)

            # Commit every 25 cards
            if stats["cards_processed"] % 25 == 0:
                try:
                    db.commit()
                    logger.info(f"TCGPlayer sync progress: {stats['cards_processed']}/{len(cards)} cards, {stats['prices_updated']} updated")
                except Exception as e:
                    logger.error(f"Commit error: {e}")
                    db.rollback()

        # Final commit
        try:
            db.commit()
        except Exception as e:
            logger.error(f"Final commit error: {e}")
            db.rollback()

    logger.info(f"TCGPlayer sync complete: {stats}")
    return stats
