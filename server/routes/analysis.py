from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, timezone
from server.database import get_db
from server.models.card import Card
from server.models.sale import Sale
from server.services.market_analysis import analyze_card, get_top_movers, get_hot_cards
from server.services.trading_economics import calc_liquidity_score
from server.services.cache import get as cache_get, set as cache_set

router = APIRouter(prefix="/api", tags=["analysis"])


@router.get("/cards/{card_id}/analysis")
def get_card_analysis(
    card_id: int,
    condition: str = Query("Near Mint", description="Card condition: Near Mint, Lightly Played, etc."),
    db: Session = Depends(get_db),
):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Card not found")

    analysis = analyze_card(db, card_id, condition=condition)
    analysis_dict = analysis.to_dict()
    # Override last_analyzed_price with the card's actual current_price
    # to avoid disagreement between sync-updated price and latest price_history record
    if card.current_price is not None:
        analysis_dict["last_analyzed_price"] = card.current_price

    # Calculate liquidity score from sales data
    liquidity_score = None
    try:
        now = datetime.now(timezone.utc)
        d30 = now - timedelta(days=30)
        d90 = now - timedelta(days=90)
        sales_30d = db.query(func.count(Sale.id)).filter(
            Sale.card_id == card_id,
            Sale.order_date >= d30.date()
        ).scalar() or 0
        sales_90d = db.query(func.count(Sale.id)).filter(
            Sale.card_id == card_id,
            Sale.order_date >= d90.date()
        ).scalar() or 0
        if sales_90d > 0 or sales_30d > 0:
            median_sale = db.query(func.avg(Sale.purchase_price)).filter(
                Sale.card_id == card_id,
                Sale.order_date >= d90.date()
            ).scalar()
            spread_pct = None
            if median_sale and card.current_price and median_sale > 0:
                spread_pct = abs(card.current_price - median_sale) / median_sale * 100
            liquidity_score = calc_liquidity_score(
                sales_90d=sales_90d,
                sales_30d=sales_30d,
                card_price=card.current_price or 0,
                market_vs_median_spread_pct=spread_pct,
            )
    except Exception:
        pass
    analysis_dict["liquidity_score"] = liquidity_score
    analysis_dict["sales_30d"] = sales_30d
    analysis_dict["sales_per_day"] = round(sales_30d / 30, 2) if sales_30d else 0

    return {
        "card_id": card_id,
        "card_name": card.name,
        "current_price": card.current_price,
        "analysis": analysis_dict,
    }


@router.get("/market/movers")
def market_movers(
    limit: int = Query(10, ge=1, le=50),
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
):
    cache_key = f"movers:{limit}:{days}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    result = get_top_movers(db, limit=limit, days=days)
    cache_set(cache_key, result, ttl=300)
    return result


@router.get("/market/index")
def market_index(db: Session = Depends(get_db)):
    """Aggregate Pokemon card market index — average price of all tracked cards."""
    cached = cache_get("market-index")
    if cached is not None:
        return cached

    from sqlalchemy import func
    from server.models.price_history import PriceHistory
    result = db.query(
        func.avg(Card.current_price).label("avg_price"),
        func.count(Card.id).label("total_cards"),
        func.sum(Card.current_price).label("total_market_cap"),
    ).filter(Card.current_price.isnot(None), Card.current_price > 0, Card.is_tracked == True).first()

    # Get most recent price history timestamp as last sync indicator
    last_sync = db.query(func.max(PriceHistory.date)).scalar()

    index_result = {
        "avg_price": round(result.avg_price, 2) if result.avg_price else 0,
        "total_cards": result.total_cards or 0,
        "total_market_cap": round(result.total_market_cap, 2) if result.total_market_cap else 0,
        "last_sync_at": last_sync,
    }
    cache_set("market-index", index_result, ttl=300)
    return index_result


@router.get("/market/hot")
def hot_cards(
    limit: int = Query(12, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Get hottest cards ranked by activity score (volume proxy)."""
    cache_key = f"hot:{limit}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    result = get_hot_cards(db, limit=limit)
    cache_set(cache_key, result, ttl=300)
    return result


@router.get("/market/weekly-recap/archive")
def weekly_recap_archive(db: Session = Depends(get_db)):
    """Return list of available weekly recap periods based on price history data."""
    from server.models.price_history import PriceHistory

    earliest_date = db.query(func.min(PriceHistory.date)).scalar()
    if not earliest_date:
        return {"weeks": []}

    today = datetime.now(timezone.utc).date()
    weeks = []
    # Generate weekly periods from most recent to earliest, up to 12 weeks
    end = today
    for _ in range(12):
        start = end - timedelta(days=7)
        if start < earliest_date:
            # Include partial week if there's data
            if end > earliest_date:
                weeks.append({"start": str(earliest_date), "end": str(end)})
            break
        weeks.append({"start": str(start), "end": str(end)})
        end = start

    return {"weeks": weeks}


@router.get("/market/weekly-recap/{start_date}")
def weekly_recap_historical(start_date: str, db: Session = Depends(get_db)):
    """Weekly recap for a specific start date (7-day period from that date)."""
    cache_key = f"recap:{start_date}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    from server.models.price_history import PriceHistory

    try:
        period_start = datetime.strptime(start_date, "%Y-%m-%d").date()
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    period_end = period_start + timedelta(days=7)

    movers = get_top_movers(db, limit=5, days=7, ref_date=period_end)

    # Avg price at period end
    avg_price_end = db.query(
        func.avg(PriceHistory.market_price)
    ).filter(
        PriceHistory.date == period_end,
        PriceHistory.market_price.isnot(None),
        PriceHistory.market_price > 0,
    ).scalar()

    # Fall back: use closest available date within the period
    if not avg_price_end:
        avg_price_end = db.query(
            func.avg(PriceHistory.market_price)
        ).filter(
            PriceHistory.date >= period_start,
            PriceHistory.date <= period_end,
            PriceHistory.market_price.isnot(None),
            PriceHistory.market_price > 0,
        ).scalar()

    avg_price_start = db.query(
        func.avg(PriceHistory.market_price)
    ).filter(
        PriceHistory.date == period_start,
        PriceHistory.market_price.isnot(None),
        PriceHistory.market_price > 0,
    ).scalar()

    avg_price = round(avg_price_end, 2) if avg_price_end else 0
    total_result = db.query(
        func.count(Card.id).label("total_cards"),
        func.sum(Card.current_price).label("total_market_cap"),
    ).filter(Card.current_price.isnot(None), Card.current_price > 0, Card.is_tracked == True).first()
    total_cards = total_result.total_cards or 0
    total_market_cap = round(total_result.total_market_cap, 2) if total_result.total_market_cap else 0

    change_pct = None
    if avg_price_start and avg_price_start > 0 and avg_price_end:
        change_pct = round((avg_price_end - avg_price_start) / avg_price_start * 100, 2)

    result = {
        "period": {"start": str(period_start), "end": str(period_end)},
        "market_index": {
            "avg_price": avg_price,
            "total_cards": total_cards,
            "total_market_cap": total_market_cap,
            "change_pct": change_pct,
        },
        "gainers": movers.get("gainers", []),
        "losers": movers.get("losers", []),
        "hottest": [],
    }
    cache_set(cache_key, result, ttl=3600)  # 1 hour cache for historical data
    return result


@router.get("/market/weekly-recap")
def weekly_recap(db: Session = Depends(get_db)):
    """Weekly market recap — gainers, losers, hottest cards, and market index change."""
    cached = cache_get("weekly-recap")
    if cached is not None:
        return cached

    from server.models.price_history import PriceHistory

    today = datetime.now(timezone.utc).date()
    week_ago = today - timedelta(days=7)

    movers = get_top_movers(db, limit=5, days=7)
    hottest = get_hot_cards(db, limit=5)

    # Current market index
    result = db.query(
        func.avg(Card.current_price).label("avg_price"),
        func.count(Card.id).label("total_cards"),
        func.sum(Card.current_price).label("total_market_cap"),
    ).filter(Card.current_price.isnot(None), Card.current_price > 0, Card.is_tracked == True).first()

    avg_price = round(result.avg_price, 2) if result.avg_price else 0
    total_cards = result.total_cards or 0
    total_market_cap = round(result.total_market_cap, 2) if result.total_market_cap else 0

    # 7 days ago avg price from PriceHistory
    avg_price_7d_ago = db.query(
        func.avg(PriceHistory.market_price)
    ).filter(
        PriceHistory.date == week_ago,
        PriceHistory.market_price.isnot(None),
        PriceHistory.market_price > 0,
    ).scalar()

    change_pct = None
    if avg_price_7d_ago and avg_price_7d_ago > 0:
        change_pct = round((avg_price - avg_price_7d_ago) / avg_price_7d_ago * 100, 2)

    result = {
        "period": {"start": str(week_ago), "end": str(today)},
        "market_index": {
            "avg_price": avg_price,
            "total_cards": total_cards,
            "total_market_cap": total_market_cap,
            "change_pct": change_pct,
        },
        "gainers": movers.get("gainers", []),
        "losers": movers.get("losers", []),
        "hottest": hottest,
    }
    cache_set("weekly-recap", result, ttl=600)  # 10 min cache
    return result


@router.get("/market/ticker")
def market_ticker(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Cards for the scrolling ticker — top priced cards with their current values."""
    cards = (
        db.query(Card)
        .filter(Card.current_price.isnot(None), Card.current_price > 0, Card.is_tracked == True)
        .order_by(Card.current_price.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": c.id,
            "name": c.name,
            "set_name": c.set_name,
            "price": c.current_price,
            "variant": c.price_variant,
        }
        for c in cards
    ]
