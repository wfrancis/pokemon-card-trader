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
