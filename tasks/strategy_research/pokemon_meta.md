# Pokemon-Specific Meta Factors for Trading Decisions

> **Purpose:** Translate Pokemon TCG competitive meta, franchise dynamics, and collector psychology into codeable rules for the trading system.
> All field references match the `Card` model: `name`, `set_name`, `set_id`, `rarity`, `artist`, `current_price`, `price_variant`, `created_at`, etc.
> Available data: card name, set name, set release date, rarity, Pokemon name, variant type, daily prices, completed sales. No external APIs for meta — must be derivable from existing data.

---

## 1. Competitive Tournament Meta Shifts

The Pokemon TCG competitive scene directly impacts card prices through three mechanisms: format rotation, ban announcements, and new archetype emergence. While we cannot scrape tournament results, we can detect meta shifts through price and velocity signals on cards with competitive subtypes.

### 1.1 Format Rotation

Pokemon TCG Standard format rotates annually, typically in April. Cards from the oldest legal sets become illegal for tournament play. This creates predictable price patterns:

**Pre-Rotation (2-3 months before):**
- Competitive staples from rotating sets begin declining 10-30%
- Players sell cards they can no longer use in tournaments
- Detection: cards with subtypes containing competitive mechanics (V, VMAX, VSTAR, ex) from sets approaching 2-year age show accelerating decline

**Post-Rotation (0-2 months after):**
- Rotated staples hit bottom — 30-60% below pre-rotation peak
- Non-competitive collector cards from same sets are unaffected
- Cards that gain dominance in the new format spike 20-100%

**Rotation Survivor Rally (3-6 months after):**
- Cards that survived rotation AND were already played gain 15-40%
- Fewer legal cards = each remaining staple gets more play = higher demand

### Competitive Card Detection

Cards with competitive relevance can be identified from metadata:

```python
COMPETITIVE_SUBTYPES = {
    # Current era mechanics
    "ex", "VMAX", "VSTAR", "V", "GX", "EX",
    # Support card indicators in subtypes
    "Stage 2", "Stage 1",  # Evolution lines used in decks
}

COMPETITIVE_SUPERTYPES = {"Trainer", "Energy"}  # Staple trainers spike from meta

def is_competitive_card(card) -> bool:
    """Determine if a card has competitive relevance based on metadata."""
    import json
    # Check subtypes
    if card.subtypes:
        subtypes = json.loads(card.subtypes) if isinstance(card.subtypes, str) else card.subtypes
        for st in subtypes:
            if st in COMPETITIVE_SUBTYPES:
                return True
    # Trainer cards above $5 are almost always competitively relevant
    if card.supertype == "Trainer" and card.current_price and card.current_price > 5.0:
        return True
    return False
```

### Rotation Timing Signal

```python
from datetime import datetime, timedelta

# Standard rotation typically happens in April
# Sets rotate out roughly 2 years after release
ROTATION_MONTH = 4

def get_rotation_signal(card, set_release_date: datetime) -> dict | None:
    """Detect rotation-related price pressure."""
    if not set_release_date or not is_competitive_card(card):
        return None

    now = datetime.utcnow()
    age_days = (now - set_release_date).days
    months_to_april = (ROTATION_MONTH - now.month) % 12
    if months_to_april == 0:
        months_to_april = 12

    # Cards approaching 2-year age with rotation within 6 months
    if 540 <= age_days <= 730 and months_to_april <= 6:
        return {
            "action": "SELL",
            "rule": "ROTATION_PRESSURE",
            "strength": 2.0 if months_to_april <= 3 else 1.5,
            "reason": f"{card.name} is {age_days} days old from {card.set_name}. "
                      f"Rotation in ~{months_to_april} months. Competitive staples from "
                      f"rotating sets lose 30-60% of value post-rotation.",
        }

    # Cards from sets that just rotated — collector floor opportunity
    if 730 <= age_days <= 820 and now.month in (4, 5, 6):
        if card.current_price and card.current_price > 3.0:
            return {
                "action": "BUY",
                "rule": "POST_ROTATION_FLOOR",
                "strength": 1.5,
                "reason": f"{card.name} recently rotated from Standard. Post-rotation "
                          f"floor is typically reached 1-2 months after rotation. "
                          f"Collector demand establishes a new baseline.",
            }
    return None
```

### 1.2 Ban Detection via Price Collapse

When a card is banned from competitive play, it drops 40-80% within days. We cannot know bans in advance, but we can detect the aftermath and distinguish bans from normal corrections:

**Ban signature:** Price drops 40%+ in under 7 days AND the card was previously competitive AND other cards from the same set are stable.

```python
def detect_ban_signal(card, price_change_7d: float, set_avg_change_7d: float) -> dict | None:
    """
    Detect potential ban-related price collapse.
    Ban signature: card drops 40%+ while set average is stable.
    """
    if not is_competitive_card(card):
        return None

    if price_change_7d < -40.0 and set_avg_change_7d > -10.0:
        return {
            "type": "BAN_DETECTED",
            "signal": "AVOID",
            "reason": f"{card.name} dropped {price_change_7d:.1f}% while {card.set_name} "
                      f"average moved only {set_avg_change_7d:.1f}%. Likely banned from "
                      f"competitive play. Do NOT buy the dip — banned cards rarely recover "
                      f"unless unbanned. Collector value floor is typically 20-30% of peak.",
            "confidence": 0.8,
        }
    return None
```

### 1.3 New Archetype Emergence

When a new set releases and creates a dominant competitive archetype, ALL cards in that archetype spike — not just the new card, but older supporting cards too.

**Detection pattern:** After a new set release (within 2-4 weeks), watch for older cards that suddenly spike in velocity 3x+ without being in the new set. These are likely "support cards" for a new archetype.

```python
def detect_archetype_spillover(card, velocity_ratio: float, price_change_14d: float,
                                new_set_release_within_30d: bool) -> dict | None:
    """
    Detect when an older card is being pulled into a new competitive archetype.
    Signal: older card spikes in velocity shortly after a new set release.
    """
    if not new_set_release_within_30d:
        return None

    age_days = (datetime.utcnow() - card.created_at).days if card.created_at else 0
    if age_days < 60:  # Card is from the new set itself — not spillover
        return None

    if velocity_ratio >= 3.0 and is_competitive_card(card):
        if price_change_14d < 20.0:  # Price hasn't caught up yet
            return {
                "action": "BUY",
                "rule": "ARCHETYPE_SPILLOVER",
                "strength": 2.0,
                "reason": f"{card.name} ({age_days} days old) showing {velocity_ratio:.1f}x "
                          f"velocity spike after new set release. Likely pulled into a new "
                          f"competitive archetype. Price hasn't adjusted yet (+{price_change_14d:.1f}%).",
            }
    return None
```

---

## 2. Pokemon Popularity Tiers

Certain Pokemon command a structural demand premium regardless of set, rarity, or era. This is driven by nostalgia, anime presence, competitive play history, and cultural icon status. The "popularity multiplier" represents how much more a card of equivalent rarity/condition sells for compared to a generic Pokemon from the same set.

### Tier 1 — Icons (4x-6x multiplier)

| Rank | Pokemon | Multiplier | Why |
|------|---------|------------|-----|
| 1 | **Charizard** | 5.0-6.0x | The undisputed king. Every Charizard card in every set commands a premium. Driven by nostalgia (1999 Base Set), anime (Ash's Charizard), and a self-reinforcing cycle: Charizard is expensive because Charizard has always been expensive. Logan Paul's $420K BGS 10 Base Set cemented this in mainstream culture. Any new Charizard chase card in a modern set becomes THE card to pull. |
| 2 | **Pikachu** | 3.0-4.0x | The franchise mascot. Every promo, every collaboration, every special release features Pikachu. Illustrator Pikachu is the most expensive card ever printed (~$900K). Van Gogh Pikachu promo caused riots at museums. Pikachu promos are the most collected sub-category in the hobby. |
| 3 | **Mewtwo** | 2.5-3.0x | The original "cool" legendary. Movie nostalgia (1998/2019), competitive relevance across eras, and a design that appeals to non-Pokemon fans. Base Set Mewtwo is a gateway drug for new collectors. |

### Tier 2 — Elite (2x-3x multiplier)

| Rank | Pokemon | Multiplier | Why |
|------|---------|------------|-----|
| 4 | **Mew** | 2.5x | Mythical status, movie tie-ins, always printed as a chase card. 151 set Mew cards are cornerstone collectibles. Cute factor + power fantasy combo. |
| 5 | **Umbreon** | 2.5-3.0x | The Eeveelution king. Evolving Skies Umbreon VMAX Alt Art is the most valuable modern card (~$300-500). Dark/cool aesthetic appeals to older collectors. Every Umbreon alt art or full art commands outsized premiums. |
| 6 | **Rayquaza** | 2.5x | Dragon-type poster child. Gold Star Rayquaza is a holy grail. Consistently one of the most expensive cards in every set it appears in. Shiny Rayquaza variants are especially premium. |
| 7 | **Gengar** | 2.0-2.5x | Ghost-type fan favorite, strong competitive history, great art direction across eras. Gengar cards tend to have the best illustrations (transparent body, creative compositions). |
| 8 | **Eevee / Eeveelutions** | 2.0-2.5x | Eight evolutions = eight collector sub-communities. Evolving Skies was built around Eeveelutions and became the most valuable modern set. Sylveon, Espeon, Glaceon, Leafeon all carry individual premiums. |
| 9 | **Lugia** | 2.0-2.5x | Neo Genesis chase card, Silver version mascot, consistently premium across sets. Lugia V Alt Art from Silver Tempest was the chase of that era. |
| 10 | **Blastoise** | 2.0x | Original starter trio nostalgia. Not as hyped as Charizard but every Blastoise from vintage sets commands respect. Base Set Blastoise is a staple of any vintage collection. |

### Tier 3 — Strong (1.5x-2x multiplier)

| Rank | Pokemon | Multiplier | Why |
|------|---------|------------|-----|
| 11 | **Venusaur** | 1.8x | Completes the Gen 1 starter trio. Growing appreciation as collectors realize Venusaur was always undervalued relative to Charizard/Blastoise. |
| 12 | **Gyarados** | 1.8x | Shiny red Gyarados from Gold/Silver is iconic. Strong art across eras, dragon-adjacent appeal. |
| 13 | **Dragonite** | 1.7x | Original pseudo-legendary, movie promo nostalgia, universally liked design. |
| 14 | **Celebi** | 1.6x | Mythical status, Neo-era nostalgia, appeals to the "cute legendary" collector segment. |
| 15 | **Gardevoir** | 1.6x | Competitive staple across multiple formats, strong art direction, fan-favorite design. |
| 16 | **Tyranitar** | 1.5x | The "cool" Gen 2 Pokemon. Dark-type appeal, Godzilla-esque design, strong in competitive play. |
| 17 | **Alakazam** | 1.5x | Base Set nostalgia, 1st Edition Alakazam is a collector staple, iconic psychic-type. |
| 18 | **Arcanine** | 1.5x | "Legendary Pokemon" per the Pokedex, dog lover appeal, beautiful art across sets. |
| 19 | **Suicune** | 1.5x | Crystal-type chase card from Aquapolis, elegant design, legendary beast trio collector appeal. |
| 20 | **Mimikyu** | 1.5x | Modern fan favorite, unique lore (disguises as Pikachu), appeals to both cute and creepy collectors. Breakout star of Gen 7+. |

### Tier 4 — Emerging Premium (1.2x-1.5x multiplier)

These Pokemon are gaining popularity and may move up in future tiers:

| Pokemon | Multiplier | Notes |
|---------|------------|-------|
| **Lucario** | 1.4x | Fighting-type poster child, strong in competitive, movie star. |
| **Greninja** | 1.4x | #1 in Japanese popularity polls, anime favorite, Ash's ace. |
| **Snorlax** | 1.3x | Beloved design, meme culture, sleep-themed cards are popular. |
| **Absol** | 1.3x | Dark-type aesthetic, cult following, beautiful art history. |
| **Darkrai** | 1.3x | Mythical dark-type, competitive history, edge-lord aesthetic. |
| **Ho-Oh** | 1.3x | Gold version mascot, rainbow aesthetic, pairs with Lugia collectors. |
| **Entei / Raikou** | 1.2x | Legendary beast trio completionism drives demand. |
| **Scizor** | 1.2x | Cool design, competitive staple across eras. |
| **Palkia / Dialga** | 1.2x | Gen 4 nostalgia wave is arriving (2026-2028 peak). |
| **Giratina** | 1.3x | Origin form is visually striking, competitive in current era. |

### Implementation: Popularity Lookup

```python
POKEMON_POPULARITY = {
    # Tier 1 — Icons
    "Charizard": 5.5, "Pikachu": 3.5, "Mewtwo": 2.75,
    # Tier 2 — Elite
    "Mew": 2.5, "Umbreon": 2.75, "Rayquaza": 2.5,
    "Gengar": 2.25, "Eevee": 2.25, "Lugia": 2.25, "Blastoise": 2.0,
    # Eeveelution family (inherits Eevee tier)
    "Sylveon": 2.0, "Espeon": 2.0, "Glaceon": 1.8, "Leafeon": 1.8,
    "Vaporeon": 1.8, "Jolteon": 1.8, "Flareon": 1.8,
    # Tier 3 — Strong
    "Venusaur": 1.8, "Gyarados": 1.8, "Dragonite": 1.7, "Celebi": 1.6,
    "Gardevoir": 1.6, "Tyranitar": 1.5, "Alakazam": 1.5, "Arcanine": 1.5,
    "Suicune": 1.5, "Mimikyu": 1.5,
    # Tier 4 — Emerging
    "Lucario": 1.4, "Greninja": 1.4, "Snorlax": 1.3, "Absol": 1.3,
    "Darkrai": 1.3, "Ho-Oh": 1.3, "Giratina": 1.3,
    "Entei": 1.2, "Raikou": 1.2, "Scizor": 1.2,
    "Palkia": 1.2, "Dialga": 1.2,
}

def get_popularity_multiplier(card_name: str) -> float:
    """Extract Pokemon name from card name and return popularity multiplier.
    Card names often include suffixes: 'Charizard ex', 'Charizard VMAX', 'Charizard V'.
    """
    base_name = card_name
    for suffix in [" ex", " EX", " GX", " VMAX", " VSTAR", " V", " BREAK",
                   " Lv.X", " \u03b4", " FB", " GL", " SP", " C", " G",
                   " Prism Star", " \u25c7", " Radiant"]:
        if base_name.endswith(suffix):
            base_name = base_name[:-len(suffix)]
            break
    return POKEMON_POPULARITY.get(base_name, 1.0)
```

---

## 3. Set Dynamics — Value Over the Lifecycle

Card values follow a predictable lifecycle tied to set printing, distribution, and eventual discontinuation.

### 3.1 Set Value Lifecycle Phases

```
Phase 1: PRE-RELEASE (2-4 weeks before)
  - Prices based on Japanese set data and speculation
  - Chase cards are overpriced by 50-200%
  - Signal: NEVER buy pre-release. Wait.

Phase 2: RELEASE WEEK (week 1)
  - Maximum hype, maximum prices for chase cards
  - Supply is constrained (allocations, shipping delays)
  - Signal: SELL if you pulled chase cards early

Phase 3: HONEYMOON (weeks 2-4)
  - Prices remain elevated but begin softening
  - Content creators drive continued openings
  - Signal: HOLD chase cards, SELL mid-tier pulls

Phase 4: POST-HYPE CORRECTION (weeks 4-8)
  - Supply catches up to demand
  - Chase cards drop 30-50% from release week peak
  - Mid-tier cards drop 50-70%
  - Signal: BUY chase cards (best entry for new sets)

Phase 5: STABILIZATION (months 2-6)
  - Prices find a floor based on actual collector demand
  - Set is still in print, stores are restocking
  - Signal: ACCUMULATE undervalued chase cards

Phase 6: END OF PRINT (months 6-18)
  - Set goes out of active printing
  - Supply begins contracting (no new product at retail)
  - Prices of top cards start climbing 5-15% per quarter
  - Signal: BUY high-rarity cards, supply is fixed

Phase 7: OUT OF PRINT APPRECIATION (years 2-5)
  - Steady appreciation as sealed product dries up
  - High-rarity cards from popular sets appreciate 20-50% annually
  - Signal: STRONG HOLD for blue-chip cards

Phase 8: VINTAGE STATUS (years 5+)
  - Set achieves "vintage" collector status
  - Price appreciation accelerates for top cards
  - Nostalgia wave from kids who opened the set entering collecting age
  - Signal: HOLD indefinitely. These only go up long-term.
```

### 3.2 Set Desirability Tiers

#### Tier 1 — Vintage Holy Grails (set_premium = 3.0-5.0x)

These sets will never be reprinted, supply only decreases over time, and collector demand is perpetual.

| Set Name | set_id Pattern | Premium | Notes |
|----------|---------------|---------|-------|
| Base Set | `base1` | 5.0x | The original 102 cards. 1st Edition is the pinnacle. Unlimited and Shadowless both command premiums. |
| Base Set 2 | `base2` | 2.0x | Reprint of Base/Jungle but still 25+ years old. Lower premium than OG Base. |
| Jungle | `base3` / `jungle` | 2.5x | First expansion. Flareon, Jolteon, Vaporeon holos are staples. |
| Fossil | `base4` / `fossil` | 2.5x | Gengar, Dragonite, Articuno/Zapdos/Moltres holos. |
| Team Rocket | `base5` / `team rocket` | 2.5x | Dark Pokemon concept was revolutionary. Dark Charizard is iconic. |
| Gym Heroes / Gym Challenge | `gym1`, `gym2` | 2.5x | Character-specific cards (Blaine's Charizard). Underappreciated and climbing. |
| Neo Genesis | `neo1` | 3.0x | Lugia holo is the chase. First Gen 2 cards. 1st Edition boxes are $20K+. |
| Neo Discovery / Revelation / Destiny | `neo2-4` | 2.5-3.0x | Shining cards from Neo Destiny are top-tier chase cards ($500-5000+). |
| Skyridge | `ecard3` / `skyridge` | 4.0x | Last WOTC set, extremely low print run. Crystal-type cards are the rarest standard cards. |
| Aquapolis | `ecard2` / `aquapolis` | 3.5x | Same era as Skyridge, Crystal cards, low print run. |
| Expedition | `ecard1` / `expedition` | 2.5x | First e-Card set, reverse holos are uniquely designed. |

#### Tier 2 — Growing Demand (set_premium = 1.5-2.5x)

These sets are aging into collector status. Print runs were larger than WOTC but supply is tightening.

| Set Name | Era | Premium | Notes |
|----------|-----|---------|-------|
| ex-era sets (2003-2007) | Ruby & Sapphire through Power Keepers | 1.5-2.5x | Gold star cards from these sets ($200-2000+). ex cards have a growing nostalgia wave. |
| Diamond & Pearl era (2007-2010) | DP through Arceus | 1.5-2.0x | Lv.X cards are climbing. These are the next "vintage" wave. |
| HeartGold SoulSilver era (2010-2011) | HGSS through Call of Legends | 2.0x | LEGEND cards, SL (Shiny) cards from Call of Legends are highly sought after. |
| Black & White era (2011-2013) | BW through Plasma Blast | 1.5x | Full Art Supporters started here. Full Art N is a $200+ card. |

#### Tier 3 — Modern Chase Sets (set_premium = 1.2-2.0x)

| Set Name | set_id | Premium | Notes |
|----------|--------|---------|-------|
| Evolving Skies | `swsh7` | 2.0x | Eeveelution alt arts. Most valuable Sword & Shield set. |
| Pokemon 151 | `sv3pt5` / `151` | 1.8x | Nostalgia play — original 151 Pokemon. |
| Prismatic Evolutions | varies | 1.8x | Eeveelution focus, extremely high demand at launch. |
| Hidden Fates | `sm115` | 1.5x | Shiny Vault sub-set. Shiny Charizard GX was the chase standard. |
| Champions Path | `swsh35` | 1.3x | Rainbow Charizard VMAX. One-dimensional but iconic. |
| Crown Zenith | `swsh125` | 1.5x | Galarian Gallery subset. End-of-era set. |

#### Tier 4 — Bulk Modern (set_premium = 0.8-1.0x)

| Category | Premium | Notes |
|----------|---------|-------|
| Current standard set (< 3 months old) | 1.0-1.2x | Inflated by hype, will correct downward. |
| Standard set 3-12 months old | 0.8-1.0x | Post-hype correction. Best time to buy chase cards. |
| Standard set 1-3 years old, rotated | 0.7-0.9x | Competitive irrelevance hits hard. Only collector appeal remains. |
| Non-chase modern set > 3 years old | 0.8x | Bulk territory unless specific cards break out. |

### 3.3 Detecting Set Lifecycle Phase from Data

We can infer set lifecycle phase using `card_sets.release_date` and price trends:

```python
from datetime import datetime, timedelta

def get_set_lifecycle_phase(set_release_date: datetime) -> dict:
    """Determine which lifecycle phase a set is in based on age."""
    if not set_release_date:
        return {"phase": "UNKNOWN", "signal": "HOLD"}

    age_days = (datetime.utcnow().date() - set_release_date).days

    if age_days < 0:
        return {"phase": "PRE_RELEASE", "signal": "WAIT", "note": "Do not buy pre-release hype"}
    elif age_days <= 7:
        return {"phase": "RELEASE_WEEK", "signal": "SELL", "note": "Sell early pulls into hype"}
    elif age_days <= 28:
        return {"phase": "HONEYMOON", "signal": "HOLD", "note": "Prices softening, not yet at floor"}
    elif age_days <= 56:
        return {"phase": "POST_HYPE_CORRECTION", "signal": "BUY",
                "note": "Best entry point for new set chase cards"}
    elif age_days <= 180:
        return {"phase": "STABILIZATION", "signal": "ACCUMULATE",
                "note": "Prices at floor, set still in print"}
    elif age_days <= 540:
        return {"phase": "END_OF_PRINT", "signal": "BUY",
                "note": "Supply contracting, high-rarity appreciation begins"}
    elif age_days <= 1825:
        return {"phase": "OUT_OF_PRINT", "signal": "STRONG_HOLD",
                "note": "Fixed supply, steady appreciation"}
    else:
        return {"phase": "VINTAGE", "signal": "STRONG_HOLD",
                "note": "Vintage status, perpetual demand"}

VINTAGE_HOLY_GRAIL_SETS = {
    "base1": 5.0, "base2": 2.0, "base3": 2.5, "base4": 2.5, "base5": 2.5,
    "gym1": 2.5, "gym2": 2.5,
    "neo1": 3.0, "neo2": 2.5, "neo3": 2.75, "neo4": 3.0,
    "ecard1": 2.5, "ecard2": 3.5, "ecard3": 4.0,
}

VINTAGE_SET_NAMES = {
    "Base Set": 5.0, "Jungle": 2.5, "Fossil": 2.5, "Team Rocket": 2.5,
    "Gym Heroes": 2.5, "Gym Challenge": 2.5,
    "Neo Genesis": 3.0, "Neo Discovery": 2.5, "Neo Revelation": 2.75,
    "Neo Destiny": 3.0, "Skyridge": 4.0, "Aquapolis": 3.5, "Expedition": 2.5,
}

MODERN_CHASE_SETS = {
    "Evolving Skies": 2.0, "Hidden Fates": 1.5, "Champions Path": 1.3,
    "Crown Zenith": 1.5, "Shining Fates": 1.3,
    "Pokemon 151": 1.8, "Prismatic Evolutions": 1.8,
}

def get_set_premium(set_name: str, set_id: str) -> float:
    """Return set desirability multiplier."""
    if set_id in VINTAGE_HOLY_GRAIL_SETS:
        return VINTAGE_HOLY_GRAIL_SETS[set_id]
    for name, premium in VINTAGE_SET_NAMES.items():
        if name.lower() in set_name.lower():
            return premium
    for name, premium in MODERN_CHASE_SETS.items():
        if name.lower() in set_name.lower():
            return premium
    return 1.0
```

---

## 4. Nostalgia Cycles

Pokemon card demand follows generational nostalgia waves with a roughly 15-20 year cycle. When people who grew up with a particular generation of Pokemon enter their late 20s to mid 30s (peak disposable income + nostalgia trigger), cards from that era spike.

### 4.1 The Nostalgia Wave Timeline

```
GENERATION    GAMES RELEASED    KIDS AGED 8-14     NOSTALGIA PEAK (age 25-35)    STATUS (2026)
---------     ---------------   ----------------   ---------------------------   -------------
Gen 1         1996-1999         1990-2005 births   2015-2040                     ACTIVE PEAK
Gen 2         1999-2001         1993-2007 births   2018-2042                     ACTIVE PEAK
Gen 3         2002-2004         1996-2010 births   2021-2045                     RAMPING UP
Gen 4         2006-2009         2000-2015 births   2025-2050                     JUST STARTING
Gen 5         2010-2013         2004-2019 births   2029-2054                     PRE-NOSTALGIA
Gen 6         2013-2016         2007-2022 births   2032-2057                     TOO EARLY
```

### 4.2 Nostalgia Wave Trading Rules

**Gen 1 Nostalgia (WOTC era cards, 1999-2003):**
- Already in full swing since 2016 (YouTube/TikTok acceleration)
- Peak mainstream attention: 2020-2021 (COVID + Logan Paul)
- Current phase: POST-PEAK STABILIZATION
- Cards are at elevated but sustainable levels
- Rule: Buy dips on iconic Gen 1 cards. They have a permanent demand floor.

**Gen 2 Nostalgia (Neo era + e-Card era):**
- Starting to accelerate as 2000-born kids hit their mid-20s
- Neo Genesis/Destiny and Aquapolis/Skyridge sets are the targets
- Current phase: EARLY ACCELERATION
- Rule: Accumulate Gen 2 Pokemon chase cards (Lugia, Tyranitar, Celebi, Umbreon, Espeon, Ho-Oh, legendary beasts) from Neo-era sets. These are undervalued relative to their Gen 1 equivalents.

**Gen 3 Nostalgia (ex era, 2003-2007):**
- The "Ruby & Sapphire kids" are entering nostalgia age (mid to late 20s)
- Gold Star cards already pricing in this wave
- Current phase: RAMPING UP
- Rule: Buy ex-era Gold Stars and popular Pokemon ex cards (Rayquaza, Groudon, Kyogre, Blaziken, Gardevoir). These have 3-5 years of nostalgia tailwind ahead.

**Gen 4 Nostalgia (Diamond & Pearl era, 2007-2010):**
- The next big wave. Kids born 2000-2005 are just entering the nostalgia window.
- Lv.X cards, Arceus, Darkrai, Lucario, Garchomp — all underappreciated
- Current phase: JUST STARTING (2025-2026)
- Rule: This is the "buy before the wave" opportunity. Accumulate:
  - Lv.X cards of popular Pokemon (Charizard Lv.X, Garchomp Lv.X, Lucario Lv.X)
  - Sealed product from DP era (if available)
  - Any card featuring Dialga, Palkia, Giratina, Darkrai, Lucario, Garchomp

### 4.3 Detecting Nostalgia Waves from Data

We can detect nostalgia waves by monitoring price trends on older sets. When a set that has been flat for years starts appreciating across multiple cards simultaneously, a nostalgia wave is forming.

```python
# Generation-to-set mapping for nostalgia detection
GENERATION_SETS = {
    "gen1": {
        "set_ids": {"base1", "base2", "base3", "base4", "base5", "base6",
                    "gym1", "gym2"},
        "set_names": {"Base Set", "Jungle", "Fossil", "Team Rocket",
                      "Gym Heroes", "Gym Challenge"},
        "peak_years": (2018, 2030),
        "pokemon": {"Charizard", "Blastoise", "Venusaur", "Pikachu", "Mewtwo",
                     "Mew", "Gengar", "Alakazam", "Dragonite", "Gyarados",
                     "Arcanine", "Eevee"},
    },
    "gen2": {
        "set_ids": {"neo1", "neo2", "neo3", "neo4"},
        "set_names": {"Neo Genesis", "Neo Discovery", "Neo Revelation", "Neo Destiny"},
        "peak_years": (2024, 2035),
        "pokemon": {"Lugia", "Ho-Oh", "Tyranitar", "Celebi", "Umbreon", "Espeon",
                     "Suicune", "Entei", "Raikou", "Scizor"},
    },
    "gen3": {
        "set_ids": set(),  # ex-era IDs vary
        "set_names": {"Ruby & Sapphire", "Sandstorm", "Dragon", "Team Magma vs Team Aqua",
                      "Hidden Legends", "FireRed & LeafGreen", "Team Rocket Returns",
                      "Deoxys", "Emerald", "Unseen Forces", "Delta Species",
                      "Legend Maker", "Holon Phantoms", "Crystal Guardians",
                      "Dragon Frontiers", "Power Keepers"},
        "peak_years": (2027, 2038),
        "pokemon": {"Rayquaza", "Groudon", "Kyogre", "Blaziken", "Gardevoir",
                     "Salamence", "Metagross", "Deoxys", "Latias", "Latios"},
    },
    "gen4": {
        "set_ids": set(),
        "set_names": {"Diamond & Pearl", "Mysterious Treasures", "Secret Wonders",
                      "Great Encounters", "Majestic Dawn", "Legends Awakened",
                      "Stormfront", "Platinum", "Rising Rivals", "Supreme Victors",
                      "Arceus"},
        "peak_years": (2031, 2042),
        "pokemon": {"Dialga", "Palkia", "Giratina", "Darkrai", "Lucario",
                     "Garchomp", "Arceus", "Torterra", "Infernape", "Empoleon"},
    },
}

def get_nostalgia_signal(card, set_name: str) -> dict | None:
    """Assess nostalgia wave positioning for a card."""
    current_year = datetime.utcnow().year

    for gen, data in GENERATION_SETS.items():
        # Check if card belongs to this generation's sets
        in_gen_set = any(name.lower() in set_name.lower() for name in data["set_names"])
        if not in_gen_set:
            continue

        peak_start, peak_end = data["peak_years"]

        if current_year < peak_start - 3:
            return {
                "nostalgia_phase": "PRE_WAVE",
                "generation": gen,
                "signal": "STRONG_BUY",
                "reason": f"{card.name} from {gen} era. Nostalgia wave expected "
                          f"{peak_start}-{peak_end}. Currently pre-wave — "
                          f"best risk/reward for long-term appreciation.",
            }
        elif peak_start - 3 <= current_year <= peak_start:
            return {
                "nostalgia_phase": "EARLY_WAVE",
                "generation": gen,
                "signal": "BUY",
                "reason": f"{card.name} from {gen} era. Nostalgia wave ramping up. "
                          f"Prices accelerating as generation enters peak collecting age.",
            }
        elif peak_start < current_year <= peak_end:
            return {
                "nostalgia_phase": "ACTIVE_PEAK",
                "generation": gen,
                "signal": "HOLD",
                "reason": f"{card.name} from {gen} era. Currently in active nostalgia peak. "
                          f"Prices elevated but sustained by generational demand.",
            }

    return None
```

### 4.4 The 5-Year Charizard Cycle

Charizard experiences a mini nostalgia cycle roughly every 5 years, driven by new Charizard chase cards in flagship sets:

```
2014: Mega Charizard EX (Flashfire) — $50-80
2019: Charizard & Reshiram GX (Unbroken Bonds) + Hidden Fates Shiny Charizard GX — $200-400
2020: Champions Path Rainbow Charizard VMAX — $300-500
2023: Pokemon 151 Special Illustration Rare Charizard — $100-200
2025: Prismatic Evolutions Charizard — TBD
```

Every major Charizard release lifts ALL Charizard cards across all eras. When a new Charizard chase card is announced, vintage Charizard cards appreciate 5-15% in sympathy. This is the "Charizard tide lifts all boats" effect.

---

## 5. Reprint Risk Assessment

Reprint risk is the single biggest threat to card values. A card worth $50 can drop to $5 if reprinted in a widely available product.

### 5.1 Reprint Risk Categories

#### Safe from Reprints (reprint_risk = "NONE")

| Category | Why Safe |
|----------|----------|
| **WOTC-era cards (1999-2003)** | Card templates, mechanics, and numbering are retired. A Base Set Charizard can never be "reprinted" — any new Charizard is a different card. |
| **Cards with retired mechanics** (ex lowercase pre-2023, Lv.X, LEGEND, BREAK, Prism Star) | The mechanic is discontinued. The original cards are unique. |
| **Event-exclusive promos** | Tropical Mega Battle, World Championship promos, Staff cards. Specific print runs tied to events that will never recur. |
| **Error/misprint cards** | Unreproducible by definition. |
| **Vintage 1st Edition cards** | 1st Edition stamps were only used in WOTC era. |

#### Low Reprint Risk (reprint_risk = "LOW")

| Category | Why Low |
|----------|---------|
| **Cards from sets 5+ years old** | TPC rarely reprints specific older cards. They make new versions with new art instead. |
| **Alt Art / Special Illustration Rare** | These specific artworks are tied to their set. A new Umbreon VMAX might be printed, but not with the Moonbreon art. |
| **Gold Star cards** | Mechanic retired, specific art tied to the era. |
| **Japanese-exclusive promos** | Most stay Japan-exclusive or get different English versions. |

#### Moderate Reprint Risk (reprint_risk = "MODERATE")

| Category | Why Moderate |
|----------|-------------|
| **Modern cards 1-4 years old** | Could appear in reprint collections, tins, or battle decks. Usually different variant/artwork though. |
| **Competitively relevant cards** | TPC sometimes reprints staple trainers and Pokemon in League products or promo boxes. |
| **Cards from popular modern sets** | If demand is high enough, TPC may do additional print runs. |

#### High Reprint Risk (reprint_risk = "HIGH")

| Category | Why High |
|----------|---------|
| **Current Standard-legal cards** | Can be reprinted in any future product until rotation. |
| **Trainer cards / Supporters** | Most likely to be reprinted as promos, in tins, or in trainer boxes. Boss's Orders has been printed 5+ times. |
| **Cards from sets < 1 year old** | Active print runs. Additional waves, special collections, etc. |
| **Cards spiking purely from competitive play** | If a $2 card spikes to $20 from a tournament win, TPC often includes it in upcoming products to help competitive accessibility. |

### 5.2 Reprint Risk Detection Heuristics

Beyond the category rules above, these data-derived signals indicate heightened reprint risk:

1. **Price spike on a Trainer/Supporter card**: If a Trainer card goes from $2 to $15+ due to competitive demand, reprint probability within 3-6 months is >60%.
2. **Card featured in upcoming product (detectable from price pre-spike)**: When upcoming tin/collection box contents leak (usually 2-3 months early), the featured card's price drops before the official announcement.
3. **Multiple same-Pokemon cards in recent sets**: If TPC prints Charizard ex in Set A, then announces Charizard ex in Set B three months later, Set A's Charizard value drops.

```python
WOTC_SET_IDS = {
    "base1", "base2", "base3", "base4", "base5", "base6",
    "gym1", "gym2", "neo1", "neo2", "neo3", "neo4",
    "ecard1", "ecard2", "ecard3",
    "si1", "bp",
}

REPRINT_SAFE_RARITIES = {
    "Rare Shiny GX", "LEGEND", "Rare Prism Star", "Rare BREAK",
}

def assess_reprint_risk(card) -> str:
    """Return 'NONE', 'LOW', 'MODERATE', or 'HIGH'."""
    if card.set_id in WOTC_SET_IDS:
        return "NONE"
    if card.rarity in REPRINT_SAFE_RARITIES:
        return "LOW"
    if card.rarity in ("Special Illustration Rare", "Hyper Rare"):
        return "LOW"

    # Trainer cards in Standard always have high reprint risk
    if card.supertype == "Trainer":
        age_days = (datetime.utcnow() - card.created_at).days if card.created_at else 0
        if age_days < 730:
            return "HIGH"

    # Age-based assessment
    if card.created_at:
        age_days = (datetime.utcnow() - card.created_at).days
        if age_days > 1825:  # 5+ years
            return "LOW"
        elif age_days > 365:
            return "MODERATE"

    return "HIGH"
```

---

## 6. Art / Illustration Premium

The variant and art style of a card is one of the strongest price determinants. Two cards featuring the same Pokemon from the same set can differ 50x in price based on art treatment.

### 6.1 Art Tier Hierarchy (modern Scarlet & Violet era)

```
TIER    VARIANT TYPE                    PREMIUM vs BASE HOLO    PULL RATE
----    -------------------------------- ---------------------    ---------
S+      Hyper Rare (gold textured)       15-25x                  ~1/700 packs
S       Special Illustration Rare        10-20x                  ~1/400 packs
A+      Illustration Rare                3-6x                    ~1/100 packs
A       Ultra Rare (Full Art)            3-5x                    ~1/60 packs
B+      Double Rare (ex)                 2-3x                    ~1/20 packs
B       Rare Holo                        1.0x (baseline)         ~1/10 packs
C       Reverse Holo                     0.3-0.5x                ~1/3 packs
D       Non-holo Rare                    0.1-0.2x                ~1/5 packs
F       Common / Uncommon               0.01-0.05x               guaranteed
```

### 6.2 Art Style Premium Factors

Beyond rarity, specific art characteristics command premiums:

| Art Factor | Premium | How to Detect |
|------------|---------|---------------|
| **Panoramic/environmental scene** | +50-100% vs standard pose | Cannot detect from metadata alone; correlates with "Illustration Rare" and "Special Illustration Rare" rarity |
| **Full-bleed art (no border)** | +30-50% | Correlates with higher rarities (SIR, IR) |
| **Dynamic action pose** | +10-20% | Cannot detect from metadata |
| **"Cute" or "cozy" scene** | +20-40% for certain Pokemon | Especially Eeveelutions, Pikachu. Correlates with certain artists (sowsow) |
| **Dark/dramatic atmosphere** | +20-30% for dark-type Pokemon | Umbreon, Gengar, Darkrai benefit most |
| **Shiny/alternate color** | +100-300% | Detectable from rarity containing "Shiny" |
| **Gold/textured surface** | +200-500% | "Hyper Rare" rarity |

### 6.3 Variant Type Pricing

The `price_variant` field tells us which variant we're tracking:

```python
VARIANT_PREMIUMS = {
    "normal": 1.0,           # Standard card
    "holofoil": 2.0,         # Holographic (vintage: 3-5x for Base Set era)
    "reverseHolofoil": 0.5,  # Reverse holo pattern (usually less valuable)
    "1stEditionHolofoil": 10.0,  # WOTC 1st Edition holos
    "1stEditionNormal": 3.0,     # WOTC 1st Edition non-holos
}
```

### 6.4 Artist Premiums

The `card.artist` field identifies the illustrator. Certain artists consistently produce cards that command premiums above what the Pokemon/rarity alone would suggest.

#### Tier 1 — Premium Artists (1.5-3.0x multiplier)

| Artist | Multiplier | Known For |
|--------|------------|-----------|
| **Mitsuhiro Arita** | 1.5x | Original Base Set Charizard illustrator. Every Arita card has provenance premium. |
| **HYOGONOSUKE** (Shibuzoh) | 2.0-3.0x | Alt art master. Umbreon VMAX Alt Art ("Moonbreon"). Most sought-after modern artist. |
| **Atsushi Furusawa** | 1.8x | Dynamic, detailed illustration rares that consistently outperform peers. |
| **Yuu Nishida** | 1.5x | Clean, dynamic poses with excellent color work. |
| **Anesaki Dynamic** | 1.5x | Bold, energetic full arts and illustration rares. |

#### Tier 2 — Notable Artists (1.2-1.5x multiplier)

| Artist | Multiplier | Known For |
|--------|------------|-----------|
| **Naoki Saito** | 1.3x | Prolific modern artist with large following. |
| **sowsow** | 1.4x | Distinctive cute/whimsical style. Collector favorite. |
| **PLANETA** (various) | 1.3x | CG art studio. Polarizing but recognizable. |
| **Kagemaru Himeno** | 1.3x | Classic WOTC-era artist. Nostalgia premium. |
| **Ken Sugimori** | 1.5x | Original Pokemon character designer. Rare on modern cards. |
| **Kouki Saitou** | 1.2x | Huge catalog, collected for completionism. |

```python
ARTIST_PREMIUMS = {
    "Mitsuhiro Arita": 1.5,
    "HYOGONOSUKE": 2.5, "Shibuzoh.": 2.5,
    "Atsushi Furusawa": 1.8,
    "Yuu Nishida": 1.5,
    "Anesaki Dynamic": 1.5,
    "Naoki Saito": 1.3,
    "sowsow": 1.4,
    "PLANETA Mochizuki": 1.3, "PLANETA Tsuji": 1.3, "PLANETA Yamashita": 1.3,
    "Kagemaru Himeno": 1.3,
    "Ken Sugimori": 1.5,
    "Kouki Saitou": 1.2,
}

def get_artist_premium(artist: str) -> float:
    if not artist:
        return 1.0
    if artist in ARTIST_PREMIUMS:
        return ARTIST_PREMIUMS[artist]
    for known_artist, premium in ARTIST_PREMIUMS.items():
        if known_artist in artist or artist in known_artist:
            return premium
    return 1.0
```

### 6.5 Rarity Multiplier Table

```python
RARITY_MULTIPLIERS = {
    "Common": 0.02, "Uncommon": 0.05, "Rare": 0.2,
    "Rare Holo": 1.0,
    "Rare Holo EX": 1.75, "Rare Holo GX": 1.75, "Rare Holo V": 1.5,
    "Rare Ultra": 4.0,
    "Rare VMAX": 2.5, "Rare VSTAR": 2.0,
    "Rare Holo VMAX": 5.0,
    "Rare Secret": 7.5, "Rare Rainbow": 6.0,
    "Rare Shiny": 4.5,
    "Illustration Rare": 4.0,
    "Special Illustration Rare": 12.0,
    "Hyper Rare": 15.0,
    "Promo": 1.0,
    "ACE SPEC Rare": 3.0,
    "Double Rare": 2.0,
    "Ultra Rare": 4.0,
    "Shiny Rare": 4.5,
    "Shiny Ultra Rare": 8.0,
}

def get_rarity_multiplier(rarity: str) -> float:
    if not rarity:
        return 1.0
    return RARITY_MULTIPLIERS.get(rarity, 1.0)
```

---

## 7. Cross-Pokemon Correlation

When a high-profile Pokemon card spikes, related cards often follow with a lag. Understanding these correlation patterns enables early-entry trades on correlated cards.

### 7.1 Correlation Groups

| Primary Mover | Correlated Cards | Correlation Strength | Typical Lag |
|---------------|-----------------|---------------------|-------------|
| **Charizard** (any new chase card) | Blastoise same set, Venusaur same set, all vintage Charizards | Strong (0.7-0.9) | 1-3 days for same-set starters, 3-7 days for vintage sympathetic |
| **Charizard** (new set release) | ALL Gen 1 starters across ALL sets | Moderate (0.4-0.6) | 1-2 weeks |
| **Umbreon** (alt art spike) | Other Eeveelution alt arts from same set | Strong (0.7-0.8) | 2-5 days |
| **Any Eeveelution** | Other Eeveelutions from same set | Moderate (0.5-0.7) | 3-7 days |
| **Lugia** (chase card spike) | Ho-Oh from same or adjacent set | Moderate (0.5-0.6) | 3-7 days |
| **Legendary trio member** (beast, bird, lake) | Other trio members from same set | Strong (0.6-0.8) | 2-5 days |
| **Any card from a set** (social media spike) | Other chase cards from same set | Moderate (0.4-0.6) | 3-14 days |

### 7.2 The Starter Trio Correlation

The strongest cross-Pokemon correlation is the original starter trio: Charizard, Blastoise, Venusaur. When ANY of these three moves significantly in a specific set, the other two from the same set tend to follow.

**Mechanism:** Collectors who buy one tend to want the complete trio. When Charizard spikes and gets media attention, people buy Blastoise and Venusaur "while they're still cheap."

**Asymmetry:** Charizard leads, Blastoise follows at ~60% magnitude, Venusaur follows at ~40% magnitude. Venusaur and Blastoise rarely lead — when they spike first, it is usually from a set-wide demand increase.

### 7.3 The Eeveelution Cascade

When one Eeveelution card from an Eeveelution-focused set (Evolving Skies, Prismatic Evolutions) spikes, the others follow in a cascade ordered by popularity:

```
Spike order (typical):
  Umbreon → Espeon → Sylveon → Glaceon → Leafeon → Vaporeon → Jolteon → Flareon

Magnitude decay:
  Umbreon: 100% (lead)
  Espeon: 80%
  Sylveon: 70%
  Glaceon: 50%
  Others: 30-40%
```

### 7.4 Implementation: Cross-Correlation Detection

```python
# Define correlation groups based on card name extraction
STARTER_TRIO = {"Charizard", "Blastoise", "Venusaur"}
EEVEELUTION_FAMILY = {"Eevee", "Vaporeon", "Jolteon", "Flareon", "Espeon",
                       "Umbreon", "Leafeon", "Glaceon", "Sylveon"}
LEGENDARY_BEASTS = {"Raikou", "Entei", "Suicune"}
LEGENDARY_BIRDS = {"Articuno", "Zapdos", "Moltres"}
LAKE_TRIO = {"Uxie", "Mesprit", "Azelf"}
TOWER_DUO = {"Lugia", "Ho-Oh"}
CREATION_TRIO = {"Dialga", "Palkia", "Giratina"}

CORRELATION_GROUPS = [
    {"name": "starter_trio", "members": STARTER_TRIO, "correlation": 0.75,
     "leader": "Charizard", "follower_magnitude": 0.5},
    {"name": "eeveelutions", "members": EEVEELUTION_FAMILY, "correlation": 0.65,
     "leader": "Umbreon", "follower_magnitude": 0.6},
    {"name": "legendary_beasts", "members": LEGENDARY_BEASTS, "correlation": 0.7,
     "leader": None, "follower_magnitude": 0.7},
    {"name": "legendary_birds", "members": LEGENDARY_BIRDS, "correlation": 0.7,
     "leader": None, "follower_magnitude": 0.7},
    {"name": "tower_duo", "members": TOWER_DUO, "correlation": 0.6,
     "leader": "Lugia", "follower_magnitude": 0.5},
    {"name": "creation_trio", "members": CREATION_TRIO, "correlation": 0.6,
     "leader": None, "follower_magnitude": 0.6},
]

def find_correlation_group(pokemon_name: str) -> dict | None:
    """Find which correlation group a Pokemon belongs to."""
    for group in CORRELATION_GROUPS:
        if pokemon_name in group["members"]:
            return group
    return None

def get_correlation_signal(card, pokemon_name: str, card_price_change_7d: float,
                           group_member_changes: dict) -> dict | None:
    """
    Detect cross-correlation trading opportunity.

    Args:
        card: The card being evaluated
        pokemon_name: Extracted Pokemon name
        card_price_change_7d: This card's 7-day price change %
        group_member_changes: Dict of {pokemon_name: price_change_7d} for group members
                             from the SAME SET as this card
    """
    group = find_correlation_group(pokemon_name)
    if not group or not group_member_changes:
        return None

    # Check if any group member from same set has spiked while this card hasn't
    for member_name, member_change in group_member_changes.items():
        if member_name == pokemon_name:
            continue

        # Another group member spiked 15%+ but this card is flat or down
        if member_change > 15.0 and card_price_change_7d < 5.0:
            expected_move = member_change * group["follower_magnitude"]
            return {
                "action": "BUY",
                "rule": "CROSS_CORRELATION",
                "strength": min(expected_move / 10, 2.5),
                "group": group["name"],
                "reason": f"{member_name} from {card.set_name} spiked {member_change:.1f}% "
                          f"but {pokemon_name} only moved {card_price_change_7d:+.1f}%. "
                          f"Historical correlation ({group['correlation']:.0%}) suggests "
                          f"{pokemon_name} should follow with ~{expected_move:.0f}% move.",
            }

    return None
```

### 7.5 Same-Set Correlation

Beyond Pokemon-specific correlation, there is a broader "same-set" correlation: when one chase card from a set gets social media attention, other chase cards from the same set see increased interest. This happens because:

1. Content creators open more packs of that set
2. Viewers discover other chase cards while watching
3. Marketplace algorithms recommend "also from this set"

**Detection rule:** When the highest-value card in a set spikes 20%+, watch other cards from that set with rarity >= "Ultra Rare". They typically follow within 1-2 weeks at 20-40% of the lead card's magnitude.

---

## 8. Seasonal Patterns Specific to Pokemon

### 8.1 Annual Calendar

```
MONTH       EVENT                           PRICE EFFECT
-------     -----                           ------------
January     New Year lull                   Modern prices bottom out. BUYING window.
                                           Post-holiday supply flood from opened gifts.

February    Pokemon Day (Feb 27)            New announcements spike speculation.
                                           Cards of newly announced Pokemon rise 10-20%.
                                           Overall market gets attention boost.

March       Q1 set release                  New set cards spike then correct over 4-6 weeks.
                                           Previous set non-chase cards drop 10-20%.

April       Post-release correction +       New set prices normalize. Rotation hits.
            Standard rotation               Competitive staples from rotating sets crater.

May         Spring lull                     Flat period. Vintage and older sets move sideways.
                                           Good accumulation window for everything.

June        Q2 set release + summer start   New set release + summer collecting begins.
                                           Overall market liquidity increases.

July        Summer peak collecting          Highest sales volume. Prices firm up across board.
                                           Kids spending birthday money, summer camps, etc.

August      Pokemon World Championships     Competitive cards spike 20-50%. Worlds winner decklist
                                           drives staple prices for 2-4 weeks. Venue-exclusive
                                           promos become instant collectibles ($50-200).

September   Q3 set release + back to school New set hype. Summer collectors exit.
                                           Brief dip in non-new-set cards.

October     Holiday set announced           Special sets often drop Q4. Anticipation builds.
                                           Halloween: Ghost/Dark-type Pokemon get brief 5-10%
                                           bump (Gengar, Mimikyu, Darkrai specifically).

November    HOLIDAY BUYING SURGE            Prices increase 10-30% across the board.
                                           Parents and gift-givers drive demand.
                                           SELLING window for modern.

December    Peak holiday + Q4 special set   Maximum retail demand. Singles peak mid-December.
                                           SELL modern chase cards before Dec 20.
                                           Post-Dec 25: prices drop as gifts get opened and
                                           pulled cards flood the market.
```

### 8.2 Pokemon-Specific Seasonal Events

| Event | Date | Price Effect | Duration |
|-------|------|-------------|----------|
| **Pokemon Day** | Feb 27 | New game/set announcements. Featured Pokemon spike 10-20%. | 1-2 weeks |
| **Pokemon World Championships** | Mid-August | Winning deck staples spike 20-50%. Venue promos spike. | 2-4 weeks |
| **New Game Release** | Varies (Nov usually) | Cards featuring Pokemon from the new game spike. Starter Pokemon from new gen get 15-30% bump. | 1-3 months |
| **Pokemon GO Community Day** | Monthly | Featured Pokemon gets brief 5-10% card price bump from cross-media attention. | 3-5 days |
| **Anime season finale / movie** | Varies | Featured Pokemon in climactic episodes/movies see 5-15% bumps. | 1-2 weeks |
| **TCG Online/Live updates** | Varies | Cards that become playable online see velocity increases. | Ongoing |

### 8.3 The Holiday Sealed Product Effect

November-December holiday season has a specific dynamic for singles:

1. **Early November:** Parents start buying sealed product as gifts. Sealed prices rise 20-40%.
2. **Mid-November to Dec 20:** Singles prices rise 10-30% as gift-givers also buy singles for collectors.
3. **Dec 25-31:** Gift recipients open sealed product, pull cards, and list singles for sale. SUPPLY FLOOD.
4. **January 1-15:** Maximum supply, minimum demand. Singles prices bottom. This is THE buying window.

### 8.4 Implementation: Calendar Signals

```python
from datetime import datetime

def get_seasonal_signal(date: datetime = None) -> dict:
    """Return seasonal buy/sell bias based on time of year."""
    if date is None:
        date = datetime.now()
    month = date.month
    day = date.day

    # Special event overrides
    if month == 2 and 25 <= day <= 28:
        return {"modern": "HOLD", "vintage": "HOLD",
                "reason": "Pokemon Day window — watch for announcements",
                "event": "POKEMON_DAY"}

    if month == 8 and 10 <= day <= 25:
        return {"modern": "SELL", "vintage": "HOLD",
                "reason": "World Championships — sell competitive staples into hype",
                "event": "WORLDS"}

    if month == 10 and 25 <= day <= 31:
        return {"modern": "HOLD", "vintage": "HOLD",
                "reason": "Halloween — Ghost/Dark types get brief premium",
                "event": "HALLOWEEN"}

    signals = {
        1:  {"modern": "BUY",  "vintage": "HOLD",
             "reason": "Post-holiday dump, maximum supply, year's best buying window"},
        2:  {"modern": "BUY",  "vintage": "HOLD",
             "reason": "Pre-Q1 set lull, prices at floor"},
        3:  {"modern": "HOLD", "vintage": "BUY",
             "reason": "New set diverts attention from vintage"},
        4:  {"modern": "BUY",  "vintage": "HOLD",
             "reason": "Post-hype correction on Q1 set + rotation dip"},
        5:  {"modern": "HOLD", "vintage": "BUY",
             "reason": "Spring lull, accumulation window"},
        6:  {"modern": "HOLD", "vintage": "HOLD",
             "reason": "Summer collecting starts, liquidity rising"},
        7:  {"modern": "HOLD", "vintage": "HOLD",
             "reason": "Peak summer volume, prices firming"},
        8:  {"modern": "SELL", "vintage": "HOLD",
             "reason": "Worlds hype peaks, sell competitive staples"},
        9:  {"modern": "HOLD", "vintage": "BUY",
             "reason": "Q3 set diverts attention from vintage"},
        10: {"modern": "HOLD", "vintage": "HOLD",
             "reason": "Pre-holiday anticipation building"},
        11: {"modern": "SELL", "vintage": "SELL",
             "reason": "Peak gift-buying demand, sell into strength"},
        12: {"modern": "SELL", "vintage": "HOLD",
             "reason": "Sell modern before Dec 20, hold vintage through holiday"},
    }
    return signals[month]

# Halloween Pokemon list for seasonal premium detection
HALLOWEEN_POKEMON = {"Gengar", "Mimikyu", "Darkrai", "Giratina", "Spiritomb",
                      "Chandelure", "Banette", "Misdreavus", "Sableye", "Dusknoir",
                      "Haunter", "Gastly", "Litwick", "Pumpkaboo", "Gourgeist"}

def get_halloween_signal(card, pokemon_name: str) -> dict | None:
    """Detect Halloween seasonal premium opportunity."""
    now = datetime.utcnow()
    if now.month == 10 and pokemon_name in HALLOWEEN_POKEMON:
        if now.day < 20:
            return {
                "action": "BUY",
                "rule": "HALLOWEEN_PREMIUM",
                "strength": 1.0,
                "reason": f"{pokemon_name} cards get 5-10% seasonal premium around Halloween. "
                          f"Buy before Oct 20, sell Oct 28-31.",
            }
        elif now.day >= 28:
            return {
                "action": "SELL",
                "rule": "HALLOWEEN_SELL",
                "strength": 1.0,
                "reason": f"Halloween premium peaks Oct 28-31. Sell {pokemon_name} cards now "
                          f"before seasonal demand fades.",
            }
    return None
```

---

## 9. Quantitative Trading Signal — Composite Meta Score

This section synthesizes all Pokemon-specific meta factors into a single quantitative signal that can be computed from our available data (card name, set name, set release date, rarity, variant, artist, daily prices, completed sales).

### 9.1 The Meta Score Formula

Every card gets a **Meta Score** (0-100) composed of six sub-scores:

```
Meta Score = weighted average of:
  - Popularity Score    (weight: 0.25)  — Pokemon brand strength
  - Set Score          (weight: 0.20)  — Set desirability + lifecycle phase
  - Rarity Score       (weight: 0.20)  — Rarity tier + art premium
  - Safety Score       (weight: 0.15)  — Inverse reprint risk + nostalgia protection
  - Momentum Score     (weight: 0.10)  — Price trend alignment with meta thesis
  - Seasonal Score     (weight: 0.10)  — Calendar alignment
```

### 9.2 Sub-Score Calculations

```python
import math
from datetime import datetime, timedelta

def compute_meta_score(card, price_history: list, sales_data: list,
                        set_release_date: datetime = None) -> dict:
    """
    Compute comprehensive Pokemon meta score for a card.

    Returns dict with total score (0-100) and sub-scores.

    All inputs derived from existing data:
      - card: Card model instance (name, set_name, set_id, rarity, artist, etc.)
      - price_history: List of PriceHistory records
      - sales_data: List of Sale records
      - set_release_date: From CardSet.release_date
    """

    # === 1. POPULARITY SCORE (0-100) ===
    popularity_mult = get_popularity_multiplier(card.name)
    # Map multiplier to 0-100 scale: 1.0 = 20, 2.0 = 50, 3.5 = 75, 5.5 = 95
    popularity_score = min(100, 20 + (popularity_mult - 1.0) * 16.7)

    # === 2. SET SCORE (0-100) ===
    set_premium = get_set_premium(card.set_name, card.set_id)
    # Base set score from premium: 1.0 = 30, 2.0 = 55, 3.0 = 70, 5.0 = 90
    set_base = min(100, 30 + (set_premium - 1.0) * 15)

    # Lifecycle bonus: out-of-print and vintage get bonus
    lifecycle_bonus = 0
    if set_release_date:
        phase = get_set_lifecycle_phase(set_release_date)
        lifecycle_bonuses = {
            "PRE_RELEASE": -20, "RELEASE_WEEK": -10, "HONEYMOON": -5,
            "POST_HYPE_CORRECTION": 5, "STABILIZATION": 10,
            "END_OF_PRINT": 15, "OUT_OF_PRINT": 20, "VINTAGE": 25,
        }
        lifecycle_bonus = lifecycle_bonuses.get(phase["phase"], 0)

    set_score = min(100, max(0, set_base + lifecycle_bonus))

    # === 3. RARITY SCORE (0-100) ===
    rarity_mult = get_rarity_multiplier(card.rarity)
    artist_mult = get_artist_premium(card.artist)
    # Map rarity multiplier: 0.02 = 5, 1.0 = 30, 4.0 = 60, 12.0 = 85, 15.0 = 95
    rarity_base = min(100, 5 + math.log2(max(rarity_mult, 0.01) + 1) * 22)
    # Artist bonus: up to +15 points
    artist_bonus = min(15, (artist_mult - 1.0) * 10)
    rarity_score = min(100, rarity_base + artist_bonus)

    # === 4. SAFETY SCORE (0-100) ===
    # Inverse of reprint risk + nostalgia protection
    reprint_risk = assess_reprint_risk(card)
    reprint_scores = {"NONE": 95, "LOW": 75, "MODERATE": 45, "HIGH": 20}
    safety_base = reprint_scores.get(reprint_risk, 40)

    # Nostalgia bonus
    nostalgia_bonus = 0
    nostalgia_signal = get_nostalgia_signal(card, card.set_name)
    if nostalgia_signal:
        phase_bonuses = {
            "PRE_WAVE": 15, "EARLY_WAVE": 10, "ACTIVE_PEAK": 5,
        }
        nostalgia_bonus = phase_bonuses.get(nostalgia_signal["nostalgia_phase"], 0)

    safety_score = min(100, safety_base + nostalgia_bonus)

    # === 5. MOMENTUM SCORE (0-100) ===
    # Based on recent price action alignment with meta thesis
    momentum_score = 50  # Neutral default
    if price_history and len(price_history) >= 14:
        prices = [p.market_price for p in price_history if p.market_price]
        if len(prices) >= 14:
            recent_avg = sum(prices[-7:]) / 7
            older_avg = sum(prices[-14:-7]) / 7
            pct_change = ((recent_avg - older_avg) / older_avg * 100) if older_avg else 0

            # For high-meta cards (popularity > 2, set premium > 1.5):
            #   uptrend = good (momentum aligned with fundamentals)
            if popularity_mult >= 2.0 or set_premium >= 1.5:
                if pct_change > 5:
                    momentum_score = min(90, 60 + pct_change)
                elif pct_change < -10:
                    # Dip on high-meta card = buying opportunity
                    momentum_score = min(85, 70 + abs(pct_change) * 0.5)
                else:
                    momentum_score = 55  # Stable = slightly positive for quality cards
            else:
                # For low-meta cards, only uptrend matters
                if pct_change > 10:
                    momentum_score = min(80, 50 + pct_change)
                elif pct_change < -5:
                    momentum_score = max(20, 50 + pct_change)

    # === 6. SEASONAL SCORE (0-100) ===
    seasonal = get_seasonal_signal()
    seasonal_score = 50  # Neutral default

    # Determine if card is "modern" or "vintage"
    is_vintage = set_premium >= 2.0 or (
        card.created_at and (datetime.utcnow() - card.created_at).days > 1825
    )
    card_type = "vintage" if is_vintage else "modern"

    signal = seasonal.get(card_type, "HOLD")
    seasonal_map = {"BUY": 75, "SELL": 25, "HOLD": 50}
    seasonal_score = seasonal_map.get(signal, 50)

    # === COMPOSITE META SCORE ===
    weights = {
        "popularity": 0.25,
        "set": 0.20,
        "rarity": 0.20,
        "safety": 0.15,
        "momentum": 0.10,
        "seasonal": 0.10,
    }

    meta_score = (
        popularity_score * weights["popularity"]
        + set_score * weights["set"]
        + rarity_score * weights["rarity"]
        + safety_score * weights["safety"]
        + momentum_score * weights["momentum"]
        + seasonal_score * weights["seasonal"]
    )

    return {
        "meta_score": round(meta_score, 1),
        "sub_scores": {
            "popularity": round(popularity_score, 1),
            "set": round(set_score, 1),
            "rarity": round(rarity_score, 1),
            "safety": round(safety_score, 1),
            "momentum": round(momentum_score, 1),
            "seasonal": round(seasonal_score, 1),
        },
        "classification": classify_meta_score(meta_score),
        "factors": {
            "pokemon_multiplier": popularity_mult,
            "set_premium": set_premium,
            "rarity_multiplier": rarity_mult,
            "artist_premium": artist_mult,
            "reprint_risk": reprint_risk,
        },
    }

def classify_meta_score(score: float) -> str:
    """Classify card based on meta score."""
    if score >= 80:
        return "BLUE_CHIP"       # Top-tier collectible, strong hold
    elif score >= 65:
        return "STRONG_HOLD"     # Quality card with multiple premium factors
    elif score >= 50:
        return "TRADE_ON_SIGNAL" # Decent card, trade on technical signals
    elif score >= 35:
        return "SPECULATIVE"     # Low-meta card, only trade on momentum
    else:
        return "COMMODITY"       # Bulk territory, not worth tracking
```

### 9.3 Example Meta Scores

| Card | Pop | Set | Rarity | Safety | Mom | Seas | **Total** | Class |
|------|-----|-----|--------|--------|-----|------|-----------|-------|
| Base Set Charizard Holo | 95 | 90 | 30 | 95 | 55 | 50 | **74.5** | STRONG_HOLD |
| Umbreon VMAX Alt Art (Evolving Skies) | 79 | 55 | 85 | 75 | 60 | 50 | **69.0** | STRONG_HOLD |
| Charizard SIR (151) | 95 | 66 | 90 | 45 | 50 | 50 | **69.5** | STRONG_HOLD |
| Generic Holo from modern set | 20 | 30 | 30 | 20 | 50 | 50 | **29.0** | COMMODITY |
| Lugia Neo Genesis Holo | 61 | 70 | 30 | 100 | 55 | 50 | **60.0** | TRADE_ON_SIGNAL |
| Gold Star Rayquaza (ex era) | 75 | 55 | 68 | 90 | 50 | 50 | **65.0** | STRONG_HOLD |
| Gengar SIR (modern) by HYOGONOSUKE | 61 | 30 | 95 | 45 | 60 | 50 | **55.5** | TRADE_ON_SIGNAL |

### 9.4 Trading Decision Matrix

Combine Meta Score with price action to determine trading decisions:

```python
def get_meta_trading_signal(meta_score: float, classification: str,
                             price_change_7d: float, price_change_30d: float,
                             velocity_ratio: float) -> dict:
    """
    Final trading signal combining meta score with price action.

    Returns: {action, confidence, reason}
    """

    # BLUE_CHIP cards (meta >= 80)
    if classification == "BLUE_CHIP":
        if price_change_7d < -15:
            return {"action": "STRONG_BUY", "confidence": 0.85,
                    "reason": "Blue-chip card dipping — buy the dip on highest-quality asset"}
        elif price_change_30d < -25:
            return {"action": "BUY", "confidence": 0.80,
                    "reason": "Blue-chip monthly decline — accumulation opportunity"}
        elif price_change_7d > 30 and velocity_ratio > 3:
            return {"action": "HOLD", "confidence": 0.70,
                    "reason": "Blue-chip spiking — hold, do not sell blue chips into spikes"}
        else:
            return {"action": "HOLD", "confidence": 0.75,
                    "reason": "Blue-chip card — default hold, never sell unless exiting collecting"}

    # STRONG_HOLD cards (meta 65-80)
    if classification == "STRONG_HOLD":
        if price_change_7d < -15:
            return {"action": "BUY", "confidence": 0.75,
                    "reason": "Strong card dipping — likely temporary"}
        elif price_change_7d > 50 and velocity_ratio > 5:
            return {"action": "SELL", "confidence": 0.60,
                    "reason": "Strong card spike (social?) — take partial profits"}
        else:
            return {"action": "HOLD", "confidence": 0.65,
                    "reason": "Strong card — hold for long-term appreciation"}

    # TRADE_ON_SIGNAL cards (meta 50-65)
    if classification == "TRADE_ON_SIGNAL":
        if price_change_7d < -20 and velocity_ratio < 0.5:
            return {"action": "AVOID", "confidence": 0.60,
                    "reason": "Mid-tier card declining with low velocity — no floor support"}
        elif velocity_ratio > 5 and price_change_7d < 10:
            return {"action": "BUY", "confidence": 0.65,
                    "reason": "Velocity spike on mid-tier card — price may follow"}
        elif price_change_7d > 40:
            return {"action": "SELL", "confidence": 0.70,
                    "reason": "Mid-tier spike — take profits, these tend to revert"}
        else:
            return {"action": "HOLD", "confidence": 0.50,
                    "reason": "Mid-tier card — wait for clear signal"}

    # SPECULATIVE cards (meta 35-50)
    if classification == "SPECULATIVE":
        if velocity_ratio > 5 and price_change_7d < 5:
            return {"action": "BUY", "confidence": 0.55,
                    "reason": "Speculative velocity spike — high risk, high reward"}
        elif price_change_7d > 30:
            return {"action": "SELL", "confidence": 0.75,
                    "reason": "Speculative spike — sell immediately, these revert hard"}
        else:
            return {"action": "AVOID", "confidence": 0.55,
                    "reason": "Speculative card with no signal — not worth the risk"}

    # COMMODITY cards (meta < 35)
    return {"action": "AVOID", "confidence": 0.80,
            "reason": "Commodity-grade card — no structural demand, not worth tracking"}
```

---

## 10. Concrete Trading Rules (Complete Set)

All 15 rules below translate the above analysis into codeable decision logic. Each rule uses only fields available in the `Card` model and data accessible via the API.

### Rule 1: Popular Pokemon Dip Buy

```python
def rule_popular_pokemon_dip(card, price_change_7d: float) -> dict | None:
    """
    Top-tier Pokemon card drops 15%+ in 7 days without fundamental reason.
    Popular Pokemon always recover.
    """
    multiplier = get_popularity_multiplier(card.name)
    if multiplier >= 2.0 and price_change_7d < -15.0:
        reprint_risk = assess_reprint_risk(card)
        if reprint_risk != "HIGH":
            return {
                "action": "BUY", "rule": "POPULAR_POKEMON_DIP",
                "strength": min(abs(price_change_7d) / 10, 3.0),
                "reason": f"{card.name} (popularity {multiplier}x) dropped {price_change_7d:.1f}% "
                          f"in 7 days. Reprint risk: {reprint_risk}. High-demand Pokemon "
                          f"typically recover from non-fundamental dips.",
            }
    return None
```

### Rule 2: New Set Post-Hype Correction Buy

```python
def rule_post_hype_correction(card, set_release_date: datetime,
                               price_change_30d: float) -> dict | None:
    """
    Chase cards from new sets drop 30-50% in weeks 4-6 after release.
    Buy the dip on high-rarity cards.
    """
    days_since_release = (datetime.utcnow() - set_release_date).days
    if 28 <= days_since_release <= 60 and price_change_30d < -25.0:
        rarity_mult = get_rarity_multiplier(card.rarity)
        if rarity_mult >= 4.0:
            return {
                "action": "BUY", "rule": "POST_HYPE_CORRECTION", "strength": 2.0,
                "reason": f"{card.name} ({card.rarity}) from {card.set_name} dropped "
                          f"{price_change_30d:.1f}% since release ({days_since_release} days). "
                          f"Post-hype correction window. Chase cards find floor around week 6-8.",
            }
    return None
```

### Rule 3: Vintage Set Accumulation

```python
def rule_vintage_accumulation(card, price_change_90d: float) -> dict | None:
    """
    Vintage cards (WOTC era) flat or slightly declining for 90+ days are in
    accumulation. These have permanent demand floors.
    """
    set_premium = get_set_premium(card.set_name, card.set_id)
    if set_premium >= 2.5 and -10.0 <= price_change_90d <= 5.0:
        if card.current_price and card.current_price >= 10.0:
            return {
                "action": "BUY", "rule": "VINTAGE_ACCUMULATION", "strength": 1.5,
                "reason": f"{card.name} from {card.set_name} (set premium {set_premium}x) "
                          f"stable ({price_change_90d:+.1f}% over 90 days). "
                          f"Vintage accumulation phases tend to break upward. Zero reprint risk.",
            }
    return None
```

### Rule 4: Secret Rare Out-of-Print Play

```python
def rule_secret_rare_oop(card, set_release_date: datetime) -> dict | None:
    """Secret Rares from sets 6+ months old (likely out of print) = fixed supply."""
    days_since_release = (datetime.utcnow() - set_release_date).days
    rarity_mult = get_rarity_multiplier(card.rarity)
    if rarity_mult >= 5.0 and days_since_release > 180:
        return {
            "action": "BUY", "rule": "SECRET_RARE_OOP", "strength": 1.5,
            "reason": f"{card.name} ({card.rarity}) from {card.set_name} is {days_since_release} "
                      f"days post-release. Fixed supply + collector demand = appreciation.",
        }
    return None
```

### Rule 5: Holiday Sell Signal

```python
def rule_holiday_sell(card, current_month: int) -> dict | None:
    """Modern cards peak Nov-Dec due to gift buying. Sell into strength."""
    if current_month in (11, 12):
        reprint_risk = assess_reprint_risk(card)
        if reprint_risk in ("HIGH", "MODERATE"):
            age_days = (datetime.utcnow() - card.created_at).days if card.created_at else 0
            if age_days < 730:
                return {
                    "action": "SELL", "rule": "HOLIDAY_SELL",
                    "strength": 1.5 if current_month == 11 else 2.0,
                    "reason": f"Holiday demand peaks. {card.name} is modern with {reprint_risk} "
                              f"reprint risk. Sell before post-Christmas supply flood.",
                }
    return None
```

### Rule 6: Artist Premium Undervaluation

```python
def rule_artist_undervalued(card, comparable_avg_price: float) -> dict | None:
    """Cards by premium artists priced below comparable cards are undervalued."""
    artist_mult = get_artist_premium(card.artist)
    if artist_mult >= 1.5 and card.current_price:
        expected_price = comparable_avg_price * artist_mult
        if card.current_price < expected_price * 0.7:
            return {
                "action": "BUY", "rule": "ARTIST_UNDERVALUED", "strength": 1.5,
                "reason": f"{card.name} by {card.artist} ({artist_mult}x premium) at "
                          f"${card.current_price:.2f} vs expected ${expected_price:.2f}. "
                          f"Artist premium not yet priced in.",
            }
    return None
```

### Rule 7: Velocity Spike Early Entry

```python
def rule_velocity_spike_buy(card, recent_velocity: float, baseline_velocity: float,
                            price_change_7d: float) -> dict | None:
    """Velocity spike (5x+) without price movement = incoming demand not yet priced in."""
    if baseline_velocity < 0.1:
        return None
    velocity_ratio = recent_velocity / baseline_velocity
    if velocity_ratio >= 5.0 and price_change_7d < 10.0:
        return {
            "action": "BUY", "rule": "VELOCITY_SPIKE_EARLY", "strength": 2.5,
            "reason": f"{card.name} velocity {velocity_ratio:.1f}x above baseline but price "
                      f"only {price_change_7d:+.1f}%. Price follows velocity with 24-72hr lag.",
        }
    return None
```

### Rule 8: Social Spike Profit Taking

```python
def rule_social_spike_sell(card, price_change_7d: float, velocity_ratio: float) -> dict | None:
    """Card spiked 50%+ in 7 days with high velocity = social-driven, will revert."""
    if price_change_7d > 50.0 and velocity_ratio >= 3.0:
        popularity = get_popularity_multiplier(card.name)
        if popularity < 2.0:
            return {
                "action": "SELL", "rule": "SOCIAL_SPIKE_SELL", "strength": 2.0,
                "reason": f"{card.name} spiked {price_change_7d:.1f}% with {velocity_ratio:.1f}x "
                          f"velocity. Non-iconic Pokemon spike reversions average 50-70%. "
                          f"Take profits.",
            }
    return None
```

### Rule 9: Eeveelution Set Premium

```python
EEVEELUTION_NAMES = {"Eevee", "Vaporeon", "Jolteon", "Flareon", "Espeon", "Umbreon",
                      "Leafeon", "Glaceon", "Sylveon"}

def rule_eeveelution_premium(card, price_change_30d: float) -> dict | None:
    """Eeveelution cards from Eeveelution-focused sets that dip are mispriced."""
    base_name = card.name.split()[0] if card.name else ""
    is_eevee_set = any(s in card.set_name.lower()
                       for s in ["evolving skies", "prismatic", "eevee"])
    if base_name in EEVEELUTION_NAMES and is_eevee_set:
        rarity_mult = get_rarity_multiplier(card.rarity)
        if rarity_mult >= 3.0 and price_change_30d < -20.0:
            return {
                "action": "BUY", "rule": "EEVEELUTION_DIP", "strength": 2.0,
                "reason": f"{card.name} from {card.set_name} dropped {price_change_30d:.1f}% "
                          f"in 30 days. Eeveelution cards from dedicated sets have proven "
                          f"long-term demand. Likely temporary dip.",
            }
    return None
```

### Rule 10: Reprint Risk Exit

```python
def rule_reprint_risk_exit(card, price_change_30d: float) -> dict | None:
    """Declining competitive cards with high reprint risk — exit."""
    reprint_risk = assess_reprint_risk(card)
    if reprint_risk == "HIGH" and price_change_30d < -10.0:
        if card.current_price and card.current_price > 5.0:
            return {
                "action": "SELL", "rule": "REPRINT_RISK_EXIT", "strength": 1.5,
                "reason": f"{card.name} has HIGH reprint risk and dropped {price_change_30d:.1f}% "
                          f"in 30 days. Declining competitive staples with reprint risk "
                          f"rarely recover. Exit.",
            }
    return None
```

### Rule 11: Grading Flood Recovery Buy

```python
def rule_grading_flood_buy(card, price_change_14d: float) -> dict | None:
    """Vintage cards dropping 15%+ in 2 weeks = possible grading flood. Temporary."""
    set_premium = get_set_premium(card.set_name, card.set_id)
    if set_premium >= 2.0 and price_change_14d < -15.0:
        if card.current_price and card.current_price >= 20.0:
            return {
                "action": "BUY", "rule": "GRADING_FLOOD_RECOVERY", "strength": 1.5,
                "reason": f"{card.name} (vintage, set premium {set_premium}x) dropped "
                          f"{price_change_14d:.1f}% in 14 days. Grading floods are temporary "
                          f"— raw prices recover in 4-6 weeks.",
            }
    return None
```

### Rule 12: January Clearance Buy

```python
def rule_january_clearance(card, current_month: int, price_change_30d: float) -> dict | None:
    """January: post-holiday supply flood creates year's best buying window."""
    if current_month == 1 and price_change_30d < -10.0:
        rarity_mult = get_rarity_multiplier(card.rarity)
        if rarity_mult >= 3.0:
            return {
                "action": "BUY", "rule": "JANUARY_CLEARANCE", "strength": 2.0,
                "reason": f"{card.name} ({card.rarity}) dropped {price_change_30d:.1f}% in "
                          f"January. Post-holiday supply flood. Prices recover by March-April.",
            }
    return None
```

### Rule 13: Illustration Rare Appreciation Curve

```python
def rule_illustration_rare_appreciation(card, price_change_90d: float,
                                         set_release_date: datetime) -> dict | None:
    """SIR/IR cards 3-12 months old following the proven alt-art trajectory."""
    if card.rarity not in ("Special Illustration Rare", "Illustration Rare", "Hyper Rare"):
        return None
    days_since = (datetime.utcnow() - set_release_date).days
    if 90 <= days_since <= 180 and -5.0 <= price_change_90d <= 10.0:
        return {
            "action": "BUY", "rule": "ILLUST_RARE_FLOOR", "strength": 2.0,
            "reason": f"{card.name} ({card.rarity}) flat ({price_change_90d:+.1f}%) at "
                      f"{days_since} days post-release. Likely at or near floor. "
                      f"Optimal entry for illustration rare appreciation play.",
        }
    elif 90 <= days_since <= 365 and price_change_90d > 10.0:
        return {
            "action": "HOLD", "rule": "ILLUST_RARE_APPRECIATION", "strength": 1.5,
            "reason": f"{card.name} up {price_change_90d:.1f}% over 90 days, "
                      f"{days_since} days post-release. On the appreciation curve. Hold.",
        }
    return None
```

### Rule 14: Multi-Factor Premium Card

```python
def rule_multi_factor_premium(card) -> dict | None:
    """Cards stacking 3+ premium factors are blue-chip holds."""
    popularity = get_popularity_multiplier(card.name)
    artist_prem = get_artist_premium(card.artist)
    rarity_mult = get_rarity_multiplier(card.rarity)
    set_prem = get_set_premium(card.set_name, card.set_id)

    factors = []
    if popularity >= 2.0:
        factors.append(f"popular Pokemon ({popularity}x)")
    if artist_prem >= 1.3:
        factors.append(f"premium artist: {card.artist} ({artist_prem}x)")
    if rarity_mult >= 4.0:
        factors.append(f"high rarity: {card.rarity} ({rarity_mult}x)")
    if set_prem >= 1.5:
        factors.append(f"desirable set: {card.set_name} ({set_prem}x)")

    if len(factors) >= 3:
        composite = popularity * artist_prem * (rarity_mult ** 0.5) * (set_prem ** 0.5)
        return {
            "action": "STRONG_BUY", "rule": "MULTI_FACTOR_PREMIUM",
            "strength": min(composite / 5.0, 3.0),
            "reason": f"{card.name} stacks {len(factors)} premium factors: "
                      f"{'; '.join(factors)}. Blue chip with strongest long-term potential.",
        }
    return None
```

### Rule 15: Liquidity Dry-Up Warning

```python
def rule_liquidity_dryup(card, current_velocity: float,
                          historical_velocity: float) -> dict | None:
    """Velocity below 20% of historical average = becoming illiquid. Exit."""
    if historical_velocity < 0.1:
        return None
    velocity_ratio = current_velocity / historical_velocity
    if velocity_ratio < 0.2 and card.current_price and card.current_price > 10.0:
        return {
            "action": "SELL", "rule": "LIQUIDITY_DRYUP", "strength": 1.5,
            "reason": f"{card.name} velocity at {velocity_ratio:.0%} of historical average. "
                      f"Illiquid cards develop wide spreads. Exit while there's still a market.",
        }
    return None
```

---

## 11. Composite Signal Engine

All 15 rules run against every tracked card during each analysis cycle. Stack multiple signals for stronger conviction:

```python
def evaluate_card(card, market_data: dict) -> dict:
    """
    Run all trading rules against a card and return composite signal.

    market_data should contain:
      - price_change_7d, price_change_30d, price_change_90d, price_change_14d
      - recent_velocity, baseline_velocity, historical_velocity
      - velocity_ratio
      - set_release_date
      - comparable_avg_price (same rarity/set average)
      - new_set_release_within_30d (bool)
      - current_month
      - group_member_changes (dict for cross-correlation)
    """
    signals = []

    # Run all 15 rules (each returns dict or None)
    rule_results = [
        rule_popular_pokemon_dip(card, market_data.get("price_change_7d", 0)),
        rule_post_hype_correction(card, market_data.get("set_release_date"),
                                   market_data.get("price_change_30d", 0)),
        rule_vintage_accumulation(card, market_data.get("price_change_90d", 0)),
        rule_secret_rare_oop(card, market_data.get("set_release_date")),
        rule_holiday_sell(card, market_data.get("current_month", datetime.utcnow().month)),
        rule_artist_undervalued(card, market_data.get("comparable_avg_price", 0)),
        rule_velocity_spike_buy(card, market_data.get("recent_velocity", 0),
                                market_data.get("baseline_velocity", 0.1),
                                market_data.get("price_change_7d", 0)),
        rule_social_spike_sell(card, market_data.get("price_change_7d", 0),
                               market_data.get("velocity_ratio", 0)),
        rule_eeveelution_premium(card, market_data.get("price_change_30d", 0)),
        rule_reprint_risk_exit(card, market_data.get("price_change_30d", 0)),
        rule_grading_flood_buy(card, market_data.get("price_change_14d", 0)),
        rule_january_clearance(card, market_data.get("current_month", datetime.utcnow().month),
                               market_data.get("price_change_30d", 0)),
        rule_illustration_rare_appreciation(card, market_data.get("price_change_90d", 0),
                                            market_data.get("set_release_date")),
        rule_multi_factor_premium(card),
        rule_liquidity_dryup(card, market_data.get("current_velocity", 0),
                              market_data.get("historical_velocity", 0.1)),
    ]

    signals = [r for r in rule_results if r is not None]

    if not signals:
        return {"action": "HOLD", "signals": [], "composite_strength": 0}

    # Aggregate: count buy vs sell signals, weight by strength
    buy_strength = sum(s["strength"] for s in signals
                       if s["action"] in ("BUY", "STRONG_BUY"))
    sell_strength = sum(s["strength"] for s in signals if s["action"] == "SELL")

    if buy_strength > sell_strength and buy_strength >= 2.0:
        action = "BUY"
    elif sell_strength > buy_strength and sell_strength >= 1.5:
        action = "SELL"
    else:
        action = "HOLD"

    return {
        "action": action,
        "signals": signals,
        "composite_strength": max(buy_strength, sell_strength),
        "buy_strength": buy_strength,
        "sell_strength": sell_strength,
    }
```

---

## 12. Summary: Demand Score Formula

For quick reference, the system computes a **demand score** for every card:

```
demand_score = popularity_multiplier
             * artist_premium
             * rarity_multiplier^0.5    (sqrt to avoid over-weighting)
             * set_premium^0.5          (sqrt to avoid over-weighting)
```

Example calculations:

| Card | Popularity | Artist | Rarity | Set | Demand Score |
|------|-----------|--------|--------|-----|-------------|
| Base Set Charizard (holo) | 5.5 | Arita (1.5) | Holo (1.0) | Base Set (5.0) | 5.5 * 1.5 * 1.0 * 2.24 = **18.5** |
| Umbreon VMAX Alt Art (Evolving Skies) | 2.75 | HYOGONOSUKE (2.5) | VMAX (2.24) | Evolving Skies (1.41) | 2.75 * 2.5 * 2.24 * 1.41 = **21.7** |
| Random Holo from modern set | 1.0 | Unknown (1.0) | Holo (1.0) | Default (1.0) | 1.0 * 1.0 * 1.0 * 1.0 = **1.0** |
| Gengar SIR by Furusawa | 2.25 | Furusawa (1.8) | SIR (3.46) | Modern (1.0) | 2.25 * 1.8 * 3.46 * 1.0 = **14.0** |
| Rayquaza Gold Star (ex era) | 2.5 | varies (1.0) | Secret (2.74) | ex era (1.41) | 2.5 * 1.0 * 2.74 * 1.41 = **9.7** |

**Thresholds:**
- demand_score > 15: "Blue chip" — safest long-term holds
- demand_score 8-15: "Strong hold" — quality cards with structural demand
- demand_score 3-8: "Trade on signal" — decent cards, use technical analysis
- demand_score < 3: "Commodity" — only trade on velocity/momentum
