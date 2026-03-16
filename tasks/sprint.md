# PKMN Trader — Sprint Plan

> Persona scores tracked in [scoring.md](scoring.md)
> Project instructions in [../CLAUDE.md](../CLAUDE.md)

---

## Sprint 1: "Make It Usable" (Target: 3.75 → 6.0+)

**Goal:** Fix the dealbreakers that ALL 4 personas reported. No one can use the site if navigation is broken and search doesn't work.

### 1.1 Fix Scroll-Snap Navigation Bug [CRITICAL]
- **Impact:** All 4 personas (100%) reported this as the #1 issue
- **Problem:** Scrolling on any page randomly navigates to a different page. Mouse wheel, Page Down, End key, and even `window.scrollTo` all trigger unwanted page transitions
- **Root cause:** Likely CSS scroll-snap or SPA router conflict with scroll events
- **Files:** `frontend/src/App.tsx`, page components, CSS
- **Done when:** All 4 personas can scroll every page without unintended navigation

### 1.2 Fix Missing Card Images
- **Impact:** Jake, Alex flagged — makes site look abandoned
- **Problem:** Multiple cards in Explorer grid show blank rectangles
- **Files:** Card image URLs in DB, image loading in card components
- **Done when:** Zero blank cards visible in Explorer grid

### 1.3 Add Working Search + Set/Rarity Filters to Explorer
- **Impact:** All 4 personas want this (Maria: "library without a catalog", Sam: "show me all Base Set")
- **Problem:** Search exists but filters are limited. No set dropdown, no rarity filter, no era grouping
- **Files:** `frontend/src/pages/CardExplorer.tsx`, `server/routes/cards.py`
- **Done when:** Can search by name, filter by set, filter by rarity, filter by price range

### 1.4 Fix LP > NM Price Anomaly Display
- **Impact:** Sam was confused, Maria flagged as misleading
- **Problem:** LP $522 avg from 3 sales vs NM $200 from 277 sales — small samples create misleading averages
- **Fix:** Show median instead of mean for condition pricing, or flag low sample sizes more prominently
- **Files:** Card detail pricing component, backend condition pricing calc
- **Done when:** Condition pricing uses median or clearly warns on small sample sizes

### 1.5 Basic Portfolio Tracking on Watchlist
- **Impact:** Maria (primary), Sam, Jake all want this
- **Problem:** Watchlist is just bookmarks — no cost basis, no P&L, no total value
- **Note:** Watchlist already has cost basis fields in code (from earlier work) — verify it works
- **Files:** `frontend/src/pages/Watchlist.tsx`
- **Done when:** Can add cards with purchase price, see per-card P&L, see total portfolio value

**Sprint 1 Verification:** Re-run all 4 personas via Chrome MCP. Target: avg 6.0+

---

## Sprint 2: "Make It Sticky" (Target: 6.0 → 7.5+)

**Goal:** Add the features that turn one-time visitors into weekly users.

### 2.1 Price Target Alerts
- **Impact:** Jake (primary), Maria, Alex
- **Problem:** No way to get notified when a card hits a price threshold
- **Spec:** Set "alert me below $X" or "alert me above $Y" on any card. Show triggered alerts on Dashboard
- **Files:** New model, watchlist integration, background check in sync loop

### 2.2 Buy/Sell Spread Data
- **Impact:** Jake (dealbreaker), Alex
- **Problem:** No spread between listing price and sold price — fundamental for flippers
- **Spec:** Show lowest current listing vs recent median sold. Fee-adjusted profit per flip
- **Files:** May need TCGPlayer listing price scraping or API

### 2.3 Beginner Onboarding Flow
- **Impact:** Sam (primary), benefits all newcomers
- **Problem:** Site drops you into Bloomberg Terminal with zero explanation
- **Spec:** "New here?" banner on first visit → "Find your cards" → Explorer search → Card detail → Watchlist flow
- **Files:** New onboarding component, localStorage flag for first visit

### 2.4 Jargon Tooltips / Glossary
- **Impact:** Sam (primary), casual users
- **Problem:** Liquidity, regime, accumulating, breakeven — none explained
- **Spec:** Hover tooltips on all financial terms. Optional glossary page
- **Files:** Shared tooltip component, all pages with jargon

### 2.5 Time Range Toggle on Top Movers
- **Impact:** Jake, Maria
- **Problem:** Only 7d view, want 1d/3d/7d/30d
- **Files:** `frontend/src/components/TopMovers.tsx`, backend movers endpoint

**Sprint 2 Verification:** Re-run all 4 personas. Target: avg 7.5+

---

## Sprint 3: "Make It Essential" (Target: 7.5 → 8.5+)

**Goal:** Features that make each persona say "I can't live without this."

### 3.1 Weekly Digest / Email Summary
- **Impact:** Maria (primary), Alex
- **Spec:** Weekly email with portfolio performance, top movers, new Investment Grade cards, AI analysis summary

### 3.2 Chart Export / Embeddable Charts
- **Impact:** Alex (primary), content creators
- **Spec:** "Share" button on any chart → generates PNG or embed link

### 3.3 Collection Mode / Bulk Import
- **Impact:** Maria, Sam
- **Spec:** "I have these sets" → auto-populate watchlist. CSV import option

### 3.4 Flip Finder View
- **Impact:** Jake (primary)
- **Spec:** Combined view: spread > 20% after fees + velocity > 2/week + uptrend/accumulating

### 3.5 "Trending This Week" Summary Page
- **Impact:** Alex (primary), all personas
- **Spec:** Auto-generated weekly summary: biggest movers, new $10+ cards, AI highlights, article intelligence

### 3.6 Historical Snapshots / Compare
- **Impact:** Alex, Maria
- **Spec:** Compare market state this week vs last week vs last month. Time-travel for screener results

**Sprint 3 Verification:** Re-run all 4 personas. Target: avg 8.5+

---

## Backlog (Future Sprints)

- Mobile app / PWA
- Push notifications (mobile + browser)
- Social features (share watchlists, follow other collectors)
- Graded card tracking (PSA 8/9/10 pricing)
- eBay sold listing integration
- Multi-platform price comparison (TCGPlayer vs eBay vs CardMarket)
- Collection value insurance estimates
- Tax reporting for card sales
