# Pokemon Card Market Tracker

## Goal
Wall Street-style trading terminal for Pokemon cards. Track card prices, compute technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands), and predict which cards will increase in value. Bloomberg Terminal meets Pokemon.

## Architecture
- **Backend:** FastAPI + SQLAlchemy + SQLite (single service)
- **Frontend:** React 18 + TypeScript + MUI dark theme + Recharts
- **Data Source:** Pokemon TCG API (pokemontcg.io) — provides both card data and TCGPlayer prices
- **Deployment:** Fly.io (single service — FastAPI serves API + static React build)

## Testing & Deployment Constraints
- **All changes must be deployed to Fly.io and tested using Chrome MCP** — do not rely on localhost testing
- Unit tests and curl commands can be used for quick checks, but a fix is only considered complete after verifying on the live Fly deployment via Chrome MCP browser tools
- Deploy with `fly deploy` from the project root (flyctl at `~/.fly/bin/flyctl`)
- Live URL: https://pokemon-card-trader.fly.dev/
- SQLite database persists via Fly.io volume mount at `/data/`
- Single service: frontend build is served by FastAPI as static files

## Data
- Prices come from `tcgplayer.prices` field in Pokemon TCG API card responses
- We track `market` price for each card's primary variant (normal, holofoil, or reverseHolofoil)
- No graded/condition tracking — ungraded market price only
- Price history built by periodic syncs (every 6-12 hours)

## Key Commands
```bash
# Deploy to Fly
fly deploy

# Trigger card sync (run after deploy)
curl -X POST https://<app-name>.fly.dev/api/sync/cards?pages=3

# Trigger price update
curl -X POST https://<app-name>.fly.dev/api/sync/prices
```

## Project Structure
```
server/          # FastAPI backend
  app.py         # Main app, routes, CORS
  database.py    # SQLAlchemy + SQLite
  models/        # Card, PriceHistory
  routes/        # cards, prices, analysis
  services/      # card_sync, price_collector, market_analysis
frontend/        # React app
  src/
    pages/       # Dashboard, CardExplorer, CardDetail
    components/  # PriceChart, TopMovers, MarketTicker, etc.
```

## Design Language
- Black background, green for gains, red for losses
- Monospace font for prices/numbers
- Dense data tables, sparklines, scrolling tickers
- Bloomberg Terminal / TradingView aesthetic

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately – don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes – don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests – then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Git Commits
- **NEVER add `Co-Authored-By: Claude` or any Claude attribution line to commits**
- All commits are authored by William Francis <wbfranci@gmail.com> only

## Persona-Driven Development

All feature work is prioritized by 4 user personas who evaluate the live site via Chrome MCP after each sprint. Track scores in `tasks/scoring.md`, sprint plan in `tasks/sprint.md`.

| Persona | Type | What They Care About |
|---------|------|---------------------|
| Jake (P1) | Card Flipper | Spreads, velocity, fee-adjusted profit, actionable signals |
| Maria (P2) | Collector/Investor | Portfolio tracking, long-term trends, condition pricing |
| Alex (P3) | Content Creator | Charts, data stories, exportable visuals, fresh analysis |
| Sam (P4) | Casual Newcomer | "Are my cards worth anything?", simple UX, no jargon |

**Score progression:** 3.75 → 5.5 → 7.25 → 8.125 (current, post-Sprint 3)

### Current Sprint: Sprint 4 — Target 9.0-9.5

**Goal:** Push all 4 personas to 9.0+ individual scores (avg 9.0-9.5). This is the "daily driver / would pay" threshold.

---

#### Phase 1: Quick Wins (Small complexity — implement first, parallel agents)

| # | Feature | Persona | What to Build |
|---|---------|---------|---------------|
| 2 | First-Visit Onboarding | Sam +0.4 | Dismissible banner on Dashboard: "Found old Pokemon cards? Search any card to see what it's worth!" with quick-link examples (e.g. "Try: Charizard"). localStorage `pkmn_first_visit_dismissed` flag. Auto-dismiss after first card view. |
| 7 | Labeled Watchlist Button | Sam +0.2 | Replace tiny bookmark icon on CardDetail with a visible MUI Button: "Save to Watchlist" / "Saved ✓" (filled). Add one-line explainer on Watchlist page header: "Cards you're tracking. Add cost basis to see your profit." |
| 9 | Screener Glossary Tooltips | Sam +0.2 | Add `<GlossaryTooltip>` wrappers to Screener column headers: Invest Score, Liquidity, Appreciation, Regime. Also wrap regime tag chips (ACCUMULATING, DISTRIBUTING, UPTREND, DOWNTREND) with tooltips. Add terms to `glossary.ts` if missing. |

#### Phase 2: Medium Features (implement with parallel agents)

| # | Feature | Persona | What to Build |
|---|---------|---------|---------------|
| 1 | Dedicated Alerts Page | Jake, Maria, Alex | **Backend:** `GET /api/alerts/history` — return triggered alert log. **Frontend:** New `/alerts` page + nav item. Table of active alerts (card, thresholds, email, created date). History tab showing fired alerts. Global email config input at top (saves to localStorage, syncs to all alerts). **CardDetail:** Add prominent "Set Price Alert" button below spread analysis that opens alert dialog directly (not buried in bookmark menu). |
| 3 | Plain-English Card Summary | Sam +0.3 | **Frontend:** New `<CardSummary>` component on CardDetail, placed below card image/name, above charts. Template: "This card is worth ~${nmPrice} in Near Mint condition. {salesCount > 0 ? `It sold ${salesCount} times in the last 30 days.` : `No recent sales recorded.`} {trend}." Replace any "run /api/sync" developer messages with "Sale data not yet available for this card." |
| 5 | Velocity in Buy Zone | Jake +0.3 | **Backend:** Add `sales_per_day` to spread analysis response (sales_30d / 30). **Frontend:** Show "X.X sales/day" badge near spread analysis. Update Buy Zone logic: `TIGHT SPREAD` + velocity < 0.5/day → "LOW LIQUIDITY" (gray). Add velocity to Screener as sortable column + "Min Velocity" slider filter. |
| 6 | Recap Export PNG | Alex +0.2 | Add "Export as Image" button to WeeklyRecap page header. Use html2canvas at 2x resolution with black bg. Add "PKMN TRADER • pokemon-card-trader.fly.dev" watermark text at bottom of captured area. Download as `pkmn_recap_{date}.png`. |
| 10 | Similar Cards | Jake, Maria, Sam | **Backend:** `GET /api/cards/{id}/similar` — return up to 6 cards: first 3 = same Pokemon name (different sets), next 3 = same set (different Pokemon), sorted by price. **Frontend:** Horizontal scrollable row at bottom of CardDetail with card thumbnails, name, set, price, 7d change. Click navigates to that card. |

#### Phase 3: Complex Feature

| # | Feature | Persona | What to Build |
|---|---------|---------|---------------|
| 4 | Portfolio Value Chart | Maria +0.4 | **Frontend-only approach:** On Watchlist page, compute portfolio value from watchlist cards × quantities using price history data. Fetch price history for all watchlist card IDs via `GET /api/cards/{id}/prices`. Plot Recharts LineChart showing total value over last 30 days. Secondary dashed line for total cost basis (flat). Show "Portfolio up/down X% this month" summary stat. |
| 8 | Watchlist Sparklines | Jake +0.2 | Fetch 14-day price history for each watchlist card. Render Recharts `<Sparkline>` (tiny 80x30px line chart) in a new column. Add "7d %" column showing 7-day price change with green/red coloring. |

---

#### Expected Score Impact

| Persona | Current | Sprint 4 Items | Expected |
|---------|---------|----------------|----------|
| P1 Jake | 8.0 | #1 Alerts, #5 Velocity, #8 Sparklines, #10 Similar | 9.0-9.2 |
| P2 Maria | 8.0 | #1 Alerts, #4 Portfolio Chart, #10 Similar | 9.0-9.2 |
| P3 Alex | 8.5 | #1 Alerts, #6 Recap Export | 9.0-9.2 |
| P4 Sam | 8.0 | #1 Alerts, #2 Onboarding, #3 Summary, #7 Button, #9 Tooltips, #10 Similar | 9.2-9.5 |

#### Execution Plan

Each phase follows a full cycle: implement → build check → deploy → QA → fix → deploy → persona eval → record scores.

```
=== PHASE 1: Quick Wins (#2, #7, #9) ===
1a. IMPLEMENT  → 3 parallel agents (items #2, #7, #9)
1b. BUILD      → TypeScript check, fix compile errors
1c. DEPLOY     → fly deploy
1d. QA/TEST    → Chrome MCP agent tests Phase 1 features on live site
1e. FIX        → Developer agents fix all QA bugs
1f. DEPLOY     → fly deploy (if fixes needed)
1g. PERSONA    → Deploy all 4 persona agents to score via Chrome MCP
1h. SCORE      → Record Phase 1 scores in tasks/scoring.md

=== PHASE 2: Medium Features (#1, #3, #5, #6, #10) ===
2a. IMPLEMENT  → 5 parallel agents (items #1, #3, #5, #6, #10)
2b. BUILD      → TypeScript check, fix compile errors
2c. DEPLOY     → fly deploy
2d. QA/TEST    → Chrome MCP agent tests Phase 2 features on live site
2e. FIX        → Developer agents fix all QA bugs
2f. DEPLOY     → fly deploy (if fixes needed)
2g. PERSONA    → Deploy all 4 persona agents to score via Chrome MCP
2h. SCORE      → Record Phase 2 scores in tasks/scoring.md

=== PHASE 3: Complex Features (#4, #8) ===
3a. IMPLEMENT  → 2 parallel agents (items #4, #8)
3b. BUILD      → TypeScript check, fix compile errors
3c. DEPLOY     → fly deploy
3d. QA/TEST    → Chrome MCP agent tests Phase 3 features on live site
3e. FIX        → Developer agents fix all QA bugs
3f. DEPLOY     → fly deploy (if fixes needed)
3g. PERSONA    → Deploy all 4 persona agents to final score via Chrome MCP
3h. SCORE      → Record final Sprint 4 scores in tasks/scoring.md
3i. EVALUATE   → If any persona < 9.0, extract gaps, loop back
```

**Rules:**
- Every persona score after every phase gets recorded (not just final)
- QA bugs must hit zero before persona eval
- Persona eval always on live Fly.io via Chrome MCP, never localhost
- If Phase 1 personas flag regressions, fix before starting Phase 2

---

#### Deferred to Sprint 5

- Flip P&L Tracker / Trade Journal (Jake) — medium
- Multi-Lot Tracking per card (Maria) — medium
- Social Card OG Image Previews (Alex) — medium
- Simple/Pro Dashboard Toggle (Sam) — medium
- Historical Recap Archive (Alex) — medium
- Set-Level Analytics (Maria) — medium
- Embeddable Chart Widgets (Alex) — large
- Card Comparison View (Alex) — large
- Mobile-Responsive Layout (Sam) — large

**SMTP Configuration:** Already deployed via `fly secrets set`. Email alerts use Gmail SMTP (wbfranci@gmail.com).

### Sprint Execution Loop

Every sprint follows this loop until all personas are satisfied:

```
1. IMPLEMENT → Deploy AI software expert agents to implement sprint tasks
2. QA/TEST   → Deploy AI QA/tester agents to find bugs on the live site
3. FIX       → Loop between software experts and QA until zero bugs remain
4. DEPLOY    → Deploy to Fly.io
5. PERSONA   → Deploy all 4 persona agents to retest via Chrome MCP
6. EVALUATE  → If personas flag unresolved concerns for THIS sprint:
               → Extract new requirements
               → Go back to step 1
7. SCORE     → Record final persona scores in tasks/scoring.md
8. NEXT      → Move to next sprint only after all personas are satisfied
```

**Constraints:**
- All persona tests MUST be done on the live Fly.io deployment using Chrome MCP browser tools — never localhost
- All QA tests MUST be done on the live Fly.io deployment using Chrome MCP browser tools — never localhost
- Never skip the persona verification step
- Never start the next sprint until current sprint personas are satisfied
- Record every persona re-test score, not just the final one

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
