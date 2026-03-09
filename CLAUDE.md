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

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
