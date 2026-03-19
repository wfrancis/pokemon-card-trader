"""Data quality audit system for detecting and fixing pricing anomalies.

Checks the top N most expensive cards for issues like:
- Price far exceeding median sold price (likely wrong variant)
- Modern commons/uncommons tracking expensive variant
- Stale price data (no updates in 14+ days)
- Expensive cards with zero sales
- Condition price inversions (LP > NM)
- Extreme price changes (>500% or <-90% in 7 days)
"""
import logging
from datetime import date, timedelta, datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from server.models.card import Card
from server.models.sale import Sale
from server.models.price_history import PriceHistory

logger = logging.getLogger(__name__)

# Modern sets started around 2020 (Sword & Shield era)
MODERN_SET_CUTOFF_YEAR = 2020

# Rarities that should NOT have expensive holofoil variants
COMMON_RARITIES = {"Common", "Uncommon"}

# Preferred variant for common/uncommon modern cards
DEFAULT_MODERN_VARIANT = "normal"

# Preferred variant for rare/holo vintage cards
DEFAULT_VINTAGE_VARIANT = "holofoil"


def _get_median_sold(db: Session, card_id: int, days: int = 90) -> tuple[float | None, int]:
    """Get median sale price and sale count for a card in the last N days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    sales = (
        db.query(Sale.purchase_price)
        .filter(
            Sale.card_id == card_id,
            Sale.order_date >= cutoff,
            Sale.purchase_price > 0,
        )
        .order_by(Sale.purchase_price)
        .all()
    )
    if not sales:
        return None, 0
    prices = [s[0] for s in sales]
    count = len(prices)
    mid = count // 2
    if count % 2 == 0:
        median_val = (prices[mid - 1] + prices[mid]) / 2
    else:
        median_val = prices[mid]
    return round(median_val, 2), count


def _is_modern_set(set_id: str, db: Session) -> bool:
    """Check if a set is from 2020 or later based on set_id patterns or DB data."""
    from server.models.card_set import CardSet
    card_set = db.query(CardSet).filter(CardSet.id == set_id).first()
    if card_set and card_set.release_date:
        return card_set.release_date.year >= MODERN_SET_CUTOFF_YEAR
    return False


def _get_7d_price_change(db: Session, card_id: int, variant: str | None) -> float | None:
    """Calculate 7-day price change percentage."""
    today = date.today()
    week_ago = today - timedelta(days=7)

    variant = variant or "normal"

    latest = (
        db.query(PriceHistory.market_price)
        .filter(
            PriceHistory.card_id == card_id,
            PriceHistory.variant == variant,
            PriceHistory.market_price.isnot(None),
        )
        .order_by(PriceHistory.date.desc())
        .first()
    )

    older = (
        db.query(PriceHistory.market_price)
        .filter(
            PriceHistory.card_id == card_id,
            PriceHistory.variant == variant,
            PriceHistory.date <= week_ago,
            PriceHistory.market_price.isnot(None),
        )
        .order_by(PriceHistory.date.desc())
        .first()
    )

    if not latest or not older or not older[0] or older[0] == 0:
        return None

    return round(((latest[0] - older[0]) / older[0]) * 100, 2)


def audit_top_cards(db: Session, limit: int = 100) -> dict:
    """Check the top N most expensive cards for data quality issues.

    Returns a structured report of issues found, grouped by category.
    """
    top_cards = (
        db.query(Card)
        .filter(Card.current_price.isnot(None), Card.current_price > 0)
        .order_by(Card.current_price.desc())
        .limit(limit)
        .all()
    )

    categories = {
        "price_median_mismatch": [],
        "likely_wrong_variant": [],
        "stale_data": [],
        "zero_sales_expensive": [],
        "condition_inversions": [],
        "extreme_changes": [],
    }

    today = date.today()
    stale_cutoff = today - timedelta(days=14)

    for card in top_cards:
        card_info = {
            "card_id": card.id,
            "name": card.name,
            "set": card.set_name,
            "rarity": card.rarity,
            "current_price": card.current_price,
            "price_variant": card.price_variant,
        }

        # --- (a) Price-Median Mismatch ---
        median_sold, sales_count = _get_median_sold(db, card.id, days=90)
        if (
            median_sold is not None
            and median_sold > 0
            and sales_count > 5
            and card.current_price > 10 * median_sold
        ):
            ratio = round(card.current_price / median_sold, 1)
            categories["price_median_mismatch"].append({
                **card_info,
                "median_sold": median_sold,
                "sales_count": sales_count,
                "issue": f"Price is {ratio}x median",
            })

        # --- (b) Variant Mismatch Detection ---
        if (
            card.rarity in COMMON_RARITIES
            and card.price_variant in ("holofoil", "reverseHolofoil")
            and _is_modern_set(card.set_id, db)
        ):
            categories["likely_wrong_variant"].append({
                **card_info,
                "issue": f"{card.rarity} card tracking '{card.price_variant}' variant (should be 'normal')",
            })

        # --- (c) Stale Price Data ---
        latest_ph = (
            db.query(func.max(PriceHistory.date))
            .filter(PriceHistory.card_id == card.id)
            .scalar()
        )
        if latest_ph and latest_ph < stale_cutoff:
            days_stale = (today - latest_ph).days
            categories["stale_data"].append({
                **card_info,
                "latest_price_date": latest_ph.isoformat(),
                "days_stale": days_stale,
                "issue": f"No price update in {days_stale} days",
            })

        # --- (d) Zero Sales Expensive Cards ---
        if card.current_price and card.current_price > 20:
            if sales_count == 0:
                categories["zero_sales_expensive"].append({
                    **card_info,
                    "issue": f"${card.current_price:.2f} card with 0 sales in 90 days",
                })

        # --- (e) Condition Price Inversions ---
        # Check if LP price > NM price by >20%
        variant = card.price_variant or "normal"
        nm_price = (
            db.query(PriceHistory.market_price)
            .filter(
                PriceHistory.card_id == card.id,
                PriceHistory.variant == variant,
                PriceHistory.condition == "Near Mint",
                PriceHistory.market_price.isnot(None),
            )
            .order_by(PriceHistory.date.desc())
            .first()
        )
        lp_price = (
            db.query(PriceHistory.market_price)
            .filter(
                PriceHistory.card_id == card.id,
                PriceHistory.variant == variant,
                PriceHistory.condition == "Lightly Played",
                PriceHistory.market_price.isnot(None),
            )
            .order_by(PriceHistory.date.desc())
            .first()
        )
        if nm_price and lp_price and nm_price[0] and lp_price[0]:
            if lp_price[0] > nm_price[0] * 1.2:
                categories["condition_inversions"].append({
                    **card_info,
                    "nm_price": nm_price[0],
                    "lp_price": lp_price[0],
                    "issue": f"LP (${lp_price[0]:.2f}) > NM (${nm_price[0]:.2f}) by {round((lp_price[0] / nm_price[0] - 1) * 100)}%",
                })

        # --- (f) Extreme Price Changes ---
        change_7d = _get_7d_price_change(db, card.id, card.price_variant)
        if change_7d is not None:
            if change_7d > 500 or change_7d < -90:
                categories["extreme_changes"].append({
                    **card_info,
                    "change_7d_pct": change_7d,
                    "issue": f"7-day change: {change_7d:+.1f}%",
                })

    total_issues = sum(len(v) for v in categories.values())

    return {
        "total_cards_checked": len(top_cards),
        "issues_found": total_issues,
        "categories": categories,
    }


async def fix_variant_mismatches(db: Session) -> dict:
    """Fix cards where the tracked variant appears wrong.

    For modern common/uncommon cards tracking holofoil/reverseHolofoil,
    queries the Pokemon TCG API for all price variants and switches to
    the correct one (usually 'normal' for commons).

    For vintage rare/holo cards, prefers 'holofoil'.

    Returns stats on what was changed.
    """
    import httpx

    stats = {
        "cards_checked": 0,
        "cards_fixed": 0,
        "changes": [],
        "errors": [],
    }

    # Find candidates: modern common/uncommon cards with expensive non-normal variants
    from server.models.card_set import CardSet
    modern_sets = (
        db.query(CardSet.id)
        .filter(CardSet.release_date >= date(MODERN_SET_CUTOFF_YEAR, 1, 1))
        .all()
    )
    modern_set_ids = {row[0] for row in modern_sets}

    if not modern_set_ids:
        return {**stats, "message": "No modern sets found"}

    candidates = (
        db.query(Card)
        .filter(
            Card.set_id.in_(modern_set_ids),
            Card.rarity.in_(COMMON_RARITIES),
            Card.price_variant.in_(["holofoil", "reverseHolofoil"]),
            Card.current_price > 5,  # Only fix cards that appear expensive
        )
        .all()
    )

    if not candidates:
        return {**stats, "message": "No variant mismatch candidates found"}

    async with httpx.AsyncClient(
        timeout=30.0,
        headers={"User-Agent": "PokemonCardTrader/1.0"},
    ) as client:
        for card in candidates:
            stats["cards_checked"] += 1
            try:
                # Fetch card data from Pokemon TCG API to get all variant prices
                resp = await client.get(
                    f"https://api.pokemontcg.io/v2/cards/{card.tcg_id}"
                )
                if resp.status_code != 200:
                    stats["errors"].append({
                        "card_id": card.id,
                        "name": card.name,
                        "error": f"API returned {resp.status_code}",
                    })
                    continue

                data = resp.json().get("data", {})
                tcgplayer = data.get("tcgplayer", {})
                prices = tcgplayer.get("prices", {})

                if not prices:
                    continue

                # For common/uncommon modern cards, prefer 'normal'
                preferred_variant = DEFAULT_MODERN_VARIANT
                if card.rarity not in COMMON_RARITIES:
                    preferred_variant = DEFAULT_VINTAGE_VARIANT

                # Check if preferred variant has a price
                if preferred_variant in prices and prices[preferred_variant].get("market"):
                    new_price = prices[preferred_variant]["market"]
                    old_variant = card.price_variant
                    old_price = card.current_price

                    card.price_variant = preferred_variant
                    card.current_price = new_price

                    change = {
                        "card_id": card.id,
                        "name": card.name,
                        "set": card.set_name,
                        "rarity": card.rarity,
                        "old_variant": old_variant,
                        "old_price": old_price,
                        "new_variant": preferred_variant,
                        "new_price": new_price,
                    }
                    stats["changes"].append(change)
                    stats["cards_fixed"] += 1
                    logger.info(
                        f"Fixed variant for {card.name} ({card.set_name}): "
                        f"{old_variant} ${old_price} -> {preferred_variant} ${new_price}"
                    )
                else:
                    # Find any variant with a reasonable price
                    best_variant = None
                    best_price = None
                    for v_name, v_data in prices.items():
                        mp = v_data.get("market")
                        if mp and mp > 0:
                            if best_price is None or mp < best_price:
                                best_variant = v_name
                                best_price = mp

                    if best_variant and best_variant != card.price_variant:
                        old_variant = card.price_variant
                        old_price = card.current_price
                        card.price_variant = best_variant
                        card.current_price = best_price

                        change = {
                            "card_id": card.id,
                            "name": card.name,
                            "set": card.set_name,
                            "rarity": card.rarity,
                            "old_variant": old_variant,
                            "old_price": old_price,
                            "new_variant": best_variant,
                            "new_price": best_price,
                        }
                        stats["changes"].append(change)
                        stats["cards_fixed"] += 1

                import asyncio
                await asyncio.sleep(0.5)  # Rate limit API calls

            except Exception as e:
                stats["errors"].append({
                    "card_id": card.id,
                    "name": card.name,
                    "error": str(e),
                })
                logger.error(f"Error fixing variant for {card.name}: {e}")

    db.commit()
    logger.info(f"Variant fix complete: {stats['cards_fixed']} fixed out of {stats['cards_checked']} checked")
    return stats
