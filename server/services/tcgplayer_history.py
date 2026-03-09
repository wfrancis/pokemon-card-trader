"""Backfill daily aggregated sales history from TCGPlayer infinite-api.

Endpoint: GET https://infinite-api.tcgplayer.com/price/history/{product_id}?range=alltime
Returns ~131 daily data points spanning ~2.5 years with:
  - averageSalesPrice (what buyers actually paid)
  - marketPrice (TCGPlayer's rolling algorithm price)
  - quantity (number of sales that day)
  - Per-variant breakdown (Holofoil, Normal, etc.)

Strategy: One-time `alltime` backfill for viable ($20+) cards, then `quarter`
maintenance syncs. All data stored in the `sales` table (source="tcgplayer_history").
"""
import httpx
import logging
import asyncio
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from server.models.card import Card
from server.models.sale import Sale
from server.services.sales_collector import _search_product_id

logger = logging.getLogger(__name__)

HISTORY_API = "https://infinite-api.tcgplayer.com/price/history"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/134.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Origin": "https://www.tcgplayer.com",
    "Referer": "https://www.tcgplayer.com/",
}

MIN_VIABLE_PRICE = 20.0


async def _resolve_product_id(
    db: Session, card: Card, client: httpx.AsyncClient,
) -> int | None:
    """Resolve TCGPlayer product ID via 3-tier lookup."""
    # Tier 1: Already mapped via TCGCSV
    if card.tcgplayer_product_id:
        return card.tcgplayer_product_id

    # Tier 2: From existing Sale records
    existing = (
        db.query(Sale.source_product_id)
        .filter(Sale.card_id == card.id, Sale.source_product_id.isnot(None))
        .first()
    )
    if existing and existing[0]:
        try:
            pid = int(existing[0])
            card.tcgplayer_product_id = pid
            return pid
        except (ValueError, TypeError):
            pass

    # Tier 3: Search TCGPlayer
    pid = await _search_product_id(client, card.name, card.set_name or "", card.number or "")
    if pid:
        card.tcgplayer_product_id = pid
    return pid


async def _fetch_history(
    client: httpx.AsyncClient, product_id: int, range_name: str = "alltime",
) -> list[dict] | None:
    """Fetch daily aggregated sales history from infinite-api."""
    try:
        resp = await client.get(
            f"{HISTORY_API}/{product_id}",
            params={"range": range_name},
            headers=HEADERS,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        result = data.get("result")
        if not result:
            return None

        entries = []
        for item in result:
            date_str = item.get("date")
            if not date_str:
                continue
            for v in item.get("variants", []):
                avg_price = v.get("averageSalesPrice")
                qty = v.get("quantity")
                if not avg_price or not qty:
                    continue
                try:
                    price_f = float(avg_price)
                    qty_i = int(qty)
                except (ValueError, TypeError):
                    continue
                if price_f <= 0 or qty_i <= 0:
                    continue
                entries.append({
                    "date": date_str,
                    "variant": v.get("variant", "Unknown"),
                    "avg_price": price_f,
                    "market_price": float(v.get("marketPrice", 0) or 0),
                    "quantity": qty_i,
                })
        return entries
    except Exception as e:
        logger.error(f"History fetch error for product {product_id}: {e}")
        return None


def _card_has_history(db: Session, card_id: int) -> bool:
    """Check if a card already has deep history backfilled."""
    count = (
        db.query(func.count(Sale.id))
        .filter(Sale.card_id == card_id, Sale.source == "tcgplayer_history")
        .scalar()
    )
    return (count or 0) > 10  # More than 10 = already backfilled


async def sync_sales_history(db: Session, limit: int = 200) -> dict:
    """Backfill daily aggregated sales history for viable ($20+) cards.

    Cards that already have deep history get skipped (one-time backfill).
    Use range='quarter' for maintenance updates of already-backfilled cards.
    """
    stats = {
        "cards_processed": 0,
        "cards_backfilled": 0,
        "cards_updated": 0,
        "cards_skipped_no_pid": 0,
        "cards_skipped_has_history": 0,
        "sales_created": 0,
        "sales_duplicate": 0,
        "no_history": 0,
        "errors": 0,
    }

    # Step 1: Mark new viable cards (sticky — once viable, always viable)
    newly_viable = db.execute(text(
        "UPDATE cards SET is_viable = 1 "
        "WHERE current_price >= :threshold AND is_viable = 0 AND is_tracked = 1"
    ), {"threshold": MIN_VIABLE_PRICE})
    if newly_viable.rowcount:
        db.commit()
        logger.info(f"Marked {newly_viable.rowcount} new cards as viable")

    # Step 2: Query all viable cards (includes those that dropped below $20)
    cards = (
        db.query(Card)
        .filter(Card.is_viable == True, Card.is_tracked == True)
        .order_by(Card.current_price.desc())
        .limit(limit)
        .all()
    )
    if not cards:
        logger.info("No viable cards for sales history sync")
        return stats

    logger.info(f"Sales history sync: {len(cards)} viable cards")

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        for card in cards:
            stats["cards_processed"] += 1

            try:
                # Resolve product ID
                product_id = await _resolve_product_id(db, card, client)
                if not product_id:
                    stats["cards_skipped_no_pid"] += 1
                    continue

                # Check if already backfilled — use quarter for maintenance
                has_history = _card_has_history(db, card.id)
                if has_history:
                    range_name = "quarter"
                    stats["cards_updated"] += 1
                else:
                    range_name = "alltime"
                    stats["cards_backfilled"] += 1

                # Fetch history
                entries = await _fetch_history(client, product_id, range_name)
                if not entries:
                    stats["no_history"] += 1
                    continue

                # Batch dedup: get existing listing_ids for this card
                existing_ids = set(
                    row[0] for row in db.query(Sale.listing_id).filter(
                        Sale.card_id == card.id,
                        Sale.source == "tcgplayer_history",
                    ).all()
                )

                new_sales = []
                for entry in entries:
                    dedup_key = f"tcg-hist-{product_id}-{entry['date']}-{entry['variant']}"
                    if dedup_key in existing_ids:
                        stats["sales_duplicate"] += 1
                        continue

                    # Parse date
                    try:
                        dt = datetime.strptime(entry["date"], "%Y-%m-%d").replace(
                            hour=12, tzinfo=timezone.utc,
                        )
                    except ValueError:
                        continue

                    new_sales.append(Sale(
                        card_id=card.id,
                        source="tcgplayer_history",
                        source_product_id=str(product_id),
                        order_date=dt,
                        purchase_price=round(entry["avg_price"], 2),
                        shipping_price=0.0,
                        condition="Near Mint",
                        variant=entry["variant"],
                        quantity=entry["quantity"],
                        listing_title=f"Daily avg: {entry['quantity']} sales",
                        listing_id=dedup_key,
                    ))
                    existing_ids.add(dedup_key)

                if new_sales:
                    db.add_all(new_sales)
                    stats["sales_created"] += len(new_sales)

            except Exception as e:
                logger.error(f"Error syncing history for {card.name}: {e}")
                stats["errors"] += 1

            # Rate limit
            await asyncio.sleep(0.3)

            # Commit every 10 cards
            if stats["cards_processed"] % 10 == 0:
                try:
                    db.commit()
                    logger.info(
                        f"History progress: {stats['cards_processed']}/{len(cards)} cards, "
                        f"{stats['sales_created']} new sales"
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

    logger.info(f"Sales history sync complete: {stats}")
    return stats
