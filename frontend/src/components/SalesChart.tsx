import { useMemo, useState, useCallback, useRef } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceArea,
} from 'recharts';
import { Box, Typography, Stack, Chip, ToggleButton, ToggleButtonGroup, IconButton, Tooltip as MuiTooltip, Skeleton, Alert } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import html2canvas from 'html2canvas';
import { SaleRecord } from '../services/api';
import GlossaryTooltip from './GlossaryTooltip';

interface Props {
  sales: SaleRecord[];
  medianPrice: number | null;
  cardName: string;
  loading?: boolean;
  error?: string | null;
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

export default function SalesChart({ sales, medianPrice, cardName, loading, error }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<TimeRange>('ALL');
  const [selectedConditions, setSelectedConditions] = useState<Set<string>>(new Set());

  // Drag-to-zoom state
  const [refAreaLeft, setRefAreaLeft] = useState<string>('');
  const [refAreaRight, setRefAreaRight] = useState<string>('');
  const [zoomLeft, setZoomLeft] = useState<number | null>(null);
  const [zoomRight, setZoomRight] = useState<number | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);

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
      const safeName = cardName.replace(/[^a-zA-Z0-9]/g, '_');
      link.download = `pkmn_${safeName}_sales_${dateStr}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const resetZoom = useCallback(() => {
    setZoomLeft(null);
    setZoomRight(null);
    setIsZoomed(false);
  }, []);

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

    const filtered = sales
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

    // If range filter yields empty but we have data, auto-fallback happens via empty state
    return filtered;
  }, [sales, range, selectedConditions]);

  // Apply zoom filter
  const filteredData = useMemo(() => {
    if (!isZoomed || zoomLeft == null || zoomRight == null) return chartData;
    return chartData.filter(d => d.timestamp >= zoomLeft && d.timestamp <= zoomRight);
  }, [chartData, isZoomed, zoomLeft, zoomRight]);

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

  // Click handler -- open TCGPlayer product page
  const handleDotClick = useCallback((data: any) => {
    const payload = data?.payload;
    if (payload?.sourceProductId) {
      window.open(
        `https://www.tcgplayer.com/product/${payload.sourceProductId}`,
        '_blank'
      );
    }
  }, []);

  // Compute SMA lines (30d and 180d) from daily medians -- use filteredData for zoom
  const smaData = useMemo(() => {
    if (filteredData.length < 2) return { sma30: [], sma180: [] };

    // Group by day -> daily median
    const dayMap = new Map<string, number[]>();
    for (const d of filteredData) {
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
  }, [filteredData]);

  // Loading state
  if (loading) {
    return (
      <Box>
        <Skeleton variant="text" width={200} height={40} sx={{ bgcolor: '#1a1a1a' }} />
        <Skeleton variant="text" width={150} height={24} sx={{ bgcolor: '#1a1a1a', mb: 1 }} />
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

  // Zero sales empty state
  if (sales.length === 0) {
    return (
      <Box ref={chartRef}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
            COMPLETED SALES
          </Typography>
        </Box>
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 300, color: '#666', border: '1px solid #222', borderRadius: 1,
          bgcolor: '#0a0a0a', flexDirection: 'column', gap: 1.5, px: 3,
        }}>
          <Typography sx={{ color: '#888', fontSize: '0.9rem', fontFamily: 'monospace', textAlign: 'center' }}>
            No completed sales recorded for this card yet.
          </Typography>
          <Typography sx={{ color: '#555', fontSize: '0.75rem', fontFamily: 'monospace', textAlign: 'center', maxWidth: 400 }}>
            Sales data is collected periodically from TCGPlayer. Check back later for completed sale prices.
          </Typography>
        </Box>
        {/* Always show condition legend */}
        <Stack direction="row" spacing={{ xs: 1, md: 2 }} sx={{ mt: 1, justifyContent: 'center', flexWrap: 'wrap', py: 0.5 }}>
          {Object.entries(CONDITION_COLORS).map(([cond, color]) => (
            <Stack key={cond} direction="row" spacing={0.5} alignItems="center" sx={{ opacity: 0.5 }}>
              {cond === 'Daily Average' ? (
                <Box sx={{ width: 8, height: 8, bgcolor: color, transform: 'rotate(45deg)' }} />
              ) : (
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
              )}
              <Typography sx={{ fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 0.3 }}>
                {CONDITION_SHORT[cond] || cond}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    );
  }

  // Range filter yielded 0 results but we have sales -- auto-fallback
  if (chartData.length === 0 && sales.length > 0 && range !== 'ALL') {
    // Auto-switch to ALL
    setTimeout(() => setRange('ALL'), 0);
  }

  if (chartData.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#666' }}>
        <Typography>
          No sales data yet. Sales are collected every 6 hours from TCGPlayer.
        </Typography>
      </Box>
    );
  }

  // Single sale: show as annotated display
  if (filteredData.length === 1) {
    const sale = filteredData[0];
    return (
      <Box ref={chartRef}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 0.5, md: 2 }, mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h4" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
              COMPLETED SALES
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: '#888', fontFamily: 'monospace' }}>
            1 sale recorded
          </Typography>
        </Box>

        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 300, border: '1px solid #222', borderRadius: 1,
          bgcolor: '#0a0a0a', flexDirection: 'column', gap: 2, px: 3,
        }}>
          {/* Single dot visualization */}
          <Box sx={{
            width: 16, height: 16, borderRadius: '50%',
            bgcolor: getConditionColor(sale.condition),
            boxShadow: `0 0 12px ${getConditionColor(sale.condition)}40`,
          }} />
          <Typography sx={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, fontFamily: 'monospace' }}>
            ${sale.price.toFixed(2)}
            {!sale.isAggregate && sale.shipping != null && sale.shipping > 0 && (
              <Typography component="span" sx={{ color: '#666', fontSize: '0.8rem', ml: 1 }}>
                +${sale.shipping.toFixed(2)} shipping
              </Typography>
            )}
          </Typography>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: getConditionColor(sale.condition), fontSize: '0.85rem', fontFamily: 'monospace', fontWeight: 600 }}>
              {sale.condition} {sale.variant && `\u00B7 ${sale.variant}`}
            </Typography>
            <Typography sx={{ color: '#888', fontSize: '0.8rem', fontFamily: 'monospace', mt: 0.5 }}>
              {sale.date} {!sale.isAggregate && sale.time}
            </Typography>
            {!sale.isAggregate && sale.title && (
              <Typography sx={{ color: '#555', fontSize: '0.7rem', fontFamily: 'monospace', mt: 0.5, maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {sale.title}
              </Typography>
            )}
          </Box>
          <Typography sx={{ color: '#555', fontSize: '0.7rem', fontFamily: 'monospace' }}>
            More sales data will appear as they are recorded from TCGPlayer.
          </Typography>
        </Box>

        {/* Legend */}
        <Stack direction="row" spacing={{ xs: 1, md: 2 }} sx={{ mt: 1, justifyContent: 'center', flexWrap: 'wrap', py: 0.5 }}>
          {Object.entries(CONDITION_COLORS).map(([cond, color]) => (
            <Stack key={cond} direction="row" spacing={0.5} alignItems="center" sx={{ opacity: 0.9 }}>
              {cond === 'Daily Average' ? (
                <Box sx={{ width: 8, height: 8, bgcolor: color, transform: 'rotate(45deg)' }} />
              ) : (
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
              )}
              <Typography sx={{ fontSize: 11, color: '#777', fontFamily: 'monospace', letterSpacing: 0.3 }}>
                {CONDITION_SHORT[cond] || cond}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    );
  }

  // Compute stats with outlier-aware Y-axis (IQR method) -- use filteredData
  const prices = filteredData.map(d => d.price);
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const median = sortedPrices.length > 0 ? sortedPrices[Math.floor(sortedPrices.length / 2)] : 0;
  const q1 = sortedPrices[Math.floor(sortedPrices.length * 0.25)];
  const q3 = sortedPrices[Math.floor(sortedPrices.length * 0.75)];
  const iqr = q3 - q1;
  const upperFence = q3 + 2.0 * iqr; // Use 2x IQR for less aggressive trimming
  const normalizedPrices = sortedPrices.filter(p => p <= upperFence);
  const minPrice = sortedPrices[0];
  const maxNormalized = normalizedPrices.length > 0 ? normalizedPrices[normalizedPrices.length - 1] : sortedPrices[sortedPrices.length - 1];
  const maxPrice = sortedPrices[sortedPrices.length - 1];

  // Outlier handling: cap y-axis at 2x median if outliers exist > 5x median
  const hasExtremeOutliers = maxPrice > median * 5 && median > 0;
  const yMax = hasExtremeOutliers
    ? median * 2 // Cap at 2x median so outliers clip rather than blowing up y-axis
    : maxPrice > upperFence && normalizedPrices.length >= sortedPrices.length * 0.9
      ? maxNormalized * 1.15
      : maxPrice;

  const rawPadding = (yMax - minPrice) * 0.1 || yMax * 0.1;
  // Ensure minimum padding of 10% of the max price so single-value charts show meaningful Y-axis ticks
  const padding = Math.max(rawPadding, maxPrice * 0.1 || 1);

  // Zoom mouse handlers
  const handleMouseDown = (e: any) => {
    if (e && e.activeLabel != null) setRefAreaLeft(String(e.activeLabel));
  };
  const handleMouseMove = (e: any) => {
    if (refAreaLeft && e && e.activeLabel != null) setRefAreaRight(String(e.activeLabel));
  };
  const handleMouseUp = () => {
    if (refAreaLeft && refAreaRight) {
      const [left, right] = [Number(refAreaLeft), Number(refAreaRight)].sort((a, b) => a - b);
      if (left !== right) {
        setZoomLeft(left);
        setZoomRight(right);
        setIsZoomed(true);
      }
    }
    setRefAreaLeft('');
    setRefAreaRight('');
  };

  return (
    <Box ref={chartRef}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 0.5, md: 2 }, mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
            COMPLETED SALES
          </Typography>
          <MuiTooltip title="Save Chart as PNG">
            <IconButton onClick={handleExportPng} size="small" sx={{ color: '#888', border: '1px solid #333', borderRadius: 1, px: 1, '&:hover': { color: '#00bcd4', borderColor: '#00bcd4' } }}>
              <DownloadIcon sx={{ fontSize: 16, mr: 0.5 }} />
              <Typography sx={{ fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 600 }}>Save Chart</Typography>
            </IconButton>
          </MuiTooltip>
          {isZoomed && (
            <Chip
              label="Reset Zoom"
              size="small"
              onClick={resetZoom}
              onDelete={resetZoom}
              sx={{
                fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace',
                bgcolor: 'rgba(0,188,212,0.15)', color: '#00bcd4',
                borderColor: '#00bcd4', border: '1px solid',
                '& .MuiChip-deleteIcon': { color: '#00bcd4', fontSize: 14 },
              }}
            />
          )}
        </Box>
        <Typography variant="body2" sx={{ color: '#888', fontFamily: 'monospace' }}>
          {(() => {
            const indiv = filteredData.filter(d => !d.isAggregate).length;
            const agg = filteredData.filter(d => d.isAggregate).length;
            if (agg > 0 && indiv > 0) return `${indiv} individual + ${agg} daily avg`;
            if (agg > 0) return `${agg} daily avg`;
            return `${indiv} sale${indiv !== 1 ? 's' : ''}`;
          })()} · Median ${median.toFixed(2)}
          {hasExtremeOutliers && ` · ${filteredData.filter(d => d.price > median * 5).length} outlier${filteredData.filter(d => d.price > median * 5).length !== 1 ? 's' : ''} clipped`}
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
      <Box sx={{ height: { xs: 280, sm: 350, md: 420 }, minHeight: 250, userSelect: 'none' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={(() => {
            // Merge SMA data points into filteredData by timestamp
            const merged = filteredData.map(d => ({ ...d, sma30: undefined as number | undefined, sma180: undefined as number | undefined }));
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
          })()}
          margin={{ top: 10, right: 10, bottom: 5, left: 5 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <CartesianGrid strokeDasharray="2 4" stroke="#222" vertical={false} />

          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fill: '#888', fontSize: 11, fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={{ stroke: '#333' }}
            tickFormatter={(ts: number) => {
              const d = new Date(ts);
              // Check actual data span to decide format
              const dataSpanMs = filteredData.length > 1
                ? filteredData[filteredData.length - 1].timestamp - filteredData[0].timestamp
                : 0;
              const twoMonthsMs = 60 * 24 * 60 * 60 * 1000;
              if (dataSpanMs < twoMonthsMs) {
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              }
              return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            }}
          />

          <YAxis
            dataKey="price"
            type="number"
            domain={[Math.max(0, minPrice - padding), yMax + padding]}
            tick={{ fill: '#888', fontSize: 11, fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${v.toFixed(v >= 100 ? 0 : 2)}`}
            width={65}
            tickCount={5}
            allowDecimals={false}
          />

          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: '#444' }}
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              if (!d || d.price == null) return null;
              const isOutlier = hasExtremeOutliers && d.price > median * 5;
              return (
                <Box sx={{
                  bgcolor: '#111', border: '1px solid #333', borderRadius: 1,
                  p: 1.5, fontFamily: 'monospace', fontSize: 12, maxWidth: 280,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                }}>
                  <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: 14, mb: 0.5 }}>
                    ${d.price.toFixed(2)}
                    {isOutlier && (
                      <Typography component="span" sx={{ color: '#ff9800', fontSize: 11, ml: 1 }}>
                        OUTLIER
                      </Typography>
                    )}
                    {!d.isAggregate && d.shipping != null && d.shipping > 0 && (
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
              strokeWidth={1.5}
              label={{
                value: `Median $${median.toFixed(2)}`,
                fill: '#ff9800',
                fontSize: 11,
                fontWeight: 600,
                position: 'insideTopLeft',
                offset: 5,
              }}
            />
          )}

          <Line
            dataKey="price"
            stroke="#333"
            strokeWidth={1}
            dot={(props: any) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null || !payload || payload.price == null) return <g key={`dot-empty-${props.index}`} />;
              const color = getConditionColor(payload.condition);
              const isOutlier = hasExtremeOutliers && payload.price > median * 5;
              if (payload.isAggregate) {
                return (
                  <polygon
                    key={`dot-${payload.timestamp}`}
                    points={`${cx},${cy-5} ${cx+5},${cy} ${cx},${cy+5} ${cx-5},${cy}`}
                    fill={color}
                    fillOpacity={isOutlier ? 0.3 : 0.7}
                    stroke={color}
                    strokeWidth={1}
                    strokeOpacity={isOutlier ? 0.2 : 0.4}
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
                  r={5}
                  fill={color}
                  fillOpacity={isOutlier ? 0.3 : 0.85}
                  stroke={color}
                  strokeWidth={2}
                  strokeOpacity={isOutlier ? 0.15 : 0.3}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleDotClick({ payload })}
                />
              );
            }}
            activeDot={(props: any) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null || !payload) return <g key={`adot-empty-${props.index}`} />;
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
                  r={8}
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
              strokeWidth={2.5}
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
              strokeWidth={2.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
              name="6mo SMA"
            />
          )}

          {/* Drag-to-zoom highlight area */}
          {refAreaLeft && refAreaRight && (
            <ReferenceArea
              x1={Number(refAreaLeft)}
              x2={Number(refAreaRight)}
              strokeOpacity={0.3}
              fill="#00bcd4"
              fillOpacity={0.1}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      </Box>

      {/* Legend -- always visible */}
      <Stack direction="row" spacing={{ xs: 1, md: 2 }} sx={{ mt: 1, justifyContent: 'center', flexWrap: 'wrap', py: 0.5 }}>
        {Object.entries(CONDITION_COLORS).map(([cond, color]) => (
          <Stack key={cond} direction="row" spacing={0.5} alignItems="center" sx={{ opacity: 0.9 }}>
            {cond === 'Daily Average' ? (
              <Box sx={{
                width: 8, height: 8, bgcolor: color,
                transform: 'rotate(45deg)',
              }} />
            ) : (
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
            )}
            <Typography sx={{ fontSize: 11, color: '#777', fontFamily: 'monospace', letterSpacing: 0.3 }}>
              {CONDITION_SHORT[cond] || cond}
            </Typography>
          </Stack>
        ))}
        {smaData.sma30 && smaData.sma30.length > 1 && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ opacity: 0.9 }}>
            <Box sx={{ width: 18, height: 2.5, bgcolor: '#00bcd4', borderRadius: 1 }} />
            <Typography sx={{ fontSize: 11, color: '#777', fontFamily: 'monospace', letterSpacing: 0.3 }}><GlossaryTooltip term="sma_30d">30d SMA</GlossaryTooltip></Typography>
          </Stack>
        )}
        {smaData.sma180 && smaData.sma180.length > 1 && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ opacity: 0.9 }}>
            <Box sx={{ width: 18, height: 2.5, bgcolor: '#ff6d00', borderRadius: 1 }} />
            <Typography sx={{ fontSize: 11, color: '#777', fontFamily: 'monospace', letterSpacing: 0.3 }}><GlossaryTooltip term="sma_180d">6mo SMA</GlossaryTooltip></Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
