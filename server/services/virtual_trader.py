"""
Virtual Prop Trading Engine — Simulates buying and selling Pokemon cards
with virtual money, tracking P&L with realistic slippage and TCGPlayer fees.

Slippage is modeled based on card liquidity: illiquid vintage rares cost
15-25% more to trade, while liquid modern cards cost only 1-3%. This
creates a natural incentive for strategies to favor tradeable cards.

Fee model mirrors TCGPlayer's real seller fee: 12.55% of sale price
(10.75% commission + 2.5% payment processing + $0.30 flat, simplified
to a single rate for virtual trading since we don't model shipping).
"""
import logging
from datetime import date, datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc, desc

from server.models.card import Card
from server.models.sale import Sale
from server.models.virtual_portfolio import VirtualPortfolio
from server.models.virtual_position import VirtualPosition
from server.models.virtual_trade import VirtualTrade
from server.models.portfolio_snapshot import PortfolioSnapshot

logger = logging.getLogger(__name__)

# TCGPlayer simplified seller fee rate (commission + payment processing).
# Real rate is 10.75% + 2.5% + $0.30 flat; we fold the flat fee into the
# percentage for virtual trading simplicity.
TCGPLAYER_SELLER_FEE_RATE = 0.1255


# ── Liquidity Helpers ────────────────────────────────────────────────────────

def get_card_liquidity_data(db: Session, card_id: int) -> dict:
    """Fetch liquidity metrics for a card: score, sales velocity, median sold price.

    Uses the cached liquidity_score on the Card model and computes sales
    velocity from the Sale table (last 30 days).
    """
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        return {
            "liquidity_score": 0,
            "sales_per_day": 0.0,
            "median_sold": 0.0,
            "current_price": 0.0,
        }

    # Sales in last 30 days
    thirty_days_ago = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    from datetime import timedelta
    thirty_days_ago = thirty_days_ago - timedelta(days=30)

    sales_30d = (
        db.query(Sale)
        .filter(Sale.card_id == card_id, Sale.order_date >= thirty_days_ago)
        .all()
    )

    sales_count = sum(s.quantity or 1 for s in sales_30d)
    sales_per_day = sales_count / 30.0

    # Median sold price from recent sales
    sale_prices = sorted([s.purchase_price for s in sales_30d if s.purchase_price])
    if sale_prices:
        mid = len(sale_prices) // 2
        median_sold = (
            sale_prices[mid]
            if len(sale_prices) % 2 == 1
            else (sale_prices[mid - 1] + sale_prices[mid]) / 2.0
        )
    else:
        median_sold = card.current_price or 0.0

    return {
        "liquidity_score": card.liquidity_score or 0,
        "sales_per_day": round(sales_per_day, 3),
        "median_sold": round(median_sold, 2),
        "current_price": card.current_price or 0.0,
    }


# ── Slippage Model ───────────────────────────────────────────────────────────

def calculate_slippage(
    card_price: float,
    liquidity_score: float,
    sales_per_day: float,
) -> float:
    """Calculate realistic slippage based on card liquidity.

    Slippage model:
    - High liquidity (score > 70, >1 sale/day): 1-3% slippage
    - Medium liquidity (score 40-70, 0.3-1 sale/day): 3-7% slippage
    - Low liquidity (score < 40, <0.3 sale/day): 7-15% slippage
    - Very low liquidity (<0.1 sale/day): 15-25% slippage

    For buys: slippage increases price (you pay more).
    For sells: slippage decreases price (you receive less).

    Returns slippage as a decimal (e.g., 0.05 for 5%).
    """
    if card_price <= 0:
        return 0.25  # worst case for zero-priced cards

    # Very low liquidity override: <0.1 sales/day = extremely hard to trade
    if sales_per_day < 0.1:
        # 15-25% range, scaled by how close to zero velocity is
        # At 0 sales/day -> 25%, at 0.1 -> 15%
        ratio = sales_per_day / 0.1  # 0.0 to 1.0
        return 0.25 - (ratio * 0.10)  # 25% down to 15%

    # Low liquidity: score < 40 or 0.1-0.3 sales/day
    if liquidity_score < 40 or sales_per_day < 0.3:
        # 7-15% range
        if sales_per_day < 0.3:
            ratio = (sales_per_day - 0.1) / 0.2  # 0.0 to 1.0
            return 0.15 - (ratio * 0.08)  # 15% down to 7%
        # Score-based fallback
        ratio = liquidity_score / 40.0
        return 0.15 - (ratio * 0.08)

    # Medium liquidity: score 40-70 or 0.3-1.0 sales/day
    if liquidity_score < 70 or sales_per_day < 1.0:
        # 3-7% range
        if sales_per_day < 1.0:
            ratio = (sales_per_day - 0.3) / 0.7  # 0.0 to 1.0
            return 0.07 - (ratio * 0.04)  # 7% down to 3%
        ratio = (liquidity_score - 40) / 30.0
        return 0.07 - (ratio * 0.04)

    # High liquidity: score >= 70 and >= 1 sale/day
    # 1-3% range, further refined by velocity
    if sales_per_day >= 3.0:
        return 0.01  # very liquid, minimal slippage
    ratio = (sales_per_day - 1.0) / 2.0  # 0.0 to 1.0
    return 0.03 - (ratio * 0.02)  # 3% down to 1%


# ── Order Execution ──────────────────────────────────────────────────────────

def execute_buy(
    db: Session,
    portfolio_id: int,
    card_id: int,
    quantity: int,
    signal: str,
    strategy: str,
    notes: str = "",
) -> dict:
    """Execute a virtual buy order with realistic slippage.

    1. Get card's current market price, liquidity score, sales velocity.
    2. Calculate slippage (buyer pays MORE than market).
    3. Calculate total cost = (market_price * (1 + slippage)) * quantity.
    4. Check if portfolio has enough cash.
    5. Create VirtualTrade record.
    6. Create or update VirtualPosition (if already holding, average in).
    7. Deduct cash from portfolio.
    8. Return trade details dict.
    """
    portfolio = db.query(VirtualPortfolio).filter(VirtualPortfolio.id == portfolio_id).first()
    if not portfolio:
        return {"error": "Portfolio not found", "success": False}

    card = db.query(Card).filter(Card.id == card_id).first()
    if not card or not card.current_price:
        return {"error": "Card not found or no price data", "success": False}

    liq = get_card_liquidity_data(db, card_id)
    market_price = card.current_price
    slippage = calculate_slippage(market_price, liq["liquidity_score"], liq["sales_per_day"])

    # Buyer pays more due to slippage
    execution_price = round(market_price * (1.0 + slippage), 2)
    total_cost = round(execution_price * quantity, 2)
    slippage_cost = round((execution_price - market_price) * quantity, 2)

    if portfolio.cash_balance < total_cost:
        return {
            "error": f"Insufficient cash: need ${total_cost:.2f}, have ${portfolio.cash_balance:.2f}",
            "success": False,
        }

    # Create trade record
    trade = VirtualTrade(
        portfolio_id=portfolio_id,
        card_id=card_id,
        side="buy",
        quantity=quantity,
        signal_price=market_price,
        execution_price=execution_price,
        slippage_cost=slippage_cost,
        slippage_pct=round(slippage * 100, 2),
        fee_cost=0.0,  # No buyer fee in TCGPlayer model
        total_cost=total_cost,
        realized_pnl=None,
        realized_pnl_pct=None,
        signal=signal,
        strategy=strategy,
        notes=notes,
    )
    db.add(trade)

    # Update or create position
    position = (
        db.query(VirtualPosition)
        .filter(
            VirtualPosition.portfolio_id == portfolio_id,
            VirtualPosition.card_id == card_id,
        )
        .first()
    )

    if position:
        # Average in: new avg = (old_total + new_total) / (old_qty + new_qty)
        old_total = position.avg_entry_price * position.quantity
        new_total = execution_price * quantity
        position.quantity += quantity
        position.avg_entry_price = round((old_total + new_total) / position.quantity, 2)
    else:
        position = VirtualPosition(
            portfolio_id=portfolio_id,
            card_id=card_id,
            quantity=quantity,
            avg_entry_price=execution_price,
            current_price=market_price,
            unrealized_pnl=0.0,
            unrealized_pnl_pct=0.0,
            entry_reason=f"{signal} ({strategy})",
        )
        db.add(position)

    # Deduct cash
    portfolio.cash_balance = round(portfolio.cash_balance - total_cost, 2)
    portfolio.updated_at = datetime.now(timezone.utc)

    db.commit()

    logger.info(
        "BUY %dx %s @ $%.2f (mkt $%.2f, slip %.1f%%) | cost $%.2f | cash $%.2f",
        quantity, card.name, execution_price, market_price,
        slippage * 100, total_cost, portfolio.cash_balance,
    )

    return {
        "success": True,
        "trade_id": trade.id,
        "side": "buy",
        "card_id": card_id,
        "card_name": card.name,
        "quantity": quantity,
        "market_price": market_price,
        "execution_price": execution_price,
        "slippage_pct": round(slippage * 100, 2),
        "slippage_cost": slippage_cost,
        "total_cost": total_cost,
        "cash_remaining": portfolio.cash_balance,
    }


def execute_sell(
    db: Session,
    portfolio_id: int,
    card_id: int,
    quantity: int,
    signal: str,
    strategy: str,
    notes: str = "",
) -> dict:
    """Execute a virtual sell order with slippage + TCGPlayer fees.

    1. Check position exists with enough quantity.
    2. Get card's current market price, liquidity.
    3. Calculate slippage (seller receives LESS than market).
    4. Calculate TCGPlayer seller fee: 12.55% of sale price.
    5. Net proceeds = market_price * (1 - slippage) * (1 - 0.1255) * quantity.
    6. Calculate realized P&L = net_proceeds - (avg_entry_price * quantity).
    7. Create VirtualTrade record with realized_pnl.
    8. Update or remove VirtualPosition.
    9. Add proceeds to portfolio cash.
    10. Return trade details dict.
    """
    portfolio = db.query(VirtualPortfolio).filter(VirtualPortfolio.id == portfolio_id).first()
    if not portfolio:
        return {"error": "Portfolio not found", "success": False}

    position = (
        db.query(VirtualPosition)
        .filter(
            VirtualPosition.portfolio_id == portfolio_id,
            VirtualPosition.card_id == card_id,
        )
        .first()
    )
    if not position or position.quantity < quantity:
        held = position.quantity if position else 0
        return {
            "error": f"Insufficient position: want to sell {quantity}, hold {held}",
            "success": False,
        }

    card = db.query(Card).filter(Card.id == card_id).first()
    if not card or not card.current_price:
        return {"error": "Card not found or no price data", "success": False}

    liq = get_card_liquidity_data(db, card_id)
    market_price = card.current_price
    slippage = calculate_slippage(market_price, liq["liquidity_score"], liq["sales_per_day"])

    # Seller receives less due to slippage
    execution_price = round(market_price * (1.0 - slippage), 2)
    gross_proceeds = round(execution_price * quantity, 2)
    slippage_cost = round((market_price - execution_price) * quantity, 2)

    # TCGPlayer seller fee on gross proceeds
    fee_cost = round(gross_proceeds * TCGPLAYER_SELLER_FEE_RATE, 2)
    net_proceeds = round(gross_proceeds - fee_cost, 2)

    # Realized P&L: what we got minus what we paid
    cost_basis = round(position.avg_entry_price * quantity, 2)
    realized_pnl = round(net_proceeds - cost_basis, 2)
    realized_pnl_pct = round((realized_pnl / cost_basis) * 100, 2) if cost_basis > 0 else 0.0

    # Create trade record
    trade = VirtualTrade(
        portfolio_id=portfolio_id,
        card_id=card_id,
        side="sell",
        quantity=quantity,
        signal_price=market_price,
        execution_price=execution_price,
        slippage_cost=slippage_cost,
        slippage_pct=round(slippage * 100, 2),
        fee_cost=fee_cost,
        total_cost=net_proceeds,  # For sells, total_cost = net proceeds received
        realized_pnl=realized_pnl,
        realized_pnl_pct=realized_pnl_pct,
        signal=signal,
        strategy=strategy,
        notes=notes,
    )
    db.add(trade)

    # Update position
    if position.quantity == quantity:
        # Full exit: remove position
        db.delete(position)
    else:
        # Partial exit: reduce quantity, keep avg entry price
        position.quantity -= quantity

    # Add proceeds to cash
    portfolio.cash_balance = round(portfolio.cash_balance + net_proceeds, 2)
    portfolio.updated_at = datetime.now(timezone.utc)

    db.commit()

    logger.info(
        "SELL %dx %s @ $%.2f (mkt $%.2f, slip %.1f%%, fee $%.2f) | "
        "net $%.2f | P&L $%.2f (%.1f%%) | cash $%.2f",
        quantity, card.name, execution_price, market_price,
        slippage * 100, fee_cost, net_proceeds,
        realized_pnl, realized_pnl_pct, portfolio.cash_balance,
    )

    return {
        "success": True,
        "trade_id": trade.id,
        "side": "sell",
        "card_id": card_id,
        "card_name": card.name,
        "quantity": quantity,
        "market_price": market_price,
        "execution_price": execution_price,
        "slippage_pct": round(slippage * 100, 2),
        "slippage_cost": slippage_cost,
        "fee_cost": fee_cost,
        "gross_proceeds": gross_proceeds,
        "net_proceeds": net_proceeds,
        "cost_basis": cost_basis,
        "realized_pnl": realized_pnl,
        "realized_pnl_pct": realized_pnl_pct,
        "cash_remaining": portfolio.cash_balance,
    }


# ── Portfolio Management ─────────────────────────────────────────────────────

def get_or_create_portfolio(
    db: Session,
    name: str = "Prop Desk Alpha",
    starting_capital: float = 10000.0,
) -> VirtualPortfolio:
    """Get existing portfolio by name or create a new one."""
    portfolio = db.query(VirtualPortfolio).filter(VirtualPortfolio.name == name).first()
    if portfolio:
        return portfolio

    portfolio = VirtualPortfolio(
        name=name,
        starting_capital=starting_capital,
        cash_balance=starting_capital,
        total_value=starting_capital,
        high_water_mark=starting_capital,
        is_active=True,
    )
    db.add(portfolio)
    db.commit()
    logger.info("Created portfolio '%s' with $%.2f starting capital", name, starting_capital)
    return portfolio


def update_portfolio_values(db: Session, portfolio_id: int) -> dict:
    """Recalculate all position values and portfolio total.

    For each position:
    1. Get current card price.
    2. Calculate unrealized P&L.
    3. Update position record.

    Update portfolio total_value = cash + sum(positions).
    Update high_water_mark if new high.

    Returns summary dict.
    """
    portfolio = db.query(VirtualPortfolio).filter(VirtualPortfolio.id == portfolio_id).first()
    if not portfolio:
        return {"error": "Portfolio not found"}

    positions = (
        db.query(VirtualPosition)
        .filter(VirtualPosition.portfolio_id == portfolio_id)
        .all()
    )

    total_positions_value = 0.0
    position_updates = []

    for pos in positions:
        card = db.query(Card).filter(Card.id == pos.card_id).first()
        if not card or not card.current_price:
            continue

        current_price = card.current_price
        position_value = current_price * pos.quantity
        cost_basis = pos.avg_entry_price * pos.quantity
        unrealized_pnl = round(position_value - cost_basis, 2)
        unrealized_pnl_pct = round((unrealized_pnl / cost_basis) * 100, 2) if cost_basis > 0 else 0.0

        pos.current_price = current_price
        pos.unrealized_pnl = unrealized_pnl
        pos.unrealized_pnl_pct = unrealized_pnl_pct

        total_positions_value += position_value
        position_updates.append({
            "card_id": pos.card_id,
            "quantity": pos.quantity,
            "current_price": current_price,
            "unrealized_pnl": unrealized_pnl,
        })

    total_value = round(portfolio.cash_balance + total_positions_value, 2)
    portfolio.total_value = total_value

    if total_value > (portfolio.high_water_mark or 0):
        portfolio.high_water_mark = total_value

    portfolio.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "portfolio_id": portfolio_id,
        "cash": portfolio.cash_balance,
        "positions_value": round(total_positions_value, 2),
        "total_value": total_value,
        "high_water_mark": portfolio.high_water_mark,
        "num_positions": len(positions),
        "position_updates": position_updates,
    }


def take_portfolio_snapshot(db: Session, portfolio_id: int) -> PortfolioSnapshot | None:
    """Save daily portfolio snapshot for equity curve. One snapshot per day (dedup by date)."""
    portfolio = db.query(VirtualPortfolio).filter(VirtualPortfolio.id == portfolio_id).first()
    if not portfolio:
        return None

    today = date.today()

    # Dedup: check if snapshot already exists for today
    existing = (
        db.query(PortfolioSnapshot)
        .filter(
            PortfolioSnapshot.portfolio_id == portfolio_id,
            PortfolioSnapshot.date == today,
        )
        .first()
    )

    # Ensure values are fresh
    update_portfolio_values(db, portfolio_id)

    positions = (
        db.query(VirtualPosition)
        .filter(VirtualPosition.portfolio_id == portfolio_id)
        .all()
    )
    positions_value = sum(
        (p.current_price or 0) * p.quantity for p in positions
    )

    # Get yesterday's snapshot for daily P&L
    yesterday_snap = (
        db.query(PortfolioSnapshot)
        .filter(
            PortfolioSnapshot.portfolio_id == portfolio_id,
            PortfolioSnapshot.date < today,
        )
        .order_by(desc(PortfolioSnapshot.date))
        .first()
    )

    yesterday_value = yesterday_snap.total_value if yesterday_snap else portfolio.starting_capital
    daily_pnl = round(portfolio.total_value - yesterday_value, 2)
    daily_pnl_pct = round((daily_pnl / yesterday_value) * 100, 2) if yesterday_value > 0 else 0.0
    cumulative_pnl = round(portfolio.total_value - portfolio.starting_capital, 2)
    cumulative_pnl_pct = (
        round((cumulative_pnl / portfolio.starting_capital) * 100, 2)
        if portfolio.starting_capital > 0 else 0.0
    )
    hwm = portfolio.high_water_mark or portfolio.total_value
    drawdown_pct = round(((hwm - portfolio.total_value) / hwm) * 100, 2) if hwm > 0 else 0.0

    if existing:
        # Update existing snapshot
        existing.cash = portfolio.cash_balance
        existing.positions_value = round(positions_value, 2)
        existing.total_value = portfolio.total_value
        existing.daily_pnl = daily_pnl
        existing.daily_pnl_pct = daily_pnl_pct
        existing.cumulative_pnl = cumulative_pnl
        existing.cumulative_pnl_pct = cumulative_pnl_pct
        existing.num_positions = len(positions)
        existing.high_water_mark = hwm
        existing.drawdown_pct = drawdown_pct
        db.commit()
        return existing

    snapshot = PortfolioSnapshot(
        portfolio_id=portfolio_id,
        date=today,
        cash=portfolio.cash_balance,
        positions_value=round(positions_value, 2),
        total_value=portfolio.total_value,
        daily_pnl=daily_pnl,
        daily_pnl_pct=daily_pnl_pct,
        cumulative_pnl=cumulative_pnl,
        cumulative_pnl_pct=cumulative_pnl_pct,
        num_positions=len(positions),
        high_water_mark=hwm,
        drawdown_pct=drawdown_pct,
    )
    db.add(snapshot)
    db.commit()
    return snapshot


def get_portfolio_summary(db: Session, portfolio_id: int) -> dict:
    """Get complete portfolio state including positions, trades, stats, and equity curve.

    Returns:
    - cash, total_value, starting_capital
    - total_return_pct, high_water_mark, max_drawdown
    - positions: list of open positions with card name, qty, entry, current, pnl
    - recent_trades: last 20 trades
    - daily_snapshots: for equity curve chart
    - win_rate, avg_win, avg_loss, profit_factor
    - best_trade, worst_trade
    """
    portfolio = db.query(VirtualPortfolio).filter(VirtualPortfolio.id == portfolio_id).first()
    if not portfolio:
        return {"error": "Portfolio not found"}

    # Refresh values
    update_portfolio_values(db, portfolio_id)

    # Positions with card details
    positions = (
        db.query(VirtualPosition)
        .filter(VirtualPosition.portfolio_id == portfolio_id)
        .all()
    )

    position_list = []
    for pos in positions:
        card = db.query(Card).filter(Card.id == pos.card_id).first()
        position_list.append({
            "card_id": pos.card_id,
            "card_name": card.name if card else "Unknown",
            "card_image": card.image_small if card else None,
            "quantity": pos.quantity,
            "avg_entry_price": pos.avg_entry_price,
            "current_price": pos.current_price,
            "position_value": round((pos.current_price or 0) * pos.quantity, 2),
            "cost_basis": round(pos.avg_entry_price * pos.quantity, 2),
            "unrealized_pnl": pos.unrealized_pnl,
            "unrealized_pnl_pct": pos.unrealized_pnl_pct,
            "entry_reason": pos.entry_reason,
            "entry_date": str(pos.entry_date) if pos.entry_date else None,
        })

    # Recent trades
    recent_trades_raw = (
        db.query(VirtualTrade)
        .filter(VirtualTrade.portfolio_id == portfolio_id)
        .order_by(desc(VirtualTrade.executed_at))
        .limit(20)
        .all()
    )

    recent_trades = []
    for t in recent_trades_raw:
        card = db.query(Card).filter(Card.id == t.card_id).first()
        recent_trades.append({
            "trade_id": t.id,
            "card_id": t.card_id,
            "card_name": card.name if card else "Unknown",
            "side": t.side,
            "quantity": t.quantity,
            "signal_price": t.signal_price,
            "execution_price": t.execution_price,
            "slippage_pct": t.slippage_pct,
            "fee_cost": t.fee_cost,
            "total_cost": t.total_cost,
            "realized_pnl": t.realized_pnl,
            "realized_pnl_pct": t.realized_pnl_pct,
            "signal": t.signal,
            "strategy": t.strategy,
            "notes": t.notes,
            "executed_at": str(t.executed_at) if t.executed_at else None,
        })

    # All sell trades for stats
    all_sells = (
        db.query(VirtualTrade)
        .filter(
            VirtualTrade.portfolio_id == portfolio_id,
            VirtualTrade.side == "sell",
            VirtualTrade.realized_pnl.isnot(None),
        )
        .all()
    )

    wins = [t for t in all_sells if t.realized_pnl > 0]
    losses = [t for t in all_sells if t.realized_pnl <= 0]

    total_closed = len(all_sells)
    win_rate = round((len(wins) / total_closed) * 100, 1) if total_closed > 0 else 0.0
    avg_win = round(sum(t.realized_pnl for t in wins) / len(wins), 2) if wins else 0.0
    avg_loss = round(sum(t.realized_pnl for t in losses) / len(losses), 2) if losses else 0.0
    total_wins = sum(t.realized_pnl for t in wins)
    total_losses = abs(sum(t.realized_pnl for t in losses))
    profit_factor = round(total_wins / total_losses, 2) if total_losses > 0 else (
        float("inf") if total_wins > 0 else 0.0
    )

    best_trade = max(all_sells, key=lambda t: t.realized_pnl).realized_pnl if all_sells else 0.0
    worst_trade = min(all_sells, key=lambda t: t.realized_pnl).realized_pnl if all_sells else 0.0

    # Equity curve
    snapshots = get_equity_curve(db, portfolio_id)

    # Portfolio-level stats
    total_return = round(portfolio.total_value - portfolio.starting_capital, 2)
    total_return_pct = (
        round((total_return / portfolio.starting_capital) * 100, 2)
        if portfolio.starting_capital > 0 else 0.0
    )
    hwm = portfolio.high_water_mark or portfolio.total_value
    max_drawdown = round(((hwm - portfolio.total_value) / hwm) * 100, 2) if hwm > 0 else 0.0

    # Max drawdown from snapshots (peak-to-trough)
    if snapshots:
        max_drawdown = max(max_drawdown, max(s["drawdown_pct"] for s in snapshots))

    return {
        "portfolio_id": portfolio_id,
        "name": portfolio.name,
        "strategy": portfolio.strategy,
        "is_active": portfolio.is_active,
        "starting_capital": portfolio.starting_capital,
        "cash": portfolio.cash_balance,
        "total_value": portfolio.total_value,
        "total_return": total_return,
        "total_return_pct": total_return_pct,
        "high_water_mark": hwm,
        "max_drawdown_pct": round(max_drawdown, 2),
        "positions": position_list,
        "num_positions": len(position_list),
        "recent_trades": recent_trades,
        "daily_snapshots": snapshots,
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "total_trades": total_closed,
        "winning_trades": len(wins),
        "losing_trades": len(losses),
        "best_trade": round(best_trade, 2),
        "worst_trade": round(worst_trade, 2),
    }


# ── Query Helpers ────────────────────────────────────────────────────────────

def get_trade_history(db: Session, portfolio_id: int, limit: int = 50) -> list[dict]:
    """Return recent trade history for a portfolio."""
    trades = (
        db.query(VirtualTrade)
        .filter(VirtualTrade.portfolio_id == portfolio_id)
        .order_by(desc(VirtualTrade.executed_at))
        .limit(limit)
        .all()
    )

    result = []
    for t in trades:
        card = db.query(Card).filter(Card.id == t.card_id).first()
        result.append({
            "trade_id": t.id,
            "card_id": t.card_id,
            "card_name": card.name if card else "Unknown",
            "card_image": card.image_small if card else None,
            "side": t.side,
            "quantity": t.quantity,
            "signal_price": t.signal_price,
            "execution_price": t.execution_price,
            "slippage_pct": t.slippage_pct,
            "slippage_cost": t.slippage_cost,
            "fee_cost": t.fee_cost,
            "total_cost": t.total_cost,
            "realized_pnl": t.realized_pnl,
            "realized_pnl_pct": t.realized_pnl_pct,
            "signal": t.signal,
            "strategy": t.strategy,
            "notes": t.notes,
            "executed_at": str(t.executed_at) if t.executed_at else None,
        })
    return result


def get_equity_curve(db: Session, portfolio_id: int) -> list[dict]:
    """Return daily value snapshots for plotting the equity curve."""
    snapshots = (
        db.query(PortfolioSnapshot)
        .filter(PortfolioSnapshot.portfolio_id == portfolio_id)
        .order_by(PortfolioSnapshot.date)
        .all()
    )

    return [
        {
            "date": str(s.date),
            "cash": s.cash,
            "positions_value": s.positions_value,
            "total_value": s.total_value,
            "daily_pnl": s.daily_pnl,
            "daily_pnl_pct": s.daily_pnl_pct,
            "cumulative_pnl": s.cumulative_pnl,
            "cumulative_pnl_pct": s.cumulative_pnl_pct,
            "num_positions": s.num_positions,
            "high_water_mark": s.high_water_mark,
            "drawdown_pct": s.drawdown_pct,
        }
        for s in snapshots
    ]


def reset_portfolio(db: Session, portfolio_id: int, starting_capital: float = 10000.0) -> dict:
    """Reset portfolio: close all positions, clear trades, reset cash."""
    # Delete positions
    db.query(VirtualPosition).filter(VirtualPosition.portfolio_id == portfolio_id).delete()
    # Delete trades
    db.query(VirtualTrade).filter(VirtualTrade.portfolio_id == portfolio_id).delete()
    # Delete snapshots
    db.query(PortfolioSnapshot).filter(PortfolioSnapshot.portfolio_id == portfolio_id).delete()
    # Reset portfolio
    portfolio = db.query(VirtualPortfolio).filter(VirtualPortfolio.id == portfolio_id).first()
    if portfolio:
        portfolio.starting_capital = starting_capital
        portfolio.cash_balance = starting_capital
        portfolio.total_value = starting_capital
        portfolio.high_water_mark = starting_capital
    db.commit()
    return {"status": "reset", "starting_capital": starting_capital}


def get_performance_analytics(db: Session, portfolio_id: int) -> dict:
    """Detailed performance analytics for the portfolio."""
    from sqlalchemy import func as sqlfunc

    portfolio = db.query(VirtualPortfolio).filter(VirtualPortfolio.id == portfolio_id).first()
    if not portfolio:
        return {}

    trades = db.query(VirtualTrade).filter(
        VirtualTrade.portfolio_id == portfolio_id
    ).order_by(VirtualTrade.executed_at.desc()).all()

    sells = [t for t in trades if t.side == "sell" and t.realized_pnl is not None]
    wins = [t for t in sells if t.realized_pnl > 0]
    losses = [t for t in sells if t.realized_pnl <= 0]

    total_return = ((portfolio.total_value - portfolio.starting_capital) / portfolio.starting_capital) * 100 if portfolio.starting_capital else 0
    win_rate = (len(wins) / len(sells) * 100) if sells else 0
    avg_win = sum(t.realized_pnl for t in wins) / len(wins) if wins else 0
    avg_loss = sum(t.realized_pnl for t in losses) / len(losses) if losses else 0
    gross_profit = sum(t.realized_pnl for t in wins) if wins else 0
    gross_loss = abs(sum(t.realized_pnl for t in losses)) if losses else 0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf') if gross_profit > 0 else 0

    # Drawdown from snapshots
    snapshots = db.query(PortfolioSnapshot).filter(
        PortfolioSnapshot.portfolio_id == portfolio_id
    ).order_by(PortfolioSnapshot.date).all()
    max_drawdown = min((s.drawdown_pct for s in snapshots), default=0)

    # Sharpe approximation from daily returns
    daily_returns = [s.daily_pnl_pct for s in snapshots if s.daily_pnl_pct is not None]
    if len(daily_returns) > 1:
        import statistics
        mean_r = statistics.mean(daily_returns)
        std_r = statistics.stdev(daily_returns)
        sharpe = (mean_r / std_r) * (252 ** 0.5) if std_r > 0 else 0
    else:
        sharpe = 0

    # Best/worst trades
    best = max(sells, key=lambda t: t.realized_pnl) if sells else None
    worst = min(sells, key=lambda t: t.realized_pnl) if sells else None

    # By strategy
    strategies = {}
    for t in sells:
        strat = t.strategy or "unknown"
        if strat not in strategies:
            strategies[strat] = {"count": 0, "wins": 0, "total_pnl": 0}
        strategies[strat]["count"] += 1
        strategies[strat]["total_pnl"] += t.realized_pnl or 0
        if t.realized_pnl and t.realized_pnl > 0:
            strategies[strat]["wins"] += 1
    for s in strategies.values():
        s["win_rate"] = round(s["wins"] / s["count"] * 100, 1) if s["count"] else 0
        s["avg_pnl"] = round(s["total_pnl"] / s["count"], 2) if s["count"] else 0

    # By signal
    signals = {}
    for t in sells:
        sig = t.signal or "unknown"
        if sig not in signals:
            signals[sig] = {"count": 0, "wins": 0, "total_pnl": 0}
        signals[sig]["count"] += 1
        signals[sig]["total_pnl"] += t.realized_pnl or 0
        if t.realized_pnl and t.realized_pnl > 0:
            signals[sig]["wins"] += 1
    for s in signals.values():
        s["win_rate"] = round(s["wins"] / s["count"] * 100, 1) if s["count"] else 0
        s["avg_pnl"] = round(s["total_pnl"] / s["count"], 2) if s["count"] else 0

    return {
        "total_return_pct": round(total_return, 2),
        "sharpe_ratio": round(sharpe, 2),
        "max_drawdown_pct": round(max_drawdown, 2),
        "win_rate": round(win_rate, 1),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "profit_factor": round(profit_factor, 2) if profit_factor != float('inf') else None,
        "total_trades": len(trades),
        "total_sells": len(sells),
        "best_trade": {
            "card_name": best.notes or f"card_{best.card_id}",
            "pnl": round(best.realized_pnl, 2),
            "pnl_pct": round(best.realized_pnl_pct or 0, 1),
        } if best else None,
        "worst_trade": {
            "card_name": worst.notes or f"card_{worst.card_id}",
            "pnl": round(worst.realized_pnl, 2),
            "pnl_pct": round(worst.realized_pnl_pct or 0, 1),
        } if worst else None,
        "by_strategy": strategies,
        "by_signal": signals,
    }


def get_strategy_leaderboard(db: Session) -> list[dict]:
    """Compare all portfolios by performance."""
    portfolios = db.query(VirtualPortfolio).filter(VirtualPortfolio.is_active == True).all()
    results = []
    for p in portfolios:
        total_return = ((p.total_value - p.starting_capital) / p.starting_capital) * 100 if p.starting_capital else 0
        results.append({
            "portfolio_id": p.id,
            "name": p.name,
            "strategy": p.strategy,
            "total_value": round(p.total_value, 2),
            "total_return_pct": round(total_return, 2),
            "high_water_mark": round(p.high_water_mark, 2),
        })
    return sorted(results, key=lambda x: x["total_return_pct"], reverse=True)
