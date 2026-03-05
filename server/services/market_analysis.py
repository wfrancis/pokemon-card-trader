"""
Wall Street-style technical analysis engine for Pokemon card prices.
Computes SMA, EMA, RSI, MACD, Bollinger Bands, momentum, and generates
bull/bear/hold signals.
"""
import math
from dataclasses import dataclass
from sqlalchemy.orm import Session
from sqlalchemy import asc
from server.models.price_history import PriceHistory


@dataclass
class AnalysisResult:
    sma_7: float | None = None
    sma_30: float | None = None
    sma_90: float | None = None
    ema_12: float | None = None
    ema_26: float | None = None
    rsi_14: float | None = None
    macd_line: float | None = None
    macd_signal: float | None = None
    macd_histogram: float | None = None
    bollinger_upper: float | None = None
    bollinger_middle: float | None = None
    bollinger_lower: float | None = None
    momentum: float | None = None
    price_change_pct_7d: float | None = None
    price_change_pct_30d: float | None = None
    support: float | None = None
    resistance: float | None = None
    volatility: float | None = None  # Std dev of daily returns (proxy for volume)
    spread_ratio: float | None = None  # Avg (high-low)/market ratio
    momentum_accel: float | None = None  # Change in momentum (2nd derivative)
    activity_score: float | None = None  # Composite hotness 0-100
    signal: str = "hold"  # "bullish", "bearish", "hold"
    signal_strength: float = 0.0  # -1.0 (strong bear) to 1.0 (strong bull)

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


def _sma(prices: list[float], period: int) -> float | None:
    if len(prices) < period:
        return None
    return sum(prices[-period:]) / period


def _ema(prices: list[float], period: int) -> float | None:
    if len(prices) < period:
        return None
    multiplier = 2 / (period + 1)
    ema = sum(prices[:period]) / period  # Start with SMA
    for price in prices[period:]:
        ema = (price - ema) * multiplier + ema
    return ema


def _rsi(prices: list[float], period: int = 14) -> float | None:
    if len(prices) < period + 1:
        return None
    gains = []
    losses = []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i - 1]
        gains.append(max(0, change))
        losses.append(max(0, -change))

    if len(gains) < period:
        return None

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _macd(prices: list[float]) -> tuple[float | None, float | None, float | None]:
    """Returns (macd_line, signal_line, histogram)."""
    if len(prices) < 26:
        return None, None, None

    ema_12_vals = []
    ema_12 = sum(prices[:12]) / 12
    ema_12_vals.append(ema_12)
    mult_12 = 2 / 13
    for p in prices[12:]:
        ema_12 = (p - ema_12) * mult_12 + ema_12
        ema_12_vals.append(ema_12)

    ema_26 = sum(prices[:26]) / 26
    mult_26 = 2 / 27
    macd_vals = []
    # Align: ema_12_vals starts at index 12, ema_26 starts at index 26
    for i, p in enumerate(prices[26:], start=26):
        ema_26 = (p - ema_26) * mult_26 + ema_26
        ema_12_val = ema_12_vals[i - 12]  # offset
        macd_vals.append(ema_12_val - ema_26)

    if not macd_vals:
        return None, None, None

    macd_line = macd_vals[-1]

    # Signal line: 9-period EMA of MACD
    if len(macd_vals) < 9:
        return macd_line, None, None

    signal = sum(macd_vals[:9]) / 9
    mult_9 = 2 / 10
    for m in macd_vals[9:]:
        signal = (m - signal) * mult_9 + signal

    histogram = macd_line - signal
    return macd_line, signal, histogram


def _bollinger_bands(prices: list[float], period: int = 20, std_dev: float = 2.0) -> tuple[float | None, float | None, float | None]:
    """Returns (upper, middle, lower)."""
    if len(prices) < period:
        return None, None, None
    window = prices[-period:]
    middle = sum(window) / period
    variance = sum((p - middle) ** 2 for p in window) / period
    std = math.sqrt(variance)
    return middle + std_dev * std, middle, middle - std_dev * std


def _volatility(prices: list[float], period: int = 14) -> float | None:
    """Annualized volatility from daily returns (proxy for trading activity)."""
    if len(prices) < period + 1:
        return None
    window = prices[-(period + 1):]
    returns = [(window[i] - window[i - 1]) / window[i - 1]
               for i in range(1, len(window)) if window[i - 1] != 0]
    if not returns:
        return None
    mean_r = sum(returns) / len(returns)
    variance = sum((r - mean_r) ** 2 for r in returns) / len(returns)
    return math.sqrt(variance) * 100  # as percentage


def _spread_ratio(records: list, period: int = 14) -> float | None:
    """Average (high-low)/market ratio — wider spread = more activity."""
    recent = records[-period:] if len(records) >= period else records
    ratios = []
    for r in recent:
        if r.high_price and r.low_price and r.market_price and r.market_price > 0:
            ratios.append((r.high_price - r.low_price) / r.market_price)
    if not ratios:
        return None
    return (sum(ratios) / len(ratios)) * 100


def _momentum_acceleration(prices: list[float]) -> float | None:
    """Second derivative of price — accelerating momentum = increasing interest."""
    if len(prices) < 15:
        return None
    # Momentum at two points
    if prices[-10] != 0 and prices[-5] != 0:
        mom_recent = ((prices[-1] - prices[-5]) / prices[-5]) * 100
        mom_prior = ((prices[-5] - prices[-10]) / prices[-10]) * 100
        return mom_recent - mom_prior
    return None


def _activity_score(
    volatility: float | None,
    spread_ratio: float | None,
    momentum_accel: float | None,
    price_change_7d: float | None,
    num_records: int,
) -> float | None:
    """Composite hotness score 0-100. Higher = more market activity."""
    if num_records < 5:
        return None

    score = 0.0
    weight = 0.0

    # Volatility component (0-30 pts) — higher vol = hotter
    if volatility is not None:
        vol_pts = min(30, volatility * 5)  # 6% vol = max 30 pts
        score += vol_pts
        weight += 30

    # Spread component (0-20 pts) — wider spread = more bidding activity
    if spread_ratio is not None:
        spread_pts = min(20, spread_ratio * 4)  # 5% spread = max 20 pts
        score += spread_pts
        weight += 20

    # Momentum acceleration (0-25 pts) — accelerating = hot
    if momentum_accel is not None:
        accel_pts = min(25, abs(momentum_accel) * 2.5)
        score += accel_pts
        weight += 25

    # Recent price change magnitude (0-25 pts) — big moves = hot
    if price_change_7d is not None:
        change_pts = min(25, abs(price_change_7d) * 2)
        score += change_pts
        weight += 25

    if weight == 0:
        return None

    return round((score / weight) * 100, 1)


def analyze_card(db: Session, card_id: int) -> AnalysisResult:
    """Run full technical analysis on a card's price history."""
    records = (
        db.query(PriceHistory)
        .filter(PriceHistory.card_id == card_id, PriceHistory.market_price.isnot(None))
        .order_by(asc(PriceHistory.date))
        .all()
    )

    if not records:
        return AnalysisResult()

    prices = [r.market_price for r in records]
    result = AnalysisResult()

    # Moving averages
    result.sma_7 = _sma(prices, 7)
    result.sma_30 = _sma(prices, 30)
    result.sma_90 = _sma(prices, 90)
    result.ema_12 = _ema(prices, 12)
    result.ema_26 = _ema(prices, 26)

    # RSI
    result.rsi_14 = _rsi(prices, 14)

    # MACD
    result.macd_line, result.macd_signal, result.macd_histogram = _macd(prices)

    # Bollinger Bands
    result.bollinger_upper, result.bollinger_middle, result.bollinger_lower = _bollinger_bands(prices)

    # Momentum (rate of change over last 10 periods)
    if len(prices) >= 10 and prices[-10] != 0:
        result.momentum = ((prices[-1] - prices[-10]) / prices[-10]) * 100

    # Price change percentages
    if len(prices) >= 7 and prices[-7] != 0:
        result.price_change_pct_7d = ((prices[-1] - prices[-7]) / prices[-7]) * 100
    if len(prices) >= 30 and prices[-30] != 0:
        result.price_change_pct_30d = ((prices[-1] - prices[-30]) / prices[-30]) * 100

    # Support / Resistance (simple: recent 20-period low/high)
    window = prices[-20:] if len(prices) >= 20 else prices
    result.support = min(window)
    result.resistance = max(window)

    # Volume proxy metrics
    result.volatility = _volatility(prices)
    result.spread_ratio = _spread_ratio(records)
    result.momentum_accel = _momentum_acceleration(prices)
    result.activity_score = _activity_score(
        result.volatility, result.spread_ratio, result.momentum_accel,
        result.price_change_pct_7d, len(records),
    )

    # Generate signal (now includes volume proxy)
    result.signal, result.signal_strength = _generate_signal(result, prices)

    return result


def _generate_signal(analysis: AnalysisResult, prices: list[float]) -> tuple[str, float]:
    """
    Combine indicators into a bull/bear/hold signal.
    Returns (signal_name, strength from -1.0 to 1.0).
    """
    if not prices:
        return "hold", 0.0

    current_price = prices[-1]
    score = 0.0
    factors = 0

    # RSI signal
    if analysis.rsi_14 is not None:
        if analysis.rsi_14 < 30:
            score += 1.0  # Oversold = bullish
        elif analysis.rsi_14 > 70:
            score -= 1.0  # Overbought = bearish
        else:
            score += (50 - analysis.rsi_14) / 50  # Neutral zone lean
        factors += 1

    # MACD signal
    if analysis.macd_histogram is not None:
        if analysis.macd_histogram > 0:
            score += 0.5
        else:
            score -= 0.5
        factors += 1

    # Price vs SMA (trend following)
    if analysis.sma_30 is not None and analysis.sma_30 != 0:
        if current_price > analysis.sma_30:
            score += 0.5
        else:
            score -= 0.5
        factors += 1

    # Bollinger Band position
    if analysis.bollinger_lower is not None and analysis.bollinger_upper is not None:
        band_range = analysis.bollinger_upper - analysis.bollinger_lower
        if band_range > 0:
            position = (current_price - analysis.bollinger_lower) / band_range
            if position < 0.2:
                score += 0.7  # Near lower band = potential bounce
            elif position > 0.8:
                score -= 0.7  # Near upper band = potential pullback
            factors += 1

    # Momentum
    if analysis.momentum is not None:
        if analysis.momentum > 5:
            score += 0.3
        elif analysis.momentum < -5:
            score -= 0.3
        factors += 1

    # Volume proxy: high activity amplifies existing signals
    if analysis.activity_score is not None and analysis.activity_score > 50:
        # Hot cards with positive momentum get a boost, negative get a penalty
        if score > 0:
            score += 0.3
        elif score < 0:
            score -= 0.3
        factors += 1

    if factors == 0:
        return "hold", 0.0

    strength = max(-1.0, min(1.0, score / factors))

    if strength > 0.2:
        return "bullish", strength
    elif strength < -0.2:
        return "bearish", strength
    return "hold", strength


def get_top_movers(db: Session, limit: int = 10) -> dict:
    """Get top gainers and losers based on available price history."""
    from sqlalchemy import func, desc

    # Get cards that have at least 2 price records
    subq = (
        db.query(
            PriceHistory.card_id,
            func.count(PriceHistory.id).label("record_count")
        )
        .filter(PriceHistory.market_price.isnot(None))
        .group_by(PriceHistory.card_id)
        .having(func.count(PriceHistory.id) >= 2)
        .subquery()
    )

    card_ids = [row[0] for row in db.query(subq.c.card_id).all()]

    movers = []
    for card_id in card_ids:
        prices = (
            db.query(PriceHistory)
            .filter(PriceHistory.card_id == card_id, PriceHistory.market_price.isnot(None))
            .order_by(asc(PriceHistory.date))
            .all()
        )
        if len(prices) < 2:
            continue

        first_price = prices[0].market_price
        last_price = prices[-1].market_price
        if first_price and first_price > 0:
            change_pct = ((last_price - first_price) / first_price) * 100
            from server.models.card import Card
            card = db.query(Card).filter(Card.id == card_id).first()
            if card:
                movers.append({
                    "card_id": card.id,
                    "tcg_id": card.tcg_id,
                    "name": card.name,
                    "set_name": card.set_name,
                    "image_small": card.image_small,
                    "current_price": last_price,
                    "previous_price": first_price,
                    "change_pct": round(change_pct, 2),
                    "variant": card.price_variant,
                })

    movers.sort(key=lambda x: x["change_pct"], reverse=True)

    return {
        "gainers": movers[:limit],
        "losers": list(reversed(movers[-limit:])) if len(movers) > limit else [],
    }


def get_hot_cards(db: Session, limit: int = 12) -> list[dict]:
    """Get cards ranked by activity score (volume proxy hotness)."""
    from server.models.card import Card
    from sqlalchemy import func

    # Cards with at least 5 price records
    subq = (
        db.query(
            PriceHistory.card_id,
            func.count(PriceHistory.id).label("record_count")
        )
        .filter(PriceHistory.market_price.isnot(None))
        .group_by(PriceHistory.card_id)
        .having(func.count(PriceHistory.id) >= 5)
        .subquery()
    )

    card_ids = [row[0] for row in db.query(subq.c.card_id).all()]

    hot = []
    for card_id in card_ids:
        analysis = analyze_card(db, card_id)
        if analysis.activity_score is None:
            continue

        card = db.query(Card).filter(Card.id == card_id).first()
        if not card or not card.current_price:
            continue

        hot.append({
            "card_id": card.id,
            "tcg_id": card.tcg_id,
            "name": card.name,
            "set_name": card.set_name,
            "rarity": card.rarity,
            "image_small": card.image_small,
            "current_price": card.current_price,
            "activity_score": analysis.activity_score,
            "volatility": round(analysis.volatility, 2) if analysis.volatility else None,
            "spread_ratio": round(analysis.spread_ratio, 2) if analysis.spread_ratio else None,
            "momentum": round(analysis.momentum, 2) if analysis.momentum else None,
            "price_change_7d": round(analysis.price_change_pct_7d, 2) if analysis.price_change_pct_7d else None,
            "signal": analysis.signal,
            "signal_strength": round(analysis.signal_strength, 2),
        })

    hot.sort(key=lambda x: x["activity_score"], reverse=True)
    return hot[:limit]
