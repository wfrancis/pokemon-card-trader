# Spread-Based Arbitrage Strategy for Pokemon Cards on TCGPlayer

## 1. Understanding TCGPlayer Spreads

TCGPlayer exposes two key price signals per card variant:

- **Market Price**: The lowest listed price from a reputable seller with reasonable shipping. This is the price a buyer would pay right now. TCGPlayer computes this algorithmically from active listings.
- **Median Sold (Mid Price)**: The median transaction price over the trailing 30-day window. This is what buyers have *actually* paid.

The spread between these two numbers is the core signal:

```
Spread % = (market_price - median_sold) / median_sold * 100
```

- **Positive spread** (market > median): The cheapest listing is *above* the typical sale price. The card is overpriced relative to what people are actually paying. Sellers are asking more than buyers have been willing to pay.
- **Negative spread** (market < median): The cheapest listing is *below* the typical sale price. The card is underpriced -- someone is listing it for less than what identical copies have been selling for. This is where arbitrage lives.
- **Zero / tight spread** (-5% to +5%): Market is efficiently priced. The listed price roughly matches what people pay. No edge.

### Why Spreads Exist

Spreads are not random. They emerge from:

1. **Seller urgency**: A seller who wants quick cash lists below recent comps, creating a negative spread.
2. **Stale median data**: If a card spiked recently, the 30-day median is dragged down by older sales, making the current market price look "overpriced" (false positive spread).
3. **Demand shocks**: A card gets featured in a YouTube video or tournament result. Market price jumps before the median catches up (temporary positive spread that resolves upward).
4. **Supply flooding**: A new set release dumps copies on the market. Market price drops before old sales roll out of the 30-day window (temporary negative spread that may not recover).

The key insight: **not all negative spreads are buys, and not all positive spreads are sells.** You need velocity and context to distinguish signal from noise.

---

## 2. The Fee Wall Problem

This is the single most important factor that most amateur card traders ignore. TCGPlayer's fee structure creates a massive drag on every trade.

### Fee Breakdown (TCGPlayer, 2026)

| Component | Rate |
|-----------|------|
| Seller Commission | 10.75% of sale price |
| Payment Processing | 2.5% of sale price + $0.30 flat |
| Tracked Shipping | $4.50 per sale (bubble mailer + tracking) |
| **Combined Rate** | **13.25% + $0.30 + $4.50** |

### Breakeven Appreciation by Price Point

These numbers come directly from our `calc_breakeven_appreciation()` function:

| Buy Price | Fee % of Sale | Net After Fees | Breakeven Appreciation |
|-----------|--------------|----------------|----------------------|
| $5 | 109.2% | -$0.46 | **125.9%** (impossible) |
| $10 | 61.3% | $3.88 | **70.6%** |
| $15 | 45.2% | $8.21 | **52.2%** |
| $20 | 37.2% | $12.55 | **42.9%** |
| $30 | 29.3% | $21.22 | **33.7%** |
| $50 | 22.9% | $38.58 | **26.3%** |
| $75 | 19.7% | $60.26 | **22.7%** |
| $100 | 18.1% | $81.95 | **20.8%** |
| $200 | 15.7% | $168.70 | **18.0%** |
| $500 | 14.2% | $428.95 | **16.4%** |

### What This Means for Spread Trading

The fee wall obliterates "quick flip" strategies at low price points:

- **Cards under $20**: You need the card to appreciate 43-126% just to break even. Spread trading is not viable here. Period.
- **Cards $20-$50**: You need 27-43% appreciation. A spread of -10% is nowhere near enough for a flip -- you need the card to actually trend upward significantly.
- **Cards $50-$100**: You need 21-26% appreciation. A deep negative spread (-15% to -25%) *might* be viable if you believe the card will mean-revert to its median sold price. But you are betting on reversion, not just exploiting the spread.
- **Cards $100+**: Fees drop to 16-21%. This is where spread arbitrage becomes plausible. A card listed 20% below its median sold price is approaching breakeven territory on the flip alone.

### Roundtrip P&L Examples

Buy at one price, sell at another -- what do you actually net?

| Buy | Sell | Gross P&L | Net P&L | Net Return |
|-----|------|-----------|---------|------------|
| $20 | $22 (+10%) | +$2.00 | **-$5.71** | -28.6% |
| $20 | $25 (+25%) | +$5.00 | **-$3.11** | -15.5% |
| $20 | $30 (+50%) | +$10.00 | **+$1.22** | +6.1% |
| $50 | $55 (+10%) | +$5.00 | **-$7.09** | -14.2% |
| $50 | $60 (+20%) | +$10.00 | **-$2.75** | -5.5% |
| $50 | $65 (+30%) | +$15.00 | **+$1.59** | +3.2% |

**Read this table carefully.** Buying a $50 card and selling it for $60 -- a 20% gross gain -- results in a *net loss* of $2.75. The fee wall is real.

### Implications

1. **Do not trade cards under $20.** The code already enforces `is_viable_trade()` at $20 and `MIN_PRICE = $5` for the prop strategy, but for spread arbitrage specifically, the floor should be $50.
2. **A spread of -10% is NOT an arbitrage opportunity.** At $50, -10% means the card is listed at $45 vs median sold $50. If you buy at $45 and sell at $50, you lose $2.75.
3. **True arbitrage requires the spread to exceed the fee wall.** For a $50 card, you need the spread to be roughly -27% (listed at $36.50 vs median $50) to break even. That is an extremely rare mispricing.
4. **The real strategy is not pure spread arbitrage. It is spread-as-signal: use negative spreads to identify cards that are temporarily cheap, then hold for appreciation beyond the fee wall.**

---

## 3. Spread Categories and Actions

Based on the fee analysis, here are actionable spread zones. These assume a minimum card price of $50 (where fees are ~23%).

| Spread Range | Interpretation | Action |
|-------------|---------------|--------|
| **> +50%** | Massively overpriced. No sane buyer is paying this. | **SELL immediately** if you hold. The listing will sit unsold or the seller will reprice. |
| **+20% to +50%** | Overpriced, but might be correct if card is trending up and the median hasn't caught up yet. | **SELL if you hold** and want to lock in gains. Do not buy. Watch for median to catch up (which would shrink the spread). |
| **-5% to +20%** | Fair value zone. Market is efficiently priced. | **No action.** The spread is within noise range. |
| **-10% to -5%** | Slightly underpriced. Could be a seller in a hurry, or early sign of price decline. | **Buy only with confirmation** from other signals: uptrend regime, rising velocity, RSI not overbought. This is not a standalone signal. |
| **-10% to -20%** | Significantly underpriced relative to recent sales. | **BUY if velocity > 0.3/day** and trend is not bearish. This is a meaningful mispricing. But remember: you still need the card to appreciate ~20%+ from here to profit on a flip. You are buying because you believe the card's fair value is at least at the median, and likely higher. |
| **-20% to -35%** | Deep value. Either a panicked seller, a supply glut, or the market is repricing the card downward permanently. | **Aggressive BUY if velocity confirms demand still exists** (> 0.3/day). If velocity is dead (< 0.1/day), this is not deep value -- it is a card in freefall. Avoid. |
| **< -35%** | Extreme mispricing or data anomaly. | **Verify data quality first.** Check if variant mismatch is distorting the spread (e.g., market price is for reverse holo but median is for regular holo). If data is clean and velocity is healthy, this is a rare aggressive buy. |

---

## 4. Velocity-Validated Spread Trading

A negative spread is only meaningful if cards are actually selling. Velocity (sales per day over 30 days) separates real opportunities from traps.

### The Velocity Matrix

| Spread | Velocity > 1.0/day | Velocity 0.3-1.0/day | Velocity 0.1-0.3/day | Velocity < 0.1/day |
|--------|-------------------|---------------------|---------------------|-------------------|
| < -25% | **STRONG BUY** | **BUY** | Cautious buy (small size) | **AVOID** |
| -10% to -25% | **BUY** | **BUY** (core signal) | Watch | **AVOID** |
| -5% to -10% | Watch | Only with trend confirmation | No action | No action |
| > -5% | No action | No action | No action | No action |

### Why Velocity Matters

- **High velocity + negative spread**: The card is selling well at the median price, but someone has listed copies below that level. Demand will absorb these cheap copies. This is the strongest arbitrage signal.
- **Low velocity + negative spread**: Nobody is buying this card. The negative spread might be the *new* fair price, not a temporary mispricing. The median sold is stale, reflecting old demand that no longer exists. Buying here is catching a falling knife.
- **High velocity + positive spread**: The card is in demand and sellers are pushing prices up. The median will catch up. Not an arbitrage, but potentially a momentum play.
- **Zero velocity + any spread**: No liquidity. You cannot exit this position. The spread is irrelevant because there is no market to trade against.

### Velocity Thresholds for This Codebase

The codebase computes `sales_per_day = sales_30d / 30.0`. Current strategy thresholds:

- `_check_spread_compression()` requires velocity > 0.5/day
- `_check_mean_reversion()` requires velocity > 0.1/day
- Sell signal: liquidity dry-up triggers at velocity < 0.1/day

For spread arbitrage specifically:

- **0.3/day minimum** for any buy based on spread signal (roughly 9 sales/month -- enough to confirm active demand)
- **1.0/day ideal** (30 sales/month -- highly liquid, rapid price discovery)
- **Below 0.1/day is a no-trade zone** regardless of spread

---

## 5. Time-of-Day and Day-of-Week Patterns

### Hypotheses Worth Testing

1. **Weekend listings**: Casual sellers may list cards on Saturday/Sunday at lower prices (less competition awareness, impulse selling after finding cards). If so, market prices may dip on weekends and recover Monday-Tuesday as competitive sellers reprice.

2. **Set release cadence**: New set releases (roughly every quarter) flood the market with new supply. Older set cards often temporarily dip as collector attention shifts. Spreads may widen on older cards during new release windows.

3. **TCGPlayer market price update lag**: TCGPlayer's market price algorithm updates based on listing changes and sales. If a card sells at an unusually low price, the market price may drop before the median adjusts. This creates temporary artificial negative spreads.

4. **Paycheck cycle**: TCGPlayer sales may spike around the 1st and 15th of each month (paycheck timing for the core buyer demographic). Sellers who know this may list slightly higher during these windows.

### What We Can Actually Measure

Given our sync cadence (every 6-12 hours), we can track:

- Market price changes by day of week (do Sunday prices dip?)
- Spread compression/expansion patterns across the week
- Velocity changes around set release dates
- Whether negative spreads that appear on weekends revert by Wednesday

**Recommendation**: Add a `day_of_week` field to price history analysis and compute average spread by day. If weekends consistently show wider negative spreads, schedule buy-side scans for Sunday evening.

---

## 6. Cross-Condition Arbitrage

TCGPlayer prices cards across conditions: Near Mint (NM), Lightly Played (LP), Moderately Played (MP), Heavily Played (HP), Damaged (DMG).

### The Condition Gap Opportunity

For Pokemon cards specifically (not sports cards where grading is king), the visual difference between NM and LP is often minimal -- corner whitening, light edge wear. But the price gap can be significant.

| Condition Gap | Signal | Action |
|--------------|--------|--------|
| NM is 0-10% above LP | Normal and healthy | No action -- this is standard |
| NM is 10-20% above LP | Slightly wide but expected for chase cards | Watch -- buy LP if you are a collector who plays the card |
| NM is 20-30% above LP | Wide gap -- NM sellers may be holding out | Consider buying LP if the card is for personal collection or if LP copies sell at near-NM velocity |
| **NM is >30% above LP** | **NM is likely overpriced** | If you hold NM copies, **SELL into the NM premium**. If buying, **buy LP instead** -- the price gap doesn't reflect the quality gap |
| **LP is >90% of NM price** | LP is overpriced relative to NM | **Buy NM** -- you are paying a tiny premium for meaningfully better condition and resale value |

### Practical Limitation

Our current data model tracks only the primary variant's market price (normal, holofoil, or reverseHolofoil) and does not separate by condition within a variant. To implement cross-condition arbitrage, we would need to:

1. Store per-condition prices from the TCG API (the data is available in `tcgplayer.prices`)
2. Compute NM-to-LP spread per card
3. Flag cards where the condition gap exceeds 30%

This is a data model expansion, not a pure strategy change. Worth implementing in a future sprint if the current spread strategy proves profitable.

---

## 7. Concrete Trading Rules

Ten implementable if/then rules with exact thresholds, designed for the fee structure in `trading_economics.py`.

---

### Rule 1: Deep Value Buy

```
IF spread < -20%
AND velocity > 0.3/day
AND current_price >= $50
AND regime NOT IN ("markdown", "distribution")
THEN BUY (position size: 1-2 copies)
     SET stop_loss = entry_price * 0.85
     SET take_profit = median_sold_price * 1.05
```

**Rationale**: Card is listed 20%+ below where it has been selling, and sales velocity confirms demand. Target is reversion to median plus a small premium. At $50+, the fee wall (26%) is partially offset by the 20% discount.

---

### Rule 2: Extreme Mispricing Buy

```
IF spread < -35%
AND velocity > 0.1/day
AND current_price >= $30
AND sales_30d >= 3
THEN BUY (aggressive, position size: 2-3 copies)
     SET stop_loss = entry_price * 0.80
     SET take_profit = median_sold_price * 0.95
```

**Rationale**: At -35%, even with the fee wall, buying and selling at 95% of the median still nets a profit for cards above $75. For $30-$75 cards, you need the card to fully revert. The 0.1/day velocity floor (just 3 sales/month) is intentionally low because extreme mispricings are rare and the upside justifies more risk.

---

### Rule 3: Velocity-Confirmed Value Buy

```
IF spread < -10%
AND velocity > 1.0/day
AND current_price >= $50
AND RSI_14 < 50
AND regime IN ("accumulation", "markup")
THEN BUY (standard size)
     SET stop_loss = entry_price * 0.88
     SET take_profit = entry_price * 1.30
```

**Rationale**: Moderate negative spread, but the card is selling more than once per day (highly liquid). RSI confirms the card is not overbought, and the regime is favorable. The 30% take-profit target clears the fee wall for $50+ cards. High velocity means you can exit quickly if needed.

---

### Rule 4: Overpriced Sell

```
IF spread > +30%
AND you hold the card
AND days_held > 7
THEN SELL at market price
```

**Rationale**: The card is listed 30% above where cards are actually selling. You are holding an asset at an inflated price. The median will likely drag the market price down, or your listing will sit unsold. Take the gain. The 7-day holding floor prevents selling a card you just bought into a temporarily high listing.

---

### Rule 5: Extreme Overpricing Immediate Sell

```
IF spread > +50%
AND you hold the card
THEN SELL immediately at market price (no holding period required)
```

**Rationale**: At +50%, the mispricing is extreme. The market price is likely an outlier listing or stale data. Sell into this premium before it corrects.

---

### Rule 6: Dead Liquidity Exit

```
IF velocity < 0.05/day
AND days_held > 30
AND spread > +10%
THEN SELL at market price (accept slippage)
```

**Rationale**: Nobody is buying this card (less than 1.5 sales/month) and it is priced above recent comps. You are holding an illiquid asset. Exit now before the spread widens further. Accept that you may need to undercut the current market price to find a buyer.

---

### Rule 7: Fee-Wall Filter (Do Not Trade)

```
IF current_price < $20
THEN DO NOT trade on spread signal alone
     (spread signal may still contribute as a secondary factor to technical strategies)
```

**Rationale**: Below $20, the breakeven appreciation is 43%+. No reasonable spread signal can overcome this. The card must be a long-term hold with fundamental appreciation drivers (set going out of print, competitive meta relevance), not a spread trade.

---

### Rule 8: Spread + Momentum Combo Buy

```
IF spread < -10%
AND SMA_7 > SMA_30 (golden cross active)
AND MACD_histogram > 0
AND velocity > 0.5/day
AND current_price >= $50
THEN BUY (high conviction, position size: max for price tier)
     SET stop_loss = SMA_30
     SET take_profit = entry_price * 1.35
```

**Rationale**: This is the highest-conviction setup. The card is underpriced (negative spread), trending upward (SMA cross + positive MACD), and liquid (velocity). The stop loss at the 30-day SMA provides a trailing floor. The 35% target aggressively clears fees.

---

### Rule 9: Spread Expansion Warning

```
IF spread was < -5% last cycle
AND spread is now < -15% (spread widened by 10+ points)
AND velocity decreased by > 30% vs prior 30 days
THEN DO NOT BUY (or close existing position)
     FLAG as "accelerating decline"
```

**Rationale**: A spreading negative spread with declining velocity means the card is losing demand and sellers are cutting prices. This is not a buying opportunity -- it is a card in freefall. The median will eventually catch down to the market price, not the other way around.

---

### Rule 10: Spread Reversion Take-Profit

```
IF you hold a card bought on a spread signal
AND the current spread has reverted to > -3% (near zero or positive)
AND unrealized_gain > breakeven_appreciation_pct (from calc_breakeven_appreciation)
THEN SELL at market price
```

**Rationale**: You bought the card because the spread was deeply negative. The spread has now normalized, meaning the market price has risen toward (or above) the median. If your unrealized gain clears the fee wall, take the profit. The spread trade is complete -- holding further is a directional bet, not an arbitrage.

---

## Summary: The Honest Truth About Pokemon Card Spread Arbitrage

Pure spread arbitrage (buy underpriced, sell at fair value) is **extremely difficult** on TCGPlayer because of the 13.25% + $4.80 fee structure. For a $50 card, you need a 26.3% gross appreciation to break even. A -10% spread gives you 10 points of the 26 you need. You are still 16 points short.

The viable strategy is therefore **spread-as-entry-signal, not spread-as-trade**:

1. Use negative spreads to identify temporarily cheap cards.
2. Confirm with velocity that demand exists.
3. Confirm with technical indicators (regime, SMA, RSI) that the trend supports appreciation.
4. Hold for the 20-35% appreciation needed to clear fees.
5. Exit when the spread normalizes AND fees are covered.

Cards under $50 are poor candidates for any spread strategy. Cards $100+ are where the math starts to work, because the fee wall drops to ~20% and fixed costs ($4.80) become proportionally smaller.

The best trades are not "buy cheap, sell fair." They are "buy cheap during a temporary dip in an uptrending, liquid card, and sell above fair after the trend continues." Spread is the entry signal. Trend is the profit engine. Velocity is the safety net.
