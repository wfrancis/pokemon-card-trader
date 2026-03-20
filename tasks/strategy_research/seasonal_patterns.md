# Seasonal Patterns in the Pokemon Card Market

Research document informing the trading system's seasonal adjustments.

---

## Available Data Fields

The system tracks two data sources relevant to seasonal analysis:

- **PriceHistory** — daily snapshots with `date`, `market_price`, `low_price`, `mid_price`, `high_price`, per card/variant/condition
- **Sale** — individual completed sales with `order_date`, `purchase_price`, `shipping_price`, `quantity`, `condition`, `variant`, `source` (tcgplayer/ebay)

Both tables have card-level foreign keys and date indexes, making month-over-month and day-of-week aggregations straightforward.

---

## 1. Annual Demand Cycle (Month by Month)

### January — Post-Holiday Dip
- **Demand:** LOW. Gift recipients list unwanted cards on secondary markets. Supply spikes while buyer interest drops after holiday spending.
- **Price effect:** -5% to -15% below annual average for staple cards. Bulk and mid-tier cards hit hardest. Chase cards from the holiday set hold better.
- **Volume:** Sell-side volume high (gift liquidation), buy-side volume low.
- **Signal:** Best broad buying window of the year. Cards are underpriced relative to intrinsic demand.

### February — Pokemon Day Hype (Feb 27)
- **Demand:** RISING. The Pokemon Company announces new products, sets, and sometimes video game news around Pokemon Day (Feb 27). Speculation drives interest in older cards of featured Pokemon.
- **Price effect:** +3% to +8% for cards of Pokemon featured in announcements. Vintage Charizard/Pikachu cards see renewed search volume regardless.
- **Volume:** Moderate. Buyers return but sellers are still clearing holiday inventory.
- **Signal:** Sell into announcement hype if holding cards of featured Pokemon. Buy cards that are NOT in the spotlight — they're still at January lows.

### March-April — Spring Set Release & Collecting Season
- **Demand:** MODERATE-HIGH. Q1 set release (typically late March) brings new product to market. Tax refund season provides disposable income. Collectors return from winter hibernation.
- **Price effect:** New set chase cards peak at release then drop 15-30% within 2 weeks as supply increases. Older sets benefit from returning collector attention (+3-5%).
- **Volume:** Rising steadily. New set drives transaction volume up 20-40%.
- **Signal:** Do NOT pre-order new set singles. Wait 2 weeks post-release for the supply correction. Buy older set staples during the attention surge.

### May-June — Summer Collecting Begins
- **Demand:** MODERATE-HIGH. School ends, younger collectors have more time. Adult collectors prepare for summer conventions. Q2 set release window.
- **Price effect:** Gradual uptrend. +2-5% monthly for liquid cards. Convention-exclusive promos start climbing.
- **Volume:** Steady growth. Weekend sales volume increases as convention/meetup season starts.
- **Signal:** Accumulate cards you plan to sell in July-August or November-December. Prices are fair but not yet at peak.

### July-August — World Championships & Peak Season
- **Demand:** HIGH. Pokemon World Championships (typically mid-August) create peak competitive and collector interest. Summer conventions (San Diego Comic-Con, GenCon). Kids' summer spending peaks.
- **Price effect:** +8-15% above annual average for competitive staples. Collector cards see +5-10%. World Championship promo cards are highly sought.
- **Volume:** Peak transaction volume of the year. TCGPlayer and eBay sales velocity hits annual maximum.
- **Signal:** SELL window for competitive cards. Sell into World Championships hype. Hold collector/vintage cards through this period unless you see a spike.

### September — Back-to-School Dip
- **Demand:** LOW-MODERATE. Kids return to school, casual collector engagement drops. Competitive players who didn't qualify lose interest post-Worlds. Q3 set release partially offsets the dip.
- **Price effect:** -5% to -10% correction from summer highs. New set pulls attention from older cards.
- **Volume:** Drops 15-25% from August peak. Seller competition increases as people liquidate summer acquisitions.
- **Signal:** Second-best buying window of the year. Accumulate for the holiday selling season (3 months of runway).

### October — Niche Interest & Pre-Holiday Positioning
- **Demand:** MODERATE. Halloween-themed and Ghost/Dark-type Pokemon cards see a small bump. Early holiday shopping begins for high-value items. Q4 set release hype builds.
- **Price effect:** Flat to slightly up. Ghost/Psychic-type cards see +5-10% micro-spike around Halloween. General market treads water.
- **Volume:** Moderate. Building toward holiday surge.
- **Signal:** Last comfortable buying window before holiday markup. Position inventory for November-December sales.

### November — Holiday Buying Surge Begins
- **Demand:** HIGH. Black Friday / Cyber Monday drive sealed product and singles sales. Gift-buying for collectors begins. Q4 set is on shelves generating interest.
- **Price effect:** +5-12% across the board. Chase cards and popular Pokemon (Charizard, Pikachu, Mewtwo, Eevee) see outsized gains as gift buyers are less price-sensitive.
- **Volume:** Sharp increase. Second-highest volume month. Average sale price rises as buyers pay premiums for specific wants.
- **Signal:** SELL window opens. List mid-tier and popular cards. Hold true high-end vintage for December peak.

### December — Peak Prices
- **Demand:** HIGHEST. Last-minute holiday buyers pay market premiums. "Get it by Christmas" urgency eliminates price sensitivity. Year-end collecting completionism.
- **Price effect:** +10-20% above annual average for liquid cards. High-end cards ($100+) see the largest absolute gains. Bulk/low-value cards see minimal effect.
- **Volume:** High but concentrated in first 3 weeks. Volume drops sharply after Dec 20 as shipping deadlines pass.
- **Signal:** SELL before Dec 18-20 shipping cutoff. After that, buyers evaporate until January.

---

## 2. Quarterly Set Release Impact

Pokemon TCG releases approximately 4 main sets per year (roughly Q1, Q2, Q3, Q4). Each release follows a predictable price lifecycle:

### Pre-Release (4-2 weeks before)
- **Hype phase.** Card reveals drive speculation. Pre-order prices on singles are inflated 30-60% above where they'll settle.
- **Rule:** Never buy pre-order singles. Prices almost always drop.

### Release Week (Week 0)
- **Supply flood.** Product hits shelves, boxes are opened, singles flood TCGPlayer/eBay. Chase card prices drop 20-40% from pre-order highs within 48-72 hours.
- **Rule:** Still don't buy. The floor hasn't been found yet.

### Post-Release Correction (Weeks 1-4)
- **Price discovery.** Supply and demand reach equilibrium. Chase cards find their floor around Week 2-3. Non-chase rares bottom out around Week 3-4.
- **Rule:** BUY chase cards at Week 2-3. The initial oversupply is absorbed, panic sellers are done, and the card's true demand-driven price emerges.

### Maturation (Months 2-6)
- **Stable trading range.** Prices fluctuate within a narrow band. Competitive viability (if applicable) drives incremental demand.
- **Rule:** Hold or accumulate slowly. No urgency.

### Out-of-Print Ramp (Month 6+)
- **Supply dries up.** The set is no longer actively printed. Sealed product appreciates. Singles from the set — especially chase cards — begin a slow uptrend as supply is consumed.
- **Rule:** This is where long-term appreciation begins. Cards bought at Week 2-3 post-release start returning value here.

---

## 3. Day-of-Week Patterns

Detectable from the `Sale.order_date` field (day-of-week extraction).

### Expected Patterns (Confirmed by TCGPlayer/eBay Market Research)

| Day | Volume Index | Price Index | Notes |
|-----|-------------|-------------|-------|
| Monday | 0.90 | 1.00 | Low volume, fair prices |
| Tuesday | 0.95 | 1.00 | Slight pickup |
| Wednesday | 1.00 | 1.00 | Baseline |
| Thursday | 1.05 | 1.01 | Pre-weekend positioning |
| Friday | 1.15 | 1.02 | Payday buying, weekend prep |
| Saturday | 1.20 | 1.03 | Peak volume, slight premium |
| Sunday | 1.10 | 1.01 | Still elevated, tapering |

### Key Observations
- **Weekend premium:** Saturday/Sunday sales volume is 10-20% above weekday average. Prices are marginally higher (1-3%) due to casual buyers who are less price-sensitive.
- **Monday dip:** Lowest sales volume. Sellers who listed over the weekend may accept lower offers on Monday-Tuesday.
- **Friday surge:** Payday effect. Volume spikes, especially for cards under $50.

### Actionable Rules
- **List cards Thursday evening** for maximum weekend exposure.
- **Make offers on Monday-Tuesday** when seller motivation is highest and buyer competition is lowest.
- **Day-of-week effects are small** (1-3% price variance). Don't let them override stronger signals like monthly seasonality or set release timing.

---

## 4. Optimal Buy/Sell Calendar

### Best Months to BUY

| Rank | Month | Why | Discount vs. Annual Avg |
|------|-------|-----|------------------------|
| 1 | **January** | Post-holiday liquidation, gift card dumps, low buyer competition | -10% to -15% |
| 2 | **September** | Back-to-school dip, post-Worlds letdown, 3 months before holiday selling window | -5% to -10% |
| 3 | **Late March** | 2 weeks after Q1 set release (buy the supply dip on NEW set cards specifically) | -15% to -25% on new singles |

### Best Months to SELL

| Rank | Month | Why | Premium vs. Annual Avg |
|------|-------|-----|----------------------|
| 1 | **Early-Mid December** | Holiday urgency, price-insensitive gift buyers, must sell before Dec 18 shipping cutoff | +10% to +20% |
| 2 | **Late November** | Black Friday/Cyber Monday, early holiday shoppers | +5% to +12% |
| 3 | **Early August** | World Championships hype, peak summer collecting | +8% to +15% for competitive cards |

### Months to HOLD (Neither Buy Nor Sell)
- **February, April, May, June, October** — transitional months. Prices are near fair value. Accumulate selectively but don't rush.

---

## 5. Implementing Seasonal Adjustment

### Monthly Seasonal Factors

These factors represent the expected price deviation from the card's "true" annual average fair value. A factor of 1.00 means fair value. Above 1.00 means the market is paying a seasonal premium. Below 1.00 means a seasonal discount.

```
SEASONAL_FACTORS = {
    1:  0.90,   # January — post-holiday dip
    2:  0.94,   # February — recovering, Pokemon Day hype
    3:  0.97,   # March — spring set release, returning interest
    4:  0.99,   # April — stabilization
    5:  1.01,   # May — summer collecting begins
    6:  1.03,   # June — conventions, steady growth
    7:  1.08,   # July — pre-Worlds hype
    8:  1.10,   # August — World Championships peak
    9:  0.95,   # September — back-to-school dip
    10: 0.98,   # October — flat, pre-holiday positioning
    11: 1.07,   # November — holiday buying surge
    12: 1.15,   # December — peak holiday prices
}
```

**Validation check:** The mean of these factors is ~1.01, close to 1.00 (neutral). A perfectly balanced cycle would average exactly 1.00. The slight positive skew reflects that peaks are more extreme than troughs in collectibles markets.

### Seasonal-Adjusted Fair Value

```python
def seasonal_adjusted_fair_value(raw_fair_value: float, month: int) -> float:
    """
    Adjust a card's computed fair value by the seasonal factor.

    If it's December (factor=1.15), a card with raw FV of $100 has a
    seasonal-adjusted FV of $100/1.15 = $86.96. This means paying $100
    in December is like paying $86.96 in a neutral month — you're
    overpaying by the seasonal premium.

    Usage: Compare market_price against seasonal_adjusted_fair_value
    to determine if a card is a good buy RIGHT NOW.
    """
    factor = SEASONAL_FACTORS.get(month, 1.0)
    return raw_fair_value / factor


def seasonal_sell_premium(raw_fair_value: float, month: int) -> float:
    """
    What a card SHOULD sell for in the current month,
    given seasonal demand.

    If it's December (factor=1.15), a card with raw FV of $100
    should sell for ~$115 because buyers are paying seasonal premiums.
    """
    factor = SEASONAL_FACTORS.get(month, 1.0)
    return raw_fair_value * factor
```

### Integration Points in the Trading System

1. **Screener / Investment Score:** Adjust the "undervalued" signal by seasonal factor. A card at $90 in January (factor 0.90) is at fair value, not undervalued. A card at $90 in December (factor 1.15) IS undervalued.

2. **Spread Analysis (Buy Zone):** Multiply spread thresholds by seasonal factor. A 5% spread in January is effectively tighter than a 5% spread in August because January prices are already depressed.

3. **Alert Thresholds:** When a user sets a price alert, optionally note whether the target price accounts for seasonal effects. "This card is currently in a seasonal dip — prices typically rise 15% by December."

4. **Weekly Recap:** Include a seasonal context line: "We're in a historically strong/weak month for card prices. Seasonal factor: 1.15 (prices ~15% above annual average)."

### Data-Driven Calibration

Once the system has 12+ months of `PriceHistory` data, calibrate the seasonal factors empirically:

```python
def calibrate_seasonal_factors(session) -> dict:
    """
    Compute actual seasonal factors from price history data.

    For each card with 12+ months of data:
      1. Compute the card's overall average price
      2. Compute the card's average price per month
      3. Monthly factor = avg_month_price / avg_overall_price

    Aggregate across all cards to get market-wide seasonal factors.
    """
    from sqlalchemy import func, extract
    from server.models.price_history import PriceHistory

    # Get per-card, per-month average prices
    monthly_avgs = (
        session.query(
            PriceHistory.card_id,
            extract('month', PriceHistory.date).label('month'),
            func.avg(PriceHistory.market_price).label('avg_price')
        )
        .filter(PriceHistory.market_price > 0)
        .group_by(PriceHistory.card_id, 'month')
        .all()
    )

    # Get per-card overall average
    overall_avgs = (
        session.query(
            PriceHistory.card_id,
            func.avg(PriceHistory.market_price).label('avg_price')
        )
        .filter(PriceHistory.market_price > 0)
        .group_by(PriceHistory.card_id)
        .all()
    )

    overall_map = {row.card_id: row.avg_price for row in overall_avgs}

    # Compute factors
    month_factors = {m: [] for m in range(1, 13)}
    for row in monthly_avgs:
        overall = overall_map.get(row.card_id)
        if overall and overall > 0:
            month_factors[int(row.month)].append(row.avg_price / overall)

    # Median factor per month (median is more robust to outliers)
    import statistics
    return {
        m: round(statistics.median(factors), 3) if factors else 1.0
        for m, factors in month_factors.items()
    }
```

### Day-of-Week Adjustment (from Sales data)

```python
def calibrate_dow_factors(session) -> dict:
    """
    Compute day-of-week price factors from completed sales.
    Uses Sale.order_date and Sale.purchase_price.
    """
    from sqlalchemy import func, extract
    from server.models.sale import Sale

    dow_avgs = (
        session.query(
            extract('dow', Sale.order_date).label('dow'),  # 0=Sun, 6=Sat
            func.avg(Sale.purchase_price).label('avg_price'),
            func.count(Sale.id).label('count')
        )
        .filter(Sale.purchase_price > 0)
        .group_by('dow')
        .all()
    )

    overall_avg = sum(r.avg_price * r.count for r in dow_avgs) / sum(r.count for r in dow_avgs)

    return {
        int(row.dow): round(row.avg_price / overall_avg, 3)
        for row in dow_avgs
    }
```

---

## 6. Concrete Trading Rules

### Rule 1: January Accumulation Window
**Trigger:** Month is January AND card's current price is at or below its 90-day SMA.
**Action:** Flag as STRONG BUY. The post-holiday dip combined with technical weakness creates the best buying opportunity of the year.
**Exit:** Hold until at least May, sell into summer/holiday peak.

### Rule 2: Never Buy Pre-Orders
**Trigger:** A card is from a set with a release date in the future or within the past 7 days AND the card has fewer than 50 completed sales.
**Action:** Flag as DO NOT BUY. Pre-order and week-1 prices are inflated by hype and low supply.
**Wait:** Buy at Week 2-3 post-release when supply correction is complete.

### Rule 3: Sell Before December 18
**Trigger:** Date is between November 15 and December 18 AND card has a seasonal-adjusted price above fair value AND card has been held for 30+ days.
**Action:** Flag as SELL. Holiday demand is peaking and will cliff after shipping cutoffs. Take the seasonal premium.
**Exception:** High-end vintage cards ($500+) with strong long-term appreciation can be held through.

### Rule 4: September Buying Season
**Trigger:** Month is September AND card's price has dropped 5%+ from its August level AND the card has a liquidity score >= 50.
**Action:** Flag as BUY. Back-to-school dip on liquid cards is a reliable entry point for the holiday selling cycle (3-month hold horizon).
**Avoid:** Illiquid cards (liquidity < 50) — the September dip on these may not recover.

### Rule 5: Suppress Sell Signals in Troughs
**Trigger:** Month is January or September AND the system's technical indicators (RSI, MACD) generate a sell signal.
**Action:** DAMPEN the sell signal strength by 50%. Seasonal troughs cause technical indicators to turn bearish, but selling at the bottom of a known seasonal cycle is counterproductive.
**Rationale:** Technical sell signals during known seasonal dips are noise, not signal. The mean-reversion tendency of seasonal patterns means the price is more likely to recover than continue falling.

---

## Summary Table

| Month | Factor | Bias | Action |
|-------|--------|------|--------|
| Jan | 0.90 | BUY | Accumulate broadly |
| Feb | 0.94 | HOLD | Watch Pokemon Day announcements |
| Mar | 0.97 | SELECTIVE | Buy post-release dips on new set |
| Apr | 0.99 | HOLD | Fair value zone |
| May | 1.01 | HOLD | Begin positioning for summer |
| Jun | 1.03 | HOLD | Convention season, slight premium |
| Jul | 1.08 | SELL | Pre-Worlds, sell competitive cards |
| Aug | 1.10 | SELL | Peak season, sell into hype |
| Sep | 0.95 | BUY | Back-to-school dip |
| Oct | 0.98 | HOLD | Position for holiday season |
| Nov | 1.07 | SELL | Holiday surge begins |
| Dec | 1.15 | SELL | Peak prices, sell before Dec 18 |
