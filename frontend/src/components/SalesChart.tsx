import { useMemo, useState, useCallback, useRef } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { Box, Typography, Stack, Chip, ToggleButton, ToggleButtonGroup, IconButton, Tooltip as MuiTooltip } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import html2canvas from 'html2canvas';
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
  'Daily Average': '#00bcd4',
};

const CONDITION_SHORT: Record<string, string> = {
  'Near Mint': 'NM',
  'Lightly Played': 'LP',
  'Moderately Played': 'MP',
  'Heavily Played': 'HP',
  'Damaged': 'DMG',
  'Daily Average': 'AVG',
};

function getConditionColor(condition: string): string {
  return CONDITION_COLORS[condition] || '#888';
}

export default function SalesChart({ sales, medianPrice, cardName }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<TimeRange>('ALL');
  const [selectedConditions, setSelectedConditions] = useState<Set<string>>(new Set());

  const handleExportPng = async () => {
    if (!chartRef.current) return;
    try {
      const canvas = await html2canvas(chartRef.current, { backgroundColor: '#000', scale: 2 });
      const link = document.createElement('a');
      link.download = `${cardName.replace(/[^a-zA-Z0-9]/g, '_')}_sales_chart.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

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
        const cond = s.source === 'tcgplayer_history' ? 'Daily Average' : s.condition;
        if (selectedConditions.size > 0 && !selectedConditions.has(cond)) return false;
        return true;
      })
      .map(s => {
        const isAggregate = s.source === 'tcgplayer_history';
        return {
          timestamp: new Date(s.order_date).getTime(),
          price: s.purchase_price,
          condition: isAggregate ? 'Daily Average' : s.condition,
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
          isAggregate,
          quantity: s.quantity,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [sales, range, selectedConditions]);

  // Get unique conditions present (remap aggregates)
  const conditions = useMemo(() => {
    const set = new Set(sales.map(s =>
      s.source === 'tcgplayer_history' ? 'Daily Average' : s.condition
    ));
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

  // Compute SMA lines (30d and 180d) from daily medians
  const smaData = useMemo(() => {
    if (chartData.length < 2) return { sma30: [], sma180: [] };

    // Group by day → daily median
    const dayMap = new Map<string, number[]>();
    for (const d of chartData) {
      const key = new Date(d.timestamp).toISOString().slice(0, 10);
      if (!dayMap.has(key)) dayMap.set(key, []);
      dayMap.get(key)!.push(d.price);
    }

    const dailyMedians = Array.from(dayMap.entries())
      .map(([day, prices]) => {
        const s = [...prices].sort((a, b) => a - b);
        return { day, timestamp: new Date(day).getTime(), median: s[Math.floor(s.length / 2)] };
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    // Calculate SMAs
    const calcSMA = (data: typeof dailyMedians, windowDays: number) => {
      return data.map((point, i) => {
        const cutoff = point.timestamp - windowDays * 86400000;
        const window = data.filter(d => d.timestamp > cutoff && d.timestamp <= point.timestamp);
        if (window.length < 2) return null;
        const avg = window.reduce((s, d) => s + d.median, 0) / window.length;
        return { timestamp: point.timestamp, value: avg };
      }).filter(Boolean) as { timestamp: number; value: number }[];
    };

    return {
      sma30: calcSMA(dailyMedians, 30),
      sma180: calcSMA(dailyMedians, 180),
    };
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#666' }}>
        <Typography>
          No sales data yet. Sales are collected every 6 hours from TCGPlayer.
        </Typography>
      </Box>
    );
  }

  // Compute stats with outlier-aware Y-axis (IQR method)
  const prices = chartData.map(d => d.price);
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const median = sortedPrices[Math.floor(sortedPrices.length / 2)];
  const q1 = sortedPrices[Math.floor(sortedPrices.length * 0.25)];
  const q3 = sortedPrices[Math.floor(sortedPrices.length * 0.75)];
  const iqr = q3 - q1;
  const upperFence = q3 + 2.0 * iqr; // Use 2x IQR for less aggressive trimming
  const normalizedPrices = sortedPrices.filter(p => p <= upperFence);
  const minPrice = sortedPrices[0];
  const maxNormalized = normalizedPrices.length > 0 ? normalizedPrices[normalizedPrices.length - 1] : sortedPrices[sortedPrices.length - 1];
  const maxPrice = sortedPrices[sortedPrices.length - 1];
  const yMax = maxPrice > upperFence && normalizedPrices.length >= sortedPrices.length * 0.9
    ? maxNormalized * 1.15 // Trim outliers from Y-axis
    : maxPrice;
  const padding = (yMax - minPrice) * 0.1 || yMax * 0.1;

  return (
    <Box ref={chartRef}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 0.5, md: 2 }, mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
            COMPLETED SALES
          </Typography>
          <MuiTooltip title="Download as PNG">
            <IconButton onClick={handleExportPng} size="small" sx={{ color: '#888', '&:hover': { color: '#00bcd4' } }}>
              <DownloadIcon fontSize="small" />
            </IconButton>
          </MuiTooltip>
        </Box>
        <Typography variant="body2" sx={{ color: '#888', fontFamily: 'monospace' }}>
          {(() => {
            const indiv = chartData.filter(d => !d.isAggregate).length;
            const agg = chartData.filter(d => d.isAggregate).length;
            if (agg > 0 && indiv > 0) return `${indiv} individual + ${agg} daily avg`;
            if (agg > 0) return `${agg} daily avg`;
            return `${indiv} sale${indiv !== 1 ? 's' : ''}`;
          })()} · Median ${median.toFixed(2)}
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
              color: '#888', border: '1px solid #333', px: { xs: 1, md: 1.5 }, py: { xs: 0.5, md: 0.3 },
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
      <Box sx={{ height: { xs: 280, sm: 350, md: 420 } }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={(() => {
          // Merge SMA data points into chartData by timestamp
          const merged = chartData.map(d => ({ ...d, sma30: undefined as number | undefined, sma180: undefined as number | undefined }));
          // Add SMA points (only at timestamps where we have data, or as separate points)
          const sma30Map = new Map(smaData.sma30?.map(s => [s.timestamp, s.value]) || []);
          const sma180Map = new Map(smaData.sma180?.map(s => [s.timestamp, s.value]) || []);

          // Create a combined timeline with all unique timestamps
          const allTimestamps = new Set([
            ...merged.map(d => d.timestamp),
            ...(smaData.sma30?.map(s => s.timestamp) || []),
            ...(smaData.sma180?.map(s => s.timestamp) || []),
          ]);

          const combined = Array.from(allTimestamps).sort((a, b) => a - b).map(ts => {
            const existing = merged.find(d => d.timestamp === ts);
            return {
              ...(existing || { timestamp: ts, price: null }),
              sma30: sma30Map.get(ts),
              sma180: sma180Map.get(ts),
            };
          });
          return combined;
        })()} margin={{ top: 10, right: 10, bottom: 5, left: 5 }}>
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
            domain={[Math.max(0, minPrice - padding), yMax + padding]}
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
                    {!d.isAggregate && d.shipping > 0 && (
                      <Typography component="span" sx={{ color: '#666', fontSize: 11, ml: 1 }}>
                        +${d.shipping.toFixed(2)} ship
                      </Typography>
                    )}
                    {d.isAggregate && d.quantity > 0 && (
                      <Typography component="span" sx={{ color: '#888', fontSize: 11, ml: 1 }}>
                        avg · {d.quantity} sales
                      </Typography>
                    )}
                  </Typography>
                  <Typography sx={{ color: getConditionColor(d.condition), fontSize: 11 }}>
                    {d.isAggregate ? 'Daily Average' : d.condition} · {d.variant}
                  </Typography>
                  <Typography sx={{ color: '#888', fontSize: 11 }}>
                    {d.date}{!d.isAggregate && ` ${d.time}`}
                  </Typography>
                  {!d.isAggregate && d.title && (
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
              if (payload.isAggregate) {
                return (
                  <polygon
                    key={`dot-${payload.timestamp}`}
                    points={`${cx},${cy-6} ${cx+6},${cy} ${cx},${cy+6} ${cx-6},${cy}`}
                    fill={color}
                    fillOpacity={0.7}
                    stroke={color}
                    strokeWidth={1}
                    strokeOpacity={0.4}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleDotClick({ payload })}
                  />
                );
              }
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
              if (payload.isAggregate) {
                return (
                  <polygon
                    key={`adot-${payload.timestamp}`}
                    points={`${cx},${cy-8} ${cx+8},${cy} ${cx},${cy+8} ${cx-8},${cy}`}
                    fill={color}
                    fillOpacity={1}
                    stroke="#fff"
                    strokeWidth={2}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleDotClick({ payload })}
                  />
                );
              }
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

          {/* 30-day SMA */}
          {smaData.sma30 && smaData.sma30.length > 1 && (
            <Line
              dataKey="sma30"
              stroke="#00bcd4"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
              name="30d SMA"
            />
          )}

          {/* 6-month SMA */}
          {smaData.sma180 && smaData.sma180.length > 1 && (
            <Line
              dataKey="sma180"
              stroke="#ff6d00"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
              name="6mo SMA"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      </Box>

      {/* Legend */}
      <Stack direction="row" spacing={{ xs: 1, md: 2 }} sx={{ mt: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
        {Object.entries(CONDITION_COLORS).map(([cond, color]) => (
          <Stack key={cond} direction="row" spacing={0.5} alignItems="center">
            {cond === 'Daily Average' ? (
              <Box sx={{
                width: 8, height: 8, bgcolor: color,
                transform: 'rotate(45deg)',
              }} />
            ) : (
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
            )}
            <Typography sx={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>
              {CONDITION_SHORT[cond] || cond}
            </Typography>
          </Stack>
        ))}
        {smaData.sma30 && smaData.sma30.length > 1 && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Box sx={{ width: 16, height: 2, bgcolor: '#00bcd4', borderRadius: 1 }} />
            <Typography sx={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>30d SMA</Typography>
          </Stack>
        )}
        {smaData.sma180 && smaData.sma180.length > 1 && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Box sx={{ width: 16, height: 2, bgcolor: '#ff6d00', borderRadius: 1 }} />
            <Typography sx={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>6mo SMA</Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
