"""
Import historical Pokemon card price data from PriceCharting CSV files.

PriceCharting has a Kaggle dataset with historical data through ~Oct 2024.
Users download the CSV and upload it, or we can fetch it if available.

Expected CSV columns: id, name, console, loose_price, cib_price, new_price,
graded_price, date, ... (varies by dataset version)

We map "loose_price" to our market_price (closest to ungraded NM/LP).
"""
import csv
import io
import json
import logging
from datetime import date, datetime
from pathlib import Path
from sqlalchemy.orm import Session
from server.models.card import Card
from server.models.price_history import PriceHistory

logger = logging.getLogger(__name__)


def _normalize_name(name: str) -> str:
    """Normalize card name for fuzzy matching."""
    return (
        name.lower()
        .replace("-", " ")
        .replace("'", "")
        .replace("'", "")
        .replace(".", "")
        .replace(",", "")
        .strip()
    )


def _parse_price(value: str) -> float | None:
    """Parse a price string like '$5.99' or '5.99' into a float."""
    if not value or value.strip() in ("", "-", "N/A", "n/a"):
        return None
    cleaned = value.strip().replace("$", "").replace(",", "")
    try:
        result = float(cleaned)
        return result if result > 0 else None
    except (ValueError, TypeError):
        return None


def _parse_date(value: str) -> date | None:
    """Parse various date formats from PriceCharting CSV."""
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%dT%H:%M:%SZ", "%d-%b-%Y", "%B %d, %Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value).date()
    except (ValueError, TypeError):
        return None


def import_pricecharting_csv(
    db: Session,
    csv_path: str | None = None,
    csv_content: str | None = None,
) -> dict:
    """Import historical prices from a PriceCharting CSV file.

    Matches cards by name (fuzzy) against cards already in our database.
    Creates PriceHistory records for matched cards.

    Args:
        db: SQLAlchemy session.
        csv_path: Path to the CSV file on disk.
        csv_content: Raw CSV content as a string (alternative to csv_path).

    Returns:
        Stats dict with import results.
    """
    stats = {
        "rows_processed": 0,
        "prices_imported": 0,
        "cards_matched": 0,
        "cards_unmatched": 0,
        "duplicates_skipped": 0,
        "errors": 0,
    }

    # Read CSV
    if csv_path:
        path = Path(csv_path)
        if not path.exists():
            logger.error(f"CSV file not found: {csv_path}")
            return stats
        with open(path, "r", encoding="utf-8-sig") as f:
            content = f.read()
    elif csv_content:
        content = csv_content
    else:
        logger.error("No CSV path or content provided")
        return stats

    # Build a lookup of our cards by normalized name
    all_cards = db.query(Card).all()
    card_lookup: dict[str, Card] = {}
    for card in all_cards:
        norm = _normalize_name(card.name)
        # Include set for disambiguation
        key_with_set = f"{norm}|{_normalize_name(card.set_name or '')}"
        card_lookup[key_with_set] = card
        # Also store by just name (first match wins)
        if norm not in card_lookup:
            card_lookup[norm] = card

    # Pre-load existing price dates per card
    existing_prices: dict[int, set[tuple[date, str]]] = {}
    for card in all_cards:
        prices = (
            db.query(PriceHistory.date, PriceHistory.variant)
            .filter(PriceHistory.card_id == card.id)
            .all()
        )
        existing_prices[card.id] = {(p.date, p.variant) for p in prices}

    matched_card_ids = set()
    unmatched_names = set()
    batch = []
    batch_size = 500

    reader = csv.DictReader(io.StringIO(content))
    for row in reader:
        stats["rows_processed"] += 1
        try:
            # Try to find the card name column
            name = (
                row.get("name")
                or row.get("product-name")
                or row.get("card_name")
                or row.get("Name")
                or ""
            )
            if not name:
                continue

            # Try to find date column
            date_str = (
                row.get("date")
                or row.get("Date")
                or row.get("price_date")
                or ""
            )
            if not date_str:
                continue

            price_date = _parse_date(date_str)
            if not price_date:
                continue

            # Try to match card
            norm_name = _normalize_name(name)
            set_name = row.get("console") or row.get("set") or row.get("Set") or ""
            key_with_set = f"{norm_name}|{_normalize_name(set_name)}"

            card = card_lookup.get(key_with_set) or card_lookup.get(norm_name)
            if not card:
                if norm_name not in unmatched_names:
                    unmatched_names.add(norm_name)
                continue

            matched_card_ids.add(card.id)

            # Parse prices
            market = _parse_price(
                row.get("loose_price")
                or row.get("Loose Price")
                or row.get("market_price")
                or row.get("price")
                or ""
            )
            low = _parse_price(row.get("low_price") or "")
            high = _parse_price(
                row.get("cib_price")
                or row.get("CIB Price")
                or row.get("high_price")
                or ""
            )
            graded = _parse_price(
                row.get("graded_price")
                or row.get("new_price")
                or ""
            )

            if market is None and high is None and graded is None:
                continue

            # Use loose_price as market, calculate mid from market & high
            if market is None:
                market = high

            variant = card.price_variant or "normal"
            key = (price_date, variant)

            if card.id in existing_prices and key in existing_prices[card.id]:
                stats["duplicates_skipped"] += 1
                continue

            mid = None
            if market and high:
                mid = round((market + high) / 2, 2)

            batch.append(PriceHistory(
                card_id=card.id,
                date=price_date,
                variant=variant,
                market_price=market,
                low_price=low,
                mid_price=mid,
                high_price=high or graded,
            ))

            # Track to avoid duplicate inserts within this import
            if card.id not in existing_prices:
                existing_prices[card.id] = set()
            existing_prices[card.id].add(key)

            if len(batch) >= batch_size:
                db.add_all(batch)
                db.flush()
                stats["prices_imported"] += len(batch)
                batch = []

        except Exception as e:
            logger.error(f"Error processing CSV row: {e}")
            stats["errors"] += 1

    # Final batch
    if batch:
        db.add_all(batch)
        stats["prices_imported"] += len(batch)

    stats["cards_matched"] = len(matched_card_ids)
    stats["cards_unmatched"] = len(unmatched_names)

    # Update current_price for matched cards with the latest data
    for card_id in matched_card_ids:
        latest = (
            db.query(PriceHistory)
            .filter(PriceHistory.card_id == card_id)
            .order_by(PriceHistory.date.desc())
            .first()
        )
        if latest and latest.market_price:
            card = db.query(Card).get(card_id)
            if card:
                card.current_price = latest.market_price

    db.commit()

    logger.info(
        f"PriceCharting import complete: {stats}. "
        f"Unmatched names sample: {list(unmatched_names)[:10]}"
    )
    return stats
