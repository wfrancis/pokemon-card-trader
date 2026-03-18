"""
Rule-based smart insights generator for individual cards.
Produces 3-5 contextual insights by analyzing price history, sales, and set data.
No LLM needed — pure data-driven rules.
"""
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func

from server.models.card import Card
from server.models.price_history import PriceHistory
from server.models.sale import Sale
from server.services.market_analysis import analyze_card


def generate_card_insights(card: Card, db: Session) -> list[dict]:
    """Generate 3-5 smart insights for a card based on its data."""
    insights: list[dict] = []
    now = datetime.now(timezone.utc)

    # Fetch analysis
    analysis = analyze_card(db, card.id)
    current_price = card.current_price

    if not current_price or current_price <= 0:
        insights.append({
            "icon": "info",
            "title": "No Price Data",
            "text": "This card doesn't have pricing data yet. Prices update periodically from TCGPlayer.",
            "type": "info",
        })
        return insights

    # --- 1. Price Momentum (7d change) ---
    change_7d = analysis.price_change_pct_7d
    if change_7d is not None:
        if change_7d > 20:
            # Count how many tracked cards also moved 20%+ in 7d
            big_movers = _count_big_movers(db, threshold=20)
            insights.append({
                "icon": "trending_up",
                "title": "Surging",
                "text": f"This card jumped {change_7d:+.1f}% in the last week"
                        + (f" \u2014 only {big_movers} cards in the database moved this much" if big_movers else ""),
                "type": "bullish",
            })
        elif change_7d > 10:
            insights.append({
                "icon": "trending_up",
                "title": "Climbing",
                "text": f"Up {change_7d:+.1f}% this week \u2014 momentum is building.",
                "type": "bullish",
            })
        elif change_7d < -15:
            insights.append({
                "icon": "trending_down",
                "title": "Dip Alert",
                "text": f"Down {change_7d:+.1f}% this week \u2014 could be a buying opportunity if you believe in this card.",
                "type": "bearish",
            })
        elif change_7d < -5:
            insights.append({
                "icon": "trending_down",
                "title": "Cooling Off",
                "text": f"Down {change_7d:+.1f}% this week \u2014 watch for stabilization before buying.",
                "type": "bearish",
            })

    # --- 2. Liquidity / Sales Volume ---
    d30 = now - timedelta(days=30)
    sales_30d = db.query(func.count(Sale.id)).filter(
        Sale.card_id == card.id,
        Sale.order_date >= d30.date(),
    ).scalar() or 0

    if sales_30d > 20:
        insights.append({
            "icon": "speed",
            "title": "Hot Seller",
            "text": f"{sales_30d} sales in 30 days \u2014 this card moves fast. Easy to buy and sell.",
            "type": "bullish",
        })
    elif sales_30d > 5:
        insights.append({
            "icon": "swap_horiz",
            "title": "Active Market",
            "text": f"{sales_30d} sales in 30 days \u2014 reasonable liquidity.",
            "type": "neutral",
        })
    elif sales_30d > 0:
        insights.append({
            "icon": "hourglass_empty",
            "title": "Slow Mover",
            "text": f"Only {sales_30d} sale{'s' if sales_30d != 1 else ''} in 30 days \u2014 may take time to sell.",
            "type": "bearish",
        })

    # --- 3. Price vs Historical Average (SMA 90) ---
    sma_90 = analysis.sma_90
    if sma_90 and sma_90 > 0:
        deviation = ((current_price - sma_90) / sma_90) * 100
        if deviation < -15:
            insights.append({
                "icon": "savings",
                "title": "Below Average",
                "text": f"Trading {abs(deviation):.0f}% below its 90-day average (${sma_90:.2f}) \u2014 potential value buy.",
                "type": "bullish",
            })
        elif deviation > 15:
            insights.append({
                "icon": "trending_up",
                "title": "Premium",
                "text": f"Trading {deviation:.0f}% above its 90-day average (${sma_90:.2f}) \u2014 prices are elevated.",
                "type": "bearish",
            })

    # --- 4. Set Rank ---
    set_rank, set_total = _get_set_rank(db, card)
    if set_rank and set_total and set_total > 1:
        if set_rank <= 3:
            insights.append({
                "icon": "emoji_events",
                "title": "Set Rank",
                "text": f"#{set_rank} most valuable card in {card.set_name} (out of {set_total} cards).",
                "type": "info",
            })
        elif set_rank <= 10:
            insights.append({
                "icon": "star",
                "title": "Set Rank",
                "text": f"#{set_rank} most valuable in {card.set_name} (out of {set_total} cards).",
                "type": "info",
            })
        else:
            insights.append({
                "icon": "format_list_numbered",
                "title": "Set Rank",
                "text": f"#{set_rank} out of {set_total} cards in {card.set_name} by price.",
                "type": "neutral",
            })

    # --- 5. Flip Opportunity (spread analysis) ---
    d90 = now - timedelta(days=90)
    median_sale = db.query(func.avg(Sale.purchase_price)).filter(
        Sale.card_id == card.id,
        Sale.order_date >= d90.date(),
    ).scalar()

    if median_sale and median_sale > 0:
        spread = ((current_price - median_sale) / median_sale) * 100
        if spread < -10:
            insights.append({
                "icon": "local_offer",
                "title": "Flip Opportunity",
                "text": f"Listed {abs(spread):.0f}% below median sale price (${median_sale:.2f}) \u2014 potential arbitrage.",
                "type": "bullish",
            })
        elif spread > 50:
            insights.append({
                "icon": "warning",
                "title": "Overpriced",
                "text": f"Listed {spread:.0f}% above median sale price (${median_sale:.2f}) \u2014 wait for a better price.",
                "type": "bearish",
            })

    # --- 6. ATH / ATL context ---
    if analysis.pct_from_ath is not None and analysis.all_time_high:
        pct_from_ath = analysis.pct_from_ath
        if pct_from_ath is not None and pct_from_ath < -40:
            insights.append({
                "icon": "show_chart",
                "title": "Well Below Peak",
                "text": f"Trading {abs(pct_from_ath):.0f}% below its all-time high of ${analysis.all_time_high:.2f}.",
                "type": "neutral",
            })
        elif pct_from_ath is not None and abs(pct_from_ath) < 5:
            insights.append({
                "icon": "military_tech",
                "title": "Near All-Time High",
                "text": f"Within 5% of its all-time high (${analysis.all_time_high:.2f}) \u2014 strong momentum.",
                "type": "bullish",
            })

    # --- 7. RSI Signal ---
    rsi = analysis.rsi_14
    if rsi is not None:
        if rsi > 70:
            insights.append({
                "icon": "thermostat",
                "title": "Overbought",
                "text": f"RSI at {rsi:.0f} \u2014 technical indicator suggests the price may be overextended.",
                "type": "bearish",
            })
        elif rsi < 30:
            insights.append({
                "icon": "ac_unit",
                "title": "Oversold",
                "text": f"RSI at {rsi:.0f} \u2014 technical indicator suggests the card may be undervalued.",
                "type": "bullish",
            })

    # Cap at 5 insights, prioritizing variety
    return insights[:5]


def _count_big_movers(db: Session, threshold: float = 20) -> int:
    """Count how many tracked cards moved more than threshold% in 7 days."""
    seven_days_ago = datetime.now(timezone.utc).date() - timedelta(days=7)
    # Get cards with current price
    cards_with_price = db.query(Card.id, Card.current_price).filter(
        Card.is_tracked == True,
        Card.current_price.isnot(None),
        Card.current_price > 0,
    ).all()

    count = 0
    for card_id, current_price in cards_with_price[:200]:  # Sample for performance
        old = db.query(PriceHistory.market_price).filter(
            PriceHistory.card_id == card_id,
            PriceHistory.date <= seven_days_ago,
            PriceHistory.market_price.isnot(None),
        ).order_by(PriceHistory.date.desc()).first()
        if old and old[0] and old[0] > 0:
            change = abs((current_price - old[0]) / old[0]) * 100
            if change > threshold:
                count += 1
    return count


def _get_set_rank(db: Session, card: Card) -> tuple[int | None, int | None]:
    """Get this card's price rank within its set."""
    if not card.set_name or not card.current_price:
        return None, None

    set_cards = db.query(Card.id, Card.current_price).filter(
        Card.is_tracked == True,
        Card.set_name == card.set_name,
        Card.current_price.isnot(None),
        Card.current_price > 0,
    ).order_by(Card.current_price.desc()).all()

    total = len(set_cards)
    rank = None
    for i, (cid, _) in enumerate(set_cards, 1):
        if cid == card.id:
            rank = i
            break

    return rank, total
