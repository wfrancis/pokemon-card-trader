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

    # Generate signal
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
