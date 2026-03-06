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
    sma_200: float | None = None
    ema_12: float | None = None
    ema_26: float | None = None
    ema_50: float | None = None
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
    price_change_pct_90d: float | None = None
    price_change_pct_180d: float | None = None
    price_change_pct_365d: float | None = None
    price_change_pct_all: float | None = None
    support: float | None = None
    resistance: float | None = None
    all_time_high: float | None = None
    all_time_low: float | None = None
    pct_from_ath: float | None = None  # How far below ATH (negative %)
    price_percentile: float | None = None  # 0-100 where current price sits in history
    total_history_days: int = 0
    first_price_date: str | None = None
    volatility: float | None = None  # Std dev of daily returns (proxy for volume)
    spread_ratio: float | None = None  # Avg (high-low)/market ratio
    momentum_accel: float | None = None  # Change in momentum (2nd derivative)
    activity_score: float | None = None  # Composite hotness 0-100
    adx: float | None = None  # Average Directional Index (trend strength 0-100)
    regime: str | None = None  # accumulation, markup, distribution, markdown
    half_life: float | None = None  # Mean-reversion half-life in days
    data_confidence: float = 0.0  # 0-1 confidence based on data depth
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
    """Returns (upper, middle, lower). Lower band is clamped to 0 (prices can't be negative)."""
    if len(prices) < period:
        return None, None, None
    window = prices[-period:]
    middle = sum(window) / period
    variance = sum((p - middle) ** 2 for p in window) / period
    std = math.sqrt(variance)
    lower = max(0, middle - std_dev * std)  # Clamp to 0 — prices can't be negative
    return middle + std_dev * std, middle, lower


def _adx(prices: list[float], period: int = 14) -> float | None:
    """Average Directional Index — measures trend strength (0-100).
    ADX > 25 = trending market, ADX < 20 = ranging/mean-reverting.
    """
    if len(prices) < period * 2 + 1:
        return None

    # True Range and Directional Movement
    plus_dm = []
    minus_dm = []
    tr = []

    for i in range(1, len(prices)):
        high_diff = prices[i] - prices[i - 1]  # Approximation (no separate H/L)
        low_diff = prices[i - 1] - prices[i]

        plus_dm.append(max(0, high_diff) if high_diff > low_diff else 0)
        minus_dm.append(max(0, low_diff) if low_diff > high_diff else 0)
        tr.append(abs(prices[i] - prices[i - 1]))

    if len(tr) < period:
        return None

    # Smoothed averages using Wilder's method
    atr = sum(tr[:period]) / period
    plus_di_smooth = sum(plus_dm[:period]) / period
    minus_di_smooth = sum(minus_dm[:period]) / period

    dx_vals = []
    for i in range(period, len(tr)):
        atr = (atr * (period - 1) + tr[i]) / period
        plus_di_smooth = (plus_di_smooth * (period - 1) + plus_dm[i]) / period
        minus_di_smooth = (minus_di_smooth * (period - 1) + minus_dm[i]) / period

        if atr > 0:
            plus_di = (plus_di_smooth / atr) * 100
            minus_di = (minus_di_smooth / atr) * 100
            di_sum = plus_di + minus_di
            if di_sum > 0:
                dx_vals.append(abs(plus_di - minus_di) / di_sum * 100)

    if len(dx_vals) < period:
        return None

    adx = sum(dx_vals[:period]) / period
    for dx in dx_vals[period:]:
        adx = (adx * (period - 1) + dx) / period

    return adx


def _detect_regime(prices: list[float], adx: float | None) -> str:
    """Detect market regime: accumulation, markup, distribution, or markdown.

    Uses ADX for trend strength and price position relative to SMA200.
    """
    if len(prices) < 200:
        # Not enough data — use simpler heuristic
        if len(prices) < 30:
            return "unknown"
        sma = sum(prices[-30:]) / 30
        if prices[-1] > sma * 1.05:
            return "markup"
        elif prices[-1] < sma * 0.95:
            return "markdown"
        return "accumulation"

    sma200 = sum(prices[-200:]) / 200
    sma200_prev = sum(prices[-210:-10]) / 200 if len(prices) >= 210 else sma200
    sma_slope = (sma200 - sma200_prev) / sma200_prev if sma200_prev > 0 else 0

    trending = adx is not None and adx > 25
    price_above_sma = prices[-1] > sma200

    if trending:
        if price_above_sma:
            return "markup"       # Strong uptrend
        else:
            return "markdown"     # Strong downtrend
    else:
        if sma_slope > 0.01:
            return "accumulation"  # Low trend strength, slight upward drift
        elif sma_slope < -0.01:
            return "distribution"  # Low trend strength, slight downward drift
        else:
            return "accumulation"  # Range-bound


def _half_life(prices: list[float]) -> float | None:
    """Ornstein-Uhlenbeck mean-reversion half-life in days.

    < 15 days = strong mean-reversion candidate
    15-60 days = moderate mean-reversion
    > 60 days = trending, use trend-following strategies
    """
    if len(prices) < 30:
        return None

    # Regress delta_price on lagged_price
    n = len(prices)
    delta = [prices[i] - prices[i - 1] for i in range(1, n)]
    lagged = prices[:-1]

    # Simple OLS: slope = cov(x,y) / var(x)
    mean_x = sum(lagged) / len(lagged)
    mean_y = sum(delta) / len(delta)

    cov_xy = sum((lagged[i] - mean_x) * (delta[i] - mean_y) for i in range(len(delta))) / len(delta)
    var_x = sum((x - mean_x) ** 2 for x in lagged) / len(lagged)

    if var_x == 0:
        return None

    lam = cov_xy / var_x

    if lam >= 0:
        return None  # Not mean-reverting (trending)

    half_life = -math.log(2) / lam
    return min(half_life, 999)  # Cap at 999 days


def _data_confidence(total_days: int) -> float:
    """Scale signal confidence by data depth. 0.0 to 1.0.

    < 90 days = low confidence (0.4-0.65)
    90-365 days = medium confidence (0.65-0.85)
    365+ days = high confidence (0.85-1.0)
    """
    if total_days <= 0:
        return 0.0
    return min(1.0, math.log(max(1, total_days)) / math.log(1000))


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

    # Moving averages — short, medium, and long-term
    result.sma_7 = _sma(prices, 7)
    result.sma_30 = _sma(prices, 30)
    result.sma_90 = _sma(prices, 90)
    result.sma_200 = _sma(prices, 200)
    result.ema_12 = _ema(prices, 12)
    result.ema_26 = _ema(prices, 26)
    result.ema_50 = _ema(prices, 50)

    # RSI
    result.rsi_14 = _rsi(prices, 14)

    # MACD
    result.macd_line, result.macd_signal, result.macd_histogram = _macd(prices)

    # Bollinger Bands
    result.bollinger_upper, result.bollinger_middle, result.bollinger_lower = _bollinger_bands(prices)

    # Momentum (rate of change over last 10 periods)
    if len(prices) >= 10 and prices[-10] != 0:
        result.momentum = ((prices[-1] - prices[-10]) / prices[-10]) * 100

    # Price change percentages — short, medium, and long-term
    def _pct_change(cur, prev):
        return ((cur - prev) / prev) * 100 if prev and prev > 0 else None

    if len(prices) >= 7:
        result.price_change_pct_7d = _pct_change(prices[-1], prices[-7])
    if len(prices) >= 30:
        result.price_change_pct_30d = _pct_change(prices[-1], prices[-30])
    if len(prices) >= 90:
        result.price_change_pct_90d = _pct_change(prices[-1], prices[-90])
    if len(prices) >= 180:
        result.price_change_pct_180d = _pct_change(prices[-1], prices[-180])
    if len(prices) >= 365:
        result.price_change_pct_365d = _pct_change(prices[-1], prices[-365])
    if len(prices) >= 2:
        result.price_change_pct_all = _pct_change(prices[-1], prices[0])

    # All-time high/low and percentile
    result.all_time_high = max(prices)
    result.all_time_low = min(prices)
    if result.all_time_high and result.all_time_high > 0:
        result.pct_from_ath = ((prices[-1] - result.all_time_high) / result.all_time_high) * 100
    price_range = result.all_time_high - result.all_time_low
    if price_range > 0:
        result.price_percentile = ((prices[-1] - result.all_time_low) / price_range) * 100

    # History metadata
    result.total_history_days = len(prices)
    result.first_price_date = str(records[0].date) if records else None

    # Support / Resistance (recent 60-period low/high for more meaningful levels)
    window = prices[-60:] if len(prices) >= 60 else prices
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

    # Regime detection — what phase is this card in?
    result.adx = _adx(prices)
    result.regime = _detect_regime(prices, result.adx)
    result.half_life = _half_life(prices)
    result.data_confidence = _data_confidence(len(prices))

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
    """Get top gainers and losers based on recent price changes.

    Uses a lightweight approach: compares recent prices (last 7 days vs
    7 days before that) using SQL aggregation. Scales to 14K+ cards.
    """
    from sqlalchemy import func, desc, text
    from server.models.card import Card
    from datetime import date, timedelta

    today = date.today()
    recent_start = today - timedelta(days=7)
    prev_start = today - timedelta(days=14)

    # Get average price in last 7 days per card
    recent = (
        db.query(
            PriceHistory.card_id,
            func.avg(PriceHistory.market_price).label("recent_avg"),
        )
        .filter(
            PriceHistory.market_price.isnot(None),
            PriceHistory.date >= recent_start,
        )
        .group_by(PriceHistory.card_id)
        .subquery()
    )

    # Get average price in previous 7 days per card
    prev = (
        db.query(
            PriceHistory.card_id,
            func.avg(PriceHistory.market_price).label("prev_avg"),
        )
        .filter(
            PriceHistory.market_price.isnot(None),
            PriceHistory.date >= prev_start,
            PriceHistory.date < recent_start,
        )
        .group_by(PriceHistory.card_id)
        .subquery()
    )

    # Join and compute change_pct
    rows = (
        db.query(
            Card.id,
            Card.tcg_id,
            Card.name,
            Card.set_name,
            Card.image_small,
            Card.current_price,
            Card.price_variant,
            recent.c.recent_avg,
            prev.c.prev_avg,
        )
        .join(recent, Card.id == recent.c.card_id)
        .join(prev, Card.id == prev.c.card_id)
        .filter(prev.c.prev_avg > 0, Card.current_price.isnot(None), Card.current_price >= 2.0)
        .all()
    )

    movers = []
    for row in rows:
        change_pct = ((row.recent_avg - row.prev_avg) / row.prev_avg) * 100
        movers.append({
            "card_id": row.id,
            "tcg_id": row.tcg_id,
            "name": row.name,
            "set_name": row.set_name,
            "image_small": row.image_small,
            "current_price": row.current_price,
            "previous_price": round(row.prev_avg, 2),
            "change_pct": round(change_pct, 2),
            "variant": row.price_variant,
        })

    movers.sort(key=lambda x: x["change_pct"], reverse=True)

    # Only include cards with positive changes as gainers, negative as losers
    gainers = [m for m in movers if m["change_pct"] > 0][:limit]
    losers = [m for m in movers if m["change_pct"] < 0]
    losers.sort(key=lambda x: x["change_pct"])  # Most negative first
    losers = losers[:limit]

    return {
        "gainers": gainers,
        "losers": losers,
    }


def get_set_relative_strength(db: Session, days: int = 30) -> dict[str, float]:
    """Compute relative strength per set — which sets are outperforming?

    Returns dict of {set_id: relative_strength_score} where > 1.0 means
    outperforming the market average, < 1.0 means underperforming.
    """
    from sqlalchemy import func
    from server.models.card import Card
    from datetime import date, timedelta

    cutoff = date.today() - timedelta(days=days)

    # Average recent return per set
    rows = (
        db.query(
            Card.set_id,
            func.avg(
                (PriceHistory.market_price - Card.current_price) / Card.current_price
            ).label("avg_return"),
        )
        .join(PriceHistory, Card.id == PriceHistory.card_id)
        .filter(
            PriceHistory.date >= cutoff,
            PriceHistory.market_price.isnot(None),
            Card.current_price.isnot(None),
            Card.current_price >= 2.0,
        )
        .group_by(Card.set_id)
        .all()
    )

    if not rows:
        return {}

    returns = {row.set_id: row.avg_return or 0 for row in rows if row.set_id}
    if not returns:
        return {}

    market_avg = sum(returns.values()) / len(returns)
    if market_avg == 0:
        return {k: 1.0 for k in returns}

    return {k: round(v / market_avg, 2) if market_avg != 0 else 1.0
            for k, v in returns.items()}


def get_ensemble_signal(db: Session, card_id: int) -> dict:
    """Run all backtest strategies and vote on the signal.

    Each strategy votes BUY or SELL, weighted by its Sharpe ratio.
    Returns the consensus signal and confidence.
    """
    from server.services.backtesting import run_backtest, STRATEGIES

    votes = {}
    for key in STRATEGIES:
        try:
            result = run_backtest(db, card_id, strategy=key, initial_capital=1000)
            if result and result.total_trades > 0:
                weight = max(0.1, result.sharpe_ratio) if result.sharpe_ratio else 0.1
                votes[key] = {
                    "signal": "BUY" if result.strategy_return_pct > 0 else "SELL",
                    "weight": weight,
                    "return_pct": result.strategy_return_pct,
                    "sharpe": result.sharpe_ratio,
                    "win_rate": result.win_rate,
                }
        except Exception:
            continue

    if not votes:
        return {"signal": "HOLD", "confidence": 0, "strategies": {}}

    buy_weight = sum(v["weight"] for v in votes.values() if v["signal"] == "BUY")
    sell_weight = sum(v["weight"] for v in votes.values() if v["signal"] == "SELL")
    total = buy_weight + sell_weight

    if total == 0:
        return {"signal": "HOLD", "confidence": 0, "strategies": votes}

    confidence = round(abs(buy_weight - sell_weight) / total, 2)
    consensus = "BUY" if buy_weight > sell_weight else "SELL"

    return {
        "signal": consensus,
        "confidence": confidence,
        "buy_weight": round(buy_weight, 2),
        "sell_weight": round(sell_weight, 2),
        "strategies": votes,
    }


def get_hot_cards(db: Session, limit: int = 12) -> list[dict]:
    """Get cards ranked by activity score (volume proxy hotness).

    Uses SQL to pre-rank candidates by price variance, then runs full
    analysis only on the top candidates. Scales to 14K+ cards.
    """
    from server.models.card import Card
    from sqlalchemy import func, desc

    # SQL: compute price stddev and range per card (proxy for volatility/activity)
    # Only cards with 10+ records and a current_price
    candidate_limit = limit * 5  # Analyze top 60 candidates to find the best 12

    stats = (
        db.query(
            PriceHistory.card_id,
            func.count(PriceHistory.id).label("record_count"),
            func.avg(PriceHistory.market_price).label("avg_price"),
            func.min(PriceHistory.market_price).label("min_price"),
            func.max(PriceHistory.market_price).label("max_price"),
        )
        .filter(PriceHistory.market_price.isnot(None))
        .group_by(PriceHistory.card_id)
        .having(func.count(PriceHistory.id) >= 10)
        .subquery()
    )

    # Rank by price range relative to avg (coefficient of variation proxy)
    # Higher range/avg = more volatile = more "hot"
    candidates = (
        db.query(
            stats.c.card_id,
            stats.c.record_count,
            stats.c.avg_price,
            ((stats.c.max_price - stats.c.min_price) / stats.c.avg_price).label("range_ratio"),
        )
        .join(Card, Card.id == stats.c.card_id)
        .filter(Card.current_price.isnot(None), Card.current_price >= 2.0)
        .filter(stats.c.avg_price >= 2.0)
        .order_by(desc("range_ratio"))
        .limit(candidate_limit)
        .all()
    )

    hot = []
    for row in candidates:
        analysis = analyze_card(db, row.card_id)
        if analysis.activity_score is None:
            continue

        card = db.query(Card).filter(Card.id == row.card_id).first()
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
