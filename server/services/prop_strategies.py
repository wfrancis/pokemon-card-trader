"""
Prop Trading Strategy Engine — Collectibles-Specific Signal Generation.

Built from 14 domain expert research reports covering microstructure, momentum,
mean reversion, seasonal patterns, fee optimization, risk management, vintage
strategy, Pokemon meta, and more. See tasks/strategy_research/SYNTHESIS.md.

CORE PHILOSOPHY:
  - Velocity signals are the #1 leading indicator (leads price by 1-2 weeks)
  - Sale-based signals (VWAP, acceleration) are our unique data edge
  - Traditional TA (SMA, RSI, MACD) is unreliable on weekly-frequency card data
  - Fees (13.25% + $4.80 fixed) destroy thin edges — min $20 price floor
  - Spread compression as standalone strategy has NEGATIVE expected value

BUY STRATEGIES (ranked by expected alpha after fees):
  1. Velocity Spike — velocity z-score > 2.0 + price hasn't responded
  2. Accumulation Phase — velocity up 80%+ but price flat (smart money buying)
  3. Mean Reversion V2 — z-score entry with liquidity-adjusted thresholds
  4. VWAP Divergence — market price below actual sale VWAP
  5. OOP Momentum — out-of-print set detection + card-level acceleration
  6. Momentum Breakout — confirmed uptrend with velocity + anti-chase filter
  7. Vintage Value Buy — vintage-specific dip buy with wider parameters

SELL STRATEGIES (priority order):
  P0. Catastrophic stop (30-35% loss)
  P1. Liquidity death (velocity collapsed)
  P2. Take profit (ratcheting: let winners run if velocity hot)
  P3. Trailing stop (8% from peak for positions up 20%+)
  P4. Standard stop loss (strategy-specific)
  P5. Regime breakdown (distribution/markdown)
  P6. Velocity fade (for momentum strategies)
  P7. Time decay (strategy-specific max hold)
  P8. Seasonal sell window (Nov/Dec)

DISABLED STRATEGIES:
  - Spread Compression — fee math makes it impossible (5-15% gross vs 22-30% cost)
  - SMA Golden Cross — marginal after fees, demoted to confirmation filter
  - RSI Oversold Bounce — short hold rarely clears fees, confirmation only
"""
import logging
import math
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import asc, func
from sqlalchemy.orm import Session

from server.models.card import Card
from server.models.card_set import CardSet
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

# ── Constants (per SYNTHESIS Section 2) ─────────────────────────────────────

MIN_PRICE = 20.0               # Cards under $20 need 43%+ to break even
MIN_LIQUIDITY = 25             # Need reliable exit path
MIN_DATA_POINTS = 5            # Minimum price history records for signal quality
MAX_POSITIONS = 15             # At $10K, 15 positions = ~$667 avg
MAX_SINGLE_POSITION_PCT = 0.08 # Max 8% of portfolio in one card
MAX_SET_CONCENTRATION_PCT = 0.25  # Max 25% in one set
MAX_POKEMON_CONCENTRATION_PCT = 0.15  # Max 15% in one Pokemon name
CASH_RESERVE_PCT = 0.25        # Keep 25% cash minimum
MAX_NEW_BUYS_PER_CYCLE = 2     # Be selective

# Stop/Target defaults (overridden per strategy)
DEFAULT_STOP_LOSS_PCT = 0.20   # 20% — wider for illiquid cards
DEFAULT_TAKE_PROFIT_PCT = 0.40 # 40% — need 25%+ net after fees
STALE_POSITION_DAYS = 180      # 6 months to amortize fees
STALE_GAIN_THRESHOLD = 0.10    # Need 10%+ gain to justify holding

# Vintage overrides
VINTAGE_STOP_LOSS_PCT = 0.25
VINTAGE_TAKE_PROFIT_PCT = 0.50
VINTAGE_STALE_POSITION_DAYS = 365
VINTAGE_STALE_GAIN_THRESHOLD = 0.08

# Kelly criterion
KELLY_DAMPENER = 0.33          # One-third Kelly for illiquid assets
BOOTSTRAP_WIN_RATE = 0.55
BOOTSTRAP_AVG_WIN = 0.15
BOOTSTRAP_AVG_LOSS = 0.12

# Drawdown circuit breakers
DRAWDOWN_YELLOW = 0.07         # Halve position sizes
DRAWDOWN_ORANGE = 0.10         # Stop all new buys
DRAWDOWN_RED = 0.15            # Trim top 3 positions by 50%
DRAWDOWN_CRITICAL = 0.20       # Liquidate bottom quartile

# Trailing stop
TRAILING_STOP_ACTIVATION = 0.20  # Activate at +20% gain
TRAILING_STOP_PCT = 0.08        # 8% from peak

# Strategy names
STRATEGY_VELOCITY_SPIKE = "velocity_spike"
STRATEGY_ACCUMULATION = "accumulation_phase"
STRATEGY_MEAN_REVERSION = "mean_reversion_v2"
STRATEGY_VWAP_DIVERGENCE = "vwap_divergence"
STRATEGY_OOP_MOMENTUM = "oop_momentum"
STRATEGY_MOMENTUM_BREAKOUT = "momentum_breakout"
STRATEGY_VINTAGE_VALUE = "vintage_value_buy"

# Strategy-specific max hold days
STRATEGY_MAX_HOLD = {
    STRATEGY_VELOCITY_SPIKE: 45,
    STRATEGY_ACCUMULATION: 60,
    STRATEGY_MEAN_REVERSION: 120,
    STRATEGY_VWAP_DIVERGENCE: 60,
    STRATEGY_OOP_MOMENTUM: 180,
    STRATEGY_MOMENTUM_BREAKOUT: 90,
    STRATEGY_VINTAGE_VALUE: 365,
}

# ── Pokemon Popularity Tiers ────────────────────────────────────────────────

TIER1_POKEMON = {"Charizard", "Pikachu", "Mewtwo"}
TIER2_POKEMON = {"Mew", "Umbreon", "Rayquaza", "Gengar", "Eevee",
                 "Lugia", "Blastoise"}
TIER3_POKEMON = {"Venusaur", "Gyarados", "Dragonite", "Celebi",
                 "Gardevoir", "Tyranitar", "Alakazam", "Arcanine",
                 "Suicune", "Mimikyu", "Snorlax", "Garchomp",
                 "Giratina", "Arceus", "Sylveon", "Espeon"}

# ── Vintage Set IDs ─────────────────────────────────────────────────────────

VINTAGE_SET_IDS = {
    # WotC Era (1999-2003)
    "base1", "base2", "base3", "base4", "base5",
    "basep",  # Wizards Black Star Promos
    "jungle", "fossil", "gym1", "gym2",
    "neo1", "neo2", "neo3", "neo4",
    "base6",  # Legendary Collection
    "ecard1", "ecard2", "ecard3",  # Expedition, Aquapolis, Skyridge
    # Early Nintendo/ex-Era (2003-2006)
    "ex1", "ex2", "ex3", "ex4", "ex5", "ex6", "ex7", "ex8",
    "ex9", "ex10", "ex11", "ex12", "ex13", "ex14", "ex15", "ex16",
}

VINTAGE_INVESTABLE_RARITIES = {
    "Rare Holo", "Rare Secret", "Rare Holo EX", "Rare Holo Star",
    "Rare", "Promo",
}

# ── Seasonal Factors ────────────────────────────────────────────────────────

SEASONAL_BUY_BOOST = {1: 8, 2: 3, 9: 5, 10: 2}  # Best buy windows
SEASONAL_BUY_PENALTY = {7: -3, 8: -3, 11: -5, 12: -8}  # Sell windows


# ── Helper Functions ────────────────────────────────────────────────────────

def _is_tier1_pokemon(name: str) -> bool:
    return any(p.lower() in name.lower() for p in TIER1_POKEMON)


def _is_tier2_pokemon(name: str) -> bool:
    return any(p.lower() in name.lower() for p in TIER2_POKEMON)


def _is_tier3_pokemon(name: str) -> bool:
    return any(p.lower() in name.lower() for p in TIER3_POKEMON)


def _velocity_acceleration(td: dict) -> float:
    """Velocity acceleration ratio: recent (30d) vs baseline (90d)."""
    v_30d = td.get("sales_per_day", 0) or 0
    v_90d = (td.get("sales_90d", 0) or 0) / 90.0
    if v_90d < 0.01:
        return 1.0
    return v_30d / v_90d


def _is_vintage(set_id: str) -> bool:
    return set_id in VINTAGE_SET_IDS


def _get_max_hold_days(strategy: str, is_vintage: bool) -> int:
    if is_vintage and strategy != STRATEGY_VINTAGE_VALUE:
        return VINTAGE_STALE_POSITION_DAYS
    return STRATEGY_MAX_HOLD.get(strategy, STALE_POSITION_DAYS)


# ── Technical Data ──────────────────────────────────────────────────────────

def get_technical_data(db: Session, card_id: int) -> Optional[dict]:
    """Get all technical indicators + collectibles-specific metrics for a card.

    Returns comprehensive dict with technicals, velocity, acceleration,
    set dynamics, and Pokemon popularity data. Returns None if insufficient data.
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

    # ── Compute standard indicators ──
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

    # 30-day and 90-day highs/lows
    high_30d = max(prices[-30:]) if len(prices) >= 30 else max(prices)
    low_30d = min(prices[-30:]) if len(prices) >= 30 else min(prices)

    # ── Sales velocity ──
    now = datetime.now(timezone.utc)
    cutoff_30d = now - timedelta(days=30)
    cutoff_90d = now - timedelta(days=90)

    sales_30d = (
        db.query(func.count(Sale.id))
        .filter(Sale.card_id == card_id, Sale.order_date >= cutoff_30d)
        .scalar()
    ) or 0

    sales_90d = (
        db.query(func.count(Sale.id))
        .filter(Sale.card_id == card_id, Sale.order_date >= cutoff_90d)
        .scalar()
    ) or 0

    sales_per_day = sales_30d / 30.0
    velocity_90d = sales_90d / 90.0

    # ── Velocity acceleration ratio ──
    acceleration_ratio = (sales_per_day / velocity_90d) if velocity_90d > 0.01 else 1.0

    # ── Price changes ──
    price_change_7d = 0.0
    if len(prices) >= 7 and prices[-7] > 0:
        price_change_7d = (prices[-1] - prices[-7]) / prices[-7]
    elif len(prices) >= 2 and prices[0] > 0:
        price_change_7d = (prices[-1] - prices[0]) / prices[0]

    price_change_14d = 0.0
    if len(prices) >= 14 and prices[-14] > 0:
        price_change_14d = abs(prices[-1] - prices[-14]) / prices[-14]

    price_change_30d = 0.0
    if len(prices) >= 30 and prices[-30] > 0:
        price_change_30d = (prices[-1] - prices[-30]) / prices[-30]

    # ── Liquidity score ──
    liq_score = card.liquidity_score if card.liquidity_score is not None else calc_liquidity_score(
        sales_90d=sales_90d,
        sales_30d=sales_30d,
        card_price=card.current_price,
    )

    # ── Spread % (market vs mid price) ──
    spread_pct = None
    if records:
        latest = records[-1]
        if latest.mid_price and latest.market_price and latest.mid_price > 0:
            spread_pct = (latest.market_price - latest.mid_price) / latest.mid_price * 100

    # ── Set age (months since release) ──
    set_age_months = None
    try:
        card_set = db.query(CardSet).filter(CardSet.id == card.set_id).first()
        if card_set and card_set.release_date:
            delta = date.today() - card_set.release_date
            set_age_months = delta.days // 30
    except Exception:
        pass

    # ── Investment score ──
    inv_score = _calc_investment_score(card)

    return {
        "card_id": card_id,
        "card_name": card.name,
        "set_id": card.set_id,
        "set_name": card.set_name,
        "rarity": card.rarity,
        "current_price": card.current_price,
        "prices": prices,
        "dates": sorted_dates,
        "num_data_points": len(prices),
        # Standard technicals
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
        # Price levels
        "high_30d": high_30d,
        "low_30d": low_30d,
        # Velocity & acceleration
        "sales_per_day": sales_per_day,
        "sales_30d": sales_30d,
        "sales_90d": sales_90d,
        "velocity_90d": velocity_90d,
        "acceleration_ratio": acceleration_ratio,
        # Price changes
        "price_change_7d": price_change_7d,
        "price_change_14d": price_change_14d,
        "price_change_30d": price_change_30d,
        # Scores
        "liquidity_score": liq_score,
        "spread_pct": spread_pct,
        "appreciation_slope": card.appreciation_slope,
        "appreciation_score": card.appreciation_score,
        "appreciation_consistency": card.appreciation_consistency,
        "investment_score": inv_score,
        # Set & meta
        "set_age_months": set_age_months,
        "is_vintage": _is_vintage(card.set_id),
    }


def _calc_investment_score(card: Card) -> float:
    """Compute investment score from cached card metrics. 0-100."""
    app = card.appreciation_score or 0
    liq = card.liquidity_score or 0
    return round(app * 0.6 + liq * 0.4, 1)


# ── VWAP Computation ────────────────────────────────────────────────────────

def _compute_vwap(db: Session, card_id: int, days: int = 30) -> tuple:
    """Compute volume-weighted average sale price from Sale table.

    Returns (vwap, sale_count). Our unique data edge — most participants
    only see TCGPlayer's dampened market price, not actual transaction VWAP.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = db.query(
        func.sum(Sale.purchase_price * Sale.quantity),
        func.sum(Sale.quantity),
        func.count(Sale.id),
    ).filter(
        Sale.card_id == card_id,
        Sale.order_date >= cutoff,
        Sale.purchase_price > 0,
    ).first()

    total_value = result[0] or 0
    total_qty = result[1] or 0
    count = result[2] or 0

    if total_qty == 0:
        return None, 0
    return total_value / total_qty, count


# ── Velocity Z-Score ────────────────────────────────────────────────────────

def _calc_velocity_zscore(db: Session, card_id: int) -> tuple:
    """Compute velocity z-score from 13 weeks of weekly sale counts.

    Returns (zscore, current_weekly_velocity, baseline_velocity).
    Z-score > 2.0 = significant demand spike (2 standard deviations above mean).
    """
    now = datetime.now(timezone.utc)
    weekly_counts = []

    for week_offset in range(13):
        week_end = now - timedelta(days=week_offset * 7)
        week_start = week_end - timedelta(days=7)
        count = db.query(func.count(Sale.id)).filter(
            Sale.card_id == card_id,
            Sale.order_date >= week_start,
            Sale.order_date < week_end,
        ).scalar() or 0
        weekly_counts.append(count / 7.0)  # Daily velocity for that week

    current_velocity = weekly_counts[0]
    historical = weekly_counts[1:]

    if len(historical) < 4:
        return 0.0, current_velocity, 0.0

    baseline = statistics.mean(historical)
    stdev = statistics.stdev(historical) if len(historical) > 1 else 0.01
    stdev = max(stdev, 0.01)  # Avoid division by zero

    zscore = (current_velocity - baseline) / stdev
    return zscore, current_velocity, baseline


# ════════════════════════════════════════════════════════════════════════════
# BUY STRATEGIES
# ════════════════════════════════════════════════════════════════════════════

def _check_velocity_spike(td: dict, db: Session = None) -> Optional[dict]:
    """BUY #1: Velocity z-score spike with price confirmation filter.

    The single most profitable signal. When a card's sales velocity jumps 2+
    standard deviations above baseline while price hasn't moved, you have
    1-2 weeks before price catches up. Exploits TCGPlayer's dampened market
    price algorithm.

    Sources: momentum_catalyst.md, microstructure.md, data_signals.md
    """
    price = td.get("current_price", 0)
    card_id = td.get("card_id")
    if price < MIN_PRICE:
        return None

    # Compute velocity z-score
    if db is not None and card_id is not None:
        velocity_zscore, current_velocity, baseline_velocity = _calc_velocity_zscore(db, card_id)
    else:
        # Fallback: use acceleration ratio as proxy
        accel = td.get("acceleration_ratio", 1.0) or 1.0
        if accel < 2.0:
            return None
        velocity_zscore = (accel - 1.0) * 2.0  # Rough proxy
        current_velocity = td.get("sales_per_day", 0)
        baseline_velocity = td.get("velocity_90d", 0)

    if velocity_zscore < 2.0:
        return None

    # Price must NOT have already responded (< 30% move)
    price_change_7d = td.get("price_change_7d", 0) or 0
    if abs(price_change_7d) > 0.30:
        return None

    # Minimum velocity floor
    if current_velocity < 0.3:
        return None  # Less than 2 sales/week — z-score may be noise

    # Strength: higher z-score + lower price change = stronger
    z_factor = min(1.0, velocity_zscore / 4.0)
    price_freshness = max(0, 1.0 - abs(price_change_7d) / 0.30)
    strength = min(1.0, 0.4 + z_factor * 0.4 + price_freshness * 0.2)

    return {
        "card_id": card_id,
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_VELOCITY_SPIKE,
        "reasons": [
            f"Velocity z-score: {velocity_zscore:.1f} (threshold: 2.0)",
            f"Current velocity: {current_velocity:.2f}/day vs baseline {baseline_velocity:.2f}/day",
            f"Price change 7d: {price_change_7d:.1%} (not yet priced in)",
        ],
        "entry_price": price,
        "target_price": round(price * 1.25, 2),
        "stop_loss": round(price * 0.88, 2),
        "max_hold_days": 45,
    }


def _check_accumulation_phase(td: dict) -> Optional[dict]:
    """BUY #2: Velocity-price divergence (accumulation detection).

    When velocity increases 80%+ but price hasn't moved, someone is absorbing
    supply. In thin markets like TCGPlayer, a buyer can purchase 10-20 copies
    over 2 weeks without moving the market price. Once cheap supply is
    absorbed, price jumps discontinuously.

    Sources: momentum_catalyst.md, data_signals.md
    """
    price = td.get("current_price", 0)
    if price < MIN_PRICE:
        return None

    velocity = td.get("sales_per_day", 0) or 0
    velocity_90d = td.get("velocity_90d", 0) or 0

    if velocity_90d < 0.05:
        return None  # Less than 1 sale per 20 days — too sparse

    velocity_ratio = velocity / velocity_90d if velocity_90d > 0 else 1.0
    if velocity_ratio < 1.8:
        return None  # Need at least 80% velocity increase

    # Price must be flat (< 5% change in 14 days)
    price_change_14d = td.get("price_change_14d", 0) or 0
    if price_change_14d > 0.05:
        return None

    # Additional: 7d price change should also be small
    price_change_7d = td.get("price_change_7d", 0) or 0
    if abs(price_change_7d) > 0.10:
        return None

    # Strength scales with velocity ratio
    strength = min(1.0, (velocity_ratio - 1.0) / 3.0)
    if td.get("regime") == "accumulation":
        strength = min(1.0, strength + 0.15)

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_ACCUMULATION,
        "reasons": [
            f"Velocity ratio: {velocity_ratio:.1f}x baseline (threshold: 1.8x)",
            f"Price change 14d: {price_change_14d:.1%} (flat — accumulation pattern)",
            f"Current velocity: {velocity:.2f}/day vs baseline {velocity_90d:.2f}/day",
            f"Regime: {td.get('regime', 'N/A')}",
        ],
        "entry_price": price,
        "target_price": round(price * 1.30, 2),
        "stop_loss": round(price * 0.88, 2),
        "max_hold_days": 60,
    }


def _check_mean_reversion_v2(td: dict) -> Optional[dict]:
    """BUY #3: Z-score entry with liquidity-adjusted thresholds.

    Replaces flat "20% drop from 30d high" with statistically rigorous z-score.
    Key improvements:
    1. Standard deviation normalization (20% drop on 25% vol card is normal)
    2. Liquidity-adjusted thresholds (illiquid cards need deeper dislocations)
    3. ADX filter (skip trending cards where "drop" is trend continuation)

    Sources: mean_reversion.md, data_signals.md
    """
    prices = td.get("prices", [])
    price = td.get("current_price", 0)
    velocity = td.get("sales_per_day", 0) or 0
    adx = td.get("adx")

    if price < MIN_PRICE or len(prices) < 30:
        return None
    if velocity < 0.1:
        return None  # Too illiquid — price can stay dislocated indefinitely

    # Skip strong trends (ADX > 25 = don't fade)
    if adx is not None and adx > 25:
        return None

    # Compute z-score with 60-day lookback
    lookback = min(60, len(prices))
    window = prices[-lookback:]
    mean_price = sum(window) / len(window)
    variance = sum((p - mean_price) ** 2 for p in window) / (len(window) - 1)
    std = variance ** 0.5

    if std == 0 or mean_price == 0:
        return None

    z = (price - mean_price) / std

    # Liquidity-adjusted threshold
    if velocity > 1.0:
        z_threshold = -1.2  # High liquidity: tight threshold
    elif velocity > 0.3:
        z_threshold = -1.5  # Medium
    else:
        z_threshold = -2.0  # Low: need bigger dislocation

    if z >= z_threshold:
        return None

    # Velocity must be stable (not dropping alongside price)
    velocity_90d = td.get("velocity_90d", 0) or 0
    if velocity_90d > 0 and velocity < velocity_90d * 0.5:
        return None  # Declining demand, not mean reversion

    # Strength: deeper z-score = stronger (capped at z = -3.0)
    z_factor = min(1.0, abs(z) / 3.0)
    velocity_factor = min(1.0, velocity / 1.0)
    strength = min(1.0, 0.3 + z_factor * 0.5 + velocity_factor * 0.2)

    target = mean_price  # Reversion to mean
    stop = max(price - std, price * 0.80)

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_MEAN_REVERSION,
        "reasons": [
            f"Z-score: {z:.2f} (threshold: {z_threshold})",
            f"Price ${price:.2f} vs 60d mean ${mean_price:.2f} (std ${std:.2f})",
            f"Velocity: {velocity:.2f}/day (stable demand)",
            f"ADX: {adx:.0f}" if adx else "ADX: N/A",
        ],
        "entry_price": price,
        "target_price": round(target, 2),
        "stop_loss": round(stop, 2),
        "max_hold_days": 120,
    }


def _check_vwap_divergence(td: dict, db: Session = None) -> Optional[dict]:
    """BUY #4: Market price below actual sale VWAP (underpriced vs reality).

    Every trader sees TCGPlayer's market price. Few compute VWAP from
    individual sales. When market price < VWAP, the card is selling for
    more than its listed price suggests — it's underpriced.

    Sources: data_signals.md, spread_arbitrage.md
    """
    price = td.get("current_price", 0)
    card_id = td.get("card_id")
    if price < MIN_PRICE:
        return None

    vwap = None
    sale_count = 0

    if db is not None and card_id is not None:
        vwap, sale_count = _compute_vwap(db, card_id, days=30)
    else:
        # Fallback: use spread_pct as proxy (negative = underpriced)
        spread_pct = td.get("spread_pct")
        if spread_pct is not None and spread_pct < -5.0:
            vwap = price / (1 + spread_pct / 100)
            sale_count = td.get("sales_30d", 0) or 0

    if vwap is None or vwap <= 0 or sale_count < 5:
        return None

    # Divergence: how far below VWAP is market price?
    divergence_pct = (price - vwap) / vwap
    if divergence_pct > -0.05:
        return None  # Need at least 5% underpricing

    div_factor = min(1.0, abs(divergence_pct) / 0.20)
    strength = min(1.0, 0.4 + div_factor * 0.5)

    velocity = td.get("sales_per_day", 0) or 0
    if velocity > 0.5:
        strength = min(1.0, strength + 0.1)

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_VWAP_DIVERGENCE,
        "reasons": [
            f"Market ${price:.2f} vs VWAP ${vwap:.2f} ({divergence_pct:.1%} divergence)",
            f"Based on {sale_count} sales in last 30 days",
            f"Velocity: {velocity:.2f}/day",
        ],
        "entry_price": price,
        "target_price": round(vwap, 2),
        "stop_loss": round(price * 0.88, 2),
        "max_hold_days": 60,
    }


def _check_oop_momentum(td: dict, db: Session = None) -> Optional[dict]:
    """BUY #5: Out-of-print set detection + card-level momentum.

    When a set stops being printed, supply becomes fixed and key cards
    appreciate 20-100% over 6-12 months. We detect OOP from:
    1. Set age >= 12 months
    2. Card-level velocity acceleration
    3. Bullish regime

    Sources: modern_flip_strategy.md, microstructure.md
    """
    price = td.get("current_price", 0)
    if price < MIN_PRICE:
        return None

    set_age_months = td.get("set_age_months")
    if set_age_months is None or set_age_months < 9:
        return None

    if td.get("is_vintage"):
        return None  # Vintage has its own strategy

    velocity = td.get("sales_per_day", 0) or 0
    if velocity < 0.3:
        return None

    regime = td.get("regime")
    if regime == "markdown":
        return None

    accel_ratio = td.get("acceleration_ratio", 1.0) or 1.0
    if accel_ratio < 1.2:
        return None

    # OOP score from set age
    oop_score = 0
    if set_age_months >= 18:
        oop_score += 40
    elif set_age_months >= 12:
        oop_score += 25
    elif set_age_months >= 9:
        oop_score += 10

    # Card-level acceleration adds confidence
    if accel_ratio >= 2.0:
        oop_score += 35
    elif accel_ratio >= 1.5:
        oop_score += 20
    elif accel_ratio >= 1.2:
        oop_score += 10

    # Regime bonus
    if regime in ("accumulation", "markup"):
        oop_score += 15

    if oop_score < 35:
        return None

    oop_factor = min(1.0, oop_score / 80.0)
    accel_factor = min(1.0, (accel_ratio - 1.0) / 2.0)
    strength = min(1.0, 0.3 + oop_factor * 0.4 + accel_factor * 0.3)

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_OOP_MOMENTUM,
        "reasons": [
            f"OOP score: {oop_score}/100 (set age: {set_age_months}mo)",
            f"Card acceleration: {accel_ratio:.1f}x",
            f"Regime: {regime}",
            f"Velocity: {velocity:.2f}/day",
        ],
        "entry_price": price,
        "target_price": round(price * 1.35, 2),
        "stop_loss": round(price * 0.85, 2),
        "max_hold_days": 180,
    }


def _check_momentum_breakout(td: dict) -> Optional[dict]:
    """BUY #6: Confirmed momentum with velocity + anti-chase filter.

    Enhanced momentum strategy:
    1. Requires 2 consecutive weeks of price increase + stable velocity
    2. Rejects if price already rallied >30% from 30d low (too late)
    3. Pullback entry: stronger signal if buying 5-10% dip in uptrend

    Sources: momentum_catalyst.md, modern_flip_strategy.md
    """
    price = td.get("current_price", 0)
    if price < MIN_PRICE:
        return None

    prices = td.get("prices", [])
    if len(prices) < 14:
        return None

    velocity = td.get("sales_per_day", 0) or 0
    if velocity < 0.3:
        return None

    regime = td.get("regime")
    if regime not in ("accumulation", "markup"):
        return None

    # Rule 1: Confirmed momentum (2 consecutive weekly increases)
    if len(prices) >= 21:
        p_w0, p_w1, p_w2 = prices[-1], prices[-7], prices[-14]
        if not (p_w0 > p_w1 and p_w1 > p_w2):
            return None
    elif len(prices) >= 14:
        if not (prices[-1] > prices[-7]):
            return None
    else:
        return None

    # Rule 2: Don't chase (skip if up >30% from 30d low)
    low_30d = td.get("low_30d", min(prices[-min(30, len(prices)):]))
    rally_pct = (price - low_30d) / low_30d if low_30d > 0 else 0
    if rally_pct > 0.30:
        return None

    # Rule 3: Velocity confirmation
    velocity_90d = td.get("velocity_90d", 0) or 0
    if velocity_90d > 0 and velocity < velocity_90d * 0.8:
        return None  # Velocity declining — distribution, not momentum

    # Pullback bonus
    high_14d = max(prices[-min(14, len(prices)):])
    pullback_pct = (high_14d - price) / high_14d if high_14d > 0 else 0
    pullback_bonus = 0.15 if 0.05 <= pullback_pct <= 0.10 else 0.0

    trend_factor = min(1.0, rally_pct / 0.20)
    vel_factor = min(1.0, velocity / 2.0)
    strength = min(1.0, 0.3 + trend_factor * 0.3 + vel_factor * 0.2 + pullback_bonus)

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_MOMENTUM_BREAKOUT,
        "reasons": [
            "Confirmed uptrend: 2+ consecutive up weeks",
            f"Rally from 30d low: {rally_pct:.1%} (below 30% chase threshold)",
            f"Velocity: {velocity:.2f}/day (stable/rising)",
            f"Regime: {regime}",
        ] + ([f"Pullback bonus: {pullback_pct:.1%} dip in uptrend"] if pullback_bonus > 0 else []),
        "entry_price": price,
        "target_price": round(price * 1.30, 2),
        "stop_loss": round(price * 0.85, 2),
        "max_hold_days": 90,
    }


def _check_vintage_value_buy(td: dict) -> Optional[dict]:
    """BUY #7: Vintage card dip buy with wider parameters.

    Vintage cards mean-revert reliably due to:
    1. Fixed supply (no reprints affect original value)
    2. Collector demand floor (Charizard will never be worth zero)
    3. Condition scarcity (NM vintage is genuinely rare)

    But need different parameters: lower velocity, longer recovery, wider stops.

    Sources: vintage_strategy.md, risk_management.md
    """
    price = td.get("current_price", 0)
    set_id = td.get("set_id", "")
    rarity = td.get("rarity", "")

    if not _is_vintage(set_id):
        return None
    if rarity and rarity not in VINTAGE_INVESTABLE_RARITIES:
        return None
    if price < 15.0:  # Lower floor for vintage
        return None

    velocity = td.get("sales_per_day", 0) or 0
    if velocity < 0.05:
        return None  # Less than 1.5 sales/month

    regime = td.get("regime")
    if regime == "markdown":
        return None

    prices = td.get("prices", [])
    if len(prices) < 15:
        return None

    # Compute drop from 90-day high
    lookback = min(90, len(prices))
    high_90d = max(prices[-lookback:])
    if high_90d <= 0:
        return None

    drop_pct = (high_90d - price) / high_90d
    if drop_pct < 0.15:
        return None

    # RSI confirmation
    rsi = td.get("rsi_14")
    if rsi is not None and rsi > 45:
        return None

    # Seasonal boost for vintage
    month = date.today().month
    seasonal_boost = 0.0
    if month in (1, 2):
        seasonal_boost = 0.15
    elif month in (8, 9):
        seasonal_boost = 0.10

    # Strength
    drop_factor = min(0.35, (drop_pct - 0.15) * 2.5)
    rsi_factor = 0.1 if (rsi is not None and rsi < 30) else 0.0
    strength = min(1.0, 0.55 + drop_factor + seasonal_boost + rsi_factor)

    sma_90 = sum(prices[-lookback:]) / lookback

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_VINTAGE_VALUE,
        "reasons": [
            f"Vintage value buy: dropped {drop_pct:.1%} from 90d high ${high_90d:.2f}",
            f"Current: ${price:.2f}, 90d SMA: ${sma_90:.2f}",
            f"Velocity: {velocity:.2f}/day (demand persists)",
        ] + ([f"RSI: {rsi:.0f}"] if rsi else [])
          + ([f"Seasonal boost: +{seasonal_boost:.0%}"] if seasonal_boost > 0 else []),
        "entry_price": price,
        "target_price": round(sma_90, 2),
        "stop_loss": round(price * 0.80, 2),
        "max_hold_days": 365,
    }


# ════════════════════════════════════════════════════════════════════════════
# COMPOSITE BUY SCORE (0-100)
# ════════════════════════════════════════════════════════════════════════════

def compute_composite_buy_score(td: dict, signal: dict) -> float:
    """Compute 0-100 buy score from all available factors.

    Components (sum to 100%):
      25% Velocity Trend — most predictive factor
      20% Fair Value Gap — spread/VWAP divergence is our unique edge
      15% Signal Strength — strategy-specific quality
      10% Set Dynamics — OOP detection, set age
      10% Pokemon Popularity — blue-chip demand floor
      10% Liquidity Quality — exit path reliability
      10% Fee Viability — can trade clear the fee wall?

    Modifiers: seasonal boost/penalty, data confidence discount, regime filter.
    """
    score = 0.0

    # Component 1: Velocity Trend (25%)
    accel = td.get("acceleration_ratio", 1.0) or 1.0
    velocity_raw = max(0, min(100, 50 + (accel - 1.0) * 50))
    if td.get("sales_per_day", 0) == 0 and td.get("sales_90d", 0) == 0:
        velocity_raw = 0
    score += velocity_raw * 0.25

    # Component 2: Fair Value Gap (20%)
    spread_pct = td.get("spread_pct")
    if spread_pct is not None:
        fv_raw = max(0, min(100, 40 + (-spread_pct) * 2.4))
    else:
        fv_raw = 30
    score += fv_raw * 0.20

    # Component 3: Signal Strength (15%)
    strength = signal.get("strength", 0.5)
    score += (strength * 100) * 0.15

    # Component 4: Set Dynamics (10%)
    set_score = 50
    set_age = td.get("set_age_months")
    if set_age is not None:
        if set_age >= 18:
            set_score = 90
        elif set_age >= 12:
            set_score = 70
        elif set_age >= 6:
            set_score = 50
        elif set_age < 3:
            set_score = 20
    if td.get("is_vintage"):
        set_score = 75  # Vintage sets are inherently interesting
    score += set_score * 0.10

    # Component 5: Pokemon Popularity (10%)
    card_name = td.get("card_name", "")
    if _is_tier1_pokemon(card_name):
        pokemon_score = 95
    elif _is_tier2_pokemon(card_name):
        pokemon_score = 75
    elif _is_tier3_pokemon(card_name):
        pokemon_score = 55
    else:
        pokemon_score = 30
    score += pokemon_score * 0.10

    # Component 6: Liquidity Quality (10%)
    liq = td.get("liquidity_score", 0) or 0
    liq_raw = min(100, liq * 1.25)
    score += liq_raw * 0.10

    # Component 7: Fee Viability (10%)
    price = td.get("current_price", 0) or 0
    if price >= 200:
        fee_score = 100
    elif price >= 100:
        fee_score = 85
    elif price >= 50:
        fee_score = 65
    elif price >= 30:
        fee_score = 40
    elif price >= 20:
        fee_score = 20
    else:
        fee_score = 0
    score += fee_score * 0.10

    # ── Modifiers ──

    # Seasonal adjustment
    month = date.today().month
    score += SEASONAL_BUY_BOOST.get(month, 0)
    score += SEASONAL_BUY_PENALTY.get(month, 0)

    # Data confidence discount
    data_points = td.get("num_data_points", 0) or 0
    if data_points < 10:
        score *= 0.7
    elif data_points < 20:
        score *= 0.85
    elif data_points < 30:
        score *= 0.95

    # Regime filter
    regime = td.get("regime")
    if regime == "markdown":
        score *= 0.5
    elif regime == "distribution":
        score *= 0.7
    elif regime == "accumulation":
        score *= 1.1

    return round(max(0, min(100, score)), 1)


# ════════════════════════════════════════════════════════════════════════════
# SIGNAL SCANNING
# ════════════════════════════════════════════════════════════════════════════

def scan_for_signals(db: Session) -> list[dict]:
    """Scan all tracked cards for actionable buy signals.

    Uses collectibles-specific strategies ranked by expected alpha:
    1. Velocity Spike, 2. Accumulation Phase, 3. Mean Reversion V2,
    4. VWAP Divergence, 5. OOP Momentum, 6. Momentum Breakout,
    7. Vintage Value Buy.

    Returns list of signal dicts sorted by composite_score descending.
    """
    cards = (
        db.query(Card)
        .filter(
            Card.is_tracked == True,
            Card.current_price.isnot(None),
            Card.current_price >= MIN_PRICE,
        )
        .all()
    )

    # Also include vintage cards with lower price floor
    vintage_cards = (
        db.query(Card)
        .filter(
            Card.is_tracked == True,
            Card.current_price.isnot(None),
            Card.current_price >= 15.0,
            Card.current_price < MIN_PRICE,
            Card.set_id.in_(VINTAGE_SET_IDS),
        )
        .all()
    )
    all_cards = list(cards) + list(vintage_cards)

    signals: list[dict] = []

    for card in all_cards:
        try:
            td = get_technical_data(db, card.id)
        except Exception as e:
            logger.debug(f"get_technical_data failed for card {card.id}: {e}")
            continue
        if td is None:
            continue

        if td["liquidity_score"] < MIN_LIQUIDITY and not td["is_vintage"]:
            continue
        if td["num_data_points"] < MIN_DATA_POINTS:
            continue

        # Check each strategy
        buy_checks = [
            lambda t: _check_velocity_spike(t, db),
            _check_accumulation_phase,
            _check_mean_reversion_v2,
            lambda t: _check_vwap_divergence(t, db),
            lambda t: _check_oop_momentum(t, db),
            _check_momentum_breakout,
            _check_vintage_value_buy,
        ]

        for check_fn in buy_checks:
            try:
                signal = check_fn(td)
                if signal is not None:
                    # Compute composite score
                    signal["composite_score"] = compute_composite_buy_score(td, signal)
                    signal["liquidity_score"] = td["liquidity_score"]
                    signal["sales_per_day"] = td["sales_per_day"]
                    signal["regime"] = td["regime"]
                    signal["acceleration_ratio"] = td["acceleration_ratio"]
                    signal["set_name"] = td["set_name"]
                    signal["is_vintage"] = td["is_vintage"]
                    signals.append(signal)
            except Exception as e:
                logger.debug(f"Signal check failed for card {card.id}: {e}")

    # Sort by composite score descending
    signals.sort(key=lambda s: s.get("composite_score", 0), reverse=True)
    return signals


# ════════════════════════════════════════════════════════════════════════════
# SELL SIGNALS
# ════════════════════════════════════════════════════════════════════════════

def check_sell_signals(db: Session, position: dict) -> Optional[dict]:
    """Check if an existing position should be sold.

    Priority-ordered exit rules (first match triggers):
      P0. Catastrophic stop (30-35% loss)
      P1. Liquidity death (velocity collapsed)
      P2. Take profit with ratcheting (let winners run if velocity hot)
      P3. Trailing stop (8% from peak for positions up 20%+)
      P4. Standard stop loss
      P5. Regime breakdown
      P6. Velocity fade (for momentum strategies)
      P7. Time decay (strategy-specific max hold)
      P8. Seasonal sell window

    Args:
        position: dict with card_id, entry_price, entry_date, stop_loss,
                  take_profit, quantity, strategy (optional)
    """
    td = get_technical_data(db, position["card_id"])
    if td is None:
        return None

    price = td["current_price"]
    entry_price = position["entry_price"]
    is_vintage = td.get("is_vintage", False)
    strategy = position.get("strategy", "unknown")

    if entry_price <= 0:
        return None

    unrealized_pct = (price - entry_price) / entry_price

    # Calculate days held
    entry_date = position.get("entry_date")
    days_held = 0
    if entry_date:
        try:
            if isinstance(entry_date, str):
                entry_date = date.fromisoformat(entry_date.replace("Z", "").split("T")[0])
            elif isinstance(entry_date, datetime):
                entry_date = entry_date.date()
            days_held = (date.today() - entry_date).days
        except Exception:
            days_held = 0

    velocity = td.get("sales_per_day", 0) or 0
    regime = td.get("regime", "")

    # Minimum hold period — trades need time to overcome friction
    MIN_HOLD_DAYS = {
        STRATEGY_VELOCITY_SPIKE: 14,
        STRATEGY_ACCUMULATION: 21,
        STRATEGY_MEAN_REVERSION: 30,
        STRATEGY_VWAP_DIVERGENCE: 21,
        STRATEGY_OOP_MOMENTUM: 30,
        STRATEGY_MOMENTUM_BREAKOUT: 14,
        STRATEGY_VINTAGE_VALUE: 45,
    }
    min_hold = MIN_HOLD_DAYS.get(strategy, 14)
    in_hold_period = days_held < min_hold

    def _sell(signal_name: str, strength: float, reason: str) -> dict:
        return {
            "card_id": position["card_id"],
            "card_name": td["card_name"],
            "signal": "sell",
            "strength": round(strength, 3),
            "strategy": signal_name,
            "reasons": [reason],
            "current_price": price,
            "entry_price": entry_price,
            "pnl_pct": round(unrealized_pct * 100, 2),
            "quantity": position.get("quantity", 1),
            "days_held": days_held,
        }

    # P0: Catastrophic stop (unconditional)
    catastrophic_pct = 0.35 if is_vintage else 0.30
    if price <= entry_price * (1 - catastrophic_pct):
        return _sell("catastrophic_stop", 1.0,
                      f"Price dropped {catastrophic_pct:.0%} from entry — unconditional exit")

    # P1: Liquidity death
    vel_threshold = 0.03 if is_vintage else 0.05
    vel_days = 60 if is_vintage else 30
    if velocity < vel_threshold and days_held > vel_days:
        return _sell("liquidity_death", 0.95,
                      f"Velocity {velocity:.3f}/day for {days_held}d — liquidity evaporated")

    # Skip non-critical exits during minimum hold period
    # Only catastrophic stop (P0), liquidity death (P1), and stop loss (P4) can fire early
    if in_hold_period:
        # P4: Standard stop loss (allowed during hold period)
        sl_pct = VINTAGE_STOP_LOSS_PCT if is_vintage else DEFAULT_STOP_LOSS_PCT
        custom_sl = position.get("stop_loss")
        if custom_sl and price <= custom_sl:
            return _sell("stop_loss", 0.85,
                          f"Stop loss hit during hold period: ${price:.2f} <= ${custom_sl:.2f}")
        elif price <= entry_price * (1 - sl_pct):
            return _sell("stop_loss", 0.85,
                          f"Stop loss during hold period: price dropped {sl_pct:.0%}")
        return None  # Hold — still in minimum hold period

    # P2: Take profit (ratcheting — let winners run if velocity hot)
    tp_pct = VINTAGE_TAKE_PROFIT_PCT if is_vintage else DEFAULT_TAKE_PROFIT_PCT
    custom_tp = position.get("take_profit")
    if custom_tp and entry_price > 0:
        tp_pct = (custom_tp - entry_price) / entry_price

    if unrealized_pct >= tp_pct:
        accel = _velocity_acceleration(td)
        if accel > 1.5:
            # Velocity still accelerating — use trailing stop instead
            # (fall through to P3)
            pass
        else:
            return _sell("take_profit", 0.85,
                          f"Take profit hit: +{unrealized_pct:.1%} (target: +{tp_pct:.0%})")

    # P3: Trailing stop (for positions up 20%+)
    if unrealized_pct > TRAILING_STOP_ACTIVATION:
        high_30d = td.get("high_30d", price)
        if high_30d and price < high_30d * (1 - TRAILING_STOP_PCT):
            return _sell("trailing_stop", 0.9,
                          f"Trailing stop: dropped {TRAILING_STOP_PCT:.0%} from "
                          f"recent high ${high_30d:.2f}")

    # P4: Standard stop loss
    sl_pct = VINTAGE_STOP_LOSS_PCT if is_vintage else DEFAULT_STOP_LOSS_PCT
    custom_sl = position.get("stop_loss")
    if custom_sl and price <= custom_sl:
        return _sell("stop_loss", 0.85,
                      f"Stop loss hit: price ${price:.2f} <= stop ${custom_sl:.2f}")
    elif price <= entry_price * (1 - sl_pct):
        return _sell("stop_loss", 0.85,
                      f"Stop loss: price dropped {sl_pct:.0%} from entry")

    # P5: Regime breakdown
    # SKIP for mean reversion, VWAP divergence, vintage — they deliberately buy dips
    if strategy not in (STRATEGY_MEAN_REVERSION, STRATEGY_VWAP_DIVERGENCE, STRATEGY_VINTAGE_VALUE):
        if regime in ("distribution", "markdown"):
            if unrealized_pct > 0:
                return _sell("regime_breakdown", 0.75,
                              f"Regime shifted to '{regime}' — taking {unrealized_pct:.1%} gain")

    # P6: Velocity fade (for momentum strategies)
    if strategy in (STRATEGY_VELOCITY_SPIKE, STRATEGY_ACCUMULATION, STRATEGY_MOMENTUM_BREAKOUT):
        accel = _velocity_acceleration(td)
        if accel < 0.5 and days_held > 14:
            return _sell("velocity_fade", 0.8,
                          f"Velocity faded to {accel:.1f}x baseline (entered on momentum)")

    # P7: Time decay (strategy-specific max hold)
    max_hold = _get_max_hold_days(strategy, is_vintage)
    if days_held > max_hold:
        threshold = VINTAGE_STALE_GAIN_THRESHOLD if is_vintage else STALE_GAIN_THRESHOLD
        if unrealized_pct < threshold:
            return _sell("stale_position", 0.6,
                          f"Held {days_held}d (max: {max_hold}d) with {unrealized_pct:.1%} gain "
                          f"(need {threshold:.0%})")

    # P8: Seasonal sell window
    month = date.today().month
    if month in (11, 12) and unrealized_pct > 0.15 and days_held > 30:
        if not is_vintage or unrealized_pct > 0.30:
            return _sell("seasonal_sell", 0.6,
                          f"Holiday sell window — locking {unrealized_pct:.1%} gain")

    return None  # Hold


# ════════════════════════════════════════════════════════════════════════════
# POSITION SIZING
# ════════════════════════════════════════════════════════════════════════════

def calculate_position_size(
    portfolio_value: float,
    cash: float,
    card_price: float,
    composite_score: float,
    velocity: float = 0.0,
    is_vintage: bool = False,
    drawdown_pct: float = 0.0,
    num_positions: int = 0,
) -> int:
    """Calculate how many copies to buy using Kelly criterion + liquidity caps.

    Combines conviction-scaled Kelly fraction with liquidity-based position
    cap and drawdown scaling. Returns number of copies (0 if trade rejected).
    """
    if card_price <= 0 or portfolio_value <= 0 or cash <= 0:
        return 0

    # Drawdown circuit breaker
    if drawdown_pct >= DRAWDOWN_ORANGE:
        return 0  # No new buys at 10%+ drawdown

    # Step 1: Kelly-inspired base allocation
    conviction = max(0, (composite_score - 50)) / 50  # 50=0%, 100=100%
    kelly = (BOOTSTRAP_WIN_RATE * BOOTSTRAP_AVG_WIN -
             (1 - BOOTSTRAP_WIN_RATE) * BOOTSTRAP_AVG_LOSS)
    if BOOTSTRAP_AVG_WIN > 0:
        kelly /= BOOTSTRAP_AVG_WIN
    kelly *= KELLY_DAMPENER
    kelly *= (0.3 + conviction * 0.7)
    kelly = max(0.02, min(0.10, kelly))
    base_dollars = portfolio_value * kelly

    # Step 2: Liquidity cap
    liq_max_pct = min(0.10, 0.02 + math.log(velocity + 1) * 0.05)
    liq_max_dollars = portfolio_value * liq_max_pct

    # Step 3: Drawdown scaling
    drawdown_multiplier = 0.5 if drawdown_pct >= DRAWDOWN_YELLOW else 1.0

    # Step 4: Cash reserve check
    reserve = portfolio_value * CASH_RESERVE_PCT
    available = max(0, cash - reserve)

    # Step 5: Hard cap
    max_pos_pct = 0.15 if is_vintage else MAX_SINGLE_POSITION_PCT
    hard_cap = portfolio_value * max_pos_pct

    # Step 6: Diversification pressure
    if num_positions > 10:
        base_dollars *= 0.5
    elif num_positions > 7:
        base_dollars *= 0.7

    dollars = min(base_dollars, liq_max_dollars, hard_cap, available)
    dollars *= drawdown_multiplier

    if dollars < card_price:
        return 0

    # Convert to quantity with price-tier caps
    qty = int(dollars / card_price)
    if card_price > 100:
        qty = min(qty, 1)
    elif card_price > 50:
        qty = min(qty, 2)
    elif card_price > 20:
        qty = min(qty, 3)
    else:
        qty = min(qty, 4)

    if is_vintage and card_price > 50:
        qty = min(qty, 1)

    return qty


# ════════════════════════════════════════════════════════════════════════════
# TRADING CYCLE
# ════════════════════════════════════════════════════════════════════════════

async def run_trading_cycle(
    db: Session,
    portfolio_id: int,
    positions: list[dict],
    portfolio_value: float,
    cash: float,
) -> dict:
    """Execute one full trading cycle: scan signals + execute trades.

    Pure computation — caller persists trades and portfolio state.

    Position limits:
    - Max 15 positions, max 8% single card, max 25% single set
    - 25% cash reserve, max 2 new buys per cycle
    - Drawdown circuit breakers at 7/10/15/20%
    """
    cycle_result = {
        "sells": [],
        "buys": [],
        "signals_generated": 0,
        "portfolio_value": portfolio_value,
        "daily_pnl": 0.0,
    }

    # ── Phase 1: Check sell signals ──
    sells_to_execute = []
    realized_pnl = 0.0

    for pos in positions:
        sell_signal = check_sell_signals(db, pos)
        if sell_signal is not None:
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

    # ── Phase 2: Scan for buy signals ──
    all_signals = scan_for_signals(db)
    cycle_result["signals_generated"] = len(all_signals) + len(sells_to_execute)

    # Filter out cards we already hold
    selling_card_ids = {s["card_id"] for s in sells_to_execute}
    held_card_ids = {p["card_id"] for p in positions} - selling_card_ids
    buy_signals = [s for s in all_signals if s["card_id"] not in held_card_ids]

    # Filter out cards on cooldown (recently sold at a loss — don't re-buy falling knives)
    from server.models.virtual_trade import VirtualTrade
    COOLDOWN_DAYS_LOSS = 60    # 2 months cooldown after selling at a loss
    COOLDOWN_DAYS_NEUTRAL = 14 # 2 weeks cooldown after any sell
    MAX_LOSSES_PER_CARD = 2    # Ban card after 2 losses
    cooldown_cutoff_loss = datetime.now(timezone.utc) - timedelta(days=COOLDOWN_DAYS_LOSS)
    cooldown_cutoff_neutral = datetime.now(timezone.utc) - timedelta(days=COOLDOWN_DAYS_NEUTRAL)

    # Get recently sold card IDs with loss
    recent_loss_sells = (
        db.query(VirtualTrade.card_id)
        .filter(
            VirtualTrade.portfolio_id == portfolio_id,
            VirtualTrade.side == "sell",
            VirtualTrade.executed_at >= cooldown_cutoff_loss,
            VirtualTrade.realized_pnl < 0,
        )
        .distinct()
        .all()
    )
    loss_cooldown_ids = {r[0] for r in recent_loss_sells}

    # Get any recently sold card IDs (even at profit — avoid churn)
    recent_any_sells = (
        db.query(VirtualTrade.card_id)
        .filter(
            VirtualTrade.portfolio_id == portfolio_id,
            VirtualTrade.side == "sell",
            VirtualTrade.executed_at >= cooldown_cutoff_neutral,
        )
        .distinct()
        .all()
    )
    neutral_cooldown_ids = {r[0] for r in recent_any_sells}

    # Cards with too many historical losses — permanently banned
    from sqlalchemy import func as sqlfunc
    repeat_losers = (
        db.query(VirtualTrade.card_id)
        .filter(
            VirtualTrade.portfolio_id == portfolio_id,
            VirtualTrade.side == "sell",
            VirtualTrade.realized_pnl < 0,
        )
        .group_by(VirtualTrade.card_id)
        .having(sqlfunc.count(VirtualTrade.id) >= MAX_LOSSES_PER_CARD)
        .all()
    )
    banned_ids = {r[0] for r in repeat_losers}

    # Also block cards being sold this cycle
    cooldown_ids = loss_cooldown_ids | neutral_cooldown_ids | selling_card_ids | banned_ids
    buy_signals = [s for s in buy_signals if s["card_id"] not in cooldown_ids]

    if cooldown_ids:
        logger.info("Cooldown active: %d cards blocked from re-buy (%d loss, %d neutral, %d selling)",
                     len(cooldown_ids), len(loss_cooldown_ids), len(neutral_cooldown_ids), len(selling_card_ids))

    # Only buy signals above threshold
    buy_signals = [s for s in buy_signals if s.get("composite_score", 0) >= 55]

    # ── Phase 3: Execute top buys ──
    active_position_count = len(positions) - len(sells_to_execute)
    buys_executed = 0

    # Set/Pokemon concentration tracking
    set_values: dict[str, float] = {}
    pokemon_values: dict[str, float] = {}
    for pos in positions:
        if pos["card_id"] not in selling_card_ids:
            card = db.query(Card).filter(Card.id == pos["card_id"]).first()
            pos_value = (card.current_price or 0) * pos.get("quantity", 1) if card else 0
            s_id = pos.get("set_id", card.set_id if card else "unknown")
            set_values[s_id] = set_values.get(s_id, 0) + pos_value
            if card:
                # Extract Pokemon name (first word before any space)
                poke_name = card.name.split()[0] if card.name else "unknown"
                pokemon_values[poke_name] = pokemon_values.get(poke_name, 0) + pos_value

    # Calculate drawdown for position sizing
    # (simplified: use high_water_mark from portfolio if available)
    drawdown_pct = 0.0  # Would need portfolio snapshot data

    for signal in buy_signals:
        if buys_executed >= MAX_NEW_BUYS_PER_CYCLE:
            break
        if active_position_count + buys_executed >= MAX_POSITIONS:
            break

        card_id = signal["card_id"]
        sig_set_id = signal.get("set_id", "unknown")
        is_vintage = signal.get("is_vintage", False)

        # Check set concentration
        current_set_value = set_values.get(sig_set_id, 0)
        if portfolio_value > 0 and current_set_value / portfolio_value > MAX_SET_CONCENTRATION_PCT:
            continue

        # Calculate position size
        quantity = calculate_position_size(
            portfolio_value=portfolio_value,
            cash=cash,
            card_price=signal["entry_price"],
            composite_score=signal.get("composite_score", 50),
            velocity=signal.get("sales_per_day", 0),
            is_vintage=is_vintage,
            drawdown_pct=drawdown_pct,
            num_positions=active_position_count + buys_executed,
        )

        if quantity <= 0:
            continue

        total_cost = signal["entry_price"] * quantity
        if total_cost > cash - (portfolio_value * CASH_RESERVE_PCT):
            continue

        buy_order = {
            "card_id": card_id,
            "card_name": signal["card_name"],
            "signal": "buy",
            "strategy": signal["strategy"],
            "strength": signal["strength"],
            "composite_score": signal.get("composite_score", 0),
            "reasons": signal["reasons"],
            "entry_price": signal["entry_price"],
            "target_price": signal["target_price"],
            "stop_loss": signal["stop_loss"],
            "quantity": quantity,
            "total_cost": round(total_cost, 2),
            "set_id": sig_set_id,
            "reason": "; ".join(signal["reasons"][:2]),
        }
        cycle_result["buys"].append(buy_order)
        cash -= total_cost
        buys_executed += 1
        set_values[sig_set_id] = set_values.get(sig_set_id, 0) + total_cost

    # ── Phase 4: Portfolio snapshot ──
    positions_value = 0.0
    for pos in positions:
        if pos["card_id"] not in selling_card_ids:
            card = db.query(Card).filter(Card.id == pos["card_id"]).first()
            if card and card.current_price:
                positions_value += card.current_price * pos.get("quantity", 1)

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


# ════════════════════════════════════════════════════════════════════════════
# CONVENIENCE: Signal Summary
# ════════════════════════════════════════════════════════════════════════════

def get_signal_summary(db: Session) -> dict:
    """Run a signal scan and return summary for the API/dashboard."""
    signals = scan_for_signals(db)

    strategy_counts: dict[str, int] = {}
    for s in signals:
        strat = s["strategy"]
        strategy_counts[strat] = strategy_counts.get(strat, 0) + 1

    regime_dist: dict[str, int] = {}
    cards = db.query(Card).filter(Card.is_tracked == True, Card.cached_regime.isnot(None)).all()
    for card in cards:
        r = card.cached_regime or "unknown"
        regime_dist[r] = regime_dist.get(r, 0) + 1

    return {
        "total_signals": len(signals),
        "buy_signals": signals[:20],
        "strategy_counts": strategy_counts,
        "market_regime_distribution": regime_dist,
    }
