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
from server.services.trading_economics import calc_liquidity_score, calc_breakeven_appreciation, estimate_time_to_sell

logger = logging.getLogger(__name__)

# Rarity tiers for collectibility scoring (higher = more collectible)
RARITY_SCORES: dict[str, int] = {
    "Special Illustration Rare": 95,
    "Hyper Rare": 90,
    "Illustration Rare": 80,
    "Secret Rare": 75,
    "Double Rare": 65,
    "Ultra Rare": 60,
    "Rare Holo VMAX": 58,
    "Rare Holo VSTAR": 56,
    "Rare Holo V": 50,
    "Rare BREAK": 45,
    "Rare Holo GX": 48,
    "Rare Holo EX": 48,
    "Rare Ultra": 55,
    "Rare Holo": 35,
    "Rare": 20,
    "ACE SPEC Rare": 70,
    "Amazing Rare": 65,
    "Shiny Rare": 70,
    "Shiny Ultra Rare": 80,
    "Rare Shiny": 60,
    "Rare Shiny GX": 70,
    "Rare Rainbow": 75,
    "Trainer Gallery Rare Holo": 55,
    "LEGEND": 85,
    "Radiant Rare": 60,
}

# Blue-chip Pokemon tiers (higher tier = more universal collector demand)
BLUE_CHIP_TIER1 = {  # Universal demand, trophy cards
    "Charizard", "Pikachu", "Mewtwo", "Mew",
}
BLUE_CHIP_TIER2 = {  # Strong collector demand
    "Umbreon", "Rayquaza", "Lugia", "Gengar", "Eevee", "Blastoise",
    "Venusaur", "Dragonite", "Espeon", "Sylveon",
}
BLUE_CHIP_TIER3 = {  # Solid niche demand
    "Gyarados", "Alakazam", "Gardevoir", "Arceus", "Giratina", "Palkia",
    "Dialga", "Ho-Oh", "Suicune", "Celebi", "Articuno", "Zapdos",
    "Moltres", "Garchomp", "Tyranitar", "Snorlax", "Jolteon", "Flareon",
    "Vaporeon", "Salamence",
}
BLUE_CHIP_POKEMON = BLUE_CHIP_TIER1 | BLUE_CHIP_TIER2 | BLUE_CHIP_TIER3

def _blue_chip_bonus(pokemon_name: str) -> int:
    """Tiered blue-chip bonus: Tier1=20, Tier2=12, Tier3=6."""
    if pokemon_name in BLUE_CHIP_TIER1:
        return 20
    if pokemon_name in BLUE_CHIP_TIER2:
        return 12
    if pokemon_name in BLUE_CHIP_TIER3:
        return 6
    return 0


def calc_steady_appreciation(prices: list[float], dates: list[date_type]) -> dict:
    """Calculate steady appreciation metrics using linear regression on log-prices.

    Returns:
        slope_pct_per_day: Daily % appreciation from linear regression
        r_squared: How well the trend fits (0-1, higher = more consistent)
        win_rate: % of days with positive return (0-100)
        appreciation_score: Composite score combining slope, consistency, and win rate (0-100)
    """
    if len(prices) < 30 or len(dates) < 30:
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

    if len(log_prices) < 30:
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

    # Win rate: % of days with strictly positive return (flat days are holds, not wins)
    positive_days = 0
    total_days = 0
    for i in range(1, len(prices)):
        if prices[i] > 0 and prices[i-1] > 0:
            total_days += 1
            if prices[i] > prices[i-1]:
                positive_days += 1
    win_rate = (positive_days / total_days * 100) if total_days > 0 else 0

    # Composite appreciation score (0-100)
    # Consistency-first model: R² gates everything, then slope and win rate
    # Weights: consistency R² (40%), slope magnitude (35%), win rate (25%)
    score = 0.0

    # R² component (0-40): consistency gates the signal
    # Below 0.3 = noise (0 points), 0.3-0.5 = partial credit, 0.5+ = full scaling
    if r_squared >= 0.5:
        score += r_squared * 40  # e.g. R²=0.8 → 32 points
    elif r_squared >= 0.3:
        # Partial credit: scale linearly from 0 to half max
        score += ((r_squared - 0.3) / 0.2) * 20  # 0-20 points
    # Below 0.3 = trend indistinguishable from noise, 0 points

    # Slope component (0-35): only positive slopes earn points
    if slope_pct_per_day > 0:
        slope_score = min(35, slope_pct_per_day * 175)  # 0.2%/day = max
    else:
        slope_score = 0  # depreciating cards get zero slope credit
    score += slope_score

    # Win rate component (0-25): > 55% = good (historical win rate)
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

            # Spread: market vs true median sale price
            # Use actual median (not mean) to avoid skew from outlier sales
            spread_pct = None
            if sales_90d > 0:
                sale_prices = [
                    row[0] for row in
                    db.query(Sale.purchase_price)
                    .filter(Sale.card_id == card.id, Sale.order_date >= d90, Sale.purchase_price > 0)
                    .order_by(Sale.purchase_price.asc())
                    .all()
                ]
                if sale_prices:
                    n = len(sale_prices)
                    median_sale = (sale_prices[n // 2] + sale_prices[(n - 1) // 2]) / 2
                    if card.current_price and median_sale > 0:
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
    min_velocity: float = 0,
    min_profit: float | None = None,
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

    # Investment score SQL approximation for sorting
    # Soft gate: use piecewise linear approximation of sigmoid(liq-30)
    # liq<10 → 0.1, liq 10-30 → linear 0.1-0.5, liq 30-60 → linear 0.5-0.95, liq>60 → 1.0
    liq_col = func.coalesce(Card.liquidity_score, literal(0))
    app_col = func.coalesce(Card.appreciation_score, literal(0))
    investment_score_expr = case(
        (liq_col < 10, app_col * literal(0.1)),
        (liq_col < 30, app_col * (literal(0.1) + (liq_col - literal(10)) * literal(0.02))),
        (liq_col < 60, app_col * (literal(0.5) + (liq_col - literal(30)) * literal(0.015))),
        else_=app_col,
    )

    # When sorting/filtering by computed fields (est_profit, min_profit),
    # we must fetch all rows and do post-query sort/pagination
    needs_post_sort = sort_by == "est_profit" or min_profit is not None or min_velocity > 0

    if not needs_post_sort:
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
    else:
        # Fetch all matching cards for post-query processing
        cards = query.all()
        total = len(cards)

    results = []
    for card in cards:
        breakeven = calc_breakeven_appreciation(card.current_price) if card.current_price else None

        # Rarity premium score (0-100) with tiered blue-chip bonus
        # Check ALL words in card name for blue-chip match (handles "Radiant Alakazam", "Eternal Zapdos")
        rarity_score = RARITY_SCORES.get(card.rarity, 10) if card.rarity else 10
        card_words = (card.name or "").split()
        bc_bonus = max((_blue_chip_bonus(w) for w in card_words), default=0)
        is_blue_chip = bc_bonus > 0
        rarity_score = min(100, rarity_score + bc_bonus)

        # Breakeven-adjusted slope: convert breakeven % to daily continuous rate
        # so units match appreciation_slope (both in %/day continuous compounding)
        breakeven_adjusted_slope = None
        if card.appreciation_slope is not None and breakeven is not None:
            # Convert breakeven % to daily continuous rate: ln(1 + BE/100) / holding_period
            # Use 365 days as assumed holding period for daily hurdle
            breakeven_daily_continuous = (math.log(1 + breakeven / 100) / 365) * 100
            breakeven_adjusted_slope = round(card.appreciation_slope - breakeven_daily_continuous, 4)

        # Days to breakeven: how many days at current slope to cover fees
        # appreciation_slope is discrete daily % (from exp(continuous_slope)-1)*100)
        # so ln(1 + slope/100) recovers the continuous daily rate for compounding
        days_to_breakeven = None
        if card.appreciation_slope is not None and card.appreciation_slope > 0 and breakeven is not None:
            # ln(1 + discrete%) = continuous_rate; use for both sides
            continuous_daily = math.log(1 + card.appreciation_slope / 100)
            if continuous_daily > 0:
                days_to_breakeven = round(math.log(1 + breakeven / 100) / continuous_daily)

        # Time to sell estimate
        time_to_sell = None
        sales_per_day = 0
        median_sold = None
        if card.current_price:
            # Use sales counts from liquidity data if available
            from server.models.sale import Sale as SaleModel
            d30 = (datetime.now(timezone.utc) - timedelta(days=30)).date()
            d90 = (datetime.now(timezone.utc) - timedelta(days=90)).date()
            s30 = db.query(func.count(SaleModel.id)).filter(
                SaleModel.card_id == card.id, SaleModel.order_date >= d30
            ).scalar() or 0
            s90 = db.query(func.count(SaleModel.id)).filter(
                SaleModel.card_id == card.id, SaleModel.order_date >= d90
            ).scalar() or 0
            tts = estimate_time_to_sell(card.current_price, s90, s30)
            time_to_sell = tts
            sales_per_day = round(s30 / 30, 2) if s30 else 0

            # Median sold price (for flip profit calculation)
            if s90 > 0:
                sale_prices = [
                    row[0] for row in
                    db.query(SaleModel.purchase_price)
                    .filter(SaleModel.card_id == card.id, SaleModel.order_date >= d90, SaleModel.purchase_price > 0)
                    .order_by(SaleModel.purchase_price.asc())
                    .all()
                ]
                if sale_prices:
                    n = len(sale_prices)
                    median_sold = round((sale_prices[n // 2] + sale_prices[(n - 1) // 2]) / 2, 2)

        # Investment score: soft gate model
        # Liquidity scales smoothly from 0→1.0 using sigmoid-like curve
        # Very low liquidity (<10) heavily penalizes but doesn't zero out
        inv_score = None
        liq = card.liquidity_score or 0
        app = card.appreciation_score or 0
        if card.appreciation_score is not None:
            # Soft liquidity gate: sigmoid curve centered at 30, steepness 0.1
            # liq=0 → ~0.05, liq=15 → ~0.18, liq=30 → ~0.5, liq=50 → ~0.88, liq=60+ → ~0.95+
            liq_modifier = 1.0 / (1.0 + math.exp(-0.1 * (liq - 30)))
            # Rarity bonus: 0-15 points (scaled by rarity_score 0-100)
            rarity_bonus = rarity_score * 0.15
            # Base = appreciation * liquidity modifier + rarity bonus
            inv_score = round(min(100, app * liq_modifier + rarity_bonus), 1)

        # Estimated flip profit: median_sold - (current_price * 1.1255)
        # 1.1255 accounts for ~12.55% seller fees (TCGPlayer + shipping)
        est_profit = None
        if median_sold is not None and card.current_price is not None:
            est_profit = round(median_sold - (card.current_price * 1.1255), 2)

        results.append({
            "id": card.id,
            "tcg_id": card.tcg_id,
            "name": card.name,
            "set_name": card.set_name,
            "rarity": card.rarity,
            "image_small": card.image_small,
            "current_price": card.current_price,
            "price_variant": card.price_variant,
            "artist": card.artist,
            # Liquidity
            "liquidity_score": card.liquidity_score,
            "sales_per_day": sales_per_day,
            "time_to_sell": time_to_sell,
            "median_sold": median_sold,
            # Appreciation
            "appreciation_slope": card.appreciation_slope,
            "appreciation_consistency": card.appreciation_consistency,
            "appreciation_win_rate": card.appreciation_win_rate,
            "appreciation_score": card.appreciation_score,
            "breakeven_adjusted_slope": breakeven_adjusted_slope,
            "days_to_breakeven": days_to_breakeven,
            # Collectibility
            "rarity_score": rarity_score,
            "is_blue_chip": is_blue_chip,
            # Regime
            "regime": card.cached_regime,
            "adx": card.cached_adx,
            # Computed
            "investment_score": inv_score,
            "breakeven_pct": breakeven,
            "est_profit": est_profit,
        })

    # Post-filter by min_velocity (sales_per_day is computed, not a DB column)
    if min_velocity > 0:
        results = [r for r in results if r.get("sales_per_day", 0) >= min_velocity]

    # Post-filter by min_profit (est_profit is computed, not a DB column)
    if min_profit is not None:
        results = [r for r in results if r.get("est_profit") is not None and r["est_profit"] >= min_profit]

    # Post-sort by est_profit (computed field, not a DB column)
    if sort_by == "est_profit":
        reverse = sort_dir != "asc"
        results.sort(
            key=lambda r: (r.get("est_profit") is None, -(r.get("est_profit") or 0) if reverse else (r.get("est_profit") or 0))
        )

    # Recalculate total and paginate when post-processing was applied
    if needs_post_sort:
        total = len(results)
        start = (page - 1) * page_size
        results = results[start:start + page_size]

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
