"""
Agent API routes — insights feed, agent status, and autonomous agent triggers.
"""
import json
import logging
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc

from server.database import get_db
from server.models.agent_insight import AgentInsight
from server.models.agent_prediction import AgentPrediction
from server.models.trader_snapshot import TraderAnalysisSnapshot
from server.services.prediction_tracker import get_accuracy_report

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.get("/insights")
async def list_insights(
    type: str | None = None,
    severity: str | None = None,
    acknowledged: bool | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """List agent insights, optionally filtered."""
    query = db.query(AgentInsight).order_by(desc(AgentInsight.created_at))
    if type:
        query = query.filter(AgentInsight.type == type)
    if severity:
        query = query.filter(AgentInsight.severity == severity)
    if acknowledged is not None:
        query = query.filter(AgentInsight.acknowledged == acknowledged)

    insights = query.limit(limit).all()
    return [
        {
            "id": i.id,
            "type": i.type,
            "severity": i.severity,
            "card_id": i.card_id,
            "title": i.title,
            "message": i.message,
            "metadata": json.loads(i.metadata_json) if i.metadata_json else None,
            "created_at": i.created_at.isoformat() + "Z",
            "acknowledged": i.acknowledged,
        }
        for i in insights
    ]


@router.post("/insights/{insight_id}/acknowledge")
async def acknowledge_insight(insight_id: int, db: Session = Depends(get_db)):
    """Mark an insight as acknowledged/read."""
    insight = db.query(AgentInsight).filter_by(id=insight_id).first()
    if not insight:
        return {"error": f"Insight #{insight_id} not found"}
    insight.acknowledged = True
    db.commit()
    return {"status": "acknowledged", "id": insight_id}


@router.get("/status")
async def agent_status(db: Session = Depends(get_db)):
    """Get agent health: last run, active predictions, accuracy summary."""
    # Last analysis snapshot
    last_snapshot = (
        db.query(TraderAnalysisSnapshot)
        .order_by(desc(TraderAnalysisSnapshot.created_at))
        .first()
    )

    # Active predictions
    active_predictions = (
        db.query(AgentPrediction)
        .filter(AgentPrediction.outcome == "pending")
        .count()
    )
    total_predictions = db.query(AgentPrediction).count()

    # Unread insights
    unread_insights = (
        db.query(AgentInsight)
        .filter(AgentInsight.acknowledged == False)
        .count()
    )

    # Quick accuracy
    accuracy = get_accuracy_report(db)

    return {
        "last_analysis_at": last_snapshot.created_at.isoformat() + "Z" if last_snapshot else None,
        "active_predictions": active_predictions,
        "total_predictions": total_predictions,
        "unread_insights": unread_insights,
        "overall_hit_rate": accuracy.get("overall_hit_rate"),
        "resolved_predictions": accuracy.get("resolved", 0),
    }
