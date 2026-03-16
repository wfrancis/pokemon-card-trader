# PKMN Trader — Persona Scoring & Tracking

## Evaluation Framework

After each sprint, re-run the 4 personas through the site via Chrome MCP. Track scores over time to measure real improvement.

---

## Personas

| ID | Name | Age | Type | Use Case |
|----|------|-----|------|----------|
| P1 | Jake | 28 | Active Card Flipper | Flips 10-20 cards/mo, $500-1500/mo profit. Needs spreads, velocity, actionable signals |
| P2 | Maria | 35 | Collector/Investor | $15K+ collection, buy-and-hold. Needs portfolio tracking, long-term trends, condition-aware pricing |
| P3 | Alex | 31 | Content Creator | 50K YouTube subs, Substack. Needs charts, stories, data to create content. Bloomberg-level polish |
| P4 | Sam | 22 | Casual Newcomer | Found old cards in attic. Zero experience. Needs "are my cards worth anything?" answered simply |

---

## Scoring History

### Baseline — 2026-03-16 (Pre-Sprint 1)

| Persona | Stickiness (1-10) | Top Love | Top Dealbreaker | Would Pay? |
|---------|-------------------|----------|-----------------|------------|
| P1 Jake (Flipper) | **4/10** | Investment Screener | No buy/sell spread data | Not yet |
| P2 Maria (Investor) | **4/10** | Investment Screener | No portfolio tracking | Not yet |
| P3 Alex (Creator) | **~3/10** | Screener data + charts | Couldn't complete eval — routing bug | Not yet |
| P4 Sam (Newcomer) | **4/10** | Explorer search | Jargon wall, no onboarding | No |

**Average: 3.75/10**

#### Critical Bugs (All 4 reported)
- Scroll-snap navigation randomly teleports between pages
- Missing card images in Explorer grid
- LP > NM price anomaly (small sample outlier, Charizard $522 LP vs $200 NM)

#### Per-Persona Detailed Feedback

**P1 Jake (Flipper):**
- Loves: Screener (novel liquidity+appreciation scoring), sales scatter plot, Bloomberg aesthetic
- Hates: No spread data (fundamental for flipping), broken nav, no price alerts
- Wants: Spread tracker with fee calculator, price target alerts, "Flip Finder" combining screener+spreads+velocity

**P2 Maria (Investor):**
- Loves: Screener (weekly check-in page), condition-coded sales data, AI Trading Desk analysis
- Hates: No portfolio tracking, broken nav, no search/filters on Explorer
- Wants: Portfolio tracker with cost basis + P&L, set/rarity filters, weekly digest email

**P3 Alex (Creator):**
- Loves: Screener data, card detail charts (TradingView quality), AI personas as content format
- Hates: Routing bug (couldn't finish testing), can't export/share charts, stale analysis
- Wants: Embeddable charts, "trending this week" summary, historical snapshots for comparison

**P4 Sam (Newcomer):**
- Loves: Explorer search (typed Charizard, got 83 results with prices), card detail sales data + TCGPlayer link, AI Trader (fascinating even if confusing)
- Hates: Jargon wall (no tooltips/glossary), no onboarding, broken navigation
- Wants: Set/era filters, "collection mode" bulk-add, beginner guide

---

### Post-Sprint 1 — [DATE TBD]

| Persona | Stickiness (1-10) | Delta | Notes |
|---------|-------------------|-------|-------|
| P1 Jake | | | |
| P2 Maria | | | |
| P3 Alex | | | |
| P4 Sam | | | |

**Average: /10 (delta: )**

---

### Post-Sprint 2 — [DATE TBD]

| Persona | Stickiness (1-10) | Delta | Notes |
|---------|-------------------|-------|-------|
| P1 Jake | | | |
| P2 Maria | | | |
| P3 Alex | | | |
| P4 Sam | | | |

**Average: /10 (delta: )**

---

## Target Scores

| Milestone | Avg Stickiness | Key Unlock |
|-----------|---------------|------------|
| Baseline | 3.75 | Site exists |
| Sprint 1 | 6.0+ | Navigation works, search works, basic portfolio |
| Sprint 2 | 7.0+ | Spread data, alerts, onboarding |
| Sprint 3 | 8.0+ | Weekly digest, chart export, collection mode |
| V1.0 Launch | 8.5+ | All personas would recommend to a friend |
