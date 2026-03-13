import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts';
import { Box, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { PricePoint } from '../services/api';

interface Props {
  priceData: PricePoint[];
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

export default function PriceChart({ priceData }: Props) {
  const [range, setRange] = useState<TimeRange>('ALL');

  const fullChartData = useMemo(() => {
    if (priceData.length === 0) return [];
    const rawPrices = priceData.map(p => p.market_price);
    const cleanedPrices = cleanOutliers(rawPrices);
    return priceData.map((p, i) => ({
      date: p.date,
      price: cleanedPrices[i],
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

  const pricesInView = chartData.map((d: any) => d.price).filter(Boolean);
  const minPrice = Math.min(...pricesInView);
  const maxPrice = Math.max(...pricesInView);
  const padding = (maxPrice - minPrice) * 0.08 || maxPrice * 0.1;
  const yDomain = [Math.max(0, minPrice - padding), maxPrice + padding];

  const xTickInterval = chartData.length > 365 ? Math.floor(chartData.length / 12) :
                         chartData.length > 90 ? Math.floor(chartData.length / 8) :
                         Math.floor(chartData.length / 6);

  return (
    <Box>
      {/* Price header */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: { xs: 1, md: 2 }, mb: 0.5 }}>
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

      {/* Time range toggles */}
      <Box sx={{ mb: 1 }}>
        <ToggleButtonGroup
          value={range}
          exclusive
          onChange={(_, v) => v && setRange(v)}
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
      <Box sx={{ height: { xs: 280, sm: 350, md: 420 } }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? '#00ff41' : '#ff1744'} stopOpacity={0.2} />
              <stop offset="100%" stopColor={isPositive ? '#00ff41' : '#ff1744'} stopOpacity={0.01} />
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
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#fff', stroke: isPositive ? '#00ff41' : '#ff1744', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </Box>
    </Box>
  );
}
