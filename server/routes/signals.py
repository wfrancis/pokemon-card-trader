"""Trading signals endpoint — AI-powered BUY/SELL/HOLD signals.

Technical indicators are computed from daily price data, then sent to GPT
via a 7-step multi-agent pipeline:
  1. Quant Engine — indicators, regime, ensemble, set strength
  2. Technical Analyst — chart patterns, divergences, trend structure
  3. Catalyst Analyst — Pokemon-specific dynamics, reprint risk, meta
  4. Bull Analyst — argues BUY cases (with TA + catalyst context)
  5. Bear Analyst — argues SELL cases (with TA + catalyst context)
  6. Portfolio Manager — synthesizes all agent input into signals
  7. Risk Manager — final gatekeeper, validates stops, adjusts conviction

The generate endpoint kicks off a background thread and returns immediately.
The frontend polls /status for results.
"""
import json
import logging
import threading
import time
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from server.database import get_db, SessionLocal
from server.models.card import Card
from server.models.price_history import PriceHistory
from server.services.market_analysis import analyze_card
from server.services.backtesting import run_backtest, STRATEGIES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/signals", tags=["signals"])

# ── In-memory job state ──────────────────────────────────────────
_signal_job = {
    "status": "idle",       # idle | processing | done | error
    "step": "",             # current step description
    "started_at": 0,
    "result": None,         # final result dict when done
    "error": None,
}
_job_lock = threading.Lock()


def _build_card_indicators(db: Session, max_cards: int = 100) -> list[dict]:
    """Compute daily technical indicators for top cards by activity."""
    from sqlalchemy import func, desc

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
        if not card or not card.current_price or not card.is_tracked:
            continue
        # Skip cheap cards — not meaningful for trading signals
        if card.current_price < 5.0:
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
            "sma_7": _r(analysis.sma_7),
            "sma_30": _r(analysis.sma_30),
            "sma_90": _r(analysis.sma_90),
            "sma_200": _r(analysis.sma_200),
            "ema_12": _r(analysis.ema_12),
            "ema_26": _r(analysis.ema_26),
            "ema_50": _r(analysis.ema_50),
            "rsi_14": _r(analysis.rsi_14, 1),
            "macd_histogram": _r(analysis.macd_histogram, 4),
            "momentum": _r(analysis.momentum),
            "price_change_7d": _r(analysis.price_change_pct_7d),
            "price_change_30d": _r(analysis.price_change_pct_30d),
            "price_change_90d": _r(analysis.price_change_pct_90d),
            "price_change_180d": _r(analysis.price_change_pct_180d),
            "price_change_1y": _r(analysis.price_change_pct_365d),
            "price_change_all_time": _r(analysis.price_change_pct_all),
            "support": _r(analysis.support),
            "resistance": _r(analysis.resistance),
            "all_time_high": _r(analysis.all_time_high),
            "all_time_low": _r(analysis.all_time_low),
            "pct_from_ath": _r(analysis.pct_from_ath),
            "price_percentile": _r(analysis.price_percentile),
            "bollinger_position": None,
            "volatility": _r(analysis.volatility),
            "spread_ratio": _r(analysis.spread_ratio),
            "activity_score": analysis.activity_score,
            "adx": _r(analysis.adx),
            "regime": analysis.regime,
            "half_life": _r(analysis.half_life),
            "data_confidence": _r(analysis.data_confidence),
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


def _call_gpt(client, developer_prompt: str, user_prompt: str, max_tokens: int = 8192) -> str:
    """Call GPT-5.4 via Responses API. Returns raw text."""
    response = client.responses.create(
        model="gpt-5.4",
        max_output_tokens=max_tokens,
        input=[
            {"role": "developer", "content": developer_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    return response.output_text.strip(), response.usage


def _parse_json_response(raw: str) -> list | dict:
    """Parse JSON from GPT response, handling markdown code blocks."""
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    return json.loads(raw)


def _set_step(step: str):
    """Update the current step for polling."""
    with _job_lock:
        _signal_job["step"] = step
    logger.info(f"AI Pipeline: {step}")


def _run_signal_pipeline():
    """Background worker: 7-step multi-agent pipeline.

    Agents:
      1. Quant Engine — compute indicators, regime, ensemble, set strength
      2. Technical Analyst — chart patterns, divergences, trend structure
      3. Catalyst Analyst — Pokemon-specific: reprints, meta, set rotation
      4. Bull Analyst — argue BUY cases using TA + catalyst context
      5. Bear Analyst — argue SELL cases using TA + catalyst context
      6. Portfolio Manager — synthesize debate into signals
      7. Risk Manager — final gatekeeper, validate stops, adjust conviction
    """
    import os

    db = SessionLocal()
    try:
        _set_step("Computing quant indicators for 30 cards...")

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            with _job_lock:
                _signal_job["status"] = "error"
                _signal_job["error"] = "OPENAI_API_KEY not configured."
            return

        import openai
        client = openai.OpenAI(api_key=api_key)

        indicators = _build_card_indicators(db, max_cards=30)
        if not indicators:
            with _job_lock:
                _signal_job["status"] = "error"
                _signal_job["error"] = "No cards with sufficient daily price data."
            return

        # ── Step 1: Quant Engine ─────────────────────────────────
        _set_step("Step 1/7: Running quant engine (regime, ensemble, set strength)...")
        from server.services.market_analysis import (
            get_set_relative_strength, get_ensemble_signal,
        )

        set_rs = get_set_relative_strength(db, days=30)

        card_data = []
        ensemble_count = 0
        for c in indicators:
            ensemble = {}
            # Limit ensemble to top 10 cards (heavy compute on small VM)
            if c.get("can_backtest") and ensemble_count < 10:
                try:
                    ensemble = get_ensemble_signal(db, c["card_id"])
                    ensemble_count += 1
                except Exception:
                    ensemble = {}

            rs = set_rs.get(c.get("set_name", ""), 1.0)

            card_data.append({
                "id": c["card_id"],
                "name": c["name"],
                "set": c["set_name"],
                "rarity": c["rarity"],
                "price": c["current_price"],
                "sma7": c["sma_7"], "sma30": c["sma_30"],
                "sma90": c.get("sma_90"), "sma200": c.get("sma_200"),
                "ema12": c.get("ema_12"), "ema26": c.get("ema_26"),
                "ema50": c.get("ema_50"),
                "rsi": c["rsi_14"], "macd_hist": c["macd_histogram"],
                "momentum": c["momentum"],
                "chg_7d": c.get("price_change_7d"), "chg_30d": c.get("price_change_30d"),
                "chg_90d": c.get("price_change_90d"), "chg_180d": c.get("price_change_180d"),
                "chg_1y": c.get("price_change_1y"), "chg_all": c.get("price_change_all_time"),
                "ath": c.get("all_time_high"), "atl": c.get("all_time_low"),
                "pct_from_ath": c.get("pct_from_ath"), "price_pctl": c.get("price_percentile"),
                "support": c.get("support"), "resistance": c.get("resistance"),
                "boll_pos": c.get("bollinger_position"),
                "regime": c.get("regime"), "adx": c.get("adx"),
                "half_life": c.get("half_life"),
                "data_confidence": c.get("data_confidence"),
                "ensemble_signal": ensemble.get("signal"),
                "ensemble_confidence": ensemble.get("confidence"),
                "set_relative_strength": rs,
                "volatility": c.get("volatility"), "activity": c.get("activity_score"),
                "days": c.get("price_history_days"), "since": c.get("first_price_date"),
            })

        cards_json = json.dumps(card_data, indent=2)
        total_usage = {"input": 0, "output": 0}

        def _track(usage):
            total_usage["input"] += usage.input_tokens
            total_usage["output"] += usage.output_tokens

        # ── Step 2: Technical Analyst ─────────────────────────────
        _set_step("Step 2/7: Technical Analyst reading chart patterns...")
        ta_prompt = """You are a TECHNICAL ANALYST specializing in collectibles price charts. Interpret raw indicator data into actionable chart analysis.

For each card, analyze:
1. TREND STRUCTURE: Is the SMA stack bullish (7>30>90>200) or bearish? How aligned are EMAs?
2. MOMENTUM DIVERGENCE: Is RSI diverging from price? Price making highs but RSI declining = bearish divergence.
3. SUPPORT/RESISTANCE: How close to key levels? About to break out or break down?
4. BOLLINGER SQUEEZE: Position near 0.5 with low volatility = big move coming. Which direction?
5. REGIME + ADX: Interpret regime (accumulation/markup/distribution/markdown) with ADX trend strength.
6. MEAN REVERSION: Compare half_life with deviation from SMA. Short half_life + far from mean = snap-back trade.

Respond with valid JSON only:
[{"card_id": <int>, "pattern": "<1-2 word pattern name>", "ta_summary": "<2-3 sentences>", "ta_bias": "bullish"|"bearish"|"neutral", "key_level": <price level to watch>}]"""

        ta_raw, ta_usage = _call_gpt(client, ta_prompt,
            f"Read these charts and identify patterns:\n{cards_json}\nReturn JSON only.")
        _track(ta_usage)

        try:
            ta_results = {t["card_id"]: t for t in _parse_json_response(ta_raw)}
        except (json.JSONDecodeError, KeyError):
            ta_results = {}

        # ── Step 3: Catalyst Analyst ──────────────────────────────
        _set_step("Step 3/7: Catalyst Analyst evaluating Pokemon market dynamics...")
        catalyst_prompt = """You are a POKEMON CARD MARKET SPECIALIST (Catalyst Analyst). Deep knowledge of the Pokemon TCG collectibles market.

For each card, consider:
1. SET ROTATION: Vintage nostalgia set (price floor from collector demand) vs recent competitive set (loses value on rotation)?
2. REPRINT RISK: Has this card been reprinted? Old set rares = low reprint risk. Recent staples = medium-high risk.
3. COMPETITIVE META: Playable in current formats? Trainer staples and meta Pokemon hold value.
4. COLLECTOR vs PLAYER: Rare/holo = collector-driven (price floor). Common playable = player-driven (meta-dependent).
5. RARITY PREMIUM: Ultra Rare, Secret Rare, Alt Art = structural scarcity. Common/Uncommon = unlimited supply.
6. MARKET SENTIMENT: Check set_relative_strength — which sets are trending hot or cold?

Respond with valid JSON only:
[{"card_id": <int>, "catalyst": "<key catalyst or risk>", "catalyst_summary": "<2-3 sentences>", "demand_type": "collector"|"player"|"both"|"speculative", "reprint_risk": "low"|"medium"|"high"}]"""

        cat_raw, cat_usage = _call_gpt(client, catalyst_prompt,
            f"Analyze Pokemon market dynamics:\n{cards_json}\nReturn JSON only.")
        _track(cat_usage)

        try:
            catalyst_results = {c["card_id"]: c for c in _parse_json_response(cat_raw)}
        except (json.JSONDecodeError, KeyError):
            catalyst_results = {}

        # ── Step 4: Bull Analyst (with TA + catalyst context) ─────
        _set_step("Step 4/7: Bull Analyst arguing BUY cases...")
        enriched = []
        for cd in card_data:
            cid = cd["id"]
            ta = ta_results.get(cid, {})
            cat = catalyst_results.get(cid, {})
            enriched.append({
                "card_id": cid, "name": cd["name"], "set": cd["set"],
                "rarity": cd["rarity"], "price": cd["price"],
                "rsi": cd["rsi"], "macd_hist": cd["macd_hist"],
                "chg_7d": cd.get("chg_7d"), "chg_30d": cd.get("chg_30d"),
                "chg_90d": cd.get("chg_90d"), "chg_1y": cd.get("chg_1y"),
                "pct_from_ath": cd.get("pct_from_ath"),
                "regime": cd.get("regime"), "adx": cd.get("adx"),
                "ensemble_signal": cd.get("ensemble_signal"),
                "set_relative_strength": cd.get("set_relative_strength"),
                "ta_pattern": ta.get("pattern", ""),
                "ta_summary": ta.get("ta_summary", ""),
                "ta_bias": ta.get("ta_bias", "neutral"),
                "catalyst": cat.get("catalyst", ""),
                "catalyst_summary": cat.get("catalyst_summary", ""),
                "demand_type": cat.get("demand_type", ""),
                "reprint_risk": cat.get("reprint_risk", ""),
            })
        enriched_json = json.dumps(enriched, indent=2)

        bull_prompt = """You are the BULL ANALYST on a Pokemon card trading desk. Find reasons to BUY each card. Optimistic but data-driven.

You have input from your Technical Analyst (chart patterns) and Catalyst Analyst (Pokemon market dynamics). Use their insights.

For each card, write 2-3 sentences arguing the BULLISH case. Reference specific TA patterns and catalysts. If TA says bearish but you see a contrarian opportunity, explain why.

If there's genuinely no bull case, say "No bull case" — don't force it.

Respond with valid JSON only: [{"card_id": <int>, "bull_case": "<text>", "bull_conviction": <1-10>}]"""

        bull_raw, bull_usage = _call_gpt(client, bull_prompt,
            f"Argue the BULL case using TA + catalyst context:\n{enriched_json}\nReturn JSON only.")
        _track(bull_usage)

        try:
            bull_cases = {b["card_id"]: b for b in _parse_json_response(bull_raw)}
        except (json.JSONDecodeError, KeyError):
            bull_cases = {}

        # ── Step 5: Bear Analyst (with TA + catalyst context) ─────
        _set_step("Step 5/7: Bear Analyst arguing SELL cases...")
        bear_prompt = """You are the BEAR ANALYST on a Pokemon card trading desk. Find reasons to SELL or AVOID each card. Skeptical and risk-focused.

You have input from your Technical Analyst and Catalyst Analyst. Use their insights — especially reprint risk, distribution regimes, and bearish divergences.

For each card, write 2-3 sentences arguing the BEARISH case. Reference specific data.

If there's genuinely no bear case, say "No bear case" — don't force it.

Respond with valid JSON only: [{"card_id": <int>, "bear_case": "<text>", "bear_conviction": <1-10>}]"""

        bear_raw, bear_usage = _call_gpt(client, bear_prompt,
            f"Argue the BEAR case using TA + catalyst context:\n{enriched_json}\nReturn JSON only.")
        _track(bear_usage)

        try:
            bear_cases = {b["card_id"]: b for b in _parse_json_response(bear_raw)}
        except (json.JSONDecodeError, KeyError):
            bear_cases = {}

        # ── Step 6: Portfolio Manager ─────────────────────────────
        _set_step("Step 6/7: Portfolio Manager synthesizing all agent input...")
        debate_data = []
        for cd in card_data:
            cid = cd["id"]
            ta = ta_results.get(cid, {})
            cat = catalyst_results.get(cid, {})
            bull = bull_cases.get(cid, {})
            bear = bear_cases.get(cid, {})
            debate_data.append({
                "card_id": cid,
                "name": cd["name"], "set": cd["set"],
                "rarity": cd["rarity"], "price": cd["price"],
                "regime": cd.get("regime"), "adx": cd.get("adx"),
                "pct_from_ath": cd.get("pct_from_ath"),
                "price_pctl": cd.get("price_pctl"),
                "data_confidence": cd.get("data_confidence"),
                "ensemble_signal": cd.get("ensemble_signal"),
                "ensemble_confidence": cd.get("ensemble_confidence"),
                "set_relative_strength": cd.get("set_relative_strength"),
                "ta_pattern": ta.get("pattern", ""),
                "ta_bias": ta.get("ta_bias", "neutral"),
                "ta_summary": ta.get("ta_summary", ""),
                "catalyst": cat.get("catalyst", ""),
                "demand_type": cat.get("demand_type", ""),
                "reprint_risk": cat.get("reprint_risk", ""),
                "bull_case": bull.get("bull_case", "No analysis"),
                "bull_conviction": bull.get("bull_conviction", 5),
                "bear_case": bear.get("bear_case", "No analysis"),
                "bear_conviction": bear.get("bear_conviction", 5),
            })

        pm_prompt = """You are the PORTFOLIO MANAGER. You have input from FOUR specialist agents:
- Technical Analyst (chart patterns, support/resistance, divergences)
- Catalyst Analyst (Pokemon market dynamics, reprint risk, demand type)
- Bull Analyst (bullish arguments with TA/catalyst context)
- Bear Analyst (bearish arguments with TA/catalyst context)

DECISION FRAMEWORK:
1. CONSENSUS: If TA bias + catalyst + bull/bear all agree = high conviction. Disagreement = investigate why, lower conviction.
2. REGIME + TA: Markup regime + bullish pattern = strong BUY. Distribution + bearish divergence = strong SELL.
3. CATALYST WEIGHT: Low reprint risk + collector demand = premium. High reprint risk needs very strong technicals for BUY.
4. ENSEMBLE: Backtest ensemble confirms or denies the thesis.
5. DATA CONFIDENCE: Low confidence (< 0.6) = lower conviction.
6. RISK FIRST: Every BUY gets a stop_loss. Every SELL states invalidation level.

Respond with valid JSON only:
[{"card_id": <int>, "signal": "BUY"|"SELL"|"HOLD", "conviction": <1-10>, "reasoning": "<2-3 sentences synthesizing ALL agent inputs>", "entry_price": <number or null>, "target_price": <number or null>, "stop_loss": <number or null>, "time_horizon": "short"|"medium"|"long", "best_strategy": "<sma_crossover|rsi_mean_reversion|macd_signal|bollinger_bounce|combined|momentum_breakout|mean_reversion_bands|trend_rider>"}]"""

        pm_raw, pm_usage = _call_gpt(client, pm_prompt,
            f"Make trading decisions based on all agent input:\n{json.dumps(debate_data, indent=2)}\nReturn JSON only.",
            max_tokens=16384)
        _track(pm_usage)

        pm_signals = _parse_json_response(pm_raw)

        # ── Step 7: Risk Manager (final gatekeeper) ───────────────
        _set_step("Step 7/7: Risk Manager validating signals...")
        risk_data = []
        for sig in pm_signals:
            cid = sig.get("card_id")
            cd = next((c for c in card_data if c["id"] == cid), {})
            cat = catalyst_results.get(cid, {})
            risk_data.append({
                "card_id": cid,
                "name": cd.get("name"), "price": cd.get("price"),
                "signal": sig.get("signal"),
                "conviction": sig.get("conviction"),
                "reasoning": sig.get("reasoning"),
                "entry_price": sig.get("entry_price"),
                "target_price": sig.get("target_price"),
                "stop_loss": sig.get("stop_loss"),
                "volatility": cd.get("volatility"),
                "data_confidence": cd.get("data_confidence"),
                "regime": cd.get("regime"), "adx": cd.get("adx"),
                "pct_from_ath": cd.get("pct_from_ath"),
                "reprint_risk": cat.get("reprint_risk", "unknown"),
                "half_life": cd.get("half_life"),
                "support": cd.get("support"),
                "resistance": cd.get("resistance"),
            })

        risk_prompt = """You are the RISK MANAGER — final gatekeeper before any signal goes live. VALIDATE or OVERRIDE the Portfolio Manager's decisions.

RISK CHECKS:
1. STOP LOSS: Every BUY must have stop_loss. If missing, add one at support or 15% below entry. Too tight (<5%) or too wide (>25%) = adjust.
2. REWARD/RISK RATIO: Target upside must be >= 1.5x stop downside. Otherwise downgrade to HOLD or adjust targets.
3. VOLATILITY GATE: Volatility > 8% needs conviction >= 7 to pass. Otherwise downgrade.
4. DATA QUALITY: data_confidence < 0.5 = downgrade to HOLD. Don't trade what we can't measure.
5. CONCENTRATION: If >40% of signals are BUY, challenge the weakest BUYs.
6. REPRINT RISK: BUY on "high" reprint_risk = reduce conviction by 2.
7. OVERRIDE POWER: You CAN change signals and MUST explain why in risk_note.

Respond with valid JSON only:
[{"card_id": <int>, "signal": "BUY"|"SELL"|"HOLD", "conviction": <1-10>, "entry_price": <number or null>, "target_price": <number or null>, "stop_loss": <number or null>, "time_horizon": "short"|"medium"|"long", "risk_note": "<1-2 sentences on risk validation or override>"}]"""

        risk_raw, risk_usage = _call_gpt(client, risk_prompt,
            f"Validate these signals:\n{json.dumps(risk_data, indent=2)}\nReturn JSON only.",
            max_tokens=16384)
        _track(risk_usage)

        risk_signals = _parse_json_response(risk_raw)

        # ── Merge everything ─────────────────────────────────────
        _set_step("Merging all agent outputs...")
        indicator_map = {c["card_id"]: c for c in indicators}
        pm_map = {s["card_id"]: s for s in pm_signals}
        risk_map = {s["card_id"]: s for s in risk_signals}
        merged = []
        for cid in [cd["id"] for cd in card_data]:
            ind = indicator_map.get(cid, {})
            ta = ta_results.get(cid, {})
            cat = catalyst_results.get(cid, {})
            bull = bull_cases.get(cid, {})
            bear = bear_cases.get(cid, {})
            pm = pm_map.get(cid, {})
            risk = risk_map.get(cid, {})

            # Risk Manager has final say on signal, conviction, prices
            final_signal = risk.get("signal", pm.get("signal", "HOLD"))
            final_conviction = risk.get("conviction", pm.get("conviction", 5))

            merged.append({
                **ind,
                "signal": final_signal,
                "conviction": final_conviction,
                "reasoning": pm.get("reasoning", ""),
                "risk_note": risk.get("risk_note", ""),
                "bull_case": bull.get("bull_case", ""),
                "bear_case": bear.get("bear_case", ""),
                "ta_pattern": ta.get("pattern", ""),
                "ta_summary": ta.get("ta_summary", ""),
                "catalyst": cat.get("catalyst", ""),
                "catalyst_summary": cat.get("catalyst_summary", ""),
                "demand_type": cat.get("demand_type", ""),
                "reprint_risk": cat.get("reprint_risk", ""),
                "entry_price": risk.get("entry_price", pm.get("entry_price")),
                "target_price": risk.get("target_price", pm.get("target_price")),
                "stop_loss": risk.get("stop_loss", pm.get("stop_loss")),
                "time_horizon": risk.get("time_horizon", pm.get("time_horizon", "medium")),
                "best_strategy": pm.get("best_strategy", "combined"),
            })

        signal_order = {"BUY": 0, "SELL": 1, "HOLD": 2}
        merged.sort(key=lambda x: (signal_order.get(x["signal"], 2), -x.get("conviction", 0)))

        buy_count = sum(1 for s in merged if s["signal"] == "BUY")
        sell_count = sum(1 for s in merged if s["signal"] == "SELL")
        hold_count = sum(1 for s in merged if s["signal"] == "HOLD")

        result = {
            "signals": merged,
            "summary": {
                "total": len(merged),
                "buy": buy_count,
                "sell": sell_count,
                "hold": hold_count,
            },
            "pipeline": "7-step agentic (Quant → TA → Catalyst → Bull → Bear → PM → Risk Manager)",
            "tokens_used": total_usage,
        }

        with _job_lock:
            _signal_job["status"] = "done"
            _signal_job["result"] = result
            _signal_job["step"] = "Complete!"

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI signals JSON: {e}")
        with _job_lock:
            _signal_job["status"] = "error"
            _signal_job["error"] = f"AI returned invalid JSON: {str(e)}"
    except Exception as e:
        logger.error(f"AI signal generation failed: {e}")
        with _job_lock:
            _signal_job["status"] = "error"
            _signal_job["error"] = f"Trader analysis failed: {str(e)}"
    finally:
        db.close()


@router.post("/generate")
async def generate_ai_signals():
    """Kick off the AI signal pipeline in a background thread.

    Returns immediately. Frontend polls GET /api/signals/status for results.
    """
    with _job_lock:
        if _signal_job["status"] == "processing":
            elapsed = int(time.time() - _signal_job["started_at"])
            return {
                "status": "processing",
                "step": _signal_job["step"],
                "elapsed_seconds": elapsed,
                "message": "Pipeline already running. Poll GET /api/signals/status for updates.",
            }

        # Reset and start
        _signal_job["status"] = "processing"
        _signal_job["step"] = "Starting..."
        _signal_job["started_at"] = time.time()
        _signal_job["result"] = None
        _signal_job["error"] = None

    thread = threading.Thread(target=_run_signal_pipeline, daemon=True)
    thread.start()

    return {
        "status": "processing",
        "step": "Starting pipeline...",
        "message": "Signal generation started. Poll GET /api/signals/status for updates.",
    }


@router.get("/status")
async def get_signal_status():
    """Poll this endpoint for signal generation progress / results."""
    with _job_lock:
        status = _signal_job["status"]
        step = _signal_job["step"]
        started = _signal_job["started_at"]
        result = _signal_job["result"]
        error = _signal_job["error"]

    elapsed = int(time.time() - started) if started else 0

    if status == "done" and result:
        return {
            "status": "done",
            "elapsed_seconds": elapsed,
            **result,
        }
    elif status == "error":
        return {
            "status": "error",
            "elapsed_seconds": elapsed,
            "error": error,
        }
    elif status == "processing":
        return {
            "status": "processing",
            "step": step,
            "elapsed_seconds": elapsed,
        }
    else:
        return {"status": "idle"}


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
