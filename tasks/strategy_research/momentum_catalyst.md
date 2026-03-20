# Momentum & Catalyst Trading Strategy for Pokemon Cards

## Current State

The existing `prop_strategies.py` has a basic momentum check (`_check_momentum`) that uses:
- `investment_score > 75`
- `appreciation_slope > 0.1`
- `regime == "markup"`

This is backward-looking. It catches trends already in progress but misses the **leading indicators** that predict price moves before they happen. The Sale model tracks individual completed sales with `order_date`, `purchase_price`, `quantity`, `condition`, and `variant` -- giving us the raw data to compute velocity-based signals.

---

## 1. Velocity-Based Momentum Detection

The single most reliable leading indicator for card price increases is a **spike in sales velocity**. When a card suddenly starts selling 3-5x its normal rate, something is driving demand. This velocity spike typically **precedes price increases by 1-2 weeks** because:

- Informed buyers (dealers, flippers) act on catalysts before prices adjust
- TCGPlayer market prices lag actual transaction volume
- Sellers don't raise listings until they notice inventory depleting

### Formula

```
avg_sales_7d = count(sales in last 7 days) / 7
avg_sales_7d_over_90d = mean of weekly sales rates over last 90 days
std_sales_7d_over_90d = stdev of weekly sales rates over last 90 days

velocity_zscore = (avg_sales_7d - avg_sales_7d_over_90d) / std_sales_7d_over_90d
```

### Implementation

Query the `sales` table grouped by 7-day windows over 90 days to build a distribution:

```python
def calc_velocity_zscore(db: Session, card_id: int) -> tuple[float, float, float]:
    """Returns (zscore, current_velocity, baseline_velocity)."""
    now = datetime.now(timezone.utc)

    # Get weekly sales counts for last 13 weeks (91 days)
    weekly_counts = []
    for week_offset in range(13):
        week_end = now - timedelta(days=week_offset * 7)
        week_start = week_end - timedelta(days=7)
        count = db.query(func.count(Sale.id)).filter(
            Sale.card_id == card_id,
            Sale.order_date >= week_start,
            Sale.order_date < week_end,
        ).scalar() or 0
        weekly_counts.append(count / 7.0)  # sales per day

    current_velocity = weekly_counts[0]  # most recent week
    historical = weekly_counts[1:]  # prior 12 weeks

    if len(historical) < 4:
        return 0.0, current_velocity, 0.0

    baseline = statistics.mean(historical)
    stdev = statistics.stdev(historical) if len(historical) > 1 else 0.01
    stdev = max(stdev, 0.01)  # prevent division by zero

    zscore = (current_velocity - baseline) / stdev
    return zscore, current_velocity, baseline
```

### Signal Thresholds

| Z-Score | Interpretation | Action |
|---------|---------------|--------|
| > 3.0 | Extreme velocity spike | Strong buy if price hasn't moved yet |
| 2.0 - 3.0 | Significant velocity increase | Buy signal, watch for price confirmation |
| 1.0 - 2.0 | Moderate uptick | Watchlist, wait for confirmation |
| -1.0 to 1.0 | Normal range | No signal |
| < -2.0 | Velocity collapse | Sell signal if holding |

### Critical Filter: Price Hasn't Already Spiked

The velocity signal is only actionable if the price hasn't already responded. Calculate `price_change_7d`:

```
price_change_7d = (current_price - price_7d_ago) / price_7d_ago
```

- If `velocity_zscore > 2.0` AND `price_change_7d < 10%` --> BUY (you're early)
- If `velocity_zscore > 2.0` AND `price_change_7d > 30%` --> TOO LATE (skip)
- If `velocity_zscore > 2.0` AND `10% < price_change_7d < 30%` --> CAUTIOUS BUY (partially priced in)

---

## 2. Spread Compression as Signal

The existing `_check_spread_compression` looks at a static spread snapshot. A more powerful signal is the **rate of change** of the spread.

### What Spread Compression Means

- **Spread narrowing rapidly** = price discovery happening, buyers and sellers converging
- **Sellers lowering ask prices** = inventory pressure, motivated sellers
- **Buyers raising bids** = demand increasing, buyers competing

### Formula

```
spread_7d_ago = abs(market_price_7d_ago - mid_price_7d_ago) / mid_price_7d_ago
spread_now = abs(market_price_now - mid_price_now) / mid_price_now
spread_compression_rate = (spread_7d_ago - spread_now) / spread_7d_ago
```

### Signal Rules

| Compression Rate | + Velocity | Signal |
|-----------------|------------|--------|
| > 50% in 7 days | Rising | Strong buy -- market is tightening with demand |
| > 50% in 7 days | Flat | Investigate -- sellers competing, potential price drop |
| > 30% in 7 days | Rising | Moderate buy |
| Spread widening | Any | Avoid -- uncertainty, low confidence in fair price |

### Implementation Notes

This requires storing spread snapshots over time. Options:
1. Compute from `PriceHistory` records (already have `market_price` and `mid_price`)
2. Add a `spread_history` cache if performance is a concern

---

## 3. Volume-Price Divergence

This is the most underutilized signal in Pokemon card trading. Traditional stock market analysis applies directly.

### The Four Quadrants

```
                    PRICE UP              PRICE DOWN
                 +-----------------+------------------+
 VOLUME UP       | CONFIRMED       | CAPITULATION     |
                 | MOMENTUM        | (panic selling)  |
                 | --> Ride it     | --> Watch for     |
                 |                 |    reversal       |
                 +-----------------+------------------+
 VOLUME DOWN     | DISTRIBUTION    | APATHY           |
                 | (smart money    | (nobody cares)   |
                 | exiting)        |                  |
                 | --> Exit soon   | --> Ignore       |
                 +-----------------+------------------+
```

### Detailed Interpretation

**Accumulation (Volume Up + Price Flat):**
- The most profitable setup. Smart money is buying before the price moves.
- Sales velocity up 2x+ but price hasn't budged.
- Action: Buy aggressively. You have 1-2 weeks before the price follows.

**Confirmed Momentum (Volume Up + Price Up):**
- The trend is real and supported by actual demand.
- Action: Hold or add to position. Trail a stop-loss.

**Distribution (Volume Down + Price Up):**
- Price is rising on declining interest. This is unsustainable.
- Remaining sellers are raising prices but fewer buyers are biting.
- Action: Start exiting. The price increase won't hold.

**Capitulation (Volume Down + Price Down):**
- Everyone is giving up. Often precedes a bottom.
- Action: Watch for velocity to tick up again (reversal signal).

### Formula

```python
def classify_volume_price(
    velocity_change_pct: float,  # % change in sales/day vs 30d avg
    price_change_pct: float,     # % change in price over same period
) -> str:
    if velocity_change_pct > 20 and price_change_pct < 5:
        return "ACCUMULATION"     # Best buy signal
    elif velocity_change_pct > 20 and price_change_pct > 5:
        return "CONFIRMED_MOMENTUM"  # Hold/ride
    elif velocity_change_pct < -20 and price_change_pct > 5:
        return "DISTRIBUTION"     # Exit signal
    elif velocity_change_pct < -20 and price_change_pct < -5:
        return "CAPITULATION"     # Watch for reversal
    else:
        return "NEUTRAL"
```

---

## 4. Catalyst Calendar

Pokemon card prices don't move randomly. They respond to predictable events. A catalyst-aware system can front-run these moves.

### Recurring Annual Events

| Event | Typical Dates | Price Impact | What Moves |
|-------|--------------|-------------|------------|
| New Set Release | Q1, Q2, Q3, Q4 (roughly quarterly) | Chase cards from new set spike then settle. Staples from older sets sometimes drop as attention shifts. | New set chase cards, sometimes older staples |
| Pokemon Day | February 27 | Nostalgia surge, 10-20% bump on iconic cards for 2-3 weeks | Base Set, vintage holos, Charizard variants |
| World Championships | August | Competitive staple cards spike 30-50% in weeks before, crash after | Tournament-legal trainers and meta Pokemon |
| Holiday Season | November - December | Broad 10-15% increase from gift buying. Sealed product drives singles demand. | Everything, especially $10-$50 range gift-friendly cards |
| Back to School | August - September | Kids re-engage, casual demand rises | Modern sets, affordable cards under $20 |
| Tax Refund Season | February - April | Collectors buy graded/premium cards | High-end singles $100+ |

### Non-Recurring Catalysts (Monitor Externally)

| Catalyst | Lead Time | Typical Impact |
|----------|-----------|---------------|
| Major YouTuber opening video | 0-48 hours | Featured cards can spike 50-200% within days |
| New game/anime announcement | Days to weeks | Cards featuring announced Pokemon see sustained interest |
| PSA/CGC submission events | Weeks | Raw copies spike as people buy to grade |
| Tournament results | 0-7 days | Winning deck cards spike immediately |
| Reprint announcements | Immediate | Older printings crash, sometimes rebound if the reprint is different art |
| Ban list changes (competitive) | 0-3 days | Unbanned cards spike, banned cards crash |

### Implementation: Catalyst Score Modifier

```python
from datetime import date

CATALYST_WINDOWS = [
    # (month, day_start, day_end, category, multiplier)
    (2, 20, 28, "pokemon_day", 1.3),      # Pokemon Day window
    (7, 15, 31, "worlds_prep", 1.2),       # Pre-Worlds
    (8, 1, 15, "worlds_peak", 1.3),        # Worlds peak
    (11, 15, 30, "holiday_early", 1.15),   # Early holiday
    (12, 1, 20, "holiday_peak", 1.25),     # Peak holiday
]

def get_catalyst_multiplier(today: date = None) -> tuple[float, str]:
    """Returns (multiplier, catalyst_name) for current date."""
    today = today or date.today()
    for month, d_start, d_end, name, mult in CATALYST_WINDOWS:
        if today.month == month and d_start <= today.day <= d_end:
            return mult, name
    return 1.0, "none"
```

Apply this multiplier to signal strength: a momentum signal during a catalyst window is worth more than the same signal in a dead period.

---

## 5. Momentum Entry Rules

These rules prevent the most common momentum trading mistake: buying the top.

### Rule 1: Wait for Confirmation

Do not buy on a single week's data. Require **2 consecutive weeks** of:
- Price increase (week-over-week)
- Rising or stable sales velocity

```python
def is_confirmed_momentum(prices_weekly: list[float], velocity_weekly: list[float]) -> bool:
    if len(prices_weekly) < 3 or len(velocity_weekly) < 3:
        return False
    # Last 2 weeks both up in price
    price_up_w1 = prices_weekly[-1] > prices_weekly[-2]
    price_up_w2 = prices_weekly[-2] > prices_weekly[-3]
    # Velocity not declining
    vel_stable = velocity_weekly[-1] >= velocity_weekly[-2] * 0.8
    return price_up_w1 and price_up_w2 and vel_stable
```

### Rule 2: Don't Chase

If the price is already up >30% from its recent low (30-day low), the easy money has been made. The risk/reward no longer favors entry.

```python
low_30d = min(prices[-30:])
rally_pct = (current_price - low_30d) / low_30d
if rally_pct > 0.30:
    return None  # Too late, skip
```

### Rule 3: Buy the Pullback

Within a confirmed uptrend (prices trending up over 3+ weeks), wait for a 5-10% pullback from the recent high before entering. This gives a better risk/reward ratio.

```python
high_recent = max(prices[-14:])  # 2-week high
pullback_pct = (high_recent - current_price) / high_recent
if 0.05 <= pullback_pct <= 0.10:
    # Good entry point within an uptrend
    return "BUY_THE_DIP"
```

### Rule 4: Volume Must Confirm

Never enter a momentum trade where velocity is declining. Rising price + declining velocity = distribution, not momentum.

---

## 6. Exit Rules for Momentum Trades

Momentum trades are fundamentally different from value trades. They require disciplined exits because the same force that pushed the price up can reverse.

### Trailing Stop: 20% From High

Once a momentum position is entered, track the highest price reached. If the current price drops 20% from that high, exit immediately.

```python
def check_trailing_stop(current_price: float, highest_price: float) -> bool:
    if highest_price <= 0:
        return False
    drawdown = (highest_price - current_price) / highest_price
    return drawdown >= 0.20
```

Why 20% and not tighter? Pokemon card prices have high daily noise (individual sales vary). A 10% stop would trigger on normal variance. 20% catches real reversals.

### Velocity Fade Exit

If sales velocity drops back to baseline (z-score returns below 0.5 after being above 2.0), the catalyst is fading. Exit regardless of price.

```python
def check_velocity_fade(
    entry_velocity_zscore: float,
    current_velocity_zscore: float
) -> bool:
    # Entered because velocity was hot, now it's cooled off
    return entry_velocity_zscore > 2.0 and current_velocity_zscore < 0.5
```

### Time Decay Exit: 60-Day Maximum Hold

Momentum trades should not become long-term holds. Catalysts fade. Set a hard 60-day maximum hold period for any momentum-strategy position.

```python
MAX_MOMENTUM_HOLD_DAYS = 60

def check_time_exit(entry_date: date) -> bool:
    days_held = (date.today() - entry_date).days
    return days_held > MAX_MOMENTUM_HOLD_DAYS
```

### Regime Shift Exit

If the detected regime changes from `markup` or `accumulation` to `distribution` or `markdown`, exit within the next cycle. Don't wait for the trailing stop.

### Cascading Exit Priority

1. Stop-loss (hard floor) --> immediate exit
2. Regime shift to bearish --> exit next cycle
3. Velocity fade --> exit next cycle
4. Time decay (60 days) --> exit next cycle
5. Trailing stop hit --> immediate exit
6. Take-profit target hit --> take partial (sell 50%), trail rest

---

## 7. Specific Implementable Rules

These are concrete if/then rules with exact thresholds, ready to be coded into `prop_strategies.py`.

### BUY Rules

**Rule 1: Velocity Spike Buy**
```
IF velocity_zscore > 2.0
AND price_change_7d < 10%
AND current_price >= $5
AND liquidity_score >= 20
THEN BUY with strength = min(1.0, 0.5 + velocity_zscore * 0.1)
     stop_loss = current_price * 0.80
     target = current_price * 1.35
     max_hold = 60 days
```

**Rule 2: Accumulation Phase Buy**
```
IF velocity_change_30d > 50% (sales/day up 50%+ vs prior 30d)
AND price_change_30d < 5%
AND spread_pct < 20%
AND sales_per_day >= 0.3
THEN BUY with strength = 0.75
     stop_loss = current_price * 0.85
     target = current_price * 1.30
     max_hold = 45 days
```

**Rule 3: Spread Compression + Rising Velocity Buy**
```
IF spread_compression_7d > 50% (spread halved in a week)
AND velocity_zscore > 1.0
AND regime IN ("accumulation", "markup")
THEN BUY with strength = 0.70
     stop_loss = current_price * 0.85
     target = current_price * 1.25
```

**Rule 4: Catalyst Window Momentum Buy**
```
IF catalyst_multiplier > 1.0 (in an active catalyst window)
AND velocity_zscore > 1.5 (lower threshold during catalysts)
AND price_change_7d < 15%
AND regime != "markdown"
THEN BUY with strength = min(1.0, base_strength * catalyst_multiplier)
     stop_loss = current_price * 0.85
     target = current_price * 1.30
     max_hold = 30 days (shorter during events)
```

**Rule 5: Confirmed Momentum Pullback Buy**
```
IF price_up_2_consecutive_weeks = true
AND velocity_stable_or_rising = true
AND pullback_from_14d_high BETWEEN 5% AND 10%
AND price_change_from_30d_low < 30%
THEN BUY with strength = 0.80
     stop_loss = 30d_low * 0.95
     target = 14d_high * 1.10
```

### SELL Rules

**Rule 6: Trailing Stop Exit**
```
IF strategy = "momentum_*"
AND current_price < highest_price_since_entry * 0.80
THEN SELL with strength = 1.0
     reason = "Trailing stop: 20% drawdown from peak"
```

**Rule 7: Velocity Fade Exit**
```
IF strategy = "momentum_*"
AND entry_velocity_zscore > 2.0
AND current_velocity_zscore < 0.5
THEN SELL with strength = 0.8
     reason = "Velocity faded to baseline, catalyst exhausted"
```

**Rule 8: Time Decay Exit**
```
IF strategy = "momentum_*"
AND days_held > 60
THEN SELL with strength = 0.7
     reason = "Momentum trade exceeded 60-day max hold"
```

**Rule 9: Distribution Detection Exit**
```
IF volume_price_regime = "DISTRIBUTION"
   (velocity down >20% AND price up >5%)
AND days_held > 7 (give it a week to confirm)
THEN SELL with strength = 0.75
     reason = "Distribution detected: price rising on declining volume"
```

**Rule 10: Regime Reversal Exit**
```
IF strategy = "momentum_*"
AND regime changed from ("markup" or "accumulation")
   TO ("distribution" or "markdown")
THEN SELL with strength = 0.85
     reason = "Regime shifted bearish, momentum thesis invalidated"
```

---

## Integration with Existing System

### Changes to `prop_strategies.py`

1. **Add `_check_velocity_spike()`** -- new buy strategy using Rule 1
2. **Add `_check_accumulation_phase()`** -- new buy strategy using Rule 2
3. **Enhance `_check_spread_compression()`** -- add spread change rate (Rule 3)
4. **Add `_check_catalyst_momentum()`** -- catalyst-aware version of Rule 4
5. **Enhance `_check_momentum()`** -- add pullback detection (Rule 5)
6. **Add momentum-specific sell checks** -- Rules 6-10 in `check_sell_signals()`

### New Data Requirements

- **Weekly velocity history**: Query `sales` table grouped by week for z-score computation
- **Spread history**: Already available from `PriceHistory.market_price` and `PriceHistory.mid_price`
- **Position metadata**: Track `entry_velocity_zscore` and `highest_price_since_entry` on momentum positions
- **Catalyst calendar**: Static data, no new tables needed

### Performance Considerations

- Velocity z-score requires 13 weekly queries per card. For a scan of 500 cards, that's 6,500 queries. Optimize with a single grouped query:

```sql
SELECT card_id,
       CAST((julianday('now') - julianday(order_date)) / 7 AS INTEGER) AS week_bucket,
       COUNT(*) as sale_count
FROM sales
WHERE order_date >= date('now', '-91 days')
GROUP BY card_id, week_bucket
```

This gives all cards' weekly buckets in one query, then compute z-scores in Python.

---

## Expected Impact

| Signal | Estimated Win Rate | Avg Gain on Win | Avg Loss on Loss | Expected Value |
|--------|--------------------|-----------------|------------------|----------------|
| Velocity Spike (Rule 1) | 60-65% | +25% | -15% | +8-10% per trade |
| Accumulation (Rule 2) | 55-60% | +20% | -12% | +5-7% per trade |
| Catalyst Momentum (Rule 4) | 65-70% | +20% | -12% | +9-11% per trade |
| Pullback Buy (Rule 5) | 60-65% | +15% | -8% | +5-7% per trade |

The velocity spike signal is the highest-conviction trade because it exploits the lag between demand (sales) and price (listings). This lag exists because TCGPlayer sellers manually update prices -- they are slow to react to demand surges.
