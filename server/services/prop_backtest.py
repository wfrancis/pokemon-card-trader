"""Multi-year backtest engine for the prop trading system.

Simulates the prop trading strategies against historical price data,
including realistic slippage and TCGPlayer fees. Walks forward through
time, generating signals and executing virtual trades at each time step.

No AI API calls — pure historical simulation.
"""
import logging
import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import asc, func
from sqlalchemy.orm import Session

from server.models.card import Card
from server.models.price_history import PriceHistory
from server.models.sale import Sale
from server.services.market_analysis import (
    _sma,
    _rsi,
    _macd,
    _bollinger_bands,
    _adx,
    _detect_regime,
    _filter_dominant_variant,
)
from server.services.trading_economics import (
    calc_breakeven_appreciation,
    calc_sell_proceeds,
    calc_buy_cost,
    calc_liquidity_score,
)
from server.services.virtual_trader import calculate_slippage

logger = logging.getLogger(__name__)

# ── Constants (mirror prop_strategies.py) ────────────────────────────────────

DEFAULT_STOP_LOSS_PCT = 0.15
DEFAULT_TAKE_PROFIT_PCT = 0.30
STALE_POSITION_DAYS = 90
STALE_GAIN_THRESHOLD = 0.05
MIN_DATA_POINTS = 3

STRATEGY_SMA_CROSS = "sma_golden_cross"
STRATEGY_RSI_OVERSOLD = "rsi_oversold_bounce"
STRATEGY_SPREAD_COMPRESSION = "spread_compression"
STRATEGY_MEAN_REVERSION = "mean_reversion"
STRATEGY_MOMENTUM = "momentum_breakout"

ALL_BUY_STRATEGIES = [
    STRATEGY_SMA_CROSS,
    STRATEGY_RSI_OVERSOLD,
    STRATEGY_SPREAD_COMPRESSION,
    STRATEGY_MEAN_REVERSION,
    STRATEGY_MOMENTUM,
]

# TCGPlayer simplified seller fee rate (matches virtual_trader.py)
TCGPLAYER_SELLER_FEE_RATE = 0.1255


# ── Price Cache ──────────────────────────────────────────────────────────────

@dataclass
class CardPriceData:
    """Pre-loaded price series for a single card."""
    card_id: int
    card_name: str
    set_id: str
    set_name: str
    dates: list[date] = field(default_factory=list)
    prices: list[float] = field(default_factory=list)
    mid_prices: list[Optional[float]] = field(default_factory=list)
    # Sales velocity cache: {month_key: count}
    monthly_sales: dict[str, int] = field(default_factory=dict)


def _build_price_cache(db: Session, min_price: float) -> dict[int, CardPriceData]:
    """Pre-load all price history into memory for fast backtesting.

    Filters to tracked cards with current_price >= min_price.
    Deduplicates to one price per date per card (dominant variant).
    """
    logger.info("Building price cache...")

    # Get eligible cards
    cards = (
        db.query(Card)
        .filter(
            Card.is_tracked == True,
            Card.current_price.isnot(None),
            Card.current_price >= min_price,
        )
        .all()
    )
    card_map = {c.id: c for c in cards}
    card_ids = list(card_map.keys())

    if not card_ids:
        logger.warning("No eligible cards found for backtest")
        return {}

    # Batch-load all price history for eligible cards
    all_records = (
        db.query(PriceHistory)
        .filter(
            PriceHistory.card_id.in_(card_ids),
            PriceHistory.market_price.isnot(None),
        )
        .order_by(PriceHistory.card_id, asc(PriceHistory.date), asc(PriceHistory.id))
        .all()
    )

    # Group by card_id
    records_by_card: dict[int, list] = {}
    for r in all_records:
        records_by_card.setdefault(r.card_id, []).append(r)

    # Build cache
    cache: dict[int, CardPriceData] = {}
    for card_id, records in records_by_card.items():
        card = card_map.get(card_id)
        if not card:
            continue

        # Filter to dominant variant
        filtered = _filter_dominant_variant(records)
        if len(filtered) < MIN_DATA_POINTS:
            continue

        # Deduplicate: one price per date (last record wins)
        date_prices: dict[date, tuple[float, Optional[float]]] = {}
        for r in filtered:
            date_prices[r.date] = (r.market_price, getattr(r, "mid_price", None))

        sorted_dates = sorted(date_prices.keys())
        prices = [date_prices[d][0] for d in sorted_dates]
        mid_prices = [date_prices[d][1] for d in sorted_dates]

        if len(prices) < MIN_DATA_POINTS:
            continue

        cache[card_id] = CardPriceData(
            card_id=card_id,
            card_name=card.name,
            set_id=card.set_id or "",
            set_name=card.set_name or "",
            dates=sorted_dates,
            prices=prices,
            mid_prices=mid_prices,
        )

    # Pre-load sales velocity data
    all_sales = (
        db.query(
            Sale.card_id,
            func.strftime("%Y-%m", Sale.order_date).label("month_key"),
            func.count(Sale.id).label("count"),
        )
        .filter(Sale.card_id.in_(card_ids))
        .group_by(Sale.card_id, "month_key")
        .all()
    )
    for row in all_sales:
        if row.card_id in cache:
            cache[row.card_id].monthly_sales[row.month_key] = row.count

    logger.info("Price cache built: %d cards with %d+ data points",
                len(cache), MIN_DATA_POINTS)
    return cache


def _get_prices_up_to(cpd: CardPriceData, sim_date: date) -> tuple[list[date], list[float]]:
    """Return dates and prices for a card up to (inclusive) sim_date.

    No lookahead bias -- only data available at sim_date.
    """
    # Binary search for efficiency
    dates = cpd.dates
    if not dates or dates[0] > sim_date:
        return [], []

    # Find rightmost index where date <= sim_date
    lo, hi = 0, len(dates) - 1
    idx = -1
    while lo <= hi:
        mid = (lo + hi) // 2
        if dates[mid] <= sim_date:
            idx = mid
            lo = mid + 1
        else:
            hi = mid - 1

    if idx < 0:
        return [], []

    end = idx + 1
    return dates[:end], cpd.prices[:end]


def _estimate_sales_velocity(cpd: CardPriceData, sim_date: date) -> float:
    """Estimate sales/day at a point in time from monthly sales data."""
    # Look at last 30 days of sales data
    month_key = sim_date.strftime("%Y-%m")
    prev_month = (sim_date.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")

    sales_current = cpd.monthly_sales.get(month_key, 0)
    sales_prev = cpd.monthly_sales.get(prev_month, 0)

    # Blend current + previous month
    total = sales_current + sales_prev
    return total / 60.0  # approximate daily rate over 2 months


def _estimate_liquidity_score(cpd: CardPriceData, sim_date: date, current_price: float) -> float:
    """Estimate liquidity score at a historical point in time."""
    month_key = sim_date.strftime("%Y-%m")
    prev_month = (sim_date.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    two_months_ago = (sim_date.replace(day=1) - timedelta(days=32)).strftime("%Y-%m")

    sales_30d = cpd.monthly_sales.get(month_key, 0)
    sales_90d = (
        cpd.monthly_sales.get(month_key, 0)
        + cpd.monthly_sales.get(prev_month, 0)
        + cpd.monthly_sales.get(two_months_ago, 0)
    )

    return calc_liquidity_score(
        sales_90d=sales_90d,
        sales_30d=sales_30d,
        card_price=current_price,
    )


# ── Technical Data at Historical Point ───────────────────────────────────────

def _compute_technical_data_at_date(
    cpd: CardPriceData,
    sim_date: date,
) -> Optional[dict]:
    """Compute technical indicators using ONLY data available at sim_date.

    This is the backtest equivalent of prop_strategies.get_technical_data(),
    but computed purely from the price cache with no DB queries or lookahead.
    """
    dates, prices = _get_prices_up_to(cpd, sim_date)
    if len(prices) < MIN_DATA_POINTS:
        return None

    current_price = prices[-1]
    if current_price <= 0:
        return None

    # Compute indicators
    sma_7 = _sma(prices, 7)
    sma_30 = _sma(prices, 30)
    rsi_14 = _rsi(prices, 14)
    macd_line, macd_signal, macd_histogram = _macd(prices)
    bb_upper, bb_middle, bb_lower = _bollinger_bands(prices, 20, 2.0)
    adx_val = _adx(prices)
    regime = _detect_regime(prices, adx_val)

    # Previous-day indicators for crossover detection
    prev_sma_7 = _sma(prices[:-1], 7) if len(prices) > 7 else None
    prev_sma_30 = _sma(prices[:-1], 30) if len(prices) > 30 else None

    # 30-day high
    high_30d = max(prices[-30:]) if len(prices) >= 30 else max(prices)

    # Sales velocity estimated from cache
    sales_per_day = _estimate_sales_velocity(cpd, sim_date)
    liquidity_score = _estimate_liquidity_score(cpd, sim_date, current_price)

    # Spread % from mid vs market
    spread_pct = None
    idx = len(dates) - 1
    if idx < len(cpd.mid_prices):
        mid_p = cpd.mid_prices[idx] if idx < len(cpd.mid_prices) else None
        if mid_p and current_price and mid_p > 0:
            spread_pct = abs(current_price - mid_p) / mid_p * 100

    # Simple appreciation slope from last 30 prices
    appreciation_slope = None
    if len(prices) >= 30:
        p_start = prices[-30]
        if p_start > 0:
            appreciation_slope = ((current_price - p_start) / p_start) / 30.0 * 100

    # Simple investment score
    app_score = 0.0
    if appreciation_slope is not None and appreciation_slope > 0:
        app_score = min(100, appreciation_slope * 200)
    inv_score = app_score * 0.6 + min(100, liquidity_score) * 0.4

    return {
        "card_id": cpd.card_id,
        "card_name": cpd.card_name,
        "set_id": cpd.set_id,
        "set_name": cpd.set_name,
        "current_price": current_price,
        "prices": prices,
        "dates": dates,
        "num_data_points": len(prices),
        "sma_7": sma_7,
        "sma_30": sma_30,
        "prev_sma_7": prev_sma_7,
        "prev_sma_30": prev_sma_30,
        "rsi_14": rsi_14,
        "macd": macd_line,
        "macd_signal": macd_signal,
        "macd_histogram": macd_histogram,
        "bb_upper": bb_upper,
        "bb_middle": bb_middle,
        "bb_lower": bb_lower,
        "regime": regime,
        "adx": adx_val,
        "high_30d": high_30d,
        "sales_per_day": sales_per_day,
        "sales_30d": int(sales_per_day * 30),
        "sales_90d": int(sales_per_day * 90),
        "liquidity_score": liquidity_score,
        "spread_pct": spread_pct,
        "appreciation_slope": appreciation_slope,
        "appreciation_score": app_score,
        "investment_score": inv_score,
    }


# ── Signal Checks (reproduced from prop_strategies.py) ──────────────────────
# These are direct copies of the strategy logic so the backtest faithfully
# reproduces the same signals as the live system.

def _check_sma_golden_cross(td: dict) -> Optional[dict]:
    """BUY: 7d SMA crosses above 30d SMA + regime is accumulation/markup."""
    sma_7 = td.get("sma_7")
    sma_30 = td.get("sma_30")
    prev_7 = td.get("prev_sma_7")
    prev_30 = td.get("prev_sma_30")
    regime = td.get("regime", "")

    if any(v is None for v in [sma_7, sma_30, prev_7, prev_30]):
        return None

    crossed_up = prev_7 <= prev_30 and sma_7 > sma_30
    bullish_regime = regime in ("accumulation", "markup")

    if crossed_up and bullish_regime:
        gap_pct = (sma_7 - sma_30) / sma_30 if sma_30 > 0 else 0
        strength = min(1.0, 0.5 + gap_pct * 5)
        if regime == "markup":
            strength = min(1.0, strength + 0.15)

        price = td["current_price"]
        return {
            "card_id": td["card_id"],
            "card_name": td["card_name"],
            "signal": "buy",
            "strength": round(strength, 3),
            "strategy": STRATEGY_SMA_CROSS,
            "reasons": [
                f"7d SMA ({sma_7:.2f}) crossed above 30d SMA ({sma_30:.2f})",
                f"Regime: {regime}",
            ],
            "entry_price": price,
            "target_price": round(price * (1 + DEFAULT_TAKE_PROFIT_PCT), 2),
            "stop_loss": round(price * (1 - DEFAULT_STOP_LOSS_PCT), 2),
        }
    return None


def _check_rsi_oversold(td: dict) -> Optional[dict]:
    """BUY: RSI < 30 + price near Bollinger lower band + decent liquidity."""
    rsi = td.get("rsi_14")
    bb_lower = td.get("bb_lower")
    bb_upper = td.get("bb_upper")
    liq = td.get("liquidity_score", 0)
    price = td.get("current_price", 0)

    if rsi is None or bb_lower is None or bb_upper is None:
        return None
    if rsi >= 30:
        return None
    if liq < 15:
        return None

    band_range = bb_upper - bb_lower
    if band_range <= 0:
        return None
    bb_position = (price - bb_lower) / band_range
    if bb_position > 0.25:
        return None

    rsi_factor = (30 - rsi) / 30
    bb_factor = 1 - (bb_position / 0.25)
    strength = min(1.0, 0.4 + rsi_factor * 0.4 + bb_factor * 0.2)

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_RSI_OVERSOLD,
        "reasons": [
            f"RSI oversold at {rsi:.1f}",
            f"Price near Bollinger lower band (position: {bb_position:.0%})",
        ],
        "entry_price": price,
        "target_price": round(td.get("bb_middle", price * 1.15), 2),
        "stop_loss": round(price * 0.90, 2),
    }


def _check_spread_compression(td: dict) -> Optional[dict]:
    """BUY: Spread < 15% + velocity > 0.5/day (tight market, easy flip)."""
    spread = td.get("spread_pct")
    velocity = td.get("sales_per_day", 0)
    price = td.get("current_price", 0)

    if spread is None or spread >= 15:
        return None
    if velocity < 0.5:
        return None

    spread_factor = max(0, (15 - spread) / 15)
    velocity_factor = min(1.0, velocity / 2.0)
    strength = min(1.0, 0.3 + spread_factor * 0.4 + velocity_factor * 0.3)

    breakeven_pct = calc_breakeven_appreciation(price) / 100
    target_pct = max(breakeven_pct + 0.10, DEFAULT_TAKE_PROFIT_PCT)

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_SPREAD_COMPRESSION,
        "reasons": [
            f"Tight spread: {spread:.1f}%",
            f"Good velocity: {velocity:.1f} sales/day",
        ],
        "entry_price": price,
        "target_price": round(price * (1 + target_pct), 2),
        "stop_loss": round(price * (1 - DEFAULT_STOP_LOSS_PCT), 2),
    }


def _check_mean_reversion(td: dict) -> Optional[dict]:
    """BUY: Price dropped >20% from 30d high + sales velocity stable."""
    price = td.get("current_price", 0)
    high_30d = td.get("high_30d", 0)
    velocity = td.get("sales_per_day", 0)

    if high_30d <= 0:
        return None

    drop_pct = (high_30d - price) / high_30d
    if drop_pct < 0.20:
        return None
    if velocity < 0.1:
        return None

    drop_factor = min(1.0, drop_pct / 0.40)
    velocity_factor = min(1.0, velocity / 1.0)
    strength = min(1.0, 0.3 + drop_factor * 0.5 + velocity_factor * 0.2)

    sma_30 = td.get("sma_30", price * 1.10)
    target = max(sma_30 or price * 1.10, price + (high_30d - price) * 0.5)

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_MEAN_REVERSION,
        "reasons": [
            f"Price dropped {drop_pct:.0%} from 30d high ({high_30d:.2f})",
            f"Sales velocity stable at {velocity:.1f}/day",
        ],
        "entry_price": price,
        "target_price": round(target, 2),
        "stop_loss": round(price * 0.85, 2),
    }


def _check_momentum(td: dict) -> Optional[dict]:
    """BUY: investment_score > 75 + appreciation_slope > 0.1 + markup regime."""
    inv_score = td.get("investment_score", 0)
    slope = td.get("appreciation_slope")
    regime = td.get("regime", "")
    price = td.get("current_price", 0)

    if inv_score < 75:
        return None
    if slope is None or slope <= 0.1:
        return None
    if regime not in ("markup",):
        return None

    score_factor = min(1.0, (inv_score - 75) / 25)
    slope_factor = min(1.0, slope / 0.5)
    strength = min(1.0, 0.4 + score_factor * 0.35 + slope_factor * 0.25)

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_MOMENTUM,
        "reasons": [
            f"Investment score: {inv_score:.0f}",
            f"Appreciation slope: {slope:.2f}%/day",
            f"Regime: {regime} (strong uptrend)",
        ],
        "entry_price": price,
        "target_price": round(price * (1 + DEFAULT_TAKE_PROFIT_PCT), 2),
        "stop_loss": round(price * (1 - 0.12), 2),
    }


BUY_CHECK_FNS = {
    STRATEGY_SMA_CROSS: _check_sma_golden_cross,
    STRATEGY_RSI_OVERSOLD: _check_rsi_oversold,
    STRATEGY_SPREAD_COMPRESSION: _check_spread_compression,
    STRATEGY_MEAN_REVERSION: _check_mean_reversion,
    STRATEGY_MOMENTUM: _check_momentum,
}


# ── Sell Signal Checks ───────────────────────────────────────────────────────

def _check_sell_signals_at_date(
    td: dict,
    position: dict,
    sim_date: date,
) -> Optional[dict]:
    """Check if an existing position should be sold at sim_date.

    Mirrors prop_strategies.check_sell_signals() but operates on
    pre-computed technical data without DB queries.
    """
    if td is None:
        return None

    price = td["current_price"]
    entry_price = position["entry_price"]
    reasons: list[str] = []
    sell_strength = 0.0

    # 1. Stop-loss
    stop_loss = position.get("stop_loss", entry_price * (1 - DEFAULT_STOP_LOSS_PCT))
    if price <= stop_loss:
        reasons.append(f"Stop-loss hit: price {price:.2f} <= stop {stop_loss:.2f}")
        sell_strength = max(sell_strength, 1.0)

    # 2. Take-profit
    take_profit = position.get("take_profit", entry_price * (1 + DEFAULT_TAKE_PROFIT_PCT))
    if price >= take_profit:
        reasons.append(f"Take-profit hit: price {price:.2f} >= target {take_profit:.2f}")
        sell_strength = max(sell_strength, 0.9)

    # 3. SMA Death Cross
    sma_7 = td.get("sma_7")
    sma_30 = td.get("sma_30")
    prev_7 = td.get("prev_sma_7")
    prev_30 = td.get("prev_sma_30")
    if all(v is not None for v in [sma_7, sma_30, prev_7, prev_30]):
        if prev_7 >= prev_30 and sma_7 < sma_30:
            reasons.append(f"SMA Death Cross: 7d ({sma_7:.2f}) crossed below 30d ({sma_30:.2f})")
            sell_strength = max(sell_strength, 0.7)

    # 4. RSI Overbought + near upper Bollinger band
    rsi = td.get("rsi_14")
    bb_upper = td.get("bb_upper")
    bb_lower = td.get("bb_lower")
    if rsi is not None and rsi > 70 and bb_upper is not None and bb_lower is not None:
        band_range = bb_upper - bb_lower
        if band_range > 0:
            bb_position = (price - bb_lower) / band_range
            if bb_position > 0.80:
                reasons.append(f"RSI overbought ({rsi:.1f}) + near upper BB ({bb_position:.0%})")
                sell_strength = max(sell_strength, 0.75)

    # 5. Regime shift to distribution/markdown
    regime = td.get("regime", "")
    if regime in ("distribution", "markdown"):
        reasons.append(f"Bearish regime: {regime}")
        sell_strength = max(sell_strength, 0.6)

    # 6. Liquidity dry-up
    velocity = td.get("sales_per_day", 0)
    if velocity < 0.1:
        reasons.append(f"Liquidity dried up: {velocity:.2f} sales/day")
        sell_strength = max(sell_strength, 0.5)

    # 7. Stale position
    entry_date = position.get("entry_date")
    if entry_date:
        days_held = (sim_date - entry_date).days
        gain_pct = (price - entry_price) / entry_price if entry_price > 0 else 0
        if days_held > STALE_POSITION_DAYS and gain_pct < STALE_GAIN_THRESHOLD:
            reasons.append(f"Stale position: {days_held}d held, only {gain_pct:.1%} gain")
            sell_strength = max(sell_strength, 0.45)

    if not reasons:
        return None

    return {
        "card_id": position["card_id"],
        "card_name": td["card_name"],
        "signal": "sell",
        "strength": round(sell_strength, 3),
        "strategy": "risk_management",
        "reasons": reasons,
        "current_price": price,
        "entry_price": entry_price,
        "pnl_pct": round((price - entry_price) / entry_price * 100, 2) if entry_price > 0 else 0,
    }


# ── Position Sizing (reproduced from prop_strategies.py) ────────────────────

def _calculate_position_size(
    portfolio_value: float,
    cash: float,
    card_price: float,
    signal_strength: float,
    num_positions: int,
    max_position_pct: float,
    cash_reserve_pct: float,
) -> int:
    """Calculate how many copies to buy. Returns 0 if constraints prevent buying."""
    if card_price <= 0 or portfolio_value <= 0 or cash <= 0:
        return 0

    available_cash = cash - (portfolio_value * cash_reserve_pct)
    if available_cash <= 0:
        return 0

    max_position_value = portfolio_value * max_position_pct
    max_from_cash = available_cash

    kelly_fraction = 0.3 + signal_strength * 0.7
    target_value = min(max_position_value, max_from_cash) * kelly_fraction

    if num_positions > 10:
        target_value *= 0.6
    elif num_positions > 5:
        target_value *= 0.8

    if card_price > 100:
        max_copies = 1
    elif card_price > 20:
        max_copies = 2
    else:
        max_copies = 3

    affordable = int(target_value / card_price)
    return max(0, min(affordable, max_copies))


# ── Score a buy signal (reproduced from prop_strategies.py) ──────────────────

def _score_buy_signal(signal: dict, td: dict) -> float:
    """Score a buy signal from 0-1 considering multiple factors."""
    score = 0.0

    # Signal strength (40%)
    strength = signal.get("strength", 0)
    score += strength * 0.40

    # Liquidity (25%)
    liq = td.get("liquidity_score", 0)
    score += (liq / 100) * 0.25

    # Spread (15%)
    spread = td.get("spread_pct")
    if spread is not None:
        spread_score = max(0, min(1.0, (30 - spread) / 25))
        score += spread_score * 0.15
    else:
        score += 0.075

    # Regime (10%)
    regime = td.get("regime", "")
    regime_scores = {
        "markup": 1.0,
        "accumulation": 0.7,
        "unknown": 0.4,
        "distribution": 0.15,
        "markdown": 0.0,
    }
    score += regime_scores.get(regime, 0.4) * 0.10

    # Fee viability (10%)
    price = td.get("current_price", 0)
    if price > 0:
        breakeven_pct = calc_breakeven_appreciation(price)
        target_price = signal.get("target_price", 0)
        target_pct = ((target_price - price) / price) * 100 if target_price > 0 and price > 0 else 0
        if target_pct > breakeven_pct * 1.5:
            score += 0.10
        elif target_pct > breakeven_pct:
            score += 0.05

    return round(min(1.0, score), 3)


# ── Backtest Portfolio ───────────────────────────────────────────────────────

@dataclass
class BacktestPosition:
    card_id: int
    card_name: str
    set_id: str
    quantity: int
    entry_price: float  # Price after slippage
    entry_date: date
    stop_loss: float
    take_profit: float
    strategy: str


class BacktestPortfolio:
    """In-memory portfolio for backtesting. No database writes."""

    def __init__(self, starting_capital: float):
        self.starting_capital = starting_capital
        self.cash = starting_capital
        self.positions: dict[int, BacktestPosition] = {}  # card_id -> position
        self.trades: list[dict] = []
        self.equity_curve: list[dict] = []
        self.high_water_mark = starting_capital

    def buy(
        self,
        card_id: int,
        card_name: str,
        set_id: str,
        market_price: float,
        quantity: int,
        slippage: float,
        signal: str,
        strategy: str,
        stop_loss: float,
        take_profit: float,
        sim_date: date,
    ) -> dict:
        """Execute a buy. Returns trade record dict."""
        execution_price = round(market_price * (1.0 + slippage), 2)
        total_cost = round(execution_price * quantity, 2)
        slippage_cost = round((execution_price - market_price) * quantity, 2)

        if total_cost > self.cash:
            return {}  # Can't afford

        self.cash -= total_cost

        if card_id in self.positions:
            # Average in
            pos = self.positions[card_id]
            old_total = pos.entry_price * pos.quantity
            new_total = execution_price * quantity
            pos.quantity += quantity
            pos.entry_price = round((old_total + new_total) / pos.quantity, 2)
        else:
            self.positions[card_id] = BacktestPosition(
                card_id=card_id,
                card_name=card_name,
                set_id=set_id,
                quantity=quantity,
                entry_price=execution_price,
                entry_date=sim_date,
                stop_loss=stop_loss,
                take_profit=take_profit,
                strategy=strategy,
            )

        trade = {
            "date": str(sim_date),
            "card_id": card_id,
            "card_name": card_name,
            "side": "buy",
            "quantity": quantity,
            "market_price": market_price,
            "price": execution_price,
            "slippage": round(slippage * 100, 2),
            "slippage_cost": slippage_cost,
            "fees": 0.0,
            "total_cost": total_cost,
            "pnl": None,
            "pnl_pct": None,
            "signal": signal,
            "strategy": strategy,
        }
        self.trades.append(trade)
        return trade

    def sell(
        self,
        card_id: int,
        card_name: str,
        market_price: float,
        quantity: int,
        slippage: float,
        signal: str,
        strategy: str,
        sim_date: date,
    ) -> dict:
        """Execute a sell with slippage + TCGPlayer fees. Returns trade record."""
        pos = self.positions.get(card_id)
        if not pos or pos.quantity < quantity:
            return {}

        # Seller receives less due to slippage
        execution_price = round(market_price * (1.0 - slippage), 2)
        gross_proceeds = round(execution_price * quantity, 2)
        slippage_cost = round((market_price - execution_price) * quantity, 2)

        # TCGPlayer seller fee
        fee_cost = round(gross_proceeds * TCGPLAYER_SELLER_FEE_RATE, 2)
        net_proceeds = round(gross_proceeds - fee_cost, 2)

        # Realized P&L
        cost_basis = round(pos.entry_price * quantity, 2)
        realized_pnl = round(net_proceeds - cost_basis, 2)
        realized_pnl_pct = round((realized_pnl / cost_basis) * 100, 2) if cost_basis > 0 else 0.0

        self.cash += net_proceeds

        # Update/remove position
        if pos.quantity == quantity:
            del self.positions[card_id]
        else:
            pos.quantity -= quantity

        trade = {
            "date": str(sim_date),
            "card_id": card_id,
            "card_name": card_name,
            "side": "sell",
            "quantity": quantity,
            "market_price": market_price,
            "price": execution_price,
            "slippage": round(slippage * 100, 2),
            "slippage_cost": slippage_cost,
            "fees": fee_cost,
            "total_cost": net_proceeds,
            "pnl": realized_pnl,
            "pnl_pct": realized_pnl_pct,
            "signal": signal,
            "strategy": strategy,
            "hold_days": (sim_date - pos.entry_date).days,
        }
        self.trades.append(trade)
        return trade

    def get_value(self, current_prices: dict[int, float]) -> float:
        """Total portfolio value = cash + sum(position_value)."""
        positions_value = sum(
            current_prices.get(cid, pos.entry_price) * pos.quantity
            for cid, pos in self.positions.items()
        )
        return self.cash + positions_value

    def record_snapshot(self, sim_date: date, current_prices: dict[int, float]):
        """Record an equity curve data point."""
        positions_value = sum(
            current_prices.get(cid, pos.entry_price) * pos.quantity
            for cid, pos in self.positions.items()
        )
        total_value = self.cash + positions_value

        if total_value > self.high_water_mark:
            self.high_water_mark = total_value

        drawdown_pct = 0.0
        if self.high_water_mark > 0:
            drawdown_pct = round(
                ((self.high_water_mark - total_value) / self.high_water_mark) * 100, 2
            )

        self.equity_curve.append({
            "date": str(sim_date),
            "total_value": round(total_value, 2),
            "cash": round(self.cash, 2),
            "positions_value": round(positions_value, 2),
            "drawdown_pct": drawdown_pct,
            "num_positions": len(self.positions),
        })


# ── Signal Generation at Historical Point ───────────────────────────────────

def _generate_signals_at_date(
    price_cache: dict[int, CardPriceData],
    sim_date: date,
    min_price: float,
    min_liquidity: float,
    strategies: list[str],
) -> list[dict]:
    """Generate buy signals using only data available at sim_date.

    For each card with enough history:
    - Get prices up to sim_date
    - Compute indicators
    - Run each enabled strategy check
    - Return signals sorted by strength
    """
    signals: list[dict] = []

    for card_id, cpd in price_cache.items():
        # Quick check: does this card have data at or before sim_date?
        if not cpd.dates or cpd.dates[0] > sim_date:
            continue

        td = _compute_technical_data_at_date(cpd, sim_date)
        if td is None:
            continue

        # Filters
        if td["current_price"] < min_price:
            continue
        if td["liquidity_score"] < min_liquidity:
            continue
        if td["num_data_points"] < MIN_DATA_POINTS:
            continue

        # Run enabled strategy checks
        for strat_name in strategies:
            check_fn = BUY_CHECK_FNS.get(strat_name)
            if check_fn is None:
                continue
            try:
                signal = check_fn(td)
                if signal is not None:
                    signal["_td"] = td
                    signal["composite_score"] = _score_buy_signal(signal, td)
                    signals.append(signal)
            except Exception:
                continue

    signals.sort(key=lambda s: s.get("composite_score", 0), reverse=True)
    return signals


# ── Performance Metrics ──────────────────────────────────────────────────────

def _compute_metrics(portfolio: BacktestPortfolio, start_date: date, end_date: date) -> dict:
    """Compute all performance metrics from the completed backtest."""
    duration_days = (end_date - start_date).days
    if duration_days <= 0:
        duration_days = 1

    ending_capital = portfolio.cash
    # Add remaining position values (should be 0 if we closed everything)
    for pos in portfolio.positions.values():
        ending_capital += pos.entry_price * pos.quantity

    total_return_pct = ((ending_capital - portfolio.starting_capital)
                        / portfolio.starting_capital * 100) if portfolio.starting_capital > 0 else 0

    # Annualized return
    years = duration_days / 365.0
    if years > 0 and ending_capital > 0 and portfolio.starting_capital > 0:
        total_return_frac = ending_capital / portfolio.starting_capital
        if total_return_frac > 0:
            annualized_return_pct = (total_return_frac ** (1.0 / years) - 1) * 100
        else:
            annualized_return_pct = -100.0
    else:
        annualized_return_pct = 0.0

    # Equity curve returns for Sharpe/Sortino
    curve = portfolio.equity_curve
    daily_returns = []
    for i in range(1, len(curve)):
        prev_val = curve[i - 1]["total_value"]
        cur_val = curve[i]["total_value"]
        if prev_val > 0:
            daily_returns.append((cur_val - prev_val) / prev_val)

    # Max drawdown
    max_drawdown_pct = 0.0
    if curve:
        max_drawdown_pct = max(s["drawdown_pct"] for s in curve)

    # Sharpe ratio (annualized, using 252 trading days)
    sharpe_ratio = 0.0
    if len(daily_returns) > 1:
        mean_r = sum(daily_returns) / len(daily_returns)
        variance = sum((r - mean_r) ** 2 for r in daily_returns) / (len(daily_returns) - 1)
        std_r = math.sqrt(variance)
        if std_r > 0:
            sharpe_ratio = (mean_r / std_r) * math.sqrt(252)

    # Sortino ratio (only penalize downside)
    sortino_ratio = 0.0
    if len(daily_returns) > 1:
        mean_r = sum(daily_returns) / len(daily_returns)
        neg_returns = [r for r in daily_returns if r < 0]
        if neg_returns:
            downside_var = sum(r ** 2 for r in neg_returns) / len(neg_returns)
            downside_std = math.sqrt(downside_var)
            if downside_std > 0:
                sortino_ratio = (mean_r / downside_std) * math.sqrt(252)

    # Trade stats
    sell_trades = [t for t in portfolio.trades if t["side"] == "sell" and t.get("pnl") is not None]
    buy_trades = [t for t in portfolio.trades if t["side"] == "buy"]

    wins = [t for t in sell_trades if t["pnl"] > 0]
    losses = [t for t in sell_trades if t["pnl"] <= 0]

    win_rate = (len(wins) / len(sell_trades) * 100) if sell_trades else 0.0

    gross_profit = sum(t["pnl"] for t in wins) if wins else 0.0
    gross_loss = abs(sum(t["pnl"] for t in losses)) if losses else 0.0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (
        float("inf") if gross_profit > 0 else 0.0
    )

    avg_hold_days = 0.0
    hold_days_list = [t.get("hold_days", 0) for t in sell_trades if t.get("hold_days") is not None]
    if hold_days_list:
        avg_hold_days = sum(hold_days_list) / len(hold_days_list)

    # Best/worst trade
    best_trade = None
    worst_trade = None
    if sell_trades:
        best = max(sell_trades, key=lambda t: t["pnl"])
        best_trade = {
            "card_name": best["card_name"],
            "date": best["date"],
            "pnl": best["pnl"],
            "pnl_pct": best.get("pnl_pct", 0),
            "strategy": best["strategy"],
            "hold_days": best.get("hold_days", 0),
        }
        worst = min(sell_trades, key=lambda t: t["pnl"])
        worst_trade = {
            "card_name": worst["card_name"],
            "date": worst["date"],
            "pnl": worst["pnl"],
            "pnl_pct": worst.get("pnl_pct", 0),
            "strategy": worst["strategy"],
            "hold_days": worst.get("hold_days", 0),
        }

    # By strategy
    by_strategy: dict[str, dict] = {}
    for t in sell_trades:
        strat = t.get("strategy", "unknown")
        if strat not in by_strategy:
            by_strategy[strat] = {"count": 0, "wins": 0, "total_pnl": 0.0}
        by_strategy[strat]["count"] += 1
        by_strategy[strat]["total_pnl"] += t["pnl"]
        if t["pnl"] > 0:
            by_strategy[strat]["wins"] += 1
    for s in by_strategy.values():
        s["win_rate"] = round(s["wins"] / s["count"] * 100, 1) if s["count"] else 0
        s["avg_pnl"] = round(s["total_pnl"] / s["count"], 2) if s["count"] else 0
        s["total_pnl"] = round(s["total_pnl"], 2)

    # Monthly returns
    monthly_returns: list[dict] = []
    monthly_trades: dict[str, list[dict]] = {}
    for t in sell_trades:
        month_key = t["date"][:7]  # "YYYY-MM"
        monthly_trades.setdefault(month_key, []).append(t)

    # Also compute monthly returns from equity curve
    monthly_eq: dict[str, list[dict]] = {}
    for s in curve:
        mk = s["date"][:7]
        monthly_eq.setdefault(mk, []).append(s)

    for mk in sorted(monthly_eq.keys()):
        snapshots = monthly_eq[mk]
        first_val = snapshots[0]["total_value"]
        last_val = snapshots[-1]["total_value"]
        m_return = ((last_val - first_val) / first_val * 100) if first_val > 0 else 0
        m_trades = len(monthly_trades.get(mk, []))
        monthly_returns.append({
            "month": mk,
            "return_pct": round(m_return, 2),
            "trades": m_trades,
        })

    return {
        "start_date": str(start_date),
        "end_date": str(end_date),
        "duration_days": duration_days,
        "starting_capital": portfolio.starting_capital,
        "ending_capital": round(ending_capital, 2),
        "total_return_pct": round(total_return_pct, 2),
        "annualized_return_pct": round(annualized_return_pct, 2),
        "max_drawdown_pct": round(max_drawdown_pct, 2),
        "sharpe_ratio": round(sharpe_ratio, 3),
        "sortino_ratio": round(sortino_ratio, 3),
        "win_rate": round(win_rate, 1),
        "profit_factor": round(profit_factor, 3) if profit_factor != float("inf") else None,
        "total_trades": len(portfolio.trades),
        "total_buys": len(buy_trades),
        "total_sells": len(sell_trades),
        "avg_hold_days": round(avg_hold_days, 1),
        "best_trade": best_trade,
        "worst_trade": worst_trade,
        "by_strategy": by_strategy,
        "monthly_returns": monthly_returns,
        "equity_curve": curve,
        "trades": portfolio.trades,
    }


# ── Main Backtest Engine ────────────────────────────────────────────────────

async def run_prop_backtest(
    db: Session,
    start_date: date | None = None,
    end_date: date | None = None,
    starting_capital: float = 10000.0,
    step_days: int = 7,
    max_positions: int = 20,
    max_position_pct: float = 0.10,
    cash_reserve_pct: float = 0.20,
    max_buys_per_cycle: int = 3,
    min_price: float = 5.0,
    min_liquidity_score: float = 20,
    strategies: list[str] | None = None,
) -> dict:
    """Run a full backtest of the prop trading system.

    The backtest:
    1. Gets all price history dates from the database
    2. Walks forward through time in `step_days` increments
    3. At each time step:
       a. Calculate technical indicators using ONLY data available at that date
       b. Update position values at current prices
       c. Check sell signals for existing positions
       d. Scan for buy signals
       e. Execute trades with slippage model
       f. Record daily equity snapshot
    4. Close all remaining positions at end
    5. Calculate performance metrics

    Returns dict with complete backtest results including equity curve,
    trade log, performance metrics, and per-strategy breakdown.
    """
    active_strategies = strategies or list(ALL_BUY_STRATEGIES)
    # Validate strategies
    active_strategies = [s for s in active_strategies if s in BUY_CHECK_FNS]
    if not active_strategies:
        return {"error": "No valid strategies specified"}

    # Step 1: Build price cache (all data loaded into memory)
    price_cache = _build_price_cache(db, min_price)
    if not price_cache:
        return {"error": "No eligible cards with price history found"}

    # Determine date range
    all_dates: set[date] = set()
    for cpd in price_cache.values():
        all_dates.update(cpd.dates)

    if not all_dates:
        return {"error": "No price data found"}

    earliest = min(all_dates)
    latest = max(all_dates)

    bt_start = start_date or earliest
    bt_end = end_date or latest

    # Ensure start is at least 30 days after earliest data (need history for indicators)
    indicator_warmup = timedelta(days=30)
    if bt_start < earliest + indicator_warmup:
        bt_start = earliest + indicator_warmup

    if bt_start >= bt_end:
        return {"error": f"Start date {bt_start} >= end date {bt_end} after warmup adjustment"}

    logger.info(
        "Starting backtest: %s to %s (%d days), $%.0f capital, %d cards, strategies: %s",
        bt_start, bt_end, (bt_end - bt_start).days,
        starting_capital, len(price_cache), active_strategies,
    )

    # Step 2: Initialize portfolio
    portfolio = BacktestPortfolio(starting_capital)

    # Step 3: Walk forward through time
    sim_date = bt_start
    cycle_count = 0

    while sim_date <= bt_end:
        cycle_count += 1

        # Get current prices for all cards at this date
        current_prices: dict[int, float] = {}
        for card_id, cpd in price_cache.items():
            dates, prices = _get_prices_up_to(cpd, sim_date)
            if prices:
                current_prices[card_id] = prices[-1]

        # Phase 1: Check sell signals for existing positions
        sells_to_execute: list[tuple[int, dict]] = []
        for card_id, pos in list(portfolio.positions.items()):
            cpd = price_cache.get(card_id)
            if cpd is None:
                continue

            td = _compute_technical_data_at_date(cpd, sim_date)
            if td is None:
                continue

            pos_dict = {
                "card_id": card_id,
                "entry_price": pos.entry_price,
                "entry_date": pos.entry_date,
                "stop_loss": pos.stop_loss,
                "take_profit": pos.take_profit,
                "quantity": pos.quantity,
            }

            sell_signal = _check_sell_signals_at_date(td, pos_dict, sim_date)
            if sell_signal is not None:
                sells_to_execute.append((card_id, sell_signal))

        # Execute sells
        selling_card_ids: set[int] = set()
        for card_id, sell_sig in sells_to_execute:
            pos = portfolio.positions.get(card_id)
            if not pos:
                continue

            cpd = price_cache.get(card_id)
            mkt_price = current_prices.get(card_id, pos.entry_price)
            velocity = _estimate_sales_velocity(cpd, sim_date) if cpd else 0.0
            liq_score = _estimate_liquidity_score(cpd, sim_date, mkt_price) if cpd else 0

            slippage = calculate_slippage(mkt_price, liq_score, velocity)

            trade = portfolio.sell(
                card_id=card_id,
                card_name=pos.card_name,
                market_price=mkt_price,
                quantity=pos.quantity,
                slippage=slippage,
                signal="; ".join(sell_sig["reasons"][:2]),
                strategy=sell_sig.get("strategy", "risk_management"),
                sim_date=sim_date,
            )
            if trade:
                selling_card_ids.add(card_id)

        # Phase 2: Generate buy signals
        buy_signals = _generate_signals_at_date(
            price_cache, sim_date, min_price, min_liquidity_score, active_strategies,
        )

        # Filter out cards we already hold
        held_card_ids = set(portfolio.positions.keys())
        buy_signals = [s for s in buy_signals if s["card_id"] not in held_card_ids]

        # Phase 3: Execute top buys (respecting limits)
        buys_executed = 0
        portfolio_value = portfolio.get_value(current_prices)

        # Set concentration tracking
        set_values: dict[str, float] = {}
        for cid, pos in portfolio.positions.items():
            pos_val = current_prices.get(cid, pos.entry_price) * pos.quantity
            set_values[pos.set_id] = set_values.get(pos.set_id, 0) + pos_val

        for signal in buy_signals:
            if buys_executed >= max_buys_per_cycle:
                break
            if len(portfolio.positions) >= max_positions:
                break

            td = signal.pop("_td", None)
            if td is None:
                continue

            card_id = signal["card_id"]
            sig_set_id = td.get("set_id", "")

            # Check set concentration (max 30%)
            current_set_value = set_values.get(sig_set_id, 0)
            if portfolio_value > 0 and current_set_value / portfolio_value > 0.30:
                continue

            # Position sizing
            quantity = _calculate_position_size(
                portfolio_value=portfolio_value,
                cash=portfolio.cash,
                card_price=signal["entry_price"],
                signal_strength=signal.get("composite_score", signal["strength"]),
                num_positions=len(portfolio.positions),
                max_position_pct=max_position_pct,
                cash_reserve_pct=cash_reserve_pct,
            )
            if quantity <= 0:
                continue

            total_cost = signal["entry_price"] * quantity
            if total_cost > portfolio.cash - (portfolio_value * cash_reserve_pct):
                continue

            # Slippage
            cpd = price_cache.get(card_id)
            velocity = _estimate_sales_velocity(cpd, sim_date) if cpd else 0.0
            liq_score = td.get("liquidity_score", 0)
            slippage = calculate_slippage(signal["entry_price"], liq_score, velocity)

            trade = portfolio.buy(
                card_id=card_id,
                card_name=signal["card_name"],
                set_id=sig_set_id,
                market_price=signal["entry_price"],
                quantity=quantity,
                slippage=slippage,
                signal="; ".join(signal.get("reasons", [])[:2]),
                strategy=signal["strategy"],
                stop_loss=signal.get("stop_loss", signal["entry_price"] * (1 - DEFAULT_STOP_LOSS_PCT)),
                take_profit=signal.get("target_price", signal["entry_price"] * (1 + DEFAULT_TAKE_PROFIT_PCT)),
                sim_date=sim_date,
            )
            if trade:
                buys_executed += 1
                set_values[sig_set_id] = set_values.get(sig_set_id, 0) + trade.get("total_cost", 0)

        # Record equity snapshot
        portfolio.record_snapshot(sim_date, current_prices)

        # Advance to next step
        sim_date += timedelta(days=step_days)

    # Step 4: Close all remaining positions at end
    logger.info("Backtest complete. Closing %d remaining positions...", len(portfolio.positions))
    final_prices: dict[int, float] = {}
    for card_id, cpd in price_cache.items():
        dates, prices = _get_prices_up_to(cpd, bt_end)
        if prices:
            final_prices[card_id] = prices[-1]

    for card_id in list(portfolio.positions.keys()):
        pos = portfolio.positions[card_id]
        mkt_price = final_prices.get(card_id, pos.entry_price)

        cpd = price_cache.get(card_id)
        velocity = _estimate_sales_velocity(cpd, bt_end) if cpd else 0.0
        liq_score = _estimate_liquidity_score(cpd, bt_end, mkt_price) if cpd else 0
        slippage = calculate_slippage(mkt_price, liq_score, velocity)

        portfolio.sell(
            card_id=card_id,
            card_name=pos.card_name,
            market_price=mkt_price,
            quantity=pos.quantity,
            slippage=slippage,
            signal="Backtest end — force close",
            strategy="backtest_close",
            sim_date=bt_end,
        )

    # Record final snapshot
    portfolio.record_snapshot(bt_end, final_prices)

    # Step 5: Calculate metrics
    result = _compute_metrics(portfolio, bt_start, bt_end)

    logger.info(
        "Backtest results: %.1f%% return (%.1f%% annualized), "
        "Sharpe %.2f, Max DD %.1f%%, %d trades, %.0f%% win rate",
        result["total_return_pct"],
        result["annualized_return_pct"],
        result["sharpe_ratio"],
        result["max_drawdown_pct"],
        result["total_trades"],
        result["win_rate"],
    )

    return result


# ── API Route (add to server/routes/prop_trader.py) ──────────────────────────
#
# @router.get("/backtest")
# async def run_backtest(
#     start_date: str | None = Query(None, description="Start date YYYY-MM-DD"),
#     end_date: str | None = Query(None, description="End date YYYY-MM-DD"),
#     starting_capital: float = Query(10000, ge=100, le=1000000),
#     step_days: int = Query(7, ge=1, le=30),
#     max_positions: int = Query(20, ge=1, le=100),
#     strategies: str | None = Query(None, description="Comma-separated strategy names"),
#     db: Session = Depends(get_db),
# ):
#     """Run a historical backtest of the prop trading system."""
#     from datetime import date as date_type
#     from server.services.prop_backtest import run_prop_backtest
#
#     sd = date_type.fromisoformat(start_date) if start_date else None
#     ed = date_type.fromisoformat(end_date) if end_date else None
#     strat_list = strategies.split(",") if strategies else None
#
#     result = await run_prop_backtest(
#         db,
#         start_date=sd,
#         end_date=ed,
#         starting_capital=starting_capital,
#         step_days=step_days,
#         max_positions=max_positions,
#         strategies=strat_list,
#     )
#     return result
