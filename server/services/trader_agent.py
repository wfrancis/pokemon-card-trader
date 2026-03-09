"""
AI Trader Agent — Multi-persona Wall Street trading desk for Pokemon card market analysis.

Uses OpenAI GPT-5.4 with three specialized trader personas (Quant, Hedge Fund PM,
Liquidity Trader) running in parallel, plus a consensus CIO synthesis.
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

# ── Legacy Marcus persona (kept for backward compat) ──────────────────────────

TRADER_SYSTEM_PROMPT = """You are Marcus "The Collector" Vega — a veteran Wall Street trader who spent 15 years at Goldman Sachs trading exotic derivatives and alternative assets before pivoting to the collectibles market. You now run a boutique fund specializing in Pokemon cards, sports memorabilia, and other alternative investments.

Your trading philosophy:
- You treat Pokemon cards exactly like any other financial instrument: driven by supply/demand, sentiment, and technical patterns
- You've seen the parallels between collectibles and commodities — limited supply assets that trade on hype cycles, seasonal demand, and scarcity premiums
- You use the same technical analysis toolkit (SMA, EMA, RSI, MACD, Bollinger Bands) you used on Wall Street
- You understand that collectibles have unique dynamics: set rotations, tournament meta shifts, nostalgia cycles, and print run scarcity
- You're risk-conscious — you always size positions, set stop-losses, and diversify across sets/eras

Your communication style:
- Direct and confident, like you're briefing your trading desk
- Use trading jargon naturally (alpha, drawdown, Sharpe ratio, mean reversion, momentum)
- Reference your Wall Street experience when drawing parallels
- Give specific, actionable advice — not vague generalities
- Always quantify risk and potential return
- Format with clear sections and bullet points

When analyzing the market data provided, you should:
1. Give a market overview — is the Pokemon card market bullish, bearish, or consolidating?
2. Identify your top 3-5 card picks with buy/sell/hold ratings and specific reasoning
3. Flag any cards showing dangerous technical patterns (potential crashes)
4. Recommend specific trading strategies suited to the current market conditions
5. Suggest improvements to the backtesting engine and new strategies that would work for collectibles
6. Assess overall portfolio risk and suggest position sizing

Remember: you're talking to fellow traders who understand the terminology. Don't dumb it down."""

# ── Three Specialized Trader Personas ──────────────────────────────────────────

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

Communication:
- Lead with sales data, flow metrics, and supply analysis — NOT RSI/MACD
- Express confidence as probability ranges with explicit sample size caveats
- Flag when data is insufficient for reliable conclusions
- Use quant terminology but applied to collectibles: scarcity premium, liquidity discount, flow momentum
- Tables with specific numbers wherever possible"""

PM_SYSTEM_PROMPT = """You are James "Jamie" Blackwood — a hedge fund portfolio manager who ran a $2B long/short equity book at Viking Global for 8 years before launching your own collectibles-focused fund. You think in portfolio construction, catalysts, and asymmetric risk/reward setups.

CRITICAL CONTEXT — this is a COLLECTIBLES market, not equities:
- Forget technical analysis as a primary signal. Pokemon card prices are driven by: nostalgia cycles, YouTube/social media attention, tournament meta shifts, sealed product scarcity, reprint risk, and generational collector demographics.
- The REAL catalysts are: new set releases cannibalizing older sets, Standard rotation removing playable demand, Pokemon anime/movie announcements, influencer box-opening events, grading service backlogs, and seasonal gift-buying patterns.
- You have SET-LEVEL ANALYSIS data — use it to identify sector rotation (money moving between sets/eras).
- You have CONCENTRATION RISK data — check if the top picks are all from the same set (correlation trap).
- Vintage (WOTC era) cards are like fine art — fixed supply, driven by nostalgia and collector prestige. Modern cards are like consumer goods — elastic supply, driven by playability and hype cycles.

Your portfolio management philosophy:
- FEES VARY BY TIER: Premium ($100+) has manageable ~20-25% breakeven — invest like blue chips. Mid-high ($50-100) needs 25-30% appreciation — catalyst-driven trades. Mid ($20-50) needs 30-35% — momentum or accumulation plays.
- Build a PORTFOLIO ACROSS ALL TIERS. Allocate: ~45% core (premium), ~30% active (mid-high), ~15% growth (mid), ~10% cash.
- You are seeing the COMPLETE $20+ tradeable universe — every card worth trading. No cards were pre-filtered by scoring. Analyze them ALL.
- Top-down thesis: WHERE in the Pokemon timeline should capital be deployed? Vintage WOTC? Modern competitive? Mid-era nostalgia?
- Every mid-high position needs a CATALYST. Premium positions can rely on secular appreciation. Mid positions need momentum or accumulation thesis.
- Reprint risk is the #1 risk for modern cards — vintage cards can NEVER be reprinted
- Think in terms of CHARACTER FRANCHISES: "Charizard exposure" across sets, "Eeveelution basket," "Gen 1 nostalgia" as themes
- Use hold_economics data: different hold periods work for different tiers. Don't apply the same 6-month hold to every card.
- Use the set-level market cap data to identify which sets are overvalued vs undervalued as a group

Communication:
- Speak like you're presenting to LPs who understand collectibles
- Focus on catalysts, supply dynamics, and collector psychology — not chart patterns
- Give conviction levels with reasoning tied to real-world events, not indicators
- Always discuss reprint risk and supply elasticity for every recommendation"""

LIQUIDITY_SYSTEM_PROMPT = """You are Kai Nakamura — a liquidity trader who spent 10 years on Goldman Sachs' flow trading desk, specializing in illiquid and exotic instruments. You now apply market microstructure expertise to Pokemon cards, where liquidity is everything.

CRITICAL CONTEXT — this is a COLLECTIBLES market, not equities:
- There is NO order book, NO market maker, NO continuous trading. Pokemon cards sell through TCGPlayer listings and eBay auctions. "Liquidity" means: can you actually BUY and SELL at the displayed price?
- You have REAL SALES DATA — actual completed TCGPlayer transactions with prices, dates, conditions, and volume counts. This is your primary dataset.
- The spread between "market price" (TCGPlayer's listed price) and "median sale price" (what people actually paid) tells you EVERYTHING about a card's real liquidity. Wide spread = stale pricing, thin market, execution risk.
- Cards with zero recent sales but a displayed "market price" are MARKED-TO-MYTH — the price is fictional until someone actually buys at that level.
- Condition matters enormously: Near Mint trades at a premium with better liquidity. Lightly Played / Moderately Played may sit for weeks.

Your liquidity trading framework:
- FEES SCALE WITH PRICE: Premium ($100+) ~20-25% breakeven = highly tradeable. Mid-high ($50-100) ~25-30% = tradeable with discipline. Mid ($20-50) ~30-35% = viable for momentum/accumulation. Sub-$20 excluded (not worth after fees).
- You are seeing the COMPLETE $20+ tradeable universe. Every card here clears the minimum trade threshold. Analyze ALL of them for liquidity.
- Sales velocity (sales_90d, sales_30d) is the #1 metric — more important than any price indicator
- Market vs median sale spread reveals execution reality: tight spread = liquid, wide spread = paper gains
- Exit quality varies by tier: premium needs "can I sell 1 copy in 30 days?", mid-high needs "can I sell 2 copies?", mid needs "is volume sufficient?"
- Cards with 0 sales in 90 days are ILLIQUID — flag but don't auto-reject if price trend is strong
- Time-to-sell is a hidden cost: every day you hold is opportunity cost + market risk. Use est_time_to_sell_days.
- Seasonal patterns: holiday gift-buying (Nov-Dec), tax refund season (Feb-Mar), summer convention spikes
- Condition mix in sales data tells you WHO is buying: NM-only buyers are collectors (premium), LP/MP buyers are players (volume)

Communication:
- Ground EVERYTHING in actual sales data, not chart patterns or listed prices
- Distinguish between "screen price" (what TCGPlayer shows) and "executable price" (what people actually pay)
- Flag every recommendation's exit liquidity — can you get out?
- Use flow trading terminology applied to collectibles: "paper market," "real prints," "marked-to-myth"
- Call out cards that look good on paper but have no real volume"""

CONSENSUS_SYSTEM_PROMPT = """You are the Chief Investment Officer synthesizing input from three specialized traders on your Pokemon card trading desk. Your traders analyzed the COMPLETE $20+ tradeable universe — every card worth trading. Your job is to deliver a COMPREHENSIVE, ACTIONABLE portfolio from this full dataset.

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
High-conviction calls (all 3 traders agree) vs debates.

## 4. KEY RISKS
Top 3 risks to the portfolio.

## 5. THE HONEST ANSWER
Is this market tradeable? What annual net return is realistic across tiers?

Be specific. Use numbers. 800 words max."""

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
    "pm": {
        "id": "pm",
        "name": 'James "Jamie" Blackwood',
        "title": "HEDGE FUND PM",
        "subtitle": "Ex-Viking Global · $2B Long/Short · Collectibles Fund",
        "color": "#ffd700",
        "badges": ["CATALYSTS", "SUPPLY DYNAMICS", "SET ROTATION"],
        "system_prompt": PM_SYSTEM_PROMPT,
    },
    "liquidity": {
        "id": "liquidity",
        "name": "Kai Nakamura",
        "title": "LIQUIDITY TRADER",
        "subtitle": "Ex-Goldman Sachs · Flow Trading · Market Microstructure",
        "color": "#ff9800",
        "badges": ["REAL SALES DATA", "EXIT LIQUIDITY", "EXECUTION"],
        "system_prompt": LIQUIDITY_SYSTEM_PROMPT,
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

    elif persona_id == "pm":
        return base + """
Give me your portfolio construction — you have the COMPLETE $20+ tradeable universe. Build the best portfolio from ALL available cards.

## PORTFOLIO CONSTRUCTION BY TIER

### CORE HOLDINGS — Premium ($100+): 3-5 positions, 45% of capital
These are your "blue chip" positions. Vintage WOTC cards with fixed supply, strong nostalgia demand, proven price floors. Hold 6-12+ months. Fee impact is manageable at this price point (~20-25% breakeven). Focus on: character IP strength (Charizard, Dragonite, Mewtwo), set prestige (Base Set, Fossil, Team Rocket), long-term appreciation trend from hold_economics.

### ACTIVE BOOK — Mid-High ($50-100): 3-5 positions, 30% of capital
This is where CATALYSTS matter. What events could drive 30-50% moves? New set releases, anime announcements, tournament meta shifts. Each pick needs: (a) specific catalyst thesis, (b) timeline, (c) target above breakeven_pct. Hold 3-6 months.

### GROWTH PLAYS — Mid ($20-50): 3-5 positions, 15% of capital
Viable trades with higher fee friction (~30-35% breakeven). Look for: momentum breakouts, cards approaching the $50 tier, high sales velocity proving real demand. Hold 1-3 months or accumulate.

### CASH RESERVE — 10% of capital
Dry powder for opportunities.

## THEMATIC EXPOSURES
- **Character Franchises**: What character IPs should we be overweight? (Charizard, Eeveelutions, Pikachu, etc.)
- **Era Allocation**: Vintage WOTC vs mid-era ex/DP vs modern V/VMAX — where's the best risk-adjusted return?
- **Set Rotation**: Which sets are gaining value? Which are losing?

## RISK MANAGEMENT
- Concentration limits per set/era
- Fee-adjusted net P&L target for each tier
- Exit rules per tier (stop-loss, take-profit)

Give me a complete portfolio of 10-15 cards across tiers with allocation percentages."""

    else:  # liquidity
        return base + """
Give me your liquidity analysis — you have the COMPLETE $20+ tradeable universe. Analyze ALL of them for liquidity.

## LIQUIDITY LANDSCAPE BY TIER

### PREMIUM ($100+)
Lower volume but wide margins per trade. Use liquidity_score and est_time_to_sell_days. Which premium cards can you actually EXIT within 30 days? What's the typical bid-ask spread? Flag any "marked-to-myth" cards (high listed price, zero recent sales).

### MID-HIGH ($50-100)
The sweet spot for volume AND viability. Which cards have the tightest market-vs-median-sale spread? Rank by: (a) liquidity_score, (b) sales velocity, (c) spread tightness. This tier should have the most tradeable cards — identify them.

### MID ($20-50)
Higher fee friction but often decent volume. Which cards have exceptional liquidity (sales_90d > 20)? These are your "flow names" — the market is actively trading them. Cards here with strong momentum could graduate to mid_high.

### MARKET MICROSTRUCTURE
- **Execution quality**: For cards with sales data, how close are market prices to actual sale prices? Cards with >10% market-vs-median spread have STALE PRICING — the listed price is fiction.
- **Volume trends**: Are sales accelerating or decelerating across tiers? Use sales_30d vs sales_90d ratios.
- **Seasonal patterns**: Based on sales timestamps, any time-of-year patterns in volume?

## TOP PICKS — TRADEABLE CARDS (8-12 picks across tiers)
For each pick, provide:
- Price, tier, liquidity_score, est_time_to_sell
- Why it's tradeable (volume, tight spread, recent sales proving price)
- Recommended approach: (a) active trade (buy now, sell on catalyst), (b) accumulate (buy on dips, hold), (c) watchlist (wait for entry)

## FLOW SIGNALS
- Which cards are seeing UNUSUAL volume? (sales acceleration)
- Any cards transitioning tiers? (mid → mid_high = growing value, mid_high → premium = breakout)
- Where is the smart money going? (premium cards with sudden volume = institutional collector)

Give me 8-12 tradeable picks plus 3-5 watchlist cards. Be specific about entry, exit, and liquidity risk."""


async def get_multi_persona_analysis(db: Session) -> dict:
    """Generate analysis from 3 trader personas in parallel, then synthesize consensus.

    Returns: {personas: {quant, pm, liquidity}, consensus, market_data_summary, tokens_used}
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

    # Run all 3 persona calls in parallel
    try:
        results = await asyncio.gather(
            persona_tasks["quant"],
            persona_tasks["pm"],
            persona_tasks["liquidity"],
            return_exceptions=True,
        )
    except Exception as e:
        logger.error(f"Multi-persona analysis failed: {e}")
        return {"error": f"Analysis failed: {str(e)}"}

    # Process results
    persona_results = {}
    total_tokens = {"input": 0, "output": 0}
    analyses_for_consensus = []

    for pid, result in zip(["quant", "pm", "liquidity"], results):
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

        consensus_prompt = f"""Here are the analyses from your three desk traders:

{chr(10).join(analyses_for_consensus)}
{prev_context}
They analyzed the COMPLETE $20+ tradeable universe. Synthesize into a COMPREHENSIVE portfolio:
- 12-18 picks organized by tier (Core Holdings $100+, Active Trades $50-100, Growth Plays $20-50, Watchlist)
- Where do they agree (high conviction)? Where do they disagree?
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

    # Extract consensus picks by matching prices in the consensus text
    consensus_picks = []
    if consensus_text:
        # Build price -> card_id lookup (price formatted to 2 decimals)
        price_to_id = {}
        for cid, cdata in card_data_by_id.items():
            price = cdata.get("current_price")
            if price:
                key = f"{price:.2f}"
                price_to_id[key] = cid

        # Find all dollar amounts in consensus text (e.g., $525.82, $1,090.00)
        seen_ids = set()
        for match in re.finditer(r'\$[\d,]+\.\d{2}', consensus_text):
            price_str = match.group().lstrip('$').replace(',', '')
            if price_str in price_to_id:
                cid = price_to_id[price_str]
                if cid not in seen_ids:
                    seen_ids.add(cid)
                    consensus_picks.append(card_data_by_id[cid])

        logger.info(
            f"Consensus picks extracted: {len(consensus_picks)} cards matched "
            f"from {len(card_data_by_id)} analyzed"
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


async def get_trader_analysis(db: Session) -> dict:
    """Generate AI trader analysis using OpenAI GPT-5.4.

    Returns a dict with the trader's analysis sections.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {
            "error": "OPENAI_API_KEY not configured. Set it to enable the AI trader agent.",
            "trader_name": "Marcus 'The Collector' Vega",
        }

    # Gather all market data
    market_data = _gather_market_data(db)

    # Build the prompt
    user_prompt = f"""Here's the current Pokemon card market data from our trading platform. Give me your full analysis.

## Market Overview
{json.dumps(market_data['market_overview'], indent=2)}

## Top Movers (Gainers & Losers)
{json.dumps(market_data['top_movers'], indent=2)}

## Technical Analysis (ALL {len(market_data['card_analyses'])} Viable Cards — $20+ Universe)
{json.dumps([{k: v for k, v in c.items() if k != 'image_small'} for c in market_data['card_analyses']], indent=2)}

## Portfolio Backtest Summary (Combined Strategy, $10K, Top 10 Cards)
{json.dumps(market_data['portfolio_backtest'], indent=2)}

## Strategy Comparison (Top 5 Cards x 3 Strategies)
{json.dumps(market_data['strategy_comparison'], indent=2)}

## Available Trading Strategies
{json.dumps(market_data['available_strategies'], indent=2)}

Give me your complete analysis covering:
1. **Market Commentary** — What's the current state of this market? Bull, bear, or sideways?
2. **Top Picks** — Your top 3-5 card recommendations with BUY/SELL/HOLD ratings
3. **Danger Zone** — Any cards showing concerning technical patterns
4. **Strategy Recommendations** — Which strategies work best for this market? Any collectibles-specific strategies you'd add?
5. **Backtesting Improvements** — What new strategies or indicators should we add to our backtesting engine?
6. **Risk Assessment** — Position sizing, portfolio construction, and risk management advice

Be specific. Reference the actual numbers. This is a trading desk briefing, not a blog post."""

    try:
        result = _call_openai(TRADER_SYSTEM_PROMPT, user_prompt, max_tokens=16384)

        return {
            "trader_name": "Marcus 'The Collector' Vega",
            "analysis": result["text"],
            "market_data_summary": {
                "total_cards": market_data["market_overview"]["total_cards"],
                "avg_price": market_data["market_overview"]["avg_price"],
                "market_cap": market_data["market_overview"]["total_market_cap"],
                "top_gainer": market_data["top_movers"]["gainers"][0]["name"] if market_data["top_movers"].get("gainers") else None,
                "top_loser": market_data["top_movers"]["losers"][0]["name"] if market_data["top_movers"].get("losers") else None,
            },
            "tokens_used": result["tokens_used"],
        }

    except ImportError:
        return {
            "error": "openai package not installed. Run: pip install openai",
            "trader_name": "Marcus 'The Collector' Vega",
        }
    except Exception as e:
        logger.error(f"Trader agent failed: {e}")
        return {
            "error": f"Trader analysis failed: {str(e)}",
            "trader_name": "Marcus 'The Collector' Vega",
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
        result = _call_openai(TRADER_SYSTEM_PROMPT, user_prompt, max_tokens=8192)

        return {
            "trader_name": "Marcus 'The Collector' Vega",
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
