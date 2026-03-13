"""Unit tests for market analysis math functions."""
import pytest
from server.services.market_analysis import (
    _sma, _ema, _rsi, _macd, _bollinger_bands,
)


class TestSMA:
    def test_basic(self):
        prices = [10.0, 20.0, 30.0, 40.0, 50.0]
        assert _sma(prices, 3) == pytest.approx(40.0)  # avg of last 3: 30+40+50 = 120/3
        assert _sma(prices, 5) == pytest.approx(30.0)  # avg of all 5

    def test_insufficient_data(self):
        assert _sma([10.0, 20.0], 3) is None
        assert _sma([], 3) is None

    def test_single_value(self):
        assert _sma([42.0], 1) == pytest.approx(42.0)

    def test_period_equals_length(self):
        prices = [10.0, 20.0, 30.0]
        assert _sma(prices, 3) == pytest.approx(20.0)


class TestEMA:
    def test_basic(self):
        prices = [10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 19.0, 20.0, 21.0, 22.0]
        result = _ema(prices, 12)
        assert result is not None
        # EMA should be close to the SMA for a linear series
        assert 15.0 < result < 22.0

    def test_insufficient_data(self):
        assert _ema([10.0, 20.0], 12) is None

    def test_convergence(self):
        # Constant prices should give EMA equal to the price
        prices = [100.0] * 30
        result = _ema(prices, 12)
        assert result == pytest.approx(100.0)


class TestRSI:
    def test_all_gains(self):
        prices = [float(i) for i in range(1, 20)]  # 1,2,3,...,19 (all gains)
        result = _rsi(prices, 14)
        assert result is not None
        assert result > 95  # Should be very close to 100

    def test_all_losses(self):
        prices = [float(i) for i in range(20, 1, -1)]  # 20,19,...,2 (all losses)
        result = _rsi(prices, 14)
        assert result is not None
        assert result < 5  # Should be very close to 0

    def test_mixed(self):
        prices = [100.0, 105.0, 102.0, 108.0, 103.0, 110.0, 106.0, 112.0,
                  107.0, 115.0, 110.0, 118.0, 112.0, 120.0, 115.0]
        result = _rsi(prices, 14)
        assert result is not None
        assert 30 < result < 70  # Should be somewhere in the middle

    def test_insufficient_data(self):
        assert _rsi([10.0, 20.0], 14) is None


class TestMACD:
    def test_basic(self):
        # Need 26+ prices for MACD
        prices = [100.0 + i * 0.5 for i in range(35)]  # Uptrend
        result = _macd(prices)
        assert result is not None
        macd_line, signal, histogram = result
        # In an uptrend, EMA-12 > EMA-26, so MACD should be positive
        assert macd_line > 0
        # Histogram = MACD line - Signal line
        assert histogram == pytest.approx(macd_line - signal, abs=0.01)

    def test_insufficient_data(self):
        assert _macd([10.0] * 25) == (None, None, None)

    def test_downtrend(self):
        prices = [200.0 - i * 0.5 for i in range(35)]  # Downtrend
        result = _macd(prices)
        assert result is not None
        macd_line, _, _ = result
        assert macd_line < 0  # EMA-12 < EMA-26 in downtrend


class TestBollingerBands:
    def test_basic(self):
        prices = [100.0 + (i % 5) for i in range(25)]  # Oscillating pattern
        result = _bollinger_bands(prices, 20)
        assert result is not None
        upper, middle, lower = result
        assert upper > middle > lower
        # Bands should be symmetric around middle
        assert (upper - middle) == pytest.approx(middle - lower, abs=0.01)

    def test_constant_prices(self):
        prices = [50.0] * 25
        result = _bollinger_bands(prices, 20)
        assert result is not None
        upper, middle, lower = result
        assert middle == pytest.approx(50.0)
        assert upper == pytest.approx(50.0)  # No variance = no spread
        assert lower == pytest.approx(50.0)

    def test_lower_clamped_to_zero(self):
        # With high volatility relative to price, lower band should be clamped at 0
        prices = [1.0, 100.0] * 15  # Extreme volatility on low base
        result = _bollinger_bands(prices, 20)
        if result:
            _, _, lower = result
            assert lower >= 0  # Should never go negative

    def test_insufficient_data(self):
        assert _bollinger_bands([10.0] * 15, 20) == (None, None, None)
