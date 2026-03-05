import httpx
import json
import logging
import asyncio
from datetime import date, datetime, timezone
from sqlalchemy.orm import Session
from server.models.card import Card
from server.models.price_history import PriceHistory

logger = logging.getLogger(__name__)

TCGDEX_API = "https://api.tcgdex.net/v2/en"
PRICE_HISTORY_API = "https://api.github.com/repos/tcgdex/price-history/contents/data"
PRICE_HISTORY_RAW = "https://raw.githubusercontent.com/tcgdex/price-history/master/data"


async def _fetch_with_retry(
    client: httpx.AsyncClient,
    url: str,
    retries: int = 3,
    params: dict | None = None,
) -> httpx.Response | None:
    """Fetch a URL with exponential backoff retry logic.

    Returns the response on success, or None if all retries fail.
    """
    for attempt in range(retries):
        try:
            resp = await client.get(url, params=params)
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 2 ** attempt))
                logger.warning(
                    f"Rate limited on {url}, waiting {retry_after}s "
                    f"(attempt {attempt + 1}/{retries})"
                )
                await asyncio.sleep(retry_after)
                continue
            if resp.status_code == 404:
                logger.debug(f"Resource not found: {url}")
                return None
            resp.raise_for_status()
            return resp
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout) as e:
            if attempt < retries - 1:
                wait = 2 ** attempt
                logger.warning(
                    f"Request to {url} failed (attempt {attempt + 1}/{retries}): {e}. "
                    f"Retrying in {wait}s..."
                )
                await asyncio.sleep(wait)
            else:
                logger.error(f"Request to {url} failed after {retries} attempts: {e}")
                return None
    return None


def _map_tcgdex_card(card_data: dict) -> dict:
    """Map a TCGdex card response to our Card model fields.

    Handles missing or unexpected fields gracefully by defaulting to
    empty strings or None.
    """
    tcg_id = card_data.get("id", "")
    name = card_data.get("name", "")

    # Set info can be a dict or missing entirely
    set_info = card_data.get("set") or {}
    if not isinstance(set_info, dict):
        set_info = {}

    set_name = set_info.get("name", "")
    set_id = set_info.get("id", "")

    # Image URLs: TCGdex provides a base URL, we append quality suffix
    image_base = card_data.get("image", "")
    if isinstance(image_base, dict):
        # Some responses may nest image URLs differently
        image_small = image_base.get("low", image_base.get("small", ""))
        image_large = image_base.get("high", image_base.get("large", ""))
    elif isinstance(image_base, str) and image_base:
        image_small = f"{image_base}/low.png"
        image_large = f"{image_base}/high.png"
    else:
        image_small = ""
        image_large = ""

    # Types and subtypes can be lists or None
    types_raw = card_data.get("types")
    if isinstance(types_raw, list):
        types_json = json.dumps(types_raw)
    else:
        types_json = json.dumps([])

    subtypes_raw = card_data.get("subtypes")
    if isinstance(subtypes_raw, list):
        subtypes_json = json.dumps(subtypes_raw)
    else:
        subtypes_json = json.dumps([])

    hp_raw = card_data.get("hp")
    hp = str(hp_raw) if hp_raw is not None else ""

    return {
        "tcg_id": tcg_id,
        "name": name,
        "set_name": set_name,
        "set_id": set_id,
        "number": card_data.get("localId", card_data.get("number", "")),
        "rarity": card_data.get("rarity") or "",
        "supertype": card_data.get("category") or "",
        "subtypes": subtypes_json,
        "hp": hp,
        "types": types_json,
        "image_small": image_small,
        "image_large": image_large,
    }


async def sync_tcgdex_cards(db: Session, max_cards: int = 500) -> dict:
    """Fetch cards from the TCGdex API and create/update them in the database.

    This fetches the card list from TCGdex, then fetches individual card
    details (in batches with concurrency limits) to get full metadata
    including set info and images.

    Args:
        db: SQLAlchemy database session.
        max_cards: Maximum number of cards to sync. Defaults to 500.

    Returns:
        A dict with sync statistics: created, updated, skipped, errors, total_fetched.
    """
    stats = {"created": 0, "updated": 0, "skipped": 0, "errors": 0, "total_fetched": 0}

    async with httpx.AsyncClient(
        timeout=60.0,
        headers={"User-Agent": "PokemonCardTrader/1.0"},
        follow_redirects=True,
    ) as client:
        # Step 1: Fetch card list from TCGdex
        logger.info(f"Fetching card list from TCGdex API (max_cards={max_cards})...")
        resp = await _fetch_with_retry(client, f"{TCGDEX_API}/cards")
        if resp is None:
            logger.error("Failed to fetch card list from TCGdex API")
            return stats

        try:
            cards_list = resp.json()
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Failed to parse card list response: {e}")
            return stats

        if not isinstance(cards_list, list):
            logger.error(
                f"Expected list of cards from TCGdex, got {type(cards_list).__name__}"
            )
            return stats

        # Limit to max_cards
        cards_list = cards_list[:max_cards]
        stats["total_fetched"] = len(cards_list)
        logger.info(f"Fetched {len(cards_list)} card summaries from TCGdex")

        # Step 2: Fetch individual card details in concurrent batches
        semaphore = asyncio.Semaphore(10)  # Limit concurrent requests

        async def fetch_card_detail(card_summary: dict) -> dict | None:
            card_id = card_summary.get("id", "")
            if not card_id:
                return None
            async with semaphore:
                detail_resp = await _fetch_with_retry(
                    client, f"{TCGDEX_API}/cards/{card_id}"
                )
                if detail_resp is None:
                    return None
                try:
                    return detail_resp.json()
                except (json.JSONDecodeError, ValueError):
                    logger.warning(f"Failed to parse detail for card {card_id}")
                    return None

        # Fetch details in batches of 50 to avoid overwhelming the API
        batch_size = 50
        all_details = []
        for i in range(0, len(cards_list), batch_size):
            batch = cards_list[i : i + batch_size]
            logger.info(
                f"Fetching card details batch {i // batch_size + 1} "
                f"({len(batch)} cards)..."
            )
            tasks = [fetch_card_detail(c) for c in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for result in results:
                if isinstance(result, Exception):
                    logger.error(f"Exception fetching card detail: {result}")
                    stats["errors"] += 1
                elif result is not None:
                    all_details.append(result)

            # Small pause between batches to be respectful to the API
            if i + batch_size < len(cards_list):
                await asyncio.sleep(0.5)

        logger.info(f"Successfully fetched {len(all_details)} card details")

        # Step 3: Upsert cards into database
        for card_data in all_details:
            try:
                if not isinstance(card_data, dict):
                    stats["errors"] += 1
                    continue

                mapped = _map_tcgdex_card(card_data)
                tcg_id = mapped["tcg_id"]

                if not tcg_id:
                    logger.warning("Skipping card with empty tcg_id")
                    stats["skipped"] += 1
                    continue

                existing = db.query(Card).filter(Card.tcg_id == tcg_id).first()
                if existing:
                    # Update existing card with new data (only non-empty fields)
                    if mapped["name"]:
                        existing.name = mapped["name"]
                    if mapped["set_name"]:
                        existing.set_name = mapped["set_name"]
                    if mapped["set_id"]:
                        existing.set_id = mapped["set_id"]
                    if mapped["number"]:
                        existing.number = mapped["number"]
                    if mapped["rarity"]:
                        existing.rarity = mapped["rarity"]
                    if mapped["supertype"]:
                        existing.supertype = mapped["supertype"]
                    if mapped["image_small"]:
                        existing.image_small = mapped["image_small"]
                    if mapped["image_large"]:
                        existing.image_large = mapped["image_large"]
                    if mapped["hp"]:
                        existing.hp = mapped["hp"]
                    existing.subtypes = mapped["subtypes"]
                    existing.types = mapped["types"]
                    existing.updated_at = datetime.now(timezone.utc)
                    stats["updated"] += 1
                else:
                    card_obj = Card(
                        tcg_id=mapped["tcg_id"],
                        name=mapped["name"],
                        set_name=mapped["set_name"],
                        set_id=mapped["set_id"],
                        number=mapped["number"],
                        rarity=mapped["rarity"],
                        supertype=mapped["supertype"],
                        subtypes=mapped["subtypes"],
                        hp=mapped["hp"],
                        types=mapped["types"],
                        image_small=mapped["image_small"],
                        image_large=mapped["image_large"],
                    )
                    db.add(card_obj)
                    stats["created"] += 1

            except Exception as e:
                logger.error(
                    f"Error processing TCGdex card "
                    f"{card_data.get('id', 'unknown')}: {e}"
                )
                stats["errors"] += 1

        db.commit()

    logger.info(f"TCGdex card sync complete: {stats}")
    return stats


async def _fetch_price_file(
    client: httpx.AsyncClient,
    card_id: str,
) -> dict | None:
    """Fetch a price history JSON file from the tcgdex/price-history GitHub repo.

    The price files are stored at:
        https://raw.githubusercontent.com/tcgdex/price-history/master/data/{card_id}.json

    Args:
        client: httpx async client.
        card_id: The TCGdex card ID (e.g. "sv1-1", "base1-4").

    Returns:
        Parsed JSON dict on success, or None if the file doesn't exist or can't be parsed.
    """
    # Card IDs may contain slashes or special chars; encode for URL safety
    safe_id = card_id.replace("/", "-")
    url = f"{PRICE_HISTORY_RAW}/{safe_id}.json"

    resp = await _fetch_with_retry(client, url, retries=2)
    if resp is None:
        return None

    try:
        data = resp.json()
        if isinstance(data, dict):
            return data
        elif isinstance(data, list):
            # Some files may be structured as a list of price entries
            return {"prices": data}
        else:
            logger.warning(f"Unexpected price data format for {card_id}: {type(data).__name__}")
            return None
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse price data for {card_id}: {e}")
        return None


def _parse_price_entries(price_data: dict) -> list[dict]:
    """Parse price history JSON into a flat list of price entry dicts.

    The price-history repo can have varying formats. This function tries
    to handle the common patterns:
      - {"prices": [{"date": ..., "price": ...}, ...]}
      - {"normal": {"prices": [...]}, "holofoil": {"prices": [...]}}
      - [{"date": ..., "variant": ..., "market": ...}, ...]

    Returns a list of dicts with keys: date, variant, market_price,
    low_price, mid_price, high_price.
    """
    entries = []

    if not isinstance(price_data, dict):
        return entries

    # Check if the data has variant keys at the top level (normal, holofoil, etc.)
    variant_keys = {"normal", "holofoil", "reverseHolofoil", "1stEditionHolofoil",
                    "1stEditionNormal", "unlimitedHolofoil"}
    found_variants = set(price_data.keys()) & variant_keys

    if found_variants:
        # Format: {"normal": {"prices": [...]}, "holofoil": {"prices": [...]}}
        for variant in found_variants:
            variant_data = price_data[variant]
            if isinstance(variant_data, dict):
                raw_prices = variant_data.get("prices", [])
            elif isinstance(variant_data, list):
                raw_prices = variant_data
            else:
                continue

            for entry in raw_prices:
                if not isinstance(entry, dict):
                    continue
                parsed = _parse_single_price_entry(entry, variant)
                if parsed:
                    entries.append(parsed)
    elif "prices" in price_data:
        # Format: {"prices": [{...}, ...]}
        raw_prices = price_data["prices"]
        if isinstance(raw_prices, list):
            for entry in raw_prices:
                if not isinstance(entry, dict):
                    continue
                variant = entry.get("variant", "normal")
                parsed = _parse_single_price_entry(entry, variant)
                if parsed:
                    entries.append(parsed)
    else:
        # Try treating all top-level date-like keys as price entries
        # Format: {"2024-01-01": {"market": 5.0, ...}, ...}
        for key, value in price_data.items():
            if not isinstance(value, dict):
                continue
            try:
                entry_date = _parse_date_string(key)
                if entry_date:
                    entries.append({
                        "date": entry_date,
                        "variant": value.get("variant", "normal"),
                        "market_price": _safe_float(value.get("market") or value.get("market_price")),
                        "low_price": _safe_float(value.get("low") or value.get("low_price")),
                        "mid_price": _safe_float(value.get("mid") or value.get("mid_price")),
                        "high_price": _safe_float(value.get("high") or value.get("high_price")),
                    })
            except (ValueError, TypeError):
                continue

    return entries


def _parse_single_price_entry(entry: dict, variant: str) -> dict | None:
    """Parse a single price entry dict into our normalized format."""
    date_str = entry.get("date") or entry.get("updatedAt") or entry.get("timestamp")
    if not date_str:
        return None

    entry_date = _parse_date_string(str(date_str))
    if not entry_date:
        return None

    market = _safe_float(
        entry.get("market") or entry.get("market_price") or entry.get("price")
    )
    low = _safe_float(entry.get("low") or entry.get("low_price"))
    mid = _safe_float(entry.get("mid") or entry.get("mid_price"))
    high = _safe_float(entry.get("high") or entry.get("high_price"))

    # At least one price value should be present
    if market is None and low is None and mid is None and high is None:
        return None

    return {
        "date": entry_date,
        "variant": variant or "normal",
        "market_price": market,
        "low_price": low,
        "mid_price": mid,
        "high_price": high,
    }


def _parse_date_string(date_str: str) -> date | None:
    """Try multiple date formats and return a date object, or None."""
    date_str = date_str.strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S.%fZ",
                "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    # Try ISO format as a fallback
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return None


def _safe_float(value) -> float | None:
    """Safely convert a value to float, returning None on failure."""
    if value is None:
        return None
    try:
        result = float(value)
        if result < 0:
            return None
        return result
    except (ValueError, TypeError):
        return None


async def import_tcgdex_prices(
    db: Session,
    card_ids: list[str] | None = None,
) -> dict:
    """Import historical price data from the tcgdex/price-history GitHub repo.

    For each card in the database (or the specified subset), this function
    attempts to fetch a price history JSON file from the GitHub repo and
    inserts any new price records into the PriceHistory table.

    Args:
        db: SQLAlchemy database session.
        card_ids: Optional list of tcg_id strings to import prices for.
            If None, imports for all cards in the database.

    Returns:
        A dict with import statistics: cards_processed, prices_imported,
        cards_not_found, errors.
    """
    stats = {
        "cards_processed": 0,
        "prices_imported": 0,
        "cards_not_found": 0,
        "cards_skipped": 0,
        "errors": 0,
    }

    # Get cards from DB
    if card_ids:
        cards = db.query(Card).filter(Card.tcg_id.in_(card_ids)).all()
    else:
        cards = db.query(Card).all()

    if not cards:
        logger.info("No cards found in database for price import")
        return stats

    logger.info(f"Importing TCGdex price history for {len(cards)} cards...")

    async with httpx.AsyncClient(
        timeout=60.0,
        headers={
            "User-Agent": "PokemonCardTrader/1.0",
            "Accept": "application/json",
        },
        follow_redirects=True,
    ) as client:
        semaphore = asyncio.Semaphore(5)  # Conservative concurrency for GitHub

        async def process_card(card: Card) -> dict:
            """Process price import for a single card."""
            card_stats = {"prices": 0, "not_found": False, "error": False}
            async with semaphore:
                price_data = await _fetch_price_file(client, card.tcg_id)

            if price_data is None:
                card_stats["not_found"] = True
                return card_stats

            try:
                entries = _parse_price_entries(price_data)
                if not entries:
                    logger.debug(
                        f"No parseable price entries for card {card.tcg_id}"
                    )
                    return card_stats

                # Fetch existing price dates for this card to avoid duplicates
                existing_prices = (
                    db.query(PriceHistory.date, PriceHistory.variant)
                    .filter(PriceHistory.card_id == card.id)
                    .all()
                )
                existing_set = {(row.date, row.variant) for row in existing_prices}

                new_records = []
                latest_price = None
                latest_date = None

                for entry in entries:
                    key = (entry["date"], entry["variant"])
                    if key in existing_set:
                        continue

                    new_records.append(
                        PriceHistory(
                            card_id=card.id,
                            date=entry["date"],
                            variant=entry["variant"],
                            market_price=entry["market_price"],
                            low_price=entry["low_price"],
                            mid_price=entry["mid_price"],
                            high_price=entry["high_price"],
                        )
                    )

                    # Track the latest price for updating the card's current_price
                    if latest_date is None or entry["date"] > latest_date:
                        if entry["market_price"] is not None:
                            latest_date = entry["date"]
                            latest_price = entry["market_price"]
                            latest_variant = entry["variant"]

                if new_records:
                    db.add_all(new_records)
                    card_stats["prices"] = len(new_records)

                    # Update card's current price if we found something newer
                    if latest_price is not None:
                        if card.current_price is None or (
                            latest_date
                            and (card.updated_at is None or latest_date >= card.updated_at.date())
                        ):
                            card.current_price = latest_price
                            card.price_variant = latest_variant
                            card.updated_at = datetime.now(timezone.utc)

            except Exception as e:
                logger.error(
                    f"Error processing price data for card {card.tcg_id}: {e}"
                )
                card_stats["error"] = True

            return card_stats

        # Process cards in batches to commit periodically
        batch_size = 50
        for i in range(0, len(cards), batch_size):
            batch = cards[i : i + batch_size]
            logger.info(
                f"Processing price import batch {i // batch_size + 1} "
                f"({len(batch)} cards)..."
            )

            tasks = [process_card(card) for card in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for result in results:
                stats["cards_processed"] += 1
                if isinstance(result, Exception):
                    logger.error(f"Exception during price import: {result}")
                    stats["errors"] += 1
                elif result.get("error"):
                    stats["errors"] += 1
                elif result.get("not_found"):
                    stats["cards_not_found"] += 1
                else:
                    stats["prices_imported"] += result.get("prices", 0)

            # Commit after each batch
            try:
                db.commit()
            except Exception as e:
                logger.error(f"Error committing price batch: {e}")
                db.rollback()
                stats["errors"] += 1

            # Pause between batches to be respectful to GitHub rate limits
            if i + batch_size < len(cards):
                await asyncio.sleep(1.0)

    logger.info(f"TCGdex price import complete: {stats}")
    return stats
