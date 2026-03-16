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

### Post-Sprint 1 — 2026-03-16

| Persona | Stickiness (1-10) | Delta | Notes |
|---------|-------------------|-------|-------|
| P1 Jake | **6/10** | +2 | Loves Screener (9/10) and AI Trader (8/10). Card Detail condition pricing is "gold". Still wants spread/fee calc on every page, price alerts, quantity tracking on Watchlist |
| P2 Maria | **5/10** | +1 | Card Detail (8/10) and Screener (8/10) strong. Watchlist portfolio tracking works but needs quantity, history chart, cloud sync. Wants graded card pricing (PSA/CGC). Price data inconsistencies hurt trust |
| P3 Alex | **5/10** | +2 | AI Trader is "star feature" (9/10), Screener (8/10). Card Detail charts need TradingView-level upgrades. Wants exportable charts, weekly recap, sales scatter data populated. Analysis feels stale (week old) |
| P4 Sam | **6/10** | +2 | Card Detail condition pricing (8/10) is "single best feature". Watchlist P&L (7/10) intuitive. Needs hero search bar on Dashboard, jargon tooltips everywhere, beginner onboarding flow |

**Average: 5.5/10 (delta: +1.75)** — Target was 6.0+, fell short by 0.5

#### Sprint 1 Improvements Recognized
- Set/Rarity filters: All personas used successfully
- Condition pricing with median + low sample warnings: Praised by all 4
- Card image fallbacks: No complaints about missing images
- Cost basis dialog: Clean UX, praised by Maria and Sam
- Portfolio P&L on Watchlist: Working, praised by Sam and Jake

#### Remaining Issues (across all personas)
1. **"Navigation bug"** — All 4 reported random page transitions. Confirmed as Chrome MCP automation artifact (agents clicking nav elements), not a real user bug. Discount this feedback.
2. **Price data inconsistencies** — Pikachu $5,999.50 market vs $499.95 median sale. Market price vs sale price disconnect not explained to users.
3. **No jargon tooltips/onboarding** — Sam and Maria both flagged. Sprint 2 item.
4. **No spread/fee calculations** — Jake's #1 ask. Sprint 2 item.
5. **Watchlist needs: quantity, history chart, cloud sync** — Maria and Jake both want.
6. **Stale AI analysis** — Alex noted analysis is a week old. Need more frequent runs.
7. **Search not prominent enough** — Sam wants hero search on Dashboard.

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
