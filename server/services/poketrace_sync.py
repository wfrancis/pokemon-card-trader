"""
Sync card data and price history from the PokeTrace API.

PokeTrace: https://api.poketrace.com/v1
- Free tier: 250 requests/day
- Requires API key via X-Api-Key header
- Has /cards/{id}/prices/{tier}/history endpoint for historical prices

API key must be set via POKETRACE_API_KEY environment variable.
"""
import httpx
import json
import logging
import asyncio
import os
from datetime import date, datetime, timezone
from sqlalchemy.orm import Session
from server.models.card import Card
from server.models.price_history import PriceHistory

logger = logging.getLogger(__name__)

POKETRACE_API = "https://api.poketrace.com/v1"


def _get_api_key() -> str | None:
    """Get PokeTrace API key from environment."""
    return os.environ.get("POKETRACE_API_KEY")


async def _fetch_with_retry(
    client: httpx.AsyncClient,
    url: str,
    retries: int = 3,
    params: dict | None = None,
) -> httpx.Response | None:
    """Fetch with exponential backoff. Returns None on persistent failure."""
    for attempt in range(retries):
        try:
            resp = await client.get(url, params=params)
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 2 ** attempt))
                logger.warning(f"PokeTrace rate limited, waiting {retry_after}s")
                await asyncio.sleep(retry_after)
                continue
            if resp.status_code == 404:
                return None
            if resp.status_code == 401:
                logger.error("PokeTrace API key invalid or missing")
                return None
            resp.raise_for_status()
            return resp
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout) as e:
            if attempt < retries - 1:
                await asyncio.sleep(2 ** attempt)
                logger.warning(f"PokeTrace request failed (attempt {attempt+1}): {e}")
            else:
                logger.error(f"PokeTrace request failed after {retries} attempts: {e}")
                return None
    return None


async def sync_poketrace_prices(
    db: Session,
    card_ids: list[str] | None = None,
    tier: str = "tcgplayer",
) -> dict:
    """Fetch price history from PokeTrace API for cards in our database.

    Args:
        db: SQLAlchemy session.
        card_ids: Optional list of tcg_id values. If None, processes all cards.
        tier: Price tier to fetch: "tcgplayer" or "cardmarket".

    Returns:
        Stats dict.
    """
    stats = {
        "cards_processed": 0,
        "prices_imported": 0,
        "cards_not_found": 0,
        "errors": 0,
        "api_key_missing": False,
    }

    api_key = _get_api_key()
    if not api_key:
        logger.warning("POKETRACE_API_KEY not set, skipping PokeTrace sync")
        stats["api_key_missing"] = True
        return stats

    # Get cards from DB
    if card_ids:
        cards = db.query(Card).filter(Card.tcg_id.in_(card_ids)).all()
    else:
        cards = db.query(Card).all()

    if not cards:
        logger.info("No cards in database for PokeTrace sync")
        return stats

    logger.info(f"Fetching PokeTrace price history for {len(cards)} cards (tier={tier})")

    async with httpx.AsyncClient(
        timeout=30.0,
        headers={
            "X-Api-Key": api_key,
            "User-Agent": "PokemonCardTrader/1.0",
        },
        follow_redirects=True,
    ) as client:
        # Process cards with rate limiting (250 req/day = be conservative)
        for card in cards:
            stats["cards_processed"] += 1

            # PokeTrace uses Pokemon TCG API-style IDs
            url = f"{POKETRACE_API}/cards/{card.tcg_id}/prices/{tier}/history"
            resp = await _fetch_with_retry(client, url)

            if resp is None:
                stats["cards_not_found"] += 1
                continue

            try:
                data = resp.json()
                price_entries = data if isinstance(data, list) else data.get("data", data.get("prices", []))

                if not isinstance(price_entries, list):
                    stats["cards_not_found"] += 1
                    continue

                # Get existing prices to avoid duplicates
                existing = set(
                    (row.date, row.variant)
                    for row in db.query(PriceHistory.date, PriceHistory.variant)
                    .filter(PriceHistory.card_id == card.id)
                    .all()
                )

                new_count = 0
                latest_price = None
                latest_date = None

                for entry in price_entries:
                    if not isinstance(entry, dict):
                        continue

                    date_str = entry.get("date") or entry.get("updatedAt") or ""
                    try:
                        if "T" in str(date_str):
                            price_date = datetime.fromisoformat(
                                str(date_str).replace("Z", "+00:00")
                            ).date()
                        else:
                            price_date = datetime.strptime(str(date_str), "%Y-%m-%d").date()
                    except (ValueError, TypeError):
                        continue

                    variant = entry.get("variant", card.price_variant or "normal")
                    market = entry.get("market") or entry.get("price") or entry.get("market_price")
                    if market is not None:
                        try:
                            market = float(market)
                        except (ValueError, TypeError):
                            continue
                    else:
                        continue

                    if (price_date, variant) in existing:
                        continue

                    low = _safe_float(entry.get("low"))
                    mid = _safe_float(entry.get("mid"))
                    high = _safe_float(entry.get("high"))

                    db.add(PriceHistory(
                        card_id=card.id,
                        date=price_date,
                        variant=variant,
                        market_price=market,
                        low_price=low,
                        mid_price=mid,
                        high_price=high,
                    ))
                    new_count += 1
                    existing.add((price_date, variant))

                    if latest_date is None or price_date > latest_date:
                        latest_date = price_date
                        latest_price = market

                if new_count > 0:
                    stats["prices_imported"] += new_count
                    if latest_price and latest_date:
                        card.current_price = latest_price
                        card.updated_at = datetime.now(timezone.utc)

            except Exception as e:
                logger.error(f"Error processing PokeTrace data for {card.tcg_id}: {e}")
                stats["errors"] += 1

            # Rate limit: pause between requests (250/day ≈ 1 every 6 min, but burst OK)
            await asyncio.sleep(0.5)

            # Commit every 25 cards
            if stats["cards_processed"] % 25 == 0:
                try:
                    db.commit()
                except Exception as e:
                    logger.error(f"Error committing PokeTrace batch: {e}")
                    db.rollback()

        # Final commit
        try:
            db.commit()
        except Exception as e:
            logger.error(f"Error in final PokeTrace commit: {e}")
            db.rollback()

    logger.info(f"PokeTrace sync complete: {stats}")
    return stats


def _safe_float(value) -> float | None:
    """Safely convert to float."""
    if value is None:
        return None
    try:
        result = float(value)
        return result if result >= 0 else None
    except (ValueError, TypeError):
        return None
