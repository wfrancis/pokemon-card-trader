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


async def _search_tcgplayer(
    client: httpx.AsyncClient, card_name: str, set_name: str, card_number: str = ""
) -> dict | None:
    """Search TCGPlayer for a card, return best matching product.

    Uses card number to disambiguate variants (e.g. Umbreon VMAX #203 vs #215).
    """
    # Include card number in search for precision
    query = f"{card_name} {set_name}".strip()
    if card_number:
        query = f"{card_name} {card_number} {set_name}".strip()

    payload = {
        "algorithm": "sales_synonym_v2",
        "from": 0,
        "size": 24,
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
            SEARCH_API,
            params={"q": query, "isList": "false"},
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

        name_lower = card_name.lower().strip()
        set_lower = set_name.lower().strip()

        def _set_matches(pset: str) -> bool:
            """Fuzzy set matching — handles TCGPlayer set name prefixes.

            TCGPlayer uses names like 'SV01: Scarlet & Violet Base Set'
            while we store 'Scarlet & Violet'. Check if either contains the other.
            """
            if pset == set_lower:
                return True
            if set_lower in pset or pset in set_lower:
                return True
            # Strip common prefixes like "SV01: " or "SWSH12: "
            if ": " in pset:
                pset_stripped = pset.split(": ", 1)[1]
                if set_lower in pset_stripped or pset_stripped in set_lower:
                    return True
            return False

        # Best match: exact name + set + number in product name
        if card_number:
            for p in products:
                pname = (p.get("productName") or "").lower().strip()
                pset = (p.get("setName") or "").lower().strip()
                pnum = (p.get("customAttributes", {}).get("number") or
                        p.get("number") or "")
                if _set_matches(pset) and (
                    f"#{card_number}" in pname or
                    f"- {card_number}" in pname or
                    str(pnum) == str(card_number)
                ):
                    return p

        # Exact name + set match
        for p in products:
            pname = (p.get("productName") or "").lower().strip()
            pset = (p.get("setName") or "").lower().strip()
            if pname == name_lower and _set_matches(pset):
                return p

        # Name match with set
        for p in products:
            pname = (p.get("productName") or "").lower().strip()
            pset = (p.get("setName") or "").lower().strip()
            if name_lower in pname and _set_matches(pset):
                return p

        # Name match only
        for p in products:
            pname = (p.get("productName") or "").lower().strip()
            if pname == name_lower:
                return p

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


async def sync_tcgplayer_prices(db: Session, limit: int = 500) -> dict:
    """Sync current prices from TCGPlayer for ALL tracked cards.

    Searches for each card, gets the TCGPlayer product ID, then fetches
    the current market price. Updates both Card.current_price and creates
    a PriceHistory record for today.

    Args:
        db: SQLAlchemy session.
        limit: Max cards to sync (default 500 = all tracked cards).

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

    # Get ALL tracked cards, ordered by most price history (most valuable to update first)
    from sqlalchemy import func, desc
    card_rows = (
        db.query(Card, func.count(PriceHistory.id).label("cnt"))
        .outerjoin(PriceHistory, PriceHistory.card_id == Card.id)
        .filter(Card.is_tracked == True)
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
                # Search for the card (include card number for variant precision)
                product = await _search_tcgplayer(
                    client, card.name, card.set_name or "", card.number or ""
                )
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

                # Sanity check: reject extreme swings, loosen for stale data
                if card.current_price and card.current_price > 0:
                    ratio = market_price / card.current_price
                    updated = card.updated_at.replace(tzinfo=timezone.utc) if card.updated_at and card.updated_at.tzinfo is None else card.updated_at
                    days_stale = (datetime.now(timezone.utc) - updated).days if updated else 999
                    max_ratio = 10.0 if days_stale > 7 else 3.0
                    min_ratio = 0.1 if days_stale > 7 else 0.33
                    if ratio < min_ratio or ratio > max_ratio:
                        logger.warning(
                            f"Price sanity check FAILED for {card.name} ({card.set_name} #{card.number}): "
                            f"${card.current_price} -> ${market_price} (ratio {ratio:.2f}, stale {days_stale}d). Skipping."
                        )
                        stats["no_price"] += 1
                        continue

                # Update card current price
                card.current_price = round(market_price, 2)
                card.updated_at = datetime.now(timezone.utc)
                stats["prices_updated"] += 1

                # Record price history (avoid duplicates — dedup by card+date+variant+condition)
                variant = card.price_variant or "normal"
                existing = db.query(PriceHistory).filter(
                    PriceHistory.card_id == card.id,
                    PriceHistory.date == today,
                    PriceHistory.variant == variant,
                    PriceHistory.condition == "Near Mint",
                ).first()

                if not existing:
                    db.add(PriceHistory(
                        card_id=card.id,
                        date=today,
                        variant=variant,
                        condition="Near Mint",
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

    # Refresh current_price from latest history for all tracked cards
    try:
        from server.services.tracking import refresh_current_prices
        refresh_current_prices(db)
    except Exception as e:
        logger.error(f"Failed to refresh current prices: {e}")

    logger.info(f"TCGPlayer sync complete: {stats}")
    return stats


HISTORY_API = "https://infinite-api.tcgplayer.com/price/history"


async def _get_price_history(
    client: httpx.AsyncClient, product_id: int, range_name: str = "annual"
) -> list[dict] | None:
    """Get historical price buckets from TCGPlayer infinite-api.

    Returns list of {date, market_price, low_price, high_price, quantity_sold}
    for the Near Mint variant, or None on failure.
    """
    try:
        resp = await client.get(
            f"{HISTORY_API}/{product_id}/detailed?range={range_name}",
            headers=HEADERS,
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        if "error" in data or "result" not in data:
            return None

        # Find Near Mint variant (most representative)
        for variant in data["result"]:
            condition = (variant.get("condition") or "").lower()
            if "near mint" in condition:
                buckets = variant.get("buckets", [])
                result = []
                for b in buckets:
                    mp = float(b.get("marketPrice") or 0)
                    if mp <= 0:
                        continue
                    result.append({
                        "date": b["bucketStartDate"],
                        "market_price": mp,
                        "low_price": float(b.get("lowSalePrice") or 0) or None,
                        "high_price": float(b.get("highSalePrice") or 0) or None,
                        "quantity_sold": int(b.get("quantitySold") or 0),
                    })
                return result

        return None

    except Exception as e:
        logger.error(f"TCGPlayer history error for product {product_id}: {e}")
        return None


async def backfill_tcgplayer_history(db: Session, limit: int = 500) -> dict:
    """Backfill up to 12 months of weekly price history from TCGPlayer.

    Uses the infinite-api price history endpoint (no auth required).
    Fetches annual range (52 weekly buckets) for each tracked card.
    """
    stats = {
        "cards_processed": 0,
        "records_added": 0,
        "records_skipped": 0,
        "search_misses": 0,
        "no_history": 0,
        "errors": 0,
    }

    from sqlalchemy import func, desc
    cards = db.query(Card).filter(Card.is_tracked == True).limit(limit).all()

    if not cards:
        logger.info("No tracked cards for history backfill")
        return stats

    logger.info(f"TCGPlayer history backfill: processing {len(cards)} cards")

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
    ) as client:
        for card in cards:
            stats["cards_processed"] += 1

            try:
                # Search for the card's product ID
                product = await _search_tcgplayer(
                    client, card.name, card.set_name or "", card.number or ""
                )
                if not product:
                    stats["search_misses"] += 1
                    continue

                product_id = product.get("productId")
                if not product_id:
                    stats["search_misses"] += 1
                    continue

                # Get annual history (52 weekly buckets)
                history = await _get_price_history(client, int(product_id), "annual")
                if not history:
                    stats["no_history"] += 1
                    continue

                variant = card.price_variant or "normal"

                for entry in history:
                    entry_date = date.fromisoformat(entry["date"])

                    # Skip if record already exists for this card+date+variant+condition
                    existing = db.query(PriceHistory.id).filter(
                        PriceHistory.card_id == card.id,
                        PriceHistory.date == entry_date,
                        PriceHistory.variant == variant,
                        PriceHistory.condition == "Near Mint",
                    ).first()

                    if existing:
                        stats["records_skipped"] += 1
                        continue

                    db.add(PriceHistory(
                        card_id=card.id,
                        date=entry_date,
                        variant=variant,
                        condition="Near Mint",
                        market_price=round(entry["market_price"], 2),
                        low_price=round(entry["low_price"], 2) if entry["low_price"] else None,
                        mid_price=None,
                        high_price=round(entry["high_price"], 2) if entry["high_price"] else None,
                    ))
                    stats["records_added"] += 1

            except Exception as e:
                logger.error(f"Error backfilling {card.name}: {e}")
                stats["errors"] += 1

            # Rate limit: 1s between cards (2 requests per card: search + history)
            await asyncio.sleep(1.0)

            # Commit every 10 cards
            if stats["cards_processed"] % 10 == 0:
                try:
                    db.commit()
                    logger.info(
                        f"History backfill progress: {stats['cards_processed']}/{len(cards)} cards, "
                        f"{stats['records_added']} records added"
                    )
                except Exception as e:
                    logger.error(f"Commit error: {e}")
                    db.rollback()

        # Final commit
        try:
            db.commit()
        except Exception as e:
            logger.error(f"Final commit error: {e}")
            db.rollback()

    # Refresh current_price from latest history for all tracked cards
    try:
        from server.services.tracking import refresh_current_prices
        refresh_current_prices(db)
    except Exception as e:
        logger.error(f"Failed to refresh current prices: {e}")

    logger.info(f"TCGPlayer history backfill complete: {stats}")
    return stats
