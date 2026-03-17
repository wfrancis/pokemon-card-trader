import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from server.database import get_db
from server.models.price_alert import PriceAlert

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AlertCreate(BaseModel):
    card_id: int
    email: str
    threshold_above: float | None = None
    threshold_below: float | None = None


class AlertUpdate(BaseModel):
    threshold_above: float | None = None
    threshold_below: float | None = None
    is_active: bool | None = None


@router.post("")
def create_alert(body: AlertCreate, db: Session = Depends(get_db)):
    if not EMAIL_RE.match(body.email):
        raise HTTPException(400, "Invalid email format")
    if body.threshold_above is None and body.threshold_below is None:
        raise HTTPException(400, "At least one threshold required")

    # Upsert: deactivate existing alerts for same card+email, then create new
    existing = db.query(PriceAlert).filter(
        PriceAlert.card_id == body.card_id,
        PriceAlert.email == body.email,
        PriceAlert.is_active == True,
    ).all()
    for e in existing:
        e.is_active = False

    alert = PriceAlert(
        card_id=body.card_id,
        email=body.email,
        threshold_above=body.threshold_above,
        threshold_below=body.threshold_below,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return {
        "id": alert.id,
        "card_id": alert.card_id,
        "email": alert.email,
        "threshold_above": alert.threshold_above,
        "threshold_below": alert.threshold_below,
        "is_active": alert.is_active,
    }


@router.get("")
def list_alerts(
    email: str = Query(..., description="Email to list alerts for"),
    db: Session = Depends(get_db),
):
    alerts = db.query(PriceAlert).filter(
        PriceAlert.email == email,
        PriceAlert.is_active == True,
    ).all()
    return [
        {
            "id": a.id,
            "card_id": a.card_id,
            "email": a.email,
            "threshold_above": a.threshold_above,
            "threshold_below": a.threshold_below,
            "is_active": a.is_active,
        }
        for a in alerts
    ]


@router.delete("/{alert_id}")
def delete_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.query(PriceAlert).filter(PriceAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(404, "Alert not found")
    alert.is_active = False
    db.commit()
    return {"status": "deactivated"}


@router.put("/{alert_id}")
def update_alert(alert_id: int, body: AlertUpdate, db: Session = Depends(get_db)):
    alert = db.query(PriceAlert).filter(PriceAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(404, "Alert not found")
    if body.threshold_above is not None:
        alert.threshold_above = body.threshold_above
    if body.threshold_below is not None:
        alert.threshold_below = body.threshold_below
    if body.is_active is not None:
        alert.is_active = body.is_active
    db.commit()
    return {
        "id": alert.id,
        "card_id": alert.card_id,
        "threshold_above": alert.threshold_above,
        "threshold_below": alert.threshold_below,
        "is_active": alert.is_active,
    }
