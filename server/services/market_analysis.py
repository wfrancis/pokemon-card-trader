"""
Wall Street-style technical analysis engine for Pokemon card prices.
Computes SMA, EMA, RSI, MACD, Bollinger Bands, momentum, and generates
bull/bear/hold signals.
"""
import math
from dataclasses import dataclass
from datetime import timedelta
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
    spread_ratio: float | None = None  # Price range ratio: avg (high-low)/market (NOT bid-ask spread)
    momentum_accel: float | None = None  # Change in momentum (2nd derivative)
    activity_score: float | None = None  # Composite hotness 0-100
    adx: float | None = None  # Average Directional Index (trend strength 0-100)
    regime: str | None = None  # accumulation, markup, distribution, markdown
    half_life: float | None = None  # Mean-reversion half-life in days
    last_analyzed_price: float | None = None  # prices[-1] from analysis
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
    """Returns (macd_line, signal_line, histogram).

    MACD = EMA(12) - EMA(26), computed at each price point from index 26 onward.
    Signal = 9-period EMA of the MACD line.
    Histogram = MACD - Signal.
    """
    if len(prices) < 26:
        return None, None, None

    # Compute full EMA-12 series starting from index 12
    mult_12 = 2 / 13
    ema_12 = sum(prices[:12]) / 12
    ema_12_series = [None] * 12  # placeholder for first 12 prices
    ema_12_series.append(ema_12)
    for p in prices[13:]:
        ema_12 = (p - ema_12) * mult_12 + ema_12
        ema_12_series.append(ema_12)

    # Compute full EMA-26 series starting from index 26
    mult_26 = 2 / 27
    ema_26 = sum(prices[:26]) / 26
    ema_26_val = ema_26

    # MACD line = EMA(12) - EMA(26) at each point from index 26 onward
    macd_vals = []
    macd_vals.append(ema_12_series[26] - ema_26_val)
    for i in range(27, len(prices)):
        ema_26_val = (prices[i] - ema_26_val) * mult_26 + ema_26_val
        macd_vals.append(ema_12_series[i] - ema_26_val)

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
    variance = sum((p - middle) ** 2 for p in window) / (period - 1)  # Sample variance (Bessel's correction)
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
    # Scale: 60%+ vol = max (weekly data can have high apparent vol)
    if volatility is not None:
        vol_pts = min(30, volatility * 0.5)
        score += vol_pts
        weight += 30

    # Spread component (0-20 pts) — wider spread = more bidding activity
    # Scale: 40%+ spread = max
    if spread_ratio is not None:
        spread_pts = min(20, spread_ratio * 0.5)
        score += spread_pts
        weight += 20

    # Momentum acceleration (0-25 pts) — accelerating = hot
    # Scale: 125%+ accel = max
    if momentum_accel is not None:
        accel_pts = min(25, abs(momentum_accel) * 0.2)
        score += accel_pts
        weight += 25

    # Recent price change magnitude (0-25 pts) — big moves = hot
    # Scale: 125%+ change = max
    if price_change_7d is not None:
        change_pts = min(25, abs(price_change_7d) * 0.2)
        score += change_pts
        weight += 25

    if weight == 0:
        return None

    return round((score / weight) * 100, 1)


def _filter_dominant_variant(records: list) -> list:
    """Filter price records to only the dominant (most common) variant.

    Mixed-variant data (e.g., normal + holofoil prices for the same card)
    creates fake volatility that corrupts technical indicators and backtests.
    This picks the variant with the most data points and discards the rest.
    """
    if not records:
        return records

    # Count records per variant
    variant_counts: dict[str, int] = {}
    for r in records:
        v = r.variant or ""
        variant_counts[v] = variant_counts.get(v, 0) + 1

    if len(variant_counts) <= 1:
        return records  # Only one variant, no filtering needed

    # Pick the variant with the most data points
    dominant = max(variant_counts, key=variant_counts.get)
    filtered = [r for r in records if (r.variant or "") == dominant]

    if len(filtered) < len(records) * 0.3:
        # Dominant variant has less than 30% of records — data is too fragmented
        # Fall back to all records (outlier cleaning will handle it)
        return records

    return filtered


def analyze_card(db: Session, card_id: int) -> AnalysisResult:
    """Run full technical analysis on a card's price history."""
    from server.models.card import Card as CardModel
    card = db.query(CardModel).filter_by(id=card_id).first()

    # If card has a known variant, filter to only that variant's prices
    query = (
        db.query(PriceHistory)
        .filter(PriceHistory.card_id == card_id, PriceHistory.market_price.isnot(None))
    )
    if card and card.price_variant:
        query = query.filter(PriceHistory.variant == card.price_variant)
    records = query.order_by(asc(PriceHistory.date)).all()

    if not records:
        # Fallback: try all variants if card variant filter returned nothing
        records = (
            db.query(PriceHistory)
            .filter(PriceHistory.card_id == card_id, PriceHistory.market_price.isnot(None))
            .order_by(asc(PriceHistory.date))
            .all()
        )
    if not records:
        return AnalysisResult()

    # Filter to dominant variant to avoid mixed-variant noise (fallback only)
    records = _filter_dominant_variant(records)

    prices = [r.market_price for r in records]

    # Spike detection: remove anomalous price points that are >10x the median
    # These are typically data errors from the source API (e.g., wrong variant price leaking in)
    if len(prices) >= 5:
        sorted_p = sorted(prices)
        median = sorted_p[len(sorted_p) // 2]
        if median > 0:
            filtered = [(r, p) for r, p in zip(records, prices) if p <= median * 10 and p >= median * 0.05]
            if len(filtered) >= 3:  # Keep at least 3 data points
                records = [f[0] for f in filtered]
                prices = [f[1] for f in filtered]

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

    # Price change percentages — use calendar dates, not array indices
    def _pct_change(cur, prev):
        return ((cur - prev) / prev) * 100 if prev and prev > 0 else None

    reference_date = records[-1].date
    current_price = prices[-1]

    def _price_at_days_ago(days_ago, max_gap=10):
        """Find price closest to days_ago calendar days before reference_date."""
        target = reference_date - timedelta(days=days_ago)
        best_price, best_diff = None, max_gap + 1
        for r in records:
            if r.market_price is None:
                continue
            diff = abs((r.date - target).days)
            if diff < best_diff:
                best_diff = diff
                best_price = r.market_price
            if r.date > target and diff > best_diff:
                break
        return best_price

    for days, attr, max_gap in [
        (7, 'price_change_pct_7d', 7),
        (30, 'price_change_pct_30d', 10),
        (90, 'price_change_pct_90d', 15),
        (180, 'price_change_pct_180d', 21),
        (365, 'price_change_pct_365d', 30),
    ]:
        old_price = _price_at_days_ago(days, max_gap)
        if old_price and old_price > 0:
            setattr(result, attr, _pct_change(current_price, old_price))

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
    result.last_analyzed_price = prices[-1]
    result.total_history_days = len(prices)
    result.first_price_date = str(records[0].date) if records else None

    # Support / Resistance — use 10th/90th percentile of recent 60 prices
    # to avoid support=current_price when price is at the absolute low
    window = prices[-60:] if len(prices) >= 60 else prices
    sorted_window = sorted(window)
    n = len(sorted_window)
    # 10th percentile for support, 90th percentile for resistance
    support_idx = max(0, int(n * 0.10))
    resistance_idx = min(n - 1, int(n * 0.90))
    result.support = sorted_window[support_idx]
    result.resistance = sorted_window[resistance_idx]
    # If support >= current price (card is at/below historical lows),
    # extend support 10% below the percentile floor
    if result.support >= prices[-1]:
        result.support = round(sorted_window[0] * 0.90, 2)

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
    Combine indicators into a bull/bear/hold signal using weighted scoring.
    Returns (signal_name, strength from -1.0 to 1.0).

    Weights ensure extreme indicator values (RSI > 80, RSI < 20) dominate
    the signal rather than being diluted by minor trend-following factors.
    """
    if not prices:
        return "hold", 0.0

    current_price = prices[-1]
    weighted_score = 0.0
    total_weight = 0.0

    # RSI signal — weight 3 (heaviest: overbought/oversold is the strongest signal)
    if analysis.rsi_14 is not None:
        rsi_weight = 3.0
        if analysis.rsi_14 > 80:
            weighted_score += -1.0 * rsi_weight   # Extremely overbought
        elif analysis.rsi_14 > 70:
            weighted_score += -0.7 * rsi_weight   # Overbought
        elif analysis.rsi_14 < 20:
            weighted_score += 1.0 * rsi_weight    # Extremely oversold
        elif analysis.rsi_14 < 30:
            weighted_score += 0.7 * rsi_weight    # Oversold
        else:
            # Neutral zone: slight lean based on distance from 50
            weighted_score += ((50 - analysis.rsi_14) / 50) * 0.3 * rsi_weight
        total_weight += rsi_weight

    # MACD signal — weight 2
    if analysis.macd_histogram is not None:
        macd_weight = 2.0
        if analysis.macd_histogram > 0:
            weighted_score += 0.5 * macd_weight
        else:
            weighted_score += -0.5 * macd_weight
        # Bonus: MACD line crossing signal line direction
        if analysis.macd_line is not None and analysis.macd_signal is not None:
            if analysis.macd_line > analysis.macd_signal:
                weighted_score += 0.2 * macd_weight
            else:
                weighted_score += -0.2 * macd_weight
        total_weight += macd_weight

    # Price vs SMA (trend following) — weight 2
    if analysis.sma_30 is not None and analysis.sma_30 != 0:
        sma_weight = 2.0
        pct_from_sma = (current_price - analysis.sma_30) / analysis.sma_30
        if pct_from_sma > 0.10:
            weighted_score += 0.6 * sma_weight   # Well above SMA = bullish trend
        elif pct_from_sma > 0:
            weighted_score += 0.3 * sma_weight   # Slightly above
        elif pct_from_sma < -0.10:
            weighted_score += -0.6 * sma_weight  # Well below SMA = bearish trend
        else:
            weighted_score += -0.3 * sma_weight  # Slightly below
        total_weight += sma_weight

    # Bollinger Band position — weight 1.5
    if analysis.bollinger_lower is not None and analysis.bollinger_upper is not None:
        bb_weight = 1.5
        band_range = analysis.bollinger_upper - analysis.bollinger_lower
        if band_range > 0:
            position = (current_price - analysis.bollinger_lower) / band_range
            if position < 0.2:
                weighted_score += 0.7 * bb_weight   # Near lower band = potential bounce
            elif position > 0.8:
                weighted_score += -0.7 * bb_weight  # Near upper band = potential pullback
            else:
                # Slight lean based on position
                weighted_score += ((0.5 - position) * 0.4) * bb_weight
            total_weight += bb_weight

    # Momentum — weight 1
    if analysis.momentum is not None:
        mom_weight = 1.0
        if analysis.momentum > 10:
            weighted_score += 0.5 * mom_weight
        elif analysis.momentum > 5:
            weighted_score += 0.3 * mom_weight
        elif analysis.momentum < -10:
            weighted_score += -0.5 * mom_weight
        elif analysis.momentum < -5:
            weighted_score += -0.3 * mom_weight
        total_weight += mom_weight

    # Volume proxy: high activity amplifies existing signals — weight 0.5
    if analysis.activity_score is not None and analysis.activity_score > 50:
        act_weight = 0.5
        if weighted_score > 0:
            weighted_score += 0.3 * act_weight
        elif weighted_score < 0:
            weighted_score += -0.3 * act_weight
        total_weight += act_weight

    if total_weight == 0:
        return "hold", 0.0

    strength = max(-1.0, min(1.0, weighted_score / total_weight))

    # Collectibles-appropriate signal names
    # Thresholds calibrated for weighted averaging that pulls toward zero:
    # Most cards will have conflicting indicators, so use lower thresholds
    if strength > 0.3:
        return "buy", strength
    elif strength > 0.08:
        return "accumulate", strength
    elif strength < -0.3:
        return "avoid", strength
    elif strength < -0.08:
        return "reduce", strength
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

    # Get average price in last 7 days per card (same variant only)
    recent = (
        db.query(
            PriceHistory.card_id,
            func.avg(PriceHistory.market_price).label("recent_avg"),
        )
        .join(Card, Card.id == PriceHistory.card_id)
        .filter(
            PriceHistory.market_price.isnot(None),
            PriceHistory.date >= recent_start,
            PriceHistory.variant == Card.price_variant,
        )
        .group_by(PriceHistory.card_id)
        .subquery()
    )

    # Get average price in previous 7 days per card (same variant only)
    prev = (
        db.query(
            PriceHistory.card_id,
            func.avg(PriceHistory.market_price).label("prev_avg"),
        )
        .join(Card, Card.id == PriceHistory.card_id)
        .filter(
            PriceHistory.market_price.isnot(None),
            PriceHistory.date >= prev_start,
            PriceHistory.date < recent_start,
            PriceHistory.variant == Card.price_variant,
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
        .filter(prev.c.prev_avg > 0, Card.current_price.isnot(None), Card.current_price >= 2.0,
                Card.is_tracked == True)
        .all()
    )

    movers = []
    for row in rows:
        if row.prev_avg < 1.0:
            continue  # Skip near-zero prices to avoid division artifacts
        change_pct = ((row.recent_avg - row.prev_avg) / row.prev_avg) * 100
        if abs(change_pct) > 500:
            continue  # Skip extreme values — likely variant mixing artifacts or stale data
        movers.append({
            "card_id": row.id,
            "tcg_id": row.tcg_id,
            "name": row.name,
            "set_name": row.set_name,
            "image_small": row.image_small,
            "current_price": round(row.recent_avg, 2),  # Use recent avg (consistent with change_pct)
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

    # Average recent return per set (current_price - historical = appreciation)
    rows = (
        db.query(
            Card.set_id,
            func.avg(
                (Card.current_price - PriceHistory.market_price) / PriceHistory.market_price
            ).label("avg_return"),
        )
        .join(PriceHistory, Card.id == PriceHistory.card_id)
        .filter(
            PriceHistory.date >= cutoff,
            PriceHistory.market_price.isnot(None),
            Card.current_price.isnot(None),
            Card.current_price >= 2.0,
            Card.is_tracked == True,
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
                sharpe = result.sharpe_ratio or 0
                # Strategies with negative Sharpe get inverted signal and positive weight
                if sharpe < 0:
                    signal = "SELL" if result.strategy_return_pct > 0 else "BUY"
                    weight = min(abs(sharpe), 2.0)  # Cap inverted weight
                else:
                    signal = "BUY" if result.strategy_return_pct > 0 else "SELL"
                    weight = max(0.1, sharpe)
                votes[key] = {
                    "signal": signal,
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
        .join(Card, Card.id == PriceHistory.card_id)
        .filter(PriceHistory.market_price.isnot(None))
        .filter(PriceHistory.variant == Card.price_variant)
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
        .filter(Card.current_price.isnot(None), Card.current_price >= 2.0, Card.is_tracked == True)
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

        # Skip cards with extreme/unrealistic values (data quality issues)
        if analysis.volatility and analysis.volatility > 500:
            continue
        if analysis.price_change_pct_7d and abs(analysis.price_change_pct_7d) > 500:
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
    hot = hot[:limit]

    # Normalize activity scores to 0-100 within the result set for differentiation
    if len(hot) >= 2:
        scores = [h["activity_score"] for h in hot]
        min_s, max_s = min(scores), max(scores)
        if max_s > min_s:
            for h in hot:
                h["activity_score"] = round(
                    (h["activity_score"] - min_s) / (max_s - min_s) * 100, 1
                )

    return hot
