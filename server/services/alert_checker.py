import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from server.models.price_alert import PriceAlert
from server.models.card import Card
from server.services.email_service import send_price_alert_email, is_email_configured

logger = logging.getLogger(__name__)


def check_and_fire_alerts(db: Session) -> dict:
    """Check all active price alerts against current card prices and send emails."""
    if not is_email_configured():
        return {"checked": 0, "fired": 0, "skipped": "smtp_not_configured"}

    alerts = db.query(PriceAlert).filter(PriceAlert.is_active == True).all()
    if not alerts:
        return {"checked": 0, "fired": 0}

    # Batch fetch card prices
    card_ids = list({a.card_id for a in alerts})
    cards = {c.id: c for c in db.query(Card).filter(Card.id.in_(card_ids)).all()}

    fired = 0
    throttle_cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    for alert in alerts:
        card = cards.get(alert.card_id)
        if not card or not card.current_price:
            continue

        # Throttle: skip if triggered recently
        if alert.last_triggered_at and alert.last_triggered_at > throttle_cutoff:
            continue

        triggered_type = None
        triggered_value = None

        if alert.threshold_above and card.current_price >= alert.threshold_above:
            triggered_type = "above"
            triggered_value = alert.threshold_above
        elif alert.threshold_below and card.current_price <= alert.threshold_below:
            triggered_type = "below"
            triggered_value = alert.threshold_below

        if triggered_type:
            sent = send_price_alert_email(
                to_email=alert.email,
                card_name=card.name,
                card_id=card.id,
                current_price=card.current_price,
                threshold_type=triggered_type,
                threshold_value=triggered_value,
                card_image_url=card.image_small,
            )
            if sent:
                alert.is_active = False
                alert.last_triggered_at = datetime.now(timezone.utc)
                fired += 1

    db.commit()
    logger.info(f"Alert check: {len(alerts)} active, {fired} fired")
    return {"checked": len(alerts), "fired": fired}
