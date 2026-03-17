import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Box, Paper, Typography, Avatar, IconButton, TextField, Collapse,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, LineChart, Line,
} from 'recharts';
import { api, Card, PricePoint } from '../services/api';
import GlossaryTooltip from '../components/GlossaryTooltip';

interface WatchlistItem {
  cardId: number;
  costBasis: number | null;
  alertAbove: number | null;
  alertBelow: number | null;
  quantity?: number;
  addedAt: string;
}

interface WatchlistRow extends WatchlistItem {
  card: Card | null;
}

export default function Watchlist() {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Watchlist | PKMN Trader';
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, []);

  const loadWatchlist = useCallback(async () => {
    setLoading(true);
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const loaded: WatchlistRow[] = await Promise.all(
      items.map(async (item) => {
        try {
          const card = await api.getCard(item.cardId);
          return { ...item, card };
        } catch {
          return { ...item, card: null };
        }
      })
    );
    setRows(loaded.filter(r => r.card !== null));
    setLoading(false);
  }, []);

  useEffect(() => { loadWatchlist(); }, [loadWatchlist]);

  const removeFromWatchlist = (cardId: number) => {
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    localStorage.setItem('pkmn_watchlist', JSON.stringify(items.filter(w => w.cardId !== cardId)));
    setRows(prev => prev.filter(r => r.cardId !== cardId));
  };

  const updateCostBasis = (cardId: number, value: string) => {
    const parsed = parseFloat(value);
    const numVal = value === '' || isNaN(parsed) ? null : parsed;
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const updated = items.map(w => w.cardId === cardId ? { ...w, costBasis: numVal } : w);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(updated));
    setRows(prev => prev.map(r => r.cardId === cardId ? { ...r, costBasis: numVal } : r));
  };

  const updateAlert = (cardId: number, field: 'alertAbove' | 'alertBelow', value: string) => {
    const parsed = parseFloat(value);
    const numVal = value === '' || isNaN(parsed) ? null : parsed;
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const updated = items.map(w => w.cardId === cardId ? { ...w, [field]: numVal } : w);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(updated));
    setRows(prev => prev.map(r => r.cardId === cardId ? { ...r, [field]: numVal } : r));
  };

  const updateQuantity = (cardId: number, value: string) => {
    const parsed = parseInt(value);
    const qty = value === '' || isNaN(parsed) || parsed < 1 ? 1 : parsed;
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const updated = items.map(w => w.cardId === cardId ? { ...w, quantity: qty } : w);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(updated));
    setRows(prev => prev.map(r => r.cardId === cardId ? { ...r, quantity: qty } : r));
  };

  const [chartOpen, setChartOpen] = useState(true);
  const [chartData, setChartData] = useState<{ date: string; value: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [cardPriceHistories, setCardPriceHistories] = useState<Map<number, PricePoint[]>>(new Map());

  // Fetch price histories for all watchlist cards and build portfolio value over time
  useEffect(() => {
    if (rows.length === 0) return;
    let cancelled = false;
    (async () => {
      setChartLoading(true);
      try {
        const priceResults = await Promise.all(
          rows.map(async (row) => {
            try {
              const res = await api.getCardPrices(row.cardId);
              return { cardId: row.cardId, data: res.data };
            } catch {
              return { cardId: row.cardId, data: [] as PricePoint[] };
            }
          })
        );
        if (cancelled) return;

        // Store per-card price histories for sparklines
        const histMap = new Map<number, PricePoint[]>();
        for (const { cardId, data } of priceResults) {
          histMap.set(cardId, data);
        }
        setCardPriceHistories(histMap);

        // Build a map of cardId -> { date -> price }
        const cardPriceMap: Record<number, Record<string, number>> = {};
        for (const { cardId, data } of priceResults) {
          const dateMap: Record<string, number> = {};
          for (const pt of data) {
            dateMap[pt.date] = pt.market_price;
          }
          cardPriceMap[cardId] = dateMap;
        }

        // Generate last 30 days
        const dates: string[] = [];
        const now = new Date();
        for (let i = 29; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          dates.push(d.toISOString().slice(0, 10));
        }

        // For each date, sum portfolio value with forward-fill
        const lastKnown: Record<number, number> = {};
        const series = dates.map(date => {
          let total = 0;
          for (const row of rows) {
            const qty = row.quantity ?? 1;
            const priceMap = cardPriceMap[row.cardId] || {};
            if (priceMap[date] !== undefined) {
              lastKnown[row.cardId] = priceMap[date];
            }
            const price = lastKnown[row.cardId] ?? row.card?.current_price ?? 0;
            total += price * qty;
          }
          return { date, value: parseFloat(total.toFixed(2)) };
        });

        setChartData(series);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rows]);

  const totalValue = rows.reduce((sum, r) => sum + (r.card?.current_price || 0) * (r.quantity ?? 1), 0);
  const totalCost = rows.reduce((sum, r) => sum + (r.costBasis || 0) * (r.quantity ?? 1), 0);
  const totalPnL = totalCost > 0 ? totalValue - totalCost : null;

  const monthChange = useMemo(() => {
    if (chartData.length < 2) return null;
    const first = chartData[0].value;
    const last = chartData[chartData.length - 1].value;
    if (first === 0) return null;
    return { amount: last - first, pct: ((last - first) / first) * 100 };
  }, [chartData]);

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <BookmarkIcon sx={{ color: '#ffd700' }} />
        <Typography variant="h2" sx={{ color: '#ffd700' }}>WATCHLIST</Typography>
        <Typography variant="body2" sx={{ color: '#666', ml: 'auto' }}>
          {rows.length} cards
        </Typography>
      </Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ color: '#888', fontSize: '0.8rem' }}>
          Cards you're tracking. Add a cost basis to see your profit.
        </Typography>
      </Box>

      {/* Portfolio Summary */}
      {rows.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Paper sx={{ p: 1.5, flex: 1, minWidth: 120, textAlign: 'center' }}>
            <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>Total Value</Typography>
            <Typography sx={{ color: '#00ff41', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem' }}>
              ${totalValue.toFixed(2)}
            </Typography>
          </Paper>
          {totalCost > 0 && (
            <>
              <Paper sx={{ p: 1.5, flex: 1, minWidth: 120, textAlign: 'center' }}>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>Total Cost</Typography>
                <Typography sx={{ color: '#888', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem' }}>
                  ${totalCost.toFixed(2)}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, flex: 1, minWidth: 120, textAlign: 'center' }}>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}><GlossaryTooltip term="pnl">P&L</GlossaryTooltip></Typography>
                <Typography sx={{
                  color: totalPnL != null && totalPnL >= 0 ? '#00ff41' : '#ff1744',
                  fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem',
                }}>
                  {totalPnL != null && totalPnL >= 0 ? '+' : ''}${totalPnL?.toFixed(2)} ({totalCost > 0 ? ((totalPnL! / totalCost) * 100).toFixed(1) : '0'}%)
                </Typography>
              </Paper>
            </>
          )}
        </Box>
      )}

      {/* Portfolio Performance Chart */}
      {rows.length > 0 && (
        <Paper sx={{ mb: 2, overflow: 'hidden' }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, cursor: 'pointer', '&:hover': { bgcolor: '#1a1a2e' } }}
            onClick={() => setChartOpen(!chartOpen)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ color: '#ffd700', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 700, letterSpacing: 1 }}>
                PORTFOLIO PERFORMANCE
              </Typography>
              {monthChange && (
                <Typography sx={{
                  fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem', fontWeight: 700,
                  color: monthChange.amount >= 0 ? '#00ff41' : '#ff1744',
                }}>
                  Portfolio {monthChange.amount >= 0 ? 'up' : 'down'} {Math.abs(monthChange.pct).toFixed(1)}% this month
                </Typography>
              )}
            </Box>
            <IconButton size="small" sx={{ color: '#666' }}>
              {chartOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
          <Collapse in={chartOpen}>
            <Box sx={{ px: 2, pb: 2 }}>
              {/* Summary stats row */}
              <Box sx={{ display: 'flex', gap: 3, mb: 1.5, flexWrap: 'wrap' }}>
                <Box>
                  <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.6rem', textTransform: 'uppercase' }}>Current Value</Typography>
                  <Typography sx={{ color: '#00ff41', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '1rem' }}>
                    ${totalValue.toFixed(2)}
                  </Typography>
                </Box>
                {totalCost > 0 && (
                  <>
                    <Box>
                      <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.6rem', textTransform: 'uppercase' }}><GlossaryTooltip term="cost_basis">Cost Basis</GlossaryTooltip></Typography>
                      <Typography sx={{ color: '#888', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '1rem' }}>
                        ${totalCost.toFixed(2)}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.6rem', textTransform: 'uppercase' }}><GlossaryTooltip term="pnl">P&L</GlossaryTooltip></Typography>
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '1rem',
                        color: totalPnL != null && totalPnL >= 0 ? '#00ff41' : '#ff1744',
                      }}>
                        {totalPnL != null && totalPnL >= 0 ? '+' : ''}${totalPnL?.toFixed(2)} ({totalCost > 0 ? ((totalPnL! / totalCost) * 100).toFixed(1) : '0'}%)
                      </Typography>
                    </Box>
                  </>
                )}
              </Box>
              {chartLoading ? (
                <Typography sx={{ color: '#555', textAlign: 'center', py: 4, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  Loading price history...
                </Typography>
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00ff41" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#00ff41" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
                      tickFormatter={(d: string) => d.slice(5)}
                      stroke="#333"
                    />
                    <YAxis
                      tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
                      tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                      stroke="#333"
                      domain={totalCost > 0 ? [Math.min(totalCost * 0.9, Math.min(...chartData.map(d => d.value))), 'auto'] : ['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0a0a1a', border: '1px solid #333', fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}
                      labelStyle={{ color: '#888' }}
                      formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Portfolio Value']}
                    />
                    {totalCost > 0 && (
                      <ReferenceLine
                        y={totalCost}
                        stroke="#666"
                        strokeDasharray="6 4"
                        label={{ value: `Cost $${totalCost.toFixed(0)}`, fill: '#555', fontSize: 10, fontFamily: 'monospace', position: 'right' }}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#00ff41"
                      strokeWidth={2}
                      fill="url(#portfolioGrad)"
                      dot={false}
                      activeDot={{ r: 4, stroke: '#00ff41', strokeWidth: 2, fill: '#0a0a1a' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <Typography sx={{ color: '#555', textAlign: 'center', py: 4, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  No price history available
                </Typography>
              )}
            </Box>
          </Collapse>
        </Paper>
      )}

      {loading ? (
        <Typography sx={{ color: '#666', textAlign: 'center', py: 4 }}>Loading watchlist...</Typography>
      ) : rows.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <BookmarkIcon sx={{ color: '#333', fontSize: 48, mb: 1 }} />
          <Typography sx={{ color: '#666', mb: 1 }}>Your watchlist is empty</Typography>
          <Typography sx={{ color: '#555', fontSize: '0.8rem' }}>
            Visit a card's detail page and click the bookmark icon to add it here.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>CARD</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>QTY</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>CURRENT</TableCell>
                <TableCell align="center" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem', width: 80 }}>TREND</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>7D</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}><GlossaryTooltip term="cost_basis">COST BASIS</GlossaryTooltip></TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}><GlossaryTooltip term="pnl">P&L</GlossaryTooltip></TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}><GlossaryTooltip term="pnl">P&L %</GlossaryTooltip></TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>ALERT ▲</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>ALERT ▼</TableCell>
                <TableCell align="center" sx={{ width: 40 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(row => {
                const qty = row.quantity ?? 1;
                const price = row.card?.current_price || 0;
                const totalRowValue = price * qty;
                const totalRowCost = (row.costBasis || 0) * qty;
                const pnl = row.costBasis != null ? totalRowValue - totalRowCost : null;
                const pnlPct = row.costBasis != null && row.costBasis > 0 ? ((price - row.costBasis) / row.costBasis) * 100 : null;
                return (
                  <TableRow
                    key={row.cardId}
                    hover
                    sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#1a1a2e' } }}
                    onClick={() => navigate(`/card/${row.cardId}`)}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar src={row.card?.image_small} variant="rounded" sx={{ width: 32, height: 44 }} />
                        <Box>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.8rem' }}>{row.card?.name}</Typography>
                          <Typography sx={{ color: '#666', fontSize: '0.6rem' }}>{row.card?.set_name}</Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <TextField
                        size="small"
                        type="number"
                        value={qty}
                        onChange={e => updateQuantity(row.cardId, e.target.value)}
                        inputProps={{ min: 1, style: { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#ccc', padding: '4px' } }}
                        sx={{ width: 50 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography sx={{ color: '#00ff41', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem' }}>
                        ${totalRowValue.toFixed(2)}
                      </Typography>
                      {qty > 1 && (
                        <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.6rem' }}>
                          ${price.toFixed(2)} ea
                        </Typography>
                      )}
                    </TableCell>
                    {(() => {
                      const priceHist = cardPriceHistories.get(row.cardId) || [];
                      // Last 14 days of data for sparkline
                      const sparkData = priceHist.slice(-14).map(p => ({ price: p.market_price }));
                      // 7d change calculation
                      let change7d: number | null = null;
                      if (priceHist.length >= 2) {
                        const latest = priceHist[priceHist.length - 1].market_price;
                        // Find price ~7 days ago
                        const idx7d = Math.max(0, priceHist.length - 8);
                        const price7d = priceHist[idx7d].market_price;
                        if (price7d > 0) {
                          change7d = ((latest - price7d) / price7d) * 100;
                        }
                      }
                      const trendColor = change7d != null && change7d >= 0 ? '#00ff41' : '#ff1744';
                      return (
                        <>
                          <TableCell align="center" sx={{ width: 80, p: 0.5 }}>
                            {sparkData.length > 1 ? (
                              <ResponsiveContainer width={80} height={30}>
                                <LineChart data={sparkData}>
                                  <Line type="monotone" dataKey="price" stroke={trendColor} strokeWidth={1.5} dot={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            ) : (
                              <Typography sx={{ color: '#555', fontSize: '0.6rem' }}>—</Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{
                              fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem',
                              color: change7d != null ? (change7d >= 0 ? '#00ff41' : '#ff1744') : '#555',
                            }}>
                              {change7d != null ? `${change7d >= 0 ? '+' : ''}${change7d.toFixed(1)}%` : '—'}
                            </Typography>
                          </TableCell>
                        </>
                      );
                    })()}
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <TextField
                        size="small"
                        type="number"
                        value={row.costBasis ?? ''}
                        onChange={e => updateCostBasis(row.cardId, e.target.value)}
                        placeholder="—"
                        sx={{
                          width: 80,
                          '& input': { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#888', py: 0.5 },
                        }}
                        InputProps={{ startAdornment: <Typography sx={{ color: '#555', fontSize: '0.8rem', mr: 0.3 }}>$</Typography> }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem',
                        color: pnl != null ? (pnl >= 0 ? '#00ff41' : '#ff1744') : '#555',
                      }}>
                        {pnl != null ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem',
                        color: pnlPct != null ? (pnlPct >= 0 ? '#00ff41' : '#ff1744') : '#555',
                      }}>
                        {pnlPct != null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%` : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <TextField
                        size="small"
                        type="number"
                        value={row.alertAbove ?? ''}
                        onChange={e => updateAlert(row.cardId, 'alertAbove', e.target.value)}
                        placeholder="—"
                        sx={{
                          width: 80,
                          '& input': { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#00ff41', py: 0.5 },
                        }}
                        InputProps={{ startAdornment: <Typography sx={{ color: '#555', fontSize: '0.8rem', mr: 0.3 }}>$</Typography> }}
                      />
                    </TableCell>
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <TextField
                        size="small"
                        type="number"
                        value={row.alertBelow ?? ''}
                        onChange={e => updateAlert(row.cardId, 'alertBelow', e.target.value)}
                        placeholder="—"
                        sx={{
                          width: 80,
                          '& input': { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#ff1744', py: 0.5 },
                        }}
                        InputProps={{ startAdornment: <Typography sx={{ color: '#555', fontSize: '0.8rem', mr: 0.3 }}>$</Typography> }}
                      />
                    </TableCell>
                    <TableCell align="center" onClick={e => e.stopPropagation()}>
                      <IconButton size="small" onClick={() => removeFromWatchlist(row.cardId)} sx={{ color: '#ff1744' }}>
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
