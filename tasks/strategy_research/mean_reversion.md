# Mean Reversion Trading Strategy for Pokemon Cards

## 1. Why Mean Reversion Works for Cards

Pokemon cards have a property that most equities lack: a **collector demand floor**. A company can go bankrupt and its stock goes to zero. A Charizard from Base Set will never be worth zero because there will always be collectors who want it. This floor creates a natural anchor around which prices oscillate.

Mean reversion works in this market because of three structural forces:

**Overshoot (hype-driven):** A YouTuber opens a pack on camera, a card trends on social media, or a new tournament meta makes a card relevant. Price spikes 30-80% in days. But the new buyers are speculators, not collectors. Within 2-6 weeks, they list their copies to take profit, supply floods the market, and undercutting drives the price back toward its pre-hype level. The card's "fair value" (anchored by steady collector demand) hasn't changed -- only the transient speculative premium has.

**Undershoot (liquidation-driven):** Someone needs cash and dumps 50 copies of a $15 card at $9 on TCGPlayer. The market price drops because TCGPlayer's "market price" tracks recent sales. But the underlying collector demand hasn't changed. Within 1-4 weeks, value buyers absorb the cheap supply and the price recovers. This is especially reliable for cards with steady sales velocity (>0.3/day).

**Why this differs from stocks:** In equities, a price drop can reflect genuine fundamental deterioration (earnings miss, sector rotation, bankruptcy risk). In cards, there are no "earnings." The fundamental value is collector sentiment + playability + scarcity, which change slowly. A 25% price drop on a card with stable sales velocity is almost always a supply/demand transient, not a fundamental shift.

**When mean reversion fails for cards:**
- Rotation out of tournament legality (playability floor disappears)
- Reprint announcements (scarcity floor disappears)
- Long-term fad decay (e.g., a set that was hyped but nobody actually wants to collect)
- Cards with < 0.1 sales/day (too illiquid for prices to mean-revert -- they just drift)


## 2. Identifying Mean-Reverting Cards vs Trending Cards

Not every card mean-reverts. Some cards are in secular uptrends (vintage staples appreciating 10-20%/year) or downtrends (bulk modern cards losing value as supply increases). We need to classify cards before applying any strategy.

### Hurst Exponent

The Hurst exponent (H) measures long-range dependence in a time series:
- **H < 0.5**: Mean-reverting (past ups predict future downs, and vice versa)
- **H = 0.5**: Random walk (no predictability)
- **H > 0.5**: Trending (past ups predict future ups)

For card data, **H < 0.4 is a strong mean reversion candidate** and **H > 0.6 should use trend-following**.

```python
import numpy as np

def hurst_exponent(prices: list[float], max_lag: int = 20) -> float | None:
    """Compute Hurst exponent using rescaled range (R/S) method.

    Args:
        prices: Price series (at least 30 data points)
        max_lag: Maximum lag for R/S calculation

    Returns:
        Hurst exponent (0-1), or None if insufficient data
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
        # Split series into chunks of size `lag`
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

    # Linear regression of log(R/S) on log(lag) -> slope = H
    log_lags = np.log(lag_values)
    log_rs = np.log(rs_values)

    # OLS slope
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

### Half-Life (Already Implemented)

The codebase already computes Ornstein-Uhlenbeck half-life in `market_analysis.py::_half_life()`. This is complementary to Hurst:
- **Half-life < 15 days**: Strong mean reversion (price snaps back fast)
- **Half-life 15-60 days**: Moderate mean reversion (tradeable but slower)
- **Half-life > 60 days**: Trending behavior, skip mean reversion

### ADX Filter (Already Implemented)

The ADX indicator in `market_analysis.py::_adx()` measures trend strength:
- **ADX < 20**: Ranging/mean-reverting market -- good for mean reversion
- **ADX 20-25**: Transitional
- **ADX > 25**: Trending -- use trend-following instead

### Classification Decision Tree

```
Card Classification:
  1. Compute Hurst exponent on 52-week rolling window
  2. Compute OU half-life
  3. Compute ADX

  IF Hurst < 0.4 AND half_life < 60 AND ADX < 25:
      -> STRONG MEAN REVERSION candidate
  ELIF Hurst < 0.5 AND half_life < 90:
      -> MODERATE MEAN REVERSION candidate (widen thresholds)
  ELIF Hurst > 0.6 AND ADX > 25:
      -> TREND FOLLOWING candidate (use momentum/breakout strategies)
  ELSE:
      -> MIXED/UNCLEAR -- reduce position size or skip
```


## 3. Entry Signals for Mean Reversion

### Z-Score Approach

The z-score measures how many standard deviations the current price is from its rolling mean. This is the cleanest entry signal for mean reversion.

```python
def compute_z_score(
    prices: list[float],
    lookback: int = 90,
) -> float | None:
    """Z-score of current price vs rolling mean.

    z = (current_price - mean) / std_dev

    Negative z = price below mean (potential buy)
    Positive z = price above mean (potential sell)
    """
    if len(prices) < lookback:
        return None

    window = prices[-lookback:]
    mean = sum(window) / len(window)
    variance = sum((p - mean) ** 2 for p in window) / (len(window) - 1)
    std = variance ** 0.5

    if std == 0:
        return 0.0

    return (prices[-1] - mean) / std
```

### Entry Thresholds

| Liquidity Tier | Sales/Day | Buy Z-Score | Sell Z-Score | Rationale |
|---|---|---|---|---|
| High | > 1.0 | < -1.2 | > 1.2 | Tight thresholds OK -- price reverts fast due to active market |
| Medium | 0.3 - 1.0 | < -1.5 | > 1.5 | Standard thresholds |
| Low | 0.1 - 0.3 | < -2.0 | > 2.0 | Wide thresholds -- need bigger dislocation to justify illiquidity risk |
| Very Low | < 0.1 | Skip | Skip | Don't trade -- price can stay dislocated indefinitely |

The liquidity adjustment is critical. In equities, you can exit any time. In cards, if a card sells 0.1x/day, it takes 10+ days to find a buyer. You need a bigger dislocation to compensate for that exit risk.

### Confirmation Filters

A z-score below -1.5 alone is not enough. Require at least one confirmation:

1. **Sales velocity stable or increasing**: If velocity dropped alongside price, the card may be losing demand (not mean-reverting, genuinely declining). Check that `sales_per_day` is >= 50% of its 90-day average.

2. **No fundamental catalyst**: Exclude cards that dropped because of reprint announcements or rotation. This requires manual screening or a news feed (not currently implemented).

3. **RSI below 35**: Confirms oversold condition from a momentum perspective. Already implemented in `_check_rsi_oversold()`.

4. **Half-life < 60 days**: Confirms the card historically mean-reverts at a tradeable pace.

### Comparison to Current Implementation

The existing `_check_mean_reversion()` in `prop_strategies.py` uses a simpler approach:
- Entry: price dropped > 20% from 30-day high
- Confirmation: sales velocity > 0.1/day

This is a reasonable first pass but has weaknesses:
- **No standard deviation normalization**: A 20% drop on a card with 25% monthly volatility is nothing. A 20% drop on a card with 5% monthly volatility is 4 sigma. The z-score approach fixes this.
- **30-day high is noisy**: The 30-day high could itself be an outlier. Using a rolling mean (60-90 day) as the anchor is more robust.
- **No classification step**: It applies mean reversion to all cards, including trending ones where the "drop" is just the trend continuing.

### Proposed Upgrade to `_check_mean_reversion()`

```python
def _check_mean_reversion_v2(td: dict) -> Optional[dict]:
    """BUY: Z-score entry with liquidity-adjusted thresholds."""
    prices = td.get("prices", [])
    price = td.get("current_price", 0)
    velocity = td.get("sales_per_day", 0)
    adx = td.get("adx")

    if len(prices) < 30:
        return None
    if velocity < 0.1:
        return None

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

    # Liquidity-adjusted threshold
    if velocity > 1.0:
        z_threshold = -1.2
    elif velocity > 0.3:
        z_threshold = -1.5
    else:
        z_threshold = -2.0

    if z >= z_threshold:
        return None  # Not enough dislocation

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
            f"Price ${price:.2f} vs 60d mean ${mean_price:.2f}",
            f"Velocity: {velocity:.1f}/day",
            f"ADX: {adx:.0f}" if adx else "ADX: N/A",
        ],
        "entry_price": price,
        "target_price": round(target, 2),
        "stop_loss": round(max(stop, price * 0.80), 2),
    }
```


## 4. Bollinger Band Adaptation for Weekly Card Data

### Problem with Standard Parameters

The standard Bollinger Band setup (20-period, 2 std devs) is designed for daily equity data where each data point is one trading day. Pokemon card price data has different characteristics:

- **Irregular frequency**: Price updates come from syncs every 6-12 hours, but meaningful price changes happen weekly at best (low transaction volume)
- **Fat tails**: Card prices have occasional 50-100% spikes (hype events) that blow out standard deviation calculations
- **No continuous market**: Unlike stocks, there's no continuous price discovery. Prices jump between discrete transaction events.

### Recommended Parameters for Card Data

| Parameter | Standard (Equities) | Recommended (Cards) | Rationale |
|---|---|---|---|
| Period | 20 | 14 | Cards have fewer meaningful data points. 20 periods of weekly data = 5 months, which is too long for modern cards. 14 ~= 3.5 months, better for capturing current regime. |
| Std Dev Multiplier | 2.0 | 1.8 | Card prices don't follow normal distributions well. Lower multiplier catches more reversions without too many false signals. |
| Bandwidth Filter | N/A | < 0.15 = skip | When bandwidth (band_width = (upper - lower) / middle) is very narrow, the card is in a tight range and there's no volatility to trade. Skip these. |

### Bandwidth as a Regime Filter

Bollinger Bandwidth tells you whether mean reversion is likely to work *right now* for a given card:

```python
def bollinger_bandwidth(upper: float, lower: float, middle: float) -> float | None:
    """Bandwidth = (upper - lower) / middle.

    < 0.15  -> Squeeze (low vol, mean reversion less profitable)
    0.15-0.40 -> Normal range (mean reversion sweet spot)
    > 0.40  -> Expansion (high vol, possible trend breakout -- caution)
    """
    if middle is None or middle <= 0:
        return None
    return (upper - lower) / middle
```

**Trading rules by bandwidth:**
- **Bandwidth < 0.15 (squeeze)**: Skip. The bands are too tight -- even touching the lower band doesn't represent a meaningful dislocation. Wait for bandwidth to expand.
- **Bandwidth 0.15 - 0.40 (normal)**: Ideal for mean reversion. Buy at lower band, target middle band.
- **Bandwidth > 0.40 (expansion)**: Cautious. High volatility could mean trending behavior. Only trade mean reversion if ADX < 20 (confirming range-bound despite wide bands).

### %B Indicator for Entry Timing

%B measures where the price sits within the Bollinger Bands (0 = lower band, 1 = upper band):

```python
def percent_b(price: float, upper: float, lower: float) -> float | None:
    """Where price sits in the Bollinger Band range.

    < 0.0  -> Below lower band (extreme oversold)
    0.0-0.2 -> Near lower band (oversold)
    0.2-0.8 -> Middle zone (neutral)
    0.8-1.0 -> Near upper band (overbought)
    > 1.0  -> Above upper band (extreme overbought)
    """
    band_range = upper - lower
    if band_range <= 0:
        return None
    return (price - lower) / band_range
```

**Mean reversion entries:** Buy when %B < 0.10 AND bandwidth is 0.15-0.40.
**Mean reversion exits:** Sell when %B > 0.50 (price returned to middle band) or %B > 0.90 (overbought).


## 5. Pairs Trading for Cards

Pairs trading exploits the relationship between two correlated assets. When the spread between them widens beyond its historical norm, you go long the underperformer and short the outperformer, betting on convergence.

### Practical Constraint: No Short Selling

In the physical card market, you can't short a card. This limits pairs trading to **relative value allocation**:
- When Card A is cheap relative to Card B, buy Card A (and optionally sell Card B if you own it)
- This is a long-only pairs strategy

### Natural Pairs in Pokemon Cards

**Same Pokemon, Different Sets (strongest pairs):**
- Charizard ex (Obsidian Flames) vs Charizard VMAX (Champions Path)
- Pikachu VMAX (Vivid Voltage) vs Pikachu V (Sword & Shield base)
- Mewtwo GX (Shining Legends) vs Mewtwo V (Pokemon GO)

These pairs work because collector demand for a specific Pokemon creates a correlation floor. If Charizard demand rises, ALL Charizard cards benefit (though not equally).

**Same Set, Same Rarity (moderate pairs):**
- Cards from the same set and rarity tier tend to move together because they share the same supply dynamics (pack opening rates, print runs).

### Identifying Cointegrated Pairs

Two time series are cointegrated if a linear combination of them is stationary (mean-reverting). This is stronger than correlation -- correlated series can drift apart permanently, cointegrated series cannot.

```python
def engle_granger_cointegration(
    prices_a: list[float],
    prices_b: list[float],
    significance: float = 0.05,
) -> dict:
    """Test two price series for cointegration using Engle-Granger method.

    Steps:
    1. Regress prices_a on prices_b to find the hedge ratio
    2. Compute the residual (spread)
    3. Test residual for stationarity (ADF test)

    Returns:
        hedge_ratio: float (how many units of B to pair with 1 unit of A)
        spread_mean: float
        spread_std: float
        is_cointegrated: bool
        half_life: float (of the spread)
    """
    import numpy as np

    if len(prices_a) != len(prices_b) or len(prices_a) < 30:
        return {"is_cointegrated": False}

    a = np.array(prices_a)
    b = np.array(prices_b)

    # Step 1: OLS regression -- a = beta * b + alpha + residual
    mean_b = np.mean(b)
    mean_a = np.mean(a)
    cov_ab = np.mean((a - mean_a) * (b - mean_b))
    var_b = np.mean((b - mean_b) ** 2)

    if var_b == 0:
        return {"is_cointegrated": False}

    beta = cov_ab / var_b  # hedge ratio
    alpha = mean_a - beta * mean_b

    # Step 2: Compute spread (residual)
    spread = a - beta * b - alpha

    # Step 3: ADF test on spread (simplified)
    # Test: delta_spread = lambda * spread_lag + error
    # If lambda < 0 and significant, spread is stationary -> cointegrated
    delta = np.diff(spread)
    lagged = spread[:-1]

    mean_lag = np.mean(lagged)
    mean_delta = np.mean(delta)
    cov = np.mean((lagged - mean_lag) * (delta - mean_delta))
    var_lag = np.mean((lagged - mean_lag) ** 2)

    if var_lag == 0:
        return {"is_cointegrated": False}

    lam = cov / var_lag

    # Approximate ADF critical value at 5% for n=50-100: roughly -2.9
    # Compute t-statistic for lambda
    residuals = delta - lam * lagged - (mean_delta - lam * mean_lag)
    sse = np.sum(residuals ** 2)
    se_lam = np.sqrt(sse / (len(delta) - 2) / (np.sum((lagged - mean_lag) ** 2)))

    if se_lam == 0:
        return {"is_cointegrated": False}

    t_stat = lam / se_lam
    is_coint = t_stat < -2.9 and lam < 0  # Simplified 5% critical value

    # Half-life of spread mean reversion
    hl = -np.log(2) / lam if lam < 0 else None

    return {
        "hedge_ratio": float(beta),
        "spread_mean": float(np.mean(spread)),
        "spread_std": float(np.std(spread)),
        "is_cointegrated": is_coint,
        "half_life": float(hl) if hl else None,
        "t_statistic": float(t_stat),
        "current_spread": float(spread[-1]),
        "current_z": float((spread[-1] - np.mean(spread)) / np.std(spread)) if np.std(spread) > 0 else 0,
    }
```

### Pairs Trading Signals

Once a cointegrated pair is identified:

```
Spread Z-Score = (current_spread - mean_spread) / std_spread

BUY Card A (sell Card B if held):
  spread_z < -1.5  (A is cheap relative to B)

SELL Card A (buy Card B):
  spread_z > 1.5   (A is expensive relative to B)

EXIT:
  spread_z returns to [-0.5, 0.5] range (convergence achieved)
```

### Finding Candidate Pairs from the Database

```python
def find_pair_candidates(db: Session) -> list[tuple[int, int, str]]:
    """Find candidate card pairs for pairs trading.

    Strategy:
    1. Group cards by Pokemon name (same character, different sets)
    2. For each group with 2+ cards, test pairwise cointegration
    3. Return pairs that pass the cointegration test
    """
    from sqlalchemy import func
    from server.models.card import Card

    # Find Pokemon names that appear in multiple sets with price data
    groups = (
        db.query(Card.name, func.count(Card.id))
        .filter(
            Card.is_tracked == True,
            Card.current_price.isnot(None),
            Card.current_price >= 5.0,
        )
        .group_by(Card.name)
        .having(func.count(Card.id) >= 2)
        .all()
    )

    candidates = []
    for name, count in groups:
        cards = (
            db.query(Card)
            .filter(Card.name == name, Card.is_tracked == True)
            .all()
        )
        # Test all pairwise combinations
        for i in range(len(cards)):
            for j in range(i + 1, len(cards)):
                candidates.append((
                    cards[i].id,
                    cards[j].id,
                    f"{name} ({cards[i].set_name} vs {cards[j].set_name})",
                ))

    return candidates
```


## 6. Practical Implementation Details

### Optimal Lookback Windows

| Card Category | Z-Score Lookback | Bollinger Period | Hurst Window | Rationale |
|---|---|---|---|---|
| Modern (< 2 years old) | 60 days | 14 | 90 days | Modern cards have faster cycles: hype spikes and fades in weeks. Shorter windows capture current regime. |
| Mid-era (2-10 years) | 90 days | 20 | 180 days | More stable pricing, seasonal patterns (holiday spikes). Standard parameters work. |
| Vintage (10+ years) | 180 days | 30 | 365 days | Very slow mean reversion. Prices drift over months. Need long lookbacks to establish meaningful mean. |

### Determining Card Category

```python
from datetime import date

def get_card_era(release_date: date | None) -> str:
    """Classify card by era for parameter selection."""
    if release_date is None:
        return "modern"  # Default to modern (shorter lookbacks are safer)

    age_years = (date.today() - release_date).days / 365.25

    if age_years < 2:
        return "modern"
    elif age_years < 10:
        return "mid_era"
    else:
        return "vintage"

LOOKBACK_PARAMS = {
    "modern":  {"z_lookback": 60,  "bb_period": 14, "hurst_window": 90},
    "mid_era": {"z_lookback": 90,  "bb_period": 20, "hurst_window": 180},
    "vintage": {"z_lookback": 180, "bb_period": 30, "hurst_window": 365},
}
```

### Position Sizing Based on Z-Score Magnitude

The existing `calculate_position_size()` in `prop_strategies.py` uses signal strength for Kelly-inspired sizing. For mean reversion specifically, position size should scale with z-score depth:

```python
def mean_reversion_position_size(
    portfolio_value: float,
    cash: float,
    card_price: float,
    z_score: float,
    velocity: float,
    max_pct: float = 0.08,
) -> int:
    """Position sizing for mean reversion trades.

    Deeper z-scores get larger positions (higher expected return).
    But scale down for low-velocity cards (harder to exit).

    Sizing tiers:
      z < -1.5: 50% of max allocation
      z < -2.0: 75% of max allocation
      z < -2.5: 100% of max allocation
    """
    if card_price <= 0 or portfolio_value <= 0:
        return 0

    # Base allocation as fraction of max
    if z_score <= -2.5:
        alloc_fraction = 1.0
    elif z_score <= -2.0:
        alloc_fraction = 0.75
    elif z_score <= -1.5:
        alloc_fraction = 0.50
    else:
        return 0  # Not enough dislocation

    # Liquidity discount
    if velocity < 0.3:
        alloc_fraction *= 0.5  # Half size for illiquid cards
    elif velocity < 0.5:
        alloc_fraction *= 0.7

    # Max dollar allocation
    max_dollars = portfolio_value * max_pct * alloc_fraction
    available = cash - (portfolio_value * 0.20)  # Respect 20% cash reserve
    dollars = min(max_dollars, available)

    if dollars <= 0:
        return 0

    # Convert to quantity
    qty = int(dollars / card_price)

    # Cap by price tier
    if card_price > 100:
        qty = min(qty, 1)
    elif card_price > 20:
        qty = min(qty, 2)
    else:
        qty = min(qty, 4)

    return qty
```

### Complete Mean Reversion Trade Lifecycle

```
1. CLASSIFY: Compute Hurst, half-life, ADX -> confirm card is mean-reverting
2. MONITOR:  Compute z-score daily after each price sync
3. ENTRY:    z < threshold (adjusted for liquidity) + velocity confirmation
4. SIZE:     Position sized by z-score depth and liquidity
5. HOLD:     Monitor z-score. If z drops further (> 1 std below entry z),
             either add to position or tighten stop.
6. TARGET:   z returns to 0 (price at rolling mean) = take profit
7. STOP:     z drops to -3.5 (3.5 std devs below mean) OR price drops 20%
             from entry OR velocity drops below 0.05/day (liquidity death)
8. TIME:     If held > 2x half-life days without reversion, exit at market.
             Mean reversion that doesn't revert in 2x half-life is broken.
```


## 7. Backtest Expectations

### Expected Performance Metrics

Based on mean reversion strategies in low-liquidity collectibles markets (sports cards, rare coins, wine), and adjusting for Pokemon card market structure:

| Metric | Modern Cards | Vintage Cards | Notes |
|---|---|---|---|
| **Win Rate** | 58-65% | 55-60% | Modern reverts faster and more reliably. Vintage can drift longer. |
| **Avg Win** | +18-25% | +15-20% | Reversion to mean from 1.5-2.0 std devs below. |
| **Avg Loss** | -12-18% | -15-22% | Stop-loss triggered. Wider stops for vintage due to slower dynamics. |
| **Avg Hold (win)** | 2-4 weeks | 2-4 months | Modern market corrects faster due to higher transaction frequency. |
| **Avg Hold (loss)** | 1-2 weeks | 1-3 months | Stop-losses hit faster than target (asymmetric -- this is by design). |
| **Profit Factor** | 1.3-1.6 | 1.1-1.4 | (Total wins / Total losses). > 1.0 is profitable. |
| **Sharpe Ratio** | 0.5-1.0 | 0.3-0.7 | Annualized. Lower than equities due to transaction frequency. |
| **Max Drawdown** | 15-25% | 20-35% | Correlated drawdowns when entire market sells off (macro events). |

### Fee Impact Analysis

TCGPlayer fees are the biggest enemy of mean reversion in cards:

```
Seller fees:   ~12.75% (10.25% seller fee + 2.5% payment processing)
Buyer cost:    Market price + shipping (~$1-4)

Round-trip cost for a $20 card:
  Buy:  $20.00 + $1.50 shipping = $21.50
  Sell:  At $24.00 -> receive $24.00 * 0.8725 = $20.94
  Net:   $20.94 - $21.50 = -$0.56 (LOSS despite 20% price increase)

  Sell:  At $26.00 -> receive $26.00 * 0.8725 = $22.69
  Net:   $22.69 - $21.50 = +$1.19 (profit requires 30% move)

Breakeven appreciation by card price:
  $5 card:   ~45% (fees + shipping destroy small-card economics)
  $10 card:  ~28%
  $20 card:  ~20%
  $50 card:  ~17%
  $100 card: ~15.5%
  $200 card: ~14.5%
```

This means mean reversion is only viable for cards where:
1. **Price >= $10** (below this, fees eat all profit)
2. **Expected reversion >= 20%** (z-score < -1.5 std devs with reasonable volatility)
3. **The z-score corresponds to an absolute dollar move that exceeds fees**

### Minimum Z-Score by Card Price (Fee-Adjusted)

| Card Price | Min Z-Score | Required Reversion % | Rationale |
|---|---|---|---|
| $5-10 | Not tradeable | 28-45% | Fees too high. Only trade if extremely confident (z < -3.0). |
| $10-20 | -2.0 | 20-28% | Need deep dislocation to clear fees. |
| $20-50 | -1.5 | 17-20% | Sweet spot for mean reversion. Fees manageable, enough liquidity. |
| $50-100 | -1.3 | 15.5-17% | Good economics. Even moderate dislocations are tradeable. |
| $100+ | -1.2 | 14.5-15.5% | Best fee economics, but lower liquidity and higher per-card risk. |

### Key Risk: Correlated Drawdowns

The biggest risk for a mean reversion card portfolio is not individual card losses -- it's correlated drawdowns. When the broader Pokemon market sells off (macro events, economic downturn, Pokemon fatigue), ALL cards drop simultaneously. Your portfolio of "oversold" cards gets more oversold, and half-lives extend because buyer demand drops across the board.

**Mitigation:**
- Keep 20% cash reserve (already in `prop_strategies.py`)
- Diversify across sets and eras
- Reduce position sizes when multiple cards trigger simultaneously (correlated selling event)
- Track a "market z-score" (average z-score across all tracked cards). If market z < -1.0, reduce new entries by 50% -- the market is in a broad selloff and individual card mean reversion signals are less reliable.
