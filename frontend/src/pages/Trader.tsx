import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Chip,
  Skeleton,
  Avatar,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Pagination,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as ReTooltip, ReferenceLine,
  BarChart, Bar, Cell,
} from 'recharts';
import { api } from '../services/api';
import type {
  PropSummary, PropPosition, PropTrade, PropEquityPoint,
  PropSignal, PropPerformance,
} from '../services/api';

const mono = { fontFamily: '"JetBrains Mono", "Fira Code", monospace' };
const GREEN = '#4caf50';
const RED = '#f44336';
const BRIGHT_GREEN = '#00ff41';
const STARTING_CAPITAL = 10000;

function pnlColor(v: number | null | undefined): string {
  if (v == null || v === 0) return '#888';
  return v > 0 ? GREEN : RED;
}

function fmtDollar(v: number | null | undefined, showSign = false): string {
  if (v == null) return '--';
  const sign = showSign && v > 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number | null | undefined, showSign = true): string {
  if (v == null) return '--';
  const sign = showSign && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

type EquityRange = '1W' | '1M' | '3M' | 'ALL';

function filterEquityByRange(data: PropEquityPoint[], range: EquityRange): PropEquityPoint[] {
  if (range === 'ALL') return data;
  const now = new Date();
  const cutoff = new Date();
  switch (range) {
    case '1W': cutoff.setDate(now.getDate() - 7); break;
    case '1M': cutoff.setMonth(now.getMonth() - 1); break;
    case '3M': cutoff.setMonth(now.getMonth() - 3); break;
  }
  const cutoffStr = cutoff.toISOString().split('T')[0];
  return data.filter(d => d.date >= cutoffStr);
}

// ── Stat Card Component ──────────────────────────────────────────────────────

function StatCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <Paper sx={{ p: 1.5, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a', textAlign: 'center' }}>
      <Typography sx={{ color: '#555', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: 1, ...mono, mb: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ color: color || '#e0e0e0', fontSize: '1.1rem', fontWeight: 700, ...mono }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ color: '#555', fontSize: '0.6rem', ...mono, mt: 0.3 }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function Trader() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cycleRunning, setCycleRunning] = useState(false);
  const [cycleResult, setCycleResult] = useState<string | null>(null);

  // Data states
  const [summary, setSummary] = useState<PropSummary | null>(null);
  const [positions, setPositions] = useState<PropPosition[]>([]);
  const [trades, setTrades] = useState<PropTrade[]>([]);
  const [equityCurve, setEquityCurve] = useState<PropEquityPoint[]>([]);
  const [signals, setSignals] = useState<PropSignal[]>([]);
  const [performance, setPerformance] = useState<PropPerformance | null>(null);
  const [equityRange, setEquityRange] = useState<EquityRange>('ALL');

  // Trade blotter pagination
  const [tradePage, setTradePage] = useState(1);
  const tradesPerPage = 20;

  useEffect(() => {
    document.title = 'Prop Trading Desk | PKMN Trader';
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [portfolioRes, equityRes, signalsRes, perfRes, tradesRes] = await Promise.allSettled([
        api.getPropPortfolio(),
        api.getPropEquityCurve(),
        api.getPropSignals(),
        api.getPropPerformance(),
        api.getPropTrades(200),
      ]);

      if (portfolioRes.status === 'fulfilled') {
        setSummary(portfolioRes.value.summary);
        setPositions(portfolioRes.value.positions || []);
      }
      if (equityRes.status === 'fulfilled') setEquityCurve(equityRes.value);
      if (signalsRes.status === 'fulfilled') setSignals(signalsRes.value);
      if (perfRes.status === 'fulfilled') setPerformance(perfRes.value);
      if (tradesRes.status === 'fulfilled') setTrades(tradesRes.value);
    } catch (err) {
      console.error('Failed to load prop desk data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh summary every 60s
  useEffect(() => {
    const interval = setInterval(() => {
      api.getPropSummary().then(setSummary).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const handleRunCycle = async () => {
    setCycleRunning(true);
    setCycleResult(null);
    try {
      const res = await api.runPropCycle();
      setCycleResult(`Cycle complete: ${res.trades_executed ?? 0} trades executed`);
      // Reload all data
      loadData();
    } catch (err: any) {
      setCycleResult(`Cycle failed: ${err.message}`);
    } finally {
      setCycleRunning(false);
    }
  };

  const isEmpty = !loading && (!summary || summary.total_trades === 0) && positions.length === 0;

  const filteredEquity = filterEquityByRange(equityCurve, equityRange);

  // ── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      {/* ── HEADER BAR ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AccountBalanceIcon sx={{ color: BRIGHT_GREEN, fontSize: 28 }} />
          <Typography variant="h1" sx={{ color: BRIGHT_GREEN, fontSize: { xs: '1rem', md: '1.3rem' } }}>
            PROP TRADING DESK
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={cycleRunning ? <CircularProgress size={16} sx={{ color: BRIGHT_GREEN }} /> : <PlayArrowIcon />}
          disabled={cycleRunning}
          onClick={handleRunCycle}
          sx={{
            color: BRIGHT_GREEN, borderColor: BRIGHT_GREEN + '66',
            ...mono, fontSize: '0.75rem', fontWeight: 700,
            '&:hover': { borderColor: BRIGHT_GREEN, bgcolor: BRIGHT_GREEN + '11' },
            '&.Mui-disabled': { color: '#555', borderColor: '#333' },
          }}
        >
          {cycleRunning ? 'RUNNING...' : 'RUN CYCLE'}
        </Button>
      </Box>

      {cycleResult && (
        <Paper sx={{ p: 1, mb: 1.5, bgcolor: cycleResult.includes('failed') ? '#1a0000' : '#001a00', border: `1px solid ${cycleResult.includes('failed') ? '#330000' : '#003300'}` }}>
          <Typography sx={{ ...mono, fontSize: '0.75rem', color: cycleResult.includes('failed') ? RED : GREEN }}>
            {cycleResult}
          </Typography>
        </Paper>
      )}

      {/* ── PORTFOLIO SUMMARY STATS ── */}
      {loading ? (
        <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
          <Skeleton variant="text" width={300} height={50} sx={{ bgcolor: '#1a1a1a' }} />
          <Skeleton variant="text" width={500} height={30} sx={{ bgcolor: '#1a1a1a' }} />
        </Paper>
      ) : summary ? (
        <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: { xs: 1.5, md: 3 }, flexWrap: 'wrap', mb: 0.5 }}>
            <Typography sx={{ ...mono, fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: '#e0e0e0' }}>
              {fmtDollar(summary.total_value)}
            </Typography>
            <Typography sx={{ ...mono, fontSize: { xs: '0.9rem', md: '1.1rem' }, fontWeight: 700, color: pnlColor(summary.total_pnl) }}>
              {fmtDollar(summary.total_pnl, true)} ({fmtPct(summary.total_pnl_pct)})
            </Typography>
            <Typography sx={{ ...mono, fontSize: '0.8rem', color: '#888' }}>
              {summary.position_count} positions
            </Typography>
            <Typography sx={{ ...mono, fontSize: '0.8rem', color: '#00bcd4' }}>
              {fmtDollar(summary.cash)} cash
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {summary.win_rate != null && (
              <Typography sx={{ ...mono, fontSize: '0.7rem', color: '#888' }}>
                Win Rate: <span style={{ color: '#e0e0e0' }}>{fmtPct(summary.win_rate, false)}</span>
              </Typography>
            )}
            {summary.sharpe_ratio != null && (
              <Typography sx={{ ...mono, fontSize: '0.7rem', color: '#888' }}>
                Sharpe: <span style={{ color: '#e0e0e0' }}>{summary.sharpe_ratio.toFixed(2)}</span>
              </Typography>
            )}
            {summary.max_drawdown_pct != null && (
              <Typography sx={{ ...mono, fontSize: '0.7rem', color: '#888' }}>
                Max DD: <span style={{ color: RED }}>{fmtPct(-Math.abs(summary.max_drawdown_pct), false)}</span>
              </Typography>
            )}
            <Typography sx={{ ...mono, fontSize: '0.7rem', color: '#888' }}>
              Trades: <span style={{ color: '#e0e0e0' }}>{summary.total_trades}</span>
            </Typography>
          </Box>
        </Paper>
      ) : null}

      {/* ── EMPTY STATE ── */}
      {isEmpty && (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
          <AccountBalanceIcon sx={{ fontSize: 48, color: '#333', mb: 2 }} />
          <Typography sx={{ ...mono, fontSize: '1rem', color: '#888', mb: 1 }}>
            The prop desk hasn't started trading yet.
          </Typography>
          <Typography sx={{ ...mono, fontSize: '0.8rem', color: '#555', mb: 2 }}>
            Click RUN CYCLE to begin automated trading with ${STARTING_CAPITAL.toLocaleString()} starting capital.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<PlayArrowIcon />}
            onClick={handleRunCycle}
            disabled={cycleRunning}
            sx={{
              color: BRIGHT_GREEN, borderColor: BRIGHT_GREEN + '66', ...mono,
              '&:hover': { borderColor: BRIGHT_GREEN, bgcolor: BRIGHT_GREEN + '11' },
            }}
          >
            RUN CYCLE
          </Button>
        </Paper>
      )}

      {/* ── TABS ── */}
      {!isEmpty && (
        <>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{
              mb: 2, minHeight: 36,
              '& .MuiTab-root': {
                ...mono, fontSize: '0.75rem', fontWeight: 700, color: '#888',
                minHeight: 36, py: 0.5, letterSpacing: 1,
                '&.Mui-selected': { color: BRIGHT_GREEN },
              },
              '& .MuiTabs-indicator': { bgcolor: BRIGHT_GREEN },
            }}
          >
            <Tab label="TRADING DESK" />
            <Tab label="TRADE BLOTTER" />
            <Tab label="PERFORMANCE" />
          </Tabs>

          {/* ════════════ TAB 0: TRADING DESK ════════════ */}
          {tab === 0 && (
            <>
              {/* EQUITY CURVE */}
              <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ShowChartIcon sx={{ color: BRIGHT_GREEN, fontSize: 18 }} />
                    <Typography sx={{ ...mono, fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>
                      Equity Curve
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {(['1W', '1M', '3M', 'ALL'] as EquityRange[]).map(r => (
                      <Button
                        key={r}
                        size="small"
                        onClick={() => setEquityRange(r)}
                        sx={{
                          ...mono, fontSize: '0.65rem', fontWeight: 700,
                          minWidth: 32, py: 0.2, px: 0.8,
                          color: equityRange === r ? BRIGHT_GREEN : '#555',
                          bgcolor: equityRange === r ? BRIGHT_GREEN + '11' : 'transparent',
                          border: `1px solid ${equityRange === r ? BRIGHT_GREEN + '44' : '#222'}`,
                          '&:hover': { bgcolor: BRIGHT_GREEN + '11' },
                        }}
                      >
                        {r}
                      </Button>
                    ))}
                  </Box>
                </Box>

                {loading ? (
                  <Skeleton variant="rectangular" height={300} sx={{ bgcolor: '#1a1a1a', borderRadius: 1 }} />
                ) : filteredEquity.length > 0 ? (
                  <Box sx={{ height: { xs: 250, md: 350 } }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={filteredEquity} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
                        <defs>
                          <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={GREEN} stopOpacity={0.3} />
                            <stop offset="50%" stopColor={GREEN} stopOpacity={0.1} />
                            <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="2 4" stroke="#222" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: '#888', fontSize: 11, ...mono }}
                          tickLine={false}
                          axisLine={{ stroke: '#222' }}
                          tickFormatter={fmtDate}
                          interval={Math.max(0, Math.floor(filteredEquity.length / 8))}
                        />
                        <YAxis
                          tick={{ fill: '#888', fontSize: 11, ...mono }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`}
                          width={60}
                          domain={['auto', 'auto']}
                        />
                        <ReferenceLine
                          y={STARTING_CAPITAL}
                          stroke="#666"
                          strokeDasharray="6 4"
                          strokeWidth={1}
                          label={{
                            value: `$${STARTING_CAPITAL.toLocaleString()} break-even`,
                            position: 'right',
                            fill: '#666',
                            fontSize: 10,
                            fontFamily: mono.fontFamily,
                          }}
                        />
                        <ReTooltip
                          contentStyle={{
                            backgroundColor: '#111', border: '1px solid #333',
                            borderRadius: 6, fontSize: 12, ...mono,
                            padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                          }}
                          labelStyle={{ color: '#ccc', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
                          labelFormatter={(label) => {
                            const d = new Date(label + 'T00:00:00');
                            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                          }}
                          formatter={(value: any, name: any) => {
                            const v = Number(value);
                            if (name === 'total_value') return [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Portfolio Value'];
                            if (name === 'daily_pnl' && value != null) return [`${v >= 0 ? '+' : ''}$${v.toFixed(2)}`, 'Daily P&L'];
                            if (name === 'drawdown_pct' && value != null) return [`${v.toFixed(1)}%`, 'Drawdown'];
                            return [value, name];
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="total_value"
                          stroke={GREEN}
                          strokeWidth={2}
                          fill="url(#equityGradient)"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </Box>
                ) : (
                  <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography sx={{ ...mono, fontSize: '0.8rem', color: '#555' }}>
                      Equity curve data will appear after trading cycles run.
                    </Typography>
                  </Box>
                )}
              </Paper>

              {/* TWO-COLUMN LAYOUT: POSITIONS + SIGNALS */}
              <Grid container spacing={2}>
                {/* LEFT: OPEN POSITIONS */}
                <Grid size={{ xs: 12, lg: 7 }}>
                  <Paper sx={{ bgcolor: '#0a0a0a', border: '1px solid #1a1a1a', overflow: 'hidden' }}>
                    <Box sx={{ p: 1.5, borderBottom: '1px solid #1a1a1a' }}>
                      <Typography sx={{ ...mono, fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Open Positions ({positions.length})
                      </Typography>
                    </Box>
                    {positions.length === 0 ? (
                      <Box sx={{ p: 3, textAlign: 'center' }}>
                        <Typography sx={{ ...mono, fontSize: '0.8rem', color: '#555' }}>
                          No open positions
                        </Typography>
                      </Box>
                    ) : (
                      <TableContainer sx={{ maxHeight: 500 }}>
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              {['Card', 'QTY', 'Entry', 'Current', 'P&L', '%', 'Stop', 'Days', 'Signal'].map(h => (
                                <TableCell
                                  key={h}
                                  sx={{
                                    ...mono, fontSize: '0.6rem', color: '#666', fontWeight: 700,
                                    bgcolor: '#0d0d0d', borderBottom: '1px solid #222',
                                    textTransform: 'uppercase', letterSpacing: 0.5,
                                    py: 0.5, whiteSpace: 'nowrap',
                                  }}
                                >
                                  {h}
                                </TableCell>
                              ))}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {[...positions]
                              .sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0))
                              .map((pos) => (
                                <TableRow
                                  key={pos.id}
                                  hover
                                  onClick={() => navigate(`/card/${pos.card_id}`)}
                                  sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#111' } }}
                                >
                                  <TableCell sx={{ borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      {pos.card_image && (
                                        <Avatar
                                          src={pos.card_image}
                                          variant="rounded"
                                          sx={{ width: 28, height: 38 }}
                                        />
                                      )}
                                      <Box sx={{ minWidth: 0 }}>
                                        <Typography noWrap sx={{ fontSize: '0.72rem', fontWeight: 600, color: '#ccc', maxWidth: 140 }}>
                                          {pos.card_name}
                                        </Typography>
                                        <Typography noWrap sx={{ fontSize: '0.55rem', color: '#555' }}>
                                          {pos.set_name}
                                        </Typography>
                                      </Box>
                                    </Box>
                                  </TableCell>
                                  <TableCell sx={{ ...mono, fontSize: '0.72rem', color: '#e0e0e0', borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                    {pos.quantity}
                                  </TableCell>
                                  <TableCell sx={{ ...mono, fontSize: '0.72rem', color: '#888', borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                    ${pos.entry_price.toFixed(2)}
                                  </TableCell>
                                  <TableCell sx={{ ...mono, fontSize: '0.72rem', color: '#e0e0e0', borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                    {pos.current_price != null ? `$${pos.current_price.toFixed(2)}` : '--'}
                                  </TableCell>
                                  <TableCell sx={{ ...mono, fontSize: '0.72rem', color: pnlColor(pos.pnl), fontWeight: 700, borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                    {fmtDollar(pos.pnl, true)}
                                  </TableCell>
                                  <TableCell sx={{ ...mono, fontSize: '0.72rem', color: pnlColor(pos.pnl_pct), fontWeight: 700, borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                    {fmtPct(pos.pnl_pct)}
                                  </TableCell>
                                  <TableCell sx={{ ...mono, fontSize: '0.72rem', color: RED + '99', borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                    {pos.stop_loss != null ? `$${pos.stop_loss.toFixed(2)}` : '--'}
                                  </TableCell>
                                  <TableCell sx={{ ...mono, fontSize: '0.72rem', color: '#888', borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                    {pos.days_held}d
                                  </TableCell>
                                  <TableCell sx={{ borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                    {pos.signal && (
                                      <Chip
                                        label={pos.signal}
                                        size="small"
                                        sx={{
                                          ...mono, fontSize: '0.55rem', fontWeight: 700, height: 20,
                                          color: '#00bcd4', borderColor: '#00bcd433', bgcolor: '#00bcd411',
                                        }}
                                        variant="outlined"
                                      />
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </Paper>
                </Grid>

                {/* RIGHT: ACTIVE SIGNALS */}
                <Grid size={{ xs: 12, lg: 5 }}>
                  <Paper sx={{ bgcolor: '#0a0a0a', border: '1px solid #1a1a1a', overflow: 'hidden' }}>
                    <Box sx={{ p: 1.5, borderBottom: '1px solid #1a1a1a' }}>
                      <Typography sx={{ ...mono, fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Active Signals ({signals.length})
                      </Typography>
                    </Box>
                    {signals.length === 0 ? (
                      <Box sx={{ p: 3, textAlign: 'center' }}>
                        <Typography sx={{ ...mono, fontSize: '0.8rem', color: '#555' }}>
                          No active signals
                        </Typography>
                      </Box>
                    ) : (
                      <Box sx={{ maxHeight: 500, overflowY: 'auto' }}>
                        {signals.map((sig, i) => (
                          <Box
                            key={`${sig.card_id}-${i}`}
                            sx={{
                              p: 1.5, borderBottom: '1px solid #1a1a1a',
                              cursor: 'pointer', '&:hover': { bgcolor: '#111' },
                            }}
                            onClick={() => navigate(`/card/${sig.card_id}`)}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                              {sig.card_image && (
                                <Avatar src={sig.card_image} variant="rounded" sx={{ width: 24, height: 32 }} />
                              )}
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography noWrap sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#ccc' }}>
                                  {sig.card_name}
                                </Typography>
                                <Typography noWrap sx={{ fontSize: '0.55rem', color: '#555' }}>
                                  {sig.set_name}
                                </Typography>
                              </Box>
                              <Chip
                                label={sig.signal_type}
                                size="small"
                                sx={{
                                  ...mono, fontSize: '0.6rem', fontWeight: 700, height: 22,
                                  color: sig.signal_type === 'BUY' ? GREEN : RED,
                                  bgcolor: sig.signal_type === 'BUY' ? GREEN + '15' : RED + '15',
                                  borderColor: sig.signal_type === 'BUY' ? GREEN + '44' : RED + '44',
                                }}
                                variant="outlined"
                              />
                            </Box>

                            {/* Strength bar */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                              <Typography sx={{ ...mono, fontSize: '0.55rem', color: '#666', minWidth: 50 }}>
                                Strength
                              </Typography>
                              <LinearProgress
                                variant="determinate"
                                value={sig.strength}
                                sx={{
                                  flex: 1, height: 4, borderRadius: 2,
                                  bgcolor: '#1a1a1a',
                                  '& .MuiLinearProgress-bar': {
                                    bgcolor: sig.signal_type === 'BUY' ? GREEN : RED,
                                    borderRadius: 2,
                                  },
                                }}
                              />
                              <Typography sx={{ ...mono, fontSize: '0.55rem', color: '#888', minWidth: 28 }}>
                                {sig.strength}%
                              </Typography>
                            </Box>

                            <Typography sx={{ ...mono, fontSize: '0.55rem', color: '#00bcd4', mb: 0.3 }}>
                              {sig.strategy}
                            </Typography>

                            {/* Reasons */}
                            {sig.reasons && sig.reasons.length > 0 && (
                              <Box sx={{ pl: 1 }}>
                                {sig.reasons.slice(0, 3).map((r, j) => (
                                  <Typography key={j} sx={{ fontSize: '0.6rem', color: '#666', lineHeight: 1.4 }}>
                                    - {r}
                                  </Typography>
                                ))}
                              </Box>
                            )}

                            {/* Price targets */}
                            <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                              {sig.entry_price != null && (
                                <Typography sx={{ ...mono, fontSize: '0.55rem', color: '#888' }}>
                                  Entry: <span style={{ color: '#e0e0e0' }}>${sig.entry_price.toFixed(2)}</span>
                                </Typography>
                              )}
                              {sig.target_price != null && (
                                <Typography sx={{ ...mono, fontSize: '0.55rem', color: '#888' }}>
                                  Target: <span style={{ color: GREEN }}>${sig.target_price.toFixed(2)}</span>
                                </Typography>
                              )}
                              {sig.stop_loss != null && (
                                <Typography sx={{ ...mono, fontSize: '0.55rem', color: '#888' }}>
                                  Stop: <span style={{ color: RED }}>${sig.stop_loss.toFixed(2)}</span>
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Paper>
                </Grid>
              </Grid>
            </>
          )}

          {/* ════════════ TAB 1: TRADE BLOTTER ════════════ */}
          {tab === 1 && (
            <Paper sx={{ bgcolor: '#0a0a0a', border: '1px solid #1a1a1a', overflow: 'hidden' }}>
              <Box sx={{ p: 1.5, borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ ...mono, fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Trade History ({trades.length} trades)
                </Typography>
              </Box>
              {trades.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography sx={{ ...mono, fontSize: '0.8rem', color: '#555' }}>
                    No trades executed yet.
                  </Typography>
                </Box>
              ) : (
                <>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          {['Date', 'Card', 'Side', 'QTY', 'Signal $', 'Exec $', 'Slip', 'Fees', 'P&L', 'Signal', 'Strategy'].map(h => (
                            <TableCell
                              key={h}
                              sx={{
                                ...mono, fontSize: '0.6rem', color: '#666', fontWeight: 700,
                                bgcolor: '#0d0d0d', borderBottom: '1px solid #222',
                                textTransform: 'uppercase', letterSpacing: 0.5,
                                py: 0.5, whiteSpace: 'nowrap',
                              }}
                            >
                              {h}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {trades
                          .slice((tradePage - 1) * tradesPerPage, tradePage * tradesPerPage)
                          .map((trade, i) => (
                            <TableRow
                              key={trade.id}
                              sx={{
                                bgcolor: i % 2 === 0 ? 'transparent' : '#080808',
                                cursor: 'pointer',
                                '&:hover': { bgcolor: '#111' },
                              }}
                              onClick={() => navigate(`/card/${trade.card_id}`)}
                            >
                              <TableCell sx={{ ...mono, fontSize: '0.68rem', color: '#888', borderBottom: '1px solid #1a1a1a', py: 0.5, whiteSpace: 'nowrap' }}>
                                {fmtDateTime(trade.executed_at)}
                              </TableCell>
                              <TableCell sx={{ borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                                  {trade.card_image && (
                                    <Avatar src={trade.card_image} variant="rounded" sx={{ width: 22, height: 30 }} />
                                  )}
                                  <Typography noWrap sx={{ fontSize: '0.68rem', fontWeight: 600, color: '#ccc', maxWidth: 120 }}>
                                    {trade.card_name}
                                  </Typography>
                                </Box>
                              </TableCell>
                              <TableCell sx={{ borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                <Chip
                                  label={trade.side}
                                  size="small"
                                  sx={{
                                    ...mono, fontSize: '0.55rem', fontWeight: 700, height: 20,
                                    color: trade.side === 'BUY' ? GREEN : RED,
                                    bgcolor: trade.side === 'BUY' ? GREEN + '15' : RED + '15',
                                    borderColor: trade.side === 'BUY' ? GREEN + '44' : RED + '44',
                                  }}
                                  variant="outlined"
                                />
                              </TableCell>
                              <TableCell sx={{ ...mono, fontSize: '0.68rem', color: '#e0e0e0', borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                {trade.quantity}
                              </TableCell>
                              <TableCell sx={{ ...mono, fontSize: '0.68rem', color: '#888', borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                ${trade.signal_price.toFixed(2)}
                              </TableCell>
                              <TableCell sx={{ ...mono, fontSize: '0.68rem', color: '#e0e0e0', borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                ${trade.exec_price.toFixed(2)}
                              </TableCell>
                              <TableCell sx={{ ...mono, fontSize: '0.68rem', color: trade.slippage && trade.slippage > 0 ? RED + 'bb' : '#888', borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                {trade.slippage != null ? (
                                  <Tooltip title={`${fmtPct(trade.slippage_pct, true)} slippage`}>
                                    <span>{fmtDollar(trade.slippage)}</span>
                                  </Tooltip>
                                ) : '--'}
                              </TableCell>
                              <TableCell sx={{ ...mono, fontSize: '0.68rem', color: '#888', borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                {fmtDollar(trade.fees)}
                              </TableCell>
                              <TableCell sx={{ ...mono, fontSize: '0.68rem', color: pnlColor(trade.pnl), fontWeight: trade.pnl != null ? 700 : 400, borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                {trade.side === 'SELL' ? fmtDollar(trade.pnl, true) : '--'}
                              </TableCell>
                              <TableCell sx={{ borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                {trade.signal && (
                                  <Typography noWrap sx={{ ...mono, fontSize: '0.55rem', color: '#00bcd4', maxWidth: 80 }}>
                                    {trade.signal}
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell sx={{ borderBottom: '1px solid #1a1a1a', py: 0.5 }}>
                                {trade.strategy && (
                                  <Typography noWrap sx={{ ...mono, fontSize: '0.55rem', color: '#666', maxWidth: 80 }}>
                                    {trade.strategy}
                                  </Typography>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  {trades.length > tradesPerPage && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 1.5 }}>
                      <Pagination
                        count={Math.ceil(trades.length / tradesPerPage)}
                        page={tradePage}
                        onChange={(_, p) => setTradePage(p)}
                        size="small"
                        sx={{
                          '& .MuiPaginationItem-root': {
                            ...mono, fontSize: '0.7rem', color: '#888',
                            '&.Mui-selected': { bgcolor: BRIGHT_GREEN + '22', color: BRIGHT_GREEN },
                          },
                        }}
                      />
                    </Box>
                  )}
                </>
              )}
            </Paper>
          )}

          {/* ════════════ TAB 2: PERFORMANCE ════════════ */}
          {tab === 2 && (
            <>
              {/* Performance Stats Grid */}
              {performance ? (
                <>
                  <Grid container spacing={1.5} sx={{ mb: 2 }}>
                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                      <StatCard
                        label="Total Return"
                        value={fmtPct(performance.total_return_pct)}
                        color={pnlColor(performance.total_return_pct)}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                      <StatCard
                        label="Sharpe Ratio"
                        value={performance.sharpe_ratio != null ? performance.sharpe_ratio.toFixed(2) : '--'}
                        color={performance.sharpe_ratio != null && performance.sharpe_ratio > 1 ? GREEN : '#e0e0e0'}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                      <StatCard
                        label="Max Drawdown"
                        value={performance.max_drawdown_pct != null ? fmtPct(-Math.abs(performance.max_drawdown_pct), false) : '--'}
                        color={RED}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                      <StatCard
                        label="Win Rate"
                        value={fmtPct(performance.win_rate, false)}
                        color={performance.win_rate != null && performance.win_rate > 50 ? GREEN : RED}
                        sub={`${performance.winning_trades}W / ${performance.losing_trades}L`}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                      <StatCard
                        label="Avg Win"
                        value={fmtDollar(performance.avg_win, true)}
                        color={GREEN}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                      <StatCard
                        label="Avg Loss"
                        value={fmtDollar(performance.avg_loss)}
                        color={RED}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                      <StatCard
                        label="Profit Factor"
                        value={performance.profit_factor != null ? performance.profit_factor.toFixed(2) : '--'}
                        color={performance.profit_factor != null && performance.profit_factor > 1 ? GREEN : RED}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                      <StatCard
                        label="Avg Hold"
                        value={performance.avg_hold_days != null ? `${performance.avg_hold_days.toFixed(1)}d` : '--'}
                        color="#00bcd4"
                      />
                    </Grid>
                  </Grid>

                  {/* Best / Worst Trade */}
                  <Grid container spacing={1.5} sx={{ mb: 2 }}>
                    {performance.best_trade && (
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Paper sx={{ p: 1.5, bgcolor: GREEN + '08', border: `1px solid ${GREEN}33` }}>
                          <Typography sx={{ ...mono, fontSize: '0.6rem', color: GREEN, textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
                            Best Trade
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {performance.best_trade.card_image && (
                              <Avatar src={performance.best_trade.card_image} variant="rounded" sx={{ width: 28, height: 38 }} />
                            )}
                            <Box>
                              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#ccc' }}>
                                {performance.best_trade.card_name}
                              </Typography>
                              <Typography sx={{ ...mono, fontSize: '0.8rem', fontWeight: 700, color: GREEN }}>
                                {fmtDollar(performance.best_trade.pnl, true)}
                              </Typography>
                            </Box>
                          </Box>
                        </Paper>
                      </Grid>
                    )}
                    {performance.worst_trade && (
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Paper sx={{ p: 1.5, bgcolor: RED + '08', border: `1px solid ${RED}33` }}>
                          <Typography sx={{ ...mono, fontSize: '0.6rem', color: RED, textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
                            Worst Trade
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {performance.worst_trade.card_image && (
                              <Avatar src={performance.worst_trade.card_image} variant="rounded" sx={{ width: 28, height: 38 }} />
                            )}
                            <Box>
                              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#ccc' }}>
                                {performance.worst_trade.card_name}
                              </Typography>
                              <Typography sx={{ ...mono, fontSize: '0.8rem', fontWeight: 700, color: RED }}>
                                {fmtDollar(performance.worst_trade.pnl, true)}
                              </Typography>
                            </Box>
                          </Box>
                        </Paper>
                      </Grid>
                    )}
                  </Grid>

                  {/* P&L by Strategy Bar Chart */}
                  {performance.by_strategy && Object.keys(performance.by_strategy).length > 0 && (
                    <Paper sx={{ p: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
                      <Typography sx={{ ...mono, fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5 }}>
                        P&L by Strategy
                      </Typography>
                      <Box sx={{ height: 220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={Object.entries(performance.by_strategy).map(([name, data]) => ({
                              name: name.replace(/_/g, ' '),
                              pnl: data.pnl,
                              trades: data.trades,
                              winRate: data.win_rate,
                            }))}
                            margin={{ top: 5, right: 20, bottom: 5, left: 20 }}
                          >
                            <CartesianGrid strokeDasharray="2 4" stroke="#222" vertical={false} />
                            <XAxis
                              dataKey="name"
                              tick={{ fill: '#888', fontSize: 11, ...mono }}
                              tickLine={false}
                              axisLine={{ stroke: '#222' }}
                            />
                            <YAxis
                              tick={{ fill: '#888', fontSize: 11, ...mono }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                            />
                            <ReTooltip
                              contentStyle={{
                                backgroundColor: '#111', border: '1px solid #333',
                                borderRadius: 6, fontSize: 12, ...mono,
                                padding: '10px 14px',
                              }}
                              formatter={(value: any, name: any, props: any) => {
                                const { payload } = props;
                                return [
                                  `$${Number(value).toFixed(2)} (${payload.trades} trades, ${payload.winRate.toFixed(0)}% WR)`,
                                  'P&L',
                                ];
                              }}
                            />
                            <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                              {Object.entries(performance.by_strategy).map(([name, data]) => (
                                <Cell key={name} fill={data.pnl >= 0 ? GREEN : RED} fillOpacity={0.8} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </Box>
                    </Paper>
                  )}
                </>
              ) : (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  {loading ? (
                    <Grid container spacing={1.5}>
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Grid size={{ xs: 6, sm: 4, md: 3 }} key={i}>
                          <Skeleton variant="rounded" height={80} sx={{ bgcolor: '#1a1a1a' }} />
                        </Grid>
                      ))}
                    </Grid>
                  ) : (
                    <Typography sx={{ ...mono, fontSize: '0.8rem', color: '#555' }}>
                      Performance data will appear after trades are executed.
                    </Typography>
                  )}
                </Box>
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
}
