import json
import re
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from server.database import get_db
from server.models.card import Card
from server.models.trader_snapshot import TraderAnalysisSnapshot
from server.services.trader_agent import (
    get_trader_analysis, get_card_trader_analysis, get_multi_persona_analysis,
)
from server.services.trading_economics import calc_breakeven_appreciation

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/trader", tags=["trader"])


def _extract_picks_from_consensus(db: Session, consensus_text: str) -> list[dict]:
    """Extract recommended card picks from consensus text.

    Parses numbered recommendation items (e.g. "1. Charizard — Base Set — $525.82")
    and matches each to exactly one card in our database.
    Only searches PORTFOLIO RECOMMENDATIONS, not watchlist/discussion sections.
    """
    if not consensus_text:
        return []

    # Trim to just the recommendation sections (exclude watchlist & later)
    rec_text = consensus_text
    lower_full = consensus_text.lower()

    rec_start = lower_full.find("portfolio recommendations")
    if rec_start == -1:
        rec_start = lower_full.find("core holdings")
    if rec_start > 0:
        rec_text = consensus_text[rec_start:]

    # Cut off at watchlist or later sections
    lower_rec = rec_text.lower()
    cutoff = len(rec_text)
    for marker in ["watchlist", "where the desk agrees", "key risks", "the honest answer"]:
        pos = lower_rec.find(marker)
        if 0 < pos < cutoff:
            cutoff = pos
    rec_text = rec_text[:cutoff]

    # Extract numbered recommendation lines (e.g. "1. Base Set Charizard — ...")
    # Each numbered item is one recommended card
    rec_lines = re.findall(r'\d+\.\s*(.+?)(?:\n|$)', rec_text)
    if not rec_lines:
        logger.warning("No numbered recommendation lines found in consensus text")
        return []

    # Get all tracked cards from DB
    tracked_cards = db.query(Card).filter(Card.is_tracked == True).all()

    # Build card lookup: sort by name length descending for longest-match-first
    card_entries = []
    for c in tracked_cards:
        if not c.name or not c.current_price:
            continue
        price = c.current_price
        if price >= 100:
            tier = "premium"
        elif price >= 50:
            tier = "mid_high"
        else:
            tier = "mid"

        be_pct = calc_breakeven_appreciation(price) if price > 0 else None

        card_entries.append({
            "card_id": c.id,
            "name": c.name,
            "set_name": c.set_name,
            "rarity": c.rarity,
            "image_small": c.image_small,
            "current_price": price,
            "price_tier": tier,
            "signal": "hold",
            "breakeven_pct": round(be_pct * 100, 1) if be_pct else None,
            "liquidity_score": None,
            "price_change_7d": None,
            "price_change_30d": None,
        })

    card_entries.sort(key=lambda c: len(c["name"]), reverse=True)

    # For each numbered line, find the best matching card
    picks = []
    seen_ids = set()

    for line in rec_lines:
        line_lower = line.lower().strip()

        # Parse the dollar price from the line (e.g. "$226.11", "$1,090")
        price_match = re.search(r'\$[\d,]+\.?\d*', line)
        line_price = None
        if price_match:
            try:
                line_price = float(price_match.group().replace('$', '').replace(',', ''))
            except ValueError:
                pass

        # Collect all candidate matches for this line
        candidates = []

        for cdata in card_entries:
            cid = cdata["card_id"]
            if cid in seen_ids:
                continue
            name_lower = cdata["name"].lower()

            # Card name must appear in this specific recommendation line
            if name_lower not in line_lower:
                continue

            # Check if set name also appears in the line
            set_lower = (cdata["set_name"] or "").lower()
            set_match = set_lower and set_lower in line_lower

            # Compute price proximity score (lower = closer match)
            price_dist = float('inf')
            if line_price and cdata["current_price"]:
                price_dist = abs(cdata["current_price"] - line_price) / max(line_price, 1)

            candidates.append((cdata, set_match, price_dist))

        if not candidates:
            continue

        # Sort candidates: set_match (True first), then price proximity (closest first)
        candidates.sort(key=lambda x: (not x[1], x[2]))
        best = candidates[0]
        cdata = best[0]
        seen_ids.add(cdata["card_id"])
        picks.append(cdata)

    logger.info(f"Re-extracted {len(picks)} consensus picks from {len(rec_lines)} recommendation lines")
    return picks


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


def _snapshot_to_response(snapshot: TraderAnalysisSnapshot, db: Session) -> dict:
    """Convert a snapshot ORM object to the standard API response shape.

    Re-extracts consensus picks from the consensus text at load time
    using name matching against current card data (fixes stale/wrong picks).
    """
    # Always re-extract picks from consensus text for accuracy
    picks = _extract_picks_from_consensus(db, snapshot.consensus or "")

    return {
        "personas": json.loads(snapshot.personas_json) if snapshot.personas_json else {},
        "consensus": snapshot.consensus,
        "consensus_picks": picks,
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
    return _snapshot_to_response(snapshot, db)


@router.get("/personas/snapshot/{snapshot_id}")
async def trader_personas_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    """Load a specific saved analysis by ID."""
    snapshot = db.query(TraderAnalysisSnapshot).filter_by(id=snapshot_id).first()
    if not snapshot:
        return {"error": f"Snapshot #{snapshot_id} not found."}
    return _snapshot_to_response(snapshot, db)


@router.get("/card/{card_id}")
async def trader_card_analysis(card_id: int, db: Session = Depends(get_db)):
    """Get the AI trader's analysis for a specific card."""
    return await get_card_trader_analysis(db, card_id)
