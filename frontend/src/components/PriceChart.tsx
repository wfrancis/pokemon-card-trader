import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { Box, Typography, Chip, Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { PricePoint, Analysis } from '../services/api';

interface Props {
  priceData: PricePoint[];
  analysis?: Analysis;
  showIndicators?: boolean;
}

type TimeRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';

/** Simple Moving Average over `period` data points. */
function computeSMA(prices: number[], period: number): (number | null)[] {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

/** Bollinger Bands: middle ± k * stddev over `period`. */
function computeBollinger(prices: number[], period = 20, k = 2): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = [];
  const middle: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper.push(null); middle.push(null); lower.push(null);
      continue;
    }
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    middle.push(mean);
    upper.push(mean + k * std);
    lower.push(mean - k * std);
  }
  return { upper, middle, lower };
}

/** Remove outlier spikes: replace points > 3× rolling median with interpolated value. */
function cleanOutliers(prices: number[], windowSize = 7): number[] {
  const cleaned = [...prices];
  for (let i = 0; i < cleaned.length; i++) {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(cleaned.length, i + windowSize + 1);
    const window = cleaned.slice(start, end).sort((a, b) => a - b);
    const median = window[Math.floor(window.length / 2)];
    // If point is > 3x or < 0.33x the local median, treat as outlier
    if (median > 0 && (cleaned[i] > median * 3 || cleaned[i] < median * 0.33)) {
      // Replace with median
      cleaned[i] = median;
    }
  }
  return cleaned;
}

function formatDate(dateStr: string, compact = false): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (compact) {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
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

export default function PriceChart({ priceData, analysis, showIndicators = true }: Props) {
  const [range, setRange] = useState<TimeRange>('ALL');
  const [showSMA7, setShowSMA7] = useState(false);
  const [showSMA30, setShowSMA30] = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);

  const fullChartData = useMemo(() => {
    if (priceData.length === 0) return [];

    // Extract raw market prices, clean outliers
    const rawPrices = priceData.map(p => p.market_price);
    const cleanedPrices = cleanOutliers(rawPrices);

    // Compute overlays on full dataset
    const sma7 = computeSMA(cleanedPrices, 7);
    const sma30 = computeSMA(cleanedPrices, 30);
    const boll = computeBollinger(cleanedPrices, 20, 2);

    return priceData.map((p, i) => ({
      date: p.date,
      price: cleanedPrices[i],
      sma7: sma7[i] ? Math.round(sma7[i]! * 100) / 100 : null,
      sma30: sma30[i] ? Math.round(sma30[i]! * 100) / 100 : null,
      bollUpper: boll.upper[i] ? Math.round(boll.upper[i]! * 100) / 100 : null,
      bollLower: boll.lower[i] ? Math.round(boll.lower[i]! * 100) / 100 : null,
      bollMiddle: boll.middle[i] ? Math.round(boll.middle[i]! * 100) / 100 : null,
    }));
  }, [priceData]);

  const chartData = useMemo(() => filterByRange(fullChartData, range), [fullChartData, range]);

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

  // Y-axis domain: pad 5% above/below the price range in view
  const pricesInView = chartData.map((d: any) => d.price).filter(Boolean);
  const minPrice = Math.min(...pricesInView);
  const maxPrice = Math.max(...pricesInView);
  const padding = (maxPrice - minPrice) * 0.08 || maxPrice * 0.1;
  const yDomain = [Math.max(0, minPrice - padding), maxPrice + padding];

  // Determine tick count based on data density
  const xTickInterval = chartData.length > 365 ? Math.floor(chartData.length / 12) :
                         chartData.length > 90 ? Math.floor(chartData.length / 8) :
                         Math.floor(chartData.length / 6);

  return (
    <Box>
      {/* Price header */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 0.5 }}>
        <Typography variant="h2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
          ${currentPrice?.toFixed(2)}
        </Typography>
        <Typography
          variant="body1"
          sx={{ color: isPositive ? '#00ff41' : '#ff1744', fontWeight: 600, fontFamily: 'monospace' }}
        >
          {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({pctChange.toFixed(1)}%)
        </Typography>
      </Box>

      {/* Signal chips */}
      {showIndicators && analysis && (
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Chip
            label={analysis.signal.toUpperCase()}
            size="small"
            sx={{
              fontWeight: 700,
              bgcolor: analysis.signal === 'bullish' ? '#00ff41' : analysis.signal === 'bearish' ? '#ff1744' : '#ff9800',
              color: '#000',
            }}
          />
          {analysis.rsi_14 !== null && (
            <Chip label={`RSI ${analysis.rsi_14.toFixed(0)}`} size="small" variant="outlined"
              sx={{ borderColor: analysis.rsi_14 < 30 ? '#00ff41' : analysis.rsi_14 > 70 ? '#ff1744' : '#555' }}
            />
          )}
          {analysis.momentum !== null && (
            <Chip
              label={`MOM ${analysis.momentum >= 0 ? '+' : ''}${analysis.momentum.toFixed(1)}%`}
              size="small"
              variant="outlined"
              sx={{ borderColor: analysis.momentum >= 0 ? '#00ff41' : '#ff1744' }}
            />
          )}
        </Stack>
      )}

      {/* Time range + overlay toggles */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <ToggleButtonGroup
          value={range}
          exclusive
          onChange={(_, v) => v && setRange(v)}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              color: '#888', border: '1px solid #333', px: 1.5, py: 0.3,
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

        <Stack direction="row" spacing={0.5}>
          <Chip
            label="SMA 7" size="small" clickable
            onClick={() => setShowSMA7(!showSMA7)}
            sx={{
              fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace',
              bgcolor: showSMA7 ? 'rgba(255,152,0,0.15)' : 'transparent',
              borderColor: showSMA7 ? '#ff9800' : '#444',
              color: showSMA7 ? '#ff9800' : '#666',
            }}
            variant="outlined"
          />
          <Chip
            label="SMA 30" size="small" clickable
            onClick={() => setShowSMA30(!showSMA30)}
            sx={{
              fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace',
              bgcolor: showSMA30 ? 'rgba(0,188,212,0.15)' : 'transparent',
              borderColor: showSMA30 ? '#00bcd4' : '#444',
              color: showSMA30 ? '#00bcd4' : '#666',
            }}
            variant="outlined"
          />
          <Chip
            label="BOLL" size="small" clickable
            onClick={() => setShowBollinger(!showBollinger)}
            sx={{
              fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace',
              bgcolor: showBollinger ? 'rgba(156,39,176,0.15)' : 'transparent',
              borderColor: showBollinger ? '#9c27b0' : '#444',
              color: showBollinger ? '#9c27b0' : '#666',
            }}
            variant="outlined"
          />
        </Stack>
      </Box>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={420}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? '#00ff41' : '#ff1744'} stopOpacity={0.2} />
              <stop offset="100%" stopColor={isPositive ? '#00ff41' : '#ff1744'} stopOpacity={0.01} />
            </linearGradient>
            <linearGradient id="bollGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9c27b0" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#9c27b0" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />

          <XAxis
            dataKey="date"
            tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
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
            tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={false}
            domain={yDomain}
            tickFormatter={(v) => `$${v.toFixed(v >= 100 ? 0 : 2)}`}
            width={65}
          />

          <Tooltip
            contentStyle={{
              backgroundColor: '#111',
              border: '1px solid #333',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'monospace',
              padding: '8px 12px',
            }}
            labelFormatter={(label) => formatDate(label as string)}
            formatter={(value: any, name: any) => {
              const labels: Record<string, string> = {
                price: 'Price', sma7: 'SMA 7', sma30: 'SMA 30',
                bollUpper: 'Boll Upper', bollLower: 'Boll Lower', bollMiddle: 'Boll Mid',
              };
              return [`$${Number(value).toFixed(2)}`, labels[name] || name];
            }}
          />

          {/* Bollinger Bands (shaded area) */}
          {showBollinger && (
            <>
              <Area
                type="monotone" dataKey="bollUpper" stroke="none"
                fill="url(#bollGradient)" fillOpacity={1}
                connectNulls={false} isAnimationActive={false}
                tooltipType="none" name="bollUpperFill"
              />
              <Area
                type="monotone" dataKey="bollLower" stroke="none"
                fill="#0a0a0a" fillOpacity={1}
                connectNulls={false} isAnimationActive={false}
                tooltipType="none" name="bollLowerFill"
              />
              <Line
                type="monotone" dataKey="bollUpper" stroke="#9c27b0" strokeWidth={1}
                strokeDasharray="3 3" dot={false} isAnimationActive={false}
              />
              <Line
                type="monotone" dataKey="bollLower" stroke="#9c27b0" strokeWidth={1}
                strokeDasharray="3 3" dot={false} isAnimationActive={false}
              />
              <Line
                type="monotone" dataKey="bollMiddle" stroke="#9c27b0" strokeWidth={1}
                strokeOpacity={0.4} dot={false} isAnimationActive={false}
              />
            </>
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
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#fff', stroke: isPositive ? '#00ff41' : '#ff1744', strokeWidth: 2 }}
            isAnimationActive={false}
          />

          {/* SMA overlays */}
          {showSMA7 && (
            <Line
              type="monotone" dataKey="sma7" stroke="#ff9800" strokeWidth={1.5}
              dot={false} isAnimationActive={false} connectNulls={false}
            />
          )}
          {showSMA30 && (
            <Line
              type="monotone" dataKey="sma30" stroke="#00bcd4" strokeWidth={1.5}
              dot={false} isAnimationActive={false} connectNulls={false}
            />
          )}

          {/* Support/Resistance lines */}
          {showIndicators && analysis?.support && (
            <ReferenceLine
              y={analysis.support} stroke="#4caf50" strokeDasharray="6 3" strokeWidth={1}
              label={{ value: `S: $${analysis.support.toFixed(2)}`, fill: '#4caf50', fontSize: 10, position: 'left' }}
            />
          )}
          {showIndicators && analysis?.resistance && (
            <ReferenceLine
              y={analysis.resistance} stroke="#f44336" strokeDasharray="6 3" strokeWidth={1}
              label={{ value: `R: $${analysis.resistance.toFixed(2)}`, fill: '#f44336', fontSize: 10, position: 'left' }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </Box>
  );
}
