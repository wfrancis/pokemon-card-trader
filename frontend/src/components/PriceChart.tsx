import { useMemo, useState, useRef, useCallback } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceArea, ReferenceLine,
} from 'recharts';
import { Box, Typography, ToggleButton, ToggleButtonGroup, IconButton, Tooltip as MuiTooltip, Chip, Skeleton, Alert } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import html2canvas from 'html2canvas';
import { PricePoint } from '../services/api';

interface CompareData {
  priceData: PricePoint[];
  cardName: string;
  currentPrice?: number | null;
}

interface Props {
  priceData: PricePoint[];
  cardName?: string;
  compareData?: CompareData | null;
  onRemoveCompare?: () => void;
  loading?: boolean;
  error?: string | null;
}

type TimeRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';

/** Remove outlier spikes: replace points > 3x rolling median with interpolated value. */
function cleanOutliers(prices: number[], windowSize = 7): number[] {
  const cleaned = [...prices];
  for (let i = 0; i < cleaned.length; i++) {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(cleaned.length, i + windowSize + 1);
    const window = cleaned.slice(start, end).sort((a, b) => a - b);
    const median = window[Math.floor(window.length / 2)];
    if (median > 0 && (cleaned[i] > median * 3 || cleaned[i] < median * 0.33)) {
      cleaned[i] = median;
    }
  }
  return cleaned;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function filterByRange(data: any[], range: TimeRange): any[] {
  if (range === 'ALL') return data;
  const now = new Date();
  const cutoff = new Date();
  switch (range) {
    case '1M': cutoff.setMonth(now.getMonth() - 1); break;
    case '3M': cutoff.setMonth(now.getMonth() - 3); break;
    case '6M': cutoff.setMonth(now.getMonth() - 6); break;
    case '1Y': cutoff.setFullYear(now.getFullYear() - 1); break;
  }
  const cutoffStr = cutoff.toISOString().split('T')[0];
  return data.filter(d => d.date >= cutoffStr);
}

/** Round a price to a clean tick value */
function cleanTickValue(v: number): string {
  if (v >= 1000) return `$${Math.round(v).toLocaleString()}`;
  if (v >= 100) return `$${Math.round(v)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

/** Determine the best default time range based on data span */
function getBestDefaultRange(data: { date: string }[]): TimeRange {
  if (data.length === 0) return 'ALL';
  const firstDate = new Date(data[0].date + 'T00:00:00');
  const lastDate = new Date(data[data.length - 1].date + 'T00:00:00');
  const spanDays = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
  if (spanDays <= 35) return 'ALL'; // Less than ~1 month, show all
  if (spanDays <= 100) return '3M';
  if (spanDays <= 200) return '6M';
  if (spanDays <= 400) return '1Y';
  return 'ALL';
}

export default function PriceChart({ priceData, cardName, compareData, onRemoveCompare, loading, error }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<TimeRange | null>(null); // null = auto-select
  const [showBB, setShowBB] = useState(true);

  // Drag-to-zoom state
  const [refAreaLeft, setRefAreaLeft] = useState<string>('');
  const [refAreaRight, setRefAreaRight] = useState<string>('');
  const [zoomLeft, setZoomLeft] = useState<string>('');
  const [zoomRight, setZoomRight] = useState<string>('');
  const [isZoomed, setIsZoomed] = useState(false);

  const isComparing = !!(compareData && compareData.priceData.length > 0);

  const handleExportPng = async () => {
    if (!chartRef.current) return;
    try {
      const watermark = document.createElement('div');
      watermark.style.cssText = 'text-align:center;padding:16px;color:#666;font-size:14px;font-family:monospace;';
      watermark.textContent = 'PKMN TRADER \u2022 pokemon-card-trader.fly.dev';
      chartRef.current.appendChild(watermark);

      const canvas = await html2canvas(chartRef.current, { backgroundColor: '#000', scale: 2 });

      chartRef.current.removeChild(watermark);

      const link = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      const safeName = cardName ? cardName.replace(/[^a-zA-Z0-9]/g, '_') : 'card';
      link.download = `pkmn_${safeName}_price_${dateStr}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const handleResetZoom = useCallback(() => {
    setZoomLeft('');
    setZoomRight('');
    setIsZoomed(false);
  }, []);

  const handleMouseDown = useCallback((e: any) => {
    if (e && e.activeLabel) setRefAreaLeft(e.activeLabel);
  }, []);

  const handleMouseMove = useCallback((e: any) => {
    if (refAreaLeft && e && e.activeLabel) setRefAreaRight(e.activeLabel);
  }, [refAreaLeft]);

  const handleMouseUp = useCallback(() => {
    if (refAreaLeft && refAreaRight) {
      const [left, right] = [refAreaLeft, refAreaRight].sort();
      setZoomLeft(left);
      setZoomRight(right);
      setIsZoomed(true);
    }
    setRefAreaLeft('');
    setRefAreaRight('');
  }, [refAreaLeft, refAreaRight]);

  // Filter out $0/null prices before processing
  const cleanedPriceData = useMemo(() => {
    return priceData.filter(p => p.market_price != null && p.market_price > 0);
  }, [priceData]);

  const fullChartData = useMemo(() => {
    if (cleanedPriceData.length === 0) return [];
    const rawPrices = cleanedPriceData.map(p => p.market_price);
    const cleanedPrices = cleanOutliers(rawPrices);
    return cleanedPriceData.map((p, i) => ({
      date: p.date,
      price: cleanedPrices[i],
    }));
  }, [cleanedPriceData]);

  // Process compare card data (also filter $0/null)
  const fullCompareData = useMemo(() => {
    if (!compareData || compareData.priceData.length === 0) return [];
    const filtered = compareData.priceData.filter(p => p.market_price != null && p.market_price > 0);
    if (filtered.length === 0) return [];
    const rawPrices = filtered.map(p => p.market_price);
    const cleanedPrices = cleanOutliers(rawPrices);
    return filtered.map((p, i) => ({
      date: p.date,
      price: cleanedPrices[i],
    }));
  }, [compareData]);

  // Auto-select best range on first render
  const effectiveRange = range ?? getBestDefaultRange(fullChartData);

  const rangeData = useMemo(() => filterByRange(fullChartData, effectiveRange), [fullChartData, effectiveRange]);
  const rangeCompareData = useMemo(() => filterByRange(fullCompareData, effectiveRange), [fullCompareData, effectiveRange]);

  // Apply zoom filter on top of range filter
  const chartData = useMemo(() => {
    if (!isZoomed || !zoomLeft || !zoomRight) return rangeData;
    return rangeData.filter(d => d.date >= zoomLeft && d.date <= zoomRight);
  }, [rangeData, isZoomed, zoomLeft, zoomRight]);

  // Compute SMA overlay data (rolling average over data points, not calendar days)
  const smaData = useMemo(() => {
    const calcSMA = (data: { date: string; price: number }[], window: number) => {
      return data.map((point, i) => {
        if (i < window - 1) return null;
        let sum = 0;
        for (let j = i - window + 1; j <= i; j++) {
          sum += data[j].price;
        }
        return sum / window;
      });
    };
    const sma30 = calcSMA(chartData, 30);
    // Use 60-point window (or all data if < 60 points) for longer-term SMA
    const longWindow = Math.min(90, Math.max(60, Math.floor(chartData.length * 0.6)));
    const sma90 = calcSMA(chartData, longWindow);

    // Bollinger Bands: 20-period SMA +/- 2 * stddev
    const bbWindow = 20;
    const bbUpper: (number | null)[] = [];
    const bbLower: (number | null)[] = [];
    for (let i = 0; i < chartData.length; i++) {
      if (i < bbWindow - 1) {
        bbUpper.push(null);
        bbLower.push(null);
      } else {
        let sum = 0;
        for (let j = i - bbWindow + 1; j <= i; j++) sum += chartData[j].price;
        const mean = sum / bbWindow;
        let sqSum = 0;
        for (let j = i - bbWindow + 1; j <= i; j++) sqSum += (chartData[j].price - mean) ** 2;
        const stddev = Math.sqrt(sqSum / bbWindow);
        bbUpper.push(mean + 2 * stddev);
        bbLower.push(Math.max(0, mean - 2 * stddev));
      }
    }

    return chartData.map((d, i) => ({
      ...d,
      sma30: sma30[i],
      sma90: sma90[i],
      bbUpper: bbUpper[i],
      bbLower: bbLower[i],
    }));
  }, [chartData]);

  const compareChartData = useMemo(() => {
    if (!isZoomed || !zoomLeft || !zoomRight) return rangeCompareData;
    return rangeCompareData.filter(d => d.date >= zoomLeft && d.date <= zoomRight);
  }, [rangeCompareData, isZoomed, zoomLeft, zoomRight]);

  // Build normalized (% change) merged dataset for compare mode
  const mergedCompareData = useMemo(() => {
    if (!isComparing || chartData.length === 0 || compareChartData.length === 0) return [];
    // Build lookup maps by date
    const primaryMap = new Map(chartData.map(d => [d.date, d.price]));
    const compareMap = new Map(compareChartData.map(d => [d.date, d.price]));
    // Get all unique dates sorted
    const allDates = Array.from(new Set([...chartData.map(d => d.date), ...compareChartData.map(d => d.date)])).sort();
    // Find first date where both have data for baseline
    const firstBothDate = allDates.find(d => primaryMap.has(d) && compareMap.has(d));
    if (!firstBothDate) return [];
    const primaryBaseline = primaryMap.get(firstBothDate)!;
    const compareBaseline = compareMap.get(firstBothDate)!;
    if (primaryBaseline === 0 || compareBaseline === 0) return [];
    return allDates.map(date => {
      const pPrice = primaryMap.get(date);
      const cPrice = compareMap.get(date);
      return {
        date,
        primaryPct: pPrice != null ? ((pPrice - primaryBaseline) / primaryBaseline) * 100 : undefined,
        comparePct: cPrice != null ? ((cPrice - compareBaseline) / compareBaseline) * 100 : undefined,
        primaryPrice: pPrice,
        comparePrice: cPrice,
      };
    }).filter(d => d.primaryPct !== undefined || d.comparePct !== undefined);
  }, [isComparing, chartData, compareChartData]);

  // Reset zoom when range changes
  const handleRangeChange = useCallback((_: any, v: TimeRange | null) => {
    if (v) {
      setRange(v);
      handleResetZoom();
    }
  }, [handleResetZoom]);

  // Auto-fallback to ALL if selected range has no data but full dataset does
  const hasDataButNotInRange = chartData.length === 0 && fullChartData.length > 0 && effectiveRange !== 'ALL';
  if (hasDataButNotInRange) {
    // Auto-switch to ALL range
    setTimeout(() => setRange('ALL'), 0);
  }

  // Stale data check: warn if most recent data is > 7 days old
  const staleWarning = useMemo(() => {
    if (fullChartData.length === 0) return null;
    const lastDate = new Date(fullChartData[fullChartData.length - 1].date + 'T00:00:00');
    const daysSinceUpdate = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceUpdate > 7) {
      return `Price data last updated: ${lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Current price may differ.`;
    }
    return null;
  }, [fullChartData]);

  // Loading state
  if (loading) {
    return (
      <Box>
        <Skeleton variant="text" width={180} height={50} sx={{ bgcolor: '#1a1a1a' }} />
        <Skeleton variant="text" width={120} height={24} sx={{ bgcolor: '#1a1a1a', mb: 1 }} />
        <Skeleton variant="rectangular" height={350} sx={{ bgcolor: '#1a1a1a', borderRadius: 1 }} />
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <Alert severity="error" sx={{ bgcolor: '#1a0000', color: '#ff6b6b', border: '1px solid #330000', fontFamily: 'monospace' }}>
          Unable to load chart data. Try refreshing the page.
        </Alert>
      </Box>
    );
  }

  if (chartData.length === 0 && fullChartData.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#666' }}>
        <Typography>Price history not yet available for this card.</Typography>
      </Box>
    );
  }

  const currentPrice = chartData[chartData.length - 1]?.price;
  const firstPrice = chartData[0]?.price;
  const priceChange = currentPrice && firstPrice ? currentPrice - firstPrice : 0;
  const pctChange = firstPrice ? (priceChange / firstPrice) * 100 : 0;
  const isPositive = priceChange >= 0;

  // Determine if we have too few data points for a meaningful chart
  const uniquePrices = new Set(chartData.map(d => d.price));
  const hasLimitedData = chartData.length <= 3;
  const allSamePrice = uniquePrices.size <= 1 && chartData.length > 0;
  // For change display: show N/A if only 1 point or all same price
  const showChangeAsNA = chartData.length <= 1 || allSamePrice;

  // If limited data OR all prices identical, show a static price display instead of a misleading flat chart
  if (hasLimitedData || allSamePrice) {
    return (
      <Box ref={chartRef}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, md: 2 }, mb: 0.5, flexWrap: 'wrap' }}>
          <Typography variant="h2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
            ${currentPrice?.toFixed(2)}
          </Typography>
          <Typography
            variant="body1"
            sx={{ color: '#888', fontWeight: 600, fontFamily: 'monospace' }}
          >
            {showChangeAsNA ? '\u2014' : `${isPositive ? '+' : ''}${priceChange.toFixed(2)} (${pctChange.toFixed(1)}%)`}
          </Typography>
        </Box>
        {staleWarning && (
          <Alert
            severity="warning"
            icon={<WarningAmberIcon sx={{ fontSize: 16 }} />}
            sx={{ mb: 1, bgcolor: '#1a1500', color: '#ffb74d', border: '1px solid #332200', fontFamily: 'monospace', fontSize: '0.75rem', py: 0, '& .MuiAlert-icon': { color: '#ffb74d' } }}
          >
            {staleWarning}
          </Alert>
        )}
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 200, color: '#666', border: '1px solid #222', borderRadius: 1,
          bgcolor: '#0a0a0a', flexDirection: 'column', gap: 1,
        }}>
          <Typography sx={{ color: '#888', fontSize: '0.85rem', fontFamily: 'monospace' }}>
            {allSamePrice && chartData.length > 3
              ? `Price unchanged at $${currentPrice?.toFixed(2)} across ${chartData.length} data points`
              : `Limited price history \u2014 only ${chartData.length} data point${chartData.length !== 1 ? 's' : ''} available`}
          </Typography>
          <Typography sx={{ color: '#555', fontSize: '0.75rem', fontFamily: 'monospace' }}>
            {allSamePrice && chartData.length > 3
              ? 'Chart will appear when price variation is detected'
              : 'Chart will appear as more price data is collected'}
          </Typography>
        </Box>
      </Box>
    );
  }

  const pricesInView = chartData.map((d: any) => d.price).filter(Boolean);
  const minPrice = Math.min(...pricesInView);
  const maxPrice = Math.max(...pricesInView);
  // Ensure at least 5% padding so the line isn't pressed against edges
  const rawPadding = (maxPrice - minPrice) * 0.08;
  const minPadding = maxPrice * 0.05 || 0.5; // At least 5% of max, or $0.50
  const padding = Math.max(rawPadding, minPadding);
  const yDomain: [number, number] = [Math.max(0, minPrice - padding), maxPrice + padding];

  // Compute median for reference line
  const sortedPrices = [...pricesInView].sort((a, b) => a - b);
  const medianPrice = sortedPrices.length > 0
    ? sortedPrices.length % 2 === 0
      ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
      : sortedPrices[Math.floor(sortedPrices.length / 2)]
    : 0;

  // Compare card % change stats
  const compareCurrentPrice = compareChartData.length > 0 ? compareChartData[compareChartData.length - 1]?.price : null;
  const compareFirstPrice = compareChartData.length > 0 ? compareChartData[0]?.price : null;
  const comparePctChange = compareFirstPrice ? ((compareCurrentPrice! - compareFirstPrice) / compareFirstPrice) * 100 : 0;

  // Y domain for compare mode (% change)
  const compareYDomain: [number, number] = (() => {
    if (!isComparing || mergedCompareData.length === 0) return [-10, 10] as [number, number];
    const allPcts = mergedCompareData.flatMap(d => [d.primaryPct, d.comparePct]).filter((v): v is number => v !== undefined);
    if (allPcts.length === 0) return [-10, 10] as [number, number];
    const minPct = Math.min(...allPcts);
    const maxPct = Math.max(...allPcts);
    const pctPadding = (maxPct - minPct) * 0.1 || 5;
    return [minPct - pctPadding, maxPct + pctPadding];
  })();

  const activeData = isComparing ? mergedCompareData : chartData;
  const xTickInterval = activeData.length > 365 ? Math.floor(activeData.length / 12) :
                         activeData.length > 90 ? Math.floor(activeData.length / 8) :
                         activeData.length <= 7 ? 0 :
                         Math.floor(activeData.length / 6);

  return (
    <Box ref={chartRef}>
      {/* Price header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, md: 2 }, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="h2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
          ${currentPrice?.toFixed(2)}
        </Typography>
        <Typography
          variant="body1"
          sx={{ color: showChangeAsNA ? '#888' : isPositive ? '#00ff41' : '#ff1744', fontWeight: 600, fontFamily: 'monospace' }}
        >
          {showChangeAsNA ? '\u2014' : `${isPositive ? '+' : ''}${priceChange.toFixed(2)} (${pctChange.toFixed(1)}%)`}
        </Typography>
        <MuiTooltip title="Save Chart as PNG">
          <IconButton onClick={handleExportPng} size="small" sx={{ color: '#888', border: '1px solid #333', borderRadius: 1, px: 1, '&:hover': { color: '#00bcd4', borderColor: '#00bcd4' } }}>
            <DownloadIcon sx={{ fontSize: 16, mr: 0.5 }} />
            <Typography sx={{ fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 600 }}>Save Chart</Typography>
          </IconButton>
        </MuiTooltip>
        {isZoomed && (
          <Chip
            icon={<ZoomOutMapIcon sx={{ fontSize: 14 }} />}
            label="Reset Zoom"
            size="small"
            onClick={handleResetZoom}
            sx={{
              color: '#00bcd4',
              borderColor: '#00bcd4',
              fontFamily: 'monospace',
              fontSize: '0.7rem',
              height: 24,
              '& .MuiChip-icon': { color: '#00bcd4' },
              '&:hover': { bgcolor: 'rgba(0,188,212,0.15)' },
            }}
            variant="outlined"
          />
        )}
      </Box>

      {/* Stale data warning */}
      {staleWarning && (
        <Alert
          severity="warning"
          icon={<WarningAmberIcon sx={{ fontSize: 16 }} />}
          sx={{ mb: 1, bgcolor: '#1a1500', color: '#ffb74d', border: '1px solid #332200', fontFamily: 'monospace', fontSize: '0.75rem', py: 0, '& .MuiAlert-icon': { color: '#ffb74d' } }}
        >
          {staleWarning}
        </Alert>
      )}

      {/* Compare legend */}
      {isComparing && compareData && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 3, bgcolor: '#00ff41', borderRadius: 1 }} />
            <Typography sx={{ color: '#ccc', fontSize: '0.7rem', fontFamily: 'monospace', fontWeight: 600 }}>
              {cardName || 'Primary'} (${currentPrice?.toFixed(2)})
            </Typography>
            <Typography sx={{ color: pctChange >= 0 ? '#00ff41' : '#ff1744', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700 }}>
              {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(1)}%
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 3, bgcolor: '#00bcd4', borderRadius: 1 }} />
            <Typography sx={{ color: '#ccc', fontSize: '0.7rem', fontFamily: 'monospace', fontWeight: 600 }}>
              {compareData.cardName} (${compareCurrentPrice?.toFixed(2)})
            </Typography>
            <Typography sx={{ color: comparePctChange >= 0 ? '#00ff41' : '#ff1744', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700 }}>
              {comparePctChange >= 0 ? '+' : ''}{comparePctChange.toFixed(1)}%
            </Typography>
            {onRemoveCompare && (
              <IconButton onClick={onRemoveCompare} size="small" sx={{ color: '#666', p: 0.2, '&:hover': { color: '#ff1744' } }}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            )}
          </Box>
          <Typography sx={{ color: '#555', fontSize: '0.6rem', fontFamily: 'monospace' }}>
            Normalized to % change
          </Typography>
        </Box>
      )}

      {/* Time range toggles */}
      <Box sx={{ mb: 1 }}>
        <ToggleButtonGroup
          value={effectiveRange}
          exclusive
          onChange={handleRangeChange}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              color: '#888', border: '1px solid #333', px: { xs: 1, md: 1.5 }, py: { xs: 0.5, md: 0.3 },
              fontSize: '0.7rem', fontWeight: 600, fontFamily: 'monospace',
              '&.Mui-selected': { color: '#00bcd4', bgcolor: 'rgba(0,188,212,0.1)', borderColor: '#00bcd4' },
              '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
            },
          }}
        >
          {(['1M', '3M', '6M', '1Y', 'ALL'] as TimeRange[]).map(r => (
            <ToggleButton key={r} value={r}>{r}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* SMA Legend + BB Toggle */}
      {!isComparing && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5, flexWrap: 'wrap' }}>
          {chartData.length >= 30 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 16, height: 0, borderTop: '2px dashed #00bcd4' }} />
              <Typography sx={{ color: '#00bcd4', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 600 }}>
                30d SMA
              </Typography>
            </Box>
          )}
          {chartData.length >= 90 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 16, height: 0, borderTop: '2px dashed #ff9800' }} />
              <Typography sx={{ color: '#ff9800', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 600 }}>
                90d SMA
              </Typography>
            </Box>
          )}
          {chartData.length >= 20 && (
            <MuiTooltip title="Bollinger Bands show price volatility -- when price touches the upper band, it may be overbought">
              <Chip
                label="Bollinger Bands"
                size="small"
                onClick={() => setShowBB(!showBB)}
                sx={{
                  height: 20,
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  color: showBB ? '#00bcd4' : '#555',
                  borderColor: showBB ? '#00bcd4' : '#333',
                  bgcolor: showBB ? 'rgba(0,188,212,0.1)' : 'transparent',
                  '&:hover': { bgcolor: 'rgba(0,188,212,0.15)' },
                }}
                variant="outlined"
              />
            </MuiTooltip>
          )}
          {showBB && chartData.length >= 20 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 16, height: 8, bgcolor: '#00bcd420', border: '1px solid #00bcd440', borderRadius: 0.5 }} />
              <Typography sx={{ color: '#00bcd4', fontSize: '0.6rem', fontFamily: 'monospace', fontWeight: 600, opacity: 0.8 }}>
                Bollinger Bands (20, 2)
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Chart */}
      <Box sx={{ height: { xs: 280, sm: 350, md: 420 }, minHeight: 250, cursor: 'crosshair', userSelect: 'none' }}>
      <ResponsiveContainer width="100%" height="100%">
        {isComparing && mergedCompareData.length > 0 ? (
          /* Compare mode: normalized % change chart */
          <ComposedChart
            data={mergedCompareData}
            margin={{ top: 5, right: 10, bottom: 5, left: 5 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <CartesianGrid strokeDasharray="2 4" stroke="#222" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: '#888', fontSize: 11, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={{ stroke: '#222' }}
              interval={xTickInterval}
              tickFormatter={(d) => {
                const dt = new Date(d + 'T00:00:00');
                if (effectiveRange === '1M' || effectiveRange === '3M') {
                  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }
                return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
              }}
            />
            <YAxis
              tick={{ fill: '#888', fontSize: 11, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={false}
              domain={compareYDomain}
              tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
              width={55}
            />
            <ReferenceLine y={0} stroke="#444" strokeWidth={1} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#111',
                border: '1px solid #333',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'monospace',
                padding: '10px 14px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
              }}
              labelStyle={{ color: '#ccc', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
              labelFormatter={(label) => formatDate(label as string)}
              formatter={(value: any, name: any) => {
                if (name === 'primaryPct') return [`${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`, cardName || 'Primary'];
                if (name === 'comparePct') return [`${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`, compareData?.cardName || 'Compare'];
                return [value, name];
              }}
            />
            <Line
              type="monotone"
              dataKey="primaryPct"
              stroke="#00ff41"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: '#fff', stroke: '#00ff41', strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="comparePct"
              stroke="#00bcd4"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: '#fff', stroke: '#00bcd4', strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls
            />
            {refAreaLeft && refAreaRight && (
              <ReferenceArea
                x1={refAreaLeft}
                x2={refAreaRight}
                strokeOpacity={0.3}
                fill="#00bcd4"
                fillOpacity={0.1}
              />
            )}
          </ComposedChart>
        ) : (
          /* Standard single-card chart */
          <ComposedChart
            data={smaData}
            margin={{ top: 5, right: 10, bottom: 5, left: 5 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isPositive ? '#00ff41' : '#ff1744'} stopOpacity={0.35} />
                <stop offset="15%" stopColor={isPositive ? '#00ff41' : '#ff1744'} stopOpacity={0.2} />
                <stop offset="40%" stopColor={isPositive ? '#00ff41' : '#ff1744'} stopOpacity={0.1} />
                <stop offset="70%" stopColor={isPositive ? '#00ff41' : '#ff1744'} stopOpacity={0.04} />
                <stop offset="100%" stopColor={isPositive ? '#00ff41' : '#ff1744'} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="2 4" stroke="#222" vertical={false} />

            <XAxis
              dataKey="date"
              tick={{ fill: '#888', fontSize: 11, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={{ stroke: '#222' }}
              interval={xTickInterval}
              tickFormatter={(d) => {
                const dt = new Date(d + 'T00:00:00');
                if (effectiveRange === '1M' || effectiveRange === '3M') {
                  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }
                return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
              }}
            />
            <YAxis
              tick={{ fill: '#888', fontSize: 11, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={false}
              domain={yDomain}
              tickFormatter={cleanTickValue}
              width={65}
            />

            {/* Median reference line */}
            {medianPrice > 0 && (
              <ReferenceLine
                y={medianPrice}
                stroke="#666"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: `Median $${medianPrice >= 100 ? Math.round(medianPrice) : medianPrice.toFixed(2)}`,
                  position: 'right',
                  fill: '#666',
                  fontSize: 10,
                  fontFamily: 'monospace',
                }}
              />
            )}

            <Tooltip
              contentStyle={{
                backgroundColor: '#111',
                border: '1px solid #333',
                borderRadius: 6,
                fontSize: 13,
                fontFamily: 'monospace',
                padding: '10px 14px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
              }}
              labelStyle={{ color: '#ccc', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
              labelFormatter={(label) => formatDate(label as string)}
              formatter={(value: any, name: any) => {
                if (value == null) return [null, null];
                const v = `$${Number(value).toFixed(2)}`;
                if (name === 'sma30') return [v, '30d SMA'];
                if (name === 'sma90') return [v, '90d SMA'];
                if (name === 'priceFill') return [null, null];
                if (name === 'bbUpper') return [v, 'BB Upper'];
                if (name === 'bbLower') return [v, 'BB Lower'];
                if (name === 'bbArea' || name === 'bbLowerMask') return [null, null];
                return [v, 'Price'];
              }}
            />

            {/* Bollinger Bands: upper and lower lines with filled area between */}
            {showBB && chartData.length >= 20 && (
              <Area
                type="monotone"
                dataKey="bbUpper"
                stroke="#00bcd440"
                strokeWidth={1}
                fill="#00bcd4"
                fillOpacity={0.06}
                isAnimationActive={false}
                tooltipType="none"
                name="bbUpper"
                connectNulls={false}
              />
            )}
            {showBB && chartData.length >= 20 && (
              <Area
                type="monotone"
                dataKey="bbLower"
                stroke="#00bcd440"
                strokeWidth={1}
                fill="#000000"
                fillOpacity={0.9}
                isAnimationActive={false}
                tooltipType="none"
                name="bbLower"
                connectNulls={false}
              />
            )}

            {/* Price fill gradient */}
            <Area
              type="monotone"
              dataKey="price"
              stroke="none"
              fill="url(#priceGradient)"
              fillOpacity={1}
              isAnimationActive={false}
              tooltipType="none"
              name="priceFill"
            />

            {/* Main price line */}
            <Line
              type="monotone"
              dataKey="price"
              stroke={isPositive ? '#00ff41' : '#ff1744'}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: '#fff', stroke: isPositive ? '#00ff41' : '#ff1744', strokeWidth: 2 }}
              isAnimationActive={false}
            />

            {/* 30-day SMA overlay */}
            <Line
              type="monotone"
              dataKey="sma30"
              stroke="#00bcd4"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls={false}
              name="30d SMA"
            />

            {/* 90-day SMA overlay */}
            <Line
              type="monotone"
              dataKey="sma90"
              stroke="#ff9800"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls={false}
              name="90d SMA"
            />

            {/* Drag-to-zoom selection area */}
            {refAreaLeft && refAreaRight && (
              <ReferenceArea
                x1={refAreaLeft}
                x2={refAreaRight}
                strokeOpacity={0.3}
                fill="#00bcd4"
                fillOpacity={0.1}
              />
            )}
          </ComposedChart>
        )}
      </ResponsiveContainer>
      </Box>
    </Box>
  );
}
