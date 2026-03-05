"""
AI Trader Agent — Wall Street persona for Pokemon card market analysis.

Uses OpenAI GPT-5.4 to generate market commentary, card recommendations,
and strategy suggestions based on current market data and backtesting results.
"""
import os
import json
import logging
from sqlalchemy.orm import Session
from sqlalchemy import func, asc

from server.models.card import Card
from server.models.price_history import PriceHistory
from server.services.market_analysis import analyze_card, get_top_movers
from server.services.backtesting import run_backtest, run_portfolio_backtest, STRATEGIES

logger = logging.getLogger(__name__)

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


def _gather_market_data(db: Session) -> dict:
    """Collect comprehensive market data for the trader agent."""
    data = {}

    # 1. Market overview
    total_cards = db.query(func.count(Card.id)).scalar() or 0
    cards_with_prices = (
        db.query(func.count(func.distinct(PriceHistory.card_id)))
        .filter(PriceHistory.market_price.isnot(None))
        .scalar()
        or 0
    )

    # Get average price and total market cap
    latest_prices = {}
    all_cards = db.query(Card).all()
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
                "rarity": card.rarity,
                "price": latest.market_price,
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

    # 3. Technical analysis for all cards with sufficient data
    card_analyses = []
    for card_id, info in latest_prices.items():
        analysis = analyze_card(db, card_id)
        if analysis.signal != "hold" or analysis.rsi_14 is not None:
            card_analyses.append({
                "card_id": card_id,
                "name": info["name"],
                "set": info["set_name"],
                "rarity": info["rarity"],
                "current_price": info["price"],
                "rsi": round(analysis.rsi_14, 1) if analysis.rsi_14 else None,
                "macd_histogram": round(analysis.macd_histogram, 4) if analysis.macd_histogram else None,
                "sma_7": round(analysis.sma_7, 2) if analysis.sma_7 else None,
                "sma_30": round(analysis.sma_30, 2) if analysis.sma_30 else None,
                "bollinger_position": None,
                "momentum": round(analysis.momentum, 2) if analysis.momentum else None,
                "signal": analysis.signal,
                "signal_strength": round(analysis.signal_strength, 2),
                "support": round(analysis.support, 2) if analysis.support else None,
                "resistance": round(analysis.resistance, 2) if analysis.resistance else None,
                "price_change_7d": round(analysis.price_change_pct_7d, 2) if analysis.price_change_pct_7d else None,
                "price_change_30d": round(analysis.price_change_pct_30d, 2) if analysis.price_change_pct_30d else None,
            })
            # Calculate Bollinger position
            if analysis.bollinger_upper and analysis.bollinger_lower:
                band_range = analysis.bollinger_upper - analysis.bollinger_lower
                if band_range > 0:
                    card_analyses[-1]["bollinger_position"] = round(
                        (info["price"] - analysis.bollinger_lower) / band_range, 2
                    )

    data["card_analyses"] = sorted(card_analyses, key=lambda x: abs(x.get("signal_strength", 0)), reverse=True)

    # 4. Backtest results — portfolio with combined strategy
    try:
        portfolio_result = run_portfolio_backtest(db, strategy="combined", top_n=10, initial_capital=10000)
        data["portfolio_backtest"] = portfolio_result
    except Exception as e:
        logger.warning(f"Portfolio backtest failed: {e}")
        data["portfolio_backtest"] = {"error": str(e)}

    # 5. Strategy comparison for top cards
    strategy_comparison = []
    top_card_ids = [a["card_id"] for a in card_analyses[:5]]
    for card_id in top_card_ids:
        card_strats = {}
        for strat_key in STRATEGIES:
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

    return data


def _call_openai(system: str, user_message: str, max_tokens: int = 4096) -> dict:
    """Call OpenAI GPT-5.4 API and return response text + usage."""
    import openai

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not configured")

    client = openai.OpenAI(api_key=api_key)

    response = client.chat.completions.create(
        model="gpt-5.4",
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ],
    )

    choice = response.choices[0]
    return {
        "text": choice.message.content,
        "tokens_used": {
            "input": response.usage.prompt_tokens,
            "output": response.usage.completion_tokens,
        },
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

## Technical Analysis (All Cards)
{json.dumps(market_data['card_analyses'], indent=2)}

## Portfolio Backtest (Combined Strategy, $10K, Top 10 Cards)
{json.dumps(market_data['portfolio_backtest'], indent=2)}

## Strategy Comparison (Top 5 Cards x All Strategies)
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
        result = _call_openai(TRADER_SYSTEM_PROMPT, user_prompt, max_tokens=4096)

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
        result = _call_openai(TRADER_SYSTEM_PROMPT, user_prompt, max_tokens=2048)

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
