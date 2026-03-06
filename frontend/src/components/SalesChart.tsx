import { useMemo, useState, useCallback } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { Box, Typography, Stack, Chip, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { SaleRecord } from '../services/api';

interface Props {
  sales: SaleRecord[];
  medianPrice: number | null;
  cardName: string;
}

type TimeRange = '1W' | '1M' | '3M' | '6M' | 'ALL';

const CONDITION_COLORS: Record<string, string> = {
  'Near Mint': '#00ff41',
  'Lightly Played': '#76ff03',
  'Moderately Played': '#ff9800',
  'Heavily Played': '#ff5722',
  'Damaged': '#b71c1c',
};

const CONDITION_SHORT: Record<string, string> = {
  'Near Mint': 'NM',
  'Lightly Played': 'LP',
  'Moderately Played': 'MP',
  'Heavily Played': 'HP',
  'Damaged': 'DMG',
};

function getConditionColor(condition: string): string {
  return CONDITION_COLORS[condition] || '#888';
}

export default function SalesChart({ sales, medianPrice, cardName }: Props) {
  const [range, setRange] = useState<TimeRange>('ALL');
  const [selectedConditions, setSelectedConditions] = useState<Set<string>>(new Set());

  // Parse and prepare data
  const chartData = useMemo(() => {
    if (!sales.length) return [];

    const now = new Date();
    const cutoff = new Date();
    switch (range) {
      case '1W': cutoff.setDate(now.getDate() - 7); break;
      case '1M': cutoff.setMonth(now.getMonth() - 1); break;
      case '3M': cutoff.setMonth(now.getMonth() - 3); break;
      case '6M': cutoff.setMonth(now.getMonth() - 6); break;
      case 'ALL': cutoff.setFullYear(2000); break;
    }

    return sales
      .filter(s => {
        const d = new Date(s.order_date);
        if (d < cutoff) return false;
        if (selectedConditions.size > 0 && !selectedConditions.has(s.condition)) return false;
        return true;
      })
      .map(s => ({
        timestamp: new Date(s.order_date).getTime(),
        price: s.purchase_price,
        condition: s.condition,
        variant: s.variant,
        title: s.listing_title,
        source: s.source,
        sourceProductId: s.source_product_id,
        date: new Date(s.order_date).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        }),
        time: new Date(s.order_date).toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit',
        }),
        shipping: s.shipping_price,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [sales, range, selectedConditions]);

  // Get unique conditions present
  const conditions = useMemo(() => {
    const set = new Set(sales.map(s => s.condition));
    return Array.from(set).sort();
  }, [sales]);

  const toggleCondition = useCallback((cond: string) => {
    setSelectedConditions(prev => {
      const next = new Set(prev);
      if (next.has(cond)) {
        next.delete(cond);
      } else {
        next.add(cond);
      }
      return next;
    });
  }, []);

  // Click handler — open TCGPlayer product page
  const handleDotClick = useCallback((data: any) => {
    const payload = data?.payload;
    if (payload?.sourceProductId) {
      window.open(
        `https://www.tcgplayer.com/product/${payload.sourceProductId}`,
        '_blank'
      );
    }
  }, []);

  if (chartData.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#666' }}>
        <Typography>
          No sales data yet. Sales are collected every 6 hours from TCGPlayer.
        </Typography>
      </Box>
    );
  }

  // Compute stats
  const prices = chartData.map(d => d.price);
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const median = sortedPrices[Math.floor(sortedPrices.length / 2)];
  const minPrice = sortedPrices[0];
  const maxPrice = sortedPrices[sortedPrices.length - 1];
  const padding = (maxPrice - minPrice) * 0.1 || maxPrice * 0.1;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 0.5 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
          COMPLETED SALES
        </Typography>
        <Typography variant="body2" sx={{ color: '#888', fontFamily: 'monospace' }}>
          {chartData.length} sale{chartData.length !== 1 ? 's' : ''} · Median ${median.toFixed(2)}
        </Typography>
      </Box>

      {/* Time range + condition filters */}
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
            },
          }}
        >
          {(['1W', '1M', '3M', '6M', 'ALL'] as TimeRange[]).map(r => (
            <ToggleButton key={r} value={r}>{r}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
          {conditions.map(cond => {
            const active = selectedConditions.size === 0 || selectedConditions.has(cond);
            const color = getConditionColor(cond);
            return (
              <Chip
                key={cond}
                label={CONDITION_SHORT[cond] || cond}
                size="small"
                clickable
                onClick={() => toggleCondition(cond)}
                sx={{
                  fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace',
                  bgcolor: active ? `${color}22` : 'transparent',
                  borderColor: active ? color : '#444',
                  color: active ? color : '#555',
                }}
                variant="outlined"
              />
            );
          })}
        </Stack>
      </Box>

      {/* Line chart with condition-colored dots */}
      <ResponsiveContainer width="100%" height={420}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />

          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={{ stroke: '#222' }}
            tickFormatter={(ts: number) => {
              const d = new Date(ts);
              if (range === '1W' || range === '1M') {
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              }
              return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            }}
          />

          <YAxis
            dataKey="price"
            type="number"
            domain={[Math.max(0, minPrice - padding), maxPrice + padding]}
            tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${v.toFixed(v >= 100 ? 0 : 2)}`}
            width={65}
          />

          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: '#333' }}
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              if (!d) return null;
              return (
                <Box sx={{
                  bgcolor: '#111', border: '1px solid #333', borderRadius: 1,
                  p: 1.5, fontFamily: 'monospace', fontSize: 12, maxWidth: 280,
                }}>
                  <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: 14, mb: 0.5 }}>
                    ${d.price.toFixed(2)}
                    {d.shipping > 0 && (
                      <Typography component="span" sx={{ color: '#666', fontSize: 11, ml: 1 }}>
                        +${d.shipping.toFixed(2)} ship
                      </Typography>
                    )}
                  </Typography>
                  <Typography sx={{ color: getConditionColor(d.condition), fontSize: 11 }}>
                    {d.condition} · {d.variant}
                  </Typography>
                  <Typography sx={{ color: '#888', fontSize: 11 }}>
                    {d.date} {d.time}
                  </Typography>
                  {d.title && (
                    <Typography sx={{ color: '#666', fontSize: 10, mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.title}
                    </Typography>
                  )}
                  <Typography sx={{ color: '#00bcd4', fontSize: 10, mt: 0.5 }}>
                    Click to view on TCGPlayer
                  </Typography>
                </Box>
              );
            }}
          />

          {/* Median price reference line */}
          {median && (
            <ReferenceLine
              y={median}
              stroke="#ff9800"
              strokeDasharray="6 3"
              strokeWidth={1}
              label={{
                value: `Median $${median.toFixed(2)}`,
                fill: '#ff9800',
                fontSize: 10,
                position: 'left',
              }}
            />
          )}

          <Line
            dataKey="price"
            stroke="#333"
            strokeWidth={1}
            dot={(props: any) => {
              const { cx, cy, payload } = props;
              const color = getConditionColor(payload.condition);
              return (
                <circle
                  key={`dot-${payload.timestamp}`}
                  cx={cx}
                  cy={cy}
                  r={7}
                  fill={color}
                  fillOpacity={0.85}
                  stroke={color}
                  strokeWidth={2}
                  strokeOpacity={0.3}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleDotClick({ payload })}
                />
              );
            }}
            activeDot={(props: any) => {
              const { cx, cy, payload } = props;
              const color = getConditionColor(payload.condition);
              return (
                <circle
                  key={`adot-${payload.timestamp}`}
                  cx={cx}
                  cy={cy}
                  r={10}
                  fill={color}
                  fillOpacity={1}
                  stroke="#fff"
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleDotClick({ payload })}
                />
              );
            }}
            isAnimationActive={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <Stack direction="row" spacing={2} sx={{ mt: 1, justifyContent: 'center' }}>
        {Object.entries(CONDITION_COLORS).map(([cond, color]) => (
          <Stack key={cond} direction="row" spacing={0.5} alignItems="center">
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
            <Typography sx={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>
              {CONDITION_SHORT[cond] || cond}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
