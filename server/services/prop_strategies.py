"""
Prop Trading Strategy Engine — Signal generation and autonomous trading loop.

Generates buy/sell signals from existing technical indicators and executes
virtual trades for the prop trading portfolio. No AI/LLM API calls — all
decisions come from math on price history, sales data, and technicals.

Signal Strategies (BUY):
  1. SMA Golden Cross + bullish regime
  2. RSI Oversold + Bollinger lower band + liquidity
  3. Spread Compression + velocity (tight market, easy flip)
  4. Mean Reversion (price drop >20% from 30d high + stable velocity)
  5. Momentum (high investment score + appreciation + uptrend regime)

Signal Strategies (SELL):
  1. Stop-loss hit
  2. Take-profit hit
  3. SMA Death Cross
  4. RSI Overbought + Bollinger upper band
  5. Regime shift to distribution/markdown
  6. Liquidity dry-up (velocity < 0.1/day)
  7. Holding too long (>90 days with <5% gain)
"""
import logging
import math
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import asc, func
from sqlalchemy.orm import Session

from server.models.card import Card
from server.models.price_history import PriceHistory
from server.models.sale import Sale
from server.services.market_analysis import (
    _sma,
    _ema,
    _rsi,
    _macd,
    _bollinger_bands,
    _adx,
    _detect_regime,
    _filter_dominant_variant,
    analyze_card,
)
from server.services.trading_economics import (
    calc_breakeven_appreciation,
    calc_liquidity_score,
    calc_roundtrip_pnl,
    calc_sell_proceeds,
)

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────

MIN_PRICE = 5.0            # Don't buy cards under $5 (fees eat profit)
MIN_LIQUIDITY = 20         # Minimum liquidity score to consider
MIN_DATA_POINTS = 3        # Minimum price history records
MAX_POSITIONS = 20         # Max concurrent positions
MAX_SINGLE_POSITION_PCT = 0.10   # Max 10% of portfolio in one card
MAX_SET_CONCENTRATION_PCT = 0.30  # Max 30% of portfolio in one set
CASH_RESERVE_PCT = 0.20    # Keep 20% cash minimum
MAX_NEW_BUYS_PER_CYCLE = 3 # Don't go all-in at once
DEFAULT_STOP_LOSS_PCT = 0.15     # 15% below entry
DEFAULT_TAKE_PROFIT_PCT = 0.30   # 30% above entry
STALE_POSITION_DAYS = 90   # Positions open longer than this with low gain get sold
STALE_GAIN_THRESHOLD = 0.05  # 5% gain threshold for stale positions

# Strategy names for signal attribution
STRATEGY_SMA_CROSS = "sma_golden_cross"
STRATEGY_RSI_OVERSOLD = "rsi_oversold_bounce"
STRATEGY_SPREAD_COMPRESSION = "spread_compression"
STRATEGY_MEAN_REVERSION = "mean_reversion"
STRATEGY_MOMENTUM = "momentum_breakout"


# ── Technical Data ───────────────────────────────────────────────────────────

def get_technical_data(db: Session, card_id: int) -> Optional[dict]:
    """Get all technical indicators for a card.

    Returns dict with: sma_7, sma_30, rsi_14, macd, macd_signal, macd_histogram,
    bb_upper, bb_lower, bb_middle, regime, adx, appreciation_slope,
    sales_per_day, liquidity_score, spread_pct, current_price, prices,
    high_30d, prev_sma_7, prev_sma_30, set_id, card_name, set_name.

    Returns None if insufficient data.
    """
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card or not card.current_price:
        return None

    # Get price history (filtered to dominant variant)
    records = (
        db.query(PriceHistory)
        .filter(
            PriceHistory.card_id == card_id,
            PriceHistory.market_price.isnot(None),
        )
        .order_by(asc(PriceHistory.date), asc(PriceHistory.id))
        .all()
    )
    records = _filter_dominant_variant(records)
    if len(records) < MIN_DATA_POINTS:
        return None

    # Deduplicate: one price per date (last record wins)
    date_prices: dict[date, float] = {}
    for r in records:
        date_prices[r.date] = r.market_price
    sorted_dates = sorted(date_prices.keys())
    prices = [date_prices[d] for d in sorted_dates]

    if len(prices) < MIN_DATA_POINTS:
        return None

    # Compute indicators
    sma_7 = _sma(prices, 7)
    sma_30 = _sma(prices, 30)
    rsi_14 = _rsi(prices, 14)
    macd_line, macd_signal, macd_histogram = _macd(prices)
    bb_upper, bb_middle, bb_lower = _bollinger_bands(prices, 20, 2.0)
    adx_val = _adx(prices)
    regime = _detect_regime(prices, adx_val)

    # Previous day indicators for crossover detection
    prev_sma_7 = _sma(prices[:-1], 7) if len(prices) > 7 else None
    prev_sma_30 = _sma(prices[:-1], 30) if len(prices) > 30 else None

    # 30-day high
    high_30d = max(prices[-30:]) if len(prices) >= 30 else max(prices)

    # Sales velocity (30-day)
    cutoff_30d = datetime.now(timezone.utc) - timedelta(days=30)
    sales_30d = (
        db.query(func.count(Sale.id))
        .filter(Sale.card_id == card_id, Sale.order_date >= cutoff_30d)
        .scalar()
    ) or 0
    sales_per_day = sales_30d / 30.0

    # Sales 90-day for liquidity
    cutoff_90d = datetime.now(timezone.utc) - timedelta(days=90)
    sales_90d = (
        db.query(func.count(Sale.id))
        .filter(Sale.card_id == card_id, Sale.order_date >= cutoff_90d)
        .scalar()
    ) or 0

    # Liquidity score
    liq_score = card.liquidity_score if card.liquidity_score is not None else calc_liquidity_score(
        sales_90d=sales_90d,
        sales_30d=sales_30d,
        card_price=card.current_price,
    )

    # Spread % (market vs mid price from most recent record)
    spread_pct = None
    if records:
        latest = records[-1]
        if latest.mid_price and latest.market_price and latest.mid_price > 0:
            spread_pct = abs(latest.market_price - latest.mid_price) / latest.mid_price * 100

    return {
        "card_id": card_id,
        "card_name": card.name,
        "set_id": card.set_id,
        "set_name": card.set_name,
        "current_price": card.current_price,
        "prices": prices,
        "dates": sorted_dates,
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
        "sales_30d": sales_30d,
        "sales_90d": sales_90d,
        "liquidity_score": liq_score,
        "spread_pct": spread_pct,
        "appreciation_slope": card.appreciation_slope,
        "appreciation_score": card.appreciation_score,
        "investment_score": _calc_investment_score(card),
    }


def _calc_investment_score(card: Card) -> float:
    """Compute a simple investment score from cached card metrics.

    Combines appreciation_score and liquidity_score into a single 0-100 number.
    """
    app = card.appreciation_score or 0
    liq = card.liquidity_score or 0
    # Weighted: 60% appreciation, 40% liquidity
    return round(app * 0.6 + liq * 0.4, 1)


# ── Signal Generation ────────────────────────────────────────────────────────

def _check_sma_golden_cross(td: dict) -> Optional[dict]:
    """BUY: 7d SMA crosses above 30d SMA + regime is accumulation/markup."""
    sma_7 = td.get("sma_7")
    sma_30 = td.get("sma_30")
    prev_7 = td.get("prev_sma_7")
    prev_30 = td.get("prev_sma_30")
    regime = td.get("regime", "")

    if any(v is None for v in [sma_7, sma_30, prev_7, prev_30]):
        return None

    # Golden cross: short crosses above long
    crossed_up = prev_7 <= prev_30 and sma_7 > sma_30
    bullish_regime = regime in ("accumulation", "markup")

    if crossed_up and bullish_regime:
        # Signal strength based on how far above + regime
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
        return None  # Need some liquidity for this to work

    # Price near lower band?
    band_range = bb_upper - bb_lower
    if band_range <= 0:
        return None
    bb_position = (price - bb_lower) / band_range
    if bb_position > 0.25:
        return None  # Not near lower band

    # Strength: lower RSI + closer to lower band = stronger signal
    rsi_factor = (30 - rsi) / 30  # 0 at RSI=30, 1 at RSI=0
    bb_factor = 1 - (bb_position / 0.25)  # 1 at lower band, 0 at 25% mark
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
            f"Liquidity score: {liq}",
        ],
        "entry_price": price,
        "target_price": round(td.get("bb_middle", price * 1.15), 2),  # Target middle band
        "stop_loss": round(price * 0.90, 2),  # Tighter stop for mean-reversion
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

    # Strength: tighter spread + higher velocity = stronger
    spread_factor = max(0, (15 - spread) / 15)
    velocity_factor = min(1.0, velocity / 2.0)  # Cap at 2 sales/day
    strength = min(1.0, 0.3 + spread_factor * 0.4 + velocity_factor * 0.3)

    # Calculate fee-adjusted target
    breakeven_pct = calc_breakeven_appreciation(price) / 100
    target_pct = max(breakeven_pct + 0.10, DEFAULT_TAKE_PROFIT_PCT)  # At least 10% above breakeven

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_SPREAD_COMPRESSION,
        "reasons": [
            f"Tight spread: {spread:.1f}%",
            f"Good velocity: {velocity:.1f} sales/day",
            f"Fee breakeven: {breakeven_pct*100:.1f}%",
        ],
        "entry_price": price,
        "target_price": round(price * (1 + target_pct), 2),
        "stop_loss": round(price * (1 - DEFAULT_STOP_LOSS_PCT), 2),
    }


def _check_mean_reversion(td: dict) -> Optional[dict]:
    """BUY: Price dropped >20% from 30d high + sales velocity stable/increasing."""
    price = td.get("current_price", 0)
    high_30d = td.get("high_30d", 0)
    velocity = td.get("sales_per_day", 0)

    if high_30d <= 0:
        return None

    drop_pct = (high_30d - price) / high_30d
    if drop_pct < 0.20:
        return None  # Hasn't dropped enough
    if velocity < 0.1:
        return None  # Need some sales activity to confirm demand exists

    # Strength: bigger drop (up to a point) + stable velocity = stronger
    drop_factor = min(1.0, drop_pct / 0.40)  # Max at 40% drop
    velocity_factor = min(1.0, velocity / 1.0)
    strength = min(1.0, 0.3 + drop_factor * 0.5 + velocity_factor * 0.2)

    # Target: recovery to 30d SMA or 50% of drop
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
        "stop_loss": round(price * 0.85, 2),  # Wider stop for mean-reversion
    }


def _check_momentum(td: dict) -> Optional[dict]:
    """BUY: investment_score > 75 + appreciation_slope > 0.1 + regime UPTREND."""
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

    # Strength: higher score + steeper slope = stronger
    score_factor = min(1.0, (inv_score - 75) / 25)  # 0 at 75, 1 at 100
    slope_factor = min(1.0, slope / 0.5)  # 0 at 0.1, 1 at 0.5
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
        "stop_loss": round(price * (1 - 0.12), 2),  # Tighter stop for momentum
    }


def scan_for_signals(db: Session) -> list[dict]:
    """Scan all tracked cards for actionable buy/sell signals.

    Returns list of signal dicts with keys:
        card_id, card_name, signal, strength, strategy, reasons,
        entry_price, target_price, stop_loss

    BUY signals when:
        1. SMA Crossover: 7d SMA crosses above 30d SMA + bullish regime
        2. RSI Oversold: RSI < 30 + price near Bollinger lower band + liquidity
        3. Spread Compression: spread < 15% + velocity > 0.5/day
        4. Mean Reversion: price dropped >20% from 30d high + stable velocity
        5. Momentum: investment_score > 75 + appreciation_slope > 0.1 + markup regime

    FILTERS (skip cards where):
        - current_price < $5 (not worth the fees)
        - liquidity_score < 20 (too illiquid)
        - < 3 price history data points (insufficient data)
    """
    # Get all tracked cards with a price
    cards = (
        db.query(Card)
        .filter(
            Card.is_tracked == True,
            Card.current_price.isnot(None),
            Card.current_price >= MIN_PRICE,
        )
        .all()
    )

    signals: list[dict] = []

    for card in cards:
        try:
            td = get_technical_data(db, card.id)
        except Exception as e:
            logger.debug(f"get_technical_data failed for card {card.id}: {e}")
            continue
        if td is None:
            continue

        # Apply filters
        if td["current_price"] < MIN_PRICE:
            continue
        if td["liquidity_score"] < MIN_LIQUIDITY:
            continue
        if td["num_data_points"] < MIN_DATA_POINTS:
            continue

        # Check each buy strategy
        buy_checks = [
            _check_sma_golden_cross,
            _check_rsi_oversold,
            _check_spread_compression,
            _check_mean_reversion,
            _check_momentum,
        ]
        for check_fn in buy_checks:
            try:
                signal = check_fn(td)
                if signal is not None:
                    signals.append(signal)
            except Exception as e:
                logger.debug(f"Signal check {check_fn.__name__} failed for card {card.id}: {e}")

    # Sort by strength descending
    signals.sort(key=lambda s: s["strength"], reverse=True)
    return signals


# ── Sell Signal Checks ───────────────────────────────────────────────────────

def check_sell_signals(db: Session, position: dict) -> Optional[dict]:
    """Check if an existing position should be sold.

    Args:
        position: dict with keys: card_id, entry_price, entry_date (date),
                  stop_loss, take_profit, quantity

    Returns signal dict or None.

    SELL triggers:
        1. Stop-loss: price below position's stop_loss
        2. Take-profit: price above position's take_profit
        3. SMA Death Cross: 7d SMA crosses below 30d SMA
        4. RSI Overbought: RSI > 70 + price near Bollinger upper band
        5. Regime shift: regime changed to distribution/markdown
        6. Liquidity dry-up: velocity < 0.1/day
        7. Stale position: open > 90 days with < 5% gain
    """
    td = get_technical_data(db, position["card_id"])
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
                reasons.append(f"RSI overbought ({rsi:.1f}) + near upper Bollinger band ({bb_position:.0%})")
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
        if isinstance(entry_date, str):
            entry_date = date.fromisoformat(entry_date)
        days_held = (date.today() - entry_date).days
        gain_pct = (price - entry_price) / entry_price if entry_price > 0 else 0
        if days_held > STALE_POSITION_DAYS and gain_pct < STALE_GAIN_THRESHOLD:
            reasons.append(
                f"Stale position: {days_held} days held with only {gain_pct:.1%} gain"
            )
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


# ── Position Sizing ──────────────────────────────────────────────────────────

def calculate_position_size(
    portfolio_value: float,
    cash: float,
    card_price: float,
    signal_strength: float,
    num_positions: int,
) -> int:
    """Calculate how many copies to buy.

    Kelly criterion-inspired sizing:
    - Stronger signals -> larger position (up to max)
    - More existing positions -> smaller new positions
    - Always respect cash reserve
    - For cards < $20: buy 2-3 copies
    - For cards $20-$100: buy 1-2 copies
    - For cards > $100: buy 1 copy

    Returns number of copies to buy (0 if constraints prevent buying).
    """
    if card_price <= 0 or portfolio_value <= 0 or cash <= 0:
        return 0

    # Enforce cash reserve
    available_cash = cash - (portfolio_value * CASH_RESERVE_PCT)
    if available_cash <= 0:
        return 0

    # Max position size by portfolio concentration
    max_position_value = portfolio_value * MAX_SINGLE_POSITION_PCT
    max_from_cash = available_cash

    # Scale by signal strength (Kelly-inspired: bet more on stronger signals)
    # Base fraction: 0.3-1.0 of max, scaled by strength
    kelly_fraction = 0.3 + signal_strength * 0.7
    target_value = min(max_position_value, max_from_cash) * kelly_fraction

    # Scale down if many positions already open (diversification pressure)
    if num_positions > 10:
        target_value *= 0.6
    elif num_positions > 5:
        target_value *= 0.8

    # Determine quantity by price tier
    if card_price > 100:
        max_copies = 1
    elif card_price > 20:
        max_copies = 2
    else:
        max_copies = 3

    # How many can we afford within target allocation?
    affordable = int(target_value / card_price)
    quantity = max(0, min(affordable, max_copies))

    return quantity


# ── Signal Scoring ───────────────────────────────────────────────────────────

def score_buy_signal(signal: dict, td: dict) -> float:
    """Score a buy signal from 0-1 considering multiple factors.

    Factors:
    - Signal strength (from technical indicators) — weight 40%
    - Liquidity (higher = better, easier to exit) — weight 25%
    - Spread (tighter = better) — weight 15%
    - Regime favorability — weight 10%
    - Fee viability — weight 10%
    """
    score = 0.0

    # Signal strength (40%)
    strength = signal.get("strength", 0)
    score += strength * 0.40

    # Liquidity (25%) — normalize 0-100 to 0-1
    liq = td.get("liquidity_score", 0)
    score += (liq / 100) * 0.25

    # Spread (15%) — tighter is better, max at 5%, min at 30%
    spread = td.get("spread_pct")
    if spread is not None:
        spread_score = max(0, min(1.0, (30 - spread) / 25))
        score += spread_score * 0.15
    else:
        score += 0.075  # Neutral if unknown

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

    # Fee viability (10%) — is the target above fee breakeven?
    price = td.get("current_price", 0)
    if price > 0:
        breakeven_pct = calc_breakeven_appreciation(price)
        target_pct = 0
        target_price = signal.get("target_price", 0)
        if target_price > 0 and price > 0:
            target_pct = ((target_price - price) / price) * 100
        if target_pct > breakeven_pct * 1.5:
            score += 0.10  # Good margin above breakeven
        elif target_pct > breakeven_pct:
            score += 0.05  # Barely above breakeven
        # else: 0 — target doesn't clear fees

    return round(min(1.0, score), 3)


# ── Trading Cycle ────────────────────────────────────────────────────────────

async def run_trading_cycle(
    db: Session,
    portfolio_id: int,
    positions: list[dict],
    portfolio_value: float,
    cash: float,
) -> dict:
    """Execute one full trading cycle. Called after each price sync.

    This is a pure computation function — it doesn't persist anything.
    The caller is responsible for persisting trades and portfolio state.

    Args:
        db: SQLAlchemy session
        portfolio_id: Portfolio ID for logging
        positions: List of current position dicts, each with:
            card_id, entry_price, entry_date, stop_loss, take_profit,
            quantity, set_id
        portfolio_value: Current total portfolio value (cash + positions)
        cash: Available cash

    Returns dict with:
        sells: list of sell signal dicts (positions to close)
        buys: list of buy dicts (new positions to open) with quantity
        signals_generated: int
        portfolio_value: float
        daily_pnl: float (estimated from position price changes)

    POSITION LIMITS:
    - Max 20 positions
    - Max 10% of portfolio in any single card
    - Max 30% of portfolio in any single set
    - Keep 20% cash reserve minimum
    - Max 3 new buys per cycle
    """
    cycle_result = {
        "sells": [],
        "buys": [],
        "signals_generated": 0,
        "portfolio_value": portfolio_value,
        "daily_pnl": 0.0,
    }

    # ── Phase 1: Check existing positions for sell signals ────────────────
    sells_to_execute = []
    updated_portfolio_value = portfolio_value
    realized_pnl = 0.0

    for pos in positions:
        sell_signal = check_sell_signals(db, pos)
        if sell_signal is not None:
            # Estimate proceeds
            current_price = sell_signal["current_price"]
            quantity = pos.get("quantity", 1)
            gross_value = current_price * quantity
            proceeds = calc_sell_proceeds(gross_value)
            entry_cost = pos["entry_price"] * quantity

            sell_signal["quantity"] = quantity
            sell_signal["gross_value"] = round(gross_value, 2)
            sell_signal["net_proceeds"] = proceeds["net_proceeds"]
            sell_signal["realized_pnl"] = round(proceeds["net_proceeds"] - entry_cost, 2)

            sells_to_execute.append(sell_signal)
            realized_pnl += sell_signal["realized_pnl"]
            cash += proceeds["net_proceeds"]

    cycle_result["sells"] = sells_to_execute

    # ── Phase 2: Scan for buy signals ─────────────────────────────────────
    all_signals = scan_for_signals(db)
    cycle_result["signals_generated"] = len(all_signals) + len(sells_to_execute)

    # Filter out cards we already hold (excluding ones we're selling)
    selling_card_ids = {s["card_id"] for s in sells_to_execute}
    held_card_ids = {p["card_id"] for p in positions} - selling_card_ids
    buy_signals = [s for s in all_signals if s["card_id"] not in held_card_ids]

    # Score and rank buy signals
    scored_signals = []
    for signal in buy_signals:
        td = get_technical_data(db, signal["card_id"])
        if td is None:
            continue
        composite_score = score_buy_signal(signal, td)
        signal["composite_score"] = composite_score
        signal["_td"] = td  # Attach for sizing
        scored_signals.append(signal)

    scored_signals.sort(key=lambda s: s["composite_score"], reverse=True)

    # ── Phase 3: Execute top buys (respecting limits) ─────────────────────
    active_position_count = len(positions) - len(sells_to_execute)
    buys_executed = 0

    # Compute set concentration
    set_values: dict[str, float] = {}
    for pos in positions:
        if pos["card_id"] not in selling_card_ids:
            s_id = pos.get("set_id", "unknown")
            card = db.query(Card).filter(Card.id == pos["card_id"]).first()
            pos_value = (card.current_price or 0) * pos.get("quantity", 1)
            set_values[s_id] = set_values.get(s_id, 0) + pos_value

    for signal in scored_signals:
        if buys_executed >= MAX_NEW_BUYS_PER_CYCLE:
            break
        if active_position_count + buys_executed >= MAX_POSITIONS:
            break

        td = signal.pop("_td", None)
        if td is None:
            continue

        # Check set concentration
        sig_set_id = td.get("set_id", "unknown")
        current_set_value = set_values.get(sig_set_id, 0)
        if portfolio_value > 0 and current_set_value / portfolio_value > MAX_SET_CONCENTRATION_PCT:
            continue  # Skip: too concentrated in this set

        # Calculate position size
        quantity = calculate_position_size(
            portfolio_value=portfolio_value,
            cash=cash,
            card_price=signal["entry_price"],
            signal_strength=signal["composite_score"],
            num_positions=active_position_count + buys_executed,
        )

        if quantity <= 0:
            continue

        total_cost = signal["entry_price"] * quantity
        if total_cost > cash - (portfolio_value * CASH_RESERVE_PCT):
            continue  # Would breach cash reserve

        # Record the buy
        buy_order = {
            "card_id": signal["card_id"],
            "card_name": signal["card_name"],
            "signal": "buy",
            "strategy": signal["strategy"],
            "strength": signal["strength"],
            "composite_score": signal["composite_score"],
            "reasons": signal["reasons"],
            "entry_price": signal["entry_price"],
            "target_price": signal["target_price"],
            "stop_loss": signal["stop_loss"],
            "quantity": quantity,
            "total_cost": round(total_cost, 2),
            "set_id": sig_set_id,
        }
        cycle_result["buys"].append(buy_order)
        cash -= total_cost
        buys_executed += 1
        set_values[sig_set_id] = set_values.get(sig_set_id, 0) + total_cost

    # ── Phase 4: Compute portfolio snapshot ───────────────────────────────
    # Update portfolio value estimate
    positions_value = 0.0
    for pos in positions:
        if pos["card_id"] not in selling_card_ids:
            card = db.query(Card).filter(Card.id == pos["card_id"]).first()
            if card and card.current_price:
                positions_value += card.current_price * pos.get("quantity", 1)

    # Add new buys to position value
    for buy in cycle_result["buys"]:
        positions_value += buy["entry_price"] * buy["quantity"]

    cycle_result["portfolio_value"] = round(cash + positions_value, 2)
    cycle_result["daily_pnl"] = round(
        cycle_result["portfolio_value"] - portfolio_value + realized_pnl, 2
    )

    logger.info(
        "Trading cycle complete for portfolio %d: %d sells, %d buys, %d signals, "
        "portfolio value $%.2f, daily P&L $%.2f",
        portfolio_id,
        len(cycle_result["sells"]),
        len(cycle_result["buys"]),
        cycle_result["signals_generated"],
        cycle_result["portfolio_value"],
        cycle_result["daily_pnl"],
    )

    return cycle_result


# ── Convenience: Dry-Run Signal Scan ─────────────────────────────────────────

def get_signal_summary(db: Session) -> dict:
    """Run a signal scan and return a summary for the API/dashboard.

    Returns:
        total_signals: int
        buy_signals: list of top buy signals with scores
        strategy_counts: dict of strategy -> count
        market_regime_distribution: dict of regime -> count of cards
    """
    signals = scan_for_signals(db)

    # Enrich with composite scores
    enriched = []
    for sig in signals:
        td = get_technical_data(db, sig["card_id"])
        if td:
            sig["composite_score"] = score_buy_signal(sig, td)
            sig["liquidity_score"] = td["liquidity_score"]
            sig["sales_per_day"] = td["sales_per_day"]
            sig["regime"] = td["regime"]
            enriched.append(sig)

    # Strategy distribution
    strategy_counts: dict[str, int] = {}
    for s in enriched:
        strat = s["strategy"]
        strategy_counts[strat] = strategy_counts.get(strat, 0) + 1

    # Market regime distribution across all tracked cards
    regime_dist: dict[str, int] = {}
    cards = db.query(Card).filter(Card.is_tracked == True, Card.cached_regime.isnot(None)).all()
    for card in cards:
        r = card.cached_regime or "unknown"
        regime_dist[r] = regime_dist.get(r, 0) + 1

    return {
        "total_signals": len(enriched),
        "buy_signals": enriched[:20],  # Top 20 by strength
        "strategy_counts": strategy_counts,
        "market_regime_distribution": regime_dist,
    }
