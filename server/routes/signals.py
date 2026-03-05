"""Trading signals endpoint — AI-powered BUY/SELL/HOLD signals.

Technical indicators are computed from daily price data, then sent to GPT
to generate intelligent trading signals. No hardcoded rules — the AI
decides based on the full picture.
"""
import json
import logging
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from server.database import get_db
from server.models.card import Card
from server.models.price_history import PriceHistory
from server.services.market_analysis import analyze_card
from server.services.backtesting import run_backtest, STRATEGIES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/signals", tags=["signals"])


def _build_card_indicators(db: Session) -> list[dict]:
    """Compute daily technical indicators for all cards."""
    cards = db.query(Card).filter(Card.current_price.isnot(None)).all()
    results = []

    for card in cards:
        analysis = analyze_card(db, card.id)
        if analysis.rsi_14 is None and analysis.sma_7 is None:
            continue

        price_count = (
            db.query(PriceHistory)
            .filter(PriceHistory.card_id == card.id, PriceHistory.market_price.isnot(None))
            .count()
        )

        entry = {
            "card_id": card.id,
            "name": card.name,
            "set_name": card.set_name,
            "rarity": card.rarity,
            "image_small": card.image_small,
            "current_price": card.current_price,
            "rsi_14": round(analysis.rsi_14, 1) if analysis.rsi_14 else None,
            "sma_7": round(analysis.sma_7, 2) if analysis.sma_7 else None,
            "sma_30": round(analysis.sma_30, 2) if analysis.sma_30 else None,
            "macd_histogram": round(analysis.macd_histogram, 4) if analysis.macd_histogram else None,
            "momentum": round(analysis.momentum, 2) if analysis.momentum else None,
            "price_change_7d": round(analysis.price_change_pct_7d, 2) if analysis.price_change_pct_7d else None,
            "price_change_30d": round(analysis.price_change_pct_30d, 2) if analysis.price_change_pct_30d else None,
            "support": round(analysis.support, 2) if analysis.support else None,
            "resistance": round(analysis.resistance, 2) if analysis.resistance else None,
            "bollinger_position": None,
            "volatility": round(analysis.volatility, 2) if analysis.volatility else None,
            "spread_ratio": round(analysis.spread_ratio, 2) if analysis.spread_ratio else None,
            "activity_score": analysis.activity_score,
            "price_history_days": price_count,
            "can_backtest": price_count >= 35,
        }

        if analysis.bollinger_upper and analysis.bollinger_lower:
            band_range = analysis.bollinger_upper - analysis.bollinger_lower
            if band_range > 0 and card.current_price:
                entry["bollinger_position"] = round(
                    (card.current_price - analysis.bollinger_lower) / band_range, 2
                )

        results.append(entry)

    return results


@router.get("")
def get_indicators(db: Session = Depends(get_db)):
    """Get daily technical indicators for all cards (no AI, instant)."""
    indicators = _build_card_indicators(db)
    return {
        "cards": indicators,
        "total": len(indicators),
        "data_frequency": "daily",
    }


@router.post("/generate")
async def generate_ai_signals(db: Session = Depends(get_db)):
    """Generate AI-powered trading signals using GPT.

    Sends all card technical indicators to GPT-5.4, which decides
    BUY/SELL/HOLD for each card with conviction score and reasoning.
    No hardcoded rules — the AI makes the call.
    """
    import os

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"error": "OPENAI_API_KEY not configured."}

    indicators = _build_card_indicators(db)
    if not indicators:
        return {"error": "No cards with sufficient daily price data."}

    # Build concise data for AI
    card_summaries = []
    for c in indicators:
        card_summaries.append({
            "id": c["card_id"],
            "name": c["name"],
            "set": c["set_name"],
            "rarity": c["rarity"],
            "price": c["current_price"],
            "rsi": c["rsi_14"],
            "sma7": c["sma_7"],
            "sma30": c["sma_30"],
            "macd_hist": c["macd_histogram"],
            "momentum": c["momentum"],
            "chg_7d": c["price_change_7d"],
            "chg_30d": c["price_change_30d"],
            "support": c["support"],
            "resistance": c["resistance"],
            "boll_pos": c["bollinger_position"],
            "volatility": c.get("volatility"),
            "spread": c.get("spread_ratio"),
            "activity": c.get("activity_score"),
            "days": c["price_history_days"],
        })

    system_prompt = """You are Marcus "The Collector" Vega — a veteran Wall Street trader specializing in Pokemon cards and alternative assets. You use technical analysis on DAILY price data to generate trading signals.

You MUST respond with valid JSON only. No markdown, no explanation outside JSON.

For each card, analyze the daily indicators and decide: BUY, SELL, or HOLD.
Consider:
- RSI: oversold/overbought levels, but don't use rigid thresholds — context matters
- SMA alignment: is the short-term trend above/below long-term?
- MACD histogram: momentum direction and strength
- Bollinger position: where is price relative to the bands?
- Momentum: rate of change
- Support/resistance: is price near key levels?
- Price change trends: 7-day and 30-day performance
- Volatility: higher vol = more market interest/activity (proxy for volume)
- Spread ratio: wider bid-ask spread = more active bidding
- Activity score (0-100): composite hotness metric — high scores mean the card is "hot"

Think like a trader, not a textbook. Collectibles have unique dynamics:
- Hype cycles cause sharp spikes — don't chase late
- Mean reversion is strong after panic sells
- Low activity cards can be manipulated — be cautious
- High activity + bullish technicals = strong BUY signal
- High activity + bearish technicals = smart to SELL before the dump
- Rarity drives long-term value

Return JSON array with this exact structure:
[
  {
    "card_id": <int>,
    "signal": "BUY" | "SELL" | "HOLD",
    "conviction": <1-10>,
    "reasoning": "<1-2 sentence explanation>",
    "entry_price": <suggested entry or null>,
    "target_price": <take profit target or null>,
    "stop_loss": <stop loss price or null>,
    "best_strategy": "<which backtest strategy key fits this card>"
  }
]

Available strategy keys: sma_crossover, rsi_mean_reversion, macd_signal, bollinger_bounce, combined, momentum_breakout, mean_reversion_bands, trend_rider"""

    user_prompt = f"""Analyze these Pokemon cards using their daily technical indicators and generate trading signals:

{json.dumps(card_summaries, indent=2)}

Return ONLY a JSON array with your signal for each card. No other text."""

    try:
        import openai

        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-5.4",
            max_tokens=4096,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )

        raw = response.choices[0].message.content.strip()

        # Parse JSON — handle markdown code blocks if GPT wraps it
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        ai_signals = json.loads(raw)

        # Merge AI signals with indicator data
        indicator_map = {c["card_id"]: c for c in indicators}
        merged = []
        for sig in ai_signals:
            card_id = sig.get("card_id")
            ind = indicator_map.get(card_id, {})
            merged.append({
                **ind,
                "signal": sig.get("signal", "HOLD"),
                "conviction": sig.get("conviction", 5),
                "reasoning": sig.get("reasoning", ""),
                "entry_price": sig.get("entry_price"),
                "target_price": sig.get("target_price"),
                "stop_loss": sig.get("stop_loss"),
                "best_strategy": sig.get("best_strategy", "combined"),
            })

        # Sort by conviction (strongest first), BUY first
        signal_order = {"BUY": 0, "SELL": 1, "HOLD": 2}
        merged.sort(key=lambda x: (signal_order.get(x["signal"], 2), -x.get("conviction", 0)))

        buy_count = sum(1 for s in merged if s["signal"] == "BUY")
        sell_count = sum(1 for s in merged if s["signal"] == "SELL")
        hold_count = sum(1 for s in merged if s["signal"] == "HOLD")

        return {
            "signals": merged,
            "summary": {
                "total": len(merged),
                "buy": buy_count,
                "sell": sell_count,
                "hold": hold_count,
            },
            "tokens_used": {
                "input": response.usage.prompt_tokens,
                "output": response.usage.completion_tokens,
            },
        }

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI signals JSON: {e}")
        return {"error": f"AI returned invalid JSON: {str(e)}", "raw": raw[:500]}
    except ImportError:
        return {"error": "openai package not installed."}
    except Exception as e:
        logger.error(f"AI signal generation failed: {e}")
        return {"error": f"Signal generation failed: {str(e)}"}


@router.get("/{card_id}/quick-backtest")
def quick_backtest(
    card_id: int,
    db: Session = Depends(get_db),
):
    """Run all strategies on a card for comparison. Uses daily data only."""
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        return {"error": "Card not found"}

    results = []
    for key, name in STRATEGIES.items():
        result = run_backtest(db, card_id, strategy=key, initial_capital=1000)
        if result:
            results.append({
                "strategy_key": key,
                "strategy_name": name,
                "return_pct": result.strategy_return_pct,
                "buy_hold_return_pct": result.buy_hold_return_pct,
                "alpha": round(result.strategy_return_pct - result.buy_hold_return_pct, 2),
                "win_rate": result.win_rate,
                "total_trades": result.total_trades,
                "max_drawdown_pct": result.max_drawdown_pct,
                "sharpe_ratio": result.sharpe_ratio,
            })

    if not results:
        return {"error": "Not enough daily price history (need 35+ days)"}

    best = max(results, key=lambda r: r["return_pct"])

    return {
        "card_id": card_id,
        "card_name": card.name,
        "strategies": results,
        "best_strategy": best["strategy_key"],
        "best_return_pct": best["return_pct"],
    }
