# Vintage Pokemon Card Investment Strategy Guide

**Scope:** Base Set through ex-era (1999-2005) — WotC and early Nintendo/TPC sets.

**Sets covered:** Base Set, Jungle, Fossil, Base Set 2, Team Rocket, Gym Heroes, Gym Challenge, Neo Genesis, Neo Discovery, Neo Revelation, Neo Destiny, Legendary Collection, Expedition, Aquapolis, Skyridge, EX Ruby & Sapphire through EX Power Keepers.

---

## 1. Vintage Card Price Drivers

### 1.1 Scarcity Hierarchy (strongest to weakest price driver)

| Factor | Impact | Details |
|--------|--------|---------|
| **1st Edition Holo (Base Set)** | 50-500x unlimited price | Print run: ~1-3 months of production before Unlimited took over. Charizard 1st Ed is the $300K+ ceiling. |
| **Shadowless (Base Set only)** | 3-10x unlimited price | Transitional print run between 1st Ed and Unlimited. No shadow on right edge of art box. Only exists for Base Set. |
| **e-Series Holos (Expedition/Aquapolis/Skyridge)** | High scarcity, rising fast | Smallest English print runs of the WotC era. Skyridge holos routinely $200-$1000+ raw. Aquapolis Crystal types are $500-$2000+. |
| **Neo Destiny Shining cards** | Fixed premium | 8 Shining cards (Charizard, Mewtwo, etc). Secret rares before "secret rare" was a thing. Shining Charizard raw NM: $400-$800. |
| **1st Edition (non-Base)** | 2-5x unlimited | Jungle/Fossil/Rocket 1st Ed holos are $50-$300 range. Gym/Neo 1st Ed holos $30-$200. |
| **Unlimited Holos** | Baseline | Most liquid vintage segment. Base Set Charizard Unlimited holo: $150-$300 raw NM. |
| **Non-Holo Rares** | Low-moderate | Generally $5-$50 range. Exception: 1st Ed non-holos from Base Set ($20-$100). |

### 1.2 Condition Rarity (the hidden multiplier)

Vintage NM is genuinely rare. These cards are 25+ years old. Most surviving copies are LP/MP/HP.

| Condition | % of Vintage Supply | Price Multiple vs LP |
|-----------|--------------------|-----------------------|
| PSA 10 / BGS 9.5 | <2% of graded population | 5-50x LP (exponential for iconic cards) |
| PSA 9 / BGS 9 | 5-10% of graded | 2-5x LP |
| NM (raw, grade-worthy) | ~10-15% of raw supply | 1.5-2.5x LP |
| LP | ~30% | 1.0x (baseline) |
| MP/HP/DMG | ~45-50% | 0.3-0.7x LP |

**Key insight for the system:** Our data tracks TCGPlayer market price by condition variant. For vintage, the NM price is what matters — LP prices are noise for investment purposes. When `price_condition = "Near Mint"` for vintage cards, the price already reflects the scarcity premium.

### 1.3 The Charizard Premium

Charizard cards command a 3-10x premium over equivalent cards from the same set/rarity tier. This applies across ALL eras but is most extreme in vintage:

- Base Set Charizard Holo Unlimited: ~$200 vs Blastoise ~$60 vs Venusaur ~$40
- 1st Edition: Charizard $5,000-$300,000 vs Blastoise $2,000-$8,000

**Other premium Pokemon (in order):** Charizard > Pikachu (promos) > Mewtwo > Lugia > Mew > Blastoise > Gengar > Dragonite > Umbreon/Espeon

### 1.4 Holo vs Non-Holo

For vintage WotC sets, the holo/non-holo gap is extreme:
- **Holo rare:** Meaningful investment asset ($20-$500+ NM)
- **Non-holo rare:** Generally not investable (<$15 most sets)
- **Exception:** 1st Edition non-holos from Base Set and certain promos

**System rule:** For vintage card investment signals, filter to `rarity IN ('Rare Holo', 'Rare Secret', 'Rare Holo EX')` or known promo cards. Non-holo vintage rares lack the scarcity and demand dynamics for investment returns.

---

## 2. Buy Signals for Vintage Cards

### 2.1 Seasonal Patterns (Calendar-Based Triggers)

Vintage Pokemon prices follow a predictable annual cycle:

| Period | Price Trend | Action |
|--------|------------|--------|
| **Jan-Feb** | Post-holiday dip (-5% to -15%) | **BUY ZONE.** Sellers who got cards as gifts dump them. Holiday spending hangover reduces buyer demand. |
| **Mar-Apr** | Recovery begins (+5%) | Hold or final buys before summer run-up. |
| **May-Jul** | Summer spike (+10-25%) | **SELL WINDOW for flips.** Nostalgia peaks, kids out of school, YouTube content creators drive hype. |
| **Aug-Sep** | Back-to-school dip (-5% to -10%) | **SECONDARY BUY ZONE.** Moderate dip as discretionary spending redirects. |
| **Oct** | Pre-holiday build (+5-10%) | Hold. |
| **Nov-Dec** | Holiday premium (+10-20%) | **SELL WINDOW.** Gift buying inflates prices. |

**System implementation:** Add a `seasonal_adjustment` modifier to buy signals for vintage cards:
- Jan 15 - Feb 28: boost buy signal strength by +0.15
- Aug 15 - Sep 30: boost buy signal strength by +0.10
- Jun 1 - Jul 31: suppress buy signal strength by -0.10
- Nov 15 - Dec 25: suppress buy signal strength by -0.10

### 2.2 Market Correction Buy Signals

Vintage cards dip during broader collectibles market corrections. These are the best entry points.

**Trigger conditions for vintage buy (adapt existing `_check_mean_reversion`):**

```
IF card.set_id IN VINTAGE_SET_IDS:
  AND current_price dropped >15% from 90d high (not 30d — vintage moves slower)
  AND sales_per_day >= 0.1 (at least 3 sales/month proves demand exists)
  AND rsi_14 < 35 (oversold but not dead)
  AND regime NOT IN ('markdown')  -- avoid catching falling knives
THEN:
  signal = BUY
  strength = 0.6 + (drop_pct - 0.15) * 2  # stronger signal for deeper drops
  target_price = 90d_sma  # vintage mean-reverts to longer moving averages
  stop_loss = entry * 0.80  # wider stop: 20% (vintage is volatile short-term)
  hold_target_days = 180  # expect 6-month recovery
```

### 2.3 New Collector Influx Signals

Major events that bring new money into vintage Pokemon:
- New Pokemon game/movie release (spillover nostalgia)
- YouTube/TikTok viral card opening videos
- Celebrity purchases (Logan Paul effect)
- PSA reopening after backlogs clear

These are hard to detect algorithmically, but their effect shows up as:
- **Sales velocity spike** (sales_per_day jumps >2x 30d average)
- **Spread compression** (new buyers fill the order book)
- **Price acceleration** (appreciation_slope goes from flat to >0.2%/day)

**Trigger:**
```
IF card.set_id IN VINTAGE_SET_IDS:
  AND sales_per_day > (2 * avg_sales_per_day_90d)
  AND spread_pct < 10
  AND appreciation_slope > 0.15
THEN:
  signal = BUY (momentum play — ride the wave)
  strength = 0.7
  target_price = entry * 1.25
  stop_loss = entry * 0.90  # tight stop — if momentum fades, exit
  hold_target_days = 30-60  # short hold — this is a momentum trade, not a value trade
```

---

## 3. Hold Duration Strategy

### 3.1 Vintage Hold Framework

Vintage Pokemon cards are NOT short-term flip assets (unlike modern chase cards). The existing system's 90-day stale position rule (`STALE_POSITION_DAYS = 90`) is too aggressive for vintage.

**Recommended hold tiers:**

| Card Type | Min Hold | Target Hold | Max Hold | Expected Annual Return |
|-----------|----------|-------------|----------|----------------------|
| 1st Ed Base Set Holos | 2 years | 5+ years | Indefinite | 15-30% |
| Shadowless Base Set | 1 year | 3-5 years | Indefinite | 10-20% |
| e-Series Holos (Skyridge/Aquapolis) | 1 year | 3+ years | Indefinite | 15-25% |
| Neo Destiny Shinings | 1 year | 3+ years | Indefinite | 10-20% |
| WotC Unlimited Holos (non-Charizard) | 6 months | 1-2 years | 3 years | 8-15% |
| 1st Ed non-Base Holos | 6 months | 1-2 years | 3 years | 8-12% |

### 3.2 Exit Rules for Vintage

**Override the existing 90-day stale rule for vintage cards:**

```python
# In check_sell_signals, modify the stale position check:
if card.set_id in VINTAGE_SET_IDS:
    STALE_POSITION_DAYS = 365      # 1 year, not 90 days
    STALE_GAIN_THRESHOLD = 0.08    # 8%, not 5%
    DEFAULT_STOP_LOSS_PCT = 0.20   # 20% stop, not 15%
    DEFAULT_TAKE_PROFIT_PCT = 0.50 # 50% target, not 30%
```

**Sell vintage when:**
1. **Take-profit hit (+50% or more)** — lock in gains, re-evaluate re-entry
2. **Secular trend break** — 90d SMA crosses below 200d SMA (death cross on longer timeframe)
3. **Liquidity evaporation** — sales_per_day drops below 0.03 (less than 1 sale/month) for 60+ days
4. **Fundamental change** — major reprint announcement in a premium product (though reprints historically don't hurt vintage — see Section 4)
5. **Portfolio rebalancing** — vintage exceeds 40% of total portfolio value

**Do NOT sell vintage on:**
- Short-term RSI overbought signals (vintage can stay "overbought" for months during bull runs)
- 7d/30d SMA death crosses (too short-term for vintage price action)
- Regime shift to "distribution" unless confirmed by 90d+ trend

### 3.3 Optimal Sell Windows

If you need to exit a vintage position, timing matters:
- **Best months to sell:** June-July, November-December (peak demand)
- **Worst months to sell:** January-February, August-September (buyer fatigue)
- If stop-loss is hit, sell immediately regardless of season

---

## 4. Risk Factors

### 4.1 Reprints

**Historical evidence says reprints do NOT devalue vintage originals.** In fact, they often increase vintage prices:
- Evolutions (2016) reprinted Base Set artwork — original Base Set prices increased as new collectors discovered the originals
- Celebrations (2021) reprinted iconic cards — originals spiked
- 151 (2023) reprinted Gen 1 — original WotC cards held or gained

**Why:** Reprints create new collectors who then want the "real" originals. The WotC-era card stock, holo pattern, and 1st Edition stamps cannot be replicated. Reprints are marketing for originals.

**System rule:** Do NOT trigger sell signals based on reprint announcements for vintage cards. If anything, reprints are a mild buy signal (+0.05 strength).

### 4.2 PSA Grading Population Growth

Risk: As more vintage cards get graded, the supply of PSA 9/10 copies increases, which can suppress raw NM prices.

| PSA Population Status | Impact on Raw NM Prices |
|----------------------|------------------------|
| Population growing rapidly (>20% YoY) | Neutral to slightly negative for raw; positive for gem mint |
| Population plateauing | Bullish for raw NM — supply is finite, demand increasing |
| High pop (>500 PSA 10s) | Suppresses PSA 10 premium, raw NM floor holds |
| Low pop (<50 PSA 10s) | Extremely bullish — scarcity premium accelerates |

**System rule:** Cannot track PSA pop directly, but use as context: vintage cards with consistently high raw NM prices ($100+) and low sales velocity are likely low-pop cards. These are the best long-term holds.

### 4.3 Counterfeits

Risk level by product:
- **1st Edition Base Set:** HIGH counterfeit risk. Chinese proxies are sophisticated. Always verify holo pattern, blue core, font weight.
- **e-Series:** MODERATE risk. Crystal types are counterfeited. Reverse holos are hard to fake.
- **Other WotC:** LOW-MODERATE. Counterfeits exist but are easy to spot (wrong card stock, holo pattern).

**System impact:** Not directly detectable from price data. However, suspiciously low prices on high-value vintage cards (price < 50% of market) with high velocity could indicate counterfeit flooding. Flag as a warning.

```
IF card.set_id IN VINTAGE_SET_IDS:
  AND current_price < 0.5 * sma_90d
  AND sales_per_day > 1.0
  AND card.current_price > 50  # Only matters for valuable cards
THEN:
  flag = "COUNTERFEIT_RISK"
  suppress buy signals
```

### 4.4 Market Concentration Risk

The vintage Pokemon market is heavily concentrated:
- Top 10 cards (by value) represent ~60% of total vintage market cap
- Charizard variants alone are ~25%
- A Charizard crash would drag the entire vintage market

**System rule:** Max 15% of portfolio in any single vintage card. Max 25% of portfolio in Charizard across all sets/variants.

### 4.5 Liquidity Risk

Vintage cards are inherently illiquid compared to modern:
- Modern chase cards: 5-50+ sales/day on TCGPlayer
- Vintage holos: 0.1-2 sales/day
- Vintage high-end (1st Ed, e-Series): 0.01-0.3 sales/day

**Implication:** The spread between buy/sell is wider. TCGPlayer seller fees (12.55% + shipping) eat more profit on low-velocity cards. Expect 15-20% round-trip cost on vintage vs 13-15% on modern liquid cards.

---

## 5. Specific Rules for the Trading System

### 5.1 Vintage Set Identification

Define vintage set IDs for the system. These are the `set_id` values from the Pokemon TCG API:

```python
VINTAGE_SET_IDS = {
    # WotC Era (1999-2003)
    "base1",        # Base Set
    "base2",        # Base Set 2
    "base3",        # Fossil (sometimes "fossil")
    "base4",        # Base Set 2 (alt ID)
    "base5",        # Team Rocket (sometimes "rocket")
    "jungle",       # Jungle
    "fossil",       # Fossil
    "gym1",         # Gym Heroes
    "gym2",         # Gym Challenge
    "neo1",         # Neo Genesis
    "neo2",         # Neo Discovery
    "neo3",         # Neo Revelation
    "neo4",         # Neo Destiny
    "base6",        # Legendary Collection
    "ecard1",       # Expedition Base Set
    "ecard2",       # Aquapolis
    "ecard3",       # Skyridge
    # Early Nintendo/ex-Era (2003-2005)
    "ex1",          # EX Ruby & Sapphire
    "ex2",          # EX Sandstorm
    "ex3",          # EX Dragon
    "ex4",          # EX Team Magma vs Team Aqua
    "ex5",          # EX Hidden Legends
    "ex6",          # EX FireRed & LeafGreen
    "ex7",          # EX Team Rocket Returns
    "ex8",          # EX Deoxys
    "ex9",          # EX Emerald
    "ex10",         # EX Unseen Forces
    "ex11",         # EX Delta Species
    "ex12",         # EX Legend Maker
    "ex13",         # EX Holon Phantoms
    "ex14",         # EX Crystal Guardians
    "ex15",         # EX Dragon Frontiers
    "ex16",         # EX Power Keepers
}
```

**Note:** Verify actual `set_id` values in the database — the Pokemon TCG API uses various formats. Query `SELECT DISTINCT set_id, set_name FROM cards WHERE set_name LIKE '%Base%' OR set_name LIKE '%Neo%'` etc. to confirm.

### 5.2 Modified Strategy Constants for Vintage

```python
# When card.set_id IN VINTAGE_SET_IDS, override these constants:
VINTAGE_OVERRIDES = {
    "MIN_PRICE": 15.0,              # Don't bother with vintage under $15
    "MIN_LIQUIDITY": 5,             # Vintage is inherently less liquid; 5 is OK
    "MIN_DATA_POINTS": 5,           # Need more history for vintage (price moves slowly)
    "DEFAULT_STOP_LOSS_PCT": 0.20,  # 20% stop (wider — vintage is volatile)
    "DEFAULT_TAKE_PROFIT_PCT": 0.50,# 50% target (vintage has bigger moves)
    "STALE_POSITION_DAYS": 365,     # 1 year stale threshold
    "STALE_GAIN_THRESHOLD": 0.08,   # 8% minimum gain to avoid stale exit
    "MAX_SINGLE_POSITION_PCT": 0.15,# 15% max per card (illiquid = more risk)
}
```

### 5.3 Vintage-Specific Buy Strategies

#### Strategy 6: Vintage Value Buy
```
Trigger:
  card.set_id IN VINTAGE_SET_IDS
  AND rarity IN ('Rare Holo', 'Rare Secret', 'Rare Holo EX')
  AND current_price dropped >15% from 90d high
  AND sales_per_day >= 0.1
  AND appreciation_slope (90d) was positive before the drop
  AND regime != 'markdown'

Action:
  signal = BUY
  strength = 0.55 + min(0.35, (drop_pct - 0.15) * 2.5)
  target = 90d SMA (mean reversion to longer average)
  stop_loss = entry * 0.80
  hold_target = 180 days
  strategy_name = "vintage_value_buy"
```

#### Strategy 7: Vintage Momentum (Nostalgia Wave)
```
Trigger:
  card.set_id IN VINTAGE_SET_IDS
  AND sales_per_day > 2x the card's 90d average velocity
  AND spread_pct < 12
  AND appreciation_slope > 0.15%/day
  AND sma_7 > sma_30 (uptrend confirmed)

Action:
  signal = BUY
  strength = 0.65
  target = entry * 1.30
  stop_loss = entry * 0.90 (tight — momentum trade)
  hold_target = 45 days
  strategy_name = "vintage_momentum"
```

#### Strategy 8: Vintage Accumulation Zone
```
Trigger:
  card.set_id IN VINTAGE_SET_IDS
  AND regime == 'accumulation'
  AND adx < 20 (low trend strength = consolidation)
  AND current_price within 5% of 90d low (near bottom of range)
  AND liquidity_score >= 10

Action:
  signal = BUY
  strength = 0.50
  target = bb_upper (breakout from accumulation)
  stop_loss = 90d_low * 0.95 (just below the range)
  hold_target = 120 days
  strategy_name = "vintage_accumulation"
```

### 5.4 Vintage Sell Signal Modifications

Override `check_sell_signals` behavior when `card.set_id IN VINTAGE_SET_IDS`:

| Existing Sell Signal | Vintage Behavior |
|---------------------|-----------------|
| Stop-loss (15%) | Widen to 20%. Vintage cards can swing 15% on low volume without fundamental change. |
| Take-profit (30%) | Raise to 50%. Vintage trends last longer. Consider trailing stop instead of fixed exit. |
| SMA Death Cross (7d/30d) | **IGNORE.** Too noisy for vintage. Use 30d/90d cross instead. |
| RSI Overbought (>70) | **IGNORE** unless RSI > 85 AND held > 60 days. Vintage can stay overbought. |
| Regime shift to distribution | Only trigger if regime has been 'distribution' for 30+ consecutive days. |
| Liquidity dry-up (<0.1/day) | Widen threshold: only sell if velocity < 0.03/day for 60+ days (vintage is naturally slow). |
| Stale position (90d, <5%) | Extend to 365 days, 8% threshold. |

### 5.5 Composite Scoring Adjustments

Modify `score_buy_signal` for vintage:

```python
def score_vintage_buy_signal(signal: dict, td: dict) -> float:
    """Vintage-adjusted scoring. Shifts weight from liquidity to appreciation."""
    score = 0.0

    # Signal strength: 35% (slightly less — vintage signals are noisier)
    score += signal.get("strength", 0) * 0.35

    # Appreciation trend: 30% (most important for vintage — is the long-term trend up?)
    slope = td.get("appreciation_slope", 0) or 0
    consistency = td.get("appreciation_consistency", 0) or 0  # R-squared
    app_score = min(1.0, max(0, slope * 5)) * 0.6 + consistency * 0.4
    score += app_score * 0.30

    # Liquidity: 10% (less weight — vintage is inherently illiquid)
    liq = td.get("liquidity_score", 0)
    score += (liq / 100) * 0.10

    # Spread: 10%
    spread = td.get("spread_pct")
    if spread is not None:
        spread_score = max(0, min(1.0, (30 - spread) / 25))
        score += spread_score * 0.10
    else:
        score += 0.05

    # Scarcity premium: 15% (is this card from a high-scarcity set?)
    scarcity_tiers = {
        "ecard3": 1.0,   # Skyridge
        "ecard2": 0.95,  # Aquapolis
        "ecard1": 0.85,  # Expedition
        "neo4": 0.90,    # Neo Destiny
        "base1": 0.85,   # Base Set
        "neo1": 0.70,    # Neo Genesis
        "gym2": 0.70,    # Gym Challenge
        "gym1": 0.65,    # Gym Heroes
        "neo2": 0.65,    # Neo Discovery
        "neo3": 0.65,    # Neo Revelation
        "base6": 0.75,   # Legendary Collection
    }
    set_id = td.get("set_id", "")
    scarcity = scarcity_tiers.get(set_id, 0.50)  # Default 0.5 for ex-era
    score += scarcity * 0.15

    return round(min(1.0, score), 3)
```

---

## 6. Position Sizing for Vintage

### 6.1 Core Principles

1. **Vintage is illiquid.** You cannot exit quickly. Size accordingly.
2. **Vintage is expensive.** Average investable vintage holo is $30-$300. High-end is $500-$5000+.
3. **Vintage appreciates slowly but steadily.** Think months/years, not days/weeks.
4. **Round-trip costs are high.** TCGPlayer fees + shipping = 15-20% drag.

### 6.2 Position Sizing Rules

```python
def calculate_vintage_position_size(
    portfolio_value: float,
    cash: float,
    card_price: float,
    signal_strength: float,
    num_positions: int,
    num_vintage_positions: int,
) -> int:
    """Vintage-specific position sizing. More conservative than modern."""

    # Hard limits
    MAX_VINTAGE_PCT_OF_PORTFOLIO = 0.40  # Max 40% of portfolio in vintage total
    MAX_SINGLE_VINTAGE_PCT = 0.15        # Max 15% in any single vintage card
    MAX_VINTAGE_POSITIONS = 8            # Max 8 vintage positions
    VINTAGE_CASH_RESERVE = 0.25          # Keep 25% cash when buying vintage (need buffer)

    # Check vintage portfolio cap
    # (caller must track total vintage exposure)
    if num_vintage_positions >= MAX_VINTAGE_POSITIONS:
        return 0

    available = cash - (portfolio_value * VINTAGE_CASH_RESERVE)
    if available <= 0:
        return 0

    max_position = portfolio_value * MAX_SINGLE_VINTAGE_PCT
    target_value = min(max_position, available) * (0.4 + signal_strength * 0.6)

    # Vintage = buy 1 copy almost always
    # Exception: sub-$30 vintage holos, buy 2 if strong signal
    if card_price > 50:
        return 1 if target_value >= card_price else 0
    elif card_price > 25:
        max_copies = 2 if signal_strength > 0.7 else 1
        affordable = int(target_value / card_price)
        return min(affordable, max_copies)
    else:
        max_copies = 3 if signal_strength > 0.8 else 2
        affordable = int(target_value / card_price)
        return min(affordable, max_copies)
```

### 6.3 Expected Hold Times by Price Tier

| Card Price | Copies | Expected Hold | Min Target Return | Rationale |
|-----------|--------|---------------|-------------------|-----------|
| $15-$30 | 2-3 | 6-12 months | +40% | Lower-end vintage holos. Higher volume, moderate appreciation. Need 40%+ to clear fees and justify illiquidity. |
| $30-$100 | 1-2 | 6-18 months | +50% | Core vintage investment range. Most WotC unlimited holos live here. |
| $100-$300 | 1 | 12-24 months | +50% | High-end unlimited holos, low-end 1st Edition. Very illiquid. |
| $300-$1000 | 1 | 18-36 months | +60% | Premium vintage (e-Series holos, 1st Ed non-Base holos, Shinings). Consider eBay for exit (better prices). |
| $1000+ | 1 (if at all) | 24+ months | +75% | Trophy cards. Only buy if portfolio > $10K. Consider grading before selling (PSA 9+ adds massive premium). |

### 6.4 Portfolio Construction Guidelines

For a $1,000 portfolio:
- Max $400 in vintage (40% cap)
- 2-4 vintage positions
- Focus on $30-$100 range (best risk/reward)
- Example: 1x Blastoise Base Unlimited ($60), 1x Lugia Neo Genesis ($120), 2x Gym Challenge holo ($35 each) = $250 vintage allocation

For a $5,000 portfolio:
- Max $2,000 in vintage
- 4-6 vintage positions
- Can include 1 high-end piece ($200-$500)
- Example: 1x Skyridge holo ($300), 1x Neo Destiny Shining ($400), 2x Base Set holos ($100 each), 2x Gym/Neo holos ($50 each) = $1,000

For a $10,000+ portfolio:
- Max $4,000 in vintage
- 5-8 vintage positions
- Can include 1 trophy card ($500-$1500)
- Diversify across eras: WotC Base era, Neo era, e-Series, ex-era

---

## 7. Implementation Checklist

To integrate these rules into the existing prop_strategies.py system:

- [ ] Define `VINTAGE_SET_IDS` constant (verify against DB `set_id` values)
- [ ] Add `is_vintage(card)` helper function
- [ ] Implement `_check_vintage_value_buy()` strategy (Strategy 6)
- [ ] Implement `_check_vintage_momentum()` strategy (Strategy 7)
- [ ] Implement `_check_vintage_accumulation()` strategy (Strategy 8)
- [ ] Modify `check_sell_signals()` to use vintage overrides when applicable
- [ ] Implement `score_vintage_buy_signal()` with scarcity weighting
- [ ] Implement `calculate_vintage_position_size()` with conservative limits
- [ ] Add seasonal adjustment modifier to signal strength for vintage
- [ ] Add counterfeit risk flag for suspicious price/velocity combos
- [ ] Extend stale position threshold to 365 days for vintage
- [ ] Widen stop-loss to 20% for vintage positions
- [ ] Raise take-profit to 50% for vintage positions
- [ ] Add 30d/90d SMA cross for vintage (replace 7d/30d)

---

## 8. Summary: Vintage vs Modern Trading Rules

| Parameter | Modern (Default) | Vintage (Override) |
|-----------|-----------------|-------------------|
| Min price | $5 | $15 |
| Min liquidity score | 20 | 5 |
| Stop-loss | 15% | 20% |
| Take-profit | 30% | 50% |
| Stale position days | 90 | 365 |
| Stale gain threshold | 5% | 8% |
| Max single position % | 10% | 15% |
| Max copies per card | 1-3 (by price) | 1-3 (more conservative) |
| SMA cross timeframe | 7d / 30d | 30d / 90d |
| RSI overbought sell trigger | >70 | >85 (or ignore) |
| Regime sell delay | Immediate | 30+ days in distribution |
| Liquidity dry-up threshold | 0.1 sales/day | 0.03 sales/day for 60+ days |
| Scoring: appreciation weight | 25% (embedded in signal strength) | 30% (explicit) |
| Scoring: scarcity weight | 0% | 15% |
| Scoring: liquidity weight | 25% | 10% |
| Expected hold duration | 30-90 days | 180-730 days |
| Cash reserve | 20% | 25% |
