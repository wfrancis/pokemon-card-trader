"""Prop Trading System API — Virtual portfolio with automated trading signals."""

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from server.database import get_db
from server.models.virtual_portfolio import VirtualPortfolio
from server.models.virtual_position import VirtualPosition
from server.models.virtual_trade import VirtualTrade
from server.models.portfolio_snapshot import PortfolioSnapshot
from server.models.card import Card

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prop", tags=["prop-trader"])

ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY")


async def _verify_admin(x_admin_key: str | None = Header(None)):
    if ADMIN_API_KEY and x_admin_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing X-Admin-Key header")


def _get_portfolio_id(db: Session) -> int:
    from server.services.virtual_trader import get_or_create_portfolio
    portfolio = get_or_create_portfolio(db)
    return portfolio.id


# ── Portfolio ────────────────────────────────────────────────────────────────


@router.get("/portfolio")
def get_portfolio(db: Session = Depends(get_db)):
    """Get current portfolio state: cash, positions, recent trades, equity curve, stats."""
    from server.services.virtual_trader import get_portfolio_summary
    pid = _get_portfolio_id(db)
    return get_portfolio_summary(db, pid)


@router.get("/portfolio/summary")
def get_portfolio_quick_summary(db: Session = Depends(get_db)):
    """Quick summary stats for dashboard display."""
    from server.services.virtual_trader import get_portfolio_summary
    pid = _get_portfolio_id(db)
    summary = get_portfolio_summary(db, pid)
    perf = summary.get("performance_stats", {})
    return {
        "total_value": summary.get("total_value", 0),
        "cash": summary.get("cash", 0),
        "starting_capital": summary.get("starting_capital", 10000),
        "daily_pnl": summary.get("daily_pnl", 0),
        "total_return_pct": summary.get("total_return_pct", 0),
        "win_rate": perf.get("win_rate", 0),
        "sharpe": perf.get("sharpe_ratio", 0),
        "max_drawdown": perf.get("max_drawdown", 0),
        "num_positions": len(summary.get("positions", [])),
    }


# ── Trades ───────────────────────────────────────────────────────────────────


@router.get("/trades")
def get_trades(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    side: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Trade blotter — paginated list of all executed trades."""
    pid = _get_portfolio_id(db)
    query = (
        db.query(VirtualTrade)
        .filter(VirtualTrade.portfolio_id == pid)
        .order_by(VirtualTrade.executed_at.desc())
    )
    if side and side.lower() in ("buy", "sell"):
        query = query.filter(VirtualTrade.side == side.lower())

    total = query.count()
    trades = query.offset(offset).limit(limit).all()

    result = []
    for t in trades:
        card = db.query(Card).filter(Card.id == t.card_id).first()
        result.append({
            "id": t.id,
            "card_id": t.card_id,
            "card_name": card.name if card else "Unknown",
            "card_image": card.image_small if card else None,
            "set_name": card.set_name if card else None,
            "side": t.side,
            "quantity": t.quantity,
            "signal_price": t.signal_price,
            "execution_price": t.execution_price,
            "slippage_cost": t.slippage_cost,
            "slippage_pct": t.slippage_pct,
            "fee_cost": t.fee_cost,
            "total_cost": t.total_cost,
            "realized_pnl": t.realized_pnl,
            "realized_pnl_pct": t.realized_pnl_pct,
            "signal": t.signal,
            "strategy": t.strategy,
            "notes": t.notes,
            "executed_at": t.executed_at.isoformat() + "Z" if t.executed_at else None,
        })

    return {"trades": result, "total": total, "limit": limit, "offset": offset}


# ── Positions ────────────────────────────────────────────────────────────────


@router.get("/positions")
def get_positions(db: Session = Depends(get_db)):
    """Current open positions with unrealized P&L."""
    pid = _get_portfolio_id(db)

    positions = (
        db.query(VirtualPosition)
        .filter(VirtualPosition.portfolio_id == pid, VirtualPosition.quantity > 0)
        .all()
    )

    result = []
    for p in positions:
        card = db.query(Card).filter(Card.id == p.card_id).first()
        current = card.current_price if card else p.avg_entry_price
        pnl = (current - p.avg_entry_price) * p.quantity if current else 0
        pnl_pct = ((current - p.avg_entry_price) / p.avg_entry_price * 100) if p.avg_entry_price and current else 0
        try:
            entry_dt = p.entry_date.replace(tzinfo=timezone.utc) if p.entry_date and p.entry_date.tzinfo is None else p.entry_date
            days_held = (datetime.now(timezone.utc) - entry_dt).days if entry_dt else 0
        except Exception:
            days_held = 0

        result.append({
            "id": p.id,
            "card_id": p.card_id,
            "card_name": card.name if card else "Unknown",
            "card_image": card.image_small if card else None,
            "set_name": card.set_name if card else None,
            "quantity": p.quantity,
            "avg_entry_price": p.avg_entry_price,
            "current_price": round(current, 2) if current else None,
            "unrealized_pnl": round(pnl, 2),
            "unrealized_pnl_pct": round(pnl_pct, 2),
            "stop_loss": p.stop_loss,
            "take_profit": p.take_profit,
            "days_held": days_held,
            "entry_reason": p.entry_reason,
            "entry_date": p.entry_date.isoformat() + "Z" if p.entry_date else None,
        })

    return {"positions": result}


# ── Equity Curve ─────────────────────────────────────────────────────────────


@router.get("/equity-curve")
def get_equity_curve_endpoint(
    days: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
):
    """Daily portfolio value history for charting."""
    from datetime import timedelta
    pid = _get_portfolio_id(db)

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date()
    snapshots = (
        db.query(PortfolioSnapshot)
        .filter(PortfolioSnapshot.portfolio_id == pid, PortfolioSnapshot.date >= cutoff)
        .order_by(PortfolioSnapshot.date.asc())
        .all()
    )

    result = []
    for s in snapshots:
        result.append({
            "date": str(s.date),
            "total_value": round(s.total_value, 2),
            "cash": round(s.cash, 2),
            "positions_value": round(s.positions_value, 2),
            "daily_pnl": round(s.daily_pnl or 0, 2),
            "drawdown_pct": round(s.drawdown_pct or 0, 2),
        })

    return {"equity_curve": result}


# ── Signals ──────────────────────────────────────────────────────────────────


@router.get("/signals")
def get_signals(db: Session = Depends(get_db)):
    """Current trading signals — what the bot is considering without executing."""
    try:
        from server.services.prop_strategies import scan_for_signals
        signals = scan_for_signals(db)
        return {"signals": signals[:30]}  # Cap at 30 for UI
    except Exception as e:
        logger.error(f"Signal scan error: {e}")
        return {"signals": [], "error": str(e)}


# ── Run Cycle (Admin) ────────────────────────────────────────────────────────


@router.post("/run-cycle")
async def run_cycle(
    db: Session = Depends(get_db),
    _admin: None = Depends(_verify_admin),
):
    """Manually trigger one trading cycle: scan signals + execute trades."""
    from server.services.prop_strategies import run_trading_cycle as _run_cycle
    from server.services.virtual_trader import (
        get_or_create_portfolio, update_portfolio_values,
        execute_buy, execute_sell, take_portfolio_snapshot,
    )

    portfolio = get_or_create_portfolio(db)
    update_portfolio_values(db, portfolio.id)

    # Build positions list from DB
    positions_raw = (
        db.query(VirtualPosition)
        .filter(VirtualPosition.portfolio_id == portfolio.id, VirtualPosition.quantity > 0)
        .all()
    )
    positions = []
    for p in positions_raw:
        card = db.query(Card).filter(Card.id == p.card_id).first()
        positions.append({
            "card_id": p.card_id,
            "entry_price": p.avg_entry_price,
            "entry_date": p.entry_date,
            "stop_loss": p.stop_loss,
            "take_profit": p.take_profit,
            "quantity": p.quantity,
            "set_id": card.set_id if card else None,
        })

    # Run the cycle (pure computation)
    result = await _run_cycle(
        db, portfolio.id, positions, portfolio.total_value, portfolio.cash_balance
    )

    # Execute sells
    sells_executed = 0
    for sell in result.get("sells", []):
        try:
            execute_sell(
                db, portfolio.id, sell["card_id"], sell.get("quantity", 1),
                signal=sell.get("signal", "cycle_sell"),
                strategy=sell.get("strategy", "combined"),
                notes=sell.get("reason", ""),
            )
            sells_executed += 1
        except Exception as e:
            logger.error(f"Sell execution error for card {sell['card_id']}: {e}")

    # Execute buys
    buys_executed = 0
    for buy in result.get("buys", []):
        try:
            execute_buy(
                db, portfolio.id, buy["card_id"], buy.get("quantity", 1),
                signal=buy.get("signal", "cycle_buy"),
                strategy=buy.get("strategy", "combined"),
                notes=buy.get("reason", ""),
            )
            buys_executed += 1
        except Exception as e:
            logger.error(f"Buy execution error for card {buy['card_id']}: {e}")

    # Snapshot
    take_portfolio_snapshot(db, portfolio.id)
    db.commit()

    return {
        "status": "complete",
        "buys_executed": buys_executed,
        "sells_executed": sells_executed,
        "signals_generated": result.get("signals_generated", 0),
        "portfolio_value": portfolio.total_value,
    }


# ── Reset (Admin) ────────────────────────────────────────────────────────────


@router.post("/reset")
async def reset(
    starting_capital: float = Query(10000, ge=100, le=1000000),
    db: Session = Depends(get_db),
    _admin: None = Depends(_verify_admin),
):
    """Reset portfolio to starting capital. Clears all positions and trade history."""
    from server.services.virtual_trader import reset_portfolio as _reset
    pid = _get_portfolio_id(db)
    return _reset(db, pid, starting_capital=starting_capital)


# ── Performance Analytics ────────────────────────────────────────────────────


@router.get("/performance")
def get_performance(db: Session = Depends(get_db)):
    """Detailed performance analytics."""
    from server.services.virtual_trader import get_performance_analytics
    pid = _get_portfolio_id(db)
    return get_performance_analytics(db, pid)


# ── Leaderboard ──────────────────────────────────────────────────────────────


@router.get("/leaderboard")
def get_leaderboard(db: Session = Depends(get_db)):
    """Compare performance across strategy portfolios."""
    from server.services.virtual_trader import get_strategy_leaderboard
    return get_strategy_leaderboard(db)


# ── Backtest ─────────────────────────────────────────────────────────────────


@router.get("/backtest")
async def run_backtest(
    start_date: str | None = Query(None, description="YYYY-MM-DD"),
    end_date: str | None = Query(None, description="YYYY-MM-DD"),
    starting_capital: float = Query(10000, ge=100, le=1000000),
    step_days: int = Query(7, ge=1, le=30),
    max_positions: int = Query(20, ge=1, le=50),
    strategies: str | None = Query(None, description="Comma-separated: sma_cross,rsi_oversold,spread_compression,mean_reversion,momentum"),
    min_price: float = Query(5.0, ge=1),
    db: Session = Depends(get_db),
):
    """Run a multi-year backtest of the prop trading system.

    Simulates walking forward through historical price data, generating
    signals and executing virtual trades with realistic slippage + fees.
    No AI calls — pure historical simulation.
    """
    from server.services.prop_backtest import run_prop_backtest
    from datetime import date as dateclass

    sd = dateclass.fromisoformat(start_date) if start_date else None
    ed = dateclass.fromisoformat(end_date) if end_date else None
    strat_list = strategies.split(",") if strategies else None

    result = await run_prop_backtest(
        db,
        start_date=sd,
        end_date=ed,
        starting_capital=starting_capital,
        step_days=step_days,
        max_positions=max_positions,
        strategies=strat_list,
        min_price=min_price,
    )
    return result
