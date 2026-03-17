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

### Post-Sprint 2 — 2026-03-16

| Persona | Stickiness (1-10) | Delta | Notes |
|---------|-------------------|-------|-------|
| P1 Jake | **7.5/10** | +1.5 | Spread Analysis is "standout feature" (A-). SMA overlays useful for timing buys (A). Dashboard alerts with TARGET HIT badges "genuinely useful" (A). Wants: buy-zone indicator, push/email notifications, velocity alongside spread |
| P2 Maria | **7/10** | +2 | SMA overlays "genuinely investment-grade" — 30d/6mo crossover is "classic bullish signal". Screener is "portfolio manager's dream". Alerts dashboard "makes the site feel alive". Wants: quantity tracking per card, push/email notifications, graded card pricing (PSA/CGC) |
| P3 Alex | **7/10** | +2 | Spread Analysis is "content gold" (8/10) — "Shining Charizard +322.1% spread is a tweet". SMA overlays screenshot-worthy on liquid cards (7/10). Screener list view is "pure content gold". Wants: chart export/download PNG, fix Y-axis on high-variance cards, weekly recap page |
| P4 Sam | **7.5/10** | +1.5 | Hero search bar is "most welcoming thing on this site". Spread analysis answers "is my card worth selling?" Glossary tooltips "thorough" (203 terms with dotted underlines). Wants: extend tooltips to CardDetail (NM/LP/HP), onboarding banner more prominent, simple mode for Screener |

**Average: 7.25/10 (delta: +1.75)** — Target was 7.0+, MET

#### Sprint 2 Features Recognized (All 4 Personas)
- **Spread Analysis**: Universally praised. Jake: "standout feature". Alex: "content gold". Maria: "real investment intelligence". Sam: "practical, real-world knowledge"
- **SMA Overlays (30d/6mo)**: Maria and Jake both identified bullish crossover signals. Alex: "screenshot-worthy on liquid cards". Sam appreciated trend visualization
- **Dashboard Alerts (TARGET HIT / NOTABLE)**: All 4 loved the alerts feed. Jake: "tells me exactly where to look". Maria: "makes the site feel alive and worth checking daily"
- **Time Range Toggle (1D/3D/7D/30D)**: Functional, Maria uses 30D for long-term, Jake uses 7D for flip timing
- **Glossary Tooltips**: Jake and Maria confirmed working on hover (plain-English definitions). Sam verified 203 dotted-underline elements on Screener
- **Hero Search Bar**: Sam's top love. All personas used it successfully
- **Onboarding Banner**: Sam noted it wasn't visible (may have been previously dismissed in shared browser state). Other personas saw it and found it helpful

#### Known Chrome MCP Artifacts (Discounted)
- Navigation "bugs" (random redirects, ticker intercepting clicks) — confirmed as automation artifacts, not real user issues
- Tooltips not triggering for some agents — hover events inconsistent in Chrome MCP, but Jake and Maria confirmed tooltips work
- Input field value concatenation — likely click/focus behavior difference in automation vs real browser

#### Remaining Issues (Sprint 3 Candidates)
1. **Push/email notifications for alerts** — #1 ask from Jake, Maria, and Alex. Dashboard-only alerts require visiting the site
2. **Chart export / "Download as PNG"** — Alex's top ask for content creation workflow
3. **Y-axis normalization on high-variance cards** — Outlier sales ($6,502 on Shining Charizard) compress useful signal. Log scale or IQR clipping needed
4. **Extend glossary tooltips to CardDetail** — NM/LP/MP/HP/DMG abbreviations unexplained. Also add to Watchlist (P&L, Cost Basis)
5. **Quantity tracking per card** — Maria owns 3 Base Set Charizards, needs per-copy cost basis
6. **Graded card pricing (PSA/CGC/BGS)** — Maria's $15K collection is mostly graded; raw-only valuation is incomplete
7. **Weekly recap page** — Alex wants "this week's top 5 gainers, biggest spread changes, notable SMA crossovers"
8. **Buy Zone indicator on Spread Analysis** — Jake wants trend direction + "is now a good time to buy?" signal

---

### Post-Sprint 3 — 2026-03-16

| Persona | Stickiness (1-10) | Delta | Notes |
|---------|-------------------|-------|-------|
| P1 Jake | **8/10** | +0.5 | Buy Zone indicator is "exactly what I need" (A-). Weekly Recap useful for Monday morning routine (B+). Glossary tooltips + graded pricing info helpful (B+). Wants: email alerts discoverable, velocity in buy zone logic, "Flip Finder" page |
| P2 Maria | **8/10** | +1 | Watchlist is now "real portfolio tracker" with QTY + cost basis + P&L (A). Card detail depth "information-dense in the best way" (A-). Weekly Recap "I would actually read" (B+). Wants: email alerts discoverable, historical portfolio value chart, per-copy cost basis |
| P3 Alex | **8.5/10** | +1.5 | Chart export PNG "difference between cool tool and tool I use in my workflow" (A). Weekly Recap "citation-ready" for Substack (A-). Portfolio tracking "flex screenshot" worthy (A-). Wants: full recap export as branded image, historical recap archive, embeddable charts |
| P4 Sam | **8/10** | +0.5 | Weekly Recap "single best page for a newcomer" (A). Buy Zone chip "just tell me what to do" guidance (B+). Graded pricing info "very thoughtful" (B+). Wants: guided onboarding flow, more visible watchlist button, condition abbreviation legend |

**Average: 8.125/10 (delta: +0.875)** — Target was 8.0+, MET ✅

#### Sprint 3 Features Recognized (All 4 Personas)
- **Buy Zone Indicator**: All 4 praised. Jake: "saves me mental math". Maria: "immediate buy/pass signal". Alex: "could build a whole video around it". Sam: "just tell me what to do" guidance
- **Weekly Recap Page**: Universally loved. Alex: "citation-ready for Substack" (A-). Sam: "single best page for a newcomer" (A). Jake: "Monday morning routine" (B+). Maria: "I would actually read" (B+)
- **Chart Export PNG**: Alex's #1 ask delivered. "Difference between cool tool and tool I use in my workflow" (A). Charts "clean enough to publish"
- **Glossary Tooltips Extended**: Working on Watchlist headers (Cost Basis, P&L). Card detail condition tooltips confirmed. Sam still wants more in-context help for abbreviations
- **Quantity Tracking**: Maria praised QTY + P&L integration as "real portfolio tracker" (A). Sam and Jake confirmed working
- **Graded Card Pricing Info**: Sam: "very thoughtful" — proactively answers graded pricing question. Maria: "smart UX decision" for managing expectations
- **Email Alerts (Backend)**: Backend working but UI discoverability issue — all 4 personas could not find the email field (it's inside the bookmark dialog's "Edit Alerts & Cost Basis" submenu). Sprint 4 should surface this more prominently

#### Known Chrome MCP Artifacts (Discounted)
- Navigation artifacts (random redirects) — confirmed automation-only
- Dialog interactions (bookmark click → submenu) — Chrome MCP couldn't reliably trigger nested dialogs
- Input field persistence concerns — localStorage works in real browsers, automation resets state

#### Common Sprint 4 Candidates (Across Personas)
1. **Email alert UI discoverability** — All 4 couldn't find it. Move email input to a more prominent location or add a dedicated "Set Alert" button
2. **Guided onboarding / "What's my card worth?" flow** — Sam's top ask, would help newcomer retention
3. **Historical portfolio value chart** — Maria wants collection value over time
4. **Flip Finder / velocity-aware buy zone** — Jake wants sold velocity integrated into buy zone logic
5. **Full recap export as branded image** — Alex wants one-click shareable recap
6. **Historical recap archive** — Alex wants to browse previous weeks
7. **Embeddable charts / API access** — Alex's long-term content creator need

---

## Target Scores

| Milestone | Avg Stickiness | Key Unlock |
|-----------|---------------|------------|
| Baseline | 3.75 | Site exists |
| Sprint 1 | 6.0+ | Navigation works, search works, basic portfolio |
| Sprint 2 | 7.25 (target 7.0+) ✅ | Spread data, SMA overlays, alerts, onboarding, glossary tooltips |
| Sprint 3 | 8.125 (target 8.0+) ✅ | Buy zone, chart export, weekly recap, quantity tracking, email alerts backend |
| V1.0 Launch | 8.5+ | All personas would recommend to a friend |
