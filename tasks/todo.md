# TCGPlayer Article Intelligence for AI Trader

## Problem
The AI trader agent only sees our internal price data. TCGPlayer publishes weekly price spike articles with expert analysis on which cards are moving and why — catalysts, set dynamics, meta shifts. This is exactly the context our agent needs to make better predictions.

## Plan

### 1. Article Scraper Service (`server/services/article_scraper.py`)
- Fetch `https://www.tcgplayer.com/content/pokemon/articles` listing page
- Filter for finance-relevant articles (price spikes, most expensive, buyer's guides)
- Fetch each article's full text via httpx
- Parse article content (strip HTML, extract card mentions + prices)
- Return structured list: `[{title, date, url, content_summary}]`
- Cache results (don't re-fetch same articles)

### 2. Add Article Context to Agent Data Gathering
- In `_gather_market_data()` (trader_agent.py), call article scraper
- Add "MARKET INTELLIGENCE — TCGPlayer Articles" section to persona prompts
- Include last 3-4 finance articles (price spikes, expensive cards lists)
- Each persona can interpret articles through their own lens

### 3. Add Agent Tool: `get_market_articles`
- New tool in `agent_tools.py` for the tool-using agent
- Returns recent article summaries so agent can investigate specific mentions
- Agent can cross-reference article mentions with our price data

### 4. Deploy & Verify
- Deploy to Fly.io
- Trigger agent analysis to verify articles get pulled in
- Check that article context appears in agent prompts

## Key Design Decisions
- Scrape at analysis time (not stored in DB) — articles are external, read-only context
- Focus on Corbin Hosler's weekly price spike articles — most directly actionable
- Include buyer's guides and "most expensive" articles too — set-level intelligence
- Skip deck guides and competitive articles — not price-relevant
- Truncate article text to keep within token limits (~2000 chars per article)
