import { useMemo, useState, useRef, useCallback } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceArea, ReferenceLine,
} from 'recharts';
import { Box, Typography, ToggleButton, ToggleButtonGroup, IconButton, Tooltip as MuiTooltip, Chip } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';
import html2canvas from 'html2canvas';
import { PricePoint } from '../services/api';

interface Props {
  priceData: PricePoint[];
  cardName?: string;
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

export default function PriceChart({ priceData, cardName }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<TimeRange>('ALL');

  // Drag-to-zoom state
  const [refAreaLeft, setRefAreaLeft] = useState<string>('');
  const [refAreaRight, setRefAreaRight] = useState<string>('');
  const [zoomLeft, setZoomLeft] = useState<string>('');
  const [zoomRight, setZoomRight] = useState<string>('');
  const [isZoomed, setIsZoomed] = useState(false);

  const handleExportPng = async () => {
    if (!chartRef.current) return;
    try {
      const canvas = await html2canvas(chartRef.current, { backgroundColor: '#000', scale: 2 });
      const link = document.createElement('a');
      const filename = cardName ? `${cardName.replace(/[^a-zA-Z0-9]/g, '_')}_price_chart.png` : 'price_chart.png';
      link.download = filename;
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

  const fullChartData = useMemo(() => {
    if (priceData.length === 0) return [];
    const rawPrices = priceData.map(p => p.market_price);
    const cleanedPrices = cleanOutliers(rawPrices);
    return priceData.map((p, i) => ({
      date: p.date,
      price: cleanedPrices[i],
    }));
  }, [priceData]);

  const rangeData = useMemo(() => filterByRange(fullChartData, range), [fullChartData, range]);

  // Apply zoom filter on top of range filter
  const chartData = useMemo(() => {
    if (!isZoomed || !zoomLeft || !zoomRight) return rangeData;
    return rangeData.filter(d => d.date >= zoomLeft && d.date <= zoomRight);
  }, [rangeData, isZoomed, zoomLeft, zoomRight]);

  // Reset zoom when range changes
  const handleRangeChange = useCallback((_: any, v: TimeRange | null) => {
    if (v) {
      setRange(v);
      handleResetZoom();
    }
  }, [handleResetZoom]);

  if (chartData.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#666' }}>
        <Typography>No price data available. Sync data to see charts.</Typography>
      </Box>
    );
  }

  const currentPrice = chartData[chartData.length - 1]?.price;
  const firstPrice = chartData[0]?.price;
  const priceChange = currentPrice && firstPrice ? currentPrice - firstPrice : 0;
  const pctChange = firstPrice ? (priceChange / firstPrice) * 100 : 0;
  const isPositive = priceChange >= 0;

  const pricesInView = chartData.map((d: any) => d.price).filter(Boolean);
  const minPrice = Math.min(...pricesInView);
  const maxPrice = Math.max(...pricesInView);
  const padding = (maxPrice - minPrice) * 0.08 || maxPrice * 0.1;
  const yDomain = [Math.max(0, minPrice - padding), maxPrice + padding];

  // Compute median for reference line
  const sortedPrices = [...pricesInView].sort((a, b) => a - b);
  const medianPrice = sortedPrices.length > 0
    ? sortedPrices.length % 2 === 0
      ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
      : sortedPrices[Math.floor(sortedPrices.length / 2)]
    : 0;

  const xTickInterval = chartData.length > 365 ? Math.floor(chartData.length / 12) :
                         chartData.length > 90 ? Math.floor(chartData.length / 8) :
                         Math.floor(chartData.length / 6);

  return (
    <Box ref={chartRef}>
      {/* Price header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, md: 2 }, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="h2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
          ${currentPrice?.toFixed(2)}
        </Typography>
        <Typography
          variant="body1"
          sx={{ color: isPositive ? '#00ff41' : '#ff1744', fontWeight: 600, fontFamily: 'monospace' }}
        >
          {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({pctChange.toFixed(1)}%)
        </Typography>
        <MuiTooltip title="Download as PNG">
          <IconButton onClick={handleExportPng} size="small" sx={{ color: '#888', '&:hover': { color: '#00bcd4' } }}>
            <DownloadIcon fontSize="small" />
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

      {/* Time range toggles */}
      <Box sx={{ mb: 1 }}>
        <ToggleButtonGroup
          value={range}
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

      {/* Chart */}
      <Box sx={{ height: { xs: 280, sm: 350, md: 420 }, cursor: 'crosshair', userSelect: 'none' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
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
              if (range === '1M' || range === '3M') {
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
            formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Price']}
          />

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
      </ResponsiveContainer>
      </Box>
    </Box>
  );
}
