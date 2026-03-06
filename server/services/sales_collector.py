"""Collect individual completed sale records from TCGPlayer.

Uses the public `/v2/product/{id}/latestsales` endpoint (no API key).
Returns up to 5 most recent sales per product per call.
Poll every 6 hours to accumulate a rich tick-level dataset over time.
"""
import httpx
import logging
import asyncio
from datetime import datetime, timezone
from sqlalchemy.orm import Session
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

        # Best match: exact name + set + number
        if card_number:
            for p in products:
                pname = (p.get("productName") or "").lower().strip()
                pset = (p.get("setName") or "").lower().strip()
                pnum = (p.get("customAttributes", {}).get("number") or
                        p.get("number") or "")
                if pset == set_lower and (
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
            if pname == name_lower and pset == set_lower:
                pid = p.get("productId")
                return int(pid) if pid else None

        # Fallback: first result
        pid = products[0].get("productId")
        return int(pid) if pid else None

    except Exception as e:
        logger.error(f"Search error for '{query}': {e}")
        return None


async def _fetch_latest_sales(
    client: httpx.AsyncClient, product_id: int
) -> list[dict]:
    """Fetch latest completed sales from TCGPlayer (up to 5 per call)."""
    try:
        resp = await client.post(
            f"{SALES_API}/{product_id}/latestsales",
            json={"limit": 25},
            headers=HEADERS,
        )
        if resp.status_code != 200:
            return []

        data = resp.json()
        return data.get("data", [])

    except Exception as e:
        logger.error(f"Sales fetch error for product {product_id}: {e}")
        return []


async def collect_sales(db: Session, limit: int = 500) -> dict:
    """Collect latest sales from TCGPlayer for all tracked cards.

    For each tracked card:
    1. Search TCGPlayer for the product ID
    2. Fetch latest 5 completed sales
    3. Store new sales (dedup by listing_id)
    4. Update card.current_price from median of recent sales

    Args:
        db: SQLAlchemy session.
        limit: Max cards to process.

    Returns:
        Stats dict.
    """
    stats = {
        "cards_processed": 0,
        "sales_collected": 0,
        "sales_new": 0,
        "sales_duplicate": 0,
        "search_misses": 0,
        "no_sales": 0,
        "errors": 0,
    }

    # Get all tracked cards
    cards = db.query(Card).filter(Card.is_tracked == True).limit(limit).all()
    if not cards:
        logger.info("No tracked cards for sales collection")
        return stats

    logger.info(f"Sales collector: processing {len(cards)} tracked cards")

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
    ) as client:
        for card in cards:
            stats["cards_processed"] += 1

            try:
                # Search for TCGPlayer product ID
                product_id = await _search_product_id(
                    client, card.name, card.set_name or "", card.number or ""
                )
                if not product_id:
                    stats["search_misses"] += 1
                    continue

                # Fetch latest sales
                sales_data = await _fetch_latest_sales(client, product_id)
                if not sales_data:
                    stats["no_sales"] += 1
                    continue

                stats["sales_collected"] += len(sales_data)

                for sale in sales_data:
                    # Build a unique listing_id for dedup
                    order_date_str = sale.get("orderDate", "")
                    listing_id = sale.get("customListingId") or ""
                    # Create composite dedup key: product_id + date + price + listing_id
                    price = sale.get("purchasePrice", 0)
                    dedup_key = f"tcg-{product_id}-{order_date_str[:19]}-{price}-{listing_id}"

                    # Check if already exists
                    existing = db.query(Sale.id).filter(
                        Sale.listing_id == dedup_key
                    ).first()
                    if existing:
                        stats["sales_duplicate"] += 1
                        continue

                    # Parse order date
                    try:
                        order_dt = datetime.fromisoformat(
                            order_date_str.replace("Z", "+00:00")
                        )
                    except (ValueError, TypeError):
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
                    stats["sales_new"] += 1

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

            # Rate limit: 0.5s between cards (2 requests per card)
            await asyncio.sleep(0.5)

            # Commit every 20 cards
            if stats["cards_processed"] % 20 == 0:
                try:
                    db.commit()
                    logger.info(
                        f"Sales progress: {stats['cards_processed']}/{len(cards)} cards, "
                        f"{stats['sales_new']} new sales"
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
