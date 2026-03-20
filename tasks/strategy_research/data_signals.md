# Data-Driven Signals for Pokemon Card Trading

## Available Data Schema

```
price_history: card_id, date, variant, condition, market_price, low_price, mid_price, high_price
sales:         card_id, source, order_date, purchase_price, shipping_price, condition, variant, quantity, listing_id, listing_title
cards:         id, name, set_name, set_id, rarity, supertype, current_price, price_variant, types, artist, liquidity_score, appreciation_slope, cached_regime
liquidity_history: card_id, date, liquidity_score, sales_30d, sales_90d, spread_pct
```

All signals below are designed for sparse, irregular data (1 price point/day at best, many cards with <5 sales/month). Traditional TA assumptions (continuous price discovery, high frequency, sufficient volume) do not hold. These signals are built from the ground up for collectibles microstructure.

---

## 1. Sales Velocity as a Leading Indicator

### Core thesis

In thin markets, volume moves before price. A card that normally sells 0.3x/day suddenly selling 1.5x/day means demand has shifted before the TCGPlayer market price algorithm has responded. The lag exists because TCGPlayer recalculates market price from recent listings and completed sales with a dampening effect -- it is designed to be stable, not responsive.

### How far velocity leads price

Based on collectibles market microstructure (TCGPlayer's price algorithm updates, seller relisting behavior, buyer search patterns):

| Velocity increase | Typical price lag | Mechanism |
|---|---|---|
| 2x baseline | 3-5 days | Cheapest listings consumed, next-cheapest become the new floor |
| 3x baseline | 5-10 days | Multiple price tiers consumed, sellers notice and relist higher |
| 5x+ baseline | 1-3 days | Rapid consumption signals viral/hype event, price adjusts faster due to seller awareness |

**Key insight**: The relationship is nonlinear. Moderate velocity increases (2x) lead price by the longest because they fly under the radar. Extreme velocity spikes (5x+) actually have a shorter lead time because sellers notice immediately and raise prices.

### Computation

```python
def sales_velocity(db, card_id, window_days=14):
    """Compute sales velocity (sales per day) over a rolling window."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    count = (
        db.query(func.sum(Sale.quantity))
        .filter(Sale.card_id == card_id, Sale.order_date >= cutoff)
        .scalar() or 0
    )
    return count / window_days

def velocity_ratio(db, card_id):
    """Ratio of recent velocity to baseline velocity."""
    v_recent = sales_velocity(db, card_id, window_days=7)
    v_baseline = sales_velocity(db, card_id, window_days=60)

    if v_baseline < 0.05:  # Less than 1 sale per 20 days -- too sparse
        return None

    return v_recent / v_baseline
```

### Thresholds

| Velocity ratio | Signal | Strength |
|---|---|---|
| < 0.3 | VELOCITY_COLLAPSE -- demand drying up | Bearish 0.4-0.7 |
| 0.3 - 0.7 | VELOCITY_DECLINING | Bearish 0.2-0.4 |
| 0.7 - 1.5 | NORMAL -- no signal | Neutral |
| 1.5 - 3.0 | VELOCITY_RISING -- early demand signal | Bullish 0.3-0.6 |
| 3.0 - 5.0 | VELOCITY_SURGE -- strong demand | Bullish 0.6-0.8 |
| > 5.0 | VELOCITY_SPIKE -- possible hype event | Bullish 0.8-1.0, but watch for mean reversion |

### Lag estimation formula

```python
def estimate_price_lag_days(velocity_ratio):
    """Estimate how many days before price catches up to velocity signal."""
    if velocity_ratio is None or velocity_ratio < 1.5:
        return None  # No signal
    if velocity_ratio > 5.0:
        return 2  # Extreme spike, price adjusts fast
    if velocity_ratio > 3.0:
        return 5
    # 1.5 - 3.0 range: linear interpolation from 7 to 4 days
    return round(7 - (velocity_ratio - 1.5) * 2)
```

---

## 2. Velocity Acceleration (Rate of Change of Velocity)

### Why acceleration is earlier than velocity

Velocity tells you "demand is high." Acceleration tells you "demand is *increasing*." A card going from 0.2 to 0.4 sales/day (acceleration = +0.2/day/week) is a weaker signal than a card going from 0.2 to 0.8 sales/day (acceleration = +0.6/day/week). But both are early -- they fire before the velocity ratio crosses the 1.5x threshold that triggers a velocity signal.

Acceleration adds approximately 2-4 days of lead time beyond raw velocity.

### Computation

```python
def velocity_acceleration(db, card_id):
    """
    Rate of change of velocity.
    Compare velocity in week -1 vs week -2 vs week -3.
    Acceleration = (v_week1 - v_week2) - (v_week2 - v_week3)
    Positive acceleration = demand is not just high but accelerating.
    """
    now = datetime.now(timezone.utc)

    def count_sales(start, end):
        return (
            db.query(func.sum(Sale.quantity))
            .filter(Sale.card_id == card_id,
                    Sale.order_date >= start,
                    Sale.order_date < end)
            .scalar() or 0
        )

    w1_end = now
    w1_start = now - timedelta(days=7)
    w2_start = now - timedelta(days=14)
    w3_start = now - timedelta(days=21)

    v1 = count_sales(w1_start, w1_end) / 7.0    # Most recent week
    v2 = count_sales(w2_start, w1_start) / 7.0   # Prior week
    v3 = count_sales(w3_start, w2_start) / 7.0   # Two weeks ago

    delta_v_recent = v1 - v2
    delta_v_prior = v2 - v3

    acceleration = delta_v_recent - delta_v_prior  # Second derivative

    return {
        "velocity_current": v1,
        "velocity_prior": v2,
        "velocity_baseline": v3,
        "delta_v": delta_v_recent,
        "acceleration": acceleration,
    }
```

### Thresholds

```python
def interpret_acceleration(acc_data, current_price_change_pct_7d):
    v1, accel = acc_data["velocity_current"], acc_data["acceleration"]

    # Positive acceleration with low absolute velocity = earliest signal
    if accel > 0.1 and v1 < 1.0 and abs(current_price_change_pct_7d) < 3:
        return {
            "signal": "buy",
            "type": "EARLY_ACCUMULATION",
            "strength": min(1.0, accel * 3),
            "lead_days": 7,  # ~7 days before price moves
            "reason": f"Velocity accelerating (+{accel:.2f}/day/week) from low base, price flat"
        }

    # Negative acceleration after high velocity = momentum exhaustion
    if accel < -0.15 and v1 > 1.0:
        return {
            "signal": "sell",
            "type": "MOMENTUM_EXHAUSTION",
            "strength": min(1.0, abs(accel) * 2),
            "lead_days": 3,
            "reason": f"Velocity decelerating ({accel:.2f}/day/week) after sustained demand"
        }

    return None
```

### Signal timeline

```
Day 0:  Velocity acceleration turns positive (this signal fires)
Day 3:  Velocity ratio crosses 1.5x (velocity signal fires)
Day 5:  Cheapest listings consumed
Day 7:  TCGPlayer market price begins to rise
Day 10: Price move visible on chart
Day 14: SMA/EMA crossover might fire (if enough data)
```

Acceleration gives you a 7-10 day head start over traditional technical indicators.

---

## 3. Volume-Price Divergence Detection

### The four quadrants

| | Price Rising (>5% / 30d) | Price Flat (<5% / 30d) |
|---|---|---|
| **Velocity Rising (>1.5x)** | CONFIRMED RALLY -- price and demand agree. Trend continuation. | **ACCUMULATION** -- demand rising, price hasn't responded. Strongest buy signal. |
| **Velocity Falling (<0.7x)** | **DISTRIBUTION** -- price rising on declining demand. Strongest sell signal. | DORMANT -- no interest. No signal. |

### Accumulation detection

```python
def detect_accumulation(db, card_id, prices, dates):
    """
    Accumulation: velocity up >80%, price change <5%.
    This is the collectibles equivalent of institutional accumulation in equities.
    In thin markets, a buyer can purchase 10-20 copies over 2 weeks without
    moving the TCGPlayer market price because the algorithm dampens noise.
    But once the cheap supply is absorbed, price jumps discontinuously.
    """
    vr = velocity_ratio(db, card_id)
    if vr is None:
        return None

    # Price change over last 14 days
    if len(prices) < 2:
        return None

    # Find price ~14 days ago
    target_date = dates[-1] - timedelta(days=14)
    price_14d_ago = None
    for d, p in zip(dates, prices):
        if d <= target_date:
            price_14d_ago = p
    if price_14d_ago is None:
        price_14d_ago = prices[0]

    price_change = abs(prices[-1] - price_14d_ago) / price_14d_ago if price_14d_ago > 0 else 0

    if vr > 1.8 and price_change < 0.05:
        return {
            "signal": "buy",
            "type": "ACCUMULATION",
            "strength": min(1.0, (vr - 1.0) / 3.0),
            "velocity_ratio": vr,
            "price_change": price_change,
            "expected_lag_days": estimate_price_lag_days(vr),
            "reason": f"Sales velocity {vr:.1f}x baseline while price flat ({price_change:.1%}). "
                      f"Supply being absorbed. Price typically follows in "
                      f"{estimate_price_lag_days(vr)} days."
        }
    return None
```

### Distribution detection

```python
def detect_distribution(db, card_id, prices, dates):
    """
    Distribution: price rising >10% while velocity declining >30%.
    This is the most dangerous phase -- the price chart looks bullish but
    demand is actually falling. The price is being propped up by:
    - Momentum chasers buying at inflated prices
    - Seller relisting at higher prices (price discovery lag)
    - Algorithmic market price not yet reflecting lower sales volume

    Distribution typically precedes a sharp correction of 15-40%.
    """
    vr = velocity_ratio(db, card_id)
    if vr is None:
        return None

    if len(prices) < 5:
        return None

    # Price change over last 30 days (use the 5 most recent data points)
    lookback = min(len(prices), 10)
    price_change = (prices[-1] - prices[-lookback]) / prices[-lookback] if prices[-lookback] > 0 else 0

    if vr < 0.7 and price_change > 0.10:
        return {
            "signal": "sell",
            "type": "DISTRIBUTION",
            "strength": min(1.0, (1.0 - vr) + price_change),
            "velocity_ratio": vr,
            "price_change": price_change,
            "reason": f"Price up {price_change:.0%} but velocity only {vr:.1f}x baseline. "
                      f"Demand is declining while price rises -- classic distribution. "
                      f"Expect correction within 1-3 weeks."
        }
    return None
```

### Divergence scoring formula

```python
def volume_price_divergence_score(velocity_ratio, price_change_pct_30d):
    """
    Continuous divergence score from -1.0 (strong distribution) to +1.0 (strong accumulation).
    Zero means velocity and price are moving in the same direction (no divergence).
    """
    if velocity_ratio is None:
        return 0.0

    # Normalize velocity ratio to -1 to +1 range (1.0 = neutral)
    v_norm = (velocity_ratio - 1.0) / 2.0  # 0.0x -> -0.5, 1.0x -> 0.0, 3.0x -> +1.0
    v_norm = max(-1.0, min(1.0, v_norm))

    # Normalize price change to -1 to +1 range
    p_norm = price_change_pct_30d / 30.0  # +-30% = +-1.0
    p_norm = max(-1.0, min(1.0, p_norm))

    # Divergence = velocity direction minus price direction
    # Positive = velocity outpacing price (accumulation)
    # Negative = price outpacing velocity (distribution)
    divergence = v_norm - p_norm

    return max(-1.0, min(1.0, divergence))
```

---

## 4. Condition-Based Signals

### What condition shifts tell us

The `Sale.condition` field (Near Mint, Lightly Played, Moderately Played, Heavily Played, Damaged) reveals buyer intent:

| Buyer type | Condition preference | Why |
|---|---|---|
| Collectors / Investors | Near Mint only | Long-term hold, condition is value preservation |
| Competitive players | NM or LP acceptable | Need the card for a deck, condition is secondary |
| Budget buyers | LP/MP preferred | Want the card cheaply, not investing |
| Flippers | NM only | Need NM to resell at full price |

### Signal: LP/MP spike relative to NM

When Lightly Played and Moderately Played sales spike relative to Near Mint, it signals one of two things:

**Scenario A: NM supply exhausted (bullish)**
- NM copies are sold out or prohibitively expensive
- Buyers who need the card are downgrading to LP/MP
- Indicates strong demand exceeding NM supply
- NM price typically increases further

**Scenario B: Budget rotation (bearish for NM premium)**
- Buyers are substituting away from NM due to price sensitivity
- NM premium is perceived as too high relative to card value
- NM prices may soften as buyers opt for LP/MP

```python
def condition_shift_signal(db, card_id):
    """Detect shifts in condition mix of completed sales."""
    now = datetime.now(timezone.utc)
    recent_start = now - timedelta(days=14)
    prior_start = now - timedelta(days=42)

    def condition_breakdown(start, end):
        sales = (
            db.query(Sale.condition, func.sum(Sale.quantity))
            .filter(Sale.card_id == card_id,
                    Sale.order_date >= start,
                    Sale.order_date < end,
                    Sale.condition.isnot(None))
            .group_by(Sale.condition)
            .all()
        )
        total = sum(qty or 1 for _, qty in sales)
        if total == 0:
            return None, 0
        breakdown = {}
        for cond, qty in sales:
            breakdown[cond] = (qty or 1) / total
        return breakdown, total

    recent, recent_total = condition_breakdown(recent_start, now)
    prior, prior_total = condition_breakdown(prior_start, recent_start)

    if recent is None or prior is None:
        return None
    if recent_total < 3 or prior_total < 3:
        return None

    nm_recent = recent.get("Near Mint", 0)
    nm_prior = prior.get("Near Mint", 0)
    lp_mp_recent = recent.get("Lightly Played", 0) + recent.get("Moderately Played", 0)
    lp_mp_prior = prior.get("Lightly Played", 0) + prior.get("Moderately Played", 0)

    # NM share dropping, LP/MP share rising
    nm_shift = nm_recent - nm_prior
    lp_mp_shift = lp_mp_recent - lp_mp_prior

    if nm_shift < -0.15 and lp_mp_shift > 0.15:
        # Disambiguate: is NM supply exhausted or are buyers price-sensitive?
        # Check if NM price increased (supply exhaustion) or stayed flat (price sensitivity)
        # Use price_history for NM condition if available
        return {
            "signal": "buy",  # Default to bullish (NM exhaustion is more common)
            "type": "CONDITION_SHIFT_TO_LP",
            "strength": min(1.0, abs(nm_shift) * 3),
            "nm_share_change": nm_shift,
            "lp_mp_share_change": lp_mp_shift,
            "reason": f"NM share dropped {nm_shift:+.0%} while LP/MP share rose {lp_mp_shift:+.0%}. "
                      f"Likely NM supply exhaustion -- demand exceeding available NM copies."
        }

    # NM share rising sharply = collector demand entering
    if nm_shift > 0.20:
        return {
            "signal": "buy",
            "type": "COLLECTOR_DEMAND_RISING",
            "strength": min(1.0, nm_shift * 2.5),
            "nm_share_change": nm_shift,
            "reason": f"NM share rose {nm_shift:+.0%}. Collector/investor demand entering. "
                      f"NM premium likely to expand."
        }

    return None
```

### Condition premium tracking

```python
def condition_premium_ratio(db, card_id, window_days=30):
    """
    Ratio of NM average sale price to LP average sale price.
    A widening NM premium = increasing collector demand.
    A narrowing NM premium = condition becoming less important (player demand).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    sales = (
        db.query(Sale.condition, func.avg(Sale.purchase_price))
        .filter(Sale.card_id == card_id,
                Sale.order_date >= cutoff,
                Sale.condition.in_(["Near Mint", "Lightly Played"]))
        .group_by(Sale.condition)
        .all()
    )
    prices = {cond: avg for cond, avg in sales if avg}
    nm = prices.get("Near Mint")
    lp = prices.get("Lightly Played")
    if nm and lp and lp > 0:
        return nm / lp  # Typically 1.1-1.4 for healthy collector demand
    return None
```

### Thresholds

| NM/LP premium ratio | Interpretation |
|---|---|
| < 1.05 | Condition irrelevant -- player-driven demand, no collector premium |
| 1.05 - 1.15 | Normal premium |
| 1.15 - 1.30 | Strong collector demand |
| > 1.30 | Extreme collector premium -- potential NM supply squeeze |
| Ratio increasing >0.05/month | Bullish -- collector demand accelerating |
| Ratio decreasing >0.05/month | Bearish -- collector interest waning |

---

## 5. Cross-Card Correlation Signals (Sympathy Rallies)

### Mechanism

When a specific Pokemon printing surges (e.g., Charizard from Base Set), other printings of that Pokemon often follow within 1-4 weeks. This happens because:

1. Media/social attention on one card drives search traffic for the Pokemon name
2. Buyers priced out of the surging card seek cheaper alternatives (same Pokemon, different set)
3. Sellers of other printings see the surge and raise their listing prices preemptively

### Same-Pokemon sympathy rally detection

```python
def pokemon_sympathy_signal(db, card_id, card_name):
    """
    Detect if other printings of the same Pokemon are surging,
    making this card a likely sympathy rally candidate.
    """
    # Extract Pokemon name from card name (e.g., "Charizard V" -> "Charizard")
    # Simple heuristic: take first word, or known Pokemon name
    pokemon_name = extract_pokemon_name(card_name)
    if not pokemon_name:
        return None

    # Find all other cards with same Pokemon name
    siblings = (
        db.query(Card)
        .filter(Card.name.contains(pokemon_name),
                Card.id != card_id,
                Card.is_tracked == True,
                Card.current_price.isnot(None))
        .all()
    )

    if len(siblings) < 2:
        return None

    # Check which siblings are surging (>15% gain in 30 days)
    surging = []
    for sib in siblings:
        if sib.appreciation_slope is not None and sib.appreciation_slope > 0.5:
            surging.append(sib)

    surge_ratio = len(surging) / len(siblings)

    # This card hasn't moved yet
    this_card = db.query(Card).get(card_id)
    if this_card.appreciation_slope and this_card.appreciation_slope > 0.3:
        return None  # Already moving, not a sympathy play

    if surge_ratio > 0.30:
        avg_surge = sum(s.appreciation_slope for s in surging) / len(surging)
        return {
            "signal": "buy",
            "type": "SYMPATHY_RALLY_CANDIDATE",
            "strength": min(1.0, surge_ratio * 1.5),
            "surging_siblings": len(surging),
            "total_siblings": len(siblings),
            "avg_sibling_appreciation": avg_surge,
            "reason": f"{len(surging)}/{len(siblings)} other {pokemon_name} printings surging "
                      f"(avg slope {avg_surge:.2f}%/day). This printing hasn't moved yet. "
                      f"Sympathy rally likely within 1-4 weeks."
        }

    return None
```

### Same-set sympathy detection

```python
def set_sympathy_signal(db, card_id, set_id):
    """
    Cards in the same set often move together when the set gains attention.
    If >40% of a set's tracked cards are appreciating, lagging cards
    tend to catch up.
    """
    set_cards = (
        db.query(Card)
        .filter(Card.set_id == set_id,
                Card.is_tracked == True,
                Card.current_price.isnot(None),
                Card.current_price >= 2.0)
        .all()
    )

    if len(set_cards) < 8:
        return None

    appreciating = [c for c in set_cards if c.appreciation_slope and c.appreciation_slope > 0.1]
    breadth = len(appreciating) / len(set_cards)

    this_card = db.query(Card).get(card_id)
    this_lagging = this_card.appreciation_slope is None or this_card.appreciation_slope < 0.05

    if breadth > 0.40 and this_lagging:
        return {
            "signal": "buy",
            "type": "SET_SYMPATHY_LAG",
            "strength": min(1.0, (breadth - 0.3) * 2),
            "set_breadth": breadth,
            "reason": f"{len(appreciating)}/{len(set_cards)} cards in {set_id} appreciating "
                      f"({breadth:.0%} breadth). This card is lagging -- likely to catch up."
        }

    return None
```

### Lead-lag timing

| Relationship | Typical lag | Confidence |
|---|---|---|
| Same Pokemon, different set | 7-28 days | Medium -- depends on price differential |
| Same set, different Pokemon | 7-21 days | Medium-high -- set-level demand is broad |
| Same rarity tier in set | 3-14 days | High -- most direct substitution |

---

## 6. Set-Level Aggregate Signals

### The 30% threshold

When more than 30% of a set's cards show velocity increases simultaneously, it indicates set-level demand rather than individual card hype. This is a fundamentally different signal than a single hot card.

### Computation

```python
def set_velocity_breadth(db, set_id):
    """
    Compute what fraction of a set's cards have rising velocity.
    >30% = set-level demand signal.
    >50% = strong set-level demand (new set hype, tournament impact, etc.)
    """
    set_cards = (
        db.query(Card)
        .filter(Card.set_id == set_id,
                Card.is_tracked == True,
                Card.current_price.isnot(None))
        .all()
    )

    if len(set_cards) < 10:
        return None  # Need enough cards for breadth to mean something

    rising_velocity = 0
    falling_velocity = 0
    measured = 0

    for card in set_cards:
        vr = velocity_ratio(db, card.id)
        if vr is not None:
            measured += 1
            if vr > 1.3:
                rising_velocity += 1
            elif vr < 0.7:
                falling_velocity += 1

    if measured < 5:
        return None

    breadth_up = rising_velocity / measured
    breadth_down = falling_velocity / measured

    result = {
        "set_id": set_id,
        "total_cards": len(set_cards),
        "measured_cards": measured,
        "rising_count": rising_velocity,
        "falling_count": falling_velocity,
        "breadth_up": breadth_up,
        "breadth_down": breadth_down,
    }

    if breadth_up > 0.50:
        result["signal"] = "buy"
        result["type"] = "SET_DEMAND_SURGE"
        result["strength"] = min(1.0, breadth_up * 1.5)
        result["reason"] = (f"{rising_velocity}/{measured} cards ({breadth_up:.0%}) in {set_id} "
                           f"have rising velocity. Strong set-level demand.")
    elif breadth_up > 0.30:
        result["signal"] = "buy"
        result["type"] = "SET_DEMAND_RISING"
        result["strength"] = min(0.7, breadth_up)
        result["reason"] = (f"{rising_velocity}/{measured} cards ({breadth_up:.0%}) in {set_id} "
                           f"have rising velocity. Emerging set-level demand.")
    elif breadth_down > 0.50:
        result["signal"] = "sell"
        result["type"] = "SET_DEMAND_COLLAPSE"
        result["strength"] = min(1.0, breadth_down * 1.5)
        result["reason"] = (f"{falling_velocity}/{measured} cards ({breadth_down:.0%}) in {set_id} "
                           f"have falling velocity. Set-level demand is declining.")

    return result
```

### Set-level demand phases

```
Phase 1: IGNITION     -- 10-30% of cards show velocity increase
                         Typically driven by 1-2 chase cards or tournament results
                         Individual card signal only

Phase 2: BROADENING   -- 30-50% of cards show velocity increase
                         Set-level demand confirmed. Signal applies to all cards in set.
                         BUY signal for lagging cards in the set.

Phase 3: PEAK         -- >50% of cards show velocity increase
                         Maximum demand. Usually 2-6 weeks after ignition.
                         Continue holding, but watch for Phase 4.

Phase 4: EXHAUSTION   -- Velocity breadth drops from >50% to <30%
                         Demand is narrowing back to chase cards only.
                         SELL signal for non-chase cards (rarity < Ultra Rare).
```

---

## 7. Price Dispersion Signals (Spread Between List and Sold)

### What spread tells us

The `PriceHistory` table contains `low_price`, `mid_price`, `high_price`, and `market_price` for each day. The spread between these values reveals market consensus (or lack thereof).

- **Narrow spread** (high/low ratio < 1.3): Strong price consensus. Market agrees on value. Stable.
- **Wide spread** (high/low ratio > 2.0): No consensus. Uncertain valuation. Volatile.
- **Widening spread**: Increasing disagreement. Often precedes a large move (direction unknown).
- **Narrowing spread**: Consensus forming. Often follows a large move (consolidation).

### Computation

```python
def price_dispersion(records, window=14):
    """
    Compute price dispersion from PriceHistory records.
    Returns current dispersion and its rate of change.
    """
    recent = records[-window:] if len(records) >= window else records
    prior = records[-window*2:-window] if len(records) >= window*2 else records[:len(records)//2]

    def calc_dispersion(recs):
        ratios = []
        for r in recs:
            if r.high_price and r.low_price and r.low_price > 0:
                ratios.append(r.high_price / r.low_price)
        if not ratios:
            return None
        return sum(ratios) / len(ratios)

    current_disp = calc_dispersion(recent)
    prior_disp = calc_dispersion(prior)

    if current_disp is None:
        return None

    result = {
        "current_dispersion": current_disp,
        "prior_dispersion": prior_disp,
    }

    if prior_disp and prior_disp > 0:
        result["dispersion_change"] = (current_disp - prior_disp) / prior_disp
    else:
        result["dispersion_change"] = 0

    return result
```

### VWAP-to-market divergence (actual sold vs listed)

```python
def sold_vs_listed_spread(db, card_id, market_price, window_days=14):
    """
    Compare VWAP of actual sales to the TCGPlayer market price.
    Widening gap = market price is stale or manipulated.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    sales = (
        db.query(Sale)
        .filter(Sale.card_id == card_id,
                Sale.order_date >= cutoff,
                Sale.purchase_price > 0)
        .all()
    )

    if len(sales) < 3:
        return None

    total_value = sum(s.purchase_price * (s.quantity or 1) for s in sales)
    total_qty = sum(s.quantity or 1 for s in sales)
    vwap = total_value / total_qty

    if market_price <= 0:
        return None

    spread_pct = (market_price - vwap) / vwap * 100

    return {
        "vwap": vwap,
        "market_price": market_price,
        "spread_pct": spread_pct,
        "sale_count": len(sales),
    }
```

### Thresholds

| Spread metric | Value | Signal |
|---|---|---|
| Market > VWAP by >15% | Overpriced listings | Bearish -- buyers paying less than listed |
| Market < VWAP by >10% | Underpriced listings | Bullish -- buyers willing to pay above list |
| Dispersion ratio >2.0 | No price consensus | High volatility expected -- direction unclear |
| Dispersion widening >20%/month | Increasing uncertainty | Breakout imminent (combine with velocity for direction) |
| Dispersion narrowing >20%/month | Consensus forming | Post-breakout consolidation, trend likely to continue |

---

## 8. New Listing Rate as a Supply Signal

### Theory

More new listings = more sellers = more supply = downward price pressure. In the TCGPlayer marketplace, each `listing_id` in the `Sale` table represents a completed sale from a listing. While we cannot directly observe active (unsold) listings from our data, we can infer supply dynamics from:

1. **Unique listing_id growth rate**: More unique listings appearing = more sellers entering
2. **Sale price dispersion**: When many sellers compete, prices compress toward the bottom
3. **Time-to-sale**: If cards are selling quickly after listing (high velocity), supply is being absorbed. If slowly, supply is piling up.

### Computation from available data

```python
def supply_pressure_signal(db, card_id):
    """
    Estimate supply pressure from sale listing patterns.
    Uses listing_id uniqueness and seller diversity as proxies.
    """
    now = datetime.now(timezone.utc)
    recent_start = now - timedelta(days=14)
    prior_start = now - timedelta(days=42)

    def listing_stats(start, end):
        sales = (
            db.query(Sale)
            .filter(Sale.card_id == card_id,
                    Sale.order_date >= start,
                    Sale.order_date < end)
            .all()
        )
        if not sales:
            return None
        unique_listings = len(set(s.listing_id for s in sales if s.listing_id))
        total_qty = sum(s.quantity or 1 for s in sales)
        avg_price = sum(s.purchase_price for s in sales) / len(sales)
        price_std = (sum((s.purchase_price - avg_price)**2 for s in sales) / len(sales)) ** 0.5
        cv = price_std / avg_price if avg_price > 0 else 0  # Coefficient of variation
        return {
            "unique_listings": unique_listings,
            "total_quantity": total_qty,
            "avg_price": avg_price,
            "price_cv": cv,
        }

    recent = listing_stats(recent_start, now)
    prior = listing_stats(prior_start, recent_start)

    if recent is None or prior is None:
        return None

    # Normalize to per-day rates
    recent_listings_per_day = recent["unique_listings"] / 14
    prior_listings_per_day = prior["unique_listings"] / 28

    if prior_listings_per_day < 0.05:
        return None

    listing_growth = (recent_listings_per_day - prior_listings_per_day) / prior_listings_per_day

    # Supply expanding: more listings + stable/falling price = bearish
    if listing_growth > 0.5 and recent["price_cv"] > prior["price_cv"]:
        return {
            "signal": "sell",
            "type": "SUPPLY_EXPANSION",
            "strength": min(1.0, listing_growth / 2),
            "listing_growth": listing_growth,
            "reason": f"New listing rate up {listing_growth:.0%}. More sellers entering with "
                      f"increasing price dispersion. Supply pressure building."
        }

    # Supply contracting: fewer listings + rising velocity = bullish
    if listing_growth < -0.3:
        return {
            "signal": "buy",
            "type": "SUPPLY_CONTRACTION",
            "strength": min(1.0, abs(listing_growth)),
            "listing_growth": listing_growth,
            "reason": f"New listing rate down {abs(listing_growth):.0%}. Fewer sellers. "
                      f"Supply tightening -- price likely to rise."
        }

    return None
```

---

## 9. Sales Concentration

### Why concentration matters

If 100 sales occurred in the last month, it matters whether they were 100 buyers buying 1 copy each (broad demand) or 5 buyers buying 20 copies each (concentrated demand / dealer accumulation).

We cannot directly observe buyer identity from our data, but we can infer concentration from:
- **Listing diversity**: Are sales coming from many different `listing_id` prefixes (many sellers) or a few?
- **Temporal clustering**: Are sales evenly spread over the month, or clustered in bursts?
- **Quantity distribution**: Are individual sales mostly quantity=1 (retail) or quantity=2+ (bulk)?

### Computation

```python
def sales_concentration(db, card_id, window_days=30):
    """
    Measure whether sales are distributed (many small buyers)
    or concentrated (few large buyers).

    Concentrated buying = likely dealer accumulation = bullish
    Concentrated selling = likely dealer liquidation = bearish (context-dependent)
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    sales = (
        db.query(Sale)
        .filter(Sale.card_id == card_id, Sale.order_date >= cutoff)
        .order_by(Sale.order_date)
        .all()
    )

    if len(sales) < 5:
        return None

    # 1. Quantity concentration: what % of total volume is from multi-quantity sales?
    total_qty = sum(s.quantity or 1 for s in sales)
    bulk_qty = sum(s.quantity or 1 for s in sales if (s.quantity or 1) > 1)
    bulk_ratio = bulk_qty / total_qty if total_qty > 0 else 0

    # 2. Temporal clustering: Herfindahl index on daily sale counts
    daily_counts = {}
    for s in sales:
        day = s.order_date.date() if hasattr(s.order_date, 'date') else s.order_date
        daily_counts[day] = daily_counts.get(day, 0) + (s.quantity or 1)

    total = sum(daily_counts.values())
    hhi = sum((c / total) ** 2 for c in daily_counts.values())
    # HHI ranges from 1/N (perfectly distributed) to 1.0 (all on one day)
    # Normalize: 0 = perfectly distributed, 1 = perfectly concentrated
    n_days = len(daily_counts)
    hhi_normalized = (hhi - 1/n_days) / (1 - 1/n_days) if n_days > 1 else 1.0

    # 3. Listing diversity: unique listing sources
    unique_listings = len(set(s.listing_id for s in sales if s.listing_id))
    listing_diversity = unique_listings / len(sales) if sales else 0
    # Close to 1.0 = each sale from a different listing (many sellers)
    # Close to 0.0 = same listing sources appearing repeatedly

    concentration_score = (bulk_ratio * 0.3 + hhi_normalized * 0.4 + (1 - listing_diversity) * 0.3)

    return {
        "concentration_score": concentration_score,  # 0 = distributed, 1 = concentrated
        "bulk_ratio": bulk_ratio,
        "temporal_hhi": hhi_normalized,
        "listing_diversity": listing_diversity,
        "total_sales": len(sales),
        "total_quantity": total_qty,
    }
```

### Interpretation thresholds

| Concentration score | Pattern | Signal |
|---|---|---|
| < 0.2 | Broad retail demand | Neutral -- healthy, sustainable demand |
| 0.2 - 0.4 | Normal distribution | No signal |
| 0.4 - 0.6 | Moderately concentrated | Watch -- could be dealer activity |
| 0.6 - 0.8 | Highly concentrated + rising velocity | ACCUMULATION -- dealer building position (bullish) |
| 0.6 - 0.8 | Highly concentrated + falling price | LIQUIDATION -- dealer dumping (bearish short-term, potential buy if no fundamental change) |
| > 0.8 | Extreme concentration | Likely a single actor -- signal unreliable, wait for pattern to resolve |

---

## 10. Time-of-Week/Month Patterns

### Weekly patterns in TCGPlayer sales

Based on general e-commerce and TCG marketplace patterns:

| Day | Expected pattern | Mechanism |
|---|---|---|
| Monday-Tuesday | Lower velocity, slight price softness | Weekend buying concluded, listings from weekend sellers appear |
| Wednesday-Thursday | Baseline velocity | Mid-week equilibrium |
| Friday | Velocity uptick begins | Weekend buyers start browsing |
| Saturday-Sunday | Peak velocity, slight price firmness | Most browsing/buying activity, competitive demand for limited listings |

### Monthly patterns

| Period | Pattern | Mechanism |
|---|---|---|
| 1st-5th of month | Velocity spike, prices firm | Payday spending |
| 15th-17th | Secondary velocity bump | Bi-weekly payday cycle |
| 25th-31st | Velocity dip | End of month budget constraints |
| Tax refund season (Feb-Apr) | Elevated velocity across all cards | Discretionary income boost |
| Pre-holiday (Oct-Dec 20) | Rising velocity, especially for sealed product and popular Pokemon | Gift buying + holiday bonuses |
| Post-holiday (Dec 26-Jan 15) | Gift card spending spike, focus on specific want-list cards | Recipients spending gifts |

### Computation

```python
def day_of_week_velocity(db, card_id, lookback_days=90):
    """
    Compute average sales velocity by day of week.
    Returns the expected velocity for each day and whether today is above/below normal.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    sales = (
        db.query(Sale)
        .filter(Sale.card_id == card_id, Sale.order_date >= cutoff)
        .all()
    )

    if len(sales) < 20:
        return None  # Need enough sales across all days

    # Count sales by day of week (0=Monday, 6=Sunday)
    dow_counts = {i: 0 for i in range(7)}
    dow_weeks = {i: 0 for i in range(7)}  # How many of each DOW in the lookback

    for s in sales:
        dow = s.order_date.weekday()
        dow_counts[dow] += (s.quantity or 1)

    # Count number of each weekday in the lookback period
    d = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    while d <= datetime.now(timezone.utc):
        dow_weeks[d.weekday()] += 1
        d += timedelta(days=1)

    # Average sales per DOW
    dow_velocity = {}
    for i in range(7):
        if dow_weeks[i] > 0:
            dow_velocity[i] = dow_counts[i] / dow_weeks[i]
        else:
            dow_velocity[i] = 0

    overall_avg = sum(dow_velocity.values()) / 7

    return {
        "dow_velocity": dow_velocity,  # {0: 0.5, 1: 0.3, ..., 6: 0.8}
        "overall_avg": overall_avg,
        "best_day": max(dow_velocity, key=dow_velocity.get),
        "worst_day": min(dow_velocity, key=dow_velocity.get),
        "weekend_premium": (
            (dow_velocity.get(5, 0) + dow_velocity.get(6, 0)) /
            (dow_velocity.get(1, 0.01) + dow_velocity.get(2, 0.01))
        ),
    }

def monthly_seasonality(db, card_id, lookback_months=12):
    """
    Detect monthly patterns. Best used for timing buy/sell decisions.
    Buy during low-velocity periods, sell during high-velocity periods.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_months * 30)
    sales = (
        db.query(
            func.extract('month', Sale.order_date).label('month'),
            func.sum(Sale.quantity).label('qty')
        )
        .filter(Sale.card_id == card_id, Sale.order_date >= cutoff)
        .group_by('month')
        .all()
    )

    if not sales:
        return None

    monthly = {int(row.month): int(row.qty or 0) for row in sales}
    avg = sum(monthly.values()) / len(monthly) if monthly else 0

    # Seasonal index: >1.0 = above average, <1.0 = below average
    seasonal_index = {}
    for month, qty in monthly.items():
        seasonal_index[month] = qty / avg if avg > 0 else 1.0

    return {
        "monthly_volume": monthly,
        "seasonal_index": seasonal_index,
        "peak_month": max(seasonal_index, key=seasonal_index.get) if seasonal_index else None,
        "trough_month": min(seasonal_index, key=seasonal_index.get) if seasonal_index else None,
    }
```

### Trading application

```python
def timing_signal(dow_data, monthly_data):
    """
    Should you buy/sell today based on temporal patterns?
    Buy when velocity is seasonally low (cheaper prices, less competition).
    Sell when velocity is seasonally high (more buyers, better prices).
    """
    today = datetime.now()
    current_dow = today.weekday()
    current_month = today.month

    signals = []

    if dow_data:
        today_velocity = dow_data["dow_velocity"].get(current_dow, 0)
        if today_velocity < dow_data["overall_avg"] * 0.7:
            signals.append("FAVORABLE_BUY_DAY -- below-average activity, less competition")
        elif today_velocity > dow_data["overall_avg"] * 1.3:
            signals.append("FAVORABLE_SELL_DAY -- above-average activity, more buyers")

    if monthly_data and monthly_data["seasonal_index"]:
        month_idx = monthly_data["seasonal_index"].get(current_month, 1.0)
        if month_idx < 0.7:
            signals.append(f"SEASONAL_LOW_MONTH -- month {current_month} is below avg ({month_idx:.1f}x)")
        elif month_idx > 1.3:
            signals.append(f"SEASONAL_HIGH_MONTH -- month {current_month} is above avg ({month_idx:.1f}x)")

    return signals
```

---

## 11. Computing Each Signal from Raw Data

### Master signal computation pipeline

Given the three data sources (price_history, sales, cards), here is the complete pipeline for computing all signals for a single card:

```python
def compute_all_signals(db, card_id):
    """
    Master signal computation. Runs all signal generators and returns
    a unified signal report.

    Data flow:
    1. Load raw data (price_history, sales, card metadata)
    2. Compute derived metrics (velocity, acceleration, VWAP, dispersion)
    3. Run signal generators (each returns signal dict or None)
    4. Aggregate and weight signals
    5. Return final recommendation
    """
    from datetime import date, timedelta

    # ---- STEP 1: Load raw data ----
    card = db.query(Card).get(card_id)
    if not card:
        return None

    price_records = (
        db.query(PriceHistory)
        .filter(PriceHistory.card_id == card_id,
                PriceHistory.market_price.isnot(None))
        .order_by(PriceHistory.date.asc())
        .all()
    )
    prices = [r.market_price for r in price_records]
    dates = [r.date for r in price_records]

    all_sales = (
        db.query(Sale)
        .filter(Sale.card_id == card_id)
        .order_by(Sale.order_date.asc())
        .all()
    )

    # ---- STEP 2: Derived metrics ----
    v_7d = sales_velocity(db, card_id, window_days=7)
    v_30d = sales_velocity(db, card_id, window_days=30)
    v_60d = sales_velocity(db, card_id, window_days=60)
    vr = v_7d / v_60d if v_60d > 0.05 else None

    acc = velocity_acceleration(db, card_id)

    vwap_14d = compute_vwap(all_sales, window_days=14)
    vwap_30d = compute_vwap(all_sales, window_days=30)

    dispersion = price_dispersion(price_records)

    price_change_7d = ((prices[-1] - prices[-min(7, len(prices))]) /
                       prices[-min(7, len(prices))] * 100) if len(prices) >= 2 else 0
    price_change_30d = ((prices[-1] - prices[-min(30, len(prices))]) /
                        prices[-min(30, len(prices))] * 100) if len(prices) >= 2 else 0

    # ---- STEP 3: Signal generators ----
    signals = []

    # 3a. Velocity signal
    if vr is not None:
        if vr > 1.5:
            signals.append({
                "source": "velocity", "signal": "buy",
                "strength": min(1.0, (vr - 1.0) / 3.0), "weight": 2.5,
                "reason": f"Velocity ratio {vr:.1f}x (7d vs 60d baseline)"
            })
        elif vr < 0.5:
            signals.append({
                "source": "velocity", "signal": "sell",
                "strength": min(1.0, (1.0 - vr) * 1.5), "weight": 2.5,
                "reason": f"Velocity ratio {vr:.1f}x (demand declining)"
            })

    # 3b. Velocity acceleration
    if acc and acc["acceleration"] > 0.1:
        signals.append({
            "source": "velocity_accel", "signal": "buy",
            "strength": min(1.0, acc["acceleration"] * 3), "weight": 2.0,
            "reason": f"Velocity accelerating +{acc['acceleration']:.2f}/day/week"
        })
    elif acc and acc["acceleration"] < -0.15:
        signals.append({
            "source": "velocity_accel", "signal": "sell",
            "strength": min(1.0, abs(acc["acceleration"]) * 2), "weight": 2.0,
            "reason": f"Velocity decelerating {acc['acceleration']:.2f}/day/week"
        })

    # 3c. Volume-price divergence
    div = detect_accumulation(db, card_id, prices, dates)
    if div:
        signals.append({**div, "source": "accumulation", "weight": 3.0})

    dist = detect_distribution(db, card_id, prices, dates)
    if dist:
        signals.append({**dist, "source": "distribution", "weight": 3.0})

    # 3d. VWAP divergence
    if vwap_30d and card.current_price:
        div_pct = (card.current_price - vwap_30d) / vwap_30d * 100
        if div_pct > 15:
            signals.append({
                "source": "vwap_divergence", "signal": "sell",
                "strength": min(1.0, div_pct / 30), "weight": 2.5,
                "reason": f"Price ${card.current_price:.2f} is {div_pct:.0f}% above VWAP ${vwap_30d:.2f}"
            })
        elif div_pct < -10:
            signals.append({
                "source": "vwap_divergence", "signal": "buy",
                "strength": min(1.0, abs(div_pct) / 25), "weight": 2.5,
                "reason": f"Price ${card.current_price:.2f} is {abs(div_pct):.0f}% below VWAP ${vwap_30d:.2f}"
            })

    # 3e. Condition shift
    cond = condition_shift_signal(db, card_id)
    if cond:
        signals.append({**cond, "source": "condition_shift", "weight": 1.5})

    # 3f. Cross-card signals
    sympathy = pokemon_sympathy_signal(db, card_id, card.name)
    if sympathy:
        signals.append({**sympathy, "source": "pokemon_sympathy", "weight": 1.5})

    set_sig = set_sympathy_signal(db, card_id, card.set_id)
    if set_sig:
        signals.append({**set_sig, "source": "set_sympathy", "weight": 2.0})

    # 3g. Supply pressure
    supply = supply_pressure_signal(db, card_id)
    if supply:
        signals.append({**supply, "source": "supply_pressure", "weight": 1.5})

    # 3h. Sales concentration
    conc = sales_concentration(db, card_id)
    if conc and conc["concentration_score"] > 0.6:
        if vr and vr > 1.0:
            signals.append({
                "source": "concentration", "signal": "buy",
                "type": "CONCENTRATED_ACCUMULATION",
                "strength": conc["concentration_score"], "weight": 1.5,
                "reason": f"Concentrated buying (score {conc['concentration_score']:.2f}) with rising velocity"
            })

    # 3i. Dispersion signal
    if dispersion and dispersion.get("dispersion_change"):
        dc = dispersion["dispersion_change"]
        if dc > 0.2:
            signals.append({
                "source": "dispersion", "signal": "hold",
                "strength": min(1.0, dc), "weight": 1.0,
                "reason": f"Price dispersion widening {dc:.0%} -- breakout imminent, direction unclear"
            })

    return {
        "card_id": card_id,
        "card_name": card.name,
        "current_price": card.current_price,
        "signals": signals,
        "metrics": {
            "velocity_7d": v_7d,
            "velocity_30d": v_30d,
            "velocity_ratio": vr,
            "acceleration": acc,
            "vwap_14d": vwap_14d,
            "vwap_30d": vwap_30d,
            "dispersion": dispersion,
            "price_change_7d": price_change_7d,
            "price_change_30d": price_change_30d,
        },
        "recommendation": aggregate_signals(signals),
    }
```

### Helper: VWAP computation from sales

```python
def compute_vwap(sales, window_days=30):
    """Compute VWAP from Sale records over a rolling window."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    window_sales = [s for s in sales if s.order_date >= cutoff and s.purchase_price > 0]

    if len(window_sales) < 3:
        return None

    total_value = sum(s.purchase_price * (s.quantity or 1) for s in window_sales)
    total_qty = sum(s.quantity or 1 for s in window_sales)

    return total_value / total_qty if total_qty > 0 else None
```

---

## 12. Concrete Thresholds and Formulas

### Signal aggregation

```python
def aggregate_signals(signals):
    """
    Weighted vote across all fired signals.
    Returns final recommendation with conviction score.
    """
    if not signals:
        return {"action": "HOLD", "conviction": 0, "reason": "No signals fired"}

    buy_weight = 0
    sell_weight = 0
    buy_reasons = []
    sell_reasons = []

    for s in signals:
        w = s.get("weight", 1.0) * s.get("strength", 0.5)
        if s["signal"] == "buy":
            buy_weight += w
            buy_reasons.append(s.get("reason", s.get("type", "unknown")))
        elif s["signal"] == "sell":
            sell_weight += w
            sell_reasons.append(s.get("reason", s.get("type", "unknown")))

    total = buy_weight + sell_weight
    if total == 0:
        return {"action": "HOLD", "conviction": 0, "reason": "No directional signals"}

    conviction = abs(buy_weight - sell_weight) / total
    direction = "BUY" if buy_weight > sell_weight else "SELL"

    # Minimum thresholds
    if conviction < 0.25:
        return {
            "action": "HOLD",
            "conviction": conviction,
            "reason": "Signals too mixed for conviction",
            "buy_weight": round(buy_weight, 2),
            "sell_weight": round(sell_weight, 2),
        }

    num_agreeing = len(buy_reasons) if direction == "BUY" else len(sell_reasons)
    if num_agreeing < 2:
        return {
            "action": "HOLD",
            "conviction": conviction,
            "reason": f"Only {num_agreeing} signal(s) agree -- need at least 2 for confirmation",
            "buy_weight": round(buy_weight, 2),
            "sell_weight": round(sell_weight, 2),
        }

    return {
        "action": direction,
        "conviction": round(conviction, 2),
        "buy_weight": round(buy_weight, 2),
        "sell_weight": round(sell_weight, 2),
        "supporting_signals": buy_reasons if direction == "BUY" else sell_reasons,
        "opposing_signals": sell_reasons if direction == "BUY" else buy_reasons,
    }
```

### Complete threshold reference table

| Signal | Metric | Buy threshold | Sell threshold | Weight | Min data |
|---|---|---|---|---|---|
| Velocity ratio | 7d velocity / 60d velocity | > 1.5x | < 0.5x | 2.5 | 3+ sales in 60d |
| Velocity acceleration | Week-over-week velocity change of change | > +0.1/day/week | < -0.15/day/week | 2.0 | 1+ sale/week for 3 weeks |
| Accumulation | Velocity >1.8x AND price change <5% | Both conditions met | N/A | 3.0 | 5+ sales in 30d + 3+ price points |
| Distribution | Velocity <0.7x AND price change >10% | N/A | Both conditions met | 3.0 | 5+ sales in 30d + 5+ price points |
| VWAP divergence | (market_price - VWAP) / VWAP | < -10% | > +15% | 2.5 | 5+ sales in 30d |
| Condition shift | NM share change (recent vs prior) | NM share > +20% | NM share < -15% with LP/MP > +15% | 1.5 | 3+ sales per window |
| NM/LP premium | NM avg price / LP avg price | Ratio increasing > 0.05/month | Ratio < 1.05 (flat) | 1.0 | NM + LP sales both present |
| Pokemon sympathy | % of same-Pokemon printings surging | > 30% siblings surging, this card flat | N/A | 1.5 | 2+ sibling cards tracked |
| Set breadth | % of set cards with rising velocity | > 40% with this card lagging | > 50% falling velocity | 2.0 | 8+ tracked cards in set |
| Supply pressure | Listing growth rate | Listing rate down >30% | Listing rate up >50% + rising dispersion | 1.5 | Sales in both windows |
| Concentration | HHI + bulk ratio + listing diversity | Score >0.6 + rising velocity | Score >0.6 + falling price | 1.5 | 5+ sales in 30d |
| Dispersion change | Rate of high/low ratio change | Narrowing >20%/month (consensus bullish post-breakout) | Widening >20%/month (uncertainty, hold) | 1.0 | 14+ price records |
| Temporal | Day-of-week / month seasonal index | Seasonal low period (favorable buying time) | Seasonal high period (favorable selling time) | 0.5 | 20+ sales over 90d |

### Conviction tiers

| Conviction score | Required signals | Action |
|---|---|---|
| < 0.25 | Any | HOLD -- too mixed |
| 0.25 - 0.50 | 2+ agreeing | WEAK signal -- small position |
| 0.50 - 0.75 | 2+ agreeing | MODERATE signal -- standard position |
| > 0.75 | 3+ agreeing | STRONG signal -- full position |

### Data confidence discount

All signal strengths should be multiplied by a data confidence factor:

```python
def data_confidence(num_price_points, num_sales_30d):
    """
    Scale signal confidence by data availability.
    Sparse data = lower confidence = smaller position sizes.
    """
    price_conf = min(1.0, num_price_points / 60)     # Full confidence at 60+ price points
    sales_conf = min(1.0, num_sales_30d / 15)          # Full confidence at 15+ sales/month
    return (price_conf * 0.4 + sales_conf * 0.6)       # Sales data weighted higher (unique edge)
```

### Position sizing from signal strength

```python
def position_size(conviction, data_confidence, max_position_pct=0.10):
    """
    Determine position size as % of portfolio.
    conviction: 0-1 from signal aggregation
    data_confidence: 0-1 from data depth
    max_position_pct: maximum allocation to any single card
    """
    raw = conviction * data_confidence
    # Kelly-inspired scaling: never more than max_position_pct of portfolio
    return min(max_position_pct, raw * max_position_pct)
```

---

## Appendix: Signal Priority for Implementation

| Priority | Signal | Complexity | Expected alpha | Why |
|---|---|---|---|---|
| 1 | Accumulation (velocity up + price flat) | Medium | Highest | Direct measure of supply absorption before price discovery |
| 2 | VWAP divergence | Low | High | Simple computation, clear interpretation, unique to sale-level data |
| 3 | Velocity ratio | Low | High | Leading indicator with 3-10 day head start |
| 4 | Velocity acceleration | Low | Medium-high | Extra 2-4 days of lead time beyond velocity |
| 5 | Distribution (velocity down + price up) | Medium | High | Strongest sell signal, prevents buying tops |
| 6 | Set breadth | Medium | Medium | Reduces false positives via cross-card confirmation |
| 7 | Pokemon sympathy | Medium | Medium | Identifies lagging cards with catch-up potential |
| 8 | Condition shift | Medium | Medium | Unique to collectibles, not available in any other asset class |
| 9 | Supply pressure | Medium | Medium | Early warning of supply/demand imbalance |
| 10 | Sales concentration | High | Medium | Requires careful interpretation, context-dependent |
| 11 | Temporal patterns | Low | Low | Timing optimization, not direction prediction |
| 12 | Price dispersion | Low | Low | Supplementary -- confirms other signals but low standalone value |

**Key principle**: Sale-based signals (1-5) should be weighted highest because they represent a unique informational edge. Every market participant can see the TCGPlayer market price. Very few are computing VWAP from individual sales, tracking velocity acceleration, or detecting accumulation patterns. This asymmetry is where alpha lives.
