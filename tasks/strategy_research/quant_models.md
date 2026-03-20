# Quantitative Models for Pokemon Card Trading

## Reference Architecture

This document maps directly to the existing codebase:
- **Price data**: `PriceHistory` (daily `market_price`, `low_price`, `mid_price`, `high_price` per card/variant/condition)
- **Sales data**: `Sale` (individual completed sales with `purchase_price`, `order_date`, `condition`, `variant`)
- **Card metadata**: `Card` (`name`, `set_name`, `set_id`, `rarity`, `price_variant`, `current_price`, cached metrics)
- **Existing technicals**: SMA(7/30/90/200), EMA(12/26/50), RSI(14), MACD, Bollinger Bands(20,2), ADX, regime detection, half-life
- **Existing screener**: liquidity score, appreciation slope/R-squared/win-rate, rarity scores, blue-chip tiers, investment score
- **Fee model**: TCGPlayer 10.75% commission + 2.5% + $0.30 processing + $4.50 shipping; breakeven ~18-20% for $20-50 cards

All formulas below are designed to run in pure Python with no external API calls -- only historical data from the database.

---

## 1. Fair Value Models for Collectibles

### 1.1 Comparable Sales Approach (Primary Model)

The most defensible valuation for an illiquid collectible is the weighted median of recent comparable sales, adjusted for condition and time decay.

```python
def fair_value_comparable(sales: list[Sale], current_date: date, card_price: float) -> dict:
    """
    Compute fair value from comparable sales with time-weighted median.

    Parameters:
        sales: Completed sales for this card (last 90 days)
        current_date: Reference date
        card_price: Current listed market price

    Returns:
        fair_value, confidence, spread_to_market_pct
    """
    if not sales:
        return {"fair_value": card_price, "confidence": 0.0, "method": "market_price_fallback"}

    # Time-decay weights: recent sales matter more
    # w_i = exp(-lambda * days_ago), lambda = 0.03 (half-life ~23 days)
    LAMBDA = 0.03
    weighted_prices = []
    weights = []

    for sale in sales:
        days_ago = (current_date - sale.order_date.date()).days
        weight = math.exp(-LAMBDA * days_ago)
        weighted_prices.append((sale.purchase_price, weight))
        weights.append(weight)

    # Weighted median: sort by price, find cumulative weight = 50%
    weighted_prices.sort(key=lambda x: x[0])
    total_weight = sum(weights)
    cumulative = 0.0
    fair_value = weighted_prices[len(weighted_prices) // 2][0]  # fallback

    for price, weight in weighted_prices:
        cumulative += weight
        if cumulative >= total_weight / 2:
            fair_value = price
            break

    # Confidence: f(sample_size, recency)
    # confidence = 1 - exp(-0.1 * n_sales) scaled by recency
    n = len(sales)
    recency_factor = max(weights) if weights else 0  # most recent sale's weight
    confidence = (1 - math.exp(-0.1 * n)) * recency_factor
    confidence = min(1.0, max(0.0, confidence))

    spread_to_market = ((card_price - fair_value) / fair_value * 100) if fair_value > 0 else 0

    return {
        "fair_value": round(fair_value, 2),
        "confidence": round(confidence, 3),
        "spread_to_market_pct": round(spread_to_market, 1),
        "n_sales": n,
        "method": "time_weighted_median",
    }
```

**Thresholds:**
- `confidence >= 0.6` = actionable fair value (requires ~10 sales in 90 days with some recent)
- `spread_to_market_pct > 15` = overvalued (listed price above fair value)
- `spread_to_market_pct < -10` = undervalued (potential buy)

### 1.2 Intrinsic Value via Rarity-Adjusted Floor Model

For cards without sufficient sales data, estimate intrinsic value from structural characteristics.

```python
def intrinsic_value_rarity(
    rarity_score: int,          # 0-100 from RARITY_SCORES
    set_age_years: float,       # years since set release
    is_blue_chip: bool,         # Charizard, Pikachu, etc.
    blue_chip_tier: int,        # 1, 2, 3, or 0
    print_run_proxy: float,     # 1/rarity_score as supply proxy
    current_price: float,
) -> dict:
    """
    Structural intrinsic value based on scarcity + demand fundamentals.

    Model: V = BaseFloor * RarityMultiplier * AgeAppreciation * DemandPremium

    This is NOT a price prediction -- it's a "what should this card be worth
    given its characteristics" anchor for identifying mispricing.
    """
    # Base floor: $2 for any tracked card (minimum viable market)
    base_floor = 2.0

    # Rarity multiplier: exponential scaling
    # rarity_score 20 (Rare) -> 1.5x, 60 (Ultra Rare) -> 8x, 90 (Hyper Rare) -> 50x
    rarity_mult = math.exp(0.04 * rarity_score)

    # Age appreciation: older sets appreciate logarithmically
    # First 2 years: depreciation (post-hype crash), then appreciation
    if set_age_years < 2:
        age_mult = 0.7 + 0.15 * set_age_years  # 0.7 -> 1.0
    else:
        age_mult = 1.0 + 0.3 * math.log(set_age_years)  # log growth

    # Demand premium for blue-chip Pokemon
    demand_premium = {0: 1.0, 3: 1.3, 2: 1.8, 1: 2.5}[blue_chip_tier]

    intrinsic = base_floor * rarity_mult * age_mult * demand_premium

    # Ratio: how far is market price from intrinsic?
    price_to_intrinsic = current_price / intrinsic if intrinsic > 0 else 999

    return {
        "intrinsic_value": round(intrinsic, 2),
        "price_to_intrinsic_ratio": round(price_to_intrinsic, 2),
        "components": {
            "base_floor": base_floor,
            "rarity_multiplier": round(rarity_mult, 2),
            "age_multiplier": round(age_mult, 2),
            "demand_premium": demand_premium,
        },
    }
```

**Thresholds:**
- `price_to_intrinsic < 0.5` = deeply undervalued (market price far below structural value)
- `price_to_intrinsic > 3.0` = speculative premium (price driven by hype, not fundamentals)
- Most useful for cards with `confidence < 0.4` from the comparable sales model

---

## 2. Statistical Arbitrage Approaches

### 2.1 Cross-Variant Arbitrage

The same card often has different prices across variants (normal, holofoil, reverseHolofoil). When the spread diverges beyond historical norms, there is a convergence trade.

```python
def cross_variant_arb(
    card_id: int,
    variant_prices: dict[str, float],   # {"holofoil": 45.0, "reverseHolofoil": 38.0}
    historical_spread: dict[str, list],  # 90-day spread history
) -> dict | None:
    """
    Identify cross-variant mispricings.

    Signal: when spread between two variants exceeds 2 standard deviations
    from historical mean, bet on convergence.
    """
    variants = list(variant_prices.keys())
    if len(variants) < 2:
        return None

    v1, v2 = variants[0], variants[1]
    current_spread = variant_prices[v1] - variant_prices[v2]

    history = historical_spread.get(f"{v1}_vs_{v2}", [])
    if len(history) < 30:
        return None

    mean_spread = sum(history) / len(history)
    std_spread = math.sqrt(sum((s - mean_spread)**2 for s in history) / len(history))

    if std_spread == 0:
        return None

    z_score = (current_spread - mean_spread) / std_spread

    if abs(z_score) < 2.0:
        return None  # Within normal range

    return {
        "signal": "SELL_V1_BUY_V2" if z_score > 2.0 else "BUY_V1_SELL_V2",
        "z_score": round(z_score, 2),
        "current_spread": round(current_spread, 2),
        "mean_spread": round(mean_spread, 2),
        "std_spread": round(std_spread, 2),
        "expected_convergence_pct": round(abs(current_spread - mean_spread) / max(variant_prices.values()) * 100, 1),
    }
```

### 2.2 Cross-Set Pairs Trading

Cards of the same Pokemon across different sets should maintain rough relative pricing. When ratios diverge, trade the convergence.

```python
def cross_set_pair_signal(
    card_a_prices: list[float],  # Same Pokemon, set A (e.g., Charizard from Vivid Voltage)
    card_b_prices: list[float],  # Same Pokemon, set B (e.g., Charizard from Brilliant Stars)
    lookback: int = 60,
) -> dict | None:
    """
    Pairs trading signal for same-Pokemon cards across sets.

    Uses log-price ratio mean reversion.
    """
    if len(card_a_prices) < lookback or len(card_b_prices) < lookback:
        return None

    a = card_a_prices[-lookback:]
    b = card_b_prices[-lookback:]

    # Log price ratio
    ratios = [math.log(a[i] / b[i]) for i in range(lookback) if a[i] > 0 and b[i] > 0]

    if len(ratios) < 30:
        return None

    mean_ratio = sum(ratios) / len(ratios)
    std_ratio = math.sqrt(sum((r - mean_ratio)**2 for r in ratios) / len(ratios))

    if std_ratio == 0:
        return None

    current_ratio = ratios[-1]
    z_score = (current_ratio - mean_ratio) / std_ratio

    # Half-life of mean reversion for the ratio
    deltas = [ratios[i] - ratios[i-1] for i in range(1, len(ratios))]
    lagged = ratios[:-1]
    mean_x = sum(lagged) / len(lagged)
    mean_y = sum(deltas) / len(deltas)
    cov = sum((lagged[i] - mean_x) * (deltas[i] - mean_y) for i in range(len(deltas))) / len(deltas)
    var = sum((x - mean_x)**2 for x in lagged) / len(lagged)

    if var == 0:
        return None

    lam = cov / var
    half_life = -math.log(2) / lam if lam < 0 else None

    if abs(z_score) < 1.5:
        return None

    return {
        "z_score": round(z_score, 2),
        "signal": "LONG_A_SHORT_B" if z_score < -1.5 else "SHORT_A_LONG_B",
        "half_life_days": round(half_life, 1) if half_life else None,
        "mean_reversion_expected": half_life is not None and half_life < 60,
    }
```

### 2.3 Market vs. Median Sale Price Arbitrage (Implemented in Screener)

Already partially implemented via `spread_pct` in the investment screener. Formalize the signal:

```
IF market_price > fair_value * 1.15 AND liquidity_score > 40:
    Signal = SELL (market is overpricing relative to actual transactions)

IF market_price < fair_value * 0.90 AND liquidity_score > 30:
    Signal = BUY (market is underpricing relative to actual transactions)
```

**Key constraint**: Only actionable when `liquidity_score >= 30` (enough sales volume to trust the fair value estimate).

---

## 3. Factor Models

### 3.1 Card Return Factor Decomposition

Card returns can be decomposed into systematic factors. This is analogous to Fama-French but for collectibles.

**Proposed 6-Factor Model:**

```
R_i = alpha_i + beta_1*F_rarity + beta_2*F_pokemon + beta_3*F_age + beta_4*F_liquidity + beta_5*F_set_momentum + beta_6*F_condition_scarcity + epsilon_i
```

| Factor | Definition | Data Source | Expected Sign |
|--------|-----------|-------------|---------------|
| `F_rarity` | Rarity tier return premium | `RARITY_SCORES` mapping | + (higher rarity = higher returns) |
| `F_pokemon` | Blue-chip Pokemon demand premium | `BLUE_CHIP_TIER1/2/3` | + (iconic Pokemon outperform) |
| `F_age` | Set vintage factor (years since release) | `card_set.release_date` | + after year 2, - in year 0-2 |
| `F_liquidity` | Liquidity premium/discount | `liquidity_score`, `sales_per_day` | - (illiquid cards require higher returns) |
| `F_set_momentum` | Set-level relative strength | `get_set_relative_strength()` | + (hot sets lift all cards) |
| `F_condition_scarcity` | Near Mint scarcity for older sets | NM sales / total sales ratio | + (scarcer NM = higher premium) |

### 3.2 Factor Computation

```python
def compute_card_factors(card: Card, sales: list[Sale], set_rs: float, set_age_years: float) -> dict:
    """
    Compute factor exposures for a single card.
    All factors normalized to z-scores across the universe.
    """
    # F_rarity: log-transform rarity score (diminishing returns at top)
    rarity_raw = RARITY_SCORES.get(card.rarity, 10)
    f_rarity = math.log(max(1, rarity_raw))  # Range: 0 to ~4.5

    # F_pokemon: tiered demand score
    name_words = (card.name or "").split()
    bc_bonus = max((_blue_chip_bonus(w) for w in name_words), default=0)
    f_pokemon = bc_bonus / 20.0  # Normalize to 0-1

    # F_age: piecewise function
    if set_age_years < 2:
        f_age = -1.0 + 0.5 * set_age_years  # Negative in first 2 years
    else:
        f_age = math.log(set_age_years) * 0.5  # Log growth after

    # F_liquidity: sigmoid-normalized liquidity score
    liq = card.liquidity_score or 0
    f_liquidity = 1.0 / (1.0 + math.exp(-0.1 * (liq - 30)))  # 0-1, centered at 30

    # F_set_momentum: set relative strength (already computed)
    f_set_momentum = set_rs if set_rs else 1.0

    # F_condition_scarcity: ratio of NM sales to total sales
    nm_sales = sum(1 for s in sales if s.condition and "Near Mint" in s.condition)
    total_sales = len(sales) if sales else 1
    f_condition_scarcity = 1.0 - (nm_sales / total_sales)  # Higher = scarcer NM

    return {
        "f_rarity": round(f_rarity, 3),
        "f_pokemon": round(f_pokemon, 3),
        "f_age": round(f_age, 3),
        "f_liquidity": round(f_liquidity, 3),
        "f_set_momentum": round(f_set_momentum, 3),
        "f_condition_scarcity": round(f_condition_scarcity, 3),
    }
```

### 3.3 Factor-Based Expected Return

```python
def expected_return_from_factors(factors: dict, factor_premiums: dict) -> float:
    """
    Compute expected annualized return from factor exposures.

    factor_premiums are estimated via cross-sectional regression across all cards
    (run monthly as a batch job).

    Default premiums (initial estimates, to be calibrated):
        f_rarity: 5% per unit (higher rarity -> higher return)
        f_pokemon: 8% per unit (blue-chip premium)
        f_age: 3% per unit (vintage premium after initial depreciation)
        f_liquidity: -2% per unit (liquid cards have lower expected return)
        f_set_momentum: 4% per unit (momentum effect)
        f_condition_scarcity: 6% per unit (NM scarcity premium)
    """
    DEFAULT_PREMIUMS = {
        "f_rarity": 5.0,
        "f_pokemon": 8.0,
        "f_age": 3.0,
        "f_liquidity": -2.0,
        "f_set_momentum": 4.0,
        "f_condition_scarcity": 6.0,
    }
    premiums = factor_premiums or DEFAULT_PREMIUMS

    expected_return = sum(
        factors.get(f, 0) * premiums.get(f, 0)
        for f in premiums
    )

    return round(expected_return, 2)
```

### 3.4 Cross-Sectional Regression for Factor Premium Estimation

Run monthly across the full card universe to estimate actual factor premiums:

```python
def estimate_factor_premiums(
    card_returns: list[float],      # 30-day returns for each card
    factor_matrix: list[dict],      # Factor exposures for each card (same order)
) -> dict:
    """
    Fama-MacBeth style cross-sectional regression.

    For each period, regress card returns on factor exposures:
        R_i = alpha + sum(beta_k * F_k_i) + epsilon_i

    Uses simple multivariate OLS (no external libraries).
    """
    n = len(card_returns)
    if n < 20:
        return {}

    factor_names = list(factor_matrix[0].keys())
    k = len(factor_names)

    # Build X matrix [1, f1, f2, ..., fk] and Y vector
    # OLS: beta = (X'X)^(-1) X'Y
    # For simplicity, use iterative approach (k is small, ~6 factors)

    # ... standard OLS implementation ...
    # Returns dict of {factor_name: estimated_premium}
```

---

## 4. Regression-Based Price Prediction

### 4.1 Log-Price Linear Regression (Already Implemented)

The existing `calc_steady_appreciation()` in `investment_screener.py` does this correctly. Key outputs:
- `slope_pct_per_day`: Daily continuous return rate
- `r_squared`: Trend consistency (higher = more predictable)

**Enhancement: Add prediction intervals.**

```python
def price_prediction_with_interval(
    prices: list[float],
    dates: list[date],
    forecast_days: int = 30,
    confidence_level: float = 0.95,
) -> dict:
    """
    Log-price linear regression with prediction intervals.

    Uses the existing regression from calc_steady_appreciation() but adds:
    - Point forecast at T+forecast_days
    - Upper/lower prediction bounds
    - Probability of exceeding breakeven threshold
    """
    if len(prices) < 30:
        return {"forecast": None, "confidence": 0}

    # Log-price regression (same as calc_steady_appreciation)
    log_prices = [math.log(p) for p in prices if p > 0]
    n = len(log_prices)
    x = list(range(n))

    sum_x = sum(x)
    sum_y = sum(log_prices)
    sum_xy = sum(xi * yi for xi, yi in zip(x, log_prices))
    sum_x2 = sum(xi * xi for xi in x)
    denom = n * sum_x2 - sum_x * sum_x

    if denom == 0:
        return {"forecast": None, "confidence": 0}

    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    # R-squared
    y_mean = sum_y / n
    ss_tot = sum((yi - y_mean) ** 2 for yi in log_prices)
    ss_res = sum((yi - (slope * xi + intercept)) ** 2 for xi, yi in zip(x, log_prices))
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0

    # Residual standard error
    s_e = math.sqrt(ss_res / (n - 2)) if n > 2 else 0

    # Forecast at T + forecast_days
    x_forecast = n - 1 + forecast_days
    log_forecast = slope * x_forecast + intercept
    point_forecast = math.exp(log_forecast)

    # Prediction interval: log_forecast +/- t * s_e * sqrt(1 + 1/n + (x_f - x_bar)^2 / SS_x)
    # For large n, t ~ 1.96 (95%) or 1.645 (90%)
    t_value = 1.96 if confidence_level >= 0.95 else 1.645
    x_bar = sum_x / n
    ss_x = sum_x2 - sum_x * sum_x / n

    if ss_x > 0:
        prediction_se = s_e * math.sqrt(1 + 1/n + (x_forecast - x_bar)**2 / ss_x)
    else:
        prediction_se = s_e

    log_upper = log_forecast + t_value * prediction_se
    log_lower = log_forecast - t_value * prediction_se

    return {
        "forecast_price": round(point_forecast, 2),
        "upper_bound": round(math.exp(log_upper), 2),
        "lower_bound": round(math.exp(log_lower), 2),
        "forecast_days": forecast_days,
        "slope_pct_per_day": round((math.exp(slope) - 1) * 100, 4),
        "r_squared": round(max(0, min(1, r_squared)), 4),
        "residual_std_error": round(s_e, 4),
        "confidence_level": confidence_level,
        # Actionable: probability that price exceeds breakeven
        "forecast_return_pct": round((point_forecast / prices[-1] - 1) * 100, 1),
    }
```

**Decision thresholds:**
- `r_squared >= 0.5` AND `slope > 0` = strong directional trend, trust the forecast
- `r_squared >= 0.3` AND `slope > 0` = moderate trend, use wider intervals
- `r_squared < 0.3` = no reliable trend, do not use regression for prediction

### 4.2 Regime-Conditional Regression

Different regression parameters for different regimes (already detected by `_detect_regime()`):

```python
REGIME_REGRESSION_PARAMS = {
    "accumulation": {
        "lookback_days": 90,       # Longer window for range-bound
        "min_r_squared": 0.2,      # Lower threshold (flat trends have low R^2)
        "strategy": "mean_reversion",
        "expected_holding_period": 60,
    },
    "markup": {
        "lookback_days": 30,       # Shorter window to capture momentum
        "min_r_squared": 0.4,
        "strategy": "trend_following",
        "expected_holding_period": 30,
    },
    "distribution": {
        "lookback_days": 60,
        "min_r_squared": 0.3,
        "strategy": "take_profit",
        "expected_holding_period": 14,  # Short: get out before markdown
    },
    "markdown": {
        "lookback_days": 30,
        "min_r_squared": 0.3,
        "strategy": "avoid",
        "expected_holding_period": 0,   # Don't hold
    },
}
```

---

## 5. Optimal Holding Period Analysis

### 5.1 Fee-Adjusted Optimal Hold

The minimum holding period is determined by the breakeven appreciation (already computed via `calc_breakeven_appreciation()`). The optimal holding period balances:
1. **Fee drag**: Shorter holds = higher fee % per annualized return
2. **Opportunity cost**: Longer holds = capital locked up
3. **Mean reversion risk**: Most collectibles revert after spikes

```python
def optimal_hold_period(
    card_price: float,
    appreciation_slope: float,      # %/day from regression
    r_squared: float,               # Trend consistency
    half_life: float | None,        # Mean-reversion half-life
    regime: str,
    volatility: float,              # Daily volatility %
    liquidity_score: int,
    platform: str = "tcgplayer",
) -> dict:
    """
    Compute optimal holding period considering fees, trend strength, and regime.

    Returns recommended hold period in days with confidence.
    """
    breakeven_pct = calc_breakeven_appreciation(card_price, platform)

    # Minimum hold: days to reach breakeven at current appreciation rate
    if appreciation_slope > 0:
        # continuous_rate = ln(1 + slope/100)
        continuous_daily = math.log(1 + appreciation_slope / 100)
        if continuous_daily > 0:
            min_hold_days = math.log(1 + breakeven_pct / 100) / continuous_daily
        else:
            min_hold_days = 999
    else:
        min_hold_days = 999  # Not appreciating -> don't hold

    # Cap by mean-reversion half-life (don't hold past expected reversal)
    if half_life and half_life > 0:
        max_hold_days = half_life * 2.0  # Hold up to 2 half-lives
    else:
        max_hold_days = 365  # Default cap

    # Regime adjustment
    regime_multiplier = {
        "accumulation": 1.0,
        "markup": 0.7,       # Trends end faster than expected -> shorter hold
        "distribution": 0.3,  # Getting out phase -> very short hold
        "markdown": 0.0,      # Don't hold
        "unknown": 0.8,
    }.get(regime, 0.8)

    # Liquidity adjustment: illiquid cards need longer to sell
    # Add estimated time-to-sell to the hold period
    if liquidity_score < 20:
        liquidity_add_days = 30
    elif liquidity_score < 40:
        liquidity_add_days = 14
    elif liquidity_score < 60:
        liquidity_add_days = 7
    else:
        liquidity_add_days = 2

    # Optimal = max(minimum_to_breakeven, regime-adjusted)
    raw_optimal = min_hold_days * (1.0 + (1.0 - r_squared))  # Lower R^2 -> longer hold needed
    adjusted_optimal = raw_optimal * regime_multiplier + liquidity_add_days

    # Clamp
    optimal_days = max(7, min(max_hold_days, adjusted_optimal))

    # Confidence in the estimate
    confidence = r_squared * min(1.0, liquidity_score / 50)

    # Risk-reward: expected return at optimal hold vs. max drawdown risk
    expected_return_at_hold = appreciation_slope * optimal_days
    risk_at_hold = volatility * math.sqrt(optimal_days) * 2  # 2-sigma downside
    reward_to_risk = expected_return_at_hold / risk_at_hold if risk_at_hold > 0 else 0

    return {
        "optimal_hold_days": round(optimal_days),
        "min_hold_breakeven_days": round(min_hold_days) if min_hold_days < 999 else None,
        "max_hold_days": round(max_hold_days),
        "expected_return_pct": round(expected_return_at_hold, 1),
        "expected_risk_pct": round(risk_at_hold, 1),
        "reward_to_risk": round(reward_to_risk, 2),
        "confidence": round(confidence, 2),
        "regime": regime,
        "recommendation": _hold_recommendation(optimal_days, reward_to_risk, regime),
    }

def _hold_recommendation(optimal_days: int, rr: float, regime: str) -> str:
    if regime == "markdown":
        return "AVOID"
    if rr < 0.5:
        return "PASS"  # Risk exceeds reward
    if optimal_days > 180:
        return "LONG_TERM_HOLD"
    if optimal_days > 60:
        return "MEDIUM_HOLD"
    if optimal_days > 14:
        return "SHORT_TRADE"
    return "QUICK_FLIP"
```

### 5.2 Hold Period by Card Characteristics (Lookup Table)

| Card Type | Price | Rarity | Recommended Hold | Rationale |
|-----------|-------|--------|-----------------|-----------|
| Blue-chip, vintage | $100+ | Ultra+ | 365+ days | Steady appreciation, low volume |
| Blue-chip, modern | $20-100 | Rare Holo+ | 90-180 days | Liquid enough to exit, appreciates steadily |
| Mid-tier, trending | $20-50 | Rare+ | 30-60 days | Ride the trend, exit before mean reversion |
| Speculation, new set | $10-30 | Any | 7-14 days | Post-release hype fades fast |
| Bulk/low value | <$20 | Common-Rare | 0 days (no trade) | Fees eat all profit |

---

## 6. Risk-Adjusted Return Metrics for Illiquid Assets

Standard Sharpe ratio is misleading for Pokemon cards because:
1. **Gap risk**: Prices jump between syncs (not continuous)
2. **Illiquidity**: Can't exit at marked price instantly
3. **Fat tails**: Returns are non-normal (lottery-like upside, cliff-like downside)
4. **Stale pricing**: Market price may not update daily

### 6.1 Liquidity-Adjusted Sharpe Ratio

```python
def liquidity_adjusted_sharpe(
    daily_returns: list[float],
    liquidity_score: int,
    risk_free_rate: float = 0.05,  # 5% annual
) -> float | None:
    """
    Sharpe ratio with liquidity penalty.

    Illiquidity increases effective volatility because you can't exit
    at the marked price. Penalize by (1 + illiquidity_factor).
    """
    if len(daily_returns) < 30:
        return None

    # Filter out zero-return days (stale prices, not real zero returns)
    active_returns = [r for r in daily_returns if r != 0.0]
    if len(active_returns) < 10:
        return None

    mean_r = sum(active_returns) / len(active_returns)
    std_r = math.sqrt(sum((r - mean_r)**2 for r in active_returns) / (len(active_returns) - 1))

    if std_r == 0:
        return None

    # Illiquidity penalty: sqrt(expected_days_to_sell / 1)
    # liq_score 0-100, invert to get illiquidity
    illiquidity_factor = math.sqrt(max(1, (100 - liquidity_score) / 10))

    # Annualize
    annual_return = mean_r * 365
    annual_vol = std_r * math.sqrt(365) * illiquidity_factor

    daily_rf = risk_free_rate / 365
    excess_return = (mean_r - daily_rf) * 365

    return round(excess_return / annual_vol, 2)
```

### 6.2 Sortino Ratio (Downside Risk Only)

More appropriate than Sharpe for collectibles because upside "volatility" is desirable.

```python
def sortino_ratio(
    daily_returns: list[float],
    target_return: float = 0.0,  # Minimum acceptable return (daily)
) -> float | None:
    """
    Sortino ratio: excess return / downside deviation.
    Better than Sharpe for collectibles (we want upside volatility).
    """
    active_returns = [r for r in daily_returns if r != 0.0]
    if len(active_returns) < 30:
        return None

    mean_r = sum(active_returns) / len(active_returns)

    # Downside deviation: only negative deviations from target
    downside_sq = [min(0, r - target_return)**2 for r in active_returns]
    downside_dev = math.sqrt(sum(downside_sq) / len(downside_sq))

    if downside_dev == 0:
        return None  # No downside = infinite Sortino (suspicious)

    annual_excess = (mean_r - target_return) * 365
    annual_downside = downside_dev * math.sqrt(365)

    return round(annual_excess / annual_downside, 2)
```

### 6.3 Maximum Drawdown Duration

For illiquid assets, drawdown duration matters more than depth (you may not be able to sell during the drawdown).

```python
def max_drawdown_analysis(prices: list[float]) -> dict:
    """
    Compute max drawdown depth AND duration.

    Duration = how many days the card spent below its previous peak.
    This is the "pain period" -- for illiquid assets, long durations are the real risk.
    """
    if len(prices) < 2:
        return {"max_drawdown_pct": 0, "max_drawdown_duration_days": 0}

    peak = prices[0]
    max_dd = 0.0
    current_dd_start = 0
    max_dd_duration = 0
    current_dd_duration = 0
    in_drawdown = False

    for i, price in enumerate(prices):
        if price >= peak:
            peak = price
            if in_drawdown:
                max_dd_duration = max(max_dd_duration, current_dd_duration)
                current_dd_duration = 0
                in_drawdown = False
        else:
            dd = (peak - price) / peak * 100
            max_dd = max(max_dd, dd)
            if not in_drawdown:
                in_drawdown = True
                current_dd_start = i
            current_dd_duration = i - current_dd_start

    # Final check if still in drawdown
    if in_drawdown:
        max_dd_duration = max(max_dd_duration, current_dd_duration)

    return {
        "max_drawdown_pct": round(max_dd, 2),
        "max_drawdown_duration_days": max_dd_duration,
        "currently_in_drawdown": in_drawdown,
        "risk_category": _drawdown_risk_category(max_dd, max_dd_duration),
    }

def _drawdown_risk_category(dd_pct: float, dd_duration: int) -> str:
    if dd_pct > 50 or dd_duration > 180:
        return "HIGH"
    if dd_pct > 25 or dd_duration > 90:
        return "MEDIUM"
    if dd_pct > 10 or dd_duration > 30:
        return "LOW"
    return "MINIMAL"
```

### 6.4 Calmar Ratio (Return / Max Drawdown)

```python
def calmar_ratio(annual_return_pct: float, max_drawdown_pct: float) -> float | None:
    """
    Calmar = annualized return / max drawdown.

    Thresholds for collectibles:
        > 1.0 = excellent risk-adjusted return
        0.5-1.0 = acceptable
        < 0.5 = poor (drawdown too large relative to returns)
    """
    if max_drawdown_pct <= 0:
        return None
    return round(annual_return_pct / max_drawdown_pct, 2)
```

---

## 7. Log-Price Regression for Trend Strength

### 7.1 R-Squared as Confidence Metric

Already implemented in `calc_steady_appreciation()`. Here is the interpretation framework:

| R-squared | Interpretation | Strategy Implication |
|-----------|---------------|---------------------|
| 0.0 - 0.1 | Pure noise, no trend | Do not trade on trend signals |
| 0.1 - 0.3 | Weak trend, mostly noise | Only use with other confirmations (regime, factor model) |
| 0.3 - 0.5 | Moderate trend | Tradeable with wider stops and smaller position size |
| 0.5 - 0.7 | Strong trend | High-confidence directional trades |
| 0.7 - 1.0 | Very strong trend | Rare in collectibles -- verify not a data artifact |

### 7.2 Rolling R-Squared for Trend Decay Detection

```python
def rolling_r_squared(prices: list[float], window: int = 30, step: int = 7) -> list[dict]:
    """
    Compute R-squared on rolling windows to detect trend strengthening/weakening.

    If R^2 is declining while price is rising -> trend is becoming unreliable.
    If R^2 is increasing while price is rising -> trend is strengthening.
    """
    results = []

    for i in range(window, len(prices), step):
        window_prices = prices[i - window:i]
        log_p = [math.log(p) for p in window_prices if p > 0]

        if len(log_p) < 10:
            continue

        n = len(log_p)
        x = list(range(n))
        sum_x = sum(x)
        sum_y = sum(log_p)
        sum_xy = sum(a * b for a, b in zip(x, log_p))
        sum_x2 = sum(a * a for a in x)
        denom = n * sum_x2 - sum_x * sum_x

        if denom == 0:
            continue

        slope = (n * sum_xy - sum_x * sum_y) / denom
        intercept = (sum_y - slope * sum_x) / n
        y_mean = sum_y / n
        ss_tot = sum((yi - y_mean) ** 2 for yi in log_p)
        ss_res = sum((yi - (slope * xi + intercept)) ** 2 for xi, yi in zip(x, log_p))
        r_sq = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0

        results.append({
            "index": i,
            "r_squared": round(max(0, r_sq), 4),
            "slope_pct_day": round((math.exp(slope) - 1) * 100, 4),
            "price": prices[i - 1],
        })

    return results
```

**Divergence signals:**
- **Trend strengthening**: R^2 increasing over last 3 windows AND slope positive -> HOLD/ADD
- **Trend weakening**: R^2 decreasing over last 3 windows while price still rising -> TAKE PROFIT
- **Reversal setup**: R^2 drops below 0.15 after being above 0.4 -> trend is over

### 7.3 Segmented Regression (Breakpoint Detection)

Detect structural breaks in price trends (e.g., new set release, meta shift, viral moment):

```python
def detect_trend_breakpoints(prices: list[float], min_segment: int = 14) -> list[dict]:
    """
    Find structural breakpoints where the price trend changes significantly.

    Uses a simple approach: compare R^2 of single regression vs. two-segment
    regression at each potential breakpoint. The point that maximizes improvement
    in total R^2 is the breakpoint.
    """
    if len(prices) < min_segment * 3:
        return []

    log_p = [math.log(p) for p in prices if p > 0]
    n = len(log_p)

    def _segment_r2(y: list[float]) -> float:
        m = len(y)
        if m < 5:
            return 0
        x = list(range(m))
        sx = sum(x); sy = sum(y)
        sxy = sum(a*b for a,b in zip(x,y))
        sx2 = sum(a*a for a in x)
        d = m * sx2 - sx * sx
        if d == 0: return 0
        slope = (m * sxy - sx * sy) / d
        inter = (sy - slope * sx) / m
        ym = sy / m
        ss_t = sum((yi - ym)**2 for yi in y)
        ss_r = sum((yi - (slope*xi + inter))**2 for xi, yi in zip(x, y))
        return 1 - ss_r / ss_t if ss_t > 0 else 0

    # Single-segment R^2
    single_r2 = _segment_r2(log_p)

    # Test each potential breakpoint
    best_improvement = 0
    best_bp = None

    for bp in range(min_segment, n - min_segment):
        seg1_r2 = _segment_r2(log_p[:bp])
        seg2_r2 = _segment_r2(log_p[bp:])

        # Weighted average R^2 of two segments
        w1 = bp / n
        w2 = (n - bp) / n
        combined_r2 = w1 * seg1_r2 + w2 * seg2_r2

        improvement = combined_r2 - single_r2
        if improvement > best_improvement:
            best_improvement = improvement
            best_bp = bp

    breakpoints = []
    if best_bp and best_improvement > 0.1:  # Minimum 10% R^2 improvement
        breakpoints.append({
            "index": best_bp,
            "improvement": round(best_improvement, 3),
            "significance": "HIGH" if best_improvement > 0.25 else "MODERATE",
        })

    return breakpoints
```

---

## 8. Hurst Exponent for Mean-Reversion vs. Trending Classification

### 8.1 Rescaled Range (R/S) Hurst Exponent

```python
def hurst_exponent(prices: list[float], min_window: int = 10) -> dict | None:
    """
    Compute Hurst exponent via rescaled range (R/S) analysis.

    H < 0.5: Mean-reverting (use mean-reversion strategies)
    H = 0.5: Random walk (no edge from trend or mean-reversion)
    H > 0.5: Trending/persistent (use trend-following strategies)

    For Pokemon cards:
    - Most liquid cards: H ~ 0.45-0.55 (near random walk)
    - Hype-driven cards: H > 0.6 (momentum/trending)
    - Stable blue-chips: H < 0.45 (mean-reverting around fair value)
    """
    if len(prices) < min_window * 4:
        return None

    # Log returns
    log_returns = [math.log(prices[i] / prices[i-1])
                   for i in range(1, len(prices))
                   if prices[i] > 0 and prices[i-1] > 0]

    if len(log_returns) < min_window * 3:
        return None

    n = len(log_returns)

    # R/S analysis at different window sizes
    window_sizes = []
    rs_values = []

    w = min_window
    while w <= n // 2:
        window_sizes.append(w)

        rs_for_window = []
        num_windows = n // w

        for i in range(num_windows):
            segment = log_returns[i * w:(i + 1) * w]
            if len(segment) < w:
                continue

            mean_seg = sum(segment) / len(segment)

            # Cumulative deviation from mean
            cumdev = []
            running = 0
            for s in segment:
                running += (s - mean_seg)
                cumdev.append(running)

            # Range
            R = max(cumdev) - min(cumdev)

            # Standard deviation
            S = math.sqrt(sum((s - mean_seg)**2 for s in segment) / len(segment))

            if S > 0:
                rs_for_window.append(R / S)

        if rs_for_window:
            rs_values.append(sum(rs_for_window) / len(rs_for_window))

        w = int(w * 1.5)  # Geometric spacing

    if len(window_sizes) < 3 or len(rs_values) < 3:
        return None

    # Log-log regression: log(R/S) = H * log(n) + c
    log_n = [math.log(w) for w in window_sizes[:len(rs_values)]]
    log_rs = [math.log(rs) for rs in rs_values if rs > 0]

    if len(log_n) != len(log_rs) or len(log_rs) < 3:
        return None

    # OLS for H
    m = len(log_n)
    sx = sum(log_n[:m]); sy = sum(log_rs)
    sxy = sum(a * b for a, b in zip(log_n[:m], log_rs))
    sx2 = sum(a * a for a in log_n[:m])
    denom = m * sx2 - sx * sx

    if denom == 0:
        return None

    H = (m * sxy - sx * sy) / denom
    H = max(0.0, min(1.0, H))  # Clamp to [0, 1]

    # Classification
    if H < 0.4:
        classification = "STRONG_MEAN_REVERSION"
        strategy = "mean_reversion_bands"
    elif H < 0.5:
        classification = "MILD_MEAN_REVERSION"
        strategy = "rsi_mean_reversion"
    elif H < 0.55:
        classification = "RANDOM_WALK"
        strategy = "combined"
    elif H < 0.65:
        classification = "MILD_TRENDING"
        strategy = "sma_crossover"
    else:
        classification = "STRONG_TRENDING"
        strategy = "momentum_breakout"

    return {
        "hurst_exponent": round(H, 3),
        "classification": classification,
        "recommended_strategy": strategy,
        "confidence": round(1.0 - abs(H - 0.5) * 0.5, 2),  # Lower confidence near 0.5
        "n_windows_used": len(rs_values),
    }
```

### 8.2 Integration with Existing Half-Life

The existing `_half_life()` in `market_analysis.py` computes mean-reversion speed via OU process. Combine with Hurst:

```python
def strategy_selector(hurst: dict | None, half_life: float | None, regime: str, adx: float | None) -> dict:
    """
    Select optimal strategy based on Hurst exponent, half-life, regime, and ADX.

    Decision matrix:
    """
    H = hurst["hurst_exponent"] if hurst else 0.5
    hl = half_life or 999

    # ADX confirms trend strength (already computed)
    trending = adx is not None and adx > 25

    if H < 0.45 and hl < 30:
        # Strong mean reversion with fast reversion speed
        return {
            "strategy": "mean_reversion_bands",
            "position_sizing": "full",  # High confidence
            "hold_target_days": round(hl),
            "entry": "Buy at Bollinger lower band or RSI < 25",
            "exit": "Sell at Bollinger middle band or RSI > 50",
        }

    elif H < 0.45 and hl >= 30:
        # Mean reverting but slow
        return {
            "strategy": "rsi_mean_reversion",
            "position_sizing": "half",  # Lower confidence (slow reversion)
            "hold_target_days": round(hl),
            "entry": "Buy at RSI < 30",
            "exit": "Sell at RSI > 60",
        }

    elif H > 0.6 and trending:
        # Strong trending confirmed by both Hurst and ADX
        return {
            "strategy": "trend_rider",
            "position_sizing": "full",
            "hold_target_days": 30,
            "entry": "Buy on EMA stack alignment",
            "exit": "Sell on EMA stack breakdown or RSI > 75",
        }

    elif H > 0.55 and regime in ("markup", "accumulation"):
        # Mild trending in favorable regime
        return {
            "strategy": "sma_crossover",
            "position_sizing": "half",
            "hold_target_days": 45,
            "entry": "Buy on SMA7 > SMA30 cross",
            "exit": "Sell on SMA7 < SMA30 cross",
        }

    else:
        # Random walk territory or ambiguous
        return {
            "strategy": "steady_gainer",
            "position_sizing": "quarter",  # Low conviction
            "hold_target_days": 90,
            "entry": "Buy if appreciation_score > 50 AND liquidity_score > 40",
            "exit": "Sell on regime change to markdown",
        }
```

---

## 9. Concrete Formulas and Thresholds

### 9.1 Master Decision Framework

```python
def master_card_evaluation(
    card: Card,
    prices: list[float],
    dates: list[date],
    sales: list[Sale],
    set_age_years: float,
    set_rs: float,
) -> dict:
    """
    Run all quantitative models and produce a unified evaluation.

    Returns a single actionable recommendation with supporting evidence.
    """
    # 1. Fair value
    fv = fair_value_comparable(sales, dates[-1] if dates else date.today(), card.current_price)

    # 2. Trend analysis
    prediction = price_prediction_with_interval(prices, dates, forecast_days=30)

    # 3. Hurst exponent
    hurst = hurst_exponent(prices)

    # 4. Factor model
    factors = compute_card_factors(card, sales, set_rs, set_age_years)
    expected_return = expected_return_from_factors(factors, None)

    # 5. Optimal hold
    hold = optimal_hold_period(
        card.current_price or 0,
        card.appreciation_slope or 0,
        card.appreciation_consistency or 0,
        None,  # half_life from analyze_card()
        card.cached_regime or "unknown",
        0,  # volatility from analyze_card()
        card.liquidity_score or 0,
    )

    # 6. Risk metrics
    dd = max_drawdown_analysis(prices)

    # COMPOSITE SCORE: 0-100
    score = 0.0

    # Value component (25 pts): is it cheap relative to fair value?
    if fv["confidence"] > 0.3:
        if fv["spread_to_market_pct"] < -10:
            score += 25  # Undervalued
        elif fv["spread_to_market_pct"] < 0:
            score += 15
        elif fv["spread_to_market_pct"] < 10:
            score += 8
        # Overvalued = 0 points
    else:
        score += 10  # Unknown = neutral

    # Trend component (25 pts): is it trending up reliably?
    r2 = card.appreciation_consistency or 0
    slope = card.appreciation_slope or 0
    if slope > 0 and r2 > 0.3:
        score += min(25, r2 * 25 + slope * 50)

    # Regime component (15 pts)
    regime_scores = {"markup": 15, "accumulation": 10, "unknown": 5, "distribution": 2, "markdown": 0}
    score += regime_scores.get(card.cached_regime or "unknown", 5)

    # Liquidity component (15 pts)
    liq = card.liquidity_score or 0
    score += min(15, liq * 0.15)

    # Risk component (10 pts): low drawdown = good
    if dd["max_drawdown_pct"] < 15:
        score += 10
    elif dd["max_drawdown_pct"] < 30:
        score += 6
    elif dd["max_drawdown_pct"] < 50:
        score += 3

    # Factor premium (10 pts)
    if expected_return > 10:
        score += 10
    elif expected_return > 5:
        score += 7
    elif expected_return > 0:
        score += 4

    # Final recommendation
    if score >= 75:
        action = "STRONG_BUY"
    elif score >= 60:
        action = "BUY"
    elif score >= 45:
        action = "HOLD"
    elif score >= 30:
        action = "REDUCE"
    else:
        action = "AVOID"

    return {
        "composite_score": round(min(100, score), 1),
        "action": action,
        "hold_recommendation": hold.get("recommendation"),
        "optimal_hold_days": hold.get("optimal_hold_days"),
        "fair_value": fv,
        "trend": {
            "r_squared": r2,
            "slope_pct_day": slope,
            "forecast_30d": prediction.get("forecast_price") if prediction else None,
        },
        "hurst": hurst,
        "factors": factors,
        "expected_annual_return": expected_return,
        "risk": dd,
        "regime": card.cached_regime,
    }
```

### 9.2 Quick-Reference Threshold Table

| Metric | Formula | Buy Signal | Sell Signal | Source |
|--------|---------|------------|-------------|--------|
| RSI(14) | Wilder's RSI | < 30 (oversold) | > 70 (overbought) | `market_analysis._rsi()` |
| R-squared | Log-price OLS | > 0.5 + positive slope | < 0.15 (trend dead) | `investment_screener.calc_steady_appreciation()` |
| Hurst exponent | R/S analysis | > 0.6 (trending, use momentum) | < 0.4 (mean reverting, use MR) | New: `hurst_exponent()` |
| Half-life | OU regression | < 15 days (fast MR) | > 60 days (trending) | `market_analysis._half_life()` |
| ADX | Wilder's ADX | > 25 (trending) | < 20 (ranging) | `market_analysis._adx()` |
| Liquidity score | Composite | >= 40 (tradeable) | < 20 (illiquid, avoid) | `trading_economics.calc_liquidity_score()` |
| Fair value spread | Time-weighted median | < -10% (undervalued) | > 15% (overvalued) | New: `fair_value_comparable()` |
| Breakeven appreciation | Fee model | N/A | Must exceed for profit | `trading_economics.calc_breakeven_appreciation()` |
| Investment score | Soft-gated composite | > 60 (investment grade) | < 30 (avoid) | `investment_screener.get_investment_candidates()` |
| Max drawdown | Peak-to-trough | < 20% (low risk) | > 50% (high risk) | New: `max_drawdown_analysis()` |
| Calmar ratio | Annual return / max DD | > 1.0 (excellent) | < 0.3 (poor) | New: `calmar_ratio()` |
| Sortino ratio | Excess / downside dev | > 1.5 (good) | < 0.5 (bad) | New: `sortino_ratio()` |
| Bollinger %B | (Price - Lower) / Range | < 0.1 (buy zone) | > 0.9 (sell zone) | `market_analysis._bollinger_bands()` |
| Appreciation slope | Log regression slope | > 0.05%/day | < 0%/day | `investment_screener` |
| Regime | ADX + SMA200 position | `markup`, `accumulation` | `markdown`, `distribution` | `market_analysis._detect_regime()` |

### 9.3 Position Sizing Formula

```python
def position_size(
    portfolio_value: float,
    composite_score: float,     # 0-100 from master evaluation
    liquidity_score: int,       # 0-100
    max_position_pct: float = 10.0,  # Max 10% of portfolio in one card
) -> dict:
    """
    Kelly-inspired position sizing adjusted for conviction and liquidity.

    Full Kelly is too aggressive for illiquid assets. Use quarter-Kelly
    with a liquidity discount.
    """
    # Base allocation: linear with score, 0% at score=30, max at score=80
    if composite_score < 30:
        base_pct = 0.0
    else:
        base_pct = min(max_position_pct, (composite_score - 30) / 50 * max_position_pct)

    # Liquidity discount: illiquid positions get smaller
    if liquidity_score >= 60:
        liq_mult = 1.0
    elif liquidity_score >= 30:
        liq_mult = 0.6
    elif liquidity_score >= 10:
        liq_mult = 0.3
    else:
        liq_mult = 0.0  # Don't trade illiquid cards

    final_pct = base_pct * liq_mult
    dollar_amount = portfolio_value * final_pct / 100

    return {
        "allocation_pct": round(final_pct, 1),
        "dollar_amount": round(dollar_amount, 2),
        "sizing_tier": "FULL" if liq_mult >= 0.8 else "REDUCED" if liq_mult >= 0.4 else "MINIMAL",
    }
```

### 9.4 Implementation Priority

| Priority | Model | Effort | Impact | Dependencies |
|----------|-------|--------|--------|-------------|
| P0 | Hurst exponent | Small | High | Pure computation, no DB changes |
| P0 | Fair value (comparable sales) | Small | High | Uses existing `Sale` data |
| P1 | Prediction intervals | Small | Medium | Extends existing regression |
| P1 | Max drawdown duration | Small | Medium | Pure computation |
| P1 | Rolling R-squared | Small | Medium | Pure computation |
| P2 | Sortino/Calmar ratios | Small | Medium | Extends existing Sharpe |
| P2 | Position sizing | Small | Medium | Depends on composite score |
| P2 | Optimal hold period | Medium | High | Combines multiple metrics |
| P3 | Factor model (cross-sectional) | Medium | Medium | Needs batch regression across universe |
| P3 | Cross-set pairs trading | Medium | Low | Needs same-Pokemon matching |
| P3 | Breakpoint detection | Medium | Low | Nice-to-have for trend analysis |
| P4 | Intrinsic value model | Medium | Low | Hard to calibrate without more data |

---

## Appendix A: Fee-Aware Return Calculations

All return calculations in this system must account for platform fees. The breakeven hurdle varies by price tier:

| Card Price | TCGPlayer Breakeven | eBay Breakeven | Min Hold (at 0.1%/day) |
|-----------|-------------------|----------------|----------------------|
| $10 | 62.8% | 73.9% | ~487 days (not viable) |
| $20 | 38.9% | 44.5% | ~329 days |
| $50 | 23.6% | 25.8% | ~213 days |
| $100 | 19.3% | 20.4% | ~176 days |
| $250 | 17.1% | 17.5% | ~158 days |
| $500 | 16.5% | 16.6% | ~153 days |

**Key insight**: Cards below $20 are almost never profitable to trade actively. The fee drag requires extreme appreciation or very long holding periods. Focus trading activity on $50+ cards.

## Appendix B: Data Quality Guards

Before running any quantitative model, apply these filters (many already exist in the codebase):

1. **Minimum data points**: 30 price observations for regression, 60 for Hurst
2. **Spike removal**: Already implemented in `analyze_card()` (10x median filter)
3. **Variant purity**: Already implemented in `_filter_dominant_variant()`
4. **Outlier cleaning**: Already implemented in `_clean_outliers()` (3x local median)
5. **Stale data detection**: Skip cards where latest price is > 14 days old
6. **Zero-return filtering**: Exclude days with exactly 0% return from volatility/Sharpe calculations (stale prices, not real returns)
7. **Minimum price**: $2 floor for any tracked card (already enforced in queries)

## Appendix C: Backtesting Constraints for Collectibles

Pokemon card backtests are inherently optimistic due to:

1. **Execution slippage**: You can't buy at the exact marked price (spread, listing availability)
2. **Stale quotes**: Price data updates 1-2x daily, not in real-time
3. **Indivisibility**: Can't buy 0.37 of a card -- positions are integer quantities
4. **Asymmetric liquidity**: Easy to list, hard to sell at listed price quickly
5. **Condition uncertainty**: Listed as NM, may be LP on inspection (returns/disputes)

**Recommended adjustments for realistic backtests:**
- Apply 2% slippage on all buys (you pay 2% above market)
- Apply 3% slippage on all sells (you sell 3% below market)
- Enforce minimum 3-day holding period (shipping/listing lag)
- Multiply Sharpe ratio by 0.6 ("haircut" for illiquidity)
