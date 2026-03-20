# Backtest Framework Strategy Document

## Purpose

This document specifies the design and implementation of a rigorous backtesting framework for Pokemon card trading strategies. The current backtesting engine (`server/services/backtesting.py` and `server/services/prop_backtest.py`) provides basic walk-forward simulation with fee modeling. This framework elevates it to institutional-grade rigor: proper handling of illiquid asset dynamics, statistical validation, overfitting prevention, and robust performance measurement.

All patterns are designed for direct implementation against our existing SQLAlchemy models (`PriceHistory`, `Sale`, `Card`) and indicator functions in `server/services/market_analysis.py`.

---

## 1. Walk-Forward Simulation for Illiquid Assets with Gap Pricing

### The Problem

Pokemon card prices are not continuous. A card might trade at $45 on Monday, have no sales Tuesday through Thursday, then trade at $52 on Friday. Our `PriceHistory` table stores one record per date when data is available, but dates are not contiguous. The current engine iterates over available dates sequentially (`for i in range(30, len(prices))`), treating the gap between date index 5 and date index 6 as "one period" even if it spans 12 real calendar days.

### Solution: Calendar-Aligned Simulation with Forward-Fill

```python
from datetime import date, timedelta

def build_calendar_price_series(
    date_prices: dict[date, float],
    start_date: date,
    end_date: date,
) -> list[tuple[date, float, bool]]:
    """Build a contiguous daily price series with forward-fill.

    Returns list of (date, price, is_actual) tuples.
    is_actual=False means the price was forward-filled from the last known value.
    """
    sorted_dates = sorted(date_prices.keys())
    if not sorted_dates:
        return []

    series = []
    current = start_date
    last_known_price = date_prices.get(sorted_dates[0], 0)

    while current <= end_date:
        if current in date_prices:
            last_known_price = date_prices[current]
            series.append((current, last_known_price, True))
        else:
            series.append((current, last_known_price, False))
        current += timedelta(days=1)

    return series
```

### Key Rules

1. **Forward-fill only.** Never interpolate between known prices (that assumes knowledge of the future price). When a day has no sale, carry the last known price forward.

2. **Track "staleness."** Every forward-filled day gets a staleness counter (days since last actual observation). Strategies should discount stale signals: if the last real price is 14 days old, an RSI computed on forward-filled data is meaningless.

3. **Trade execution only on actual-price days.** A simulated buy or sell can only execute on a day where `is_actual=True`. You cannot buy a card on a day when nobody is selling it. If a signal fires on a forward-filled day, queue it and execute on the next actual-price day (with slippage adjustment for the delay).

4. **Gap-aware return calculation.** When computing daily returns for Sharpe/Sortino, use calendar days as the denominator, not observation count. A card that went from $10 to $12 over 30 calendar days (but only 4 price observations) has a daily return of (12/10)^(1/30) - 1, not (12/10)^(1/4) - 1.

### Walk-Forward Window Structure

```
|--- training window (e.g., 90 days) ---|--- test window (e.g., 30 days) ---|
                                         |--- training (90d) ---|--- test (30d) ---|
                                                                 |--- training ---|--- test ---|
```

- **Training window:** Optimize strategy parameters (indicator periods, thresholds).
- **Test window:** Execute the strategy with frozen parameters. Record returns.
- **Step size:** Advance by `test_window` days each iteration.
- **Minimum training observations:** Require at least 20 actual price observations (not forward-filled) in the training window. Skip the fold if insufficient.

```python
@dataclass
class WalkForwardFold:
    train_start: date
    train_end: date
    test_start: date
    test_end: date
    train_actual_obs: int  # number of real price observations in training
    test_actual_obs: int

def generate_walk_forward_folds(
    calendar_series: list[tuple[date, float, bool]],
    train_days: int = 90,
    test_days: int = 30,
    min_train_observations: int = 20,
) -> list[WalkForwardFold]:
    folds = []
    start = calendar_series[0][0]
    end = calendar_series[-1][0]
    current = start

    while current + timedelta(days=train_days + test_days) <= end:
        train_end = current + timedelta(days=train_days - 1)
        test_start = train_end + timedelta(days=1)
        test_end = test_start + timedelta(days=test_days - 1)

        # Count actual observations
        train_obs = sum(
            1 for d, p, actual in calendar_series
            if current <= d <= train_end and actual
        )
        test_obs = sum(
            1 for d, p, actual in calendar_series
            if test_start <= d <= test_end and actual
        )

        if train_obs >= min_train_observations:
            folds.append(WalkForwardFold(
                train_start=current,
                train_end=train_end,
                test_start=test_start,
                test_end=test_end,
                train_actual_obs=train_obs,
                test_actual_obs=test_obs,
            ))

        current += timedelta(days=test_days)

    return folds
```

---

## 2. Look-Ahead Bias Prevention

### Where Look-Ahead Bias Hides in Our Codebase

1. **Outlier cleaning.** `_clean_outliers()` in `backtesting.py` uses a symmetric window (`prices[i-7:i+8]`). At time `i`, it peeks at future prices `i+1` through `i+7` to compute the local median. Fix: use a trailing-only window (`prices[max(0,i-window):i+1]`).

2. **Indicator computation.** The current engine correctly computes indicators on `prices[:i+1]` (the slice up to the current point). This is correct. Do not change.

3. **Dominant variant filtering.** `_filter_dominant_variant()` selects the most common variant across ALL records. If a card's dominant variant shifts from "holofoil" to "reverseHolofoil" halfway through history, the filter uses the globally-dominant one, which may not have been knowable at the start. Fix: compute dominant variant using only data up to the current simulation date.

4. **Regime detection.** `_detect_regime()` uses ADX and price position relative to SMAs. As long as it only uses trailing data, this is fine. Verify that all regime features use only `prices[:i+1]`.

5. **Investment score / liquidity score.** These use `card.liquidity_score` and `card.appreciation_score`, which are computed from ALL historical data including future data relative to any given backtest date. Fix: recompute these from trailing data at each simulation step, or exclude them from backtested signals.

### Implementation: Strict Point-in-Time Indicator Engine

```python
class PointInTimeIndicators:
    """Compute indicators using ONLY data available at the simulation date.

    Every method takes prices[:t+1] -- the price series up to and including
    time t. No future data leaks.
    """

    def __init__(self, prices_to_date: list[float]):
        self.prices = prices_to_date

    def sma(self, period: int) -> float | None:
        return _sma(self.prices, period)

    def rsi(self, period: int = 14) -> float | None:
        return _rsi(self.prices, period)

    def clean_outlier_at_tip(self, window: int = 7) -> float:
        """Check if the latest price is an outlier using ONLY trailing data."""
        if len(self.prices) < 3:
            return self.prices[-1]
        lookback = self.prices[max(0, len(self.prices) - window - 1):-1]
        if not lookback:
            return self.prices[-1]
        median = sorted(lookback)[len(lookback) // 2]
        tip = self.prices[-1]
        if median > 0 and (tip > median * 3 or tip < median * 0.33):
            return median
        return tip
```

### Checklist Before Every Backtest Run

- [ ] Outlier cleaning uses trailing window only
- [ ] Indicators computed on `prices[:i+1]`, never `prices[:i+k]` for k > 1
- [ ] No card-level cached scores (liquidity_score, appreciation_score) used in signals
- [ ] Variant filtering uses only data up to simulation date
- [ ] Train/test split has no data overlap

---

## 3. Slippage Modeling for Collectibles Markets

### Why Equity Slippage Models Fail for Cards

In equities, slippage is typically 1-5 bps for liquid stocks. Pokemon cards face:
- **No order book.** There is no bid/ask queue. You list a card and wait for a buyer.
- **Wide spreads.** The gap between the lowest listing price and what a buyer actually pays can be 10-30% for illiquid cards.
- **Asymmetric slippage.** Buying (taking the lowest listing) has different slippage than selling (listing and waiting, or pricing below market to sell fast).
- **Price impact.** For low-volume cards, your buy/sell IS the price. Buying the only $50 listing means the next listing might be $65.

### Slippage Model (already partially in `virtual_trader.py`)

```python
def calculate_slippage(
    price: float,
    liquidity_score: int,
    is_buy: bool,
    urgency: float = 0.5,  # 0=patient, 1=immediate
) -> float:
    """Calculate realistic slippage for a collectibles market trade.

    Returns the execution price after slippage.

    Slippage tiers (based on our liquidity_score 0-100):
      90-100: 0.5-1.5%  (liquid modern staples, e.g. Charizard ex)
      60-89:  1.5-4%    (popular cards with regular sales)
      30-59:  4-10%     (niche cards, vintage uncommons)
      0-29:   10-25%    (illiquid vintage rares, obscure promos)

    Buy slippage is POSITIVE (you pay more than market).
    Sell slippage is NEGATIVE (you receive less than market).
    """
    if liquidity_score >= 90:
        base_slip = 0.005 + (100 - liquidity_score) / 100 * 0.01
    elif liquidity_score >= 60:
        base_slip = 0.015 + (90 - liquidity_score) / 30 * 0.025
    elif liquidity_score >= 30:
        base_slip = 0.04 + (60 - liquidity_score) / 30 * 0.06
    else:
        base_slip = 0.10 + (30 - liquidity_score) / 30 * 0.15

    # Urgency multiplier: patient traders get better fills
    urgency_mult = 0.5 + urgency  # 0.5x to 1.5x

    # Sell slippage is typically 1.3x buy slippage (harder to sell than buy)
    direction_mult = 1.3 if not is_buy else 1.0

    total_slip = base_slip * urgency_mult * direction_mult

    if is_buy:
        return price * (1 + total_slip)
    else:
        return price * (1 - total_slip)
```

### Price Impact for Low-Volume Cards

For cards with < 5 sales in the last 90 days, add a price impact component. If you "buy" a card with 1 sale/month, the simulation should assume:
- You take the available listing (slippage as above).
- The market price shifts UP by 50% of your slippage (your purchase becomes the new comp).
- This elevated price feeds into the next indicator calculation.

```python
def apply_price_impact(
    current_price: float,
    execution_price: float,
    sales_per_day: float,
) -> float:
    """Estimate new market price after a trade's price impact.

    For illiquid cards, your trade IS the market.
    """
    if sales_per_day >= 1.0:
        return current_price  # Liquid enough that one trade doesn't move the market
    elif sales_per_day >= 0.1:
        impact_fraction = 0.3 * (1 - sales_per_day)
    else:
        impact_fraction = 0.5  # Your trade IS half the recent comps

    price_delta = execution_price - current_price
    return current_price + price_delta * impact_fraction
```

---

## 4. Transaction Cost Modeling

### TCGPlayer Fee Structure (as of 2026)

Already implemented in `server/services/trading_economics.py`. The exact model:

| Component | Rate |
|-----------|------|
| Seller commission | 10.75% of sale price |
| Payment processing | 2.5% of sale price + $0.30 flat |
| Shipping (tracked) | $4.50 per shipment |
| Buyer shipping | $0.00 (TCGPlayer Direct, free on $5+) |

**Combined effective fee at various price points:**

| Card Price | Total Fees | Fee % | Breakeven Appreciation |
|------------|-----------|-------|----------------------|
| $10 | $6.13 | 61.3% | 70.7% |
| $20 | $7.45 | 37.3% | 31.9% |
| $50 | $11.43 | 22.9% | 23.7% |
| $100 | $18.05 | 18.1% | 20.6% |
| $250 | $37.93 | 15.2% | 18.4% |

### Implementation for Backtesting

The backtest engine must apply fees at every trade, not just at the end. The current `run_backtest()` supports `fees_enabled=True` which calls `apply_buy_fees()` and `apply_sell_fees()`. This is correct but needs enhancement:

```python
@dataclass
class TradeExecution:
    """Full trade record with fee decomposition."""
    date: date
    action: str  # "buy" or "sell"
    market_price: float  # price before slippage
    execution_price: float  # price after slippage
    quantity: int
    gross_value: float  # execution_price * quantity
    commission: float
    processing_fee: float
    shipping: float
    net_value: float  # what you actually receive (sell) or pay (buy)
    slippage_cost: float  # abs(execution_price - market_price) * quantity

    @property
    def total_friction(self) -> float:
        """Total cost of executing this trade (fees + slippage)."""
        return self.commission + self.processing_fee + self.shipping + self.slippage_cost
```

### Critical Insight: Minimum Viable Trade Price

From the fee table above, cards under $20 are essentially untradeable for profit. The breakeven appreciation for a $10 card is 70.7% -- the card needs to nearly double just to break even. Our backtesting engine MUST enforce a minimum trade price filter (currently $5 in `prop_strategies.py` via `MIN_PRICE`, should be $20 for realistic backtesting). The `is_viable_trade()` function in `trading_economics.py` already returns `price >= 20.0`.

### Multi-Card Shipment Optimization

When buying or selling multiple cards, shipping cost is per-shipment, not per-card. If the strategy buys 3 cards from the same seller, shipping should be $4.50 total, not $13.50. Model this:

```python
def calc_batch_sell_proceeds(
    sale_prices: list[float],
    platform: str = "tcgplayer",
) -> dict:
    """Calculate proceeds for selling multiple cards in one shipment."""
    fees = PLATFORMS[platform]
    total_gross = sum(sale_prices)
    commission = total_gross * fees.commission_rate
    processing = total_gross * fees.payment_processing_rate + fees.payment_flat_fee
    shipping = fees.shipping_cost  # ONE shipment
    net = total_gross - commission - processing - shipping
    return {"net_proceeds": round(net, 2), "total_fees": round(commission + processing + shipping, 2)}
```

---

## 5. Measuring Alpha Without a Clear Benchmark

### The Problem

Equities have the S&P 500. Bonds have the Agg. Pokemon cards have... nothing. There is no published "Pokemon Card Index" to benchmark against.

### Alpha Definition for Collectibles

Alpha = Strategy return - Benchmark return, where the benchmark must satisfy:
1. **Investable.** You could actually buy the benchmark portfolio.
2. **Passive.** No active decisions after construction.
3. **Representative.** Reflects the "market" your strategy operates in.

### Approaches to Measuring Alpha

**Approach 1: Card-Specific Buy-and-Hold (current)**
Already implemented: `buy_hold_return_pct` in `BacktestResult`. Alpha = strategy return - buy-and-hold on the same card. This is valid for single-card backtests but doesn't capture opportunity cost across the market.

**Approach 2: Equal-Weight Tracked Cards Index (see Section 6)**
Build a synthetic index from all tracked cards. Alpha = strategy return - index return.

**Approach 3: Category-Matched Benchmark**
Compare a strategy focused on "vintage holos" against an index of all vintage holos. This controls for segment-specific trends (e.g., vintage cards rising while modern cards fall).

**Approach 4: Risk-Adjusted Alpha (Jensen's Alpha)**
```
alpha = R_strategy - [R_f + beta * (R_benchmark - R_f)]
```
Where R_f = risk-free rate (Treasury yield, ~4.5% annualized as of 2026), beta = strategy's sensitivity to the benchmark. This accounts for the possibility that a strategy outperforms simply by taking more risk.

### Implementation

```python
def calculate_alpha(
    strategy_returns: list[float],  # daily returns
    benchmark_returns: list[float],  # daily returns, same dates
    risk_free_daily: float = 0.045 / 365,
) -> dict:
    """Calculate alpha, beta, and information ratio."""
    import numpy as np

    excess_strat = [r - risk_free_daily for r in strategy_returns]
    excess_bench = [r - risk_free_daily for r in benchmark_returns]

    # Beta via OLS: excess_strat = alpha + beta * excess_bench
    n = len(excess_strat)
    if n < 10:
        return {"alpha": None, "beta": None, "info_ratio": None, "error": "insufficient data"}

    x = np.array(excess_bench)
    y = np.array(excess_strat)
    beta = np.cov(y, x)[0, 1] / np.var(x) if np.var(x) > 0 else 1.0
    alpha_daily = np.mean(y) - beta * np.mean(x)
    alpha_annual = alpha_daily * 365

    # Information ratio: alpha / tracking_error
    tracking_errors = [s - b for s, b in zip(strategy_returns, benchmark_returns)]
    te_std = np.std(tracking_errors) if len(tracking_errors) > 1 else 1.0
    info_ratio = (np.mean(tracking_errors) / te_std * np.sqrt(365)) if te_std > 0 else 0

    return {
        "alpha_annual_pct": round(alpha_annual * 100, 2),
        "beta": round(beta, 3),
        "information_ratio": round(info_ratio, 2),
        "r_squared": round(np.corrcoef(x, y)[0, 1] ** 2, 3) if n > 2 else None,
    }
```

---

## 6. Creating a Synthetic Benchmark Index

### Construction Method: Equal-Weight Tracked Cards Index

```python
def build_equal_weight_index(
    db: Session,
    start_date: date,
    end_date: date,
    rebalance_frequency_days: int = 30,
    min_price: float = 5.0,
    min_observations: int = 10,
) -> list[tuple[date, float]]:
    """Build an equal-weight index from all tracked cards.

    Methodology:
    1. At each rebalance date, select all tracked cards with:
       - current_price >= min_price
       - At least min_observations price history records
    2. Allocate equal weight (1/N) to each card.
    3. Between rebalances, track the weighted return.
    4. At rebalance, re-equal-weight (sells winners, buys losers).

    Returns daily index values starting at 1000.
    """
    # Get all tracked card IDs with sufficient data
    from sqlalchemy import func
    card_ids_with_data = (
        db.query(PriceHistory.card_id, func.count(PriceHistory.id))
        .filter(PriceHistory.market_price.isnot(None))
        .group_by(PriceHistory.card_id)
        .having(func.count(PriceHistory.id) >= min_observations)
        .all()
    )
    eligible_ids = {row[0] for row in card_ids_with_data}

    # Build price series for each card (forward-filled)
    card_series: dict[int, dict[date, float]] = {}
    for card_id in eligible_ids:
        records = (
            db.query(PriceHistory)
            .filter(
                PriceHistory.card_id == card_id,
                PriceHistory.market_price.isnot(None),
                PriceHistory.date >= start_date,
                PriceHistory.date <= end_date,
            )
            .order_by(PriceHistory.date)
            .all()
        )
        if records:
            dp = {r.date: r.market_price for r in records}
            card_series[card_id] = dp

    if not card_series:
        return []

    # Build daily index
    index_values = []
    index_level = 1000.0
    current = start_date
    last_rebalance = start_date
    constituents: dict[int, float] = {}  # card_id -> weight
    last_prices: dict[int, float] = {}   # card_id -> price at last rebalance

    while current <= end_date:
        # Rebalance?
        if not constituents or (current - last_rebalance).days >= rebalance_frequency_days:
            # Find cards with a known price on or before this date
            active = {}
            for cid, series in card_series.items():
                # Find most recent price <= current date
                valid_dates = [d for d in series if d <= current]
                if valid_dates:
                    latest = max(valid_dates)
                    price = series[latest]
                    if price >= min_price:
                        active[cid] = price

            if active:
                weight = 1.0 / len(active)
                constituents = {cid: weight for cid in active}
                last_prices = dict(active)
                last_rebalance = current

        # Compute daily return
        if constituents:
            daily_return = 0.0
            for cid, weight in constituents.items():
                series = card_series.get(cid, {})
                valid_dates = [d for d in series if d <= current]
                if valid_dates:
                    current_price = series[max(valid_dates)]
                else:
                    current_price = last_prices.get(cid, 0)

                prev_price = last_prices.get(cid, current_price)
                if prev_price > 0:
                    card_return = (current_price - prev_price) / prev_price
                    daily_return += weight * card_return
                last_prices[cid] = current_price

            index_level *= (1 + daily_return)

        index_values.append((current, round(index_level, 2)))
        current += timedelta(days=1)

    return index_values
```

### Alternative Benchmarks

| Benchmark | When to Use |
|-----------|-------------|
| Equal-weight all tracked | Default. Answers "did the strategy beat passive diversification?" |
| Price-weighted (by market cap proxy) | When testing strategies that favor expensive cards |
| Segment-specific (vintage only, modern only) | When strategy targets a specific segment |
| Risk-parity weighted | When comparing risk-adjusted performance |
| Buy-and-hold best card (hindsight) | Upper bound / "perfect foresight" ceiling |
| Cash (risk-free rate) | Lower bound. Did the strategy beat a savings account? |

---

## 7. Statistical Significance Testing

### How Many Trades Do You Need?

The central question: "Is this strategy's outperformance real, or could it have happened by chance?"

### Minimum Trade Count by Confidence Level

For a strategy with win rate `w` and average win/loss ratio `R`:

```python
import math
from scipy import stats

def min_trades_for_significance(
    observed_win_rate: float,
    null_win_rate: float = 0.50,  # random chance
    confidence: float = 0.95,
    power: float = 0.80,
) -> int:
    """Minimum trades needed to distinguish observed win rate from chance.

    Uses the two-proportion z-test power calculation.

    Example: if observed win_rate = 0.60 and null = 0.50,
    you need ~196 trades at 95% confidence / 80% power.
    """
    z_alpha = stats.norm.ppf(1 - (1 - confidence) / 2)  # two-tailed
    z_beta = stats.norm.ppf(power)

    p1 = observed_win_rate
    p0 = null_win_rate
    p_bar = (p1 + p0) / 2

    numerator = (z_alpha * math.sqrt(2 * p_bar * (1 - p_bar)) +
                 z_beta * math.sqrt(p1 * (1 - p1) + p0 * (1 - p0))) ** 2
    denominator = (p1 - p0) ** 2

    return math.ceil(numerator / denominator)
```

**Practical minimums for Pokemon card strategies:**

| Win Rate | Min Trades (95% confidence) | Realistic? |
|----------|---------------------------|------------|
| 55% | 784 | No -- need years of data |
| 60% | 196 | Possible with 50+ cards over 1 year |
| 65% | 88 | Achievable |
| 70% | 50 | Achievable |

Given our dataset constraints (most cards have 60-200 price observations, strategy generates 2-8 trades per card), we need to:
1. **Pool trades across cards.** A strategy that generates 5 trades on each of 40 cards gives 200 pooled trades.
2. **Use bootstrap confidence intervals** instead of parametric tests (see below).
3. **Report confidence intervals, not just point estimates.**

### Bootstrap Test for Strategy Returns

```python
import random

def bootstrap_strategy_significance(
    trade_returns: list[float],  # net return per trade (after fees)
    n_bootstrap: int = 10000,
    confidence: float = 0.95,
) -> dict:
    """Bootstrap test: is the strategy mean return significantly > 0?

    Returns confidence interval, p-value, and whether significant.
    """
    n = len(trade_returns)
    if n < 5:
        return {"significant": False, "error": "too few trades", "n": n}

    observed_mean = sum(trade_returns) / n

    # Bootstrap distribution of means
    boot_means = []
    for _ in range(n_bootstrap):
        sample = random.choices(trade_returns, k=n)
        boot_means.append(sum(sample) / n)

    boot_means.sort()
    alpha = 1 - confidence
    ci_lower = boot_means[int(alpha / 2 * n_bootstrap)]
    ci_upper = boot_means[int((1 - alpha / 2) * n_bootstrap)]

    # p-value: fraction of bootstrap means <= 0
    p_value = sum(1 for m in boot_means if m <= 0) / n_bootstrap

    return {
        "observed_mean_return": round(observed_mean, 4),
        "ci_lower": round(ci_lower, 4),
        "ci_upper": round(ci_upper, 4),
        "p_value": round(p_value, 4),
        "significant": ci_lower > 0,  # entire CI above zero
        "n_trades": n,
        "n_bootstrap": n_bootstrap,
    }
```

### Multiple Comparisons Correction

When testing 9 strategies (as in our `STRATEGIES` dict), apply Bonferroni correction:

```python
def bonferroni_corrected_alpha(
    base_alpha: float = 0.05,
    n_strategies: int = 9,
) -> float:
    """Adjusted significance threshold for multiple strategy comparisons."""
    return base_alpha / n_strategies  # 0.0056 for 9 strategies
```

Alternatively, use the Holm-Bonferroni method (less conservative, more powerful):

```python
def holm_bonferroni(p_values: list[tuple[str, float]], alpha: float = 0.05) -> list[tuple[str, float, bool]]:
    """Holm-Bonferroni step-down procedure for multiple comparisons.

    Returns list of (strategy_name, p_value, is_significant).
    """
    sorted_pvals = sorted(p_values, key=lambda x: x[1])
    m = len(sorted_pvals)
    results = []

    for i, (name, pval) in enumerate(sorted_pvals):
        adjusted_alpha = alpha / (m - i)
        sig = pval < adjusted_alpha
        results.append((name, pval, sig))
        if not sig:
            # All remaining are also not significant
            for j in range(i + 1, m):
                results.append((sorted_pvals[j][0], sorted_pvals[j][1], False))
            break

    return results
```

---

## 8. Overfitting Prevention

### The Risk

With 9 strategies, 6+ configurable parameters each, and ~200 price data points per card, the risk of curve-fitting is extreme. A strategy "optimized" on our data will likely fail on future data.

### Prevention Techniques

#### 8.1 Parameter Count Budget

**Rule: the ratio of data points to free parameters must be >= 20:1.**

If a strategy has 5 tunable parameters and you have 100 trades in the test set, that's 20:1 -- borderline acceptable. If you have 3 parameters and 200 trades, that's 67:1 -- good.

```python
def check_parameter_budget(
    n_trades: int,
    n_parameters: int,
    min_ratio: float = 20.0,
) -> dict:
    ratio = n_trades / n_parameters if n_parameters > 0 else float('inf')
    return {
        "ratio": round(ratio, 1),
        "passes": ratio >= min_ratio,
        "recommendation": (
            f"OK: {ratio:.0f}:1 data-to-parameter ratio"
            if ratio >= min_ratio
            else f"WARNING: {ratio:.0f}:1 ratio. Reduce parameters to {n_trades // int(min_ratio)} or gather more data."
        ),
    }
```

#### 8.2 Parameter Stability Testing

A robust strategy should perform similarly with slightly different parameters. If changing the RSI threshold from 30 to 32 dramatically changes returns, the strategy is overfit.

```python
def parameter_stability_test(
    run_backtest_fn,  # callable(params) -> return_pct
    base_params: dict,
    perturbation_pct: float = 0.10,  # perturb each param by +/- 10%
    n_perturbations: int = 50,
) -> dict:
    """Test whether strategy performance is stable under parameter perturbation.

    A robust strategy should have std(returns) / mean(returns) < 0.5
    across perturbations (coefficient of variation).
    """
    base_return = run_backtest_fn(base_params)
    perturbed_returns = []

    for _ in range(n_perturbations):
        perturbed = {}
        for key, value in base_params.items():
            if isinstance(value, (int, float)):
                delta = value * perturbation_pct * random.uniform(-1, 1)
                perturbed[key] = type(value)(value + delta)
            else:
                perturbed[key] = value
        perturbed_returns.append(run_backtest_fn(perturbed))

    mean_return = sum(perturbed_returns) / len(perturbed_returns)
    std_return = (sum((r - mean_return)**2 for r in perturbed_returns) / len(perturbed_returns)) ** 0.5
    cv = std_return / abs(mean_return) if mean_return != 0 else float('inf')

    return {
        "base_return": base_return,
        "mean_perturbed_return": round(mean_return, 2),
        "std_perturbed_return": round(std_return, 2),
        "coefficient_of_variation": round(cv, 3),
        "is_stable": cv < 0.5,
        "worst_perturbed": round(min(perturbed_returns), 2),
        "best_perturbed": round(max(perturbed_returns), 2),
    }
```

#### 8.3 Deflated Sharpe Ratio (DSR)

The Deflated Sharpe Ratio adjusts for the number of strategies tested. If you test 100 strategies and pick the best one, the DSR tells you whether that best Sharpe is likely real or a statistical artifact.

```python
def deflated_sharpe_ratio(
    observed_sharpe: float,
    n_strategies_tested: int,
    n_observations: int,
    skewness: float = 0.0,
    kurtosis: float = 3.0,  # excess kurtosis = 0 for normal
) -> float:
    """Compute the probability that the observed Sharpe is a false positive.

    Based on Bailey & Lopez de Prado (2014).

    Returns: probability that the Sharpe is genuine (higher = better).
    A value < 0.5 means the Sharpe is likely a false positive.
    """
    from scipy import stats as sp_stats

    # Expected maximum Sharpe under null (all strategies are random)
    euler_mascheroni = 0.5772
    expected_max_sharpe = (
        (1 - euler_mascheroni) * sp_stats.norm.ppf(1 - 1 / n_strategies_tested) +
        euler_mascheroni * sp_stats.norm.ppf(1 - 1 / (n_strategies_tested * math.e))
    )

    # Standard error of Sharpe estimate
    se_sharpe = math.sqrt(
        (1 + 0.5 * observed_sharpe**2 - skewness * observed_sharpe +
         ((kurtosis - 3) / 4) * observed_sharpe**2) / (n_observations - 1)
    )

    if se_sharpe <= 0:
        return 0.0

    # Probability that observed Sharpe exceeds the expected max under null
    z = (observed_sharpe - expected_max_sharpe) / se_sharpe
    return round(sp_stats.norm.cdf(z), 4)
```

#### 8.4 Strategy Complexity Penalty

Simpler strategies are less likely to be overfit. Apply an Akaike-style penalty:

```python
def complexity_adjusted_return(
    return_pct: float,
    n_parameters: int,
    n_trades: int,
) -> float:
    """Penalize complex strategies. Inspired by AIC.

    Penalty = 2 * k / n, where k = parameters, n = trades.
    """
    penalty = 2 * n_parameters / n_trades if n_trades > 0 else 1.0
    return return_pct * (1 - penalty)
```

---

## 9. Out-of-Sample Testing for Small Datasets

### The Problem

Most of our cards have 60-200 daily price observations. Standard 80/20 train/test splits leave too little data for either set.

### Approach 1: Combinatorial Purged Cross-Validation (CPCV)

Traditional k-fold CV is invalid for time series (temporal leakage). CPCV handles this:

```python
def purged_kfold_split(
    dates: list[date],
    n_splits: int = 5,
    purge_days: int = 7,  # gap between train and test to prevent leakage
) -> list[tuple[list[int], list[int]]]:
    """Generate purged k-fold splits for time series data.

    Each fold uses a contiguous block as the test set.
    Purge zone: remove `purge_days` of training data adjacent to the test set.
    """
    n = len(dates)
    fold_size = n // n_splits
    splits = []

    for i in range(n_splits):
        test_start = i * fold_size
        test_end = min((i + 1) * fold_size, n)

        # Training indices: everything outside test + purge zone
        train_indices = []
        for j in range(n):
            # Purge zone: skip indices within purge_days of test boundaries
            if j < test_start - purge_days or j >= test_end + purge_days:
                train_indices.append(j)

        test_indices = list(range(test_start, test_end))
        if train_indices and test_indices:
            splits.append((train_indices, test_indices))

    return splits
```

### Approach 2: Expanding Window (Our Primary Method)

For our dataset size, expanding window is more appropriate than fixed window:

```
Fold 1: Train [0..60],  Test [61..90]
Fold 2: Train [0..90],  Test [91..120]
Fold 3: Train [0..120], Test [121..150]
Fold 4: Train [0..150], Test [151..180]
```

The training set grows with each fold, which helps with our small data problem. The test set remains a fixed 30-day window.

```python
def expanding_window_splits(
    n_observations: int,
    min_train: int = 60,
    test_size: int = 30,
    purge: int = 5,
) -> list[tuple[range, range]]:
    """Generate expanding-window train/test splits."""
    splits = []
    train_end = min_train

    while train_end + purge + test_size <= n_observations:
        train = range(0, train_end)
        test = range(train_end + purge, train_end + purge + test_size)
        splits.append((train, test))
        train_end += test_size

    return splits
```

### Approach 3: Leave-P-Out for Very Small Datasets

For cards with < 60 observations, use leave-p-out where p = 1 trade (not 1 data point). Simulate removing each completed trade pair and measure how the strategy's aggregate statistics change.

### Reporting Out-of-Sample Results

Always report:
1. **In-sample return** (training data).
2. **Out-of-sample return** (test data).
3. **Degradation ratio:** OOS return / IS return. A ratio > 0.5 is acceptable. Below 0.3 indicates severe overfitting.

```python
def evaluate_oos_degradation(
    in_sample_return: float,
    out_of_sample_return: float,
) -> dict:
    if in_sample_return == 0:
        ratio = 0.0
    elif in_sample_return > 0:
        ratio = out_of_sample_return / in_sample_return
    else:
        ratio = out_of_sample_return / abs(in_sample_return)  # both negative: ratio > 0 means OOS less negative

    return {
        "in_sample_return_pct": round(in_sample_return, 2),
        "out_of_sample_return_pct": round(out_of_sample_return, 2),
        "degradation_ratio": round(ratio, 3),
        "assessment": (
            "GOOD" if ratio > 0.5 else
            "MARGINAL" if ratio > 0.3 else
            "OVERFIT" if ratio > 0.0 else
            "INVERTED (strategy loses OOS)"
        ),
    }
```

---

## 10. Performance Metrics

### Full Metric Suite

All metrics should be computed after fees and slippage.

```python
import math
from dataclasses import dataclass

@dataclass
class BacktestMetrics:
    # Return metrics
    total_return_pct: float          # (final - initial) / initial * 100
    annualized_return_pct: float     # (1 + total_return)^(365/days) - 1
    buy_hold_return_pct: float       # passive benchmark

    # Risk metrics
    sharpe_ratio: float              # (mean_return - rf) / std_return * sqrt(365)
    sortino_ratio: float             # (mean_return - rf) / downside_std * sqrt(365)
    calmar_ratio: float              # annualized_return / max_drawdown
    max_drawdown_pct: float          # peak-to-trough decline
    max_drawdown_duration_days: int  # longest time underwater
    volatility_annual_pct: float     # std of daily returns * sqrt(365)
    downside_deviation: float        # std of negative returns only

    # Trade metrics
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate_pct: float              # winning / total * 100
    profit_factor: float             # gross_profit / gross_loss
    avg_win_pct: float               # mean return of winning trades
    avg_loss_pct: float              # mean return of losing trades
    payoff_ratio: float              # avg_win / avg_loss
    expectancy_per_trade: float      # avg return per trade in dollars
    max_consecutive_wins: int
    max_consecutive_losses: int

    # Time metrics
    avg_holding_period_days: float
    pct_time_in_market: float        # fraction of days with open position

    # Fee metrics
    total_fees_paid: float
    fees_as_pct_of_gross: float      # total_fees / gross_profits

    # Alpha metrics
    alpha_vs_benchmark_pct: float
    information_ratio: float
    beta: float


def compute_all_metrics(
    daily_portfolio_values: list[tuple[date, float]],
    trades: list[TradeExecution],
    benchmark_values: list[tuple[date, float]],
    initial_capital: float,
    risk_free_annual: float = 0.045,
) -> BacktestMetrics:
    """Compute the full metric suite from backtest results."""

    # --- Returns ---
    values = [v for _, v in daily_portfolio_values]
    dates = [d for d, _ in daily_portfolio_values]
    n_days = (dates[-1] - dates[0]).days if len(dates) > 1 else 1

    total_return = (values[-1] - initial_capital) / initial_capital
    annualized = (1 + total_return) ** (365 / max(n_days, 1)) - 1

    # Daily returns (calendar-based)
    daily_returns = []
    for i in range(1, len(values)):
        if values[i - 1] > 0:
            daily_returns.append((values[i] - values[i - 1]) / values[i - 1])

    rf_daily = risk_free_annual / 365

    # --- Sharpe ---
    if daily_returns:
        mean_r = sum(daily_returns) / len(daily_returns)
        std_r = (sum((r - mean_r)**2 for r in daily_returns) / max(len(daily_returns) - 1, 1)) ** 0.5
        sharpe = (mean_r - rf_daily) / std_r * math.sqrt(365) if std_r > 0 else 0
    else:
        sharpe = 0
        mean_r = 0
        std_r = 0

    # --- Sortino (downside deviation) ---
    downside_returns = [r for r in daily_returns if r < rf_daily]
    if downside_returns:
        downside_dev = (sum((r - rf_daily)**2 for r in downside_returns) / len(downside_returns)) ** 0.5
        sortino = (mean_r - rf_daily) / downside_dev * math.sqrt(365) if downside_dev > 0 else 0
    else:
        sortino = float('inf') if mean_r > rf_daily else 0
        downside_dev = 0

    # --- Max Drawdown ---
    peak = values[0]
    max_dd = 0
    dd_start = dates[0]
    max_dd_duration = 0
    current_dd_start = dates[0]

    for i, v in enumerate(values):
        if v > peak:
            peak = v
            duration = (dates[i] - current_dd_start).days
            max_dd_duration = max(max_dd_duration, duration)
            current_dd_start = dates[i]
        dd = (peak - v) / peak if peak > 0 else 0
        max_dd = max(max_dd, dd)

    # --- Calmar ---
    calmar = annualized / max_dd if max_dd > 0 else float('inf') if annualized > 0 else 0

    # --- Trade Analysis ---
    completed_trades = []  # pairs of (buy, sell)
    buy_trade = None
    for t in trades:
        if t.action == "buy":
            buy_trade = t
        elif t.action == "sell" and buy_trade is not None:
            trade_return = (t.net_value - buy_trade.net_value) / buy_trade.net_value
            completed_trades.append({
                "return": trade_return,
                "buy_date": buy_trade.date,
                "sell_date": t.date,
                "holding_days": (t.date - buy_trade.date).days,
                "gross_profit": t.gross_value - buy_trade.gross_value,
                "fees": buy_trade.total_friction + t.total_friction,
            })
            buy_trade = None

    wins = [t for t in completed_trades if t["return"] > 0]
    losses = [t for t in completed_trades if t["return"] <= 0]
    n_completed = len(completed_trades)

    gross_profit = sum(t["gross_profit"] for t in wins) if wins else 0
    gross_loss = abs(sum(t["gross_profit"] for t in losses)) if losses else 0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf') if gross_profit > 0 else 0

    avg_win = sum(t["return"] for t in wins) / len(wins) * 100 if wins else 0
    avg_loss = sum(t["return"] for t in losses) / len(losses) * 100 if losses else 0
    payoff = abs(avg_win / avg_loss) if avg_loss != 0 else float('inf')

    # Consecutive wins/losses
    max_consec_w = max_consec_l = current_w = current_l = 0
    for t in completed_trades:
        if t["return"] > 0:
            current_w += 1
            current_l = 0
            max_consec_w = max(max_consec_w, current_w)
        else:
            current_l += 1
            current_w = 0
            max_consec_l = max(max_consec_l, current_l)

    # Time in market
    in_market_days = sum(t["holding_days"] for t in completed_trades)
    pct_in_market = in_market_days / max(n_days, 1)

    # Fees
    total_fees = sum(t.total_friction for t in trades)
    fees_pct = total_fees / gross_profit * 100 if gross_profit > 0 else 0

    # Benchmark comparison
    bench_values = [v for _, v in benchmark_values]
    bh_return = (bench_values[-1] - bench_values[0]) / bench_values[0] if bench_values and bench_values[0] > 0 else 0
    alpha_vs_bench = (total_return - bh_return) * 100

    return BacktestMetrics(
        total_return_pct=round(total_return * 100, 2),
        annualized_return_pct=round(annualized * 100, 2),
        buy_hold_return_pct=round(bh_return * 100, 2),
        sharpe_ratio=round(sharpe, 2),
        sortino_ratio=round(sortino, 2),
        calmar_ratio=round(calmar, 2),
        max_drawdown_pct=round(max_dd * 100, 2),
        max_drawdown_duration_days=max_dd_duration,
        volatility_annual_pct=round(std_r * math.sqrt(365) * 100, 2),
        downside_deviation=round(downside_dev, 6),
        total_trades=len(trades),
        winning_trades=len(wins),
        losing_trades=len(losses),
        win_rate_pct=round(len(wins) / max(n_completed, 1) * 100, 1),
        profit_factor=round(profit_factor, 2),
        avg_win_pct=round(avg_win, 2),
        avg_loss_pct=round(avg_loss, 2),
        payoff_ratio=round(payoff, 2),
        expectancy_per_trade=round(
            sum(t["gross_profit"] - t["fees"] for t in completed_trades) / max(n_completed, 1), 2
        ),
        max_consecutive_wins=max_consec_w,
        max_consecutive_losses=max_consec_l,
        avg_holding_period_days=round(
            sum(t["holding_days"] for t in completed_trades) / max(n_completed, 1), 1
        ),
        pct_time_in_market=round(pct_in_market * 100, 1),
        total_fees_paid=round(total_fees, 2),
        fees_as_pct_of_gross=round(fees_pct, 1),
        alpha_vs_benchmark_pct=round(alpha_vs_bench, 2),
        information_ratio=0.0,  # computed separately via calculate_alpha()
        beta=1.0,  # computed separately via calculate_alpha()
    )
```

### Metric Interpretation Guide for Pokemon Cards

| Metric | Good | Acceptable | Bad |
|--------|------|-----------|-----|
| Sharpe | > 1.5 | 0.5 - 1.5 | < 0.5 |
| Sortino | > 2.0 | 1.0 - 2.0 | < 1.0 |
| Calmar | > 1.0 | 0.3 - 1.0 | < 0.3 |
| Max Drawdown | < 15% | 15-30% | > 30% |
| Win Rate | > 60% | 50-60% | < 50% |
| Profit Factor | > 2.0 | 1.3-2.0 | < 1.3 |
| Payoff Ratio | > 2.0 | 1.0-2.0 | < 1.0 |
| Fees % of Gross | < 30% | 30-50% | > 50% |

Note: these thresholds are HIGHER than equity trading because collectibles carry additional risks (illiquidity, condition degradation, counterparty risk) that are not captured in the price series.

---

## 11. Handling Non-Continuous Pricing

### The Core Challenge

Card prices only update when a sale happens. Between sales, we do not know the "true" price. This creates several distortions:

1. **Stale indicators.** An RSI computed on 14 data points that span 90 calendar days is not the same as RSI computed on 14 consecutive daily closes.

2. **Phantom volatility.** If a card trades at $10, then nothing for 30 days, then at $12, the "daily return" appears to be 0% for 29 days and then 20% on day 30. In reality, the price may have drifted smoothly. Or it may have spiked to $15 and come back down. We cannot know.

3. **Time-weighted vs. observation-weighted indicators.** An SMA-7 of 7 consecutive daily closes is different from an SMA of the 7 most recent prices that span 45 days.

### Solutions

#### 11.1 Observation-Based vs. Calendar-Based Indicators

Compute indicators BOTH ways and compare:

```python
def observation_based_sma(prices: list[float], period: int) -> float | None:
    """SMA over the last N observations (current behavior)."""
    if len(prices) < period:
        return None
    return sum(prices[-period:]) / period

def calendar_based_sma(
    calendar_series: list[tuple[date, float, bool]],
    period_days: int,
    current_idx: int,
) -> float | None:
    """SMA over the last N calendar days (using forward-filled prices)."""
    target_date = calendar_series[current_idx][0] - timedelta(days=period_days)
    window = [
        price for d, price, _ in calendar_series[:current_idx + 1]
        if d >= target_date
    ]
    if not window:
        return None
    return sum(window) / len(window)
```

**Recommendation:** Use calendar-based indicators as the primary method. Observation-based indicators are biased toward cards that trade frequently (which tend to be liquid and trending -- exactly the bias you don't want in a mean-reversion strategy).

#### 11.2 Staleness Penalty

Discount signal strength based on data freshness:

```python
def staleness_discount(
    days_since_last_sale: int,
    base_signal_strength: float,
) -> float:
    """Reduce signal confidence when price data is stale.

    Half-life of 7 days: after 7 days with no sale, signal strength halved.
    After 14 days, quartered. After 30 days, ~6% of original.
    """
    half_life = 7.0
    discount = 0.5 ** (days_since_last_sale / half_life)
    return base_signal_strength * discount
```

#### 11.3 Volume-Weighted Price (When Available)

When multiple sales happen on the same day (from our `Sale` table), use the volume-weighted average price rather than the last sale:

```python
def vwap_for_date(sales: list[Sale]) -> float:
    """Volume-weighted average price from multiple same-day sales."""
    total_value = sum(s.purchase_price * (s.quantity or 1) for s in sales)
    total_quantity = sum(s.quantity or 1 for s in sales)
    return total_value / total_quantity if total_quantity > 0 else 0
```

---

## 12. Monte Carlo Simulation for Robustness

### Purpose

Monte Carlo simulation answers: "If the same strategy ran in slightly different market conditions, would it still work?" This is distinct from bootstrap testing (Section 7), which asks "Is the observed performance statistically significant?"

### Method 1: Trade Shuffling (Permutation Test)

Shuffle the order of completed trades to test whether returns depend on sequencing:

```python
import random
from dataclasses import dataclass

@dataclass
class MonteCarloResult:
    original_return: float
    simulated_returns: list[float]
    percentile_rank: float  # where original sits in simulated distribution
    p_value: float
    ci_5th: float
    ci_95th: float
    median_simulated: float
    worse_than_random_pct: float  # % of simulations that beat the original


def monte_carlo_trade_shuffle(
    trade_returns: list[float],
    initial_capital: float,
    n_simulations: int = 5000,
) -> MonteCarloResult:
    """Shuffle trade order to test path dependence.

    If the strategy's return is in the top 5% of shuffled returns,
    the ordering matters -- which is suspicious (may indicate look-ahead bias).
    If it's near the median, returns are order-independent (good).
    """
    def compound_returns(returns: list[float], capital: float) -> float:
        value = capital
        for r in returns:
            value *= (1 + r)
        return (value - capital) / capital * 100

    original = compound_returns(trade_returns, initial_capital)

    simulated = []
    for _ in range(n_simulations):
        shuffled = trade_returns.copy()
        random.shuffle(shuffled)
        simulated.append(compound_returns(shuffled, initial_capital))

    simulated.sort()
    rank = sum(1 for s in simulated if s <= original) / n_simulations

    return MonteCarloResult(
        original_return=round(original, 2),
        simulated_returns=simulated,
        percentile_rank=round(rank * 100, 1),
        p_value=round(1 - rank, 4),
        ci_5th=round(simulated[int(0.05 * n_simulations)], 2),
        ci_95th=round(simulated[int(0.95 * n_simulations)], 2),
        median_simulated=round(simulated[n_simulations // 2], 2),
        worse_than_random_pct=round((1 - rank) * 100, 1),
    )
```

### Method 2: Synthetic Price Path Generation

Generate synthetic price paths that preserve the statistical properties of real card prices, then run the strategy on each synthetic path.

```python
def generate_synthetic_paths(
    historical_prices: list[float],
    n_paths: int = 1000,
    path_length: int | None = None,
) -> list[list[float]]:
    """Generate synthetic price paths using block bootstrap.

    Block bootstrap preserves autocorrelation structure (unlike i.i.d. bootstrap).
    Block size = sqrt(n), a common heuristic.

    Each path starts at the same initial price and follows
    bootstrapped return blocks.
    """
    if len(historical_prices) < 10:
        return []

    # Compute log returns
    log_returns = [
        math.log(historical_prices[i] / historical_prices[i-1])
        for i in range(1, len(historical_prices))
        if historical_prices[i-1] > 0 and historical_prices[i] > 0
    ]

    if not log_returns:
        return []

    n = len(log_returns)
    block_size = max(3, int(math.sqrt(n)))
    target_length = path_length or n

    paths = []
    for _ in range(n_paths):
        path_returns = []
        while len(path_returns) < target_length:
            # Pick a random starting point for a block
            start = random.randint(0, n - block_size)
            block = log_returns[start:start + block_size]
            path_returns.extend(block)

        path_returns = path_returns[:target_length]

        # Convert back to prices
        path = [historical_prices[0]]
        for lr in path_returns:
            path.append(path[-1] * math.exp(lr))
        paths.append(path)

    return paths


def monte_carlo_synthetic_paths(
    historical_prices: list[float],
    strategy_fn,  # callable(prices) -> return_pct
    n_simulations: int = 1000,
) -> MonteCarloResult:
    """Run strategy on synthetic paths to test robustness.

    If the strategy works on > 60% of synthetic paths, it captures
    a real statistical edge. If < 40%, it's likely overfit to the
    specific historical sequence.
    """
    original_return = strategy_fn(historical_prices)
    paths = generate_synthetic_paths(historical_prices, n_simulations)

    simulated_returns = [strategy_fn(path) for path in paths]
    simulated_returns.sort()

    rank = sum(1 for s in simulated_returns if s <= original_return) / len(simulated_returns)
    profitable_pct = sum(1 for s in simulated_returns if s > 0) / len(simulated_returns) * 100

    return MonteCarloResult(
        original_return=round(original_return, 2),
        simulated_returns=simulated_returns,
        percentile_rank=round(rank * 100, 1),
        p_value=round(1 - rank, 4),
        ci_5th=round(simulated_returns[int(0.05 * len(simulated_returns))], 2),
        ci_95th=round(simulated_returns[int(0.95 * len(simulated_returns))], 2),
        median_simulated=round(simulated_returns[len(simulated_returns) // 2], 2),
        worse_than_random_pct=round((1 - rank) * 100, 1),
    )
```

### Interpreting Monte Carlo Results

| Percentile of Original in Simulated | Interpretation |
|--------------------------------------|----------------|
| > 95th | Suspiciously good -- check for look-ahead bias |
| 70th-95th | Strategy has a real edge |
| 40th-70th | Edge is marginal, could be noise |
| < 40th | Strategy underperforms random -- reject |

---

## 13. Concrete Implementation Plan

### File Structure

```
server/services/
  backtest_v2/
    __init__.py
    engine.py              # Walk-forward simulation engine
    indicators.py          # Point-in-time indicator computation
    slippage.py            # Slippage and price impact models
    fees.py                # Transaction cost models (wraps trading_economics.py)
    benchmark.py           # Synthetic benchmark construction
    metrics.py             # Full performance metric computation
    statistics.py          # Significance tests, bootstrap, Monte Carlo
    overfitting.py         # DSR, parameter stability, complexity penalty
    splits.py              # Walk-forward, expanding window, purged CV
    types.py               # Dataclasses: Trade, BacktestResult, Fold, etc.
```

### Integration with Existing Code

The new framework wraps (does not replace) existing code:
- Uses `_sma`, `_ema`, `_rsi`, `_macd`, `_bollinger_bands` from `market_analysis.py`.
- Uses `calc_sell_proceeds`, `calc_buy_cost`, `calc_breakeven_appreciation` from `trading_economics.py`.
- Uses `calculate_slippage` from `virtual_trader.py`.
- Reads from `PriceHistory` and `Sale` models.
- Existing `backtesting.py` strategies (`STRATEGIES` dict) become pluggable strategy functions.

### Backtest Engine API

```python
class BacktestEngine:
    """Main entry point for rigorous backtesting."""

    def __init__(
        self,
        db: Session,
        strategy_fn: Callable,
        fees_enabled: bool = True,
        slippage_enabled: bool = True,
        benchmark: str = "equal_weight",  # or "buy_hold", "risk_free"
    ):
        self.db = db
        self.strategy_fn = strategy_fn
        self.fees_enabled = fees_enabled
        self.slippage_enabled = slippage_enabled
        self.benchmark = benchmark

    def run_single_card(
        self,
        card_id: int,
        initial_capital: float = 1000.0,
    ) -> BacktestReport:
        """Full backtest on one card with all metrics and validation."""
        # 1. Load price history, build calendar series
        # 2. Build walk-forward folds
        # 3. For each fold:
        #    a. Compute indicators on training data (parameter optimization)
        #    b. Run strategy on test data with frozen params
        #    c. Apply slippage + fees on each trade
        #    d. Record trades, daily values
        # 4. Aggregate across folds
        # 5. Compute full metrics suite
        # 6. Run significance tests
        # 7. Run Monte Carlo
        # 8. Compute OOS degradation
        # 9. Return BacktestReport
        ...

    def run_portfolio(
        self,
        card_ids: list[int],
        initial_capital: float = 10000.0,
    ) -> PortfolioBacktestReport:
        """Run strategy across multiple cards with position sizing."""
        ...

    def run_strategy_comparison(
        self,
        card_ids: list[int],
        strategies: list[Callable],
        initial_capital: float = 10000.0,
    ) -> StrategyComparisonReport:
        """Compare multiple strategies with statistical tests."""
        # Run each strategy
        # Apply Holm-Bonferroni correction
        # Compute DSR for winning strategy
        # Report which strategies have genuine alpha
        ...


@dataclass
class BacktestReport:
    """Complete backtest output with validation."""
    # Core results
    metrics: BacktestMetrics
    trades: list[TradeExecution]
    daily_values: list[tuple[date, float]]

    # Validation
    significance: dict  # from bootstrap_strategy_significance
    monte_carlo: MonteCarloResult
    oos_degradation: dict
    parameter_stability: dict | None  # only if parameters were optimized

    # Warnings
    warnings: list[str]  # e.g., "Only 12 trades -- results not statistically significant"

    def is_valid(self) -> bool:
        """Quick check: should we trust these results?"""
        return (
            self.significance.get("significant", False) and
            self.oos_degradation.get("degradation_ratio", 0) > 0.3 and
            self.metrics.total_trades >= 20 and
            self.monte_carlo.percentile_rank < 95  # not suspiciously good
        )
```

### Strategy Function Interface

All strategies must conform to this interface for pluggability:

```python
from typing import Protocol

class TradingStrategy(Protocol):
    """Interface for backtest-compatible trading strategies."""

    @property
    def name(self) -> str:
        """Human-readable strategy name."""
        ...

    @property
    def n_parameters(self) -> int:
        """Number of tunable parameters (for overfitting checks)."""
        ...

    def generate_signal(
        self,
        prices_to_date: list[float],
        dates_to_date: list[date],
        current_position: str,  # "flat", "long"
        metadata: dict,  # liquidity_score, sales_per_day, etc.
    ) -> str | None:
        """Return "buy", "sell", or None.

        MUST use only prices_to_date (no future data).
        """
        ...
```

### Wrapping Existing Strategies

```python
class SMACrossoverStrategy:
    name = "SMA Crossover (7/30)"
    n_parameters = 2  # short_period, long_period

    def __init__(self, short: int = 7, long: int = 30):
        self.short = short
        self.long = long

    def generate_signal(self, prices_to_date, dates_to_date, current_position, metadata):
        indicators = _compute_indicators_at_point(prices_to_date)
        if len(prices_to_date) < 2:
            return None
        prev_indicators = _compute_indicators_at_point(prices_to_date[:-1])
        return _sma_crossover_signal(indicators, prev_indicators)
```

### API Route

```python
@router.post("/api/backtest/v2/{card_id}")
def run_v2_backtest(
    card_id: int,
    strategy: str = "combined",
    fees: bool = True,
    slippage: bool = True,
    monte_carlo: bool = True,
    n_simulations: int = 1000,
    db: Session = Depends(get_db),
):
    engine = BacktestEngine(db, strategy_fn=STRATEGIES_V2[strategy], fees_enabled=fees, slippage_enabled=slippage)
    report = engine.run_single_card(card_id)
    return {
        "metrics": asdict(report.metrics),
        "trades": [asdict(t) for t in report.trades],
        "validation": {
            "is_valid": report.is_valid(),
            "significance": report.significance,
            "monte_carlo": {
                "percentile_rank": report.monte_carlo.percentile_rank,
                "ci_5th": report.monte_carlo.ci_5th,
                "ci_95th": report.monte_carlo.ci_95th,
            },
            "oos_degradation": report.oos_degradation,
        },
        "warnings": report.warnings,
    }
```

---

## Implementation Priority

| Phase | Components | Why |
|-------|-----------|-----|
| 1 | `types.py`, `fees.py`, `slippage.py` | Foundation -- trade execution with realistic friction |
| 2 | `indicators.py`, `engine.py` | Core walk-forward engine with look-ahead bias prevention |
| 3 | `metrics.py` | Full performance measurement (Sharpe, Sortino, Calmar, etc.) |
| 4 | `benchmark.py` | Synthetic index for alpha measurement |
| 5 | `splits.py`, `overfitting.py` | Walk-forward validation, parameter stability |
| 6 | `statistics.py` | Bootstrap significance, Monte Carlo, DSR |
| 7 | API route + frontend visualization | Expose to users |

### Dependencies

- Phase 1 has no dependencies.
- Phase 2 depends on Phase 1.
- Phases 3-6 depend on Phase 2 but are independent of each other.
- Phase 7 depends on all prior phases.

Estimated implementation: ~2000 lines of Python (excluding tests). Each phase is independently deployable and testable.
