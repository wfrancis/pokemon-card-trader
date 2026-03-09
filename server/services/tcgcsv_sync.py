"""TCGCSV price sync service.

Uses tcgcsv.com — a free CDN-cached mirror of TCGPlayer's catalog.
Updates daily at ~20:00 UTC. No API key required.

Endpoints:
  GET /tcgplayer/3/groups                  → all 214 Pokemon groups (sets)
  GET /tcgplayer/3/{groupId}/products      → all products in a group
  GET /tcgplayer/3/{groupId}/prices        → all prices in a group

Critical: CloudFront returns 403 without Origin header.
Prices are in USD (not cents).
"""
import httpx
import logging
import asyncio
import re
from datetime import date, datetime, timezone
from sqlalchemy.orm import Session
from server.models.card import Card
from server.models.price_history import PriceHistory

logger = logging.getLogger(__name__)

TCGCSV_BASE = "https://tcgcsv.com/tcgplayer/3"

# Required — CloudFront blocks requests without Origin header
HEADERS = {
    "User-Agent": "PokemonCardTrader/1.0",
    "Origin": "https://tcgcsv.com",
    "Accept": "application/json",
}

# TCGCSV subTypeName → our variant string
VARIANT_MAP = {
    "Normal": "normal",
    "Holofoil": "holofoil",
    "Reverse Holofoil": "reverseHolofoil",
    "1st Edition Holofoil": "1stEditionHolofoil",
    "1st Edition Normal": "1stEditionNormal",
    "1st Edition": "1stEditionNormal",
    "Unlimited Holofoil": "unlimitedHolofoil",
    "Unlimited Normal": "unlimited",
    "Unlimited": "unlimited",
}

# Variant selection priority (higher = preferred)
VARIANT_PRIORITY = {
    "holofoil": 6,
    "1stEditionHolofoil": 5,
    "unlimitedHolofoil": 4,
    "reverseHolofoil": 3,
    "normal": 2,
    "1stEditionNormal": 1,
    "unlimited": 0,
}


def _normalize_card_number(tcgcsv_number: str) -> str:
    """Normalize TCGCSV card number to match our DB format.

    "007/165" → "7"
    "SV107"   → "SV107"
    "TG15/TG30" → "TG15"
    "0"       → "0"
    """
    if not tcgcsv_number:
        return ""
    # Split on "/" and take the first part
    num = tcgcsv_number.split("/")[0].strip()
    # Strip leading zeros from purely numeric strings: "007" → "7", but keep "0"
    match = re.match(r"^0*(\d+)$", num)
    if match:
        return match.group(1) or "0"
    # Alphanumeric like "SV107" or "TG15" — return as-is
    return num


def _normalize_set_name(name: str) -> str:
    """Normalize TCGCSV group name for matching.

    "SV03: Obsidian Flames" → "obsidian flames"
    "SWSH07: Evolving Skies" → "evolving skies"
    "Base Set" → "base set"
    """
    name = name.strip()
    if ": " in name:
        name = name.split(": ", 1)[1]
    return name.lower().strip()


def _pick_best_price(entries: list[dict], preferred_variant: str | None) -> dict | None:
    """Pick the best price entry from multiple subType entries for one product.

    Priority:
    1. If card already has a price_variant, prefer matching subType
    2. Otherwise, highest priority variant with a non-null marketPrice
    """
    if not entries:
        return None

    # Map our variant names back to TCGCSV subTypeNames
    reverse_map = {v: k for k, v in VARIANT_MAP.items()}
    preferred_sub = reverse_map.get(preferred_variant, "")

    # Try preferred variant first
    if preferred_sub:
        for e in entries:
            if e.get("subTypeName") == preferred_sub and e.get("marketPrice") is not None:
                return e

    # Fall back to priority ordering
    def score(entry):
        variant = VARIANT_MAP.get(entry.get("subTypeName", ""), "normal")
        has_market = 1 if entry.get("marketPrice") is not None else 0
        return (has_market, VARIANT_PRIORITY.get(variant, 0))

    entries_sorted = sorted(entries, key=score, reverse=True)
    return entries_sorted[0] if entries_sorted else None


async def _fetch_groups(client: httpx.AsyncClient) -> list[dict]:
    """Fetch all Pokemon groups (sets) from TCGCSV."""
    try:
        resp = await client.get(f"{TCGCSV_BASE}/groups", headers=HEADERS)
        resp.raise_for_status()
        data = resp.json()
        return data.get("results", data if isinstance(data, list) else [])
    except Exception as e:
        logger.error(f"Failed to fetch TCGCSV groups: {e}")
        return []


# ---------------------------------------------------------------------------
# One-time mapping: TCGCSV productId → our Card records
# ---------------------------------------------------------------------------


async def sync_tcgcsv_mapping(db: Session) -> dict:
    """Build the TCGCSV productId mapping for all cards in our DB.

    Fetches all groups + products from TCGCSV, matches to our cards
    by (set_name + card_number), and stores the productId permanently.

    Returns stats dict.
    """
    stats = {
        "groups_fetched": 0,
        "groups_matched": 0,
        "products_fetched": 0,
        "cards_mapped": 0,
        "cards_already_mapped": 0,
        "cards_unmatched": 0,
        "errors": 0,
    }

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        # 1. Fetch all groups
        groups = await _fetch_groups(client)
        stats["groups_fetched"] = len(groups)
        if not groups:
            return stats

        # 2. Build our DB set_name → set_id lookup
        db_sets = db.query(Card.set_name, Card.set_id).distinct().all()
        our_sets: dict[str, list[str]] = {}
        for set_name, set_id in db_sets:
            if set_name:
                key = set_name.lower().strip()
                our_sets.setdefault(key, []).append(set_id)

        # 3. Match TCGCSV groups to our sets
        group_to_set_ids: dict[int, list[str]] = {}
        for g in groups:
            normalized = _normalize_set_name(g["name"])
            if normalized in our_sets:
                group_to_set_ids[g["groupId"]] = our_sets[normalized]
                stats["groups_matched"] += 1

        logger.info(
            f"TCGCSV mapping: {stats['groups_matched']}/{stats['groups_fetched']} "
            f"groups matched to our {len(our_sets)} sets"
        )

        # 4. Fetch products for each matched group and map to our cards
        sem = asyncio.Semaphore(5)  # Conservative for Fly VM

        async def process_group(group_id: int, set_ids: list[str]):
            async with sem:
                try:
                    resp = await client.get(
                        f"{TCGCSV_BASE}/{group_id}/products",
                        headers=HEADERS,
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    products = data.get("results", [])
                except Exception as e:
                    logger.error(f"Failed to fetch products for group {group_id}: {e}")
                    stats["errors"] += 1
                    return

            stats["products_fetched"] += len(products)

            for product in products:
                ext_data = {
                    e["name"]: e["value"]
                    for e in (product.get("extendedData") or [])
                }
                tcgcsv_number = ext_data.get("Number")
                if not tcgcsv_number:
                    continue  # Sealed product, skip

                normalized_num = _normalize_card_number(tcgcsv_number)
                product_id = product["productId"]
                product_name = product.get("name", "")

                # Find matching card by set_id + number
                card = None
                for set_id in set_ids:
                    card = (
                        db.query(Card)
                        .filter(Card.set_id == set_id, Card.number == normalized_num)
                        .first()
                    )
                    if card:
                        break

                # Fallback: match by name within matched sets
                if not card:
                    clean_name = re.sub(r"\s*-\s*\d+/\d+$", "", product_name).strip()
                    for set_id in set_ids:
                        card = (
                            db.query(Card)
                            .filter(Card.set_id == set_id, Card.name == clean_name)
                            .first()
                        )
                        if card:
                            break

                if card:
                    if card.tcgplayer_product_id:
                        stats["cards_already_mapped"] += 1
                    else:
                        card.tcgplayer_product_id = product_id
                        stats["cards_mapped"] += 1
                else:
                    stats["cards_unmatched"] += 1

        # Process groups in batches
        matched_groups = list(group_to_set_ids.items())
        batch_size = 10
        for i in range(0, len(matched_groups), batch_size):
            batch = matched_groups[i : i + batch_size]
            await asyncio.gather(
                *[process_group(gid, sids) for gid, sids in batch],
                return_exceptions=True,
            )
            try:
                db.commit()
                logger.info(
                    f"Mapping progress: {i + len(batch)}/{len(matched_groups)} groups, "
                    f"{stats['cards_mapped']} mapped"
                )
            except Exception as e:
                logger.error(f"Commit error during mapping: {e}")
                db.rollback()
                stats["errors"] += 1

            await asyncio.sleep(0.2)

    logger.info(f"TCGCSV mapping complete: {stats}")
    return stats


# ---------------------------------------------------------------------------
# Daily price sync: fetch bulk prices for all mapped cards
# ---------------------------------------------------------------------------


async def sync_tcgcsv_prices(db: Session) -> dict:
    """Daily bulk price sync from TCGCSV for all mapped+tracked cards.

    Fetches prices for all 214 groups (~214 HTTP requests), matches
    to our cards by tcgplayer_product_id, and updates prices.

    Returns stats dict.
    """
    stats = {
        "groups_fetched": 0,
        "price_entries_loaded": 0,
        "cards_checked": 0,
        "prices_updated": 0,
        "prices_recorded": 0,
        "no_price": 0,
        "skipped_sanity": 0,
        "errors": 0,
    }

    today = date.today()

    # 1. Get all cards with a product ID mapping
    mapped_cards = (
        db.query(Card)
        .filter(Card.tcgplayer_product_id.isnot(None), Card.is_tracked == True)
        .all()
    )

    if not mapped_cards:
        logger.info("No mapped+tracked cards for TCGCSV price sync")
        return stats

    # Build productId → card lookup
    product_to_card: dict[int, Card] = {}
    for card in mapped_cards:
        product_to_card[card.tcgplayer_product_id] = card

    stats["cards_checked"] = len(mapped_cards)
    logger.info(f"TCGCSV price sync: {len(mapped_cards)} mapped+tracked cards")

    # 2. Fetch prices for all groups
    all_prices: dict[int, list[dict]] = {}  # productId → price entries

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        groups = await _fetch_groups(client)

        sem = asyncio.Semaphore(10)  # CDN-backed, can handle more concurrency

        async def fetch_group_prices(group_id: int):
            async with sem:
                try:
                    resp = await client.get(
                        f"{TCGCSV_BASE}/{group_id}/prices",
                        headers=HEADERS,
                    )
                    if resp.status_code != 200:
                        return []
                    data = resp.json()
                    return data.get("results", [])
                except Exception as e:
                    logger.error(f"Failed to fetch prices for group {group_id}: {e}")
                    stats["errors"] += 1
                    return []

        # Fetch in batches of 20
        batch_size = 20
        for i in range(0, len(groups), batch_size):
            batch = groups[i : i + batch_size]
            results = await asyncio.gather(
                *[fetch_group_prices(g["groupId"]) for g in batch],
                return_exceptions=True,
            )

            for result in results:
                if isinstance(result, Exception):
                    stats["errors"] += 1
                    continue
                if not isinstance(result, list):
                    continue

                stats["groups_fetched"] += 1
                for entry in result:
                    pid = entry.get("productId")
                    if pid and pid in product_to_card:
                        all_prices.setdefault(pid, []).append(entry)
                        stats["price_entries_loaded"] += 1

    logger.info(
        f"TCGCSV prices loaded: {stats['groups_fetched']} groups, "
        f"{stats['price_entries_loaded']} relevant price entries"
    )

    # 3. Update cards and price history
    commit_batch = 0
    for product_id, price_entries in all_prices.items():
        card = product_to_card[product_id]

        # Pick best price entry
        best_entry = _pick_best_price(price_entries, card.price_variant)
        if not best_entry:
            stats["no_price"] += 1
            continue

        market_price = best_entry.get("marketPrice")
        if market_price is None or market_price <= 0:
            market_price = best_entry.get("midPrice")
        if not market_price or market_price <= 0:
            stats["no_price"] += 1
            continue

        # Sanity check: reject >3x swings (matches tcgplayer_sync.py pattern)
        if card.current_price and card.current_price > 0:
            ratio = market_price / card.current_price
            if ratio < 0.33 or ratio > 3.0:
                logger.warning(
                    f"TCGCSV sanity skip: {card.name} ({card.set_name} #{card.number}) "
                    f"${card.current_price:.2f} → ${market_price:.2f} (ratio {ratio:.2f})"
                )
                stats["skipped_sanity"] += 1
                continue

        # Update card
        variant = VARIANT_MAP.get(best_entry.get("subTypeName", ""), "normal")
        card.current_price = round(market_price, 2)
        card.price_variant = variant
        card.updated_at = datetime.now(timezone.utc)
        stats["prices_updated"] += 1

        # Record price history (dedup by card_id + date)
        existing = (
            db.query(PriceHistory)
            .filter(PriceHistory.card_id == card.id, PriceHistory.date == today)
            .first()
        )

        if not existing:
            low = best_entry.get("lowPrice")
            mid = best_entry.get("midPrice")
            high = best_entry.get("highPrice")
            db.add(
                PriceHistory(
                    card_id=card.id,
                    date=today,
                    variant=variant,
                    market_price=round(market_price, 2),
                    low_price=round(low, 2) if low else None,
                    mid_price=round(mid, 2) if mid else None,
                    high_price=round(high, 2) if high else None,
                )
            )
            stats["prices_recorded"] += 1

        # Batch commit every 50 cards
        commit_batch += 1
        if commit_batch >= 50:
            try:
                db.commit()
            except Exception as e:
                logger.error(f"Batch commit error: {e}")
                db.rollback()
                stats["errors"] += 1
            commit_batch = 0

    # Final commit
    try:
        db.commit()
    except Exception as e:
        logger.error(f"Final commit error: {e}")
        db.rollback()
        stats["errors"] += 1

    # Refresh current prices from latest history
    try:
        from server.services.tracking import refresh_current_prices

        refresh_current_prices(db)
    except Exception as e:
        logger.error(f"Failed to refresh current prices: {e}")

    logger.info(f"TCGCSV price sync complete: {stats}")
    return stats
