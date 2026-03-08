from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from server.database import get_db
from server.services.backtesting import (
    run_backtest,
    run_backtest_all_strategies,
    run_portfolio_backtest,
    STRATEGIES,
)

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


@router.get("/strategies")
def list_strategies():
    """List all available trading strategies."""
    return {"strategies": [
        {"key": k, "name": v} for k, v in STRATEGIES.items()
    ]}


@router.get("/card/{card_id}")
def backtest_card(
    card_id: int,
    strategy: str = Query("combined", description="Strategy key"),
    capital: float = Query(1000.0, description="Initial capital"),
    db: Session = Depends(get_db),
):
    """Run a backtest for a single card with a specific strategy."""
    result = run_backtest(db, card_id, strategy=strategy, initial_capital=capital)
    if result is None:
        return {"error": "Insufficient price history for backtesting (need 35+ days)"}
    return result.to_dict()


@router.get("/card/{card_id}/all")
def backtest_card_all_strategies(
    card_id: int,
    capital: float = Query(1000.0),
    db: Session = Depends(get_db),
):
    """Run all strategies on a single card for comparison."""
    results = run_backtest_all_strategies(db, card_id, initial_capital=capital)
    if not results:
        return {"error": "Insufficient price history for backtesting"}
    return {"results": results}


@router.get("/portfolio")
def backtest_portfolio(
    strategy: str = Query("combined"),
    top_n: int = Query(10, ge=1, le=50),
    capital: float = Query(10000.0),
    db: Session = Depends(get_db),
):
    """Run a portfolio backtest across the top N cards."""
    return run_portfolio_backtest(
        db, strategy=strategy, top_n=top_n, initial_capital=capital,
    )


@router.get("/card/{card_id}/realistic")
def backtest_card_realistic(
    card_id: int,
    strategy: str = Query("combined"),
    capital: float = Query(1000.0),
    platform: str = Query("tcgplayer"),
    db: Session = Depends(get_db),
):
    """Run fee-aware backtest comparing gross vs net returns."""
    gross = run_backtest(db, card_id, strategy=strategy, initial_capital=capital)
    net = run_backtest(db, card_id, strategy=strategy, initial_capital=capital,
                       fees_enabled=True, platform=platform)
    if gross is None:
        return {"error": "Insufficient price history for backtesting (need 35+ days)"}

    result = {
        "gross": gross.to_dict(),
        "fee_adjusted": net.to_dict() if net else None,
        "platform": platform,
    }
    if gross and net:
        result["fee_impact"] = {
            "gross_return_pct": gross.strategy_return_pct,
            "net_return_pct": net.strategy_return_pct,
            "return_destroyed_by_fees_pct": round(
                gross.strategy_return_pct - net.strategy_return_pct, 2
            ),
            "total_fees_paid": net.total_fees_paid,
            "breakeven_appreciation_pct": net.breakeven_appreciation_pct,
            "profitable_after_fees": net.strategy_return_pct > 0,
        }
    return result
