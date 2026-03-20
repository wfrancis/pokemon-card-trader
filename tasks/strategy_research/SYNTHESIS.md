# Unified Trading Strategy Synthesis

> Compiled from 14 domain expert research documents. This is the direct blueprint for rewriting `prop_strategies.py`.

---

## 1. Unified Signal Framework

### Signal Ranking by Expected Alpha (Net of Fees)

| Rank | Signal | Source Doc | Expected Alpha (Net) | Win Rate | Impl. Complexity | Data Available? |
|------|--------|-----------|---------------------|----------|-------------------|-----------------|
| 1 | **Velocity-Price Divergence** (velocity up, price flat = accumulation) | momentum_catalyst, microstructure, data_signals | +8-11% per trade | 60-70% | Low | YES -- Sale table + PriceHistory |
| 2 | **VWAP Divergence** (market price vs actual sale VWAP) | data_signals, spread_arbitrage | +5-10% per trade | 58-65% | Low | YES -- Sale table |
| 3 | **Mean Reversion (Z-score)** with liquidity-adjusted thresholds | mean_reversion | +5-10% per trade | 58-65% | Medium | YES -- PriceHistory |
| 4 | **Sale Price Acceleration** (consecutive sale prices rising) | data_signals | +5-8% per trade | 55-65% | Low | YES -- Sale table |
| 5 | **OOP Set Appreciation** (out-of-print + velocity + price floor rising) | modern_flip_strategy, microstructure | +5-8% per trade | 55-60% | Medium | PARTIAL -- need set release dates |
| 6 | **Regime + Velocity Combo** (accumulation regime + rising velocity) | microstructure, momentum_catalyst | +4-7% per trade | 55-60% | Low | YES -- existing regime detection |
| 7 | **Set Momentum Breadth** (>60% of cards in set appreciating) | data_signals | +3-5% modifier | N/A (modifier) | Low | YES -- Card.appreciation_slope |
| 8 | **Pokemon Momentum Lag** (sibling cards haven't caught the wave) | data_signals, pokemon_meta | +3-5% per trade | 40-50% | Medium | YES -- similar cards endpoint |
| 9 | **Adaptive EMA Crossover** (4wk/12wk calendar-time EMA) | data_signals | +2-4% per trade | 50-55% | Medium | YES -- PriceHistory dates |
| 10 | **Seasonal Adjustment** (buy Jan/Sep, sell Nov/Dec) | seasonal_patterns | +2-3% modifier | N/A (modifier) | Low | YES -- calendar |
| 11 | **RSI Oversold** (< 30 + BB position) | modern_flip_strategy | +0-3% per trade | 50-55% | Low | YES -- existing |
| 12 | **SMA Golden Cross** (7d/30d crossover) | modern_flip_strategy | -3% to +2% per trade | 48-53% | Low | YES -- existing |
| 13 | **Spread Compression** (tight spread + velocity) | spread_arbitrage, fee_optimization | **-15% to -5% per trade** | 45-50% | Low | YES -- existing |

### Key Finding: Current Signal Priorities Are Inverted

The existing system weights technical indicators (RSI 3x, MACD 2x, SMA 2x) highest and treats velocity/spread as secondary. **This is backwards for Pokemon cards.** The research unanimously concludes:

- **Velocity signals lead price by 1-2 weeks** (momentum_catalyst, microstructure)
- **Sale-based signals are our unique informational edge** -- every participant sees market price, few compute VWAP from individual sales (data_signals)
- **Traditional TA is unreliable on weekly-frequency data** -- SMA crossovers fire 60-80% too late, RSI-14 measures a quarter not 2 weeks (data_signals)
- **Spread compression is mathematically unprofitable** after 13.25% + $4.80 fees (fee_optimization, spread_arbitrage)

---

## 2. Recommended Strategy Configuration

### Constants for `prop_strategies.py`

```python
# -- Core Constants --

MIN_PRICE = 20.0                    # Up from $5 -- cards under $20 need 43%+ to break even
                                     # Ideal: $50 for tracked shipping, $20 minimum for PWE
MIN_LIQUIDITY = 25                   # Up from 20 -- need reliable exit path
MIN_DATA_POINTS = 5                  # Up from 3 -- need minimum viable signal quality
MAX_POSITIONS = 15                   # Down from 20 -- at $10K, 15 positions = ~$667 avg
MAX_SINGLE_POSITION_PCT = 0.08       # Down from 0.10 -- reduce single-card risk
MAX_SET_CONCENTRATION_PCT = 0.25     # Down from 0.30 -- set-level correlation risk
CASH_RESERVE_PCT = 0.25              # Up from 0.20 -- need dry powder for dislocations
MAX_NEW_BUYS_PER_CYCLE = 2           # Down from 3 -- be more selective
DEFAULT_STOP_LOSS_PCT = 0.20         # Up from 0.15 -- 15% is too tight for illiquid cards
                                     # (triggers on normal noise, can't exit instantly anyway)
DEFAULT_TAKE_PROFIT_PCT = 0.40       # Up from 0.30 -- need 25%+ net, so target 40% gross
STALE_POSITION_DAYS = 180            # Up from 90 -- cards need 5+ months to amortize fees
STALE_GAIN_THRESHOLD = 0.10          # Up from 0.05 -- breakeven is ~20%, 5% is a loss

# -- Vintage Overrides (when card.set_id in VINTAGE_SET_IDS) --
VINTAGE_STOP_LOSS_PCT = 0.25         # Wider -- vintage swings 15%+ on low volume
VINTAGE_TAKE_PROFIT_PCT = 0.50       # Bigger targets -- vintage trends last longer
VINTAGE_STALE_POSITION_DAYS = 365    # 1 year -- vintage moves slowly
VINTAGE_STALE_GAIN_THRESHOLD = 0.08

# -- Kelly Criterion --
KELLY_DAMPENER = 0.33                # One-third Kelly -- conservative for illiquid assets
BOOTSTRAP_WIN_RATE = 0.55            # Prior until 20+ trades completed
BOOTSTRAP_AVG_WIN = 0.15
BOOTSTRAP_AVG_LOSS = 0.12
MIN_TRADES_FOR_REAL_KELLY = 20

# -- Drawdown Circuit Breakers --
DRAWDOWN_YELLOW = 0.07               # Reduce position sizes by 50%
DRAWDOWN_ORANGE = 0.10               # Stop all new buys
DRAWDOWN_RED = 0.15                  # Trim top 3 positions by 50%
DRAWDOWN_CRITICAL = 0.20             # Liquidate bottom quartile, pause portfolio
DRAWDOWN_RECOVERY_THRESHOLD = 0.05   # Must recover to <5% before resuming normal ops
```

### Strategies to ENABLE (Rank Order)

| # | Strategy | Status | Rationale |
|---|----------|--------|-----------|
| 1 | **velocity_spike** | NEW -- implement | Highest alpha, exploits our Sale data edge |
| 2 | **accumulation_phase** | NEW -- implement | Velocity up + price flat = classic institutional signal |
| 3 | **mean_reversion_v2** | REPLACE existing | Z-score with liquidity-adjusted thresholds beats flat 20% drop |
| 4 | **vwap_divergence** | NEW -- implement | Market price vs actual sale VWAP divergence |
| 5 | **oop_momentum** | NEW -- implement | Out-of-print set detection + momentum |
| 6 | **momentum_breakout** | KEEP -- enhance | Add velocity confirmation + don't-chase filter |
| 7 | **vintage_value_buy** | NEW -- implement | Vintage-specific parameters and scarcity weighting |

### Strategies to DISABLE

| Strategy | Status | Rationale |
|----------|--------|-----------|
| **spread_compression** | DISABLE | Fee math makes it impossible -- 5-15% gross returns vs 22-30% roundtrip cost |
| **sma_golden_cross** | DISABLE as standalone | Marginal after fees (-3% to +2% net). Demote to confirmation filter only |
| **rsi_oversold_bounce** | DISABLE as standalone | Short hold period rarely clears fees. Demote to confirmation filter for mean reversion |

---

## 3. Composite Buy Score Formula (0-100)

This replaces gut-feel signal strength with a systematic, fee-aware scoring model.

```python
def compute_composite_buy_score(td: dict, signal: dict) -> float:
    """
    Compute 0-100 buy score from all available factors.

    Args:
        td: Technical data dict from get_technical_data()
        signal: Signal dict from strategy check function

    Returns:
        Float 0-100. Buy threshold: >= 65 standard, >= 55 during seasonal buy windows.
    """
    score = 0.0

    # -- Component 1: Velocity Trend (25% weight, max 25 pts) --
    # Most predictive factor per microstructure research
    velocity_30d = td.get("sales_per_day", 0) or 0
    velocity_90d = (td.get("sales_90d", 0) or 0) / 90.0

    if velocity_90d > 0.01:
        accel_ratio = velocity_30d / velocity_90d
        # 100 at 2x acceleration, 50 at stable, 0 at halved
        velocity_raw = max(0, min(100, 50 + (accel_ratio - 1.0) * 50))
    elif velocity_30d > 0:
        velocity_raw = 60  # Has recent sales but no 90d baseline
    else:
        velocity_raw = 0

    score += velocity_raw * 0.25

    # -- Component 2: Fair Value Gap (20% weight, max 20 pts) --
    # How far below fair value is current price?
    # Use median sold as fair value proxy (most reliable anchor)
    spread_pct = td.get("spread_pct")  # (market - median_sold) / median_sold * 100
    if spread_pct is not None:
        # Negative spread = underpriced. -25% = score 100, 0% = score 40, +15% = score 0
        fv_raw = max(0, min(100, 40 + (-spread_pct) * 2.4))
    else:
        fv_raw = 30  # No spread data, neutral

    score += fv_raw * 0.20

    # -- Component 3: Signal Strength (15% weight, max 15 pts) --
    # From the strategy-specific check function
    strength = signal.get("strength", 0.5)
    score += (strength * 100) * 0.15

    # -- Component 4: Set Dynamics (10% weight, max 10 pts) --
    # Is the set going OOP? Is it a desirable set?
    set_score = 50  # Default neutral
    set_age_months = td.get("set_age_months")
    if set_age_months is not None:
        if set_age_months >= 18:
            set_score = 90  # Likely OOP
        elif set_age_months >= 12:
            set_score = 70  # Possibly OOP
        elif set_age_months >= 6:
            set_score = 50  # In print but aging
        elif set_age_months < 3:
            set_score = 20  # Too new, prices settling

    score += set_score * 0.10

    # -- Component 5: Pokemon Popularity (10% weight, max 10 pts) --
    # Blue-chip Pokemon reduce required confidence threshold
    pokemon_score = 30  # Default non-blue-chip
    card_name = td.get("card_name", "")
    if _is_tier1_pokemon(card_name):
        pokemon_score = 95
    elif _is_tier2_pokemon(card_name):
        pokemon_score = 75
    elif _is_tier3_pokemon(card_name):
        pokemon_score = 55

    score += pokemon_score * 0.10

    # -- Component 6: Liquidity Quality (10% weight, max 10 pts) --
    liq = td.get("liquidity_score", 0) or 0
    liq_raw = min(100, liq * 1.25)  # 80 liquidity = 100 score
    score += liq_raw * 0.10

    # -- Component 7: Fee Viability (10% weight, max 10 pts) --
    # Can this trade actually clear fees?
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
        fee_score = 0  # Should already be filtered by MIN_PRICE

    score += fee_score * 0.10

    # -- Modifiers --

    # Seasonal adjustment
    month = date.today().month
    SEASONAL_BUY_BOOST = {1: +8, 2: +3, 9: +5, 10: +2}  # Buy windows
    SEASONAL_BUY_PENALTY = {7: -3, 8: -3, 11: -5, 12: -8}  # Sell windows
    score += SEASONAL_BUY_BOOST.get(month, 0)
    score += SEASONAL_BUY_PENALTY.get(month, 0)

    # Data confidence discount
    data_points = td.get("data_points", 0) or 0
    if data_points < 10:
        score *= 0.7   # Heavy discount for thin data
    elif data_points < 20:
        score *= 0.85  # Moderate discount
    elif data_points < 30:
        score *= 0.95  # Slight discount

    # Regime filter
    regime = td.get("regime")
    if regime == "markdown":
        score *= 0.5  # Halve score in markdown
    elif regime == "distribution":
        score *= 0.7
    elif regime == "accumulation":
        score *= 1.1  # Boost in accumulation

    return round(max(0, min(100, score)), 1)
```

### Decision Thresholds

| Score | Action |
|-------|--------|
| >= 75 | Strong buy -- size up to max position limit |
| 65-74 | Buy -- standard position size |
| 55-64 | Watchlist -- buy only during seasonal buy windows (Jan, Sep) |
| < 55 | Pass -- not enough edge to overcome fees |

### Component Weight Rationale

| Component | Weight | Why This Weight |
|-----------|--------|-----------------|
| Velocity Trend | 25% | Unanimously identified as #1 leading indicator across all research |
| Fair Value Gap | 20% | Spread/VWAP divergence is our unique data edge |
| Signal Strength | 15% | Strategy-specific signal quality matters but shouldn't dominate |
| Set Dynamics | 10% | OOP is a strong catalyst but hard to detect precisely |
| Pokemon Popularity | 10% | Blue-chip Pokemon provide a safety net / demand floor |
| Liquidity Quality | 10% | Non-negotiable for exit -- but it's a filter more than a signal |
| Fee Viability | 10% | Cards must clear the fee wall; this is a pre-filter |

---

## 4. Sell Decision Framework

### Priority-Ordered Exit Rules

Exits are checked in this order every trading cycle. First matching rule triggers.

```python
def check_sell_signals(position, td: dict) -> Optional[dict]:
    """
    Priority-ordered sell signal checks.
    Returns sell signal dict if exit triggered, None otherwise.
    """
    price = td["current_price"]
    entry = position.entry_price
    days_held = (date.today() - position.entry_date).days
    unrealized_pct = (price - entry) / entry if entry > 0 else 0
    velocity = td.get("sales_per_day", 0) or 0
    regime = td.get("regime")
    is_vintage = position.card_set_id in VINTAGE_SET_IDS

    # -- P0: Catastrophic Stop (unconditional) --
    # Hard floor -- structural break protection
    catastrophic_pct = 0.30 if not is_vintage else 0.35
    if price <= entry * (1 - catastrophic_pct):
        return sell_signal("catastrophic_stop", 1.0,
            f"Price dropped {catastrophic_pct:.0%} from entry -- unconditional exit")

    # -- P1: Velocity Dry-Up (can't exit if no buyers) --
    vel_threshold = 0.03 if is_vintage else 0.05
    vel_days = 60 if is_vintage else 30
    if velocity < vel_threshold and days_held > vel_days:
        return sell_signal("liquidity_death", 0.95,
            f"Velocity {velocity:.3f}/day for {days_held}d -- liquidity evaporated")

    # -- P2: Take Profit -- Ratcheting System --
    tp_pct = VINTAGE_TAKE_PROFIT_PCT if is_vintage else DEFAULT_TAKE_PROFIT_PCT
    if unrealized_pct >= tp_pct:
        # Check if velocity still accelerating -- let winners run
        accel = _velocity_acceleration(td)
        if accel > 1.5:
            # Set trailing stop at 8% below peak
            if price < position.highest_price * 0.92:
                return sell_signal("trailing_stop_winner", 0.9,
                    f"Take profit trailing stop: {unrealized_pct:.1%} gain, "
                    f"8% below peak ${position.highest_price:.2f}")
            return None  # Let it run
        else:
            return sell_signal("take_profit", 0.85,
                f"Take profit hit: +{unrealized_pct:.1%} (target: +{tp_pct:.0%})")

    # -- P3: Trailing Stop (for positions up 20%+) --
    if unrealized_pct > 0.20 and position.highest_price > 0:
        trail_pct = 0.08  # 8% from peak
        if price < position.highest_price * (1 - trail_pct):
            return sell_signal("trailing_stop", 0.9,
                f"Trailing stop: dropped {trail_pct:.0%} from peak "
                f"${position.highest_price:.2f}")

    # -- P4: Standard Stop Loss --
    sl_pct = VINTAGE_STOP_LOSS_PCT if is_vintage else DEFAULT_STOP_LOSS_PCT
    # Use SMA-30 trailing stop (10% below declining SMA-30)
    sma_30 = td.get("sma_30")
    if sma_30 and price < sma_30 * 0.90:
        sma_slope = td.get("sma_30_slope", 0)
        if sma_slope is not None and sma_slope < 0:
            return sell_signal("sma_trailing_stop", 0.8,
                f"Price ${price:.2f} is 10%+ below declining SMA-30 ${sma_30:.2f}")
    # Also check flat stop from entry
    if price <= entry * (1 - sl_pct):
        return sell_signal("stop_loss", 0.85,
            f"Stop loss: price dropped {sl_pct:.0%} from entry")

    # -- P5: Regime Breakdown --
    if regime in ("distribution", "markdown"):
        if is_vintage:
            # Vintage: only act if regime persisted 30+ days
            if _regime_duration(td) >= 30 and unrealized_pct > 0:
                return sell_signal("regime_breakdown", 0.7,
                    f"Regime '{regime}' for 30+ days -- taking {unrealized_pct:.1%} gain")
        else:
            if unrealized_pct > 0:
                return sell_signal("regime_breakdown", 0.75,
                    f"Regime shifted to '{regime}' -- taking {unrealized_pct:.1%} gain")

    # -- P6: Velocity Fade (momentum-specific) --
    if position.strategy in ("velocity_spike", "accumulation_phase", "momentum_breakout"):
        if hasattr(position, 'entry_velocity_zscore') and position.entry_velocity_zscore > 2.0:
            current_vz = td.get("velocity_zscore", 0)
            if current_vz < 0.5 and days_held > 7:
                return sell_signal("velocity_fade", 0.8,
                    f"Velocity z-score faded from {position.entry_velocity_zscore:.1f} "
                    f"to {current_vz:.1f}")

    # -- P7: Time Decay (strategy-specific max hold) --
    max_hold = _get_max_hold_days(position.strategy, is_vintage)
    if days_held > max_hold:
        stale_threshold = VINTAGE_STALE_GAIN_THRESHOLD if is_vintage else STALE_GAIN_THRESHOLD
        if unrealized_pct < stale_threshold:
            return sell_signal("stale_position", 0.6,
                f"Held {days_held}d (max: {max_hold}d) with only "
                f"{unrealized_pct:.1%} gain (need {stale_threshold:.0%})")

    # -- P8: Seasonal Sell Window --
    month = date.today().month
    if month in (11, 12) and unrealized_pct > 0.15 and days_held > 30:
        if not is_vintage or unrealized_pct > 0.30:
            return sell_signal("seasonal_sell", 0.6,
                f"Holiday sell window -- locking {unrealized_pct:.1%} gain")

    return None  # Hold


def _get_max_hold_days(strategy: str, is_vintage: bool) -> int:
    """Strategy-specific maximum holding periods."""
    if is_vintage:
        return VINTAGE_STALE_POSITION_DAYS  # 365 days

    STRATEGY_MAX_HOLD = {
        "velocity_spike": 45,        # Quick flip -- velocity events are transient
        "accumulation_phase": 60,    # Moderate hold -- accumulation should resolve
        "mean_reversion_v2": 120,    # Mean reversion needs time but has a half-life
        "vwap_divergence": 60,       # Spread should converge within 2 months
        "oop_momentum": 180,         # OOP appreciation takes months
        "momentum_breakout": 90,     # Trend-following needs time
        "vintage_value_buy": 365,    # Vintage moves slowly
    }
    return STRATEGY_MAX_HOLD.get(strategy, 180)  # Default to STALE_POSITION_DAYS
```

---

## 5. Risk Management Rules

### Position Sizing Formula

```python
def calculate_position_size(
    portfolio_value: float,
    cash: float,
    card_price: float,
    composite_score: float,      # 0-100 from Section 3
    velocity: float,             # sales_per_day
    is_vintage: bool = False,
    drawdown_pct: float = 0.0,   # Current portfolio drawdown
) -> int:
    """
    Position sizing combining Kelly criterion, liquidity limits, and drawdown scaling.

    Returns: number of copies to buy (0 if trade rejected)
    """
    if card_price <= 0 or portfolio_value <= 0:
        return 0

    # Step 1: Kelly-inspired base allocation
    # Convert composite score to conviction (0-1)
    conviction = max(0, (composite_score - 50)) / 50  # 50=0%, 100=100%

    # Kelly fraction with dampener
    kelly = BOOTSTRAP_WIN_RATE * BOOTSTRAP_AVG_WIN - \
            (1 - BOOTSTRAP_WIN_RATE) * BOOTSTRAP_AVG_LOSS
    kelly /= BOOTSTRAP_AVG_WIN
    kelly *= KELLY_DAMPENER  # One-third Kelly
    kelly *= (0.3 + conviction * 0.7)  # Scale by conviction
    kelly = max(0.02, min(0.10, kelly))  # Clamp 2-10%

    base_dollars = portfolio_value * kelly

    # Step 2: Liquidity cap
    # Position size inversely proportional to exit difficulty
    import math as _math
    liq_max_pct = min(0.10, 0.02 + _math.log(velocity + 1) * 0.05)
    liq_max_dollars = portfolio_value * liq_max_pct

    # Step 3: Drawdown scaling
    drawdown_multiplier = 1.0
    if drawdown_pct >= DRAWDOWN_ORANGE:
        return 0  # No new buys
    elif drawdown_pct >= DRAWDOWN_YELLOW:
        drawdown_multiplier = 0.5

    # Step 4: Cash reserve check
    reserve = portfolio_value * CASH_RESERVE_PCT
    available = max(0, cash - reserve)

    # Step 5: Compute final dollar amount
    max_position_pct = 0.15 if is_vintage else MAX_SINGLE_POSITION_PCT
    hard_cap = portfolio_value * max_position_pct

    dollars = min(base_dollars, liq_max_dollars, hard_cap, available)
    dollars *= drawdown_multiplier

    if dollars < card_price:
        return 0

    # Step 6: Convert to quantity with price-tier caps
    qty = int(dollars / card_price)

    if card_price > 200:
        qty = min(qty, 1)
    elif card_price > 100:
        qty = min(qty, 1)
    elif card_price > 50:
        qty = min(qty, 2)
    elif card_price > 20:
        qty = min(qty, 3)
    else:
        qty = min(qty, 4)

    # Vintage: almost always 1 copy
    if is_vintage and card_price > 50:
        qty = min(qty, 1)

    return qty
```

### Concentration Limits

| Dimension | Limit | Enforcement |
|-----------|-------|-------------|
| Max single card | 8% of portfolio | Hard -- reject if violated |
| Max single set | 25% of portfolio | Hard -- reject if violated |
| Max single Pokemon name | 15% of portfolio | Soft -- warn, reject if >20% |
| Max vintage allocation | 40% of portfolio | Soft -- prioritize modern if exceeded |
| Max concurrent positions | 15 | Hard -- reject new buys |
| Min positions (diversification floor) | 8 | Soft -- encourage broader buying |
| Cash reserve | 25% minimum | Hard -- no buys if cash < 25% of portfolio |

### Drawdown Circuit Breakers

| Drawdown | Action | Recovery Condition |
|----------|--------|-------------------|
| 0-7% | Normal operations | N/A |
| 7-10% (Yellow) | Halve new position sizes, max 1 buy/cycle | Drawdown < 5% for 7 days |
| 10-15% (Orange) | Stop ALL new buys, sell only on strong signals (>= 0.7) | Drawdown < 5% + 7 days + 50% win rate on last 5 trades |
| 15-20% (Red) | Trim top 3 positions by 50% | Same as Orange + manual review |
| >20% (Critical) | Liquidate bottom 25% by unrealized P&L, pause portfolio | Manual reactivation only |

---

## 6. New Strategies to Add

### Strategy 1: Velocity Spike (`_check_velocity_spike`)

**Signal rank:** #1. Highest alpha signal. Exploits the 1-2 week lag between velocity increase and price response.

**When it fires:** Sales velocity z-score > 2.0 while price has not yet responded (< 10% change in 7 days).

```python
import statistics
from datetime import datetime, timedelta, timezone, date
from typing import Optional

STRATEGY_VELOCITY_SPIKE = "velocity_spike"

def _check_velocity_spike(td: dict, db=None, card_id=None) -> Optional[dict]:
    """
    BUY: Velocity z-score spike with price confirmation filter.

    The single most profitable signal. When a card's sales velocity jumps 2+ standard
    deviations above its baseline while price hasn't moved, you have 1-2 weeks before
    price catches up. This exploits TCGPlayer's dampened market price algorithm.

    Sources: momentum_catalyst.md, microstructure.md, data_signals.md
    """
    price = td.get("current_price", 0)
    if price < MIN_PRICE:
        return None

    # Compute velocity z-score from weekly sales counts over 13 weeks
    # Requires Sale table access via db session
    if db is None or card_id is None:
        # Fallback: use pre-computed fields if available
        velocity_zscore = td.get("velocity_zscore", 0)
        current_velocity = td.get("sales_per_day", 0)
        baseline_velocity = (td.get("sales_90d", 0) or 0) / 90.0
    else:
        velocity_zscore, current_velocity, baseline_velocity = calc_velocity_zscore(db, card_id)

    if velocity_zscore < 2.0:
        return None

    # Price must NOT have already responded
    price_change_7d = td.get("price_change_7d", 0) or 0
    if price_change_7d > 0.30:
        return None  # Too late -- price already spiked 30%+

    # Minimum velocity floor (need enough sales to be meaningful)
    if current_velocity < 0.3:
        return None  # Less than 2 sales/week -- z-score may be noise

    # Strength: higher z-score + lower price change = stronger signal
    z_factor = min(1.0, velocity_zscore / 4.0)  # Caps at z=4.0
    price_freshness = max(0, 1.0 - price_change_7d / 0.30)  # 1.0 if flat, 0.0 if +30%
    strength = min(1.0, 0.4 + z_factor * 0.4 + price_freshness * 0.2)

    # Estimated price lag before price catches up
    if velocity_zscore > 3.0:
        est_lag_days = 3  # Extreme spike -- price adjusts faster
    else:
        est_lag_days = 7  # Moderate spike -- more time

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_VELOCITY_SPIKE,
        "reasons": [
            f"Velocity z-score: {velocity_zscore:.1f} (threshold: 2.0)",
            f"Current velocity: {current_velocity:.2f}/day vs baseline {baseline_velocity:.2f}/day",
            f"Price change 7d: {price_change_7d:.1%} (not yet priced in)",
            f"Estimated price lag: ~{est_lag_days} days",
        ],
        "entry_price": price,
        "target_price": round(price * 1.25, 2),  # 25% target (quick flip)
        "stop_loss": round(price * 0.88, 2),      # 12% stop (tight -- high conviction)
        "max_hold_days": 45,
    }


def calc_velocity_zscore(db, card_id: int) -> tuple:
    """
    Compute velocity z-score from 13 weeks of weekly sale counts.
    Returns (zscore, current_velocity, baseline_velocity).
    """
    from sqlalchemy import func
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
        weekly_counts.append(count / 7.0)

    current_velocity = weekly_counts[0]
    historical = weekly_counts[1:]

    if len(historical) < 4:
        return 0.0, current_velocity, 0.0

    baseline = statistics.mean(historical)
    stdev = statistics.stdev(historical) if len(historical) > 1 else 0.01
    stdev = max(stdev, 0.01)

    zscore = (current_velocity - baseline) / stdev
    return zscore, current_velocity, baseline
```

---

### Strategy 2: Accumulation Phase (`_check_accumulation_phase`)

**Signal rank:** #2. Detects "smart money" buying before price moves.

**When it fires:** Sales velocity up 80%+ from baseline while price stays flat (< 5% change in 14 days). This is the collectibles equivalent of institutional accumulation in equities.

```python
STRATEGY_ACCUMULATION = "accumulation_phase"

def _check_accumulation_phase(td: dict, db=None, card_id=None) -> Optional[dict]:
    """
    BUY: Velocity-price divergence (accumulation detection).

    When velocity increases 80%+ but price hasn't moved, someone is absorbing supply
    without pushing price up. In thin markets like TCGPlayer, a buyer can purchase
    10-20 copies over 2 weeks without moving the market price because the algorithm
    dampens noise. Once cheap supply is absorbed, price jumps discontinuously.

    Sources: momentum_catalyst.md (Section 3), data_signals.md (Section 3)
    """
    price = td.get("current_price", 0)
    if price < MIN_PRICE:
        return None

    # Velocity ratio: recent (7d) vs baseline (60d)
    velocity_7d = td.get("sales_per_day", 0) or 0
    velocity_90d = (td.get("sales_90d", 0) or 0) / 90.0

    if velocity_90d < 0.05:
        return None  # Less than 1 sale per 20 days -- too sparse for signal

    velocity_ratio = velocity_7d / velocity_90d

    if velocity_ratio < 1.8:
        return None  # Need at least 80% velocity increase

    # Price must be flat (< 5% change in 14 days)
    prices = td.get("prices", [])
    if len(prices) < 5:
        return None

    # Approximate 14-day price change from available data
    price_change_14d = td.get("price_change_14d")
    if price_change_14d is None:
        # Fallback: use available price history
        lookback = min(14, len(prices))
        old_price = prices[-lookback]
        price_change_14d = abs(price - old_price) / old_price if old_price > 0 else 0

    if price_change_14d > 0.05:
        return None  # Price already moving -- not accumulation

    # Strength scales with velocity ratio
    strength = min(1.0, (velocity_ratio - 1.0) / 3.0)
    # Boost if regime is "accumulation" (confirms our detection)
    if td.get("regime") == "accumulation":
        strength = min(1.0, strength + 0.15)

    # Estimate lag: moderate velocity increase = longer lag
    if velocity_ratio > 5.0:
        est_lag = 2
    elif velocity_ratio > 3.0:
        est_lag = 5
    else:
        est_lag = 7

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_ACCUMULATION,
        "reasons": [
            f"Velocity ratio: {velocity_ratio:.1f}x baseline (threshold: 1.8x)",
            f"Price change 14d: {price_change_14d:.1%} (flat -- accumulation pattern)",
            f"Current velocity: {velocity_7d:.2f}/day vs baseline {velocity_90d:.2f}/day",
            f"Regime: {td.get('regime', 'N/A')}",
            f"Expected price response in ~{est_lag} days",
        ],
        "entry_price": price,
        "target_price": round(price * 1.30, 2),  # 30% target
        "stop_loss": round(price * 0.88, 2),      # 12% stop
        "max_hold_days": 60,
    }
```

---

### Strategy 3: Mean Reversion V2 (`_check_mean_reversion_v2`)

**Signal rank:** #3. Z-score entry with liquidity-adjusted thresholds.

**When it fires:** Price z-score below liquidity-adjusted threshold (deeper dislocation required for less liquid cards). Requires ADX < 25 (not in a strong trend) and velocity confirmation.

```python
STRATEGY_MEAN_REVERSION = "mean_reversion_v2"

def _check_mean_reversion_v2(td: dict) -> Optional[dict]:
    """
    BUY: Z-score entry with liquidity-adjusted thresholds.

    Replaces the existing flat "20% drop from 30d high" approach with a
    statistically rigorous z-score method. Key improvements:
    1. Standard deviation normalization: a 20% drop on a 25% vol card is nothing,
       but on a 5% vol card it's 4 sigma.
    2. Liquidity-adjusted thresholds: illiquid cards need deeper dislocations to
       compensate for exit risk.
    3. ADX filter: skip trending cards where the "drop" is just trend continuation.

    Sources: mean_reversion.md (Section 3), data_signals.md
    """
    prices = td.get("prices", [])
    price = td.get("current_price", 0)
    velocity = td.get("sales_per_day", 0) or 0
    adx = td.get("adx")

    if price < MIN_PRICE:
        return None
    if len(prices) < 30:
        return None
    if velocity < 0.1:
        return None  # Too illiquid -- price can stay dislocated indefinitely

    # Skip trending cards (ADX > 25 = strong trend, don't fade it)
    if adx is not None and adx > 25:
        return None

    # Compute z-score with 60-day lookback (or all data if < 60 points)
    lookback = min(60, len(prices))
    window = prices[-lookback:]
    mean_price = sum(window) / len(window)
    variance = sum((p - mean_price) ** 2 for p in window) / (len(window) - 1)
    std = variance ** 0.5

    if std == 0 or mean_price == 0:
        return None

    z = (price - mean_price) / std

    # Liquidity-adjusted threshold (from mean_reversion.md Section 3)
    # High liquidity (>1/day): -1.2 (tight -- price reverts fast)
    # Medium (0.3-1.0): -1.5 (standard)
    # Low (0.1-0.3): -2.0 (need bigger dislocation for illiquidity risk)
    if velocity > 1.0:
        z_threshold = -1.2
    elif velocity > 0.3:
        z_threshold = -1.5
    else:
        z_threshold = -2.0

    if z >= z_threshold:
        return None  # Not enough dislocation

    # Confirmation: velocity must be stable or increasing
    # (if velocity dropped alongside price, card may be genuinely declining)
    velocity_90d = (td.get("sales_90d", 0) or 0) / 90.0
    if velocity_90d > 0 and velocity < velocity_90d * 0.5:
        return None  # Velocity halved -- declining demand, not mean reversion

    # Strength: deeper z-score = stronger signal (capped at z = -3.0)
    z_factor = min(1.0, abs(z) / 3.0)
    velocity_factor = min(1.0, velocity / 1.0)
    strength = min(1.0, 0.3 + z_factor * 0.5 + velocity_factor * 0.2)

    # Target: reversion to mean (z = 0)
    target = mean_price
    # Stop: 1 more standard deviation below current (z drops another 1.0)
    stop = price - std

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_MEAN_REVERSION,
        "reasons": [
            f"Z-score: {z:.2f} (threshold: {z_threshold})",
            f"Price ${price:.2f} vs 60d mean ${mean_price:.2f} (std ${std:.2f})",
            f"Velocity: {velocity:.2f}/day (stable demand confirmed)",
            f"ADX: {adx:.0f}" if adx else "ADX: N/A",
        ],
        "entry_price": price,
        "target_price": round(target, 2),
        "stop_loss": round(max(stop, price * 0.80), 2),
        "max_hold_days": 120,
    }
```

---

### Strategy 4: VWAP Divergence (`_check_vwap_divergence`)

**Signal rank:** #4. Exploits our unique Sale table data.

**When it fires:** Market price diverges significantly from volume-weighted average sale price. This signal is unique to us because most participants only see market price, not actual transaction VWAP.

```python
STRATEGY_VWAP_DIVERGENCE = "vwap_divergence"

def _check_vwap_divergence(td: dict, db=None, card_id=None) -> Optional[dict]:
    """
    BUY: Market price below actual sale VWAP (underpriced vs real transactions).

    Every trader sees TCGPlayer's market price. Few compute VWAP from individual
    sales. When market price < VWAP, the card is selling for more than its listed
    market price suggests -- it's underpriced relative to actual demand.

    Sources: data_signals.md (VWAP section), spread_arbitrage.md
    """
    price = td.get("current_price", 0)
    if price < MIN_PRICE:
        return None

    # Compute VWAP from Sale table (30-day window)
    if db is not None and card_id is not None:
        vwap, sale_count = _compute_vwap(db, card_id, days=30)
    else:
        # Fallback: use spread_pct as proxy (negative spread = underpriced)
        spread_pct = td.get("spread_pct")
        if spread_pct is None:
            return None
        # Convert: spread_pct = (market - median_sold) / median_sold * 100
        # Negative = underpriced
        if spread_pct > -5.0:
            return None  # Not enough divergence
        vwap = price / (1 + spread_pct / 100)
        sale_count = td.get("sales_30d", 0) or 0

    if vwap is None or vwap <= 0:
        return None
    if sale_count < 5:
        return None  # Insufficient sales for reliable VWAP

    # Divergence: how far below VWAP is market price?
    divergence_pct = (price - vwap) / vwap  # Negative = underpriced

    if divergence_pct > -0.05:
        return None  # Need at least 5% divergence

    # Strong buy if divergence > 10%
    # Moderate buy if divergence 5-10%
    div_factor = min(1.0, abs(divergence_pct) / 0.20)  # Caps at 20% divergence
    strength = min(1.0, 0.4 + div_factor * 0.5)

    # Boost if velocity is rising (confirms demand)
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
            f"Market price ${price:.2f} vs VWAP ${vwap:.2f} ({divergence_pct:.1%} divergence)",
            f"Based on {sale_count} sales in last 30 days",
            f"Velocity: {velocity:.2f}/day",
        ],
        "entry_price": price,
        "target_price": round(vwap, 2),  # Target: convergence to VWAP
        "stop_loss": round(price * 0.88, 2),
        "max_hold_days": 60,
    }


def _compute_vwap(db, card_id: int, days: int = 30) -> tuple:
    """
    Compute VWAP from Sale table.
    Returns (vwap, sale_count).
    """
    from sqlalchemy import func
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
```

---

### Strategy 5: OOP Momentum (`_check_oop_momentum`)

**Signal rank:** #5. Detects sets going out of print.

**When it fires:** Set age > 12 months with broad velocity acceleration across the set and rising price floor.

```python
STRATEGY_OOP_MOMENTUM = "oop_momentum"

def _check_oop_momentum(td: dict, db=None) -> Optional[dict]:
    """
    BUY: Out-of-print set detection + momentum.

    When a set stops being printed, supply becomes fixed and key cards appreciate
    20-100% over the next 6-12 months. The challenge is detecting OOP from data
    alone (Pokemon Company doesn't announce print runs). We use three signals:
    1. Set age >= 12 months (print runs typically last 12-18 months)
    2. Broad velocity acceleration (>30% of set cards accelerating)
    3. Price floor rising (median set price up >2% in 30 days)

    Sources: modern_flip_strategy.md (Section 5), microstructure.md
    """
    price = td.get("current_price", 0)
    if price < MIN_PRICE:
        return None

    set_age_months = td.get("set_age_months")
    if set_age_months is None or set_age_months < 9:
        return None  # Too new to be OOP

    velocity = td.get("sales_per_day", 0) or 0
    if velocity < 0.3:
        return None  # Need reasonable liquidity

    regime = td.get("regime")
    if regime == "markdown":
        return None  # Don't buy into markdown even if set is OOP

    # Compute OOP score (from modern_flip_strategy.md)
    pct_cards_accelerating = td.get("set_pct_accelerating", 0)
    median_price_change_30d = td.get("set_median_price_change_30d", 0)

    oop_score = calc_oop_score(set_age_months, pct_cards_accelerating, median_price_change_30d)

    if oop_score < 40:
        return None  # Low confidence set is OOP

    # Card-level confirmation
    accel_ratio = td.get("acceleration_ratio", 1.0) or 1.0
    if accel_ratio < 1.2:
        return None  # This specific card isn't seeing increased demand

    # Strength based on OOP score and card-level signals
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
            f"Set cards accelerating: {pct_cards_accelerating:.0%}",
            f"Set median price change 30d: {median_price_change_30d:.1f}%",
            f"Card acceleration ratio: {accel_ratio:.1f}x",
            f"Regime: {regime}",
        ],
        "entry_price": price,
        "target_price": round(price * 1.35, 2),  # 35% target (OOP appreciation)
        "stop_loss": round(price * 0.85, 2),
        "max_hold_days": 180,
    }


def calc_oop_score(set_age_months: int, pct_cards_accelerating: float,
                   median_price_change_30d: float) -> int:
    """
    Score 0-100 likelihood the set is out of print.
    Source: modern_flip_strategy.md Section 5.
    """
    score = 0

    # Age component (0-40)
    if set_age_months >= 18:
        score += 40
    elif set_age_months >= 12:
        score += 25
    elif set_age_months >= 9:
        score += 10

    # Broad acceleration (0-35)
    if pct_cards_accelerating >= 0.50:
        score += 35
    elif pct_cards_accelerating >= 0.30:
        score += 25
    elif pct_cards_accelerating >= 0.15:
        score += 10

    # Price floor rising (0-25)
    if median_price_change_30d >= 10:
        score += 25
    elif median_price_change_30d >= 5:
        score += 15
    elif median_price_change_30d >= 2:
        score += 5

    return min(100, score)
```

---

### Strategy 6: Momentum Breakout (Enhanced) (`_check_momentum_breakout`)

**Signal rank:** #6. Existing strategy with velocity confirmation and don't-chase filter.

**Key enhancements over current `_check_momentum`:**
1. Requires velocity confirmation (velocity not declining)
2. Don't-chase filter: skip if already up 30%+ from 30d low
3. Pullback entry: prefer buying 5-10% dips within uptrends

```python
STRATEGY_MOMENTUM_BREAKOUT = "momentum_breakout"

def _check_momentum_breakout(td: dict) -> Optional[dict]:
    """
    BUY: Confirmed momentum with velocity confirmation + anti-chase filter.

    Enhanced version of existing momentum check. Key changes:
    - Requires 2 consecutive weeks of price increase + stable velocity
    - Rejects if price already rallied >30% from 30d low (too late)
    - Pullback bonus: stronger signal if buying a 5-10% dip in an uptrend

    Sources: momentum_catalyst.md (Section 5), modern_flip_strategy.md (Rule B4)
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

    # Rule 1: Confirmed momentum (2 consecutive weeks of price increase)
    # Use weekly price samples
    if len(prices) >= 21:
        p_w0 = prices[-1]        # Current
        p_w1 = prices[-7]        # 1 week ago
        p_w2 = prices[-14]       # 2 weeks ago
        if not (p_w0 > p_w1 and p_w1 > p_w2):
            return None  # Not 2 consecutive up weeks
    elif len(prices) >= 14:
        p_w0 = prices[-1]
        p_w1 = prices[-7]
        if not (p_w0 > p_w1):
            return None

    # Rule 2: Don't chase (skip if already up >30% from 30d low)
    lookback_30 = min(30, len(prices))
    low_30d = min(prices[-lookback_30:])
    rally_pct = (price - low_30d) / low_30d if low_30d > 0 else 0
    if rally_pct > 0.30:
        return None  # Too late

    # Rule 3: Velocity confirmation (velocity not declining)
    velocity_90d = (td.get("sales_90d", 0) or 0) / 90.0
    if velocity_90d > 0 and velocity < velocity_90d * 0.8:
        return None  # Velocity declining -- distribution, not momentum

    # Pullback bonus: buying a dip within an uptrend
    high_14d = max(prices[-min(14, len(prices)):])
    pullback_pct = (high_14d - price) / high_14d if high_14d > 0 else 0
    pullback_bonus = 0.0
    if 0.05 <= pullback_pct <= 0.10:
        pullback_bonus = 0.15  # Sweet spot: 5-10% pullback in uptrend

    # Strength
    trend_factor = min(1.0, rally_pct / 0.20)  # Stronger if coming from 10-20% rally
    vel_factor = min(1.0, velocity / 2.0)
    strength = min(1.0, 0.3 + trend_factor * 0.3 + vel_factor * 0.2 + pullback_bonus)

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_MOMENTUM_BREAKOUT,
        "reasons": [
            f"Confirmed uptrend: 2 consecutive up weeks",
            f"Rally from 30d low: {rally_pct:.1%} (below 30% chase threshold)",
            f"Velocity: {velocity:.2f}/day (stable/rising)",
            f"Regime: {regime}",
            f"Pullback from 14d high: {pullback_pct:.1%}" + (" (pullback bonus)" if pullback_bonus > 0 else ""),
        ],
        "entry_price": price,
        "target_price": round(price * 1.30, 2),
        "stop_loss": round(price * 0.85, 2),
        "max_hold_days": 90,
    }
```

---

### Strategy 7: Vintage Value Buy (`_check_vintage_value_buy`)

**Signal rank:** #7. Vintage-specific mean reversion with wider parameters.

**When it fires:** Vintage card drops >15% from 90d high with stable demand. Vintage cards have a collector demand floor that makes mean reversion highly reliable, but with slower recovery (6-12 months).

```python
STRATEGY_VINTAGE_VALUE = "vintage_value_buy"

VINTAGE_SET_IDS = {
    # WotC Era (1999-2003)
    "base1", "base2", "base3", "base4", "base5",
    "jungle", "fossil", "gym1", "gym2",
    "neo1", "neo2", "neo3", "neo4",
    "base6",  # Legendary Collection
    "ecard1", "ecard2", "ecard3",  # Expedition, Aquapolis, Skyridge
    # Early Nintendo/ex-Era (2003-2005)
    "ex1", "ex2", "ex3", "ex4", "ex5", "ex6", "ex7", "ex8",
    "ex9", "ex10", "ex11", "ex12", "ex13", "ex14", "ex15", "ex16",
}

# Vintage-specific rarity filter
VINTAGE_INVESTABLE_RARITIES = {
    "Rare Holo", "Rare Secret", "Rare Holo EX", "Rare Holo Star",
}

def _check_vintage_value_buy(td: dict) -> Optional[dict]:
    """
    BUY: Vintage card dip buy with wider parameters.

    Vintage cards have properties that make mean reversion reliable:
    1. Fixed supply (no reprints affect original value -- reprints actually boost originals)
    2. Collector demand floor (Charizard will never be worth zero)
    3. Condition scarcity (NM vintage is genuinely rare -- 10-15% of raw supply)

    But they also have characteristics that require different parameters:
    - Lower velocity (0.1-2 sales/day vs modern 5-50)
    - Longer recovery periods (6-12 months vs 1-3 months)
    - Wider normal volatility (15%+ swings on low volume)

    Sources: vintage_strategy.md (Section 2), risk_management.md
    """
    price = td.get("current_price", 0)
    set_id = td.get("set_id", "")
    rarity = td.get("rarity", "")

    if set_id not in VINTAGE_SET_IDS:
        return None
    if rarity not in VINTAGE_INVESTABLE_RARITIES:
        return None
    if price < 15.0:  # Lower floor for vintage (vs $20 modern)
        return None

    velocity = td.get("sales_per_day", 0) or 0
    if velocity < 0.05:
        return None  # Less than 1.5 sales/month -- too illiquid even for vintage

    regime = td.get("regime")
    if regime == "markdown":
        return None  # Don't catch falling knives

    # Compute drop from 90-day high (vintage uses longer lookback)
    prices = td.get("prices", [])
    if len(prices) < 15:
        return None

    lookback = min(90, len(prices))
    high_90d = max(prices[-lookback:])
    if high_90d <= 0:
        return None

    drop_pct = (high_90d - price) / high_90d

    if drop_pct < 0.15:
        return None  # Need at least 15% drop for vintage

    # RSI confirmation (optional but helpful)
    rsi = td.get("rsi")
    if rsi is not None and rsi > 45:
        return None  # Not oversold enough

    # Seasonal boost for vintage
    month = date.today().month
    seasonal_boost = 0.0
    if month in (1, 2):
        seasonal_boost = 0.15  # Post-holiday dip = best buy window
    elif month in (8, 9):
        seasonal_boost = 0.10  # Back-to-school dip

    # Strength: deeper drop + seasonal + RSI
    drop_factor = min(0.35, (drop_pct - 0.15) * 2.5)
    rsi_factor = 0.1 if (rsi is not None and rsi < 30) else 0.0
    strength = min(1.0, 0.55 + drop_factor + seasonal_boost + rsi_factor)

    # Vintage-specific targets
    # Target: reversion to 90d SMA (not high -- too aggressive)
    sma_90 = sum(prices[-lookback:]) / lookback
    target = sma_90

    return {
        "card_id": td["card_id"],
        "card_name": td["card_name"],
        "signal": "buy",
        "strength": round(strength, 3),
        "strategy": STRATEGY_VINTAGE_VALUE,
        "reasons": [
            f"Vintage value buy: dropped {drop_pct:.1%} from 90d high ${high_90d:.2f}",
            f"Current price: ${price:.2f}, 90d SMA: ${sma_90:.2f}",
            f"Velocity: {velocity:.2f}/day (demand persists)",
            f"RSI: {rsi:.0f}" if rsi else "RSI: N/A",
            f"Seasonal boost: +{seasonal_boost:.0%}" if seasonal_boost > 0 else "",
        ],
        "entry_price": price,
        "target_price": round(target, 2),
        "stop_loss": round(price * 0.80, 2),  # 20% stop (wider for vintage)
        "max_hold_days": 365,
    }
```

---

### Helper Functions

```python
def _is_tier1_pokemon(name: str) -> bool:
    """Charizard, Pikachu, Mewtwo -- 5.0x demand multiplier."""
    return any(p in name for p in TIER1_POKEMON)

def _is_tier2_pokemon(name: str) -> bool:
    """Mew, Umbreon, Rayquaza, etc. -- 2.5x demand multiplier."""
    return any(p in name for p in TIER2_POKEMON)

def _is_tier3_pokemon(name: str) -> bool:
    """Venusaur, Gyarados, Dragonite, etc. -- 1.5x demand multiplier."""
    return any(p in name for p in TIER3_POKEMON)

def _velocity_acceleration(td: dict) -> float:
    """Velocity acceleration ratio: recent vs baseline velocity."""
    v_30d = td.get("sales_per_day", 0) or 0
    v_90d = (td.get("sales_90d", 0) or 0) / 90.0
    if v_90d < 0.01:
        return 1.0
    return v_30d / v_90d

def _regime_duration(td: dict) -> int:
    """Days the current regime has been active."""
    return td.get("regime_duration_days", 0) or 0

def classify_volume_price(velocity_change_pct: float, price_change_pct: float) -> str:
    """
    Classify into volume-price quadrant.
    Source: momentum_catalyst.md Section 3.
    """
    if velocity_change_pct > 20 and price_change_pct < 5:
        return "ACCUMULATION"
    elif velocity_change_pct > 20 and price_change_pct > 5:
        return "CONFIRMED_MOMENTUM"
    elif velocity_change_pct < -20 and price_change_pct > 5:
        return "DISTRIBUTION"
    elif velocity_change_pct < -20 and price_change_pct < -5:
        return "CAPITULATION"
    else:
        return "NEUTRAL"
```

---

## 7. Implementation Priority

Ordered by impact/complexity ratio. Each item specifies what to change in the codebase.

### Phase 1: Foundation (Highest Impact, Lowest Complexity)

| # | Task | File | Effort | Impact |
|---|------|------|--------|--------|
| 1 | **Update constants** (MIN_PRICE=20, stops, take-profits, stale thresholds per Section 2) | `prop_strategies.py` | 15 min | HIGH -- prevents fee-destructive trades |
| 2 | **Disable spread_compression strategy** | `prop_strategies.py` | 5 min | HIGH -- eliminates mathematically unprofitable trades |
| 3 | **Add velocity acceleration ratio** (`velocity_30d / velocity_90d`) to `get_technical_data()` | `prop_strategies.py` | 30 min | HIGH -- unlocks top signals |
| 4 | **Implement `_check_velocity_spike()`** buy strategy (velocity z-score > 2.0 + price flat) | `prop_strategies.py` | 1 hr | HIGH -- #1 ranked signal |
| 5 | **Implement `_check_accumulation_phase()`** buy strategy (velocity up 80%+ + price flat) | `prop_strategies.py` | 1 hr | HIGH -- #2 ranked signal |
| 6 | **Add drawdown circuit breakers** to `run_trading_cycle()` | `prop_strategies.py` | 1 hr | HIGH -- prevents catastrophic losses |

### Phase 2: Signal Quality (Medium Complexity)

| # | Task | File | Effort | Impact |
|---|------|------|--------|--------|
| 7 | **Replace `_check_mean_reversion()` with z-score version** (liquidity-adjusted thresholds) | `prop_strategies.py` | 2 hr | HIGH -- #3 ranked signal |
| 8 | **Implement `_check_vwap_divergence()`** (market price vs Sale table VWAP) | `prop_strategies.py` | 2 hr | MEDIUM-HIGH -- unique data edge |
| 9 | **Implement composite buy score** (Section 3 formula) replacing simple signal strength | `prop_strategies.py` | 3 hr | HIGH -- systematizes all decisions |
| 10 | **Implement ratcheting take-profit** (sell 50% at target, trail rest) in sell signals | `prop_strategies.py`, `virtual_trader.py` | 2 hr | MEDIUM -- lets winners run |
| 11 | **Add seasonal adjustment** to buy/sell signals (monthly factors from seasonal_patterns) | `prop_strategies.py` | 1 hr | MEDIUM -- +2-3% alpha |

### Phase 3: Advanced Strategies (Higher Complexity)

| # | Task | File | Effort | Impact |
|---|------|------|--------|--------|
| 12 | **Implement OOP detection** (`calc_oop_score()` from set age + velocity breadth) | `prop_strategies.py` | 3 hr | MEDIUM -- reliable but needs set release data |
| 13 | **Implement vintage strategy overrides** (VINTAGE_SET_IDS, wider stops, longer holds) | `prop_strategies.py` | 2 hr | MEDIUM -- vintage is a different game |
| 14 | **Add set momentum breadth** as signal modifier (+/- to composite score) | `prop_strategies.py` | 2 hr | LOW-MEDIUM -- confirmation signal |
| 15 | **Implement adaptive EMA crossover** (calendar-time weighted, 4wk/12wk half-lives) | `market_analysis.py` | 3 hr | MEDIUM -- replaces broken SMA cross |
| 16 | **Add Pokemon momentum lag** (sibling card underperformance detection) | `prop_strategies.py` | 3 hr | LOW -- uncertain hit rate (30-40%) |

### Phase 4: Infrastructure and Validation

| # | Task | File | Effort | Impact |
|---|------|------|--------|--------|
| 17 | **Fix virtual_trader fee model** -- add $4.80 fixed cost, asymmetric slippage | `virtual_trader.py` | 2 hr | HIGH -- accurate P&L |
| 18 | **Add liquidity-based position sizing** to `calculate_position_size()` | `prop_strategies.py` | 1 hr | HIGH -- prevents overexposure |
| 19 | **Fix backtest Sharpe annualization** (sqrt(52) for weekly steps, not sqrt(252)) | `prop_backtest.py` | 30 min | MEDIUM -- correct metrics |
| 20 | **Build walk-forward validation wrapper** | `prop_backtest.py` | 4 hr | HIGH -- prevents overfitting |
| 21 | **Build parameter sensitivity sweep** | `prop_backtest.py` | 3 hr | MEDIUM -- validates robustness |

---

## 8. Backtest Validation Plan

### Strategy-Level Validation

Run each strategy in isolation through the backtest engine, then compare to benchmarks.

#### Required Backtests (Before Going Live)

| Run | Strategies | Purpose |
|-----|-----------|---------|
| A | velocity_spike only | Validate #1 signal in isolation |
| B | accumulation_phase only | Validate #2 signal |
| C | mean_reversion_v2 only | Validate upgraded mean reversion |
| D | vwap_divergence only | Validate VWAP signal |
| E | All enabled strategies combined | Combined portfolio effect |
| F | Current strategies (status quo) | Baseline comparison |

#### Pass/Fail Criteria Per Strategy

| Metric | Must Pass | Nice to Have |
|--------|-----------|-------------|
| CAGR (net of all fees including $4.80) | > 10% | > 20% |
| Sharpe (corrected with sqrt(52)) | > 0.5 | > 1.0 |
| Max Drawdown | < 25% | < 15% |
| Win Rate | > 45% (mean reversion) / > 55% (velocity) | > 55% / > 65% |
| Profit Factor | > 1.2 | > 1.5 |
| Trade Count per backtest | > 30 | > 50 |
| Beats Cash (Benchmark 3) | YES in 4/5 folds | YES in 5/5 folds |
| Parameter stable (+/- 10% perturbation) | Still profitable | CAGR varies < 20% |

#### Walk-Forward Protocol

```
Fold 1: Train 2024-01 to 2024-06, Test 2024-07 to 2024-09
Fold 2: Train 2024-04 to 2024-09, Test 2024-10 to 2024-12
Fold 3: Train 2024-07 to 2024-12, Test 2025-01 to 2025-03
Fold 4: Train 2024-10 to 2025-03, Test 2025-04 to 2025-06
Fold 5: Train 2025-01 to 2025-06, Test 2025-07 to 2025-09
Holdout: 2025-10 to 2026-03 (NEVER optimize on this)
```

- Report average out-of-sample CAGR across folds
- If holdout CAGR < 50% of walk-forward average: strategy is overfit
- If any fold produces > -15% loss: flag strategy as unstable

#### Parameter Sensitivity Sweep

For each key parameter, test at -25%, -10%, current, +10%, +25%:

| Parameter | Current | Sweep Range |
|-----------|---------|-------------|
| MIN_PRICE | $20 | $15 -- $25 |
| Velocity z-score buy threshold | 2.0 | 1.5 -- 2.5 |
| Mean reversion z-score threshold | -1.5 | -1.1 -- -1.9 |
| Stop loss % | 20% | 15% -- 25% |
| Take profit % | 40% | 30% -- 50% |
| Stale position days | 180 | 135 -- 225 |
| Cash reserve % | 25% | 19% -- 31% |

**Pass criterion:** Strategy remains profitable (> 0% CAGR net) across ALL perturbation levels. If any 10% perturbation flips profitability, that parameter is overfit.

#### Benchmarks to Beat

| Benchmark | Construction | Purpose |
|-----------|-------------|---------|
| Cash ($10K at 0%) | Hold cash | Minimum bar -- must beat this |
| Top-20 Buy and Hold | Buy equal $ of 20 most liquid cards, hold entire period | Does active trading add value? |
| Fee-Adjusted Breakeven | Minimum return to cover all fees on actual trades executed | True hurdle rate |

#### Red Flags (Stop Iterating)

1. In-sample CAGR 40%+ but out-of-sample < 5% = OVERFIT
2. Removing top 3 trades flips strategy from profitable to unprofitable = CONCENTRATED LUCK
3. Any 10% parameter change eliminates profitability = FRAGILE
4. Trade count < 30 in any fold = INSUFFICIENT DATA
5. CAGR > 50% net of realistic fees = ALMOST CERTAINLY WRONG (check fee model)

#### When to Stop

- **Validated:** Walk-forward avg CAGR > 15% net, holdout > 10%, Sharpe > 0.7, parameter-stable. Proceed to paper trading.
- **Rejected:** Walk-forward avg CAGR < 5% net OR holdout negative OR fails parameter stability. Go back to strategy design.
- **Insufficient data:** < 30 trades per fold. Wait for more data.

---

## Appendix A: Seasonal Factors

```python
SEASONAL_FACTORS = {
    1:  0.90,   # January -- post-holiday dip (BEST BUY WINDOW)
    2:  0.94,   # February -- recovering, Pokemon Day hype
    3:  0.97,   # March -- spring set release
    4:  0.99,   # April -- stabilization
    5:  1.01,   # May -- summer collecting begins
    6:  1.03,   # June -- conventions
    7:  1.08,   # July -- pre-Worlds hype
    8:  1.10,   # August -- World Championships (SELL competitive cards)
    9:  0.95,   # September -- back-to-school dip (2ND BUY WINDOW)
    10: 0.98,   # October -- pre-holiday positioning
    11: 1.07,   # November -- holiday buying surge (SELL)
    12: 1.15,   # December -- peak prices (SELL before Dec 18)
}
```

## Appendix B: Pokemon Popularity Tiers

```python
TIER1_POKEMON = {"Charizard", "Pikachu", "Mewtwo"}               # 5.0x demand multiplier
TIER2_POKEMON = {"Mew", "Umbreon", "Rayquaza", "Gengar", "Eevee",
                 "Lugia", "Blastoise"}                             # 2.5x
TIER3_POKEMON = {"Venusaur", "Gyarados", "Dragonite", "Celebi",
                 "Gardevoir", "Tyranitar", "Alakazam", "Arcanine",
                 "Suicune", "Mimikyu", "Snorlax", "Garchomp",
                 "Giratina", "Arceus", "Sylveon", "Espeon"}        # 1.5x
```

## Appendix C: Fee Breakeven Reference

| Buy Price | Breakeven Appreciation (Tracked $4.50) | Fee % of Sale |
|-----------|---------------------------------------|---------------|
| $20 | 43.0% | 37.3% |
| $30 | 33.7% | 29.3% |
| $50 | 26.4% | 22.9% |
| $75 | 22.7% | 19.7% |
| $100 | 20.8% | 18.1% |
| $200 | 18.1% | 15.7% |
| $500 | 16.4% | 14.2% |

**Formula:** `breakeven_sell = (buy_price + 4.80) / 0.8675`

**Critical insight:** The $4.80 fixed cost ($0.30 processing + $4.50 shipping) creates a nonlinear fee curve. Below $50, fees are devastating. Above $100, they converge toward the 13.25% asymptote. This is why MIN_PRICE must be at least $20, ideally $50 for the prop system.

## Appendix D: Hurst Exponent (Mean Reversion Classifier)

```python
import numpy as np

def hurst_exponent(prices: list[float], max_lag: int = 20) -> float | None:
    """
    Compute Hurst exponent using rescaled range (R/S) method.
    H < 0.4: Strong mean reversion candidate
    H = 0.5: Random walk
    H > 0.6: Trending -- use momentum strategies instead

    Source: mean_reversion.md Section 2
    """
    if len(prices) < 30:
        return None

    ts = np.array(prices)
    lags = range(2, min(max_lag + 1, len(ts) // 2))

    if len(list(lags)) < 3:
        return None

    rs_values = []
    lag_values = []

    for lag in lags:
        chunks = [ts[i:i + lag] for i in range(0, len(ts) - lag + 1, lag)]
        rs_chunk = []

        for chunk in chunks:
            if len(chunk) < 2:
                continue
            mean_c = np.mean(chunk)
            deviations = chunk - mean_c
            cumulative = np.cumsum(deviations)
            R = np.max(cumulative) - np.min(cumulative)
            S = np.std(chunk, ddof=1)
            if S > 0:
                rs_chunk.append(R / S)

        if rs_chunk:
            rs_values.append(np.mean(rs_chunk))
            lag_values.append(lag)

    if len(rs_values) < 3:
        return None

    log_lags = np.log(lag_values)
    log_rs = np.log(rs_values)

    n = len(log_lags)
    mean_x = np.mean(log_lags)
    mean_y = np.mean(log_rs)
    cov_xy = np.sum((log_lags - mean_x) * (log_rs - mean_y)) / n
    var_x = np.sum((log_lags - mean_x) ** 2) / n

    if var_x == 0:
        return None

    H = cov_xy / var_x
    return max(0.0, min(1.0, H))
```

### Classification Decision Tree

```
Card Classification:
  1. Compute Hurst exponent on 52-week rolling window
  2. Compute OU half-life (already in market_analysis.py)
  3. Compute ADX (already in market_analysis.py)

  IF Hurst < 0.4 AND half_life < 60 AND ADX < 25:
      -> STRONG MEAN REVERSION candidate (use mean_reversion_v2)
  ELIF Hurst < 0.5 AND half_life < 90:
      -> MODERATE MEAN REVERSION candidate (widen thresholds)
  ELIF Hurst > 0.6 AND ADX > 25:
      -> TREND FOLLOWING candidate (use momentum_breakout)
  ELSE:
      -> MIXED/UNCLEAR -- reduce position size or skip
```
