# Risk Management Framework for Pokemon Card Prop Trading

## System Context

This framework governs the automated prop trading engine defined in `virtual_trader.py`,
with signal generation from `prop_strategies.py` and fee modeling from `trading_economics.py`.
Starting capital: $10,000. Platform: TCGPlayer. All numbers below are calibrated to this
portfolio size and fee structure.

---

## 1. Position Sizing Framework (Kelly Criterion Adaptation)

### The Problem with Full Kelly in Collectibles

Standard Kelly assumes continuous markets, instant execution, and normally distributed
returns. Pokemon cards violate all three: markets are episodic (someone lists or doesn't),
execution takes days, and returns are fat-tailed (a card either catches a hype wave or
sits flat). Full Kelly would massively oversize positions.

### Adapted Formula

```
kelly_fraction = (win_rate * avg_win - (1 - win_rate) * avg_loss) / avg_win
adjusted_kelly = kelly_fraction * KELLY_DAMPENER
position_dollars = min(
    adjusted_kelly * portfolio_value,
    max_position_dollar,
    max_position_pct * portfolio_value,
    liquidity_adjusted_max
)
quantity = floor(position_dollars / card_price)
```

**Variables mapped to our data:**

| Variable | Source | Current Code Location |
|----------|--------|-----------------------|
| `win_rate` | `winning_trades / total_trades` from `get_performance_analytics()` | `virtual_trader.py:819` |
| `avg_win` | Mean `realized_pnl` of winning sells | `virtual_trader.py:821` |
| `avg_loss` | Mean `abs(realized_pnl)` of losing sells | `virtual_trader.py:822` |
| `portfolio_value` | `portfolio.total_value` | `virtual_trader.py:466` |
| `max_position_dollar` | `portfolio_value * 0.10` | `prop_strategies.py:61` |
| `max_position_pct` | 0.10 (10%) | `prop_strategies.py:61` |
| `liquidity_adjusted_max` | See Section 5 below | -- |

**Parameters:**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `KELLY_DAMPENER` | 0.33 (one-third Kelly) | Standard fractional Kelly range for illiquid assets is 0.25-0.50. We use 0.33 because: (a) price data updates every 6-12 hours, not real-time, so our edge estimate has significant measurement error; (b) we cannot exit instantly if wrong; (c) one-third Kelly reduces the probability of a 50% drawdown from ~25% (full Kelly) to ~3.7%. |
| `MIN_KELLY_FRACTION` | 0.02 | Floor: never allocate less than 2% of portfolio to a position (otherwise not worth the effort given fixed shipping costs). |
| `MAX_KELLY_FRACTION` | 0.10 | Ceiling: hard cap at 10% regardless of Kelly output. |

**Bootstrap period:** Until the portfolio has completed at least 20 round-trip trades,
use a conservative prior of `win_rate=0.55, avg_win=15%, avg_loss=12%` rather than
the actual (statistically meaningless) sample. This yields:

```
kelly = (0.55 * 0.15 - 0.45 * 0.12) / 0.15 = (0.0825 - 0.054) / 0.15 = 0.19
adjusted = 0.19 * 0.33 = 0.063 -> ~6.3% of portfolio per position
```

This aligns well with the current `MAX_SINGLE_POSITION_PCT = 0.10` cap.

### Current Code Gap

The existing `calculate_position_size()` in `prop_strategies.py:586-640` uses a simplified
version (`kelly_fraction = 0.3 + signal_strength * 0.7`) that is signal-strength-based but
not derived from actual portfolio win/loss statistics. The recommendation is to feed actual
`win_rate`, `avg_win`, and `avg_loss` from `get_performance_analytics()` into the Kelly
formula once 20+ trades are completed.

---

## 2. Stop-Loss Strategy for Collectibles

### Why Standard Price Stops Fail

1. **No instant exit.** When a stock hits your stop at $48, your broker fills you in
   milliseconds. When a Pokemon card "hits your stop," you still need to list it, wait for
   a buyer, and ship it. By the time you exit, the price may have moved further.

2. **Price gaps are the norm.** Card prices update when someone sells. A card might show
   $50 on Monday, then $40 on Thursday because a single seller undercut the market. That's
   not a trend -- it's one data point.

3. **Data anomalies.** A single damaged-card sale on TCGPlayer can drag the "market price"
   down 20%. It's noise, not signal.

### Recommended Stop-Loss Tiers

Instead of a single price stop, use a layered approach:

**Tier 1: Trailing Stop on 30-Day SMA (primary)**
```
stop_trigger = current_price < SMA_30 * (1 - TRAILING_BUFFER)
TRAILING_BUFFER = 0.10  (10% below 30d SMA)
```
- The 30d SMA smooths out single-sale anomalies.
- 10% buffer prevents whipsawing on normal volatility.
- Only triggers if the SMA itself is also declining (slope negative over last 7 data points).

**Tier 2: Velocity Dry-Up Stop**
```
stop_trigger = sales_per_day < 0.05 AND days_held > 30
```
- If nobody is buying a card, the market is telling you something.
- 30-day grace period prevents triggering on seasonal lulls.
- This is already partially implemented in `check_sell_signals()` at the 0.1/day threshold
  (`prop_strategies.py:550`). Tighten to 0.05 for the stop-loss layer.

**Tier 3: Catastrophic Stop (hard floor)**
```
stop_trigger = current_price < entry_price * 0.70  (30% loss from entry)
```
- Regardless of SMA or velocity, a 30% decline from entry is an unconditional exit.
- This protects against structural breaks (card gets banned, reprinted, etc.).
- Current code uses 15% (`DEFAULT_STOP_LOSS_PCT = 0.15` in `prop_strategies.py:65`).
  This is too tight for collectibles -- it will trigger on normal fluctuations. Widen to 30%.

**Tier 4: Time-Based Stop**
```
stop_trigger = days_held > 90 AND unrealized_return < 0.05  (5%)
```
- Already implemented as "stale position" in `prop_strategies.py:67-68`.
- The 90 days / 5% threshold is appropriate. Keep as-is.

### Current Code Changes Needed

- `DEFAULT_STOP_LOSS_PCT`: Change from 0.15 to 0.30 in `prop_strategies.py:65`.
- Add SMA-based trailing stop to `check_sell_signals()`: trigger when price falls 10%
  below a declining 30d SMA.
- Tighten the velocity dry-up threshold from 0.1 to 0.05 sales/day in
  `check_sell_signals()` at line 550.

---

## 3. Portfolio Concentration Limits

### Current Limits (from `prop_strategies.py`)

| Limit | Current Value | Line |
|-------|---------------|------|
| Max single position | 10% of portfolio | 61 |
| Max single set | 30% of portfolio | 62 |
| Max positions | 20 | 60 |
| Cash reserve | 20% | 63 |

### Recommended Limits

| Dimension | Limit | Rationale |
|-----------|-------|-----------|
| **Max single card** | **8%** of portfolio ($800 on $10k) | Reduce from 10%. A single card failing should not produce more than ~10% drawdown after slippage and fees. At 8% position + 25% slippage on a forced exit, worst case single-card loss = 8% * (1 + 0.25 slippage + 0.1255 fees) = ~11% of portfolio. |
| **Max single set** | **25%** of portfolio ($2,500) | Reduce from 30%. Pokemon sets often move together (reprints, set rotation hype). If Evolving Skies crashes, you don't want 30% of your book in it. |
| **Max rarity tier** | **40%** in any single rarity bucket | New. Define tiers: Ultra Rare / Rare Holo / Rare / Common-Uncommon. URs have correlated risk (chase-card dynamics). Cap exposure. |
| **Max vintage (pre-2020)** | **30%** of portfolio | Vintage cards are less liquid and more susceptible to grading/condition repricing. |
| **Max modern (2020+)** | **70%** of portfolio | Modern cards are more liquid but more volatile. This is a soft preference, not a hard limit on vintage. |
| **Max positions** | **15** (reduce from 20) | At $10k portfolio, 20 positions averages $500 each -- too thin after fees. 15 positions at ~$667 avg gives more room per position. |
| **Cash reserve** | **25%** of portfolio ($2,500) | Increase from 20%. Cash serves two purposes: (a) dry powder for opportunities (mean reversion buys need fast capital), (b) buffer against margin-call-equivalent scenarios (needing to buy shipping supplies, absorb returns). 25% provides meaningful optionality. |

### Why Cash Reserve Matters (Detailed)

In equities, you can always sell to raise cash. In collectibles, selling takes days to weeks.
If three great buying opportunities appear simultaneously (e.g., a set tanks after a reprint
announcement), you need cash on hand to buy the dip. Historical pattern: the best Pokemon
card buying opportunities come from panic sellers after negative announcements, and these
windows last 3-7 days. Without 25% cash, you miss them.

Additionally, the TCGPlayer fee structure means every sell costs ~18% all-in (12.55% fees +
slippage). Selling a position to fund another position is extremely expensive. Cash avoids
this double-fee drag.

---

## 4. Drawdown Management

### Circuit Breaker Framework

The portfolio tracks `high_water_mark` and `drawdown_pct` already (see `virtual_trader.py:469`
and `PortfolioSnapshot.drawdown_pct`). Layer the following rules on top:

| Drawdown Level | Action | Implementation |
|----------------|--------|----------------|
| **0-7%** | Normal operations. | No change to position sizing or buy frequency. |
| **7-10%** (Yellow) | **Reduce new position sizes by 50%.** | Multiply `kelly_fraction` by 0.50. Reduce `MAX_NEW_BUYS_PER_CYCLE` from 3 to 1. Log a warning. |
| **10-15%** (Orange) | **Stop all new buys. Sell only on strong signals.** | Set `MAX_NEW_BUYS_PER_CYCLE = 0`. Only execute sells with `sell_strength >= 0.7` (stop-loss, take-profit, or strong technicals). Do not sell on weak signals -- avoid panic liquidation into illiquid markets. |
| **15-20%** (Red) | **Active de-risking. Trim largest positions by 50%.** | Sort positions by dollar value descending. For the top 3 positions, sell 50% of quantity. This raises cash and reduces concentration. |
| **>20%** (Critical) | **Liquidate bottom quartile by unrealized P&L.** | Sort positions by `unrealized_pnl_pct` ascending. Sell the bottom 25% (worst performers). Then pause the portfolio (`is_active = False`) and require manual reactivation. This prevents the system from compounding losses in a structural downturn. |

### Drawdown Recovery Protocol

After hitting Orange (10%+), the portfolio does not return to Normal until:
1. Drawdown recovers to below 5% (not just below 10% -- hysteresis prevents oscillation).
2. At least 7 calendar days have passed since the drawdown trough.
3. The win rate on the last 5 completed trades is >= 50%.

This prevents the system from immediately re-leveraging after a brief recovery that may
be a dead-cat bounce.

### Implementation Notes

The current code computes `drawdown_pct` in `take_portfolio_snapshot()` (line 536) but
does not act on it. The `run_trading_cycle()` function should read the current drawdown
level and apply the appropriate circuit breaker before entering the buy signal phase.

---

## 5. Liquidity Risk

### Position Sizing as a Function of Liquidity

The core principle: **your position size should be inversely proportional to how long
it takes to exit.** A position you cannot sell is worth zero in a crisis.

### Formula

```
liquidity_max_pct = min(10%, 2% + ln(sales_per_day + 1) * 5%)
position_max = portfolio_value * liquidity_max_pct
```

| Sales/Day | ln(spd + 1) | 2% + ln * 5% | Capped at | Rationale |
|-----------|-------------|--------------|-----------|-----------|
| 0.00 | 0.000 | 2.0% | 2.0% | Nearly untradeable. Absolute minimum. |
| 0.05 | 0.049 | 2.2% | 2.2% | ~1 sale per 20 days. Very illiquid. |
| 0.10 | 0.095 | 2.5% | 2.5% | ~3 sales/month. Still hard to exit. |
| 0.30 | 0.262 | 3.3% | 3.3% | ~9 sales/month. Moderate liquidity. |
| 0.50 | 0.405 | 4.0% | 4.0% | ~15 sales/month. Decent. |
| 1.00 | 0.693 | 5.5% | 5.5% | Daily sale. Good liquidity. |
| 2.00 | 1.099 | 7.5% | 7.5% | Strong liquidity. |
| 3.00+ | 1.386+ | 8.9%+ | 10.0% | Very liquid. Cap at max. |

### Integration with Kelly Sizing

The final position size is the minimum of three constraints:

```
final_position = min(
    kelly_adjusted_size,          # Section 1
    liquidity_max_pct * portfolio, # This section
    max_single_card_pct * portfolio # Section 3 (8%)
)
```

### Current Code Gap

The existing `calculate_position_size()` does not reference liquidity data at all. It
caps by price tier (1-3 copies) and cash availability, but a $15 card with 0 sales/day
gets the same sizing treatment as a $15 card with 2 sales/day. The liquidity-adjusted
max should be added as an additional constraint.

The slippage model in `virtual_trader.py:88-140` already tiers by liquidity, which
naturally penalizes illiquid trades. But slippage is a cost -- it doesn't prevent the
position from being opened. The position sizing cap prevents overexposure.

---

## 6. Fee Drag Management

### TCGPlayer Fee Reality

From `trading_economics.py`, the actual all-in cost structure:

```
Commission:           10.75% of sale price
Payment processing:    2.50% + $0.30 flat
Tracked shipping:     $4.50 per shipment
--------------------------------------------
Total sell-side:      ~13.55% + $4.80 fixed
```

Breakeven appreciation by price point (from `calc_breakeven_appreciation()`):

| Buy Price | Breakeven Appreciation | Implication |
|-----------|----------------------|-------------|
| $10 | 72.2% | **Not viable.** Fees destroy any realistic gain. |
| $20 | 41.8% | Marginal. Need a major move to profit. |
| $50 | 22.2% | Viable for medium-term holds. |
| $100 | 17.6% | Good. Standard appreciation can clear this. |
| $250 | 14.9% | Strong. Fee drag is manageable. |
| $500 | 13.8% | Excellent. Near the theoretical floor of ~13.25%. |

### Rules

1. **Minimum card price: $20** (already enforced by `is_viable_trade()` at line 391
   of `trading_economics.py`). The current `MIN_PRICE = $5` in `prop_strategies.py:57`
   is too low -- cards under $20 require 40%+ appreciation to break even. Change to $20.

2. **Minimum hold rule:** Do not sell a card until:
   ```
   current_price >= entry_price * (1 + breakeven_appreciation / 100 + 0.05)
   ```
   The extra 5% above breakeven ensures the trade is actually profitable after slippage,
   not just fee-neutral. For a $50 card, this means: don't sell below $50 * 1.272 = $63.60.

3. **Fee drag tracking:** Add a portfolio-level metric:
   ```
   cumulative_fee_drag = sum(all_trade.fee_cost) + sum(all_trade.slippage_cost)
   fee_drag_pct = cumulative_fee_drag / starting_capital * 100
   ```
   Target: keep annual fee drag below 15% of starting capital. If fee drag exceeds this,
   the system is overtrading.

4. **Churning prevention:** Maximum of 6 sell trades per month across the portfolio. Each
   sell costs 13-18% all-in. At 6 sells/month on an average $50 position, that's
   ~$54/month in fees -- 6.5% annualized drag on $10k. Acceptable. At 12 sells/month,
   the drag doubles to 13% annualized, which will eat most of your alpha.

### Current Code Gap

The `virtual_trader.py` sell execution correctly computes `fee_cost` and `slippage_cost`
per trade, but there is no aggregate fee drag metric tracked at the portfolio level.
Add `cumulative_fees` and `cumulative_slippage` columns to `VirtualPortfolio` and
increment on each trade.

---

## 7. Slippage Risk

### Current Model Assessment

The existing slippage tiers from `virtual_trader.py:88-140`:

| Tier | Liquidity Score | Sales/Day | Slippage Range |
|------|----------------|-----------|----------------|
| Very Low | -- | < 0.1 | 15-25% |
| Low | < 40 | 0.1-0.3 | 7-15% |
| Medium | 40-70 | 0.3-1.0 | 3-7% |
| High | >= 70 | >= 1.0 | 1-3% |

### Is This Realistic?

**Mostly yes, with adjustments needed for the buy side.**

TCGPlayer actual spread data (estimated from marketplace observation):

- **High liquidity modern staples** (Charizard ex, Giratina VSTAR): Listed spread
  between lowest NM and market price is typically 2-5%. The model's 1-3% for high
  liquidity is slightly optimistic for buys (you typically pay the ask, which is
  above market), but reasonable.

- **Mid-tier cards** ($20-50, moderate sales): Spread is typically 5-12%. The model's
  3-7% may be slightly low. Many mid-tier cards have only 2-5 NM listings, meaning
  you may need to buy the second or third cheapest copy.

- **Low liquidity vintage**: Spreads can be 15-30%+. A Base Set Blastoise might have
  a "market price" of $45 but the cheapest NM listing is $55 (22% above market).
  The model's 7-15% for low liquidity may understate this.

- **Very low liquidity**: 15-25% is actually conservative for truly illiquid cards.
  Some vintage promos have no NM listings at all. But since we filter these out
  via `MIN_LIQUIDITY = 20`, the tail risk is managed.

### Proposed Improved Model

```python
def calculate_slippage_v2(
    card_price: float,
    liquidity_score: float,
    sales_per_day: float,
    is_buy: bool = True,
) -> float:
    """Asymmetric slippage: buys cost more than sells save.

    Key insight: when BUYING, you must pay the ask (above market).
    When SELLING, you must accept the bid (below market). But on
    TCGPlayer, the buyer picks from listed prices (you compete on
    price as a seller), so sell slippage is WORSE than buy slippage
    for illiquid cards.
    """
    # Base slippage (same tiers as current model)
    if sales_per_day < 0.1:
        base = 0.25 - (sales_per_day / 0.1) * 0.10  # 25% -> 15%
    elif sales_per_day < 0.3:
        ratio = (sales_per_day - 0.1) / 0.2
        base = 0.15 - ratio * 0.08  # 15% -> 7%
    elif sales_per_day < 1.0:
        ratio = (sales_per_day - 0.3) / 0.7
        base = 0.07 - ratio * 0.04  # 7% -> 3%
    elif sales_per_day < 3.0:
        ratio = (sales_per_day - 1.0) / 2.0
        base = 0.03 - ratio * 0.02  # 3% -> 1%
    else:
        base = 0.01

    # Asymmetry adjustment
    if is_buy:
        # Buy slippage is slightly less than sell slippage for liquid cards
        # (you can pick from listings) but equal for illiquid cards
        return base * 0.85 if sales_per_day >= 0.5 else base
    else:
        # Sell slippage is the full base (you must price competitively)
        # Plus: for illiquid cards, you may need to undercut further
        return base * 1.10 if sales_per_day < 0.3 else base
```

### Slippage Impact on Break-Even

Adding realistic slippage to the fee analysis:

| Card Price | Liquidity | Buy Slippage | Sell Slippage | Fees | Total Round-Trip Cost | Required Appreciation |
|-----------|-----------|-------------|-------------|------|----------------------|----------------------|
| $50 | High (1+ spd) | 2% | 2% | 13.6% | 17.6% | ~21% |
| $50 | Medium (0.5 spd) | 4% | 5% | 13.6% | 22.6% | ~28% |
| $50 | Low (0.1 spd) | 12% | 13% | 13.6% | 38.6% | ~50% |

This reinforces why liquidity-based position sizing (Section 5) is critical. A low-liquidity
card needs 50% appreciation to break even -- that should be reflected in smaller position sizes.

---

## 8. Rebalancing Rules

### When to Sell Winners

**Policy: Trim, don't dump. Let runners run with a ratcheting take-profit.**

The current `DEFAULT_TAKE_PROFIT_PCT = 0.30` (30% above entry) is a single static target.
This is suboptimal because Pokemon card price moves are momentum-driven -- a card that's
up 30% often continues to 50%+ if driven by competitive play demand or content creator hype.

**Recommended: Ratcheting Take-Profit**

```
Initial target:  30% above entry (current default -- keep)
First trigger:   When price hits +30%, sell 50% of position, raise stop to breakeven
Second trigger:  When remaining position hits +50%, sell another 50%, raise stop to +25%
Final:           Let the remainder ride with a trailing stop at 15% below peak
```

This captures the guaranteed profit (50% of position at +30%) while allowing the rest
to participate in further upside. The raised stop-loss ensures you never give back all gains.

### When to Average Down

**Policy: Almost never. And never more than once.**

Averaging down in collectibles is dangerous because:
1. The reasons for the decline may be structural (reprint, ban, market shift).
2. You're doubling exposure to a losing thesis.
3. The opportunity cost is high (that cash could fund a new, better signal).

**Strict conditions for averaging down (all must be true):**

| Condition | Threshold | Why |
|-----------|-----------|-----|
| Price decline from entry | 15-25% (not more) | If it's dropped >25%, the thesis is probably broken. |
| Sales velocity still active | >= 0.3 sales/day | Demand still exists; this is a price dislocation, not abandonment. |
| Regime | NOT markdown/distribution | Technicals confirm this is a dip, not a trend change. |
| Original signal strategy | Mean reversion or RSI oversold only | These are the only strategies designed for buying weakness. Don't average down on momentum or crossover trades. |
| Current position size after avg-down | < 6% of portfolio | Don't let one position become an outsized bet. |
| Number of avg-downs on this card | 0 (first and only) | One chance to be right. If the second buy also goes underwater, the thesis was wrong. |

### Portfolio Review Cadence

| Frequency | Action |
|-----------|--------|
| **Every trading cycle** (6-12 hours) | Automated: Run `check_sell_signals()` on all positions. Execute sells meeting criteria. Run `scan_for_signals()` for new buys. Take portfolio snapshot. |
| **Weekly** | Automated: Compute rolling 7-day win rate, fee drag, and concentration metrics. If win rate < 40% over last 10 trades, pause new buys for 48 hours. |
| **Monthly** | Manual review: Examine `by_strategy` and `by_signal` performance from `get_performance_analytics()`. Disable strategies with negative cumulative P&L after 30+ trades. Review set concentration -- if any set > 20%, actively trim. |
| **Quarterly** | Manual review: Compare portfolio Sharpe ratio to baseline (simply holding the top 10 most liquid cards). If the active strategy underperforms buy-and-hold by >5% over a quarter, reassess signal parameters. |

### Specific Parameters for Current Portfolio

Given the $10,000 starting capital:

- **Max round-trips per month:** 6 sells (see Section 6 churning prevention).
- **Rebalancing trigger:** When any single position exceeds 10% of portfolio value
  (not entry cost, current value), trim to 8%.
- **Set rebalancing trigger:** When any single set exceeds 25% of portfolio value, sell
  the weakest-performing card in that set.
- **Cash rebalancing:** If cash drops below 20% of portfolio, halt new buys until
  natural sells (take-profits, stop-losses) restore the reserve. Do not force-sell
  positions just to raise cash unless in a drawdown circuit-breaker scenario (Section 4).

---

## Summary: Parameter Reference Card

| Parameter | Value | Section |
|-----------|-------|---------|
| Kelly dampener | 0.33 (one-third Kelly) | 1 |
| Bootstrap prior win rate | 55% | 1 |
| Bootstrap prior avg win | 15% | 1 |
| Bootstrap prior avg loss | 12% | 1 |
| Min trades before real Kelly | 20 | 1 |
| Trailing stop buffer below SMA-30 | 10% | 2 |
| Velocity dry-up stop | < 0.05 sales/day | 2 |
| Catastrophic stop (hard floor) | 30% below entry | 2 |
| Stale position stop | 90 days / < 5% gain | 2 |
| Max single card | 8% of portfolio | 3 |
| Max single set | 25% of portfolio | 3 |
| Max rarity tier | 40% of portfolio | 3 |
| Max vintage allocation | 30% | 3 |
| Max modern allocation | 70% | 3 |
| Max concurrent positions | 15 | 3 |
| Cash reserve minimum | 25% | 3 |
| Drawdown Yellow (reduce sizing) | 7% | 4 |
| Drawdown Orange (stop buys) | 10% | 4 |
| Drawdown Red (trim top 3) | 15% | 4 |
| Drawdown Critical (liquidate bottom quartile) | 20% | 4 |
| Recovery hysteresis | Below 5% + 7 days + 50% win rate on last 5 | 4 |
| Liquidity position cap formula | min(10%, 2% + ln(spd+1) * 5%) | 5 |
| Min card price for trading | $20 | 6 |
| Min sell threshold | entry * (1 + breakeven% + 5%) | 6 |
| Max annual fee drag target | 15% of starting capital | 6 |
| Max sells per month | 6 | 6 |
| Take-profit initial target | 30% above entry | 8 |
| Take-profit first trim | Sell 50% at +30% | 8 |
| Take-profit second trim | Sell 50% of remainder at +50% | 8 |
| Trailing stop on runner | 15% below peak | 8 |
| Max avg-downs per card | 1 | 8 |
| Avg-down max resulting position | 6% of portfolio | 8 |
| Weekly win rate pause trigger | < 40% over last 10 trades | 8 |
