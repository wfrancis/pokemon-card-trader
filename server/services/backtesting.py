"""
Backtesting engine for Pokemon card trading strategies.

Simulates buying/selling cards based on technical indicator signals,
then measures performance (total return, win rate, Sharpe ratio, etc.)
against historical price data.

Strategies available:
  - SMA Crossover: Buy when short SMA crosses above long SMA, sell on cross below
  - RSI Mean Reversion: Buy when RSI < 30 (oversold), sell when RSI > 70 (overbought)
  - MACD Signal: Buy on bullish MACD crossover, sell on bearish crossover
  - Bollinger Bounce: Buy near lower band, sell near upper band
  - Combined: Use all indicators with weighted scoring (same as live signal)
"""
import math
import logging
from dataclasses import dataclass, field, asdict
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import asc
from server.models.card import Card
from server.models.price_history import PriceHistory
from server.services.market_analysis import _sma, _ema, _rsi, _macd, _bollinger_bands, _filter_dominant_variant

logger = logging.getLogger(__name__)

MAX_STRATEGY_RETURN_PCT = 10000.0  # Cap returns at 10,000% to prevent overflow display


def _clean_outliers(prices: list[float], window_size: int = 7) -> list[float]:
    """Replace price outliers with local median to prevent false backtest signals.

    A price > 3x or < 0.33x the local median is replaced with the median.
    This handles bad data points (e.g., cents stored as dollars) that cause
    astronomical fake returns.
    """
    cleaned = list(prices)
    for i in range(len(cleaned)):
        start = max(0, i - window_size)
        end = min(len(cleaned), i + window_size + 1)
        window = sorted(cleaned[start:end])
        median = window[len(window) // 2]
        if median > 0 and (cleaned[i] > median * 3 or cleaned[i] < median * 0.33):
            cleaned[i] = median
    return cleaned


@dataclass
class Trade:
    """A single buy or sell action."""
    date: date
    action: str  # "buy" or "sell"
    price: float
    signal_reason: str = ""


@dataclass
class BacktestResult:
    """Results from a backtest run."""
    strategy: str = ""
    card_id: int = 0
    card_name: str = ""
    start_date: date | None = None
    end_date: date | None = None
    initial_price: float = 0.0
    final_price: float = 0.0
    buy_hold_return_pct: float = 0.0
    strategy_return_pct: float = 0.0
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    win_rate: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float | None = None
    trades: list[Trade] = field(default_factory=list)
    daily_values: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        # Convert date objects to strings
        if d["start_date"]:
            d["start_date"] = str(d["start_date"])
        if d["end_date"]:
            d["end_date"] = str(d["end_date"])
        for t in d["trades"]:
            t["date"] = str(t["date"])
        return d


STRATEGIES = {
    "sma_crossover": "SMA Crossover (7/30)",
    "rsi_mean_reversion": "RSI Mean Reversion",
    "macd_signal": "MACD Signal Line",
    "bollinger_bounce": "Bollinger Band Bounce",
    "combined": "Combined Indicators",
    "momentum_breakout": "Momentum Breakout",
    "mean_reversion_bands": "Mean Reversion + Bands",
    "trend_rider": "Trend Rider (EMA Stack)",
}


def _compute_indicators_at_point(prices: list[float]) -> dict:
    """Compute all indicators for the price series up to this point."""
    return {
        "sma_7": _sma(prices, 7),
        "sma_30": _sma(prices, 30),
        "ema_12": _ema(prices, 12),
        "ema_26": _ema(prices, 26),
        "rsi_14": _rsi(prices, 14),
        "macd": _macd(prices),
        "bollinger": _bollinger_bands(prices, 20, 2.0),
    }


def _sma_crossover_signal(indicators: dict, prev_indicators: dict | None) -> str | None:
    """SMA crossover: buy when 7-day crosses above 30-day, sell on cross below."""
    sma_7 = indicators.get("sma_7")
    sma_30 = indicators.get("sma_30")
    if sma_7 is None or sma_30 is None:
        return None

    if prev_indicators:
        prev_sma_7 = prev_indicators.get("sma_7")
        prev_sma_30 = prev_indicators.get("sma_30")
        if prev_sma_7 is not None and prev_sma_30 is not None:
            # Golden cross: short crosses above long
            if prev_sma_7 <= prev_sma_30 and sma_7 > sma_30:
                return "buy"
            # Death cross: short crosses below long
            if prev_sma_7 >= prev_sma_30 and sma_7 < sma_30:
                return "sell"
    return None


def _rsi_signal(indicators: dict) -> str | None:
    """RSI: buy when oversold (<30), sell when overbought (>70)."""
    rsi = indicators.get("rsi_14")
    if rsi is None:
        return None
    if rsi < 30:
        return "buy"
    if rsi > 70:
        return "sell"
    return None


def _macd_crossover_signal(indicators: dict, prev_indicators: dict | None) -> str | None:
    """MACD: buy on bullish crossover, sell on bearish."""
    macd_line, signal, histogram = indicators.get("macd", (None, None, None))
    if macd_line is None or signal is None:
        return None

    if prev_indicators:
        prev_macd = prev_indicators.get("macd", (None, None, None))
        prev_line, prev_signal = prev_macd[0], prev_macd[1]
        if prev_line is not None and prev_signal is not None:
            if prev_line <= prev_signal and macd_line > signal:
                return "buy"
            if prev_line >= prev_signal and macd_line < signal:
                return "sell"
    return None


def _bollinger_signal(indicators: dict, current_price: float) -> str | None:
    """Bollinger: buy near lower band, sell near upper band."""
    upper, middle, lower = indicators.get("bollinger", (None, None, None))
    if upper is None or lower is None or middle is None:
        return None

    band_range = upper - lower
    if band_range <= 0:
        return None

    position = (current_price - lower) / band_range
    if position < 0.1:  # Below 10% of band
        return "buy"
    if position > 0.9:  # Above 90% of band
        return "sell"
    return None


def _combined_signal(indicators: dict, prev_indicators: dict | None, current_price: float) -> str | None:
    """Combined: weighted scoring of all indicators."""
    score = 0.0
    factors = 0

    # RSI
    rsi = indicators.get("rsi_14")
    if rsi is not None:
        if rsi < 30:
            score += 1.0
        elif rsi > 70:
            score -= 1.0
        else:
            score += (50 - rsi) / 50
        factors += 1

    # MACD histogram
    _, _, histogram = indicators.get("macd", (None, None, None))
    if histogram is not None:
        score += 0.5 if histogram > 0 else -0.5
        factors += 1

    # Price vs SMA
    sma_30 = indicators.get("sma_30")
    if sma_30 is not None and sma_30 > 0:
        score += 0.5 if current_price > sma_30 else -0.5
        factors += 1

    # Bollinger
    upper, _, lower = indicators.get("bollinger", (None, None, None))
    if upper is not None and lower is not None:
        band_range = upper - lower
        if band_range > 0:
            position = (current_price - lower) / band_range
            if position < 0.2:
                score += 0.7
            elif position > 0.8:
                score -= 0.7
            factors += 1

    if factors == 0:
        return None

    strength = score / factors
    if strength > 0.3:
        return "buy"
    elif strength < -0.3:
        return "sell"
    return None


def _momentum_breakout_signal(indicators: dict, prev_indicators: dict | None, prices: list[float]) -> str | None:
    """Momentum Breakout: buy when price breaks above resistance with strong momentum.

    Collectibles-specific: cards often have sharp price spikes driven by tournament results,
    YouTube openings, or nostalgia cycles. This strategy catches breakouts early.
    """
    sma_7 = indicators.get("sma_7")
    sma_30 = indicators.get("sma_30")
    rsi = indicators.get("rsi_14")
    if sma_7 is None or sma_30 is None or rsi is None or len(prices) < 20:
        return None

    current = prices[-1]
    recent_high = max(prices[-20:])
    recent_low = min(prices[-20:])
    price_range = recent_high - recent_low

    if price_range <= 0:
        return None

    # Buy: price near 20-day high + upward momentum + RSI not yet overbought
    position_in_range = (current - recent_low) / price_range
    if position_in_range > 0.85 and sma_7 > sma_30 and rsi < 65:
        return "buy"

    # Sell: momentum fading (RSI dropping from high) or price drops below SMA30
    if prev_indicators:
        prev_rsi = prev_indicators.get("rsi_14")
        if prev_rsi and prev_rsi > 70 and rsi < 65:
            return "sell"
    if current < sma_30 * 0.98:  # 2% below SMA30 = stop loss
        return "sell"

    return None


def _mean_reversion_bands_signal(indicators: dict, current_price: float) -> str | None:
    """Mean Reversion + Bands: buy at extreme lows, sell at mean.

    Collectibles-specific: Pokemon cards tend to mean-revert after panic selling
    or hype spikes. This is more conservative than pure Bollinger — it waits for
    extreme deviations and sells at the middle band, not the upper.
    """
    upper, middle, lower = indicators.get("bollinger", (None, None, None))
    rsi = indicators.get("rsi_14")
    if upper is None or lower is None or middle is None or rsi is None:
        return None

    band_range = upper - lower
    if band_range <= 0:
        return None

    position = (current_price - lower) / band_range

    # Buy: extreme oversold — below lower band AND RSI confirms oversold
    if position < 0.05 and rsi < 25:
        return "buy"

    # Sell: price returns to middle band (mean reversion target)
    if position > 0.45 and position < 0.55 and rsi > 45:
        return "sell"

    # Stop loss: if price drops further below entry (20% below lower band)
    if position < -0.2:
        return "sell"

    return None


def _trend_rider_signal(indicators: dict, prev_indicators: dict | None) -> str | None:
    """Trend Rider (EMA Stack): ride sustained trends using EMA alignment.

    Collectibles-specific: when a card enters a sustained uptrend (new set hype,
    competitive meta shift), EMAs stack bullishly. This strategy stays in the
    trend longer than crossover strategies.
    """
    ema_12 = indicators.get("ema_12")
    ema_26 = indicators.get("ema_26")
    sma_7 = indicators.get("sma_7")
    sma_30 = indicators.get("sma_30")
    rsi = indicators.get("rsi_14")
    if any(v is None for v in [ema_12, ema_26, sma_7, sma_30]):
        return None

    # Bullish stack: SMA7 > EMA12 > EMA26 > SMA30
    bullish_stack = sma_7 > ema_12 > ema_26 and ema_12 > sma_30 * 0.99

    # Bearish stack: SMA7 < EMA12 < EMA26
    bearish_stack = sma_7 < ema_12 < ema_26

    if prev_indicators:
        prev_ema_12 = prev_indicators.get("ema_12")
        prev_ema_26 = prev_indicators.get("ema_26")
        if prev_ema_12 is not None and prev_ema_26 is not None:
            was_bearish = prev_ema_12 < prev_ema_26
            # Buy: transition from bearish to bullish stack
            if bullish_stack and was_bearish:
                return "buy"
            # Sell: stack breaks down
            if bearish_stack and not was_bearish:
                return "sell"

    return None


def run_backtest(
    db: Session,
    card_id: int,
    strategy: str = "combined",
    initial_capital: float = 1000.0,
) -> BacktestResult | None:
    """Run a backtest for a single card with the specified strategy.

    Simulates going long (buying) when the strategy signals buy,
    and selling when it signals sell. Starts with initial_capital.

    Args:
        db: SQLAlchemy session.
        card_id: Card to backtest.
        strategy: One of STRATEGIES keys.
        initial_capital: Starting capital in USD.

    Returns:
        BacktestResult with performance metrics, or None if insufficient data.
    """
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        return None

    records = (
        db.query(PriceHistory)
        .filter(PriceHistory.card_id == card_id, PriceHistory.market_price.isnot(None))
        .order_by(asc(PriceHistory.date), asc(PriceHistory.id))
        .all()
    )

    # Filter to dominant variant to avoid mixed-variant noise
    records = _filter_dominant_variant(records)

    if len(records) < 35:  # Need enough data for indicators
        return None

    # Deduplicate: one price per date (last record wins)
    date_prices: dict[date, float] = {}
    for r in records:
        date_prices[r.date] = r.market_price
    sorted_dates = sorted(date_prices.keys())
    dates = sorted_dates
    prices = [date_prices[d] for d in sorted_dates]

    if len(prices) < 35:
        return None

    # Clean outliers: replace prices > 3x or < 0.33x the local median
    prices = _clean_outliers(prices, window_size=7)

    result = BacktestResult(
        strategy=STRATEGIES.get(strategy, strategy),
        card_id=card_id,
        card_name=card.name,
        start_date=dates[0],
        end_date=dates[-1],
        initial_price=prices[0],
        final_price=prices[-1],
    )

    # Buy-and-hold benchmark
    if prices[0] > 0:
        result.buy_hold_return_pct = round(
            ((prices[-1] - prices[0]) / prices[0]) * 100, 2
        )

    # Run strategy simulation
    cash = initial_capital
    holdings = 0.0  # Number of "shares" (cards)
    trades: list[Trade] = []
    daily_values: list[dict] = []
    prev_indicators = None
    peak_value = initial_capital

    # Track returns for Sharpe ratio
    daily_returns: list[float] = []
    prev_portfolio_value = initial_capital

    for i in range(30, len(prices)):  # Start after enough data for indicators
        price_slice = prices[:i + 1]
        current_price = prices[i]
        current_date = dates[i]

        indicators = _compute_indicators_at_point(price_slice)

        # Get signal based on strategy
        signal = None
        if strategy == "sma_crossover":
            signal = _sma_crossover_signal(indicators, prev_indicators)
        elif strategy == "rsi_mean_reversion":
            signal = _rsi_signal(indicators)
        elif strategy == "macd_signal":
            signal = _macd_crossover_signal(indicators, prev_indicators)
        elif strategy == "bollinger_bounce":
            signal = _bollinger_signal(indicators, current_price)
        elif strategy == "combined":
            signal = _combined_signal(indicators, prev_indicators, current_price)
        elif strategy == "momentum_breakout":
            signal = _momentum_breakout_signal(indicators, prev_indicators, price_slice)
        elif strategy == "mean_reversion_bands":
            signal = _mean_reversion_bands_signal(indicators, current_price)
        elif strategy == "trend_rider":
            signal = _trend_rider_signal(indicators, prev_indicators)

        # Execute trades
        if signal == "buy" and cash > 0 and holdings == 0:
            # Buy: spend all cash
            holdings = cash / current_price
            cash = 0
            trades.append(Trade(
                date=current_date,
                action="buy",
                price=current_price,
                signal_reason=strategy,
            ))
        elif signal == "sell" and holdings > 0:
            # Sell: liquidate all holdings
            cash = holdings * current_price
            holdings = 0
            trades.append(Trade(
                date=current_date,
                action="sell",
                price=current_price,
                signal_reason=strategy,
            ))

        # Track portfolio value
        portfolio_value = cash + (holdings * current_price)
        daily_values.append({
            "date": str(current_date),
            "price": round(current_price, 2),
            "portfolio_value": round(portfolio_value, 2),
            "cash": round(cash, 2),
            "holdings_value": round(holdings * current_price, 2),
            "in_position": holdings > 0,
        })

        # Daily return for Sharpe
        if prev_portfolio_value > 0:
            daily_return = (portfolio_value - prev_portfolio_value) / prev_portfolio_value
            daily_returns.append(daily_return)
        prev_portfolio_value = portfolio_value

        # Max drawdown
        if portfolio_value > peak_value:
            peak_value = portfolio_value
        drawdown = ((peak_value - portfolio_value) / peak_value) * 100 if peak_value > 0 else 0
        if drawdown > result.max_drawdown_pct:
            result.max_drawdown_pct = round(drawdown, 2)

        prev_indicators = indicators

    # If still holding at the end, mark final value
    final_value = cash + (holdings * prices[-1])

    # Calculate strategy return (capped to prevent overflow display)
    if initial_capital > 0:
        raw_return = ((final_value - initial_capital) / initial_capital) * 100
        result.strategy_return_pct = round(
            min(MAX_STRATEGY_RETURN_PCT, max(-100.0, raw_return)), 2
        )

    # Trade analysis
    result.trades = trades
    result.daily_values = daily_values
    result.total_trades = len(trades)

    # Calculate win/loss from completed trade pairs
    buy_price = None
    for trade in trades:
        if trade.action == "buy":
            buy_price = trade.price
        elif trade.action == "sell" and buy_price is not None:
            if trade.price > buy_price:
                result.winning_trades += 1
            else:
                result.losing_trades += 1
            buy_price = None

    completed = result.winning_trades + result.losing_trades
    result.win_rate = round(
        (result.winning_trades / completed * 100) if completed > 0 else 0, 1
    )

    # Sharpe ratio (annualized, assuming 365 trading days for crypto/collectibles)
    if len(daily_returns) > 1:
        avg_return = sum(daily_returns) / len(daily_returns)
        std_return = math.sqrt(
            sum((r - avg_return) ** 2 for r in daily_returns) / (len(daily_returns) - 1)
        )
        if std_return > 0:
            result.sharpe_ratio = round(
                (avg_return / std_return) * math.sqrt(365), 2
            )

    return result


def run_backtest_all_strategies(
    db: Session,
    card_id: int,
    initial_capital: float = 1000.0,
) -> list[dict]:
    """Run all strategies on a single card and return comparative results."""
    results = []
    for strategy_key in STRATEGIES:
        result = run_backtest(db, card_id, strategy=strategy_key, initial_capital=initial_capital)
        if result:
            results.append(result.to_dict())
    return results


def run_portfolio_backtest(
    db: Session,
    strategy: str = "combined",
    top_n: int = 10,
    initial_capital: float = 10000.0,
) -> dict:
    """Run a backtest across the top N cards by data availability.

    Allocates equal capital to each card, runs the strategy independently,
    and aggregates results.

    Args:
        db: SQLAlchemy session.
        strategy: Strategy to use.
        top_n: Number of cards to include.
        initial_capital: Total starting capital.

    Returns:
        Aggregated portfolio backtest results.
    """
    from sqlalchemy import func

    # Find tracked cards with most price history
    from server.models.card import Card
    card_ids = [
        row[0]
        for row in (
            db.query(PriceHistory.card_id, func.count(PriceHistory.id).label("cnt"))
            .join(Card, Card.id == PriceHistory.card_id)
            .filter(PriceHistory.market_price.isnot(None), Card.is_tracked == True)
            .group_by(PriceHistory.card_id)
            .having(func.count(PriceHistory.id) >= 35)
            .order_by(func.count(PriceHistory.id).desc())
            .limit(top_n)
            .all()
        )
    ]

    if not card_ids:
        return {"error": "No cards with sufficient price history for backtesting"}

    per_card_capital = initial_capital / len(card_ids)
    card_results = []
    total_final_value = 0
    total_trades = 0

    for card_id in card_ids:
        result = run_backtest(db, card_id, strategy=strategy, initial_capital=per_card_capital)
        if result:
            card_results.append({
                "card_id": result.card_id,
                "card_name": result.card_name,
                "strategy_return_pct": result.strategy_return_pct,
                "buy_hold_return_pct": result.buy_hold_return_pct,
                "win_rate": result.win_rate,
                "total_trades": result.total_trades,
                "max_drawdown_pct": result.max_drawdown_pct,
                "sharpe_ratio": result.sharpe_ratio,
            })
            final_val = per_card_capital * (1 + result.strategy_return_pct / 100)
            total_final_value += final_val
            total_trades += result.total_trades
        else:
            total_final_value += per_card_capital  # No trades = capital preserved

    portfolio_return = ((total_final_value - initial_capital) / initial_capital) * 100 if initial_capital > 0 else 0

    # Buy-and-hold benchmark for portfolio
    bh_total = sum(
        per_card_capital * (1 + r["buy_hold_return_pct"] / 100)
        for r in card_results
    )
    bh_return = ((bh_total - initial_capital) / initial_capital) * 100 if initial_capital > 0 else 0

    return {
        "strategy": STRATEGIES.get(strategy, strategy),
        "cards_count": len(card_results),
        "initial_capital": initial_capital,
        "final_value": round(total_final_value, 2),
        "portfolio_return_pct": round(portfolio_return, 2),
        "buy_hold_return_pct": round(bh_return, 2),
        "alpha": round(portfolio_return - bh_return, 2),
        "total_trades": total_trades,
        "card_results": card_results,
    }
