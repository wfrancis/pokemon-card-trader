# Modern Pokemon Card Flipping Strategy

Automated strategy for flipping Sword & Shield through Scarlet & Violet era cards on TCGPlayer. All thresholds are calibrated against the system's actual fee model (trading_economics.py) and slippage model (virtual_trader.py).

---

## 1. Modern Card Release Cycle

Pokemon TCG releases ~4 main sets per year plus special sets (ex: Trainer Gallery, special collections). Each set follows a predictable price lifecycle:

### Pre-Release Hype (2-4 weeks before street date)
- Pre-release promos available at league events. Prices are inflated 2-5x due to scarcity.
- Chase card prices spike on speculation from influencer openings and early pulls posted online.
- **Action:** DO NOT BUY. Prices are irrational. Wait for supply flood.

### Week 1 After Release (Days 1-7)
- Massive supply hits the market. Distributors, LGS owners, and case breakers list aggressively.
- Prices drop 30-60% from pre-release highs on all but the top 1-2 chase cards.
- The race to the bottom: sellers undercut each other daily.
- **Action:** DO NOT BUY yet. Supply is still expanding. Monitor velocity.

### Weeks 2-4 (Days 8-30)
- Prices stabilize as initial supply is absorbed. Casual sellers exit.
- First reliable velocity data becomes available (enough sales to compute meaningful trends).
- Mid-tier cards ($5-$20) often hit their floor here.
- Ultra Rare / Secret Rare ($30+) may still be declining but slower.
- **Action:** START MONITORING. Set alerts for cards hitting target entry prices. Begin buying mid-tier staples if velocity > 1/day and price has stabilized (< 5% daily change for 3+ days).

### Months 1-3 (Days 30-90)
- "Settling period." Prices reflect actual competitive play demand + collector interest.
- Competitive staples from the set get identified in tournament results, driving selective price increases.
- Bulk rares continue declining toward $1-3 and are not worth trading (fees eat everything).
- **Action:** PRIMARY BUY WINDOW for flipping. Cards that will appreciate have established a floor. Look for: stable velocity + tight spread + positive slope.

### Months 3-6 (Days 90-180)
- Set is still in print but distributor allocation slows. Reprint waves may cause temporary dips.
- Cards with competitive demand start appreciating as supply tightens.
- Collector-focused chase cards (alt arts, special illustrations) begin steady climbs.
- **Action:** HOLD positions from Month 1-3 buys. Consider adding to winning positions if technical signals confirm uptrend.

### 6+ Months (Day 180+) — Set Goes Out of Print
- This is the inflection point. Once a set is no longer printed:
  - Supply becomes fixed. Every card sold is gone from the market permanently.
  - Key cards from the set appreciate 20-100%+ over the next 6-12 months.
  - Even mid-tier holos can see 30-50% gains if they have any competitive or collector demand.
- **Action:** This is the BEST window for the "out-of-print appreciation" strategy. Cards bought at Month 3-6 prices with the set now OOP are the highest-conviction trades.

### Chase Cards vs Bulk

| Category | Price Range | Flip Viability | Why |
|----------|-------------|----------------|-----|
| Bulk Common/Uncommon | < $0.50 | NOT VIABLE | Fees > card value. Period. |
| Bulk Rare | $1-5 | NOT VIABLE | $5 card needs 100%+ appreciation to break even after fees ($4.80 shipping alone) |
| Mid-Tier Holo/Rare | $5-20 | MARGINAL | Need 50-100% appreciation. Only viable if velocity > 1/day and OOP catalyst |
| Playable Staple | $10-40 | GOOD | Competitive demand creates floor. Tight spreads. High velocity. |
| Ultra Rare | $20-80 | BEST FOR FLIPPING | Sweet spot: fees are manageable (15-20% breakeven), liquidity is good, appreciation potential is high |
| Alt Art / Secret Rare | $50-200+ | GOOD (longer hold) | Higher breakeven but strong appreciation post-OOP. Lower velocity = higher slippage. |
| Chase Card (top 1-2) | $100-500+ | RISKY | High breakeven, volatile, illiquid. Only trade with momentum confirmation. |

---

## 2. TCGPlayer Fee Structure Impact

From `trading_economics.py`, the actual fee model:

```
TCGPlayer Seller Fees:
  Commission:          10.75% of sale price
  Payment Processing:  2.5% + $0.30 flat
  Shipping (tracked):  $4.50 per shipment
  Buyer pays:          $0.00 (Direct: free shipping on $5+)
```

### Breakeven Appreciation by Price Point

| Buy Price | Total Fees | Fee % of Sale | Breakeven Appreciation |
|-----------|-----------|---------------|----------------------|
| $5 | $5.46 | 52.2% | 108.4% |
| $10 | $5.93 | 35.2% | 54.6% |
| $15 | $6.41 | 28.5% | 39.4% |
| $20 | $6.89 | 25.0% | 32.0% |
| $30 | $7.84 | 20.7% | 24.9% |
| $50 | $9.75 | 16.3% | 19.0% |
| $100 | $13.55 | 12.0% | 15.6% |
| $250 | $25.05 | 9.1% | 13.4% |

**Key insight:** Cards under $20 are extremely hard to flip profitably. A $10 card needs to appreciate 55% just to break even. The sweet spot is $20-100 where breakeven is 15-32%.

### The $20 Floor Rule

From `trading_economics.py` line 392: `is_viable_trade()` returns `True` only for cards >= $20. This is correct. Below $20, the fixed costs ($4.50 shipping + $0.30 processing) dominate and make profitable flipping nearly impossible without massive appreciation.

**Exception:** Cards $10-20 can be viable IF you ship PWE (plain white envelope, $1.25 vs $4.50) — but this is risky (no tracking, buyer disputes) and not modeled in the system. Don't rely on it.

### Slippage Impact (from virtual_trader.py)

On top of fees, slippage (bid-ask spread in execution) adds:
- High liquidity (score > 70, > 1 sale/day): 1-3% slippage
- Medium liquidity (score 40-70): 3-7% slippage
- Low liquidity (score < 40): 7-15% slippage
- Very low liquidity (< 0.1 sale/day): 15-25% slippage

**Real total cost to trade (roundtrip):**
```
Total drag = Buy slippage + Sell slippage + Seller fees
High liquidity card:  2% + 2% + 13% = ~17% drag
Medium liquidity:     5% + 5% + 13% = ~23% drag
Low liquidity:       10% + 10% + 13% = ~33% drag
```

This means a high-liquidity $50 card needs ~$8.50 appreciation (17%) to break even. A low-liquidity $50 card needs ~$16.50 (33%). **Always favor liquid cards.**

---

## 3. Spread-Based Flipping

The "spread" in this system is the gap between market price (current lowest listing or TCGPlayer market price) and median sold price (actual transaction prices).

### Spread Scenarios

**Scenario A: Market Price > Median Sold (Positive Spread)**
- Sellers are listing above what buyers actually pay.
- The card is OVERPRICED. Buyers will wait or buy a cheaper copy.
- **Signal:** SELL if holding. DO NOT BUY.
- Threshold: If market > median sold by > 15%, the card is overpriced.

**Scenario B: Median Sold > Market Price (Negative Spread)**
- Buyers are consistently paying MORE than the current lowest listing.
- The card is UNDERPRICED. Listings are getting scooped quickly.
- **Signal:** BUY. The market price hasn't caught up to actual demand.
- Threshold: If median sold > market by > 5%, this is a buy signal. > 10% is a strong buy.

**Scenario C: Tight Spread (< 5%)**
- Market price closely matches transaction prices. Efficient pricing.
- **Signal:** NEUTRAL on spread alone. Look at velocity and trend for direction.
- Best environment for flipping: you can buy near market and sell near market without getting crushed by the spread.

### Spread Thresholds for the System

```python
# Spread-based signals (spread = abs(market - median_sold) / median_sold * 100)
SPREAD_UNDERPRICED_STRONG = -10.0  # median sold 10%+ above market = strong buy
SPREAD_UNDERPRICED = -5.0          # median sold 5%+ above market = buy
SPREAD_TIGHT = 5.0                 # within 5% = neutral (good for momentum/velocity plays)
SPREAD_OVERPRICED = 15.0           # market 15%+ above median sold = avoid / sell
SPREAD_SEVERELY_OVERPRICED = 25.0  # market 25%+ above median sold = strong sell
```

**Current system note:** `prop_strategies.py` uses `spread < 15%` as a buy condition in `_check_spread_compression()`. This is correct for a "tight spread + velocity" play — it means the card is efficiently priced AND selling well. But it misses the underpriced opportunity. The system should add a separate "spread underpriced" strategy for cards where median_sold > market.

---

## 4. Velocity-Based Signals

Sales velocity (sales per day over 30-day window) is the single most predictive leading indicator for price movement in modern Pokemon cards. Price follows demand, and demand shows up in velocity before it shows up in price.

### Velocity Tiers

| Velocity (sales/day) | Classification | Trading Implication |
|----------------------|----------------|---------------------|
| < 0.1 | Dead | DO NOT TRADE. Cannot exit position. |
| 0.1 - 0.3 | Low | Marginal. Only trade with very strong conviction. High slippage. |
| 0.3 - 1.0 | Moderate | Tradeable. Monitor for acceleration. |
| 1.0 - 3.0 | Good | Sweet spot for flipping. Easy entry/exit. Low slippage. |
| 3.0+ | High | Very liquid. Best for quick flips. Minimal slippage (1%). |

### Velocity Acceleration Detection

The most powerful signal is velocity ACCELERATION — when sales are increasing faster than the recent trend.

```python
# Velocity acceleration formula:
velocity_30d = sales_30d / 30
velocity_90d = sales_90d / 90
acceleration_ratio = velocity_30d / velocity_90d  # if velocity_90d > 0

# Interpretation:
# > 2.0  = Strong acceleration (BUY signal) — demand is spiking
# > 1.5  = Moderate acceleration (watch closely)
# 1.0    = Stable velocity (neutral)
# < 0.7  = Decelerating (SELL signal if holding)
# < 0.3  = Demand collapse (URGENT SELL)
```

### What Causes Velocity Spikes in Modern Cards

1. **Tournament results** — A card tops a Regional or International Championship. Velocity spikes 3-10x within 48 hours. Price follows 1-3 days later.
2. **Set going out of print** — Collectors rush to complete sets. Velocity increases gradually over 2-4 weeks.
3. **YouTube/TikTok feature** — An influencer opens a card or features it. Velocity spike is sharp but SHORT-LIVED (24-72 hours). Price spike often reverses.
4. **Rotation announcement** — When competitive formats rotate, cards entering or leaving the format see velocity changes.
5. **New set synergy** — A new card is revealed that makes an older card more powerful in competitive play.

### Velocity-Price Divergence (Most Powerful Signal)

When velocity increases but price stays flat or decreases, this is a STRONG BUY. It means demand is absorbing supply without pushing price up yet. The price move is coming.

```python
# Divergence detection:
price_change_7d = (current_price - price_7d_ago) / price_7d_ago
velocity_change = acceleration_ratio - 1.0  # positive = accelerating

# BUY if: velocity_change > 0.3 AND price_change_7d < 0.05
# (velocity up 30%+ while price flat or declining)
```

---

## 5. Set Out-of-Print Signals

When a Pokemon TCG set stops being printed, it's the most reliable catalyst for price appreciation in modern cards. The challenge is detecting it from data alone (The Pokemon Company doesn't announce print runs).

### Detection Heuristics

**Signal 1: Set Age**
- Modern sets are typically in print for 12-18 months.
- If a set is > 12 months old, it's a candidate for OOP.
- If > 18 months, it's almost certainly OOP or very close.
- Track `set.release_date` and compute age.

**Signal 2: Broad Velocity Increase Across the Set**
- When a set goes OOP, you don't see one card spike — you see MANY cards from the set start moving.
- Detect: If 30%+ of tracked cards in a set show velocity_acceleration_ratio > 1.3, the set may be going OOP.

**Signal 3: Price Floor Rising**
- Bulk rares from the set stop declining and start ticking up.
- If the MEDIAN price of all tracked cards in the set increases > 5% over 30 days, supply is tightening.

**Signal 4: Listing Count Declining (Not Currently Tracked)**
- Would need to scrape TCGPlayer listing counts. Not in the current data model.
- If added: declining listings + stable/increasing velocity = OOP confirmed.

### Composite OOP Score

```python
def calc_oop_score(set_age_months, pct_cards_accelerating, median_price_change_30d):
    """Score 0-100 likelihood the set is out of print."""
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

# OOP score > 60 = high confidence set is OOP → buy key cards from the set
# OOP score > 40 = moderate confidence → monitor closely
# OOP score < 40 = likely still in print → no action
```

### Which Cards to Buy When a Set Goes OOP

Priority order:
1. **Competitive staples** from the set (4x demand from deck builders)
2. **Alt Art / Special Illustration** versions (collector demand, limited supply per box)
3. **Full Art Trainers** (crossover collector + competitive demand)
4. **Top chase card** (if price hasn't already spiked > 30%)
5. **Holo Rares of popular Pokemon** (Charizard, Pikachu, Eevee, etc.)

Avoid: Bulk rares, common/uncommon, non-holo versions (won't appreciate enough to clear fees).

---

## 6. Specific Trading Rules (Backtestable)

All rules reference variables available in the system's `get_technical_data()` and `trading_economics.py`.

### BUY Rules

**Rule B1: OOP Momentum Buy**
```
BUY IF:
  set_age_months >= 12
  AND rarity IN ('Rare Holo', 'Rare Holo V', 'Rare Ultra', 'Rare VMAX',
                  'Rare VSTAR', 'Illustration Rare', 'Special Art Rare',
                  'Rare Holo ex', 'Double Rare', 'Ultra Rare', 'Hyper Rare')
  AND current_price >= 20
  AND velocity >= 0.5/day
  AND acceleration_ratio >= 1.3
  AND regime IN ('accumulation', 'markup')
  AND spread_pct < 15

POSITION SIZE: 2 copies if price < $50, 1 copy if >= $50
STOP LOSS: -15% from entry
TAKE PROFIT: +35% from entry
MAX HOLD: 120 days
```

**Rule B2: Underpriced Buy (Spread Reversal)**
```
BUY IF:
  median_sold_price > market_price * 1.08  (median sold 8%+ above market)
  AND velocity >= 1.0/day
  AND current_price >= 20
  AND liquidity_score >= 40
  AND num_data_points >= 5

POSITION SIZE: 2 copies if price < $50, 1 copy if >= $50
STOP LOSS: -12% from entry
TAKE PROFIT: +25% from entry (targeting convergence to median sold)
MAX HOLD: 60 days
```

**Rule B3: RSI Oversold Bounce (Mean Reversion)**
```
BUY IF:
  rsi_14 < 30
  AND price within 10% of bb_lower
  AND velocity >= 0.3/day
  AND liquidity_score >= 30
  AND current_price >= 20
  AND set_age_months < 24 (not too old — still has a market)

POSITION SIZE: 1-2 copies (Kelly fraction based on signal strength)
STOP LOSS: -10% from entry (tight — this is mean reversion, wrong fast)
TAKE PROFIT: bb_middle (middle Bollinger band)
MAX HOLD: 45 days
```

**Rule B4: Golden Cross Trend Follow**
```
BUY IF:
  sma_7 crosses above sma_30 (prev_sma_7 <= prev_sma_30 AND sma_7 > sma_30)
  AND regime IN ('accumulation', 'markup')
  AND velocity >= 0.5/day
  AND current_price >= 20
  AND macd_histogram > 0

POSITION SIZE: standard Kelly sizing
STOP LOSS: -15% from entry
TAKE PROFIT: +30% from entry
MAX HOLD: 90 days
```

**Rule B5: Velocity Spike (Demand Surge)**
```
BUY IF:
  acceleration_ratio >= 2.0 (velocity doubled vs 90d average)
  AND price_change_7d < 0.10 (price hasn't spiked yet — velocity leads price)
  AND current_price >= 15
  AND velocity >= 1.0/day
  AND spread_pct < 20

POSITION SIZE: 2-3 copies (high conviction — velocity surge is most reliable signal)
STOP LOSS: -12% from entry
TAKE PROFIT: +25% from entry
MAX HOLD: 30 days (quick flip — velocity spikes are often short-lived)
```

### SELL Rules

**Rule S1: Stop Loss (Hard Floor)**
```
SELL IF:
  current_price <= entry_price * 0.85 (15% loss)

NO EXCEPTIONS. Cut losses immediately.
```

**Rule S2: Take Profit (Target Hit)**
```
SELL IF:
  current_price >= target_price (from buy rule)

VARIATION: If velocity is still accelerating (ratio > 1.5) when target is hit,
  raise target by 10% and set trailing stop at -8% from new high.
  This lets winners run during strong moves.
```

**Rule S3: Stale Position Cleanup**
```
SELL IF:
  days_held > 90
  AND unrealized_gain < 5%

The opportunity cost of capital sitting in a flat position is real.
If it hasn't moved in 90 days, it's not going to.
```

**Rule S4: Regime Breakdown**
```
SELL IF:
  regime changed to 'distribution' or 'markdown'
  AND position has any gain (even 1%)

Don't ride a trend reversal. Take what you have.
```

**Rule S5: Death Cross Exit**
```
SELL IF:
  sma_7 crosses below sma_30
  AND macd_histogram < 0
  AND days_held > 7 (avoid selling on noise right after buying)

Trend has reversed. Exit.
```

**Rule S6: Velocity Collapse**
```
SELL IF:
  velocity < 0.1/day
  AND days_held > 14

Card became illiquid. Get out while you still can.
Priority: immediate. Don't wait for other signals.
```

**Rule S7: Trailing Stop (For Winners)**
```
SELL IF:
  current_price > entry_price * 1.20 (we're up 20%+)
  AND current_price < max_price_since_entry * 0.92 (dropped 8% from peak)

This protects profits on big winners without cutting them short.
Only activates once the position is meaningfully profitable.
```

---

## 7. Risk Management

### Position Sizing (already implemented in prop_strategies.py)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Max positions | 20 | Diversification without over-spreading attention |
| Max single position | 10% of portfolio | One bad trade can't sink the portfolio |
| Max set concentration | 30% of portfolio | Don't bet everything on one set going OOP |
| Cash reserve | 20% minimum | Always have dry powder for opportunities |
| Max new buys per cycle | 3 | Don't deploy capital too fast |
| Min card price | $20 | Below this, fees make profitable flipping nearly impossible |

### Position Sizing by Price Tier

| Card Price | Max Copies | Rationale |
|-----------|-----------|-----------|
| $20-50 | 3 copies | Liquid, low per-unit risk, easy to sell in parts |
| $50-100 | 2 copies | Good risk/reward, moderate liquidity |
| $100-250 | 1 copy | Higher risk per unit, sell as single lot |
| $250+ | 1 copy | Only with very high conviction signals |

### Kelly Criterion-Inspired Sizing

The system uses a simplified Kelly approach (prop_strategies.py line 619):
```
kelly_fraction = 0.3 + signal_strength * 0.7
target_allocation = min(max_position, available_cash) * kelly_fraction
```

This means:
- Weak signal (strength 0.3): deploys 51% of max allocation
- Medium signal (strength 0.6): deploys 72% of max allocation
- Strong signal (strength 0.9): deploys 93% of max allocation

**Recommendation:** Add a win-rate adjustment. If the strategy's historical win rate is known:
```
kelly_fraction = (win_rate * avg_win - (1 - win_rate) * avg_loss) / avg_win
```

### Stop Loss Policy

- **Hard stop: -15%** for trend-following strategies (B1, B4)
- **Tight stop: -10%** for mean-reversion strategies (B3) — if the thesis is wrong, get out fast
- **Medium stop: -12%** for velocity/spread plays (B2, B5) — some noise tolerance
- **NEVER move a stop loss DOWN.** Only up (trailing stop after +20% gain).

### Maximum Holding Periods

| Strategy | Max Hold | Rationale |
|----------|----------|-----------|
| Velocity Spike (B5) | 30 days | Quick flip. Velocity events are transient. |
| Mean Reversion (B3) | 45 days | Either it reverts or the thesis is wrong. |
| Underpriced Buy (B2) | 60 days | Spread should converge within 2 months. |
| Golden Cross (B4) | 90 days | Trend-following needs time but not forever. |
| OOP Momentum (B1) | 120 days | Appreciation post-OOP can take a few months. |

### Portfolio-Level Risk Rules

1. **Max drawdown circuit breaker:** If portfolio drops > 15% from high-water mark, STOP all new buys for 7 days. Only process sell signals during cooldown.

2. **Correlation risk:** Don't hold > 5 cards from the same set. Even with the 30% set concentration limit, having too many positions in one set means a single set-level event (reprint announcement, rotation) hits multiple positions.

3. **Rarity diversification:** Aim for a mix:
   - 40-50% of positions in Ultra Rare / Double Rare ($20-80 range)
   - 20-30% in Alt Art / Special Illustration ($50-200 range)
   - 20-30% in Playable Staples / Holo Rares ($20-50 range)

4. **Never catch a falling knife:** If a card has dropped > 40% in 30 days, do NOT buy even if RSI is oversold. Wait for velocity to confirm demand exists (velocity > 0.3/day after the drop). The `_check_mean_reversion()` strategy already enforces this with the velocity check.

5. **Season awareness:** Pokemon card prices are seasonal:
   - **November-December:** Prices spike (holiday gift buying). SELL into strength.
   - **January-February:** Prices dip (post-holiday sell-off). BUY opportunities.
   - **July-August:** Moderate dip (summer slowdown). Secondary buy window.
   - **Set release weeks:** Avoid trading the set being released (see Section 1).

### Expected Performance Metrics (Targets)

For a well-executed modern flip strategy:

| Metric | Target | Minimum Acceptable |
|--------|--------|--------------------|
| Win rate | 55-65% | 45% |
| Avg win | +22-30% | +18% |
| Avg loss | -10-12% | -15% |
| Profit factor | 1.8-2.5 | 1.3 |
| Max drawdown | < 12% | < 20% |
| Avg hold period | 30-60 days | < 90 days |
| Sharpe ratio | > 1.5 | > 0.8 |
| Annual return (net of fees) | 25-40% | 12% |

---

## Implementation Priority

To add these rules to the existing `prop_strategies.py` system:

1. **Add OOP detection** — new function `calc_oop_score()` using set age + broad velocity + median price change.
2. **Add velocity acceleration** — compute `acceleration_ratio = velocity_30d / velocity_90d` in `get_technical_data()`.
3. **Add underpriced spread strategy** — new `_check_spread_underpriced()` looking for median_sold > market.
4. **Add velocity spike strategy** — new `_check_velocity_spike()` for acceleration_ratio > 2.0 + flat price.
5. **Add trailing stop** — modify `check_sell_signals()` to track max price since entry and trigger at -8% from peak.
6. **Add max holding period** — add strategy-specific hold limits to sell signal checks.
7. **Add seasonal adjustment** — weight buy signals down in Nov-Dec, up in Jan-Feb.
8. **Add drawdown circuit breaker** — check portfolio drawdown before allowing new buys in `run_trading_cycle()`.
