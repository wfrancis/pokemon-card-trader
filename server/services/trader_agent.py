"""
AI Trader Agent — Multi-persona Wall Street trading desk for Pokemon card market analysis.

Uses OpenAI GPT-5.4 with three specialized trader personas (Quant, Hedge Fund PM,
Liquidity Trader) running in parallel, plus a consensus CIO synthesis.
"""
import os
import json
import logging
import asyncio
from sqlalchemy.orm import Session
from sqlalchemy import func, asc

from server.models.card import Card
from server.models.price_history import PriceHistory
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
- Sales velocity (transactions/month) is the primary liquidity signal — not price chart patterns
- Market price vs median sale price spread reveals stale/inflated pricing vs actual executable levels
- Cross-sectional value analysis: compare cards within the same set, rarity tier, or character franchise
- Scarcity modeling: vintage cards have fixed supply (no reprints), modern cards have elastic supply — this fundamentally changes valuation
- Regime detection from FLOW data: rising sales velocity = risk-on, declining velocity = risk-off
- Position sizing based on exit liquidity (can you sell 3 copies in 30 days?)

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
- Top-down thesis: WHERE in the Pokemon timeline should capital be deployed? Vintage WOTC? Modern competitive? Mid-era nostalgia?
- Every position needs a CATALYST — not a technical indicator. What event changes the price in the next 30-90 days?
- Reprint risk is the #1 risk for modern cards — vintage cards can NEVER be reprinted
- Think in terms of CHARACTER FRANCHISES: "Charizard exposure" across sets, "Eeveelution basket," "Gen 1 nostalgia" as themes
- Portfolio construction: diversify across eras, character IPs, and rarity tiers — not just different card names
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
- Sales velocity (sales_90d, sales_30d) is the #1 metric — more important than any price indicator
- Market vs median sale spread reveals execution reality: tight spread = liquid, wide spread = paper gains
- Exit quality assessment: for every card you'd buy, ask "can I sell 3 copies within 30 days at a reasonable price?"
- Cards with 0 sales in 90 days are UNTRADEABLE regardless of what the price chart says
- Seasonal patterns: holiday gift-buying (Nov-Dec), tax refund season (Feb-Mar), summer convention spikes
- Condition mix in sales data tells you WHO is buying: NM-only buyers are collectors (premium), LP/MP buyers are players (volume)

Communication:
- Ground EVERYTHING in actual sales data, not chart patterns or listed prices
- Distinguish between "screen price" (what TCGPlayer shows) and "executable price" (what people actually pay)
- Flag every recommendation's exit liquidity — can you get out?
- Use flow trading terminology applied to collectibles: "paper market," "real prints," "marked-to-myth"
- Call out cards that look good on paper but have no real volume"""

CONSENSUS_SYSTEM_PROMPT = """You are the Chief Investment Officer synthesizing input from three specialized traders on your Pokemon card trading desk. Your job is to cut through the noise and deliver actionable intelligence.

Focus on:
1. Where all three agree — these are HIGH CONVICTION calls. Especially powerful when the quant's data, the PM's thesis, and the liquidity trader's flow all align.
2. Where they disagree — flag the debate and pick a side. The liquidity trader's objections should carry extra weight (no point buying what you can't sell).
3. DATA QUALITY — flag any recommendations based on thin data, stale prices, or cards with zero actual sales.
4. The final TOP 3 actionable trades with entry price range, target, stop-loss, AND expected time to fill (based on sales velocity).
5. Overall market regime: bull/bear/neutral based on FLOW (sales data), not chart patterns.

IMPORTANT: If the data shows most cards have zero or very few actual sales, say so directly. Don't pretend there's a liquid market when the sales data says otherwise. Intellectual honesty is more valuable than confident-sounding bullshit.

Be concise. Executive summary — 400 words max. Bullet points. Clear action list at the end."""

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
    latest_prices = {}
    all_cards = db.query(Card).filter(Card.is_tracked == True).all()
    card_lookup = {c.id: c for c in all_cards}
    for card in all_cards:
        latest = (
            db.query(PriceHistory)
            .filter(PriceHistory.card_id == card.id, PriceHistory.market_price.isnot(None))
            .order_by(PriceHistory.date.desc())
            .first()
        )
        if latest:
            latest_prices[card.id] = {
                "name": card.name,
                "set_name": card.set_name,
                "set_id": card.set_id,
                "rarity": card.rarity,
                "price": latest.market_price,
                "variant": card.price_variant,
                "date": str(latest.date),
            }

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

    # 3. Technical analysis — now includes regime, volatility, confidence, spread
    card_analyses = []
    for card_id, info in latest_prices.items():
        analysis = analyze_card(db, card_id)
        if analysis.signal != "hold" or analysis.rsi_14 is not None:
            entry = {
                "card_id": card_id,
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

    data["card_analyses"] = sorted(card_analyses, key=lambda x: abs(x.get("signal_strength", 0)), reverse=True)[:15]

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

    # 5. Strategy comparison for top cards (top 3 cards x 3 strategies)
    strategy_comparison = []
    top_card_ids = [a["card_id"] for a in card_analyses[:3]]
    top_strategies = ["sma_crossover", "bollinger_bounce", "macd_signal"]
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

        # Per-card sales volume for analyzed cards (top 15)
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

    # 8. NEW: Set-level analysis (aggregated by set)
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

        # Set concentration in top 15 cards (correlation risk)
        set_counts = {}
        for a in data["card_analyses"]:
            s = a.get("set", "Unknown")
            set_counts[s] = set_counts.get(s, 0) + 1
        data["concentration_risk"] = {
            "top_15_set_distribution": set_counts,
            "max_single_set_exposure": max(set_counts.values()) if set_counts else 0,
            "warning": "HIGH" if max(set_counts.values(), default=0) >= 5 else "LOW",
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


def _build_persona_prompt(persona_id: str, market_data: dict) -> str:
    """Build persona-specific user prompt from shared market data."""
    base = f"""Here's the current Pokemon card market data from our trading platform.

## Market Overview
{json.dumps(market_data['market_overview'], indent=2)}

## Top Movers (Gainers & Losers)
{json.dumps(market_data['top_movers'], indent=2)}

## Technical Analysis (Top 15 Cards by Signal Strength)
NOTE: Each card now includes regime detection, volatility, spread_ratio, activity_score, data_confidence, and data_flags (quality warnings like EXTREME_MA_DIVERGENCE, LOW_DATA, LOW_CONFIDENCE).
{json.dumps(market_data['card_analyses'], indent=2)}

## Portfolio Backtest Summary (Combined Strategy, $10K, Top 10 Cards)
NOTE: Sharpe ratios now computed from in-position returns only (excluding flat cash days). Negative-return strategies always have negative Sharpe. Combined strategy threshold lowered from 0.3 to 0.15 to generate more trades.
{json.dumps(market_data['portfolio_backtest'], indent=2)}

## Strategy Comparison (Top 3 Cards x 3 Strategies)
{json.dumps(market_data['strategy_comparison'], indent=2)}

## Available Trading Strategies
{json.dumps(market_data['available_strategies'], indent=2)}

## Sales / Liquidity Data (TCGPlayer completed transactions)
{json.dumps(market_data.get('sales_liquidity', {}), indent=2)}

## Set-Level Analysis (Top 10 Sets by Market Cap)
{json.dumps(market_data.get('set_analysis', []), indent=2)}

## Concentration Risk (Set distribution in top 15 analyzed cards)
{json.dumps(market_data.get('concentration_risk', {}), indent=2)}
"""

    if persona_id == "quant":
        return base + """
Give me your quantitative analysis:
1. **Regime Detection** — Use the per-card regime field and cross-sectional dispersion to classify the market. What does realized vol tell us?
2. **Factor Exposure** — Which factors (momentum, value, quality, liquidity) are driving returns? Use the activity_score and volatility data.
3. **Data Quality Audit** — Flag any cards with data_flags warnings. Are the price-to-MA divergences real or data artifacts? Which cards have LOW_DATA or LOW_CONFIDENCE?
4. **Top Picks** — Your top 3-5 cards ranked by risk-adjusted expected return. Use the corrected Sharpe ratios.
5. **Strategy Optimization** — The combined strategy threshold was lowered from 0.3 to 0.15. Does the new backtest output show improved trade counts? What further tuning is needed?
6. **Position Sizing** — Vol-adjusted sizing using the per-card volatility field and Kelly criterion.
7. **Red Flags** — Cards where signal-to-noise ratio is too low. Flag any Sharpe/return inconsistencies.

Show your work. Reference the numbers."""

    elif persona_id == "pm":
        return base + """
Give me your portfolio manager's view:
1. **Macro Thesis** — Where are we in the Pokemon card market cycle? Use the set-level analysis for sector rotation insights.
2. **Set Rotation** — Which sets are the most/least valuable? Use the set market cap data and concentration risk assessment.
3. **Catalyst Map** — What events (set releases, rotations, tournaments, nostalgia cycles) could move prices in the next 30-90 days?
4. **Top Picks** — Your top 3-5 card recommendations as portfolio positions with conviction levels. Factor in the sales liquidity data — can you actually build the position?
5. **Long/Short Pairs** — Use set-level analysis to find intra-set divergences. Long undervalued vintage, short overhyped modern?
6. **Portfolio Construction** — Build a 10-card portfolio. Use concentration_risk data to avoid over-indexing any single set. Core vs trading positions?
7. **Correlation Risk** — The concentration risk data shows set distribution in the top 15. Which sets are over-represented?

Think like you're presenting to your LPs."""

    else:  # liquidity
        return base + """
Give me your liquidity read:
1. **Flow Assessment** — Use the sales_liquidity data. How many actual completed transactions? Is money flowing in or out? What's the sales velocity?
2. **Market vs Median Spread** — Compare market_price to median_sale_price for each card with sales data. Which cards have a wide spread (market price >> median sale = stale/inflated pricing)? Which are tight (liquid, efficient)?
3. **Liquidity Map** — Which cards have real volume (sales_90d > 5) vs paper gains (zero sales)? Flag liquidity traps where price moves aren't backed by transactions.
4. **Top Picks** — Your top 3-5 tradeable cards — must have actual sales volume to enter AND exit. Use the sales data to validate.
5. **Execution Strategy** — Use the condition breakdown in sales data. Best variants to trade? Timing patterns?
6. **Risk-On/Risk-Off** — Use the spread_ratio, activity_score, and sales velocity to classify the regime. Is flow bullish or bearish?
7. **Exit Quality** — For each top pick, estimate how easy it is to sell 2-3 copies based on sales_90d data.

Keep it practical. I need to actually trade these, not just look at them."""


async def get_multi_persona_analysis(db: Session) -> dict:
    """Generate analysis from 3 trader personas in parallel, then synthesize consensus.

    Returns: {personas: {quant, pm, liquidity}, consensus, market_data_summary, tokens_used}
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"error": "OPENAI_API_KEY not configured. Set it to enable the AI trading desk."}

    # Gather market data ONCE
    market_data = _gather_market_data(db)

    # Build persona-specific prompts
    persona_tasks = {}
    for pid, persona in PERSONAS.items():
        user_prompt = _build_persona_prompt(pid, market_data)
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
        consensus_prompt = f"""Here are the analyses from your three desk traders:

{chr(10).join(analyses_for_consensus)}

Synthesize their views into an executive summary. Where do they agree (high conviction)? Where do they disagree (flag the debate)? Give me the final TOP 3 actionable trades."""

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

    return {
        "personas": persona_results,
        "consensus": consensus_text,
        "market_data_summary": {
            "total_cards": market_data["market_overview"]["total_cards"],
            "avg_price": market_data["market_overview"]["avg_price"],
            "market_cap": market_data["market_overview"]["total_market_cap"],
            "top_gainer": market_data["top_movers"]["gainers"][0]["name"] if market_data["top_movers"].get("gainers") else None,
            "top_loser": market_data["top_movers"]["losers"][0]["name"] if market_data["top_movers"].get("losers") else None,
        },
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

## Technical Analysis (Top 15 Cards by Signal Strength)
{json.dumps(market_data['card_analyses'], indent=2)}

## Portfolio Backtest Summary (Combined Strategy, $10K, Top 10 Cards)
{json.dumps(market_data['portfolio_backtest'], indent=2)}

## Strategy Comparison (Top 3 Cards x 3 Strategies)
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
