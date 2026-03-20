# Pokemon Card Market Microstructure: Trading Strategy Research

**Date:** 2026-03-19
**Purpose:** Inform automated prop trading system design with realistic market dynamics.
**Data sources:** TCGPlayer market prices (daily), completed sales (individual transactions), price history (weekly snapshots, 1-2 years), card metadata, sales velocity, spread data.

---

## 1. How Pokemon Card Prices Actually Move

Pokemon cards are **not equities**. They are illiquid, physically settled collectibles with discontinuous price discovery. Understanding what actually moves prices is the foundation of any viable strategy.

### 1.1 Price Drivers (Ranked by Impact)

**Tier 1 — Catalytic events (can move prices 30-300% in days):**

- **New set releases.** When a new set drops, the chase cards (Special Illustration Rares, Secret Rares) start at inflated pre-order prices, then crash 40-70% over the first 2-4 weeks as supply floods in from box openings. This is the single most predictable pattern in the market. The crash is steepest for cards in high-print-run sets (modern era) and shallowest for limited-run products (special collections, Japanese exclusives). After the initial crash, prices stabilize at a floor, then begin a slow recovery if the card has genuine collector demand.

- **YouTuber/influencer spikes.** A single video from a major Pokemon content creator (Logan Paul, PokeRev, Leonhart, etc.) can spike a specific card or set 50-200% in 24-48 hours. These spikes are almost always fully mean-reverting within 7-14 days. The critical insight: by the time price data reflects the spike, the opportunity to buy is gone, and the opportunity to sell into the spike is the real edge. Our system should detect sudden velocity increases (sales_per_day jumping 5x+) as potential influencer events and trigger sell signals for held positions.

- **Tournament rotation / format changes.** When Pokemon announces Regulation Mark changes (which cards are legal in Standard format), playable cards in the outgoing rotation lose 20-50% of their value over 2-4 weeks. Conversely, cards in the incoming rotation that enable new archetypes can spike. This is semi-predictable: The Pokemon Company announces rotation schedules months in advance. However, our system currently tracks price data, not competitive metagame data, so this driver is difficult to exploit directly.

**Tier 2 — Structural trends (move prices 10-40% over weeks to months):**

- **Set age / out-of-print effect.** Once a set goes out of print, supply becomes fixed while demand is ongoing. Cards from sets 2-5 years old tend to appreciate steadily at 0.05-0.15%/day (our `appreciation_slope` metric captures this). The effect is strongest for sets with iconic chase cards (Evolving Skies Umbreon VMAX Alt Art, Lost Origin Giratina VSTAR Alt Art, etc.). Sets less than 18 months old are still being opened and supply is still increasing, so appreciation is unreliable.

- **Nostalgia cycles.** Pokemon has 25+ years of card history. Cards from the original Base Set, Gym Heroes/Challenge, Neo series, and early ex-era experience cyclical demand waves as collectors who grew up with those sets reach earning ages. These cycles operate on 3-7 year timescales and are not actionable for our system's holding period.

- **Grading population reports.** When PSA/CGC/BGS publish population reports showing low graded counts for a card, raw copies can spike as speculators buy to submit for grading. Our system tracks ungraded market prices, but a spike in raw card prices with stable fundamentals (no new set release, no YouTuber mention) may indicate a grading-driven move.

**Tier 3 — Seasonal / cyclical (5-15% swings, predictable timing):**

- **Holiday demand (Nov-Dec).** Pokemon cards are a major gift item. Prices for popular cards rise 5-15% starting in mid-November and peak in early December. The effect is strongest for sealed product and chase cards in the $20-$100 range (gift-appropriate prices). Prices typically retrace in January.

- **Back-to-school (Aug-Sep).** Minor demand increase as kids return to school and trade cards. Smaller effect, maybe 3-8% on playable/popular cards.

- **Pokemon Day (Feb 27).** The Pokemon Company often announces new products or promotions around Pokemon Day. Can create temporary demand spikes for related cards.

- **Tax refund season (Feb-Apr).** Collectors with disposable income from tax refunds increase purchasing. Broad-market effect, subtle but consistent.

### 1.2 How Price Discovery Actually Works

On TCGPlayer, price discovery is **asymmetric and discontinuous**:

- **Listed prices are ask prices.** There is no bid. Buyers either accept a listed price or they don't. The "market price" reported by TCGPlayer is a proprietary rolling average of recent completed sales, not a real-time bid-ask midpoint.

- **Price updates are batched.** Our system gets daily price snapshots. Between snapshots, multiple sales can occur at different prices. We see the TCGPlayer-computed average, not the individual transactions. The `Sale` records from TCGCSV give us individual transactions, which are more granular.

- **Prices are sticky downward.** Sellers are reluctant to lower prices. When demand drops, rather than prices falling immediately, cards simply stop selling. The listed price stays the same but velocity drops to zero. This means our price data can show a card at $50 for weeks while in reality, demand has evaporated and no one is buying at $50. **Velocity is a more honest signal than price for detecting demand shifts.**

- **Prices gap upward.** When demand spikes, the cheapest listings get swept instantly, and the new market price jumps to the next tier of listings. There is no gradual ascent — the order book is too thin. This means upward moves appear as gaps in our daily data.

### 1.3 Implications for Signal Design

- **Momentum signals are unreliable** because of gap-up dynamics and sticky-down behavior. A card showing +20% momentum may have already completed its move.
- **Mean-reversion signals are more reliable** because of the sticky-down effect: cards that haven't moved in price but have maintained velocity are accumulating latent demand.
- **Velocity changes are the leading indicator.** Price is the lagging indicator. When sales_per_day doubles but price hasn't moved, that's the buying opportunity. When sales_per_day halves but price hasn't dropped, that's the selling signal.

---

## 2. Liquidity Analysis

### 2.1 The Liquidity Landscape

The Pokemon card market has a **power law liquidity distribution**:

| Liquidity Tier | Sales/Day | % of Cards | Typical Price | Example |
|---|---|---|---|---|
| Ultra-liquid | >5/day | <1% | $5-30 | Meta-playable trainers, popular holos |
| Liquid | 1-5/day | ~5% | $10-80 | Chase rares from recent sets |
| Semi-liquid | 0.3-1/day | ~10% | $15-200 | Alt arts, vintage holos |
| Illiquid | 0.03-0.3/day | ~30% | $20-500 | Older set rares, niche collectibles |
| Deeply illiquid | <0.03/day | ~55% | $2-50+ | Bulk rares, obscure vintage |

**Critical insight:** The vast majority of cards trade less than once per week. Our system must internalize this: **holding period is not a choice, it's a constraint imposed by liquidity.**

### 2.2 Slippage Model

Traditional stock slippage models assume continuous order books with depth. Pokemon card slippage is fundamentally different:

**Buying slippage:**
- On TCGPlayer, you can buy at the listed ask price with essentially zero slippage *if the listing exists*. The slippage is not in the transaction cost — it's in the **time to find the right listing at the right price**. Our system buys at "market price" which is the TCGPlayer rolling average, but the cheapest actual listing may be 3-10% below market or 5-15% above.
- For the prop trading simulation, buying slippage should be modeled as: `actual_buy_price = market_price * (1 + slippage_factor)` where slippage_factor is 1-3% for liquid cards, 3-7% for semi-liquid, 7-15% for illiquid.

**Selling slippage:**
- Selling is where the real slippage lives. You list a card and **wait**. The expected time to sell is a function of price relative to market, condition, and baseline velocity. Our `estimate_time_to_sell` function models this correctly.
- The hidden cost of selling slippage is **opportunity cost**: while your capital is tied up waiting for a sale, you can't deploy it elsewhere. For a $100 card that takes 21 days to sell, the annualized opportunity cost at even 5% annual return is $0.29 — trivial. But for a portfolio of 20 positions each taking 14-30 days to turn over, capital efficiency becomes a real constraint.

**Effective slippage formula for strategy evaluation:**

```
total_friction = buy_slippage + sell_fees (12.55%) + sell_time_opportunity_cost + shipping ($4.50)
```

For a $50 card with moderate liquidity (0.5 sales/day):
- Buy slippage: ~3% ($1.50)
- Sell fees: 12.55% ($6.28)
- Shipping: $4.50
- Opportunity cost (14 days at 10% annualized): $0.19
- **Total friction: ~$12.47 or 24.9% of card value**

This means **the card must appreciate ~25% just to break even.** Our `calc_breakeven_appreciation` function captures most of this, but does not include buy-side slippage.

### 2.3 The Real Cost of Illiquidity

Illiquidity creates three costs that compound:

1. **You can't exit bad positions.** If a card drops 20% and has 0.1 sales/day, you're stuck. Stop losses are theoretical — you can't actually sell at your stop price if there are no buyers. The prop system should **never enter positions with <0.3 sales/day** unless there is overwhelming fundamental conviction.

2. **You can't scale.** Buying 3 copies of a card that trades 0.5x/day means selling those 3 copies will take 6+ days minimum (you'd need to undercut competing listings or wait). Position sizing must be inversely proportional to time-to-sell.

3. **Price discovery is unreliable.** For cards trading <0.1/day, the "market price" may be based on a sale from 30+ days ago. The actual value could be anywhere. Technical indicators computed on stale prices are meaningless.

### 2.4 Practical Liquidity Thresholds for the Prop System

| Metric | Minimum for Trading | Ideal |
|---|---|---|
| sales_per_day | >0.3 | >1.0 |
| liquidity_score | >25 | >50 |
| sales_90d | >10 | >30 |
| spread (market vs median sold) | <25% | <10% |
| Price data points (history) | >30 | >90 |

---

## 3. Market Maker Dynamics on TCGPlayer

### 3.1 Seller Taxonomy

TCGPlayer sellers fall into distinct categories with different pricing behaviors:

**Professional market makers (5-10% of sellers, 60-70% of volume):**
- High-volume stores with 10,000+ listings
- Price algorithmically: they monitor TCGPlayer's market price and list at market or slightly below to win the buy box
- Reprice inventory daily or multiple times per day
- Willing to undercut competitors by $0.01-$0.50 to maintain velocity
- These sellers *set* the market price for liquid cards

**Semi-professional sellers (15-20% of sellers, 20-25% of volume):**
- 500-5,000 listings, often local game store owners or serious hobbyists
- Price manually, check prices weekly
- Tend to lag market movements by 3-7 days
- Create pricing inefficiencies that are exploitable: when market prices move, their stale listings become either bargains (if market moved up) or overpriced deadweight (if market moved down)

**Casual sellers (70-80% of sellers, 10-15% of volume):**
- <100 listings, usually selling personal collections
- Price based on vibes, TCGPlayer's suggested price, or whatever they paid
- Often overprice by 10-30% (anchoring to purchase price or sentimental value)
- Occasionally underprice significantly (don't know what they have)
- Create the "long tail" of overpriced listings that inflate the ask-side perception

### 3.2 What Causes the Spread

The spread between listed price and actual sale price is driven by:

1. **Overpriced casual listings.** The median listed price may be $55 while the actual clearing price is $45, because 40% of listings are casual sellers at $55-$70. The market price (rolling sale average) is a better signal than the listed price.

2. **Condition premium variance.** A card listed as "Near Mint" at $50 might have actual NM sales at $45 and LP sales at $38. If condition isn't normalized, spreads appear wider than they are.

3. **Seller fee pass-through.** Professional sellers price to achieve a target margin *after* the 12.55% fee. A card that costs them $40 to acquire will be listed at $40 / (1 - 0.1255 - target_margin) which pushes list prices 15-30% above acquisition cost.

4. **Stale listings.** Cards that haven't sold in weeks/months accumulate at above-market prices. The owner is either unaware the market has moved or unwilling to take a loss.

### 3.3 Exploitable Patterns in Market Maker Behavior

- **Post-release repricing lag.** When a new set releases, professional sellers rapidly reprice as the market crashes. Semi-professional sellers reprice 3-7 days later. This creates a window where older inventory is still priced at pre-crash levels (overpriced) while new inventory from box openings floods in at lower prices. The signal: if a card's price drops 30%+ in a week and velocity increases, the old listings will eventually be delisted or repriced, and the new price floor is the real market.

- **Weekend/holiday listing gaps.** Many sellers don't reprice over weekends. Cards that spike on Friday evening (from a YouTube video or tournament result) may have stale listings available through Sunday that are below the new market. Our daily data granularity makes this hard to exploit, but it's worth noting.

- **Buyout and relist.** Occasionally, speculators buy out all cheap listings of a card to manipulate the market price upward, then relist at inflated prices. The telltale sign: sudden velocity spike (10x+ normal) followed by price jump with velocity immediately dropping back to baseline. These are pump-and-dumps. **Never chase these. If velocity collapses after a price spike, the move is artificial.**

---

## 4. Edge Opportunities

### 4.1 Mispriced Cards (Spread Arbitrage)

**The signal:** `market_price` significantly diverges from `median_sold_price` (our spread analysis captures this).

**Where the edge comes from:** TCGPlayer's market price is a rolling average. If a card's median recent sale price is $40 but the market price listed is $50, the market price lags downward. Conversely, if median sold is $60 and market price is $50, the market price hasn't caught up. Our system can compute this spread from the `Sale` table.

**How to exploit it:**
- **BUY signal:** median_sold > market_price * 1.15 (market price hasn't caught up to where cards are actually selling — demand exceeds what the stale average reflects)
- **SELL signal:** median_sold < market_price * 0.85 (market price hasn't caught down — cards are selling for less than the listed market suggests)

**Implementation note:** This is best measured over the last 14-30 sales, not 90 days, because spread arbitrage is a short-term phenomenon. Stale medians dilute the signal.

**Expected edge:** 5-15% per occurrence, but requires the card to be semi-liquid (0.3-1 sales/day) so you can actually buy and sell within a reasonable timeframe.

### 4.2 Out-of-Print Set Appreciation

**The signal:** Set age > 18 months + appreciation_slope > 0.05%/day + appreciation_consistency (R-squared) > 0.4 + liquidity_score > 25.

**Where the edge comes from:** Once a set is out of print, supply only decreases (cards get graded, damaged, lost, or locked in collections). Meanwhile, demand for chase cards is sustained by collector completionism and nostalgia. The appreciation is slow but consistent.

**How to exploit it:**
- Identify cards from out-of-print sets with steady positive appreciation (our `calc_steady_appreciation` already does this)
- Filter for liquidity (need to be able to exit)
- Hold for 90-180 days targeting 20-40% gross appreciation
- The fee breakeven hurdle for a $50 card is ~17%, so we need at least 25% gross to justify the trade

**Implementation note:** The appreciation_slope is expressed as daily continuous rate. A slope of 0.05%/day compounds to ~20% over 365 days. For a 180-day hold, that's approximately 9.4%. Combined with the fee hurdle of ~17%, we need slopes of at least 0.12%/day for a 180-day hold to make sense, or 0.10%/day for a 365-day hold.

**Expected edge:** 10-25% annualized net return on selected positions. Low Sharpe ratio (~0.3-0.5) due to high per-trade friction, but low correlation with the broader market.

### 4.3 Seasonal Demand Patterns

**The signal:** Calendar month + historical price patterns.

**How to exploit it:**
- **Buy in August-September** (post-summer lull, pre-holiday buildup)
- **Sell in late November-early December** (holiday demand peak)
- Focus on "giftable" price range ($20-$80) and popular Pokemon (Charizard, Pikachu, Umbreon, Eevee)

**Implementation note:** This requires backtesting against our price history. We need 2+ years of data per card to validate seasonal patterns. Our current data depth (1-2 years of weekly snapshots) is barely sufficient.

**Expected edge:** 5-10% above baseline appreciation during the Oct-Dec window. Marginal, but can be stacked with other signals.

### 4.4 Condition Arbitrage

**The signal:** NM-to-LP price ratio significantly above or below the typical 75-85% ratio.

**Where the edge comes from:** Most sellers and buyers focus on Near Mint. Lightly Played (LP) cards are often mispriced because:
- Many sellers don't differentiate well between NM and LP
- Some LP listings are actually NM (seller was conservative in grading)
- The LP-to-NM price gap varies by card and can be exploited

**How to exploit it:** Our `Sale` table tracks condition. Compare median NM sale price vs median LP sale price per card. If LP/NM ratio is <0.65 (LP is underpriced relative to historical norms), LP copies may be undervalued — they could be relisted as NM if condition is borderline, or held for collectors who don't care about condition.

**Practical limitation:** Our system is virtual — we don't physically inspect cards. Condition arbitrage requires human judgment on card condition, which limits its automation potential. However, the *signal* (abnormal LP discount) can flag opportunities for manual review.

**Expected edge:** 5-15% per arbitrage opportunity, but execution requires physical card handling.

### 4.5 Cross-Set Pokemon Tracking

**The signal:** Same Pokemon appearing across multiple sets with correlated pricing.

**Where the edge comes from:** Collector demand for a specific Pokemon (e.g., Umbreon) affects all printings. When one Umbreon card spikes (say, the Evolving Skies alt art), collectors often redirect attention to other Umbreon printings as "cheaper alternatives," creating a lagged sympathy rally.

**How to exploit it:**
- When a blue-chip Pokemon's highest-value printing spikes >20%, buy its second and third most valuable printings from other sets
- The sympathy rally typically starts 3-7 days after the primary card's move
- Target 10-20% appreciation on the secondary cards

**Implementation note:** Our `similar cards` endpoint (`GET /api/cards/{id}/similar`) already identifies same-Pokemon cards across sets. Correlating price movements across these groups is the key signal.

**Expected edge:** 10-20% on sympathy rallies, but hit rate is uncertain (~30-40% of primary spikes produce sympathy moves).

---

## 5. Anti-Patterns: What Won't Work

### 5.1 Day Trading

**Why it fails:**
- Cards trade <1x/day on average. You can't enter and exit in the same day.
- TCGPlayer fees are 12.55% per sale. To day-trade profitably, you'd need >15% intraday moves, which essentially never happen in a stable market.
- Price data updates daily at best. Intraday signals don't exist.
- Even if you could identify an intraday opportunity, you'd need a physical card to list. Virtual trading can't capture this.

**Bottom line:** The minimum viable holding period for any strategy is 14-30 days. Anything shorter is destroyed by fees and illiquidity.

### 5.2 Pure Technical Analysis (Blindly Applied)

**Why it fails:**
- Traditional TA assumes continuous price discovery with significant volume. Pokemon cards have neither.
- SMA crossovers computed on weekly data are reactive, not predictive. By the time a 7-day SMA crosses a 30-day SMA, the move is already substantially complete.
- RSI, MACD, and Bollinger Bands assume returns are roughly normally distributed. Pokemon card returns have extreme kurtosis (fat tails from spike events) and positive skewness (influencer pumps).
- Bollinger Bands computed on weekly data have huge standard deviations because the data is noisy. A card can bounce between the bands without any meaningful signal.

**What partially works:** TA *as a filter* (not a primary signal). Using RSI to avoid buying overbought cards or SMA position to confirm a trend is reasonable. Using TA crossovers as primary buy signals is not.

**Our system's current TA signals should be weighted much lower than fundamental signals** (liquidity, appreciation consistency, velocity) for Pokemon cards. The `_generate_signal` function currently weights RSI (3x), MACD (2x), SMA (2x), BB (1.5x), and momentum (1x). For Pokemon cards specifically, these weights should be inverted: **velocity and regime should dominate, with TA as confirmation.**

### 5.3 Momentum Chasing

**Why it fails:**
- Pokemon card price moves are typically **event-driven and complete within 1-3 days**. By the time daily data shows a +15% momentum signal, the move is 80-90% done.
- The remaining 10-20% of the move is eaten by fees (12.55% to sell).
- Influencer-driven spikes are fully mean-reverting. Buying momentum after a spike guarantees buying at the top.
- Set release excitement wanes rapidly. Week-1 hype prices are almost always the peak for modern cards.

**What partially works:** **Anti-momentum** (mean reversion). Cards that have dropped 20-30% from recent highs with stable velocity are more likely to recover than cards that have risen 20-30% are to continue rising. Our `_check_mean_reversion` strategy is correctly designed for this market.

### 5.4 Bulk Accumulation of Cheap Cards

**Why it fails:**
- Cards under $5 have a breakeven hurdle of >100% (fees + shipping eat the entire value).
- Cards in the $5-15 range have breakeven hurdles of 40-70%.
- Even if these cards appreciate 50%, you lose money after fees.
- Liquidity is terrible for bulk cards — they sit for weeks/months.

**Minimum viable price for the prop system should be $20**, where the breakeven hurdle drops to ~25%. Ideally, focus on $30-$150 cards where the hurdle is 17-22% and liquidity is best.

### 5.5 Diversifying Across Too Many Positions

**Why it fails with cards:**
- Each position ties up capital for 14-90 days (illiquidity).
- Each sell incurs a fixed $4.50 shipping cost that doesn't scale.
- Monitoring 50+ positions for sell signals is computationally expensive and the signal quality degrades with thin data.
- The max position count of 20 in our system is reasonable. 10-15 is likely optimal.

---

## 6. Recommended Signal Factors (Ranked by Predictive Power)

### Factor 1: Sales Velocity Trend (Predictive Power: HIGH)

**Why it works:** Velocity is the closest thing to "volume" in a card market. Increasing velocity signals genuine demand growth, which precedes price appreciation. Decreasing velocity signals demand evaporation, which precedes price stagnation or decline. Velocity leads price by 5-14 days in this market.

**How to measure:** `sales_30d / (sales_90d / 3)` gives a velocity ratio. >1.5 = accelerating demand. <0.5 = decaying demand. Combine with absolute velocity (sales_per_day > 0.3) to filter out cards where small absolute changes look like large ratios.

**Signal:** BUY when velocity_ratio > 1.5 AND sales_per_day > 0.3 AND price has NOT already spiked (price_change_7d < 10%). SELL when velocity_ratio < 0.5 AND position has been held > 14 days.

---

### Factor 2: Spread Divergence (market price vs median sold) (Predictive Power: HIGH)

**Why it works:** When actual transaction prices diverge from the listed market price, it signals that the market price is about to move to catch up. This is fundamentally a market-efficiency trade: the market price is a lagging indicator, and the sold price median is the leading indicator.

**How to measure:** `(median_sold_14d - market_price) / market_price`. Positive = market price is too low (cards are selling above listed market). Negative = market price is too high.

**Signal:** BUY when spread divergence > +15% (market price will rise to meet actual sales). SELL/AVOID when spread divergence < -15% (market price will fall). This requires at least 5 sales in the last 14 days for statistical significance.

---

### Factor 3: Appreciation Consistency (R-squared) (Predictive Power: HIGH)

**Why it works:** In an illiquid market with high noise, consistency of trend is more important than slope magnitude. A card appreciating at 0.05%/day with R-squared of 0.6 is a far better bet than a card appreciating at 0.15%/day with R-squared of 0.1 (the latter is noise, not trend). Our `calc_steady_appreciation` already computes this.

**How to measure:** R-squared from log-price linear regression over the full available history (90+ days minimum). R-squared > 0.4 with positive slope = genuine trend. R-squared < 0.2 = no reliable trend regardless of slope.

**Signal:** BUY when appreciation_consistency > 0.4 AND appreciation_slope > 0.08%/day AND liquidity_score > 30. This is a medium-term (90-180 day hold) position.

---

### Factor 4: Regime Detection (Predictive Power: MEDIUM-HIGH)

**Why it works:** Regime (accumulation, markup, distribution, markdown) captures the market's structural posture. Accumulation regimes with low ADX (non-trending, range-bound) are the best entry points. Markdown regimes should be avoided entirely.

**How to measure:** Our `_detect_regime` function using ADX and SMA-200 position. The key improvement: incorporate velocity as a regime modifier. A card in "accumulation" regime with *increasing* velocity is about to break out. A card in "accumulation" with *decreasing* velocity is about to enter markdown.

**Signal:** BUY in accumulation regime + velocity_ratio > 1.2. SELL in distribution or markdown regime regardless of other signals.

---

### Factor 5: Blue-Chip Pokemon Identity (Predictive Power: MEDIUM-HIGH)

**Why it works:** Charizard, Pikachu, Umbreon, Mewtwo, and the other blue-chip Pokemon have structurally higher demand floors than random Pokemon. A Charizard card at a given price point will have 3-5x the buyer pool of a comparably rare card featuring Cinccino. This provides a margin of safety: if you're wrong on the timing, blue-chip Pokemon recover faster.

**How to measure:** Our `BLUE_CHIP_TIER1/2/3` classification in the investment screener. For signal purposes, blue-chip status should reduce the required confidence threshold for entry by 15-20%.

**Signal:** Apply as a confidence modifier. A buy signal on a blue-chip card with strength 0.5 should be treated equivalently to a non-blue-chip signal with strength 0.65.

---

### Factor 6: Rarity Tier (Predictive Power: MEDIUM)

**Why it works:** Higher rarity cards (Special Illustration Rare, Hyper Rare, etc.) have lower print runs and higher collector demand ceilings. Rarity provides a supply constraint that amplifies demand-driven price moves. Our `RARITY_SCORES` dict captures the rarity hierarchy.

**How to measure:** Use rarity_score as a multiplier on position sizing and confidence. Rarity > 60 (Double Rare and above) gets priority. Rarity < 30 (common holos, standard rares) should require stronger signals from other factors.

**Signal:** Rarity is not a standalone buy/sell signal. It's a position-sizing and confidence modifier.

---

### Factor 7: Price Distance from All-Time High (Predictive Power: MEDIUM)

**Why it works:** Cards that are far below their ATH (>40% below) and have maintained liquidity represent mean-reversion opportunities, especially if the ATH was not driven by a one-time event (influencer spike). Cards near their ATH with declining velocity are overbought.

**How to measure:** `pct_from_ath` from our analysis engine. Combine with the *date* of the ATH: if ATH was >90 days ago and current price is 30-50% below, this is a value candidate. If ATH was <14 days ago, this is likely a fading spike.

**Signal:** BUY when pct_from_ath < -35% AND ath_date > 90 days ago AND velocity stable. AVOID when pct_from_ath > -5% AND velocity declining.

---

### Factor 8: Set Relative Strength (Predictive Power: MEDIUM)

**Why it works:** Cards within a set are correlated. If a set is outperforming the market (relative strength > 1.2), its laggard cards tend to catch up. If a set is underperforming (relative strength < 0.8), even its strongest cards tend to give back gains.

**How to measure:** Our `get_set_relative_strength` function computes this. For signal purposes, compare individual card performance vs its set average. Cards underperforming an outperforming set are potential catch-up plays.

**Signal:** BUY cards that are underperforming their set by >10% when the set's relative strength is >1.2 (catch-up trade). SELL cards in sets with relative strength <0.7 (set-level markdown).

---

### Factor 9: Fee-Adjusted Breakeven Viability (Predictive Power: MEDIUM)

**Why it works:** Many trades that look profitable on gross returns are unprofitable after the 12.55% + shipping fee structure. This is a pre-filter, not a signal, but its predictive power for *avoiding bad trades* is very high.

**How to measure:** `calc_breakeven_appreciation(current_price)` gives the minimum appreciation needed. Compare this to realistic expected appreciation (appreciation_slope * expected_hold_days). If expected appreciation < breakeven * 1.3, the risk/reward is unfavorable.

**Signal:** REJECT any buy signal where expected gross return (from appreciation_slope * hold_period) is less than 1.5x the breakeven hurdle. This prevents the system from taking marginal trades that are unprofitable after fees.

---

### Factor 10: Data Confidence / History Depth (Predictive Power: MEDIUM-LOW but ESSENTIAL)

**Why it works:** All signals computed on <30 data points are unreliable. A card with 10 price history records showing a "golden cross" is noise, not signal. This factor prevents the system from overconfident trades on thin data.

**How to measure:** `data_confidence` from our analysis engine (log-scaled 0-1 based on number of data points). Also consider: days since first price record, and total sales count.

**Signal:** Scale ALL other signal strengths by data_confidence. A strength-0.8 buy signal with data_confidence of 0.4 becomes an effective strength-0.32 signal. Never enter positions where data_confidence < 0.5.

---

## 7. Synthesis: The Optimal Strategy

Given the microstructure analysis above, the optimal automated strategy for Pokemon cards is:

### Primary Strategy: Velocity-Confirmed Value Buying

1. **Screen** for cards with: price $20-$200, liquidity_score > 30, appreciation_consistency > 0.3, data_confidence > 0.5
2. **Signal** on velocity_ratio > 1.3 (accelerating demand) combined with one of:
   - Spread divergence > 10% (underpriced vs actuals)
   - Regime = accumulation with velocity trending up
   - Price > 30% below ATH (dated > 60 days ago)
3. **Size** positions using Kelly-fraction with blue-chip and rarity modifiers
4. **Hold** for 30-120 days targeting 25-40% gross appreciation
5. **Exit** on: take-profit hit, velocity_ratio < 0.5 (demand dying), regime shift to markdown, or stale position (>90 days with <15% gain)

### Position Management Rules

- **Max 15 concurrent positions** (capital efficiency)
- **Max 8% of portfolio per position** (concentration risk)
- **Max 25% of portfolio per set** (set-level risk)
- **25% cash reserve** (opportunity buffer)
- **No cards under $20** (fee viability)
- **No cards with <0.3 sales/day** (exit risk)

### Expected Performance Envelope

With realistic fee modeling (12.55% + $4.50 shipping per sell) and slippage:

| Metric | Conservative | Base Case | Optimistic |
|---|---|---|---|
| Annual gross return | 15% | 25% | 40% |
| Fee drag (annualized) | -10% | -12% | -15% |
| **Net annual return** | **5%** | **13%** | **25%** |
| Win rate | 55% | 62% | 70% |
| Avg hold period | 60 days | 45 days | 30 days |
| Max drawdown | -15% | -20% | -25% |
| Sharpe ratio | 0.3 | 0.6 | 0.9 |

These returns are modest compared to equity markets, but the strategy is **uncorrelated with financial markets**, which has portfolio-level value. The primary risk is a broad Pokemon market downturn (unlikely given 25+ years of sustained growth) or a platform risk event (TCGPlayer policy change, fee increase).

---

## 8. Data Quality Warnings

Issues in our current data that affect strategy reliability:

1. **Variant mixing.** Some cards have price history records from different variants (holofoil, normal, reverse holo) interleaved. Our `_filter_dominant_variant` function mitigates this, but mixed-variant data can create false volatility signals. Any card where the dominant variant accounts for <70% of records should have lower data_confidence.

2. **Condition normalization.** Sales data includes NM, LP, MP, and HP sales. If these aren't filtered by condition, the spread analysis is corrupted by condition-driven price differences masquerading as market spread. Always filter to NM for price history analysis; use condition-separated analysis for condition arbitrage signals.

3. **TCGPlayer market price lag.** TCGPlayer's market price is a proprietary rolling average that lags actual transactions by 1-3 days. Our Sale records (individual transactions) are more current and should be preferred for spread analysis.

4. **Weekend and holiday gaps.** Price history may have gaps on weekends/holidays. Weekly snapshot data is more reliable than daily data for trend analysis because it's less affected by missing data.

5. **New card volatility.** Cards from sets released in the last 60 days have inherently unstable prices as the market finds equilibrium. All signals for these cards should be heavily discounted (data_confidence < 0.3 for first 60 days).
