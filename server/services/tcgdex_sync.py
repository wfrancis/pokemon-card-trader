"""TCGdex card & price sync service.

Uses two data sources:
1. TCGdex API (api.tcgdex.net) — card metadata (name, set, rarity, images)
2. tcgdex/price-history GitHub repo — TCGPlayer historical prices

Price data format (from GitHub repo):
    File path: en/{set_id}/{card_number}.tcgplayer.json
    Structure: {"data": {"normal-nearmint": {"history": {"2024-05-16": {"avg": 321, ...}}}}}
    Prices are in CENTS.
"""
import json
import logging
import asyncio
import re
from datetime import date, datetime, timezone
from sqlalchemy.orm import Session
from server.models.card import Card
from server.models.price_history import PriceHistory

logger = logging.getLogger(__name__)

TCGDEX_API = "https://api.tcgdex.net/v2/en"
GITHUB_TREE_API = "https://api.github.com/repos/tcgdex/price-history/git/trees/master?recursive=1"
PRICE_RAW_BASE = "https://raw.githubusercontent.com/tcgdex/price-history/master"

MIN_PRICE_CENTS = 200  # $2.00 minimum


async def _fetch(client, url, retries=3, params=None):
    """Fetch with retry logic. Returns response or None."""
    for attempt in range(retries):
        try:
            resp = await client.get(url, params=params)
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 2 ** attempt))
                logger.warning(f"Rate limited, waiting {wait}s")
                await asyncio.sleep(wait)
                continue
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp
        except Exception as e:
            if attempt < retries - 1:
                await asyncio.sleep(2 ** attempt)
            else:
                logger.error(f"Failed after {retries} attempts: {url}: {e}")
                return None
    return None


def _parse_price_file(content: str, set_id: str, card_number: str) -> list[dict]:
    """Parse a tcgplayer.json price file into price records.

    Returns list of dicts with: date, variant, market_price, low_price, high_price
    Prices converted from cents to dollars.
    """
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return []

    if not isinstance(data, dict):
        return []

    price_data = data.get("data", data)
    if not isinstance(price_data, dict):
        return []

    records = []
    for variant_key, variant_data in price_data.items():
        if not isinstance(variant_data, dict):
            continue

        # Extract variant name (e.g., "normal" from "normal-nearmint")
        # We prefer nearmint condition as it's closest to TCGPlayer "market" price
        parts = variant_key.split("-")
        variant = parts[0] if parts else variant_key
        condition = parts[1] if len(parts) > 1 else ""

        # Only use nearmint condition (best proxy for market price)
        # If no nearmint, fall back to good
        if condition not in ("nearmint", "good", ""):
            continue

        history = variant_data.get("history", {})
        if not isinstance(history, dict):
            continue

        for date_str, day_data in history.items():
            if not isinstance(day_data, dict):
                continue
            try:
                entry_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                continue

            avg_cents = day_data.get("avg")
            min_cents = day_data.get("min")
            max_cents = day_data.get("max")

            if avg_cents is None:
                continue

            records.append({
                "date": entry_date,
                "variant": variant,
                "condition": condition,
                "market_price": avg_cents / 100.0,
                "low_price": min_cents / 100.0 if min_cents is not None else None,
                "high_price": max_cents / 100.0 if max_cents is not None else None,
                "mid_price": None,
                "count": day_data.get("count", 0),
            })

    return records


def _dedupe_prices(records: list[dict]) -> list[dict]:
    """For each date, keep only the best variant (prefer nearmint over good, holofoil over normal)."""
    by_date = {}
    variant_priority = {"holofoil": 3, "reverseHolofoil": 2, "normal": 1}
    condition_priority = {"nearmint": 2, "good": 1, "": 0}

    for r in records:
        d = r["date"]
        if d not in by_date:
            by_date[d] = r
        else:
            existing = by_date[d]
            # Prefer nearmint over good, then holofoil over normal
            r_score = condition_priority.get(r["condition"], 0) * 10 + variant_priority.get(r["variant"], 0)
            e_score = condition_priority.get(existing["condition"], 0) * 10 + variant_priority.get(existing["variant"], 0)
            if r_score > e_score:
                by_date[d] = r

    return list(by_date.values())


async def sync_tcgdex_cards(db: Session, max_cards: int = 25000) -> dict:
    """Fetch cards from TCGdex API and upsert into database.

    Gets the card list (lightweight), then fetches details in concurrent batches.
    """
    stats = {"created": 0, "updated": 0, "skipped": 0, "errors": 0, "total_fetched": 0}

    import httpx
    async with httpx.AsyncClient(
        timeout=60.0,
        headers={"User-Agent": "PokemonCardTrader/1.0"},
        follow_redirects=True,
    ) as client:
        logger.info(f"Fetching card list from TCGdex (max={max_cards})...")
        resp = await _fetch(client, f"{TCGDEX_API}/cards")
        if not resp:
            return stats

        cards_list = resp.json()
        if not isinstance(cards_list, list):
            return stats

        cards_list = cards_list[:max_cards]
        stats["total_fetched"] = len(cards_list)
        logger.info(f"Got {len(cards_list)} card IDs from TCGdex")

        # Fetch details concurrently (low concurrency to avoid OOM on small VMs)
        sem = asyncio.Semaphore(5)

        async def get_detail(card_summary):
            cid = card_summary.get("id", "")
            if not cid:
                return None
            async with sem:
                r = await _fetch(client, f"{TCGDEX_API}/cards/{cid}")
                if not r:
                    return None
                try:
                    return r.json()
                except Exception:
                    return None

        batch_size = 50
        for i in range(0, len(cards_list), batch_size):
            batch = cards_list[i:i + batch_size]
            batch_num = i // batch_size + 1
            total_batches = (len(cards_list) + batch_size - 1) // batch_size

            logger.info(f"Fetching card details batch {batch_num}/{total_batches} ({len(batch)} cards)")
            results = await asyncio.gather(*[get_detail(c) for c in batch], return_exceptions=True)

            for result in results:
                if isinstance(result, Exception) or result is None:
                    stats["errors"] += 1 if isinstance(result, Exception) else 0
                    continue

                try:
                    mapped = _map_card(result)
                    if not mapped["tcg_id"]:
                        stats["skipped"] += 1
                        continue

                    existing = db.query(Card).filter(Card.tcg_id == mapped["tcg_id"]).first()
                    if existing:
                        for key, val in mapped.items():
                            if val and key != "tcg_id":
                                setattr(existing, key, val)
                        existing.updated_at = datetime.now(timezone.utc)
                        stats["updated"] += 1
                    else:
                        db.add(Card(**mapped))
                        stats["created"] += 1
                except Exception as e:
                    logger.error(f"Error processing card: {e}")
                    stats["errors"] += 1

            db.commit()
            if i + batch_size < len(cards_list):
                await asyncio.sleep(1.0)

    logger.info(f"TCGdex card sync: {stats}")
    return stats


def _map_card(data: dict) -> dict:
    """Map TCGdex card response to our Card model fields."""
    set_info = data.get("set") or {}
    if not isinstance(set_info, dict):
        set_info = {}

    image_base = data.get("image", "")
    if isinstance(image_base, dict):
        image_small = image_base.get("low", "")
        image_large = image_base.get("high", "")
    elif isinstance(image_base, str) and image_base:
        image_small = f"{image_base}/low.png"
        image_large = f"{image_base}/high.png"
    else:
        image_small = image_large = ""

    types_raw = data.get("types")
    subtypes_raw = data.get("subtypes")
    hp_raw = data.get("hp")

    return {
        "tcg_id": data.get("id", ""),
        "name": data.get("name", ""),
        "set_name": set_info.get("name", ""),
        "set_id": set_info.get("id", ""),
        "number": data.get("localId", data.get("number", "")),
        "rarity": data.get("rarity") or "",
        "supertype": data.get("category") or "",
        "subtypes": json.dumps(subtypes_raw if isinstance(subtypes_raw, list) else []),
        "hp": str(hp_raw) if hp_raw is not None else "",
        "types": json.dumps(types_raw if isinstance(types_raw, list) else []),
        "image_small": image_small,
        "image_large": image_large,
    }


async def import_tcgdex_prices(db: Session, min_price_cents: int = MIN_PRICE_CENTS) -> dict:
    """Import prices from tcgdex/price-history GitHub repo.

    Strategy:
    1. Get full file tree from GitHub (one API call)
    2. Fetch each price file from raw.githubusercontent.com (no rate limit)
    3. Parse prices, skip cards under min_price
    4. Create cards (from TCGdex) if not in DB
    5. Insert price history records
    """
    stats = {
        "files_found": 0, "files_processed": 0, "cards_created": 0,
        "cards_updated": 0, "prices_imported": 0, "skipped_cheap": 0,
        "errors": 0,
    }

    import httpx
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(60.0, connect=15.0),
        headers={"User-Agent": "PokemonCardTrader/1.0"},
        follow_redirects=True,
    ) as client:
        # Step 1: Get full file tree
        logger.info("Fetching price-history file tree from GitHub...")
        resp = await _fetch(client, GITHUB_TREE_API)
        if not resp:
            logger.error("Failed to fetch GitHub tree")
            return stats

        tree_data = resp.json()
        all_files = tree_data.get("tree", [])

        # Filter to en/*.tcgplayer.json files
        price_files = []
        for f in all_files:
            path = f.get("path", "")
            if path.startswith("en/") and path.endswith(".tcgplayer.json"):
                # Parse set_id and card_number from path
                # Format: en/{set_id}/{card_number}.tcgplayer.json
                parts = path.split("/")
                if len(parts) == 3:
                    set_id = parts[1]
                    card_number = parts[2].replace(".tcgplayer.json", "")
                    price_files.append({
                        "path": path,
                        "set_id": set_id,
                        "card_number": card_number,
                        "tcg_id": f"{set_id}-{card_number}",
                    })

        stats["files_found"] = len(price_files)
        logger.info(f"Found {len(price_files)} price files across {len(set(f['set_id'] for f in price_files))} sets")

        # Step 2: Fetch and process price files in batches
        sem = asyncio.Semaphore(20)  # raw.githubusercontent.com handles high concurrency

        async def process_price_file(pf: dict) -> dict:
            """Fetch and process one price file."""
            result = {"prices": 0, "created": False, "updated": False, "skipped": False, "error": False}
            async with sem:
                url = f"{PRICE_RAW_BASE}/{pf['path']}"
                r = await _fetch(client, url, retries=2)
                if not r:
                    return result

                try:
                    records = _parse_price_file(r.text, pf["set_id"], pf["card_number"])
                except Exception as e:
                    logger.error(f"Error parsing {pf['path']}: {e}")
                    result["error"] = True
                    return result

            if not records:
                return result

            # Deduplicate — keep best variant per date
            records = _dedupe_prices(records)

            # Check if any recent price is >= min_price
            max_price_cents = max(r["market_price"] * 100 for r in records)
            if max_price_cents < min_price_cents:
                result["skipped"] = True
                return result

            # Get or create the card
            tcg_id = pf["tcg_id"]
            card = db.query(Card).filter(Card.tcg_id == tcg_id).first()

            if not card:
                # Create minimal card entry — will be enriched by TCGdex sync
                card = Card(
                    tcg_id=tcg_id,
                    name=f"Card #{pf['card_number']}",
                    set_name=pf["set_id"],
                    set_id=pf["set_id"],
                    number=pf["card_number"],
                )
                db.add(card)
                db.flush()  # Get the card ID
                result["created"] = True

            # Get existing price dates to avoid duplicates
            existing = set(
                (row.date, row.variant)
                for row in db.query(PriceHistory.date, PriceHistory.variant)
                .filter(PriceHistory.card_id == card.id)
                .all()
            )

            # Insert new price records
            new_records = []
            latest_price = None
            latest_date = None
            latest_variant = None

            for rec in records:
                key = (rec["date"], rec["variant"])
                if key in existing:
                    continue

                new_records.append(PriceHistory(
                    card_id=card.id,
                    date=rec["date"],
                    variant=rec["variant"],
                    market_price=rec["market_price"],
                    low_price=rec["low_price"],
                    mid_price=rec["mid_price"],
                    high_price=rec["high_price"],
                ))

                if latest_date is None or rec["date"] > latest_date:
                    if rec["market_price"] is not None:
                        latest_date = rec["date"]
                        latest_price = rec["market_price"]
                        latest_variant = rec["variant"]

            if new_records:
                db.add_all(new_records)
                result["prices"] = len(new_records)

            # Update card's current price
            if latest_price is not None:
                if card.current_price is None or latest_price != card.current_price:
                    card.current_price = latest_price
                    card.price_variant = latest_variant
                    card.updated_at = datetime.now(timezone.utc)
                    result["updated"] = True

            return result

        # Process in batches
        batch_size = 100
        total_batches = (len(price_files) + batch_size - 1) // batch_size

        for i in range(0, len(price_files), batch_size):
            batch = price_files[i:i + batch_size]
            batch_num = i // batch_size + 1

            logger.info(f"Processing price batch {batch_num}/{total_batches} ({len(batch)} files)")

            results = await asyncio.gather(
                *[process_price_file(pf) for pf in batch],
                return_exceptions=True,
            )

            for result in results:
                stats["files_processed"] += 1
                if isinstance(result, Exception):
                    logger.error(f"Exception: {result}")
                    stats["errors"] += 1
                elif result.get("error"):
                    stats["errors"] += 1
                elif result.get("skipped"):
                    stats["skipped_cheap"] += 1
                else:
                    stats["prices_imported"] += result.get("prices", 0)
                    if result.get("created"):
                        stats["cards_created"] += 1
                    if result.get("updated"):
                        stats["cards_updated"] += 1

            # Commit after each batch
            try:
                db.commit()
            except Exception as e:
                logger.error(f"Commit error: {e}")
                db.rollback()
                stats["errors"] += 1

            if i + batch_size < len(price_files):
                await asyncio.sleep(0.5)

    logger.info(f"TCGdex price import complete: {stats}")
    return stats
