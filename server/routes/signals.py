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


def _build_card_indicators(db: Session, max_cards: int = 100) -> list[dict]:
    """Compute daily technical indicators for top cards by activity.

    Limits analysis to cards with sufficient price history to avoid
    scanning all 14K+ cards (which would timeout).
    """
    from sqlalchemy import func, desc

    # Pre-filter: only cards with 10+ price records, ranked by record count
    card_ids_with_counts = (
        db.query(
            PriceHistory.card_id,
            func.count(PriceHistory.id).label("cnt"),
        )
        .filter(PriceHistory.market_price.isnot(None))
        .group_by(PriceHistory.card_id)
        .having(func.count(PriceHistory.id) >= 10)
        .order_by(desc("cnt"))
        .limit(max_cards)
        .all()
    )

    results = []

    for row in card_ids_with_counts:
        card = db.query(Card).filter(Card.id == row.card_id).first()
        if not card or not card.current_price:
            continue

        analysis = analyze_card(db, row.card_id)
        if analysis.rsi_14 is None and analysis.sma_7 is None:
            continue

        price_count = row.cnt

        def _r(val, d=2):
            return round(val, d) if val is not None else None

        entry = {
            "card_id": card.id,
            "name": card.name,
            "set_name": card.set_name,
            "rarity": card.rarity,
            "image_small": card.image_small,
            "current_price": card.current_price,
            # Moving averages
            "sma_7": _r(analysis.sma_7),
            "sma_30": _r(analysis.sma_30),
            "sma_90": _r(analysis.sma_90),
            "sma_200": _r(analysis.sma_200),
            "ema_12": _r(analysis.ema_12),
            "ema_26": _r(analysis.ema_26),
            "ema_50": _r(analysis.ema_50),
            # Oscillators
            "rsi_14": _r(analysis.rsi_14, 1),
            "macd_histogram": _r(analysis.macd_histogram, 4),
            "momentum": _r(analysis.momentum),
            # Price changes — multi-timeframe
            "price_change_7d": _r(analysis.price_change_pct_7d),
            "price_change_30d": _r(analysis.price_change_pct_30d),
            "price_change_90d": _r(analysis.price_change_pct_90d),
            "price_change_180d": _r(analysis.price_change_pct_180d),
            "price_change_1y": _r(analysis.price_change_pct_365d),
            "price_change_all_time": _r(analysis.price_change_pct_all),
            # Key levels
            "support": _r(analysis.support),
            "resistance": _r(analysis.resistance),
            "all_time_high": _r(analysis.all_time_high),
            "all_time_low": _r(analysis.all_time_low),
            "pct_from_ath": _r(analysis.pct_from_ath),
            "price_percentile": _r(analysis.price_percentile),
            # Bollinger
            "bollinger_position": None,
            # Volume proxies
            "volatility": _r(analysis.volatility),
            "spread_ratio": _r(analysis.spread_ratio),
            "activity_score": analysis.activity_score,
            # History depth
            "price_history_days": analysis.total_history_days,
            "first_price_date": analysis.first_price_date,
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

    indicators = _build_card_indicators(db, max_cards=50)
    if not indicators:
        return {"error": "No cards with sufficient daily price data."}

    # Build concise data for AI — full multi-timeframe picture
    card_summaries = []
    for c in indicators:
        card_summaries.append({
            "id": c["card_id"],
            "name": c["name"],
            "set": c["set_name"],
            "rarity": c["rarity"],
            "price": c["current_price"],
            # Moving averages (short → long)
            "sma7": c["sma_7"],
            "sma30": c["sma_30"],
            "sma90": c.get("sma_90"),
            "sma200": c.get("sma_200"),
            "ema50": c.get("ema_50"),
            # Oscillators
            "rsi": c["rsi_14"],
            "macd_hist": c["macd_histogram"],
            "momentum": c["momentum"],
            # Multi-timeframe price changes
            "chg_7d": c["price_change_7d"],
            "chg_30d": c["price_change_30d"],
            "chg_90d": c.get("price_change_90d"),
            "chg_180d": c.get("price_change_180d"),
            "chg_1y": c.get("price_change_1y"),
            "chg_all": c.get("price_change_all_time"),
            # Key levels
            "support": c["support"],
            "resistance": c["resistance"],
            "ath": c.get("all_time_high"),
            "atl": c.get("all_time_low"),
            "pct_from_ath": c.get("pct_from_ath"),
            "price_pctl": c.get("price_percentile"),
            # Bollinger & vol
            "boll_pos": c["bollinger_position"],
            "volatility": c.get("volatility"),
            "spread": c.get("spread_ratio"),
            "activity": c.get("activity_score"),
            # History depth
            "days": c["price_history_days"],
            "since": c.get("first_price_date"),
        })

    system_prompt = """You are Marcus "The Collector" Vega — a veteran Wall Street quant who left Goldman to trade Pokemon cards full-time. You have 3+ years of daily TCGPlayer price data for each card. You think in multi-year cycles, not weekly noise.

You MUST respond with valid JSON only. No markdown, no explanation outside JSON.

For each card, analyze the FULL history and decide: BUY, SELL, or HOLD.

DATA YOU HAVE (per card):
- Moving averages: SMA 7/30/90/200, EMA 50 — use SMA200 as the long-term trend anchor
- RSI 14, MACD histogram, momentum
- Multi-timeframe price changes: 7d, 30d, 90d, 180d, 1-year, and ALL-TIME
- All-time high (ATH), all-time low (ATL), % from ATH, price percentile (0-100 in historical range)
- Support/resistance (60-day window), Bollinger position
- Volatility, spread ratio, activity score (0-100)
- History depth: total days of data and first price date

ANALYSIS FRAMEWORK — think like a real quant:
1. LONG-TERM TREND: Is the card in a multi-year uptrend or downtrend? SMA200 vs price tells you.
2. CYCLE POSITION: Where is price relative to ATH/ATL? Cards near ATL with strong fundamentals (rare, iconic) = opportunity. Cards near ATH = risky.
3. MEAN REVERSION: Cards that dropped 50%+ from ATH often bounce. But distinguish "on sale" from "dead money."
4. MOMENTUM CONFLUENCE: Do short-term (7d/30d) and long-term (90d/1y) momentum agree? Divergence = caution.
5. RARITY PREMIUM: Gold Stars, ex/EX, VMAX, vintage Base Set = structural demand. Commons rarely appreciate.
6. REGIME DETECTION: Is the card in accumulation (low vol, flat), markup (rising), distribution (high vol, topping), or markdown (falling)?

COLLECTIBLE-SPECIFIC ALPHA:
- Set rotation matters — cards from recently rotated sets often dump then recover
- Nostalgia drives Base Set, Fossil, Jungle, Neo — these have floor prices
- Modern chase cards (Alt Arts, Special Art Rares) have hype cycles — buy the dip after hype fades
- Price percentile < 20 + high rarity = deep value
- Price percentile > 80 + declining momentum = distribution phase, SELL

Return JSON array with this exact structure:
[
  {
    "card_id": <int>,
    "signal": "BUY" | "SELL" | "HOLD",
    "conviction": <1-10>,
    "reasoning": "<2-3 sentences using specific data points: ATH/ATL, timeframe changes, SMA alignment>",
    "entry_price": <suggested entry or null>,
    "target_price": <take profit target or null>,
    "stop_loss": <stop loss price or null>,
    "time_horizon": "<short (1-4 weeks) | medium (1-6 months) | long (6-12+ months)>",
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

        # GPT-5.4 uses the Responses API
        response = client.responses.create(
            model="gpt-5.4",
            max_output_tokens=16384,
            input=[
                {"role": "developer", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )

        raw = response.output_text.strip()

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
                "time_horizon": sig.get("time_horizon", "medium"),
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
                "input": response.usage.input_tokens,
                "output": response.usage.output_tokens,
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
