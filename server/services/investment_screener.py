"""
Investment Screener — Batch computation of liquidity scores and steady appreciation
metrics for all tracked cards. Enables filtering for "liquid + steadily appreciating" cards.
"""
import math
import logging
from datetime import datetime, timedelta, timezone, date as date_type
from sqlalchemy.orm import Session
from sqlalchemy import func, text

from server.models.card import Card
from server.models.price_history import PriceHistory
from server.models.sale import Sale
from server.models.liquidity_history import LiquidityHistory
from server.services.trading_economics import calc_liquidity_score, calc_breakeven_appreciation

logger = logging.getLogger(__name__)


def calc_steady_appreciation(prices: list[float], dates: list[date_type]) -> dict:
    """Calculate steady appreciation metrics using linear regression on log-prices.

    Returns:
        slope_pct_per_day: Daily % appreciation from linear regression
        r_squared: How well the trend fits (0-1, higher = more consistent)
        win_rate: % of days with positive return (0-100)
        appreciation_score: Composite score combining slope, consistency, and win rate (0-100)
    """
    if len(prices) < 14 or len(dates) < 14:
        return {
            "slope_pct_per_day": None,
            "r_squared": None,
            "win_rate": None,
            "appreciation_score": None,
        }

    # Use log prices for percentage-based regression
    log_prices = []
    valid_indices = []
    for i, p in enumerate(prices):
        if p > 0:
            log_prices.append(math.log(p))
            valid_indices.append(i)

    if len(log_prices) < 14:
        return {"slope_pct_per_day": None, "r_squared": None, "win_rate": None, "appreciation_score": None}

    # Convert dates to day numbers from start
    day_0 = dates[valid_indices[0]]
    x = [(dates[i] - day_0).days for i in valid_indices]
    y = log_prices

    n = len(x)
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(xi * yi for xi, yi in zip(x, y))
    sum_x2 = sum(xi * xi for xi in x)

    denom = n * sum_x2 - sum_x * sum_x
    if denom == 0:
        return {"slope_pct_per_day": None, "r_squared": None, "win_rate": None, "appreciation_score": None}

    # Slope of log-price regression = daily continuous return rate
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    # R-squared (coefficient of determination)
    y_mean = sum_y / n
    ss_tot = sum((yi - y_mean) ** 2 for yi in y)
    ss_res = sum((yi - (slope * xi + intercept)) ** 2 for xi, yi in zip(x, y))
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0
    r_squared = max(0, min(1, r_squared))

    # Convert log slope to daily % change
    slope_pct_per_day = (math.exp(slope) - 1) * 100

    # Win rate: % of days with positive return
    positive_days = 0
    total_days = 0
    for i in range(1, len(prices)):
        if prices[i] > 0 and prices[i-1] > 0:
            total_days += 1
            if prices[i] >= prices[i-1]:
                positive_days += 1
    win_rate = (positive_days / total_days * 100) if total_days > 0 else 0

    # Composite appreciation score (0-100)
    # Weights: slope direction & magnitude (40%), consistency R² (35%), win rate (25%)
    score = 0.0

    # Slope component (0-40): positive slope = good, scaled by magnitude
    # 0.1% per day = 44% annual, which is excellent
    if slope_pct_per_day > 0:
        slope_score = min(40, slope_pct_per_day * 200)  # 0.2%/day = max
    else:
        slope_score = max(0, 20 + slope_pct_per_day * 100)  # slightly negative still gets some points
    score += slope_score

    # R² component (0-35): higher = more predictable/steady
    score += r_squared * 35

    # Win rate component (0-25): > 55% = good
    if win_rate >= 55:
        score += min(25, (win_rate - 50) * 2.5)
    elif win_rate >= 45:
        score += 5  # neutral

    return {
        "slope_pct_per_day": round(slope_pct_per_day, 4),
        "r_squared": round(r_squared, 4),
        "win_rate": round(win_rate, 1),
        "appreciation_score": round(min(100, max(0, score)), 1),
    }


def batch_compute_investment_metrics(db: Session) -> dict:
    """Compute and cache liquidity scores and appreciation metrics for all tracked cards.

    This should run periodically (e.g., after each price sync).
    Stores results directly on the Card model for fast querying.
    """
    now = datetime.now(timezone.utc)
    d30 = (now - timedelta(days=30)).date()
    d90 = (now - timedelta(days=90)).date()
    today = now.date()

    # Get all tracked cards with prices
    tracked_cards = (
        db.query(Card)
        .filter(Card.is_tracked == True, Card.current_price.isnot(None), Card.current_price >= 2.0)
        .all()
    )

    updated = 0
    liquidity_recorded = 0

    for card in tracked_cards:
        try:
            # --- Liquidity Score ---
            sales_30d = db.query(func.count(Sale.id)).filter(
                Sale.card_id == card.id,
                Sale.order_date >= d30
            ).scalar() or 0

            sales_90d = db.query(func.count(Sale.id)).filter(
                Sale.card_id == card.id,
                Sale.order_date >= d90
            ).scalar() or 0

            # Spread: market vs median sale
            spread_pct = None
            if sales_90d > 0:
                median_sale = db.query(func.avg(Sale.purchase_price)).filter(
                    Sale.card_id == card.id,
                    Sale.order_date >= d90
                ).scalar()
                if median_sale and card.current_price and median_sale > 0:
                    spread_pct = abs(card.current_price - median_sale) / median_sale * 100

            liq_score = calc_liquidity_score(
                sales_90d=sales_90d,
                sales_30d=sales_30d,
                card_price=card.current_price or 0,
                market_vs_median_spread_pct=spread_pct,
            )

            card.liquidity_score = liq_score

            # Record liquidity history (one per day)
            existing_lh = db.query(LiquidityHistory).filter(
                LiquidityHistory.card_id == card.id,
                LiquidityHistory.date == today,
            ).first()
            if not existing_lh:
                lh = LiquidityHistory(
                    card_id=card.id,
                    date=today,
                    liquidity_score=liq_score,
                    sales_30d=sales_30d,
                    sales_90d=sales_90d,
                    spread_pct=round(spread_pct, 2) if spread_pct is not None else None,
                )
                db.add(lh)
                liquidity_recorded += 1

            # --- Steady Appreciation Metrics ---
            records = (
                db.query(PriceHistory)
                .filter(
                    PriceHistory.card_id == card.id,
                    PriceHistory.market_price.isnot(None),
                )
            )
            if card.price_variant:
                records = records.filter(PriceHistory.variant == card.price_variant)
            records = records.order_by(PriceHistory.date.asc()).all()

            if records:
                # Deduplicate by date
                date_prices = {}
                for r in records:
                    date_prices[r.date] = r.market_price
                sorted_dates = sorted(date_prices.keys())
                prices = [date_prices[d] for d in sorted_dates]

                appreciation = calc_steady_appreciation(prices, sorted_dates)
                card.appreciation_slope = appreciation["slope_pct_per_day"]
                card.appreciation_consistency = appreciation["r_squared"]
                card.appreciation_win_rate = appreciation["win_rate"]
                card.appreciation_score = appreciation["appreciation_score"]

            # --- Regime & ADX (lightweight cache) ---
            from server.services.market_analysis import _adx, _detect_regime
            if records and len(records) >= 30:
                date_prices_r = {}
                for r in records:
                    date_prices_r[r.date] = r.market_price
                sorted_dates_r = sorted(date_prices_r.keys())
                prices_r = [date_prices_r[d] for d in sorted_dates_r]

                adx_val = _adx(prices_r)
                regime_val = _detect_regime(prices_r, adx_val)
                card.cached_regime = regime_val
                card.cached_adx = adx_val

            card.liquidity_updated_at = now
            updated += 1

        except Exception as e:
            logger.warning(f"Failed to compute metrics for card {card.id}: {e}")
            continue

    db.commit()
    logger.info(f"Investment metrics: {updated} cards updated, {liquidity_recorded} liquidity history records")

    return {
        "cards_updated": updated,
        "liquidity_history_recorded": liquidity_recorded,
    }


def get_investment_candidates(
    db: Session,
    min_liquidity: int = 0,
    min_appreciation_score: float = 0,
    regime: str | None = None,
    min_price: float = 10.0,
    max_price: float | None = None,
    sort_by: str = "investment_score",
    sort_dir: str = "desc",
    page: int = 1,
    page_size: int = 50,
    q: str | None = None,
) -> dict:
    """Query cached investment metrics for screener UI.

    Returns cards with their cached liquidity and appreciation metrics.
    """
    query = (
        db.query(Card)
        .filter(
            Card.is_tracked == True,
            Card.current_price.isnot(None),
            Card.current_price >= min_price,
        )
    )

    if min_liquidity > 0:
        query = query.filter(Card.liquidity_score.isnot(None), Card.liquidity_score >= min_liquidity)

    if min_appreciation_score > 0:
        query = query.filter(
            Card.appreciation_score.isnot(None),
            Card.appreciation_score >= min_appreciation_score,
        )

    if regime:
        query = query.filter(Card.cached_regime == regime)

    if max_price is not None:
        query = query.filter(Card.current_price <= max_price)

    if q:
        query = query.filter(Card.name.ilike(f"%{q}%") | Card.set_name.ilike(f"%{q}%"))

    # Sorting
    from sqlalchemy import case, literal

    sort_map = {
        "liquidity_score": Card.liquidity_score,
        "appreciation_score": Card.appreciation_score,
        "appreciation_slope": Card.appreciation_slope,
        "appreciation_consistency": Card.appreciation_consistency,
        "current_price": Card.current_price,
        "name": Card.name,
    }

    # Investment score as SQL expression: coalesce(liquidity * 0.4, 0) + coalesce(appreciation * 0.6, 0)
    investment_score_expr = (
        func.coalesce(Card.liquidity_score * 0.4, literal(0))
        + func.coalesce(Card.appreciation_score * 0.6, literal(0))
    )

    if sort_by == "investment_score":
        sort_col = investment_score_expr
    else:
        sort_col = sort_map.get(sort_by, Card.appreciation_score)

    # Handle null sorting — nulls last
    if sort_dir == "desc":
        query = query.order_by(sort_col.desc().nullslast())
    else:
        query = query.order_by(sort_col.asc().nullsfirst())

    total = query.count()
    cards = query.offset((page - 1) * page_size).limit(page_size).all()

    results = []
    for card in cards:
        # Compute investment score inline
        inv_score = None
        if card.liquidity_score is not None and card.appreciation_score is not None:
            inv_score = round(card.liquidity_score * 0.4 + card.appreciation_score * 0.6, 1)
        elif card.appreciation_score is not None:
            inv_score = round(card.appreciation_score * 0.6, 1)

        breakeven = calc_breakeven_appreciation(card.current_price) if card.current_price else None

        results.append({
            "id": card.id,
            "tcg_id": card.tcg_id,
            "name": card.name,
            "set_name": card.set_name,
            "rarity": card.rarity,
            "image_small": card.image_small,
            "current_price": card.current_price,
            "price_variant": card.price_variant,
            # Liquidity
            "liquidity_score": card.liquidity_score,
            # Appreciation
            "appreciation_slope": card.appreciation_slope,
            "appreciation_consistency": card.appreciation_consistency,
            "appreciation_win_rate": card.appreciation_win_rate,
            "appreciation_score": card.appreciation_score,
            # Regime
            "regime": card.cached_regime,
            "adx": card.cached_adx,
            # Computed
            "investment_score": inv_score,
            "breakeven_pct": breakeven,
        })

    return {
        "data": results,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


def get_screener_stats(db: Session) -> dict:
    """Summary statistics for the investment screener."""
    total_tracked = db.query(func.count(Card.id)).filter(Card.is_tracked == True).scalar() or 0
    with_liquidity = db.query(func.count(Card.id)).filter(
        Card.is_tracked == True, Card.liquidity_score.isnot(None), Card.liquidity_score > 0
    ).scalar() or 0
    with_appreciation = db.query(func.count(Card.id)).filter(
        Card.is_tracked == True, Card.appreciation_score.isnot(None)
    ).scalar() or 0

    # Cards that are both liquid (>30) AND appreciating (>40)
    investment_grade = db.query(func.count(Card.id)).filter(
        Card.is_tracked == True,
        Card.liquidity_score.isnot(None),
        Card.liquidity_score >= 30,
        Card.appreciation_score.isnot(None),
        Card.appreciation_score >= 40,
    ).scalar() or 0

    # Regime breakdown
    regimes = (
        db.query(Card.cached_regime, func.count(Card.id))
        .filter(Card.is_tracked == True, Card.cached_regime.isnot(None))
        .group_by(Card.cached_regime)
        .all()
    )
    regime_breakdown = {r: c for r, c in regimes}

    # Average metrics
    avg_liquidity = db.query(func.avg(Card.liquidity_score)).filter(
        Card.is_tracked == True, Card.liquidity_score.isnot(None)
    ).scalar()
    avg_appreciation = db.query(func.avg(Card.appreciation_score)).filter(
        Card.is_tracked == True, Card.appreciation_score.isnot(None)
    ).scalar()

    # Last computation time
    last_computed = db.query(func.max(Card.liquidity_updated_at)).filter(
        Card.is_tracked == True
    ).scalar()

    return {
        "total_tracked": total_tracked,
        "with_liquidity_data": with_liquidity,
        "with_appreciation_data": with_appreciation,
        "investment_grade_count": investment_grade,
        "regime_breakdown": regime_breakdown,
        "avg_liquidity_score": round(avg_liquidity, 1) if avg_liquidity else None,
        "avg_appreciation_score": round(avg_appreciation, 1) if avg_appreciation else None,
        "last_computed_at": str(last_computed) if last_computed else None,
    }


def get_liquidity_trend(db: Session, card_id: int, days: int = 90) -> list[dict]:
    """Get liquidity score history for a single card."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date()
    records = (
        db.query(LiquidityHistory)
        .filter(LiquidityHistory.card_id == card_id, LiquidityHistory.date >= cutoff)
        .order_by(LiquidityHistory.date.asc())
        .all()
    )
    return [
        {
            "date": str(r.date),
            "liquidity_score": r.liquidity_score,
            "sales_30d": r.sales_30d,
            "sales_90d": r.sales_90d,
            "spread_pct": r.spread_pct,
        }
        for r in records
    ]
