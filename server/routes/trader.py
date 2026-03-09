import json
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from server.database import get_db
from server.models.trader_snapshot import TraderAnalysisSnapshot
from server.services.trader_agent import (
    get_trader_analysis, get_card_trader_analysis, get_multi_persona_analysis,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/trader", tags=["trader"])


@router.get("/analysis")
async def trader_market_analysis(db: Session = Depends(get_db)):
    """Get the AI trader's full market analysis (legacy single persona)."""
    return await get_trader_analysis(db)


@router.get("/personas")
async def trader_personas_analysis(db: Session = Depends(get_db)):
    """Get multi-persona AI trading desk analysis (3 traders + consensus)."""
    result = await get_multi_persona_analysis(db)

    # Auto-save successful results
    if not result.get("error"):
        try:
            snapshot = TraderAnalysisSnapshot(
                personas_json=json.dumps(result.get("personas", {})),
                consensus=result.get("consensus"),
                consensus_picks_json=json.dumps(result.get("consensus_picks", [])),
                market_data_summary_json=json.dumps(result.get("market_data_summary", {})),
                trading_economics_json=json.dumps(result.get("trading_economics", {})),
                tokens_input=result.get("tokens_used", {}).get("input", 0),
                tokens_output=result.get("tokens_used", {}).get("output", 0),
            )
            db.add(snapshot)
            db.commit()
            logger.info(f"Saved trader analysis snapshot #{snapshot.id}")
        except Exception as e:
            logger.error(f"Failed to save trader snapshot: {e}")
            db.rollback()

    return result


@router.get("/personas/history")
async def trader_personas_history(db: Session = Depends(get_db)):
    """List all saved analyses (lightweight summaries)."""
    snapshots = (
        db.query(TraderAnalysisSnapshot)
        .order_by(TraderAnalysisSnapshot.created_at.desc())
        .all()
    )
    result = []
    for s in snapshots:
        pick_count = 0
        if s.consensus_picks_json:
            try:
                pick_count = len(json.loads(s.consensus_picks_json))
            except Exception:
                pass
        result.append({
            "id": s.id,
            "created_at": s.created_at.isoformat() + "Z",
            "tokens_input": s.tokens_input or 0,
            "tokens_output": s.tokens_output or 0,
            "pick_count": pick_count,
        })
    return result


def _snapshot_to_response(snapshot: TraderAnalysisSnapshot) -> dict:
    """Convert a snapshot ORM object to the standard API response shape."""
    return {
        "personas": json.loads(snapshot.personas_json) if snapshot.personas_json else {},
        "consensus": snapshot.consensus,
        "consensus_picks": json.loads(snapshot.consensus_picks_json) if snapshot.consensus_picks_json else [],
        "market_data_summary": json.loads(snapshot.market_data_summary_json) if snapshot.market_data_summary_json else None,
        "trading_economics": json.loads(snapshot.trading_economics_json) if snapshot.trading_economics_json else None,
        "tokens_used": {"input": snapshot.tokens_input or 0, "output": snapshot.tokens_output or 0},
        "created_at": snapshot.created_at.isoformat() + "Z",
    }


@router.get("/personas/latest")
async def trader_personas_latest(db: Session = Depends(get_db)):
    """Get the most recently saved multi-persona analysis (instant, no AI call)."""
    snapshot = (
        db.query(TraderAnalysisSnapshot)
        .order_by(TraderAnalysisSnapshot.created_at.desc())
        .first()
    )
    if not snapshot:
        return {"error": "No saved analysis found. Run the trading desk first."}
    return _snapshot_to_response(snapshot)


@router.get("/personas/snapshot/{snapshot_id}")
async def trader_personas_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    """Load a specific saved analysis by ID."""
    snapshot = db.query(TraderAnalysisSnapshot).filter_by(id=snapshot_id).first()
    if not snapshot:
        return {"error": f"Snapshot #{snapshot_id} not found."}
    return _snapshot_to_response(snapshot)


@router.get("/card/{card_id}")
async def trader_card_analysis(card_id: int, db: Session = Depends(get_db)):
    """Get the AI trader's analysis for a specific card."""
    return await get_card_trader_analysis(db, card_id)
