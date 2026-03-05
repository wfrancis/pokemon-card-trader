import { useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { Box, Typography, Chip, Stack } from '@mui/material';
import { PricePoint, Analysis } from '../services/api';

interface Props {
  priceData: PricePoint[];
  analysis?: Analysis;
  showIndicators?: boolean;
}

export default function PriceChart({ priceData, analysis, showIndicators = true }: Props) {
  const chartData = useMemo(() => {
    return priceData.map(p => ({
      date: p.date,
      price: p.market_price,
      low: p.low_price,
      high: p.high_price,
    }));
  }, [priceData]);

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

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 1 }}>
        <Typography variant="h2" sx={{ fontWeight: 700 }}>
          ${currentPrice?.toFixed(2)}
        </Typography>
        <Typography
          variant="body1"
          sx={{ color: isPositive ? '#00ff41' : '#ff1744', fontWeight: 600 }}
        >
          {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({pctChange.toFixed(1)}%)
        </Typography>
      </Box>

      {showIndicators && analysis && (
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
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
            <Chip label={`RSI ${analysis.rsi_14.toFixed(0)}`} size="small" variant="outlined" />
          )}
          {analysis.momentum !== null && (
            <Chip
              label={`MOM ${analysis.momentum.toFixed(1)}%`}
              size="small"
              variant="outlined"
              sx={{ borderColor: analysis.momentum >= 0 ? '#00ff41' : '#ff1744' }}
            />
          )}
        </Stack>
      )}

      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#666', fontSize: 10 }}
            tickLine={{ stroke: '#333' }}
          />
          <YAxis
            tick={{ fill: '#666', fontSize: 10 }}
            tickLine={{ stroke: '#333' }}
            domain={['auto', 'auto']}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 4,
              fontSize: 12,
            }}
            formatter={(value: any) => [`$${Number(value).toFixed(2)}`, '']}
          />

          {/* Price range band */}
          <Area
            type="monotone"
            dataKey="high"
            stroke="none"
            fill="#00bcd4"
            fillOpacity={0.05}
          />
          <Area
            type="monotone"
            dataKey="low"
            stroke="none"
            fill="#0a0a0a"
            fillOpacity={1}
          />

          {/* Main price line */}
          <Line
            type="monotone"
            dataKey="price"
            stroke={isPositive ? '#00ff41' : '#ff1744'}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#00bcd4' }}
          />

          {/* Support/Resistance lines */}
          {showIndicators && analysis?.support && (
            <ReferenceLine y={analysis.support} stroke="#ff9800" strokeDasharray="5 5" />
          )}
          {showIndicators && analysis?.resistance && (
            <ReferenceLine y={analysis.resistance} stroke="#ff9800" strokeDasharray="5 5" />
          )}

          <Legend />
        </ComposedChart>
      </ResponsiveContainer>
    </Box>
  );
}
