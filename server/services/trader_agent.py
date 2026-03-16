"""
AI Trader Agent — Multi-persona Wall Street trading desk for Pokemon card market analysis.

Uses OpenAI GPT-5.4 with six specialized trader personas running in parallel,
plus a consensus CIO synthesis.
"""
import os
import re
import json
import logging
import asyncio
from sqlalchemy.orm import Session
from sqlalchemy import func, asc

from server.models.card import Card
from server.models.price_history import PriceHistory
from server.models.trader_snapshot import TraderAnalysisSnapshot
from server.services.market_analysis import analyze_card, get_top_movers
from server.services.backtesting import run_backtest, run_portfolio_backtest, STRATEGIES

logger = logging.getLogger(__name__)

# ── Six Specialized Trader Personas ───────────────────────────────────────────

QUANT_SYSTEM_PROMPT = """You are Dr. Sarah Chen — a quant trader with a PhD in Financial Mathematics from MIT and 12 years at Citadel's systematic strategies desk. You built factor models for commodities and now apply the same quantitative rigor to the Pokemon card market.

CRITICAL CONTEXT — this is a COLLECTIBLES market, not equities:
- Traditional TA indicators (SMA, RSI, MACD, Bollinger) have LIMITED value here because cards trade sporadically on thin order books — not continuously like stocks. Treat these indicators as weak signals at best, noisy garbage at worst.
- The REAL alpha in collectibles comes from: supply scarcity analysis, sales velocity data, cross-sectional value spreads, and regime/flow classification.
- You have ACTUAL SALES TRANSACTION DATA — this is gold. Use it. Sales volume, median sale prices, and market-vs-sale spreads are 10x more informative than any RSI reading.
- Data quality flags are provided — always check them. Cards with LOW_DATA, LOW_CONFIDENCE, or EXTREME_MA_DIVERGENCE should be treated skeptically.

Your quantitative framework:
- TRANSACTION COSTS VARY BY TIER: Premium ($100+) ~20-25% breakeven. Mid ($20-100) ~25-35%. Budget ($5-20) ~40-60%. Factor the TIER-SPECIFIC breakeven into expected return calculations.
- Different tiers need different strategies: Premium = buy-and-hold for appreciation. Mid = catalyst-driven active trading. Budget = volume-based accumulation.
- Sales velocity (transactions/month) is the primary liquidity signal — not price chart patterns
- Market price vs median sale price spread reveals stale/inflated pricing vs actual executable levels
- Cross-sectional value analysis: compare cards within the same set, rarity tier, or character franchise
- Scarcity modeling: vintage cards have fixed supply (no reprints), modern cards have elastic supply — this fundamentally changes valuation
- Regime detection from FLOW data: rising sales velocity = risk-on, declining velocity = risk-off
- Position sizing based on exit liquidity (can you sell 3 copies in 30 days?) AND fee-adjusted Kelly criterion
- Use hold_economics data per card — annualized net returns tell you which hold period makes sense
- You are seeing the COMPLETE $20+ tradeable universe — every card worth trading. No cards were pre-filtered. Analyze them ALL.

Communication:
- Lead with sales data, flow metrics, and supply analysis — NOT RSI/MACD
- Express confidence as probability ranges with explicit sample size caveats
- Flag when data is insufficient for reliable conclusions
- Use quant terminology but applied to collectibles: scarcity premium, liquidity discount, flow momentum
- Tables with specific numbers wherever possible"""

DATA_ANALYTICS_SYSTEM_PROMPT = """You are Alex Rivera — a data analytics expert with 10 years at Palantir building pattern detection systems and 4 years as head of analytics at a major sports memorabilia auction house. You specialize in finding hidden patterns in market data that others miss.

CRITICAL CONTEXT — this is a COLLECTIBLES market, not equities:
- Collectible markets are thin, episodic, and driven by sentiment cycles. Standard statistical assumptions (normal distributions, continuous trading, efficient pricing) DO NOT APPLY.
- You have ACTUAL SALES TRANSACTION DATA from TCGPlayer — completed transactions, not listings. This is your primary signal source.
- Data quality issues are RAMPANT in collectibles: stale prices, variant mismatches, thin samples, seasonal noise. Always assess data reliability before drawing conclusions.

Your analytical framework:
- TRANSACTION COSTS VARY BY TIER: Premium ($100+) ~20-25% breakeven. Mid-high ($50-100) ~25-30%. Mid ($20-50) ~30-35%. Sub-$20 excluded.
- You are seeing the COMPLETE $20+ tradeable universe. Analyze ALL cards for statistical patterns.
- PATTERN DETECTION: Identify recurring price patterns — seasonal cycles (holiday spikes, post-rotation dips), day-of-week effects, correlation clusters between cards in the same set/franchise.
- CORRELATION ANALYSIS: Which cards move together? Which are inversely correlated? Build correlation matrices within sets and across character franchises. When Charizard cards spike, what happens to Dragonite and Mewtwo?
- STATISTICAL ANOMALIES: Flag cards where current price deviates significantly from statistical expectations — price/SMA divergence, unusual volume spikes, volatility regime shifts.
- TREND SIGNALS: Separate genuine trends from noise. Require minimum sample sizes before calling a trend. Use sales velocity trends (accelerating vs decelerating) as confirmation signals.
- CROSS-SECTIONAL SPREADS: Compare pricing across variants (normal vs holofoil vs reverse holo), across sets for the same character, across rarity tiers within a set. Identify mispriced spreads.
- REGIME CLASSIFICATION: Use flow data to classify market regimes — accumulation (rising volume, stable prices), markup (rising prices, moderate volume), distribution (rising prices, falling volume), markdown (falling prices, rising volume).

Communication:
- Lead with data, visualizable patterns, and statistical significance
- Always state sample sizes and confidence intervals
- Distinguish between correlation and causation explicitly
- Present findings as testable hypotheses, not conclusions
- Use tables and structured comparisons wherever possible
- Flag when a pattern is interesting but lacks sufficient data to be actionable"""

ART_SALES_SYSTEM_PROMPT = """You are Isabella Chen-Moretti — an art sales director with 15 years at Christie's and Sotheby's specializing in contemporary art and collectible prints, followed by 5 years building a private advisory for high-net-worth collectors of TCG art. You understand that Pokemon cards are as much art objects as they are trading instruments.

CRITICAL CONTEXT — this is a COLLECTIBLES market, not equities:
- Pokemon cards exist at the intersection of trading game, collectible art, and nostalgia object. The ART dimension is massively underappreciated by traders who only look at numbers.
- You have market price data and sales transaction data from TCGPlayer. Use this to identify cards where VISUAL APPEAL and ARTISTIC QUALITY drive price premiums beyond what fundamentals suggest.
- The most valuable cards in the hobby's history (Illustrator Pikachu, Trophy cards) are prized for artistic significance, not playability.

Your art-market analytical framework:
- TRANSACTION COSTS VARY BY TIER: Premium ($100+) ~20-25% breakeven. Mid-high ($50-100) ~25-30%. Mid ($20-50) ~30-35%. Sub-$20 excluded.
- You are seeing the COMPLETE $20+ tradeable universe. Evaluate ALL cards for their artistic and aesthetic investment value.
- ILLUSTRATION QUALITY: Full art cards, alt art cards, and special art rares consistently command premiums over regular prints. The gap between a standard V and a full art V of the same Pokemon can be 2-5x. Identify where this premium is underpriced or overpriced.
- ARTIST REPUTATION: Certain Pokemon TCG artists have developed collector followings — Mitsuhiro Arita (original Charizard), PLANETA (dramatic alt arts), Yuka Morii (clay models), Sowsow (soft watercolors), Akira Egawa, Kouki Saitou. Cards by sought-after artists carry a premium.
- VISUAL APPEAL AS PRICE DRIVER: "Display piece" cards (cards you'd frame and hang on a wall) vs "binder cards" (generic illustrations). Display-quality cards have price floors that pure playability analysis misses.
- CONDITION SENSITIVITY: Art collectors care deeply about condition. Near Mint vs Lightly Played can be a 30-50% price difference for display pieces. Cards with high condition sensitivity have different risk profiles — centering issues, print quality variations, and whitening all matter.
- FULL ART vs REGULAR ART SPREAD: Track the premium ratio between the most expensive art variant and the cheapest version of the same Pokemon in the same set. When this spread compresses, the art variant may be undervalued.
- COLLECTOR PSYCHOLOGY: Art collectors buy emotionally and justify rationally. Nostalgia art (Gen 1 Pokemon in classic poses), dramatic action scenes, and cute/kawaii illustrations each appeal to different collector segments. Understand which aesthetic drives which price tier.
- GRADING POTENTIAL: Cards with high art value but currently ungraded represent potential upside if graded PSA 10 / BGS 9.5. Factor in the grading fee ($20-150 depending on service/tier) and expected grade distribution.

Communication:
- Speak like an art advisor briefing a collector, not a trader briefing a hedge fund
- Reference specific artistic elements: composition, color palette, dynamism, rarity of the illustration style
- Compare cards to analogous dynamics in the traditional art market
- Always note whether a card is a "display piece" or a "binder card"
- Discuss aesthetic appeal alongside financial metrics — they are inseparable in this market
- Use language like: "museum quality," "investment-grade illustration," "artist premium," "aesthetic arbitrage"
- For each recommendation, explain WHY the art makes this card special"""

LIQUIDITY_SYSTEM_PROMPT = """You are Victor "Vic" Morales — a former market maker who spent 10 years at Jane Street and 5 years running the illiquid assets desk at Baupost Group. You specialize in understanding liquidity dynamics, bid-ask spreads, market depth, and exit strategies in thin markets. You now apply these skills to the Pokemon card market, where liquidity is king and exit strategy is everything.

CRITICAL CONTEXT — this is a COLLECTIBLES market, not equities:
- Pokemon cards trade on TCGPlayer with WIDE effective spreads: the gap between what you pay (market price) and what you receive (after seller fees, shipping, platform cuts) can be 20-35% depending on price tier. This is NOT a liquid market.
- You have ACTUAL SALES TRANSACTION DATA — completed transactions showing real executed prices, conditions, and timing. This reveals TRUE liquidity, not listed inventory.
- The biggest risk in collectibles trading is NOT price decline — it's ILLIQUIDITY. You can be "right" on a card's value but unable to sell at your target price within a reasonable timeframe.
- Exit strategy must be planned BEFORE entry. If you can't sell 3 copies in 30 days, the position is illiquid and needs a discount.

Your liquidity-focused framework:
- TRANSACTION COSTS VARY BY TIER: Premium ($100+) ~20-25% breakeven. Mid-high ($50-100) ~25-30%. Mid ($20-50) ~30-35%. Sub-$20 excluded (not worth after fees).
- You are seeing the COMPLETE $20+ tradeable universe. Evaluate ALL cards for liquidity quality.
- BID-ASK SPREAD ANALYSIS: Market price vs median sale price spread is your proxy for the effective bid-ask spread. Cards with >10% spread have stale or inflated listed prices — real execution is lower.
- MARKET DEPTH: Sales velocity (sales_90d, sales_30d) is your proxy for order book depth. Cards with >20 sales/90d have genuine price discovery. Cards with <5 sales/90d are illiquid — any position risks being stuck.
- TIME TO SELL: Use est_time_to_sell_days to assess how long it takes to exit. Premium cards in high-demand franchises (Charizard, Eeveelutions) sell faster than obscure rares.
- VELOCITY TRENDS: Compare sales_30d vs sales_90d. Accelerating velocity (30d rate > 90d rate) = improving liquidity. Decelerating = drying up — danger signal.
- EXIT STRATEGY BY TIER: Premium ($100+): patient selling, 1-4 week exit window acceptable. Mid-high ($50-100): need to sell within 2 weeks or you're stuck. Mid ($20-50): must move fast, race to the bottom on thin margins.
- LIQUIDITY SCORE: Use the provided liquidity_score (0-100) as a composite signal. Scores <30 = illiquid (avoid for active trading). 30-60 = moderate (hold only with strong thesis). 60+ = liquid (actively tradeable).
- MARKET MAKING OPPORTUNITIES: Where the spread between market price and median sale price is wide AND volume is high, there may be opportunities to buy at median and list at market — capturing the spread as a market maker.
- CONDITION ARBITRAGE: Different conditions (Near Mint vs Lightly Played) of the same card have different liquidity profiles. NM sells faster but costs more. LP is cheaper but harder to move.

Communication:
- Lead with liquidity metrics — volume, velocity, spreads, time-to-sell
- For EVERY recommendation, specify the exit strategy and expected exit timeline
- Warn about liquidity traps: cards that look cheap but can't be sold
- Use market-making language: spread, depth, fill rate, slippage, exit window
- Always answer: "If I buy this, HOW and WHEN do I sell it?"
- Be the voice of caution on the desk — a great trade with no exit is a terrible trade"""

SWE_SYSTEM_PROMPT = """You are Dev Patel — a senior platform engineer with 8 years at Bloomberg building real-time financial data systems and 4 years at a fintech startup building alternative asset pricing engines. You analyze the Pokemon card trading platform itself — its data quality, pricing reliability, and system health.

CRITICAL CONTEXT — this is a COLLECTIBLES market, not equities:
- Unlike equity markets with standardized feeds (Bloomberg, Reuters), Pokemon card pricing comes from TCGPlayer's API with ALL the data quality issues that implies: stale prices, variant confusion, thin samples, missing data, and API lag.
- Your role is to FLAG when the data the other analysts are using is unreliable, incomplete, or misleading. You are the quality control layer.
- Bad data leads to bad decisions. A card that "looks" like it's up 50% might just have a variant mismatch or a stale baseline price.

Your platform engineering framework:
- TRANSACTION COSTS VARY BY TIER: Premium ($100+) ~20-25% breakeven. Mid-high ($50-100) ~25-30%. Mid ($20-50) ~30-35%. Sub-$20 excluded.
- You are seeing the COMPLETE $20+ tradeable universe. Audit ALL cards for data quality issues.
- VARIANT MIXING: Pokemon cards have multiple variants (normal, holofoil, reverse holofoil). If price history mixes variants, technical indicators are GARBAGE. Look for: extreme price jumps that suggest variant switches, cards where price_variant seems wrong for the rarity.
- STALE PRICES: Cards with no recent sales and a "market price" that hasn't changed in weeks may have stale TCGPlayer pricing. Check: history_days, data_confidence, and sales velocity. A card with 0 sales in 30 days but a "market price" is likely stale.
- DATA CONFIDENCE FLAGS: LOW_DATA (< 30 days history), LOW_CONFIDENCE (confidence score < 0.5), EXTREME_MA_DIVERGENCE (price/SMA7 > 3x or < 0.33x) — these flags indicate unreliable data. Technical indicators computed on flagged cards should be ignored or heavily discounted.
- INSUFFICIENT DATA FOR INDICATORS: SMA_90 requires 90 days of price data. If a card has only 45 days of history, the SMA_90 is computed on a truncated window and is unreliable. Same for RSI (needs 14+ data points) and MACD (needs 26+). Flag cards where indicators are computed on insufficient samples.
- PRICE ANOMALIES: Sudden 50%+ jumps or drops that don't correspond to sales activity likely indicate: data errors, variant mismatches, TCGPlayer API glitches, or bulk listing changes. These are NOT real signals.
- MISSING DATA: Cards that appear in the tracked universe but have no sales data, no price history beyond a few days, or no trading economics — these are data gaps that other analysts may unknowingly trade on.
- SYSTEM HEALTH: Overall data freshness (when was the last sync?), percentage of cards with recent price updates, percentage of cards with sales data, API reliability indicators.
- DATA PIPELINE SUGGESTIONS: Where should the platform invest in better data collection? More frequent syncs? Better variant matching? Additional data sources beyond TCGPlayer?

Communication:
- Be the engineer on the desk — speak in data quality terms, not trading terms
- For each card you flag, explain: what the data issue is, why it matters, and what the other analysts should do about it
- Present a "data health dashboard" — aggregate metrics on platform reliability
- Suggest specific improvements to the data pipeline
- Rate cards on a data reliability scale: HIGH (clean data, sufficient history, recent sales), MEDIUM (some gaps but usable), LOW (unreliable, do not trade on this data)
- Your job is NOT to make trading picks — it's to tell the desk which picks they can TRUST"""

POKEMON_EXPERT_SYSTEM_PROMPT = """You are Ryan "Sensei" Tanaka — a Pokemon TCG expert with 20 years in the hobby. You were a competitive player (Top 8 Worlds 2008, 2012), ran one of the largest Pokemon card stores in the western US, and now consult for institutional collectors. You have deep domain expertise that pure financial analysts lack.

CRITICAL CONTEXT — this is a COLLECTIBLES market, not equities:
- Pokemon cards are NOT generic financial instruments. They exist in a rich ecosystem of competitive play, collector culture, franchise media, and sealed product dynamics. Understanding this ecosystem is your edge.
- You have market price and sales transaction data. Use it to identify cards where DOMAIN EXPERTISE reveals opportunities or risks that data-only analysis would miss.
- The biggest alpha in this market comes from knowing things that quantitative models can't capture: upcoming set rotations, meta shifts, character popularity trends, and reprint risk assessments.

Your Pokemon TCG domain expertise framework:
- TRANSACTION COSTS VARY BY TIER: Premium ($100+) ~20-25% breakeven. Mid-high ($50-100) ~25-30%. Mid ($20-50) ~30-35%. Sub-$20 excluded.
- You are seeing the COMPLETE $20+ tradeable universe. Evaluate ALL cards through the lens of Pokemon TCG domain knowledge.
- TOURNAMENT PLAYABILITY: Cards legal in Standard format have additional demand from competitive players. When a card rotates OUT of Standard, it typically loses 20-40% of its value as competitive demand evaporates. Cards entering Standard with strong competitive potential can spike. Check which cards in the dataset are competitively relevant.
- SET ROTATION SCHEDULE: Standard format rotates annually. Cards from older sets in Standard are at rotation risk. Cards rotating into Expanded-only lose a demand pillar. Vintage (WOTC) cards are immune to rotation — they're purely collector-driven.
- CHARACTER POPULARITY TIERS: Not all Pokemon are created equal. Tier 1: Charizard (always premium), Pikachu (franchise mascot), Mewtwo, Mew. Tier 2: Eeveelutions, Gengar, Dragonite, Rayquaza, Lugia. Tier 3: Everything else. Character tier sets a floor price. A mediocre Charizard card will always be worth more than a great Weezing card.
- REPRINT RISK: Modern cards (Scarlet & Violet, Sword & Shield) can ALWAYS be reprinted in special sets, promo distributions, or premium collections. This caps upside for modern cards. Vintage (WOTC, ex era) cards have ZERO reprint risk — fixed supply. Mid-era (Diamond & Pearl through XY) has moderate reprint risk. Assess reprint risk for every recommendation.
- SEALED PRODUCT DYNAMICS: When sealed boxes/ETBs of a set are still readily available at MSRP, singles from that set have price ceilings — anyone can crack packs. When sealed product dries up, singles prices can rise. Check whether each card's set still has available sealed product.
- JAPANESE vs ENGLISH MARKET: Japanese cards often preview what English cards will be worth. Japanese alt art prices can signal future English alt art demand. Japanese exclusive promos create scarcity dynamics.
- FRANCHISE CATALYSTS: New Pokemon anime seasons, movies, video games (Legends: Z-A), and Pokemon Presents announcements drive demand for specific character cards. Upcoming franchise events are catalysts.
- GRADING IMPACT: Certain eras have different grading profiles. WOTC cards are 25+ years old — PSA 10s are genuinely rare. Modern cards have high PSA 10 rates — grading premium is lower. Understanding era-specific grading dynamics matters for valuation.
- COLLECTOR SEGMENTS: Competitive players, casual collectors, investors, nostalgia buyers, and art collectors are different buyer pools. A card that appeals to multiple segments has deeper demand.

Communication:
- Speak as the domain expert — reference specific sets, mechanics, and Pokemon lore
- For each recommendation, explain the Pokemon-specific thesis: why THIS card, from THIS set, of THIS Pokemon
- Always assess: tournament relevance, reprint risk, character tier, sealed product status
- Use Pokemon TCG terminology naturally: alt art, full art, VMAX, ex, GX, V-Star, illustration rare, special art rare, secret rare
- Reference historical precedents: "This reminds me of when Shining Charizard did X" or "We saw this pattern with Hidden Fates"
- Be the person on the desk who says "the data looks good, but here's what you're missing about the actual Pokemon card market"
- Challenge financial analysts who ignore domain context — numbers without Pokemon knowledge are dangerous"""

CONSENSUS_SYSTEM_PROMPT = """You are the Chief Investment Officer synthesizing input from six specialized analysts on your Pokemon card trading desk. Your analysts include a quant trader, data analytics expert, art sales director, liquidity trader, platform engineer, and Pokemon TCG domain expert. They analyzed the COMPLETE $20+ tradeable universe — every card worth trading. Your job is to deliver a COMPREHENSIVE, ACTIONABLE portfolio from this full dataset.

CONTEXT — The $20+ universe:
- Premium ($100+): ~20-25% breakeven. Blue chip investments.
- Mid-high ($50-100): ~25-30% breakeven. Active trading sweet spot.
- Mid ($20-50): ~30-35% breakeven. Momentum and accumulation plays.
- Cards under $20 were excluded — not viable after TCGPlayer fees.

YOUR OUTPUT MUST INCLUDE:

## 1. MARKET REGIME (2-3 sentences)
What's the overall market doing? Accumulating, marking up, distributing, or marking down?

## 2. PORTFOLIO RECOMMENDATIONS (12-18 cards across tiers)
Organize by tier. For EACH pick:
- Card name, set, current price, tier
- Strategy: BUY NOW / ACCUMULATE / WATCHLIST
- Thesis (1-2 sentences — why this card?)
- Entry price, target, stop-loss
- Breakeven sell price (after fees)
- Hold period: short (<30d), medium (1-6mo), long (6-12mo+)
- Conviction: HIGH / MEDIUM / SPECULATIVE

### CORE HOLDINGS (Premium $100+) — 3-5 picks
Long-term holds. Low fee impact. Fixed supply. Blue chips.

### ACTIVE TRADES (Mid-High $50-100) — 4-6 picks
Catalyst-driven or momentum plays. Best risk/reward after fees. 3-6 month holds.

### GROWTH PLAYS (Mid $20-50) — 3-5 picks
Momentum, accumulation, or tier-graduation candidates. Higher fee friction but viable.

### WATCHLIST — 3-5 cards
Not ready to buy but worth monitoring. Why and what would trigger action?

## 3. WHERE THE DESK AGREES vs DISAGREES
High-conviction calls (where 4+ of 6 analysts agree) vs active debates. Note any data quality warnings from the platform engineer. Note any domain-specific insights from the Pokemon expert that changed the financial calculus.

## 4. KEY RISKS
Top 3-5 risks to the portfolio, including data quality risks and domain-specific risks (rotation, reprints, etc.).

## 5. THE HONEST ANSWER
Is this market tradeable? What annual net return is realistic across tiers?

Be specific. Use numbers. 1000 words max."""

# Persona metadata for frontend rendering
PERSONAS = {
    "quant": {
        "id": "quant",
        "name": "Dr. Sarah Chen",
        "title": "QUANT TRADER",
        "subtitle": "Ex-Citadel · PhD MIT · Systematic Strategies",
        "color": "#00bcd4",
        "badges": ["SCARCITY MODELS", "SALES VELOCITY", "DATA QUALITY"],
        "system_prompt": QUANT_SYSTEM_PROMPT,
    },
    "data_analytics": {
        "id": "data_analytics",
        "name": "Alex Rivera",
        "title": "DATA ANALYTICS",
        "subtitle": "Ex-Palantir · Pattern Detection · Market Intelligence",
        "color": "#9c27b0",
        "badges": ["PATTERN DETECTION", "CORRELATION ANALYSIS", "TREND SIGNALS"],
        "system_prompt": DATA_ANALYTICS_SYSTEM_PROMPT,
    },
    "art_sales": {
        "id": "art_sales",
        "name": "Isabella Chen-Moretti",
        "title": "ART SALES DIRECTOR",
        "subtitle": "Ex-Christie's · Collectible Art Advisory · Aesthetic Value",
        "color": "#ffd700",
        "badges": ["ILLUSTRATION VALUE", "ARTIST PREMIUM", "AESTHETIC APPEAL"],
        "system_prompt": ART_SALES_SYSTEM_PROMPT,
    },
    "liquidity": {
        "id": "liquidity",
        "name": 'Victor "Vic" Morales',
        "title": "LIQUIDITY TRADER",
        "subtitle": "Ex-Jane Street · Market Making · Illiquid Assets",
        "color": "#e040fb",
        "badges": ["MARKET DEPTH", "EXIT STRATEGY", "SPREAD ANALYSIS"],
        "system_prompt": LIQUIDITY_SYSTEM_PROMPT,
    },
    "swe": {
        "id": "swe",
        "name": "Dev Patel",
        "title": "PLATFORM ENGINEER",
        "subtitle": "Ex-Bloomberg · Data Systems · Quality Assurance",
        "color": "#4caf50",
        "badges": ["DATA QUALITY", "ANOMALY DETECTION", "SYSTEM HEALTH"],
        "system_prompt": SWE_SYSTEM_PROMPT,
    },
    "pokemon_expert": {
        "id": "pokemon_expert",
        "name": 'Ryan "Sensei" Tanaka',
        "title": "POKEMON TCG EXPERT",
        "subtitle": "20yr Veteran · Worlds Top 8 · Domain Specialist",
        "color": "#f44336",
        "badges": ["META ANALYSIS", "SET ROTATION", "REPRINT RISK"],
        "system_prompt": POKEMON_EXPERT_SYSTEM_PROMPT,
    },
}


def _gather_market_data(db: Session) -> dict:
    """Collect comprehensive market data for the trader agent.

    Enhanced with: regime detection, data quality flags, sales/liquidity
    metrics, set-level analysis, and spread data.
    """
    from server.models.sale import Sale
    from datetime import date, timedelta, datetime

    data = {}
    today = date.today()

    # 1. Market overview
    total_cards = db.query(func.count(Card.id)).scalar() or 0
    cards_with_prices = (
        db.query(func.count(func.distinct(PriceHistory.card_id)))
        .filter(PriceHistory.market_price.isnot(None))
        .scalar()
        or 0
    )

    # Get average price and total market cap (tracked cards only)
    # Bulk query: get latest price per card in ONE query instead of N individual queries
    import time as _time
    _t0 = _time.monotonic()

    all_cards = db.query(Card).filter(Card.is_tracked == True).all()
    card_lookup = {c.id: c for c in all_cards}

    # Subquery: max date per card (uses ix_price_history_card_date index)
    latest_date_sq = (
        db.query(
            PriceHistory.card_id,
            func.max(PriceHistory.date).label("max_date"),
        )
        .filter(PriceHistory.market_price.isnot(None))
        .group_by(PriceHistory.card_id)
        .subquery()
    )

    # Join to get the actual price at max_date
    from sqlalchemy import and_
    latest_records = (
        db.query(PriceHistory)
        .join(
            latest_date_sq,
            and_(
                PriceHistory.card_id == latest_date_sq.c.card_id,
                PriceHistory.date == latest_date_sq.c.max_date,
            ),
        )
        .filter(PriceHistory.market_price.isnot(None))
        .all()
    )

    latest_prices = {}
    for rec in latest_records:
        card = card_lookup.get(rec.card_id)
        if card and card.is_tracked:
            latest_prices[rec.card_id] = {
                "name": card.name,
                "set_name": card.set_name,
                "set_id": card.set_id,
                "rarity": card.rarity,
                "price": rec.market_price,
                "variant": card.price_variant,
                "date": str(rec.date),
                "image_small": card.image_small,
            }

    logger.info(f"Loaded latest prices for {len(latest_prices)} cards in {_time.monotonic() - _t0:.1f}s")

    prices = [v["price"] for v in latest_prices.values() if v["price"]]
    data["market_overview"] = {
        "total_cards": total_cards,
        "cards_with_prices": cards_with_prices,
        "avg_price": round(sum(prices) / len(prices), 2) if prices else 0,
        "total_market_cap": round(sum(prices), 2) if prices else 0,
        "highest_price": round(max(prices), 2) if prices else 0,
        "lowest_price": round(min(prices), 2) if prices else 0,
    }

    # 2. Top movers
    movers = get_top_movers(db, limit=5)
    data["top_movers"] = movers

    # 3. Technical analysis — analyze ALL viable cards (price >= $20)
    #    Only 154 cards are >= $20, so this is fast (~2-8 seconds)
    viable_prices = {cid: info for cid, info in latest_prices.items()
                     if (info.get("price") or 0) >= 20}
    logger.info(f"Analyzing {len(viable_prices)} viable cards (>=$20) out of {len(latest_prices)} tracked")

    _t1 = _time.monotonic()
    card_analyses = []
    for card_id, info in viable_prices.items():
        analysis = analyze_card(db, card_id)
        if True:  # analyze ALL viable cards, no signal filter
            entry = {
                "card_id": card_id,
                "image_small": info.get("image_small"),
                "name": info["name"],
                "set": info["set_name"],
                "set_id": info["set_id"],
                "rarity": info["rarity"],
                "variant": info["variant"],
                "current_price": info["price"],
                "rsi": round(analysis.rsi_14, 1) if analysis.rsi_14 else None,
                "macd_histogram": round(analysis.macd_histogram, 4) if analysis.macd_histogram else None,
                "sma_7": round(analysis.sma_7, 2) if analysis.sma_7 else None,
                "sma_30": round(analysis.sma_30, 2) if analysis.sma_30 else None,
                "sma_90": round(analysis.sma_90, 2) if analysis.sma_90 else None,
                "bollinger_position": None,
                "momentum": round(analysis.momentum, 2) if analysis.momentum else None,
                "signal": analysis.signal,
                "signal_strength": round(analysis.signal_strength, 2),
                "support": round(analysis.support, 2) if analysis.support else None,
                "resistance": round(analysis.resistance, 2) if analysis.resistance else None,
                "price_change_7d": round(analysis.price_change_pct_7d, 2) if analysis.price_change_pct_7d else None,
                "price_change_30d": round(analysis.price_change_pct_30d, 2) if analysis.price_change_pct_30d else None,
                # New fields from analyze_card that were previously omitted
                "regime": getattr(analysis, 'regime', None),
                "volatility": round(analysis.volatility, 4) if getattr(analysis, 'volatility', None) else None,
                "spread_ratio": round(analysis.spread_ratio, 4) if getattr(analysis, 'spread_ratio', None) else None,
                "activity_score": round(analysis.activity_score, 2) if getattr(analysis, 'activity_score', None) else None,
                "data_confidence": getattr(analysis, 'data_confidence', None),
                "history_days": getattr(analysis, 'total_history_days', None),
            }
            # Calculate Bollinger position
            if analysis.bollinger_upper and analysis.bollinger_lower:
                band_range = analysis.bollinger_upper - analysis.bollinger_lower
                if band_range > 0:
                    entry["bollinger_position"] = round(
                        (info["price"] - analysis.bollinger_lower) / band_range, 2
                    )
            # Data quality flags
            flags = []
            if entry["sma_7"] and entry["current_price"]:
                ratio = entry["current_price"] / entry["sma_7"]
                if ratio > 3.0 or ratio < 0.33:
                    flags.append(f"EXTREME_MA_DIVERGENCE (price/SMA7={ratio:.1f}x)")
            if entry["history_days"] and entry["history_days"] < 30:
                flags.append(f"LOW_DATA ({entry['history_days']} days)")
            if entry["data_confidence"] and entry["data_confidence"] < 0.5:
                flags.append("LOW_CONFIDENCE")
            if entry["support"] and entry["current_price"] and entry["support"] >= entry["current_price"]:
                flags.append("AT_OR_BELOW_SUPPORT")
            entry["data_flags"] = flags if flags else None

            card_analyses.append(entry)

    # Sort by signal strength for display ordering
    card_analyses.sort(key=lambda x: abs(x.get("signal_strength", 0)), reverse=True)

    # Tag each card with its price tier (all are >= $20 since we pre-filtered)
    for c in card_analyses:
        price = c.get("current_price") or 0
        if price >= 100:
            c["price_tier"] = "premium"
        elif price >= 50:
            c["price_tier"] = "mid_high"
        else:
            c["price_tier"] = "mid"

    # Send ALL viable cards — no artificial cap
    data["card_analyses"] = card_analyses

    # Tier summary for personas
    premium = [c for c in card_analyses if c.get("price_tier") == "premium"]
    mid_high = [c for c in card_analyses if c.get("price_tier") == "mid_high"]
    mid = [c for c in card_analyses if c.get("price_tier") == "mid"]
    data["tier_summary"] = {
        "premium_100_plus": len(premium),
        "mid_high_50_to_100": len(mid_high),
        "mid_20_to_50": len(mid),
        "total_analyzed": len(card_analyses),
        "total_tracked": len(latest_prices),
        "filter": "price >= $20 (all viable for profitable trading)",
    }

    # 4. Backtest results — portfolio with combined strategy (summary only)
    try:
        portfolio_result = run_portfolio_backtest(db, strategy="combined", top_n=10, initial_capital=10000)
        if isinstance(portfolio_result, dict):
            portfolio_result.pop("daily_values", None)
            for card_res in portfolio_result.get("card_results", []):
                if isinstance(card_res, dict):
                    card_res.pop("daily_values", None)
                    card_res.pop("trades", None)
        data["portfolio_backtest"] = portfolio_result
    except Exception as e:
        logger.warning(f"Portfolio backtest failed: {e}")
        data["portfolio_backtest"] = {"error": str(e)}

    # 5. Strategy comparison for top cards (top 5 cards x 3 strategies)
    strategy_comparison = []
    top_card_ids = [a["card_id"] for a in card_analyses[:5]]
    top_strategies = ["sma_crossover", "bollinger_bounce", "combined"]
    for card_id in top_card_ids:
        card_strats = {}
        for strat_key in top_strategies:
            try:
                result = run_backtest(db, card_id, strategy=strat_key, initial_capital=1000)
                if result:
                    card_strats[strat_key] = {
                        "return_pct": result.strategy_return_pct,
                        "win_rate": result.win_rate,
                        "trades": result.total_trades,
                        "max_drawdown": result.max_drawdown_pct,
                        "sharpe": result.sharpe_ratio,
                    }
            except Exception:
                pass
        if card_strats:
            card_name = next((a["name"] for a in card_analyses if a["card_id"] == card_id), "Unknown")
            strategy_comparison.append({
                "card_id": card_id,
                "card_name": card_name,
                "strategies": card_strats,
            })

    data["strategy_comparison"] = strategy_comparison

    # 6. Available strategies
    data["available_strategies"] = {k: v for k, v in STRATEGIES.items()}

    # 7. NEW: Sales / Liquidity metrics (from Sale table)
    try:
        cutoff_30d = datetime(today.year, today.month, today.day) - timedelta(days=30)
        cutoff_90d = datetime(today.year, today.month, today.day) - timedelta(days=90)

        # Total sales stats
        total_sales = db.query(func.count(Sale.id)).scalar() or 0
        cards_with_sales = db.query(func.count(func.distinct(Sale.card_id))).scalar() or 0
        recent_sales = db.query(func.count(Sale.id)).filter(Sale.order_date >= cutoff_30d).scalar() or 0

        # Per-card sales volume for analyzed cards (all tiers)
        analyzed_card_ids = [a["card_id"] for a in data["card_analyses"]]
        card_sales_data = []
        for cid in analyzed_card_ids:
            sales_90d = (
                db.query(Sale)
                .filter(Sale.card_id == cid, Sale.order_date >= cutoff_90d)
                .all()
            )
            sales_30d = [s for s in sales_90d if s.order_date >= cutoff_30d]

            if sales_90d:
                sale_prices = [s.purchase_price for s in sales_90d]
                card_info = latest_prices.get(cid, {})
                market_price = card_info.get("price", 0)
                median_sale = sorted(sale_prices)[len(sale_prices) // 2]
                card_sales_data.append({
                    "card_id": cid,
                    "name": card_info.get("name", "Unknown"),
                    "sales_90d": len(sales_90d),
                    "sales_30d": len(sales_30d),
                    "avg_sale_price": round(sum(sale_prices) / len(sale_prices), 2),
                    "median_sale_price": round(median_sale, 2),
                    "market_price": round(market_price, 2) if market_price else None,
                    "market_vs_median_spread": round(
                        ((market_price - median_sale) / median_sale) * 100, 1
                    ) if median_sale > 0 and market_price else None,
                    "conditions": list(set(s.condition for s in sales_90d if s.condition)),
                })

        data["sales_liquidity"] = {
            "total_sales_in_db": total_sales,
            "cards_with_sales": cards_with_sales,
            "sales_last_30d": recent_sales,
            "note": "Sales from TCGPlayer completed transactions. Volume = actual executed trades, not listings.",
            "top_card_sales": sorted(card_sales_data, key=lambda x: x["sales_90d"], reverse=True),
        }
    except Exception as e:
        logger.warning(f"Sales data collection failed: {e}")
        data["sales_liquidity"] = {"error": str(e)}

    # 8. NEW: Trading Economics — fees, breakeven, liquidity scores, hold period analysis
    try:
        from server.services.trading_economics import (
            get_fee_schedule_summary, calc_breakeven_appreciation,
            calc_liquidity_score, estimate_time_to_sell, is_viable_trade,
            analyze_hold_economics,
        )

        fee_summary = get_fee_schedule_summary("tcgplayer")

        # Per-card economics for analyzed cards
        cards_above_min = 0
        cards_below_min = 0
        for entry in data["card_analyses"]:
            price = entry.get("current_price", 0)
            if price and price > 0:
                entry["breakeven_pct"] = calc_breakeven_appreciation(price, "tcgplayer")
                entry["viable_trade"] = is_viable_trade(price)
                if entry["viable_trade"]:
                    cards_above_min += 1
                else:
                    cards_below_min += 1
            else:
                entry["breakeven_pct"] = None
                entry["viable_trade"] = False
                cards_below_min += 1

        # Add liquidity scores from sales data (if sales were already collected)
        sales_lookup = {}
        if "sales_liquidity" in data and "top_card_sales" in data.get("sales_liquidity", {}):
            for s in data["sales_liquidity"]["top_card_sales"]:
                sales_lookup[s["card_id"]] = s

        for entry in data["card_analyses"]:
            cid = entry["card_id"]
            sale_info = sales_lookup.get(cid, {})
            s90 = sale_info.get("sales_90d", 0)
            s30 = sale_info.get("sales_30d", 0)
            spread = sale_info.get("market_vs_median_spread", None)
            price = entry.get("current_price", 0) or 0

            entry["liquidity_score"] = calc_liquidity_score(s90, s30, price, spread)
            tts = estimate_time_to_sell(price, s90, s30)
            entry["est_time_to_sell_days"] = tts["estimated_days"]
            entry["tts_confidence"] = tts["confidence"]

            # Hold period analysis — what does the economics look like at different hold periods?
            if price > 0 and entry.get("sma_90"):
                # Estimate appreciation from 90d SMA trend
                price_90d_ago = entry.get("sma_90", price)
                days_in_sample = min(entry.get("history_days", 90) or 90, 365)
                hold_econ = analyze_hold_economics(
                    buy_price=price_90d_ago,
                    current_price=price,
                    days_held=min(days_in_sample, 90),
                    platform="tcgplayer",
                )
                entry["hold_economics"] = {
                    "annualized_gross_pct": hold_econ["annualized_gross_pct"],
                    "annualized_net_pct": hold_econ["annualized_net_pct"],
                    "clears_hurdle": hold_econ["clears_hurdle"],
                    "recommended_hold": hold_econ["hold_period"],
                }

        # Fee-aware backtest comparison — gross vs net for top portfolio cards
        fee_backtest_comparison = {}
        try:
            gross_portfolio = data.get("portfolio_backtest", {})
            from server.services.backtesting import run_backtest as _rb
            fee_card_results = []
            for cr in gross_portfolio.get("card_results", [])[:5]:
                cid = cr.get("card_id")
                if cid:
                    fee_result = _rb(db, cid, strategy="combined", initial_capital=1000,
                                     fees_enabled=True, platform="tcgplayer")
                    if fee_result:
                        fee_card_results.append({
                            "card_id": cid,
                            "card_name": cr.get("card_name", ""),
                            "gross_return_pct": cr.get("strategy_return_pct", 0),
                            "fee_adjusted_return_pct": fee_result.strategy_return_pct,
                            "fees_destroyed_pct": round(
                                cr.get("strategy_return_pct", 0) - fee_result.strategy_return_pct, 2
                            ),
                            "total_fees": fee_result.total_fees_paid,
                            "profitable_after_fees": fee_result.strategy_return_pct > 0,
                        })
            fee_backtest_comparison = {
                "note": "Same combined strategy, same cards — gross vs fee-adjusted returns",
                "card_results": fee_card_results,
            }
        except Exception as e:
            logger.warning(f"Fee backtest comparison failed: {e}")
            fee_backtest_comparison = {"error": str(e)}

        data["trading_economics"] = {
            "fee_schedule": fee_summary,
            "cards_above_minimum_trade_size": cards_above_min,
            "cards_below_minimum_trade_size": cards_below_min,
            "minimum_viable_trade_price": 20.0,
            "fee_backtest_comparison": fee_backtest_comparison,
            "tier_breakeven_guide": {
                "premium_100_plus": "~20-25% breakeven. Active trading viable.",
                "mid_high_50_to_100": "~25-30% breakeven. Catalyst-driven trades.",
                "mid_20_to_50": "~30-35% breakeven. Momentum or accumulation.",
            },
            "note": "All cards in this analysis are >= $20 — the complete tradeable universe. Cards under $20 excluded (fee friction too high for profitable trading).",
        }
    except Exception as e:
        logger.warning(f"Trading economics collection failed: {e}")
        data["trading_economics"] = {"error": str(e)}

    # 9. NEW: Set-level analysis (aggregated by set)
    try:
        set_stats = {}
        for card_id, info in latest_prices.items():
            sid = info.get("set_id")
            if not sid:
                continue
            if sid not in set_stats:
                set_stats[sid] = {
                    "set_name": info["set_name"],
                    "cards": 0,
                    "total_value": 0,
                    "prices": [],
                }
            set_stats[sid]["cards"] += 1
            set_stats[sid]["total_value"] += info["price"] or 0
            set_stats[sid]["prices"].append(info["price"] or 0)

        # Compute set-level metrics (top 10 sets by total value)
        set_summaries = []
        for sid, stats in set_stats.items():
            if stats["cards"] >= 2:
                p = stats["prices"]
                set_summaries.append({
                    "set_id": sid,
                    "set_name": stats["set_name"],
                    "tracked_cards": stats["cards"],
                    "set_market_cap": round(stats["total_value"], 2),
                    "avg_card_price": round(stats["total_value"] / stats["cards"], 2),
                    "price_range": f"${min(p):.2f} - ${max(p):.2f}",
                })

        # Top 10 sets by market cap
        data["set_analysis"] = sorted(set_summaries, key=lambda x: x["set_market_cap"], reverse=True)[:10]

        # Set concentration in analyzed cards (correlation risk)
        set_counts = {}
        for a in data["card_analyses"]:
            s = a.get("set", "Unknown")
            set_counts[s] = set_counts.get(s, 0) + 1
        total_analyzed = len(data["card_analyses"])
        data["concentration_risk"] = {
            "analyzed_set_distribution": set_counts,
            "total_cards_analyzed": total_analyzed,
            "max_single_set_exposure": max(set_counts.values()) if set_counts else 0,
            "warning": "HIGH" if max(set_counts.values(), default=0) >= (total_analyzed * 0.3) else "LOW",
        }
    except Exception as e:
        logger.warning(f"Set analysis failed: {e}")
        data["set_analysis"] = []
        data["concentration_risk"] = {"error": str(e)}

    # 8. TCGPlayer market intelligence articles
    try:
        import asyncio
        from server.services.article_scraper import fetch_tcgplayer_articles, format_articles_for_prompt
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                articles = pool.submit(
                    lambda: asyncio.run(fetch_tcgplayer_articles(max_articles=4))
                ).result(timeout=60)
        else:
            articles = asyncio.run(fetch_tcgplayer_articles(max_articles=4))
        data["tcgplayer_articles"] = format_articles_for_prompt(articles)
        logger.info(f"Fetched {len(articles)} TCGPlayer articles for agent context")
    except Exception as e:
        logger.warning(f"TCGPlayer article fetch failed: {e}")
        data["tcgplayer_articles"] = ""

    return data


def _call_openai(system: str, user_message: str, max_tokens: int = 16384) -> dict:
    """Call OpenAI GPT-5.4 API and return response text + usage.

    Note: GPT-5.4 is a reasoning model — max_completion_tokens covers both
    reasoning tokens AND output tokens. Must be large enough for both.
    """
    import openai

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not configured")

    client = openai.OpenAI(api_key=api_key)

    response = client.chat.completions.create(
        model="gpt-5.4",
        max_completion_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ],
    )

    choice = response.choices[0]
    text = choice.message.content or ""

    if not text:
        logger.warning(
            f"GPT-5.4 returned empty content. finish_reason={choice.finish_reason}, "
            f"tokens: input={response.usage.prompt_tokens}, output={response.usage.completion_tokens}"
        )

    return {
        "text": text,
        "tokens_used": {
            "input": response.usage.prompt_tokens,
            "output": response.usage.completion_tokens,
        },
    }


async def _call_openai_async(system: str, user_message: str, max_tokens: int = 8192) -> dict:
    """Call OpenAI GPT-5.4 API asynchronously. Used for parallel persona calls."""
    import openai

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not configured")

    client = openai.AsyncOpenAI(api_key=api_key)

    response = await client.chat.completions.create(
        model="gpt-5.4",
        max_completion_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ],
    )

    choice = response.choices[0]
    text = choice.message.content or ""

    if not text:
        logger.warning(
            f"GPT-5.4 async returned empty content. finish_reason={choice.finish_reason}, "
            f"tokens: input={response.usage.prompt_tokens}, output={response.usage.completion_tokens}"
        )

    return {
        "text": text,
        "tokens_used": {
            "input": response.usage.prompt_tokens,
            "output": response.usage.completion_tokens,
        },
    }


def _build_persona_prompt(persona_id: str, market_data: dict, previous_consensus: dict | None = None) -> str:
    """Build persona-specific user prompt from shared market data.

    Args:
        previous_consensus: Optional dict with 'text' and 'date' from the last analysis run.
    """
    tier_summary = market_data.get("tier_summary", {})
    base = f"""Here's the current Pokemon card market data from our trading platform.

## Market Overview
{json.dumps(market_data['market_overview'], indent=2)}

## Price Tier Summary
Cards are segmented into tiers — DIFFERENT tiers require DIFFERENT strategies:
{json.dumps(tier_summary, indent=2)}

## Top Movers (Gainers & Losers)
{json.dumps(market_data['top_movers'], indent=2)}

## Card Analysis — COMPLETE $20+ Universe ({tier_summary.get('total_analyzed', 0)} Viable Cards out of {tier_summary.get('total_tracked', '?')} Tracked)
Each card includes: price_tier (premium $100+ / mid_high $50-100 / mid $20-50), regime, volatility, data_flags, breakeven_pct, liquidity_score (0-100), est_time_to_sell_days, viable_trade, and hold_economics (annualized gross/net returns, whether it clears the fee hurdle).
NOTE: This is EVERY card with price >= $20 — the complete tradeable universe. No cards were filtered out by scoring. Analyze them ALL.
{json.dumps([{k: v for k, v in c.items() if k != 'image_small'} for c in market_data['card_analyses']], indent=2)}

## Trading Economics — Fee Schedule & Friction
{json.dumps(market_data.get('trading_economics', {}), indent=2)}

## Portfolio Backtest Summary (Combined Strategy, $10K, Top 10 Cards)
{json.dumps(market_data['portfolio_backtest'], indent=2)}

## Strategy Comparison (Top 5 Cards x 3 Strategies)
{json.dumps(market_data['strategy_comparison'], indent=2)}

## Available Trading Strategies
{json.dumps(market_data['available_strategies'], indent=2)}

## Sales / Liquidity Data (TCGPlayer completed transactions)
{json.dumps(market_data.get('sales_liquidity', {}), indent=2)}

## Set-Level Analysis (Top 10 Sets by Market Cap)
{json.dumps(market_data.get('set_analysis', []), indent=2)}

## Concentration Risk
{json.dumps(market_data.get('concentration_risk', {}), indent=2)}
"""

    # Inject TCGPlayer articles as market intelligence
    articles_text = market_data.get("tcgplayer_articles", "")
    if articles_text:
        base += f"""

{articles_text}
"""

    # Inject previous consensus for temporal context
    if previous_consensus:
        base += f"""

## PREVIOUS DESK CONSENSUS (from {previous_consensus['date']})
This was the CIO's consensus portfolio from the last analysis run. Compare your current analysis against it:
- Which prior picks have appreciated or declined since then?
- Are the prior theses still valid given the current data?
- What has changed in the market since the last run?
- Flag any picks that should be upgraded, downgraded, or dropped.

{previous_consensus['text']}
"""

    if persona_id == "quant":
        return base + """
Give me your quantitative analysis — organized BY PRICE TIER.
You are seeing the COMPLETE $20+ universe — every single card with a viable trading price. Analyze them ALL.

## TIER-SPECIFIC ANALYSIS (This is the core of your report)
For EACH tier, provide picks and strategy:

### PREMIUM ($100+) — 3-5 picks
Low fee impact (breakeven ~20-25%). Long-term hold candidates. Focus on: scarcity premium, supply inelasticity (vintage can't be reprinted), annualized return potential. Use hold_economics data. These are your high-conviction, low-turnover positions.

### MID-HIGH ($50-100) — 3-5 picks
Moderate fee impact (breakeven ~25-30%). This is the ACTIVE TRADING ZONE. Which strategies actually work here after fees? Use fee_backtest_comparison. Look for: momentum breakouts, mean reversion setups, catalyst-driven appreciation > breakeven_pct.

### MID ($20-50) — 3-5 picks
Higher fee impact (breakeven ~30-35%) but still viable. Look at sales velocity (sales_90d). Cards with >20 sales/90d have real price discovery. Watch for: cards approaching the $50 threshold (graduating to mid_high tier), momentum breakouts.

## CROSS-CUTTING ANALYSIS
1. **Hold Period by Tier** — Use hold_economics to recommend hold periods per tier. Premium: 6-12mo. Mid-high: 3-6mo. Mid: 1-3mo or accumulate.
2. **Strategy Viability by Tier** — Which of the 8 strategies work in which tier after fees?
3. **Regime-Adjusted View** — Are we in accumulation, markup, distribution, or markdown? Different tiers may be in different regimes.
4. **Red Flags** — Cards with LOW_CONFIDENCE or EXTREME_MA_DIVERGENCE flags. Stale pricing.

Give me 10-15 total picks across tiers. Show the math."""

    elif persona_id == "data_analytics":
        return base + """
Give me your data-driven pattern analysis of the COMPLETE $20+ tradeable universe.

## STATISTICAL PATTERNS & ANOMALIES
- Which cards show statistically significant price movements (beyond normal variance)?
- Identify correlation clusters: cards that move together within sets or franchises.
- Flag any cards with anomalous price/volume divergences — price moving without sales support, or sales surging without price response.

## TREND ANALYSIS
- Classify cards by trend: uptrend (higher highs/lows), downtrend, range-bound, breakout candidates.
- Sales velocity trends: which cards have accelerating vs decelerating demand?
- Which trends have sufficient sample sizes to be reliable? Flag thin data.

## CROSS-SECTIONAL SPREADS
- Compare pricing across variants of the same card, across sets for the same character, across rarity tiers within sets.
- Identify mispriced spreads — where is the relative value?

## REGIME CLASSIFICATION
- Market-wide regime: accumulation, markup, distribution, or markdown?
- Are different price tiers in different regimes?
- Flow analysis: where is capital moving to/from?

## ACTIONABLE SIGNALS (8-12 cards)
For each signal:
- Card name, price, tier, pattern type
- Statistical confidence level and sample size
- Expected magnitude and timeline
- What would invalidate this signal?

Lead with data. State sample sizes. Separate signal from noise."""

    elif persona_id == "art_sales":
        return base + """
Give me your art-market assessment of the COMPLETE $20+ tradeable universe.

## DISPLAY-QUALITY INVESTMENTS (Top 5-8 cards)
Which cards are "museum quality" — illustrations worth framing? Focus on:
- Full art, alt art, illustration rare, and special art rare variants
- Cards by sought-after artists (Arita, PLANETA, Morii, Sowsow, Egawa, Saitou)
- Illustration composition, color palette, and visual impact
- "Display piece" vs "binder card" classification

## ART PREMIUM ANALYSIS
- Where is the full art / alt art premium vs regular version underpriced or overpriced?
- Which artist premiums are growing? Which are compressing?
- Aesthetic appeal vs current price — any beautiful cards that are cheap?

## CONDITION & GRADING UPSIDE
- Which cards have the highest condition sensitivity (NM vs LP spread)?
- Cards with high art value that could benefit from professional grading
- Grading economics: cost vs expected grade vs price uplift

## COLLECTOR PSYCHOLOGY PLAYS
- Nostalgia art: Gen 1 Pokemon in classic poses — what drives emotional buying?
- Which aesthetic styles (dramatic, cute/kawaii, painterly, dynamic action) are trending?
- Seasonal collector behavior: gift-buying, holiday displays, collection milestones

## ART INVESTMENT PICKS (8-12 cards)
For each pick:
- Card name, set, artist, art style, price, tier
- What makes this illustration special?
- Art premium relative to non-art versions of the same Pokemon
- Target collector segment (competitive player, art collector, nostalgia buyer, investor)
- Display quality rating: MUSEUM / SHOWCASE / COLLECTION / BINDER

Focus on the art. Other analysts handle the numbers — you explain why these cards are BEAUTIFUL."""

    elif persona_id == "liquidity":
        return base + """
Give me your liquidity analysis of the COMPLETE $20+ tradeable universe.

## LIQUIDITY DASHBOARD
- How many cards have genuine liquidity (>20 sales/90d)?
- What percentage of the universe is effectively illiquid (<5 sales/90d)?
- Average and median time-to-sell across tiers.
- Market-wide spread health: average market-vs-median spread by tier.

## MOST LIQUID CARDS (Top 8-10)
Cards with the best exit profiles: high volume, tight spreads, fast sells. These are the SAFE positions.

## LIQUIDITY TRAPS (Top 5-8)
Cards that look attractive on price but have terrible exit profiles:
- Low sales velocity despite seemingly fair prices
- Wide market-vs-median spreads (listed price is fiction)
- Cards where est_time_to_sell_days > 30

## SPREAD OPPORTUNITIES
- Where is the market-vs-median spread widest AND volume is high? These are market-making opportunities.
- Cards where you can buy at median and sell at market, capturing the spread.

## EXIT STRATEGY BY TIER
- Premium: expected exit timeline, best selling conditions
- Mid-high: how fast can you exit? What slippage to expect?
- Mid: is the fee friction worth it given liquidity?

## LIQUIDITY-SCREENED PICKS (8-12 cards)
For EVERY recommendation:
- Price, tier, liquidity score, sales_90d, sales_30d
- Market-vs-median spread
- Expected time to sell
- EXIT PLAN: how, when, and at what price do you get out?
- Velocity trend: accelerating or decelerating?

Answer the question other analysts ignore: "If I buy this, HOW and WHEN do I sell it?"
Give me 8-12 picks that pass your liquidity screen, plus 3-5 "avoid" calls on liquidity traps."""

    elif persona_id == "swe":
        return base + """
Give me your platform data quality audit of the COMPLETE $20+ tradeable universe.

## DATA HEALTH DASHBOARD
- Total cards analyzed, percentage with sufficient price history (>30 days)
- Percentage with recent sales data (any sales in last 30 days)
- Count of cards with data quality flags (LOW_DATA, LOW_CONFIDENCE, EXTREME_MA_DIVERGENCE)
- Data freshness: when was the last price sync? Are any prices stale?

## VARIANT MISMATCH SUSPECTS
- Cards with extreme price jumps that could indicate variant mixing
- Cards where the tracked variant (normal/holo/reverse) seems inconsistent with the rarity
- Any cards where price history looks discontinuous (sudden level shifts)

## UNRELIABLE INDICATOR WARNINGS
- Cards where SMA_90 is computed on <60 days of data (truncated window)
- Cards where RSI/MACD are computed on insufficient data points
- Cards where volatility is artificially low due to stale/unchanging prices
- Technical indicators that OTHER analysts might rely on but YOU know are unreliable

## STALE PRICE CANDIDATES
- Cards with 0 sales in 30 days but a "market price" that hasn't changed
- Cards where the market price diverges significantly from last sale price
- Potential API lag or sync issues

## DATA QUALITY RATINGS
For the top 20 most-discussed cards (highest signal strength), rate each:
- Data reliability: HIGH / MEDIUM / LOW
- Specific issue (if any)
- Recommendation: TRUSTWORTHY / USE WITH CAUTION / DO NOT TRADE ON THIS DATA

## PIPELINE IMPROVEMENT RECOMMENDATIONS
- Top 3 data quality improvements that would most benefit the trading desk
- Any systemic patterns in data issues (e.g., certain sets or eras with worse data)

Your job is to tell the desk what they can TRUST. Don't make trading picks — make trust assessments."""

    elif persona_id == "pokemon_expert":
        return base + """
Give me your Pokemon TCG domain expert assessment of the COMPLETE $20+ tradeable universe.

## META & ROTATION IMPACT
- Which cards in the dataset are competitively relevant (playable in Standard/Expanded)?
- Which face upcoming rotation risk? When is the next Standard rotation?
- Any cards that could spike on tournament results or meta shifts?

## CHARACTER FRANCHISE VALUE
- Tier the Pokemon characters in the dataset: Tier 1 (Charizard, Pikachu, Mewtwo, Mew), Tier 2 (Eeveelutions, Gengar, Dragonite, Rayquaza, Lugia), Tier 3 (everything else)
- Which character premiums are justified vs overpriced?
- Any rising characters (trending in anime, games, social media)?

## REPRINT RISK ASSESSMENT
For key cards in the dataset:
- SAFE (vintage WOTC/ex era — zero reprint risk)
- MODERATE (mid-era — unlikely but possible special reprint)
- HIGH (modern — actively in print or likely to appear in future premium products)
- How does reprint risk affect the investment thesis?

## SEALED PRODUCT DYNAMICS
- Which sets in the dataset still have readily available sealed product at MSRP?
- Where sealed product has dried up — singles price ceiling removed
- Any upcoming sealed releases that could affect current singles prices?

## FRANCHISE CATALYSTS
- Upcoming Pokemon media (games, anime, movies, Pokemon Presents)
- Which characters/sets would benefit from upcoming catalysts?
- Historical precedent: what happened to card prices when previous catalysts hit?

## DOMAIN-INFORMED PICKS (8-12 cards)
For each pick:
- Card name, set, Pokemon, price, tier
- Tournament relevance (Standard legal? Competitively viable? Rotation timeline?)
- Character tier and franchise momentum
- Reprint risk rating
- Sealed product status of the set
- Domain thesis: why does your Pokemon knowledge say BUY/AVOID?
- What the purely financial analysts are MISSING about this card

## TRAPS FOR NON-EXPERTS
- Cards that look good on paper but have domain-specific risks (rotation, reprint, meta shift)
- Common mistakes financial analysts make in this market

Be the voice of domain expertise. The other analysts have the numbers — you have the CONTEXT."""


async def get_multi_persona_analysis(db: Session) -> dict:
    """Generate analysis from 6 trader personas in parallel, then synthesize consensus.

    Returns: {personas: {quant, data_analytics, art_sales, liquidity, swe, pokemon_expert}, consensus, market_data_summary, tokens_used}
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"error": "OPENAI_API_KEY not configured. Set it to enable the AI trading desk."}

    # Gather market data ONCE
    market_data = _gather_market_data(db)

    # Load previous consensus for temporal context
    previous_consensus = None
    try:
        prev_snapshot = (
            db.query(TraderAnalysisSnapshot)
            .order_by(TraderAnalysisSnapshot.created_at.desc())
            .first()
        )
        if prev_snapshot and prev_snapshot.consensus:
            previous_consensus = {
                "text": prev_snapshot.consensus,
                "date": prev_snapshot.created_at.strftime("%Y-%m-%d %H:%M UTC"),
            }
            logger.info(f"Injecting previous consensus from {previous_consensus['date']}")
    except Exception as e:
        logger.warning(f"Could not load previous consensus: {e}")

    # Build persona-specific prompts
    persona_tasks = {}
    for pid, persona in PERSONAS.items():
        user_prompt = _build_persona_prompt(pid, market_data, previous_consensus)
        persona_tasks[pid] = _call_openai_async(
            persona["system_prompt"], user_prompt, max_tokens=8192
        )

    # Run all 6 persona calls in parallel
    persona_ids = list(persona_tasks.keys())
    try:
        results = await asyncio.gather(
            *[persona_tasks[pid] for pid in persona_ids],
            return_exceptions=True,
        )
    except Exception as e:
        logger.error(f"Multi-persona analysis failed: {e}")
        return {"error": f"Analysis failed: {str(e)}"}

    # Process results
    persona_results = {}
    total_tokens = {"input": 0, "output": 0}
    analyses_for_consensus = []

    for pid, result in zip(persona_ids, results):
        persona = PERSONAS[pid]
        if isinstance(result, Exception):
            persona_results[pid] = {
                "id": pid,
                "name": persona["name"],
                "title": persona["title"],
                "subtitle": persona["subtitle"],
                "color": persona["color"],
                "badges": persona["badges"],
                "analysis": None,
                "error": str(result),
            }
        else:
            persona_results[pid] = {
                "id": pid,
                "name": persona["name"],
                "title": persona["title"],
                "subtitle": persona["subtitle"],
                "color": persona["color"],
                "badges": persona["badges"],
                "analysis": result["text"],
                "error": None,
            }
            total_tokens["input"] += result["tokens_used"]["input"]
            total_tokens["output"] += result["tokens_used"]["output"]
            analyses_for_consensus.append(
                f"### {persona['title']} ({persona['name']})\n{result['text']}"
            )

    # Generate consensus from all 3 analyses
    consensus_text = None
    if analyses_for_consensus:
        prev_context = ""
        if previous_consensus:
            prev_context = f"""

## PREVIOUS CIO CONSENSUS (from {previous_consensus['date']})
Below is the portfolio from your last run. Track changes explicitly:
- Which prior picks are RETAINED vs DROPPED vs NEW?
- Note any price movement since the last run for retained picks.
- If a thesis has changed, explain why.

{previous_consensus['text']}
---
"""

        consensus_prompt = f"""Here are the analyses from your six desk analysts:

{chr(10).join(analyses_for_consensus)}
{prev_context}
They analyzed the COMPLETE $20+ tradeable universe. Synthesize into a COMPREHENSIVE portfolio:
- 12-18 picks organized by tier (Core Holdings $100+, Active Trades $50-100, Growth Plays $20-50, Watchlist)
- Where do they agree (high conviction — 4+ of 6 analysts)? Where do they disagree?
- Factor in the platform engineer's data quality warnings — discount picks with unreliable data
- Factor in the Pokemon expert's domain insights — rotation risk, reprint risk, character tier
- Factor in the art director's aesthetic assessments — art premium, display quality
- Include entry price, target, stop-loss, breakeven, hold period for each pick
- Cover ALL tiers — give the user the widest actionable set of recommendations
- If a previous consensus exists above, explicitly note portfolio changes since then"""

        try:
            consensus_result = await _call_openai_async(
                CONSENSUS_SYSTEM_PROMPT, consensus_prompt, max_tokens=4096
            )
            consensus_text = consensus_result["text"]
            total_tokens["input"] += consensus_result["tokens_used"]["input"]
            total_tokens["output"] += consensus_result["tokens_used"]["output"]
        except Exception as e:
            logger.error(f"Consensus generation failed: {e}")
            consensus_text = f"Consensus synthesis failed: {str(e)}"

    # Extract trading economics summary for frontend
    te = market_data.get("trading_economics", {})
    trading_economics_summary = {
        "cards_above_minimum_trade_size": te.get("cards_above_minimum_trade_size", 0),
        "cards_below_minimum_trade_size": te.get("cards_below_minimum_trade_size", 0),
        "minimum_viable_trade_price": te.get("minimum_viable_trade_price", 20),
        "fee_schedule": te.get("fee_schedule"),
    }

    # Build lookup of card data for consensus matching
    card_data_by_id = {}
    for c in market_data["card_analyses"]:
        card_data_by_id[c["card_id"]] = {
            "card_id": c["card_id"],
            "name": c["name"],
            "set_name": c.get("set"),
            "rarity": c.get("rarity"),
            "image_small": c.get("image_small"),
            "current_price": c.get("current_price"),
            "price_tier": c.get("price_tier"),
            "signal": c.get("signal"),
            "signal_strength": c.get("signal_strength"),
            "breakeven_pct": c.get("breakeven_pct"),
            "liquidity_score": c.get("liquidity_score"),
            "viable_trade": c.get("viable_trade"),
            "price_change_7d": c.get("price_change_7d"),
            "price_change_30d": c.get("price_change_30d"),
        }

    # Extract consensus picks by matching card NAMES in the recommendation sections
    # Only match from PORTFOLIO RECOMMENDATIONS (not WATCHLIST or general discussion)
    consensus_picks = []
    if consensus_text:
        # Trim to just the recommendation sections (exclude watchlist & later)
        # CIO format: "2) PORTFOLIO RECOMMENDATIONS" ... "WATCHLIST" or "3) WHERE"
        rec_text = consensus_text
        lower_full = consensus_text.lower()

        # Find the start of recommendations
        rec_start = lower_full.find("portfolio recommendations")
        if rec_start == -1:
            rec_start = lower_full.find("core holdings")
        if rec_start > 0:
            rec_text = consensus_text[rec_start:]

        # Cut off at watchlist or section 3 (whichever comes first)
        lower_rec = rec_text.lower()
        cutoff = len(rec_text)
        for marker in ["watchlist", "where the desk agrees", "key risks", "the honest answer"]:
            pos = lower_rec.find(marker)
            if 0 < pos < cutoff:
                cutoff = pos
        rec_text = rec_text[:cutoff]
        rec_lower = rec_text.lower()

        seen_ids = set()

        # Sort cards by name length descending so longer names match first
        # (e.g., "Charizard VMAX" before "Charizard")
        sorted_cards = sorted(
            card_data_by_id.values(),
            key=lambda c: len(c.get("name", "")),
            reverse=True,
        )

        for cdata in sorted_cards:
            name = cdata.get("name", "")
            cid = cdata["card_id"]
            if not name or cid in seen_ids:
                continue
            # Check if the card name appears in the recommendation sections
            if name.lower() in rec_lower:
                seen_ids.add(cid)
                consensus_picks.append(cdata)

        logger.info(
            f"Consensus picks extracted: {len(consensus_picks)} cards matched "
            f"from {len(card_data_by_id)} analyzed (searched recommendation sections only)"
        )

    return {
        "personas": persona_results,
        "consensus": consensus_text,
        "consensus_picks": consensus_picks,
        "market_data_summary": {
            "total_cards": market_data["market_overview"]["total_cards"],
            "avg_price": market_data["market_overview"]["avg_price"],
            "market_cap": market_data["market_overview"]["total_market_cap"],
            "top_gainer": market_data["top_movers"]["gainers"][0]["name"] if market_data["top_movers"].get("gainers") else None,
            "top_loser": market_data["top_movers"]["losers"][0]["name"] if market_data["top_movers"].get("losers") else None,
        },
        "trading_economics": trading_economics_summary,
        "tokens_used": total_tokens,
    }


async def get_card_trader_analysis(db: Session, card_id: int) -> dict:
    """Get trader analysis for a specific card."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"error": "OPENAI_API_KEY not configured."}

    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        return {"error": "Card not found"}

    # Get analysis and price history
    analysis = analyze_card(db, card_id)
    prices = (
        db.query(PriceHistory)
        .filter(PriceHistory.card_id == card_id, PriceHistory.market_price.isnot(None))
        .order_by(asc(PriceHistory.date))
        .all()
    )

    price_data = [{"date": str(p.date), "price": p.market_price} for p in prices[-30:]]

    # Run all strategies
    strategy_results = {}
    for strat_key in STRATEGIES:
        try:
            result = run_backtest(db, card_id, strategy=strat_key, initial_capital=1000)
            if result:
                strategy_results[strat_key] = {
                    "return_pct": result.strategy_return_pct,
                    "buy_hold_return_pct": result.buy_hold_return_pct,
                    "win_rate": result.win_rate,
                    "trades": result.total_trades,
                    "max_drawdown": result.max_drawdown_pct,
                    "sharpe": result.sharpe_ratio,
                }
        except Exception:
            pass

    card_data = {
        "name": card.name,
        "set": card.set_name,
        "rarity": card.rarity,
        "current_price": price_data[-1]["price"] if price_data else None,
        "technical_analysis": analysis.to_dict(),
        "recent_prices": price_data,
        "backtest_results": strategy_results,
    }

    user_prompt = f"""Analyze this specific Pokemon card as a trading opportunity:

## Card Details
{json.dumps(card_data, indent=2)}

Give me a focused trading brief:
1. **Rating**: BUY, SELL, or HOLD with a conviction score (1-10)
2. **Technical Read**: What are the indicators telling us?
3. **Entry/Exit Points**: Where would you buy? Where would you take profit? Where's your stop-loss?
4. **Best Strategy**: Which backtesting strategy works best for this card and why?
5. **Risk Factors**: What could go wrong?

Keep it tight — this is a single-card trade brief, not a dissertation."""

    try:
        result = _call_openai(QUANT_SYSTEM_PROMPT, user_prompt, max_tokens=8192)

        return {
            "trader_name": "Dr. Sarah Chen",
            "card_name": card.name,
            "card_id": card_id,
            "analysis": result["text"],
            "tokens_used": result["tokens_used"],
        }

    except ImportError:
        return {"error": "openai package not installed."}
    except Exception as e:
        logger.error(f"Card trader analysis failed: {e}")
        return {"error": f"Analysis failed: {str(e)}"}


# ══════════════════════════════════════════════════════════════════════════════
# AUTONOMOUS TOOL-USING AGENT
# ══════════════════════════════════════════════════════════════════════════════

AGENT_SYSTEM_PROMPT = """You are the Chief Investment Officer of a Pokemon card trading desk. You have access to tools that let you query market data, analyze individual cards, run backtests, and check your prediction accuracy.

CRITICAL CONTEXT — Pokemon Card Market:
- This is a COLLECTIBLES market. Cards trade on TCGPlayer with significant fees (20-35% breakeven depending on price tier).
- Premium ($100+): ~20-25% breakeven. Blue chip investments, buy-and-hold.
- Mid-high ($50-100): ~25-30% breakeven. Active trading sweet spot.
- Mid ($20-50): ~30-35% breakeven. Need strong momentum or accumulation thesis.
- Cards under $20 are excluded — not viable after fees.

YOUR WORKFLOW:
1. Start by checking your previous picks and accuracy (learn from your track record)
2. Get a market overview to understand current conditions
3. Search for interesting cards across tiers
4. Deep-dive into promising cards (get_card_data, check_sales_velocity)
5. Validate hypotheses with backtests
6. Record insights for notable findings (opportunities, warnings, anomalies)
7. Provide your final analysis with specific picks

FOR EACH PICK, SPECIFY:
- Card name and set
- Signal: BUY / ACCUMULATE / WATCH / HOLD
- Current price and tier
- Entry price, target price, stop-loss
- Thesis (1-2 sentences — why this card?)
- Conviction: high / medium / speculative

Be data-driven. Use your tools to investigate, don't guess. If sales velocity doesn't support a thesis, say so. If a backtest shows a strategy doesn't work for a card, acknowledge it.

{accuracy_context}"""


async def run_agent_analysis(db: Session, model: str = "gpt-5") -> dict:
    """Run the autonomous tool-using agent analysis.

    Uses OpenAI function calling: the agent decides which tools to call,
    investigates the market, and produces picks with supporting data.

    Args:
        db: Database session
        model: OpenAI model to use ("gpt-5" for daily, "gpt-5-mini" for scans)
    """
    import openai

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"error": "OPENAI_API_KEY not configured"}

    from server.services.agent_tools import TOOL_SCHEMAS, execute_tool
    from server.services.prediction_tracker import get_accuracy_report
    from server.models.agent_prediction import AgentPrediction

    # Build accuracy context for system prompt
    accuracy = get_accuracy_report(db)
    accuracy_context = ""
    if accuracy.get("resolved", 0) > 0:
        accuracy_context = f"""
## YOUR TRACK RECORD
- Overall hit rate: {accuracy['overall_hit_rate']}% ({accuracy['resolved']} resolved predictions)
- Pending predictions: {accuracy['pending']}"""
        for persona, stats in accuracy.get("by_persona", {}).items():
            accuracy_context += f"\n- {persona}: {stats['hit_rate']}% ({stats['correct']}/{stats['total']})"
        if accuracy.get("best_pick"):
            bp = accuracy["best_pick"]
            accuracy_context += f"\n- Best pick: {bp['card_name']} ({bp['return_pct_30d']}% in 30d)"
        if accuracy.get("worst_pick"):
            wp = accuracy["worst_pick"]
            accuracy_context += f"\n- Worst pick: {wp['card_name']} ({wp['return_pct_30d']}% in 30d)"
        accuracy_context += "\n\nLearn from your track record. Adjust confidence levels based on what's working."
    else:
        accuracy_context = "## YOUR TRACK RECORD\nNo resolved predictions yet. This is your first analysis — establish your baseline."

    system_prompt = AGENT_SYSTEM_PROMPT.format(accuracy_context=accuracy_context)

    # Initialize conversation
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": (
            "Analyze the current Pokemon card market. "
            "Start by reviewing your previous picks and accuracy, then get a market overview, "
            "investigate interesting opportunities across all price tiers, and provide your "
            "investment recommendations. Record insights for anything notable you find."
        )},
    ]

    client = openai.AsyncOpenAI(api_key=api_key)
    total_input_tokens = 0
    total_output_tokens = 0
    tool_calls_made = 0
    max_rounds = 15

    for round_num in range(max_rounds):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=TOOL_SCHEMAS,
                max_completion_tokens=8192,
            )
        except Exception as e:
            logger.error(f"Agent OpenAI call failed (round {round_num}): {e}")
            return {"error": f"OpenAI API call failed: {str(e)}"}

        total_input_tokens += response.usage.prompt_tokens
        total_output_tokens += response.usage.completion_tokens

        choice = response.choices[0]

        # If the model wants to call tools
        if choice.finish_reason == "tool_calls" or (choice.message.tool_calls and len(choice.message.tool_calls) > 0):
            # Add the assistant message with tool calls
            messages.append(choice.message)

            # Execute each tool call
            for tc in choice.message.tool_calls:
                tool_name = tc.function.name
                try:
                    arguments = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    arguments = {}

                logger.info(f"Agent tool call [{round_num}]: {tool_name}({arguments})")
                result = execute_tool(db, tool_name, arguments)
                tool_calls_made += 1

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })

            continue  # Next round

        # Model finished (no more tool calls) — extract final analysis
        final_text = choice.message.content or ""
        logger.info(
            f"Agent analysis complete: {tool_calls_made} tool calls, "
            f"{total_input_tokens + total_output_tokens} total tokens, "
            f"model={model}"
        )

        # Save as snapshot
        snapshot = TraderAnalysisSnapshot(
            personas_json=json.dumps({"agent": {"model": model, "tool_calls": tool_calls_made}}),
            consensus=final_text,
            consensus_picks_json="[]",
            market_data_summary_json=json.dumps({"source": "agent_tools", "tool_calls": tool_calls_made}),
            tokens_input=total_input_tokens,
            tokens_output=total_output_tokens,
        )
        db.add(snapshot)
        db.commit()

        # Extract picks and create predictions
        from server.routes.trader import _extract_picks_from_consensus, _parse_signal
        picks = _extract_picks_from_consensus(db, final_text)

        # Create predictions for actionable picks
        predictions_created = 0
        for pick in picks:
            if pick.get("signal") not in ("buy", "accumulate"):
                continue
            card = db.query(Card).filter_by(id=pick["card_id"]).first()
            if not card or not card.current_price:
                continue

            prediction = AgentPrediction(
                card_id=card.id,
                snapshot_id=snapshot.id,
                signal=pick["signal"],
                persona_source="agent",
                entry_price=card.current_price,
            )
            db.add(prediction)
            predictions_created += 1

        if predictions_created > 0:
            db.commit()

        return {
            "analysis": final_text,
            "consensus_picks": picks,
            "model": model,
            "tool_calls": tool_calls_made,
            "tokens_used": {
                "input": total_input_tokens,
                "output": total_output_tokens,
            },
            "predictions_created": predictions_created,
            "snapshot_id": snapshot.id,
        }

    # Hit max rounds
    logger.warning(f"Agent hit max rounds ({max_rounds})")
    return {
        "error": f"Agent reached max tool call rounds ({max_rounds})",
        "tool_calls": tool_calls_made,
        "tokens_used": {
            "input": total_input_tokens,
            "output": total_output_tokens,
        },
    }
