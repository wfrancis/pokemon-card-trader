"""
Agent Tools — callable functions for the tool-using AI agent.

Each tool wraps existing services and returns focused, token-efficient data.
The agent decides which tools to call via OpenAI function calling.
"""
import json
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, asc

from server.models.card import Card
from server.models.price_history import PriceHistory
from server.models.sale import Sale
from server.models.agent_prediction import AgentPrediction
from server.models.agent_insight import AgentInsight
from server.services.market_analysis import analyze_card, get_top_movers
from server.services.backtesting import run_backtest, STRATEGIES
from server.services.trading_economics import (
    calc_breakeven_appreciation, calc_roundtrip_pnl,
    calc_liquidity_score, estimate_time_to_sell,
)
from server.services.prediction_tracker import get_accuracy_report

logger = logging.getLogger(__name__)


# ── Tool Functions ───────────────────────────────────────────────────────────

def tool_get_market_overview(db: Session, **kwargs) -> dict:
    """High-level market state: total cards, market cap, tiers, top movers."""
    # Market stats
    stats = db.query(
        func.avg(Card.current_price).label("avg_price"),
        func.count(Card.id).label("total_cards"),
        func.sum(Card.current_price).label("total_market_cap"),
    ).filter(
        Card.current_price.isnot(None), Card.current_price > 0, Card.is_tracked == True
    ).first()

    # Tier breakdown
    viable = db.query(Card).filter(Card.is_viable == True, Card.current_price > 0).all()
    tiers = {"premium_100_plus": 0, "mid_high_50_100": 0, "mid_20_50": 0}
    for c in viable:
        if c.current_price >= 100:
            tiers["premium_100_plus"] += 1
        elif c.current_price >= 50:
            tiers["mid_high_50_100"] += 1
        elif c.current_price >= 20:
            tiers["mid_20_50"] += 1

    # Top movers
    movers = get_top_movers(db, limit=5)

    return {
        "market_stats": {
            "avg_price": round(stats.avg_price, 2) if stats.avg_price else 0,
            "total_tracked_cards": stats.total_cards or 0,
            "total_market_cap": round(stats.total_market_cap, 2) if stats.total_market_cap else 0,
        },
        "tier_breakdown": tiers,
        "top_gainers": [
            {"name": m.get("name"), "set": m.get("set_name"), "price": m.get("current_price"),
             "change_pct": m.get("price_change_pct")}
            for m in movers.get("gainers", [])[:5]
        ],
        "top_losers": [
            {"name": m.get("name"), "set": m.get("set_name"), "price": m.get("current_price"),
             "change_pct": m.get("price_change_pct")}
            for m in movers.get("losers", [])[:5]
        ],
    }


def tool_get_card_data(db: Session, card_id: int, **kwargs) -> dict:
    """Deep-dive on a single card: price, indicators, sales, economics."""
    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        return {"error": f"Card {card_id} not found"}

    # Technical analysis
    analysis = analyze_card(db, card_id)

    # Recent sales (last 30 days)
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    sales = (
        db.query(Sale)
        .filter(Sale.card_id == card_id, Sale.order_date >= thirty_days_ago)
        .order_by(desc(Sale.order_date))
        .limit(20)
        .all()
    )
    sales_90d = db.query(Sale).filter(
        Sale.card_id == card_id,
        Sale.order_date >= datetime.now(timezone.utc) - timedelta(days=90),
    ).count()
    sales_30d = len(sales)

    median_sale = None
    if sales:
        prices_list = sorted(s.purchase_price for s in sales if s.purchase_price)
        if prices_list:
            mid = len(prices_list) // 2
            median_sale = prices_list[mid]

    # Economics
    price = card.current_price or 0
    breakeven = calc_breakeven_appreciation(price) if price > 0 else None
    liquidity = calc_liquidity_score(
        sales_90d=sales_90d, sales_30d=sales_30d, card_price=price,
        market_vs_median_spread_pct=((price - median_sale) / median_sale * 100) if median_sale else None,
    )
    time_to_sell = estimate_time_to_sell(price, sales_90d=sales_90d, sales_30d=sales_30d)

    result = {
        "card_id": card.id,
        "name": card.name,
        "set_name": card.set_name,
        "rarity": card.rarity,
        "current_price": price,
        "price_variant": card.price_variant,
    }

    if analysis and not isinstance(analysis, dict):
        result["indicators"] = {
            "sma_7": analysis.sma_7,
            "sma_30": analysis.sma_30,
            "sma_90": analysis.sma_90,
            "rsi_14": analysis.rsi_14,
            "macd_line": analysis.macd_line,
            "macd_signal": analysis.macd_signal,
            "bb_upper": analysis.bb_upper,
            "bb_lower": analysis.bb_lower,
            "regime": analysis.regime,
            "signal_strength": analysis.signal_strength,
            "signals": analysis.signals,
            "support": analysis.support,
            "resistance": analysis.resistance,
            "momentum": analysis.momentum,
            "data_confidence": analysis.data_confidence,
        }
    elif isinstance(analysis, dict):
        result["indicators"] = analysis

    result["sales"] = {
        "count_30d": sales_30d,
        "count_90d": sales_90d,
        "median_sale_price": round(median_sale, 2) if median_sale else None,
        "market_vs_median_spread_pct": round(
            (price - median_sale) / median_sale * 100, 1
        ) if median_sale and median_sale > 0 else None,
    }
    result["economics"] = {
        "breakeven_appreciation_pct": breakeven,
        "liquidity_score": liquidity,
        "estimated_days_to_sell": time_to_sell.get("estimated_days"),
        "price_tier": (
            "premium" if price >= 100 else
            "mid_high" if price >= 50 else
            "mid" if price >= 20 else "budget"
        ),
    }

    return result


def tool_search_cards(
    db: Session,
    min_price: float | None = None,
    max_price: float | None = None,
    tier: str | None = None,
    set_name: str | None = None,
    sort_by: str = "price",
    limit: int = 20,
    **kwargs,
) -> dict:
    """Find cards matching criteria. Returns summary data for each match."""
    query = db.query(Card).filter(Card.is_viable == True, Card.current_price > 0)

    if min_price is not None:
        query = query.filter(Card.current_price >= min_price)
    if max_price is not None:
        query = query.filter(Card.current_price <= max_price)
    if tier == "premium":
        query = query.filter(Card.current_price >= 100)
    elif tier == "mid_high":
        query = query.filter(Card.current_price >= 50, Card.current_price < 100)
    elif tier == "mid":
        query = query.filter(Card.current_price >= 20, Card.current_price < 50)
    if set_name:
        query = query.filter(Card.set_name.ilike(f"%{set_name}%"))

    if sort_by == "price_desc":
        query = query.order_by(desc(Card.current_price))
    elif sort_by == "price_asc":
        query = query.order_by(asc(Card.current_price))
    else:
        query = query.order_by(desc(Card.current_price))

    cards = query.limit(limit).all()

    return {
        "count": len(cards),
        "cards": [
            {
                "card_id": c.id,
                "name": c.name,
                "set_name": c.set_name,
                "rarity": c.rarity,
                "current_price": c.current_price,
                "tier": (
                    "premium" if c.current_price >= 100 else
                    "mid_high" if c.current_price >= 50 else
                    "mid" if c.current_price >= 20 else "budget"
                ),
            }
            for c in cards
        ],
    }


def tool_run_card_backtest(db: Session, card_id: int, strategy: str = "combined", **kwargs) -> dict:
    """Run a backtest strategy on a single card. Returns metrics."""
    try:
        result = run_backtest(db, card_id, strategy, fee_aware=True)
        if isinstance(result, dict) and "error" in result:
            return result
        return {
            "card_id": card_id,
            "strategy": strategy,
            "total_return_pct": result.get("total_return_pct"),
            "total_trades": result.get("total_trades"),
            "win_rate": result.get("win_rate"),
            "max_drawdown_pct": result.get("max_drawdown_pct"),
            "sharpe_ratio": result.get("sharpe_ratio"),
        }
    except Exception as e:
        return {"error": str(e), "card_id": card_id}


def tool_check_sales_velocity(db: Session, card_id: int, **kwargs) -> dict:
    """Check recent transaction flow for a card."""
    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        return {"error": f"Card {card_id} not found"}

    now = datetime.now(timezone.utc)
    sales_7d = db.query(Sale).filter(
        Sale.card_id == card_id, Sale.order_date >= now - timedelta(days=7)
    ).all()
    sales_30d = db.query(Sale).filter(
        Sale.card_id == card_id, Sale.order_date >= now - timedelta(days=30)
    ).all()
    sales_90d = db.query(Sale).filter(
        Sale.card_id == card_id, Sale.order_date >= now - timedelta(days=90)
    ).all()

    def _sales_stats(sales_list):
        if not sales_list:
            return {"count": 0, "avg_price": None, "median_price": None}
        prices = sorted(s.purchase_price for s in sales_list if s.purchase_price)
        if not prices:
            return {"count": len(sales_list), "avg_price": None, "median_price": None}
        return {
            "count": len(sales_list),
            "avg_price": round(sum(prices) / len(prices), 2),
            "median_price": round(prices[len(prices) // 2], 2),
            "min_price": round(prices[0], 2),
            "max_price": round(prices[-1], 2),
        }

    stats_30 = _sales_stats(sales_30d)
    stats_90 = _sales_stats(sales_90d)

    # Velocity trend
    velocity_trend = "unknown"
    if stats_90["count"] > 0:
        expected_30d = stats_90["count"] / 3
        if expected_30d > 0:
            ratio = stats_30["count"] / expected_30d
            if ratio >= 1.5:
                velocity_trend = "accelerating"
            elif ratio >= 0.8:
                velocity_trend = "stable"
            elif ratio >= 0.5:
                velocity_trend = "decelerating"
            else:
                velocity_trend = "drying_up"

    return {
        "card_id": card_id,
        "card_name": card.name,
        "current_price": card.current_price,
        "sales_7d": _sales_stats(sales_7d),
        "sales_30d": stats_30,
        "sales_90d": stats_90,
        "velocity_trend": velocity_trend,
    }


def tool_compare_cards(db: Session, card_ids: list[int], **kwargs) -> dict:
    """Cross-sectional comparison of multiple cards."""
    results = []
    for cid in card_ids[:10]:  # Cap at 10
        card = db.query(Card).filter_by(id=cid).first()
        if not card:
            continue

        analysis = analyze_card(db, cid)
        sales_90d = db.query(Sale).filter(
            Sale.card_id == cid,
            Sale.order_date >= datetime.now(timezone.utc) - timedelta(days=90),
        ).count()

        entry = {
            "card_id": cid,
            "name": card.name,
            "set_name": card.set_name,
            "rarity": card.rarity,
            "current_price": card.current_price,
            "sales_90d": sales_90d,
        }
        if analysis and not isinstance(analysis, dict):
            entry["rsi_14"] = analysis.rsi_14
            entry["regime"] = analysis.regime
            entry["signal_strength"] = analysis.signal_strength
            entry["sma_30"] = analysis.sma_30
        elif isinstance(analysis, dict):
            entry["rsi_14"] = analysis.get("rsi_14")
            entry["regime"] = analysis.get("regime")

        results.append(entry)

    return {"cards": results, "count": len(results)}


def tool_get_price_history(db: Session, card_id: int, days: int = 90, **kwargs) -> dict:
    """Get price history for a card."""
    card = db.query(Card).filter_by(id=card_id).first()
    if not card:
        return {"error": f"Card {card_id} not found"}

    cutoff = datetime.now(timezone.utc).date() - timedelta(days=days)
    records = (
        db.query(PriceHistory)
        .filter(PriceHistory.card_id == card_id, PriceHistory.date >= cutoff, PriceHistory.market_price.isnot(None))
        .order_by(asc(PriceHistory.date))
        .all()
    )

    # Summarize rather than dump raw data (token-efficient)
    if not records:
        return {"card_id": card_id, "name": card.name, "data_points": 0}

    prices = [r.market_price for r in records]
    return {
        "card_id": card_id,
        "name": card.name,
        "data_points": len(records),
        "start_date": str(records[0].date),
        "end_date": str(records[-1].date),
        "start_price": round(prices[0], 2),
        "end_price": round(prices[-1], 2),
        "high": round(max(prices), 2),
        "low": round(min(prices), 2),
        "change_pct": round((prices[-1] - prices[0]) / prices[0] * 100, 1) if prices[0] > 0 else 0,
        # Weekly samples for trend visualization
        "weekly_prices": [
            {"date": str(records[i].date), "price": round(records[i].market_price, 2)}
            for i in range(0, len(records), max(1, len(records) // 12))
        ],
    }


def tool_get_previous_picks(db: Session, **kwargs) -> dict:
    """Get the most recent agent predictions."""
    predictions = (
        db.query(AgentPrediction)
        .order_by(desc(AgentPrediction.predicted_at))
        .limit(20)
        .all()
    )

    picks = []
    for p in predictions:
        card = db.query(Card).filter_by(id=p.card_id).first()
        picks.append({
            "card_id": p.card_id,
            "card_name": card.name if card else "Unknown",
            "signal": p.signal,
            "entry_price": p.entry_price,
            "current_price": card.current_price if card else None,
            "return_pct": round(
                ((card.current_price - p.entry_price) / p.entry_price) * 100, 1
            ) if card and card.current_price and p.entry_price else None,
            "outcome": p.outcome,
            "predicted_at": p.predicted_at.isoformat() + "Z" if p.predicted_at else None,
        })

    return {"picks": picks, "count": len(picks)}


def tool_check_pick_accuracy(db: Session, **kwargs) -> dict:
    """Get prediction accuracy report."""
    return get_accuracy_report(db)


def tool_record_insight(
    db: Session,
    type: str,
    severity: str,
    title: str,
    message: str,
    card_id: int | None = None,
    metadata: dict | None = None,
    **kwargs,
) -> dict:
    """Record an agent observation/insight for the user."""
    insight = AgentInsight(
        type=type,
        severity=severity,
        card_id=card_id,
        title=title,
        message=message,
        metadata_json=json.dumps(metadata) if metadata else None,
    )
    db.add(insight)
    db.commit()
    return {"status": "recorded", "id": insight.id, "title": title}


# ── Tool Registry ────────────────────────────────────────────────────────────

TOOL_FUNCTIONS = {
    "get_market_overview": tool_get_market_overview,
    "get_card_data": tool_get_card_data,
    "search_cards": tool_search_cards,
    "run_card_backtest": tool_run_card_backtest,
    "check_sales_velocity": tool_check_sales_velocity,
    "compare_cards": tool_compare_cards,
    "get_price_history": tool_get_price_history,
    "get_previous_picks": tool_get_previous_picks,
    "check_pick_accuracy": tool_check_pick_accuracy,
    "record_insight": tool_record_insight,
}

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_market_overview",
            "description": "Get high-level market statistics: average price, market cap, tier breakdown, top 5 gainers and losers. Start here to understand the current market state.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_card_data",
            "description": "Get detailed data for a specific card: current price, technical indicators (SMA, RSI, MACD, Bollinger Bands, regime), recent sales, liquidity score, breakeven economics. Use after identifying interesting cards.",
            "parameters": {
                "type": "object",
                "properties": {
                    "card_id": {"type": "integer", "description": "The card ID to analyze"},
                },
                "required": ["card_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_cards",
            "description": "Search for cards matching criteria. Use to find cards in specific price tiers, sets, or to browse the tradeable universe.",
            "parameters": {
                "type": "object",
                "properties": {
                    "min_price": {"type": "number", "description": "Minimum price filter"},
                    "max_price": {"type": "number", "description": "Maximum price filter"},
                    "tier": {"type": "string", "enum": ["premium", "mid_high", "mid"], "description": "Price tier filter"},
                    "set_name": {"type": "string", "description": "Filter by set name (partial match)"},
                    "sort_by": {"type": "string", "enum": ["price_desc", "price_asc"], "description": "Sort order"},
                    "limit": {"type": "integer", "description": "Max results (default 20)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_card_backtest",
            "description": "Run a trading strategy backtest on a card. Returns total return, win rate, Sharpe ratio, max drawdown. Use to validate a hypothesis.",
            "parameters": {
                "type": "object",
                "properties": {
                    "card_id": {"type": "integer", "description": "Card to backtest"},
                    "strategy": {
                        "type": "string",
                        "enum": ["sma_crossover", "rsi_reversion", "macd_signal", "bollinger_bounce", "combined", "momentum_breakout", "mean_reversion_bands", "trend_rider"],
                        "description": "Backtest strategy to run",
                    },
                },
                "required": ["card_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_sales_velocity",
            "description": "Check transaction flow for a card: sales count, median prices, and velocity trend (accelerating/stable/decelerating) over 7d/30d/90d.",
            "parameters": {
                "type": "object",
                "properties": {
                    "card_id": {"type": "integer", "description": "Card to check"},
                },
                "required": ["card_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_cards",
            "description": "Cross-sectional comparison of multiple cards. Useful for comparing cards within the same set or rarity tier.",
            "parameters": {
                "type": "object",
                "properties": {
                    "card_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "List of card IDs to compare (max 10)",
                    },
                },
                "required": ["card_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_price_history",
            "description": "Get price history summary for a card: start/end price, high/low, change %, weekly samples.",
            "parameters": {
                "type": "object",
                "properties": {
                    "card_id": {"type": "integer", "description": "Card to get history for"},
                    "days": {"type": "integer", "description": "Number of days of history (default 90)"},
                },
                "required": ["card_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_previous_picks",
            "description": "Get the most recent agent predictions with current performance. Use to review what you recommended last time and how those picks are performing.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_pick_accuracy",
            "description": "Get your prediction accuracy report: overall hit rate, accuracy by persona/signal/tier, best and worst picks. Use to understand your track record.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "record_insight",
            "description": "Record an observation or alert for the user. Use when you find something notable: an opportunity, warning, anomaly, or milestone.",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["opportunity", "warning", "anomaly", "milestone"], "description": "Insight category"},
                    "severity": {"type": "string", "enum": ["info", "notable", "urgent"], "description": "How important this is"},
                    "title": {"type": "string", "description": "Short headline (under 80 chars)"},
                    "message": {"type": "string", "description": "Detailed explanation"},
                    "card_id": {"type": "integer", "description": "Related card ID (optional)"},
                },
                "required": ["type", "severity", "title", "message"],
            },
        },
    },
]


def execute_tool(db: Session, tool_name: str, arguments: dict) -> str:
    """Execute a tool by name and return JSON string result."""
    fn = TOOL_FUNCTIONS.get(tool_name)
    if not fn:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    try:
        result = fn(db=db, **arguments)
        return json.dumps(result, default=str)
    except Exception as e:
        logger.error(f"Tool {tool_name} failed: {e}")
        return json.dumps({"error": str(e)})
