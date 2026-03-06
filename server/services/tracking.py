"""Card tracking service — determines which cards are in the tracked universe.

Tracked cards = blue chip curated list + collectible-rarity cards from recent sets.
We track ~1500 cards total: blue chips + any card with a chase/collectible rarity
from sets released in the last 5 years, plus any card valued >$2 from recent sets.
"""
import logging
from datetime import date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from server.models.card import Card
from server.models.card_set import CardSet
from server.models.price_history import PriceHistory
from server.config.blue_chips import BLUE_CHIP_TCG_IDS

logger = logging.getLogger(__name__)

RECENT_SET_DAYS = 1825  # 5 years
MIN_RECENT_PRICE = 2.0  # Only $2 floor for cards with known prices

# Rarities that indicate collectible/chase cards worth tracking
TRACKABLE_RARITIES = {
    # Modern chase rarities
    "Ultra Rare",
    "Secret Rare",
    "Special illustration rare",
    "Illustration rare",
    "Hyper Rare",
    "Double Rare",
    "ACE SPEC Rare",
    "Amazing Rare",
    "Shiny Rare",
    "Shiny Ultra Rare",
    "LEGEND",
    # EX/GX/V era
    "Rare Holo EX",
    "Rare Holo GX",
    "Rare Holo V",
    "Rare VMAX",
    "Rare VSTAR",
    "Rare Holo VMAX",
    "Rare Holo VSTAR",
    "Rare Ultra",
    "Rare Rainbow",
    "Rare Secret",
    "Rare Shiny",
    "Rare Shiny GX",
    "Rare Prism Star",
    "Radiant Rare",
    # Classic holos (vintage value)
    "Rare Holo",
    # Trainer gallery / full arts
    "Trainer Gallery Rare Holo",
    "Classic Collection",
}


def get_recent_set_ids(db: Session, days: int = RECENT_SET_DAYS) -> set[str]:
    """Get set IDs for sets released in the last N days."""
    cutoff = date.today() - timedelta(days=days)
    rows = db.query(CardSet.id).filter(CardSet.release_date >= cutoff).all()
    return {row[0] for row in rows}


def rebuild_tracked_cards(db: Session) -> dict:
    """Mark which cards should be tracked.

    1. Reset all cards to untracked
    2. Mark blue chip cards
    3. Mark collectible-rarity cards from recent sets (last 5 years)
    4. Mark any recent set card with current_price > $2
    """
    stats = {
        "blue_chip_marked": 0,
        "rarity_marked": 0,
        "price_marked": 0,
        "total_tracked": 0,
    }

    # Step 1: Reset all
    db.query(Card).update({Card.is_tracked: False}, synchronize_session=False)
    db.commit()

    # Step 2: Mark blue chips
    blue_chip_count = db.query(Card).filter(
        Card.tcg_id.in_(BLUE_CHIP_TCG_IDS)
    ).update({Card.is_tracked: True}, synchronize_session=False)
    db.commit()
    stats["blue_chip_marked"] = blue_chip_count

    # Log which blue chips are missing from the DB
    existing_ids = set(
        row[0] for row in db.query(Card.tcg_id)
        .filter(Card.tcg_id.in_(BLUE_CHIP_TCG_IDS)).all()
    )
    missing = BLUE_CHIP_TCG_IDS - existing_ids
    if missing:
        logger.warning(f"{len(missing)} blue chip cards not in DB: {sorted(missing)[:20]}...")

    # Step 3: Mark collectible-rarity cards from recent sets
    recent_set_ids = get_recent_set_ids(db)
    if recent_set_ids:
        rarity_count = db.query(Card).filter(
            Card.set_id.in_(recent_set_ids),
            Card.rarity.in_(TRACKABLE_RARITIES),
            Card.is_tracked == False,
        ).update({Card.is_tracked: True}, synchronize_session=False)
        db.commit()
        stats["rarity_marked"] = rarity_count
        logger.info(
            f"Marked {rarity_count} collectible-rarity cards from "
            f"{len(recent_set_ids)} recent sets"
        )

    # Step 4: Mark any remaining recent set card with known price > $2
    if recent_set_ids:
        price_count = db.query(Card).filter(
            Card.set_id.in_(recent_set_ids),
            Card.current_price > MIN_RECENT_PRICE,
            Card.is_tracked == False,
        ).update({Card.is_tracked: True}, synchronize_session=False)
        db.commit()
        stats["price_marked"] = price_count
        logger.info(f"Marked {price_count} additional cards with price >${MIN_RECENT_PRICE}")

    # Final count
    stats["total_tracked"] = db.query(Card).filter(Card.is_tracked == True).count()
    logger.info(f"Tracking rebuilt: {stats}")
    return stats


MIN_HISTORY_POINTS = 30  # Need 30+ price records for meaningful analysis
MAX_STALE_DAYS = 7       # Must have a price within last 7 days


def enforce_data_quality(db: Session) -> dict:
    """Untrack cards that lack complete market data.

    Removes from tracked universe:
    1. Cards with fewer than MIN_HISTORY_POINTS price history records
    2. Cards with no price data within the last MAX_STALE_DAYS days
    """
    stats = {"removed_thin": 0, "removed_stale": 0, "remaining": 0}
    cutoff_date = date.today() - timedelta(days=MAX_STALE_DAYS)

    tracked_cards = db.query(Card).filter(Card.is_tracked == True).all()

    for card in tracked_cards:
        history_count = db.query(func.count(PriceHistory.id)).filter(
            PriceHistory.card_id == card.id
        ).scalar()

        if history_count < MIN_HISTORY_POINTS:
            card.is_tracked = False
            stats["removed_thin"] += 1
            continue

        latest_date = db.query(func.max(PriceHistory.date)).filter(
            PriceHistory.card_id == card.id
        ).scalar()

        if not latest_date or latest_date < cutoff_date:
            card.is_tracked = False
            stats["removed_stale"] += 1
            continue

    db.commit()
    stats["remaining"] = db.query(Card).filter(Card.is_tracked == True).count()
    logger.info(f"Data quality enforcement: {stats}")
    return stats


def refresh_current_prices(db: Session) -> int:
    """Update Card.current_price from latest PriceHistory for all tracked cards.

    Fixes staleness where Card.current_price diverges from actual price history.
    """
    from sqlalchemy import text
    result = db.execute(text("""
        UPDATE cards SET current_price = (
            SELECT ph.market_price FROM price_history ph
            WHERE ph.card_id = cards.id AND ph.market_price IS NOT NULL
            ORDER BY ph.date DESC LIMIT 1
        )
        WHERE is_tracked = 1 AND (
            SELECT ph.market_price FROM price_history ph
            WHERE ph.card_id = cards.id AND ph.market_price IS NOT NULL
            ORDER BY ph.date DESC LIMIT 1
        ) IS NOT NULL
    """))
    db.commit()
    updated = result.rowcount
    logger.info(f"Refreshed current_price for {updated} tracked cards")
    return updated


def get_tracked_stats(db: Session) -> dict:
    """Get summary of current tracking state."""
    total_tracked = db.query(Card).filter(Card.is_tracked == True).count()
    total_untracked = db.query(Card).filter(Card.is_tracked == False).count()

    # Blue chip count
    blue_chip_count = db.query(Card).filter(
        Card.tcg_id.in_(BLUE_CHIP_TCG_IDS),
        Card.is_tracked == True,
    ).count()

    # Rarity breakdown
    from sqlalchemy import case
    rarity_counts = db.query(
        Card.rarity, func.count(Card.id)
    ).filter(Card.is_tracked == True).group_by(Card.rarity).all()

    # Recent sets
    recent_set_ids = get_recent_set_ids(db)
    recent_sets = []
    if recent_set_ids:
        sets = db.query(CardSet).filter(CardSet.id.in_(recent_set_ids)).order_by(
            CardSet.release_date.desc()
        ).all()
        for s in sets:
            tracked_in_set = db.query(Card).filter(
                Card.set_id == s.id, Card.is_tracked == True
            ).count()
            recent_sets.append({
                "id": s.id,
                "name": s.name,
                "release_date": s.release_date.isoformat() if s.release_date else None,
                "tracked_cards": tracked_in_set,
            })

    return {
        "total_tracked": total_tracked,
        "blue_chip_count": blue_chip_count,
        "recent_set_count": total_tracked - blue_chip_count,
        "total_untracked": total_untracked,
        "recent_sets": recent_sets,
        "blue_chip_total_defined": len(BLUE_CHIP_TCG_IDS),
        "rarity_breakdown": {r: c for r, c in rarity_counts},
    }
