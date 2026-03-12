"""
Prediction Tracker — backfills actual prices on past predictions and computes accuracy metrics.

Called after each price sync to update pending predictions with real outcomes.
"""
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func

from server.models.agent_prediction import AgentPrediction
from server.models.price_history import PriceHistory
from server.models.card import Card

logger = logging.getLogger(__name__)

# Horizons to backfill: (column_name, days_offset)
HORIZONS = [
    ("price_7d", "return_pct_7d", 7),
    ("price_14d", None, 14),
    ("price_30d", "return_pct_30d", 30),
    ("price_60d", None, 60),
    ("price_90d", "return_pct_90d", 90),
]


def _get_price_near_date(db: Session, card_id: int, target_date, tolerance_days: int = 3) -> float | None:
    """Get the closest market price to target_date within tolerance window."""
    from datetime import date as date_type

    if isinstance(target_date, datetime):
        target_date = target_date.date()

    start = target_date - timedelta(days=tolerance_days)
    end = target_date + timedelta(days=tolerance_days)

    record = (
        db.query(PriceHistory)
        .filter(
            PriceHistory.card_id == card_id,
            PriceHistory.date >= start,
            PriceHistory.date <= end,
            PriceHistory.market_price.isnot(None),
        )
        .order_by(func.abs(func.julianday(PriceHistory.date) - func.julianday(target_date)))
        .first()
    )
    return record.market_price if record else None


def backfill_prediction_prices(db: Session) -> dict:
    """Update all pending predictions with actual prices where enough time has elapsed.

    Called after each price sync. For each pending prediction, check each horizon
    and fill in the actual price if we have data for that date.
    """
    now = datetime.now(timezone.utc)
    updated = 0
    outcomes_set = 0

    # Get all predictions that still have unfilled horizons
    predictions = (
        db.query(AgentPrediction)
        .filter(AgentPrediction.outcome == "pending")
        .all()
    )

    for pred in predictions:
        changed = False
        pred_time = pred.predicted_at
        if pred_time.tzinfo is None:
            pred_time = pred_time.replace(tzinfo=timezone.utc)

        for price_col, return_col, days in HORIZONS:
            # Skip if already filled
            if getattr(pred, price_col) is not None:
                continue

            # Check if enough time has elapsed
            target_date = pred_time + timedelta(days=days)
            if now < target_date:
                continue

            actual_price = _get_price_near_date(db, pred.card_id, target_date)
            if actual_price is None:
                continue

            setattr(pred, price_col, round(actual_price, 2))

            # Compute return percentage
            if return_col and pred.entry_price and pred.entry_price > 0:
                ret = ((actual_price - pred.entry_price) / pred.entry_price) * 100
                setattr(pred, return_col, round(ret, 2))

            changed = True

        # Determine outcome once we have 30d data
        if pred.price_30d is not None and pred.outcome == "pending":
            if pred.signal in ("buy", "accumulate"):
                # Correct if price went up
                pred.outcome = "correct" if pred.return_pct_30d > 0 else "incorrect"
            elif pred.signal == "hold":
                # Hold is correct if price stayed within ±10%
                pred.outcome = "correct" if abs(pred.return_pct_30d) < 10 else "incorrect"
            elif pred.signal == "watch":
                # Watch predictions don't have a clear right/wrong — mark as expired
                pred.outcome = "expired"
            outcomes_set += 1
            changed = True

        # Also check stop-loss and target hits using current price
        if pred.outcome == "pending":
            card = db.query(Card).filter_by(id=pred.card_id).first()
            if card and card.current_price:
                if pred.stop_loss and card.current_price <= pred.stop_loss:
                    pred.outcome = "incorrect"
                    outcomes_set += 1
                    changed = True
                elif pred.target_price and card.current_price >= pred.target_price:
                    pred.outcome = "correct"
                    outcomes_set += 1
                    changed = True

        if changed:
            updated += 1

    if updated > 0:
        db.commit()
        logger.info(f"Prediction backfill: updated {updated} predictions, {outcomes_set} outcomes resolved")

    return {"predictions_updated": updated, "outcomes_resolved": outcomes_set}


def get_accuracy_report(db: Session) -> dict:
    """Aggregate prediction accuracy across all dimensions.

    Returns hit rates by persona, tier, signal, and horizon.
    """
    # All resolved predictions (correct or incorrect, not pending/expired)
    resolved = (
        db.query(AgentPrediction)
        .filter(AgentPrediction.outcome.in_(["correct", "incorrect"]))
        .all()
    )

    pending_count = db.query(AgentPrediction).filter_by(outcome="pending").count()
    total_predictions = db.query(AgentPrediction).count()

    if not resolved:
        return {
            "total_predictions": total_predictions,
            "resolved": 0,
            "pending": pending_count,
            "overall_hit_rate": None,
            "by_persona": {},
            "by_signal": {},
            "by_tier": {},
            "recent_picks": [],
        }

    correct = [p for p in resolved if p.outcome == "correct"]
    overall_rate = round(len(correct) / len(resolved) * 100, 1) if resolved else 0

    # By persona
    by_persona = {}
    for persona in set(p.persona_source for p in resolved):
        persona_preds = [p for p in resolved if p.persona_source == persona]
        persona_correct = [p for p in persona_preds if p.outcome == "correct"]
        by_persona[persona] = {
            "total": len(persona_preds),
            "correct": len(persona_correct),
            "hit_rate": round(len(persona_correct) / len(persona_preds) * 100, 1),
        }

    # By signal
    by_signal = {}
    for signal in set(p.signal for p in resolved):
        signal_preds = [p for p in resolved if p.signal == signal]
        signal_correct = [p for p in signal_preds if p.outcome == "correct"]
        by_signal[signal] = {
            "total": len(signal_preds),
            "correct": len(signal_correct),
            "hit_rate": round(len(signal_correct) / len(signal_preds) * 100, 1),
        }

    # Best and worst picks (by 30d return)
    with_returns = [p for p in resolved if p.return_pct_30d is not None]
    best_pick = max(with_returns, key=lambda p: p.return_pct_30d) if with_returns else None
    worst_pick = min(with_returns, key=lambda p: p.return_pct_30d) if with_returns else None

    # Recent picks (last 20)
    recent = (
        db.query(AgentPrediction)
        .order_by(AgentPrediction.predicted_at.desc())
        .limit(20)
        .all()
    )

    def _pick_to_dict(p: AgentPrediction) -> dict:
        card = db.query(Card).filter_by(id=p.card_id).first()
        return {
            "id": p.id,
            "card_id": p.card_id,
            "card_name": card.name if card else "Unknown",
            "signal": p.signal,
            "persona_source": p.persona_source,
            "entry_price": p.entry_price,
            "current_price": card.current_price if card else None,
            "target_price": p.target_price,
            "stop_loss": p.stop_loss,
            "return_pct_7d": p.return_pct_7d,
            "return_pct_30d": p.return_pct_30d,
            "return_pct_90d": p.return_pct_90d,
            "outcome": p.outcome,
            "predicted_at": p.predicted_at.isoformat() + "Z" if p.predicted_at else None,
        }

    return {
        "total_predictions": total_predictions,
        "resolved": len(resolved),
        "pending": pending_count,
        "overall_hit_rate": overall_rate,
        "by_persona": by_persona,
        "by_signal": by_signal,
        "best_pick": _pick_to_dict(best_pick) if best_pick else None,
        "worst_pick": _pick_to_dict(worst_pick) if worst_pick else None,
        "recent_picks": [_pick_to_dict(p) for p in recent],
    }
