"""Card tracking service — determines which cards are in the tracked universe.

Tracked cards = blue chip curated list + cards >$15 from sets released in last 36 months.
"""
import logging
from datetime import date, timedelta
from sqlalchemy.orm import Session
from server.models.card import Card
from server.models.card_set import CardSet
from server.config.blue_chips import BLUE_CHIP_TCG_IDS

logger = logging.getLogger(__name__)

RECENT_SET_DAYS = 1095  # 36 months
MIN_RECENT_PRICE = 15.0  # Only track recent cards valued >$15


def get_recent_set_ids(db: Session, days: int = RECENT_SET_DAYS) -> set[str]:
    """Get set IDs for sets released in the last N days."""
    cutoff = date.today() - timedelta(days=days)
    rows = db.query(CardSet.id).filter(CardSet.release_date >= cutoff).all()
    return {row[0] for row in rows}


def rebuild_tracked_cards(db: Session) -> dict:
    """Mark which cards should be tracked.

    1. Reset all cards to untracked
    2. Mark blue chip cards
    3. Mark cards >$15 from recent sets (last 36 months)
    """
    stats = {"blue_chip_marked": 0, "recent_set_marked": 0, "total_tracked": 0}

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

    # Step 3: Mark cards >$15 from recent sets
    recent_set_ids = get_recent_set_ids(db)
    if recent_set_ids:
        recent_count = db.query(Card).filter(
            Card.set_id.in_(recent_set_ids),
            Card.current_price > MIN_RECENT_PRICE,
            Card.is_tracked == False,  # Don't double-count blue chips
        ).update({Card.is_tracked: True}, synchronize_session=False)
        db.commit()
        stats["recent_set_marked"] = recent_count
        logger.info(f"Marked {recent_count} cards >$15 from {len(recent_set_ids)} recent sets")

    # Final count
    stats["total_tracked"] = db.query(Card).filter(Card.is_tracked == True).count()
    logger.info(f"Tracking rebuilt: {stats}")
    return stats


def get_tracked_stats(db: Session) -> dict:
    """Get summary of current tracking state."""
    total_tracked = db.query(Card).filter(Card.is_tracked == True).count()
    total_untracked = db.query(Card).filter(Card.is_tracked == False).count()

    # Blue chip count
    blue_chip_count = db.query(Card).filter(
        Card.tcg_id.in_(BLUE_CHIP_TCG_IDS),
        Card.is_tracked == True,
    ).count()

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
    }
