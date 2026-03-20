"""Collect individual completed sale records from TCGPlayer.

Uses the public `/v2/product/{id}/latestsales` endpoint (no API key).
Supports fetching up to 25 sales per product per call.
Poll every 6 hours to accumulate a rich tick-level dataset over time.
"""
import httpx
import logging
import asyncio
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import desc
from server.models.card import Card
from server.models.sale import Sale

logger = logging.getLogger(__name__)

SEARCH_API = "https://mp-search-api.tcgplayer.com/v1/search/request"
SALES_API = "https://mpapi.tcgplayer.com/v2/product"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


async def _search_product_id(
    client: httpx.AsyncClient, card_name: str, set_name: str, card_number: str = ""
) -> int | None:
    """Search TCGPlayer for a card and return the product ID."""
    query = f"{card_name} {card_number} {set_name}".strip() if card_number else f"{card_name} {set_name}".strip()

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

        name_lower = card_name.lower().strip()
        set_lower = set_name.lower().strip()

        def _set_matches(pset: str) -> bool:
            """Fuzzy set matching — handles TCGPlayer set name prefixes."""
            if pset == set_lower:
                return True
            if set_lower in pset or pset in set_lower:
                return True
            if ": " in pset:
                pset_stripped = pset.split(": ", 1)[1]
                if set_lower in pset_stripped or pset_stripped in set_lower:
                    return True
            return False

        # Best match: exact name + set + number
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
                    pid = p.get("productId")
                    return int(pid) if pid else None

        # Exact name + set match
        for p in products:
            pname = (p.get("productName") or "").lower().strip()
            pset = (p.get("setName") or "").lower().strip()
            if pname == name_lower and _set_matches(pset):
                pid = p.get("productId")
                return int(pid) if pid else None

        # Fallback: first result
        pid = products[0].get("productId")
        return int(pid) if pid else None

    except Exception as e:
        logger.error(f"Search error for '{query}': {e}")
        return None


async def _fetch_latest_sales(
    client: httpx.AsyncClient, product_id: int, limit: int = 25
) -> list[dict]:
    """Fetch latest completed sales from TCGPlayer.

    Args:
        client: HTTP client.
        product_id: TCGPlayer product ID.
        limit: Number of sales to fetch (max 25).
    """
    try:
        resp = await client.post(
            f"{SALES_API}/{product_id}/latestsales",
            json={"limit": limit},
            headers=HEADERS,
        )
        if resp.status_code != 200:
            return []

        data = resp.json()
        return data.get("data", [])

    except Exception as e:
        logger.error(f"Sales fetch error for product {product_id}: {e}")
        return []


def _make_dedup_key(product_id: int, sale: dict) -> str:
    """Create a composite dedup key from sale data.

    Uses product_id + order_date + price + condition to uniquely identify sales.
    """
    order_date_str = sale.get("orderDate", "")
    price = sale.get("purchasePrice", 0)
    condition = sale.get("condition", "")
    listing_id = sale.get("customListingId") or ""
    return f"tcg-{product_id}-{order_date_str[:19]}-{price}-{condition}-{listing_id}"


def _store_sales(
    db: Session, card: Card, product_id: int, sales_data: list[dict]
) -> dict:
    """Store sale records for a card, deduplicating by composite key.

    Returns dict with counts: new, duplicate, errors.
    """
    counts = {"new": 0, "duplicate": 0, "errors": 0}

    for sale in sales_data:
        dedup_key = _make_dedup_key(product_id, sale)

        # Check if already exists
        existing = db.query(Sale.id).filter(
            Sale.listing_id == dedup_key
        ).first()
        if existing:
            counts["duplicate"] += 1
            continue

        # Also check old-style dedup keys (without condition) to avoid re-inserting
        order_date_str = sale.get("orderDate", "")
        price = sale.get("purchasePrice", 0)
        listing_id = sale.get("customListingId") or ""
        old_key = f"tcg-{product_id}-{order_date_str[:19]}-{price}-{listing_id}"
        existing_old = db.query(Sale.id).filter(
            Sale.listing_id == old_key
        ).first()
        if existing_old:
            counts["duplicate"] += 1
            continue

        # Parse order date
        try:
            order_dt = datetime.fromisoformat(
                order_date_str.replace("Z", "+00:00")
            )
        except (ValueError, TypeError):
            counts["errors"] += 1
            continue

        db.add(Sale(
            card_id=card.id,
            source="tcgplayer",
            source_product_id=str(product_id),
            order_date=order_dt,
            purchase_price=price,
            shipping_price=sale.get("shippingPrice", 0),
            condition=sale.get("condition", ""),
            variant=sale.get("variant", ""),
            language=sale.get("language", "English"),
            quantity=sale.get("quantity", 1),
            listing_title=sale.get("title", ""),
            listing_id=dedup_key,
        ))
        counts["new"] += 1

    return counts


async def collect_sales(db: Session, limit: int = 500, force: bool = False) -> dict:
    """Collect latest sales from TCGPlayer for all tracked cards.

    For each tracked card:
    1. Use stored tcgplayer_product_id, or search TCGPlayer for it
    2. Fetch up to 25 completed sales
    3. Store new sales (dedup by order_date + price + condition)
    4. Update card.current_price from median of recent sales

    Args:
        db: SQLAlchemy session.
        limit: Max cards to process.
        force: If True, re-fetch sales even for recently-synced cards.

    Returns:
        Stats dict.
    """
    stats = {
        "cards_processed": 0,
        "sales_collected": 0,
        "sales_new": 0,
        "sales_duplicate": 0,
        "search_misses": 0,
        "product_ids_found": 0,
        "no_sales": 0,
        "errors": 0,
    }

    # Get all tracked cards
    cards = db.query(Card).filter(Card.is_tracked == True).limit(limit).all()
    if not cards:
        logger.info("No tracked cards for sales collection")
        return stats

    logger.info(f"Sales collector: processing {len(cards)} tracked cards (force={force})")

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
    ) as client:
        for card in cards:
            stats["cards_processed"] += 1

            try:
                # Use stored product ID or search for it
                product_id = card.tcgplayer_product_id
                if not product_id:
                    product_id = await _search_product_id(
                        client, card.name, card.set_name or "", card.number or ""
                    )
                    if product_id:
                        card.tcgplayer_product_id = product_id
                        stats["product_ids_found"] += 1
                        logger.info(f"Found product ID {product_id} for {card.name} ({card.set_name})")
                    else:
                        stats["search_misses"] += 1
                        logger.debug(f"No TCGPlayer match for {card.name} ({card.set_name})")
                        continue

                    # Rate limit after search
                    await asyncio.sleep(1.0)

                # Skip if card has recent sales and not forcing
                if not force:
                    recent_sale = db.query(Sale.id).filter(
                        Sale.card_id == card.id,
                        Sale.source == "tcgplayer",
                    ).first()
                    # If card already has sales, still fetch to get new ones
                    # (the dedup will handle duplicates)

                # Fetch latest sales (up to 25)
                sales_data = await _fetch_latest_sales(client, product_id, limit=25)
                if not sales_data:
                    stats["no_sales"] += 1
                    continue

                stats["sales_collected"] += len(sales_data)

                # Store sales with dedup
                counts = _store_sales(db, card, product_id, sales_data)
                stats["sales_new"] += counts["new"]
                stats["sales_duplicate"] += counts["duplicate"]
                stats["errors"] += counts["errors"]

                if counts["new"] > 0:
                    logger.info(
                        f"{card.name}: +{counts['new']} new sales, "
                        f"{counts['duplicate']} dupes skipped"
                    )

                # Update card.current_price from latest sale
                if sales_data:
                    prices = [s["purchasePrice"] for s in sales_data if s.get("purchasePrice")]
                    if prices:
                        median_price = sorted(prices)[len(prices) // 2]
                        card.current_price = round(median_price, 2)
                        card.updated_at = datetime.now(timezone.utc)

            except Exception as e:
                logger.error(f"Error collecting sales for {card.name}: {e}")
                stats["errors"] += 1

            # Rate limit: 1s between cards
            await asyncio.sleep(1.0)

            # Commit every 10 cards
            if stats["cards_processed"] % 10 == 0:
                try:
                    db.commit()
                    logger.info(
                        f"Sales progress: {stats['cards_processed']}/{len(cards)} cards, "
                        f"{stats['sales_new']} new sales, {stats['product_ids_found']} product IDs found"
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

    logger.info(f"Sales collection complete: {stats}")
    return stats


async def backfill_sales(
    db: Session, card_ids: list[int] | None = None, limit: int = 100
) -> dict:
    """Aggressively backfill sales for specific cards or top 100 by price.

    For each card:
    1. Search TCGPlayer if no product_id stored
    2. Fetch up to 25 latest sales
    3. Store all new Sale records (dedup by order_date + price + condition)
    4. Update card's tcgplayer_product_id

    Args:
        db: SQLAlchemy session.
        card_ids: Optional list of card IDs to backfill. If None, uses top 100 by price.
        limit: Max cards to process (only used when card_ids is None).

    Returns:
        Stats dict.
    """
    stats = {
        "cards_processed": 0,
        "sales_added": 0,
        "already_existed": 0,
        "product_ids_found": 0,
        "search_misses": 0,
        "no_sales": 0,
        "errors": 0,
    }

    if card_ids:
        cards = db.query(Card).filter(Card.id.in_(card_ids)).all()
    else:
        # Top cards by price, preferring tracked/viable
        cards = (
            db.query(Card)
            .filter(Card.current_price.isnot(None), Card.current_price > 0)
            .order_by(desc(Card.current_price))
            .limit(limit)
            .all()
        )

    if not cards:
        logger.info("No cards found for sales backfill")
        return stats

    logger.info(f"Sales backfill: processing {len(cards)} cards")

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
    ) as client:
        for card in cards:
            stats["cards_processed"] += 1

            try:
                product_id = card.tcgplayer_product_id

                # Search for product ID if not stored
                if not product_id:
                    product_id = await _search_product_id(
                        client, card.name, card.set_name or "", card.number or ""
                    )
                    if product_id:
                        card.tcgplayer_product_id = product_id
                        stats["product_ids_found"] += 1
                        logger.info(
                            f"[backfill] Found product ID {product_id} for "
                            f"{card.name} ({card.set_name} #{card.number})"
                        )
                    else:
                        stats["search_misses"] += 1
                        logger.warning(
                            f"[backfill] No TCGPlayer match for "
                            f"{card.name} ({card.set_name} #{card.number})"
                        )
                        await asyncio.sleep(1.0)
                        continue

                    # Rate limit after search
                    await asyncio.sleep(1.0)

                # Fetch up to 25 latest sales
                sales_data = await _fetch_latest_sales(client, product_id, limit=25)
                if not sales_data:
                    stats["no_sales"] += 1
                    logger.debug(f"[backfill] No sales for {card.name} (product {product_id})")
                else:
                    # Store sales with dedup
                    counts = _store_sales(db, card, product_id, sales_data)
                    stats["sales_added"] += counts["new"]
                    stats["already_existed"] += counts["duplicate"]
                    stats["errors"] += counts["errors"]

                    logger.info(
                        f"[backfill] {card.name} (${card.current_price}): "
                        f"+{counts['new']} new, {counts['duplicate']} dupes, "
                        f"product_id={product_id}"
                    )

                    # Update price from sales if we got new data
                    if counts["new"] > 0:
                        prices = [s["purchasePrice"] for s in sales_data if s.get("purchasePrice")]
                        if prices:
                            median_price = sorted(prices)[len(prices) // 2]
                            card.current_price = round(median_price, 2)
                            card.updated_at = datetime.now(timezone.utc)

            except Exception as e:
                logger.error(f"[backfill] Error for {card.name}: {e}")
                stats["errors"] += 1

            # Rate limit: 1s between cards
            await asyncio.sleep(1.0)

            # Commit every 10 cards
            if stats["cards_processed"] % 10 == 0:
                try:
                    db.commit()
                    logger.info(
                        f"[backfill] Progress: {stats['cards_processed']}/{len(cards)} cards, "
                        f"{stats['sales_added']} sales added, "
                        f"{stats['product_ids_found']} product IDs found"
                    )
                except Exception as e:
                    logger.error(f"[backfill] Commit error: {e}")
                    db.rollback()

        # Final commit
        try:
            db.commit()
        except Exception as e:
            logger.error(f"[backfill] Final commit error: {e}")
            db.rollback()

    logger.info(f"Sales backfill complete: {stats}")
    return stats
