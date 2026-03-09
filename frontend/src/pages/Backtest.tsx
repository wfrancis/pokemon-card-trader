import { useEffect, useState } from 'react';
import {
  Box, Paper, Typography, Grid, Select, MenuItem, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  FormControl, InputLabel, TextField, Tabs, Tab, Chip,
} from '@mui/material';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ComposedChart, Legend,
} from 'recharts';
import {
  api, Card, BacktestResult, PortfolioBacktestResult,
  BacktestDailyValue,
} from '../services/api';

function MetricBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ textAlign: 'center', p: 1 }}>
      <Typography variant="body2" sx={{ color: '#666', fontSize: '0.7rem' }}>
        {label}
      </Typography>
      <Typography variant="h3" sx={{ color: color || '#fff', fontWeight: 700, fontSize: { xs: '1rem', md: '1.25rem' } }}>
        {value}
      </Typography>
    </Box>
  );
}

function PerformanceChart({ data }: { data: BacktestDailyValue[] }) {
  if (!data.length) return null;

  // Normalize to percentage returns
  const firstValue = data[0].portfolio_value;
  const firstPrice = data[0].price;
  const MAX_CHART_PCT = 10000;
  const chartData = data.map(d => ({
    date: d.date,
    strategy: Math.min(MAX_CHART_PCT, Math.max(-100, ((d.portfolio_value - firstValue) / firstValue) * 100)),
    buyHold: Math.min(MAX_CHART_PCT, Math.max(-100, ((d.price - firstPrice) / firstPrice) * 100)),
    inPosition: d.in_position,
  }));

  return (
    <Box sx={{ height: { xs: 250, sm: 300, md: 350 } }}>
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#666', fontSize: 10 }}
          tickFormatter={(v: string) => v.slice(5)}
          interval={Math.max(1, Math.floor(chartData.length / 10))}
        />
        <YAxis
          tick={{ fill: '#666', fontSize: 10 }}
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a2e' }}
          formatter={(value: any) => [`${Number(value).toFixed(2)}%`, '']}
        />
        <Legend />
        <ReferenceLine y={0} stroke="#333" />
        <Line
          name="Strategy"
          type="monotone"
          dataKey="strategy"
          stroke="#00ff41"
          dot={false}
          strokeWidth={2}
        />
        <Line
          name="Buy & Hold"
          type="monotone"
          dataKey="buyHold"
          stroke="#666"
          dot={false}
          strokeWidth={1}
          strokeDasharray="5 5"
        />
      </ComposedChart>
    </ResponsiveContainer>
    </Box>
  );
}

function TradeTable({ result }: { result: BacktestResult }) {
  if (!result.trades.length) return <Typography sx={{ color: '#666' }}>No trades executed</Typography>;
  return (
    <TableContainer sx={{ maxHeight: 300, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ bgcolor: '#0a0a0a', color: '#00bcd4' }}>Date</TableCell>
            <TableCell sx={{ bgcolor: '#0a0a0a', color: '#00bcd4' }}>Action</TableCell>
            <TableCell sx={{ bgcolor: '#0a0a0a', color: '#00bcd4' }} align="right">Price</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {result.trades.map((t, i) => (
            <TableRow key={i}>
              <TableCell sx={{ color: '#ccc' }}>{t.date}</TableCell>
              <TableCell>
                <Chip
                  label={t.action.toUpperCase()}
                  size="small"
                  sx={{
                    bgcolor: t.action === 'buy' ? '#00ff4120' : '#ff174420',
                    color: t.action === 'buy' ? '#00ff41' : '#ff1744',
                    fontWeight: 700,
                  }}
                />
              </TableCell>
              <TableCell align="right" sx={{ color: '#fff', fontFamily: 'monospace' }}>
                ${t.price.toFixed(2)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function Backtest() {
  const [tab, setTab] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [selectedCard, setSelectedCard] = useState<number | ''>('');
  const [strategy, setStrategy] = useState('combined');
  const [strategies, setStrategies] = useState<{ key: string; name: string }[]>([]);
  const [capital, setCapital] = useState('1000');

  // Single card results
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [allResults, setAllResults] = useState<BacktestResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Portfolio results
  const [portfolioResult, setPortfolioResult] = useState<PortfolioBacktestResult | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  useEffect(() => {
    api.getCards({ has_price: 'true', page_size: '100', sort_by: 'current_price', sort_dir: 'desc' })
      .then(r => setCards(r.data))
      .catch(console.error);
    api.getStrategies()
      .then(r => setStrategies(r.strategies))
      .catch(console.error);
  }, []);

  const runSingleBacktest = async () => {
    if (!selectedCard) return;
    setLoading(true);
    setResult(null);
    setAllResults([]);
    try {
      const r = await api.backtestCard(selectedCard as number, strategy, parseFloat(capital) || 1000);
      if (r.error) {
        alert(r.error);
      } else {
        setResult(r);
      }
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  };

  const runAllStrategies = async () => {
    if (!selectedCard) return;
    setLoading(true);
    setResult(null);
    setAllResults([]);
    try {
      const r = await api.backtestCardAll(selectedCard as number, parseFloat(capital) || 1000);
      if (r.results?.length) {
        setAllResults(r.results);
        setResult(r.results[0]);
      }
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  };

  const runPortfolioBacktest = async () => {
    setPortfolioLoading(true);
    setPortfolioResult(null);
    try {
      const r = await api.backtestPortfolio(strategy, 10, parseFloat(capital) || 10000);
      setPortfolioResult(r);
    } catch (e: any) {
      alert(e.message);
    }
    setPortfolioLoading(false);
  };

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Typography variant="h2" sx={{ mb: 2, color: '#00bcd4' }}>
        STRATEGY BACKTESTER
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 2, '& .MuiTab-root': { color: '#666' }, '& .Mui-selected': { color: '#00bcd4' } }}
      >
        <Tab label="Single Card" />
        <Tab label="Portfolio" />
      </Tabs>

      {tab === 0 && (
        <>
          {/* Controls */}
          <Paper sx={{ p: 2, mb: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid size={{ xs: 12, md: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Card</InputLabel>
                  <Select
                    value={selectedCard}
                    label="Card"
                    onChange={e => setSelectedCard(e.target.value as number)}
                  >
                    {cards.map(c => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.name} — {c.set_name} (${c.current_price?.toFixed(2) || '?'})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, md: 2 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Strategy</InputLabel>
                  <Select value={strategy} label="Strategy" onChange={e => setStrategy(e.target.value)}>
                    {strategies.map(s => (
                      <MenuItem key={s.key} value={s.key}>{s.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, md: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Capital ($)"
                  value={capital}
                  onChange={e => setCapital(e.target.value)}
                  type="number"
                />
              </Grid>
              <Grid size={{ xs: 6, md: 2 }}>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={runSingleBacktest}
                  disabled={loading || !selectedCard}
                  sx={{ bgcolor: '#00bcd4' }}
                >
                  {loading ? 'Running...' : 'Run Backtest'}
                </Button>
              </Grid>
              <Grid size={{ xs: 6, md: 2 }}>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={runAllStrategies}
                  disabled={loading || !selectedCard}
                  sx={{ borderColor: '#00bcd4', color: '#00bcd4' }}
                >
                  Compare All
                </Button>
              </Grid>
            </Grid>
          </Paper>

          {/* Strategy Comparison Table */}
          {allResults.length > 0 && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h3" sx={{ mb: 1, color: '#00bcd4' }}>
                STRATEGY COMPARISON
              </Typography>
              <TableContainer sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ color: '#00bcd4' }}>Strategy</TableCell>
                      <TableCell sx={{ color: '#00bcd4' }} align="right">Return</TableCell>
                      <TableCell sx={{ color: '#00bcd4' }} align="right">Buy&Hold</TableCell>
                      <TableCell sx={{ color: '#00bcd4' }} align="right">Alpha</TableCell>
                      <TableCell sx={{ color: '#00bcd4' }} align="right">Win Rate</TableCell>
                      <TableCell sx={{ color: '#00bcd4' }} align="right">Trades</TableCell>
                      <TableCell sx={{ color: '#00bcd4' }} align="right">Max DD</TableCell>
                      <TableCell sx={{ color: '#00bcd4' }} align="right">Sharpe</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {allResults.map((r, i) => {
                      const alpha = r.strategy_return_pct - r.buy_hold_return_pct;
                      return (
                        <TableRow
                          key={i}
                          hover
                          onClick={() => setResult(r)}
                          sx={{ cursor: 'pointer', bgcolor: result?.strategy === r.strategy ? '#1a1a2e' : undefined }}
                        >
                          <TableCell sx={{ color: '#fff' }}>{r.strategy}</TableCell>
                          <TableCell align="right" sx={{
                            color: r.strategy_return_pct >= 0 ? '#00ff41' : '#ff1744',
                            fontFamily: 'monospace',
                          }}>
                            {r.strategy_return_pct >= 0 ? '+' : ''}{r.strategy_return_pct.toFixed(1)}%
                          </TableCell>
                          <TableCell align="right" sx={{
                            color: r.buy_hold_return_pct >= 0 ? '#00ff41' : '#ff1744',
                            fontFamily: 'monospace',
                          }}>
                            {r.buy_hold_return_pct >= 0 ? '+' : ''}{r.buy_hold_return_pct.toFixed(1)}%
                          </TableCell>
                          <TableCell align="right" sx={{
                            color: alpha >= 0 ? '#00ff41' : '#ff1744',
                            fontWeight: 700,
                            fontFamily: 'monospace',
                          }}>
                            {alpha >= 0 ? '+' : ''}{alpha.toFixed(1)}%
                          </TableCell>
                          <TableCell align="right" sx={{ color: '#fff', fontFamily: 'monospace' }}>
                            {r.win_rate}%
                          </TableCell>
                          <TableCell align="right" sx={{ color: '#fff', fontFamily: 'monospace' }}>
                            {r.total_trades}
                          </TableCell>
                          <TableCell align="right" sx={{ color: '#ff1744', fontFamily: 'monospace' }}>
                            -{r.max_drawdown_pct}%
                          </TableCell>
                          <TableCell align="right" sx={{ color: '#fff', fontFamily: 'monospace' }}>
                            {r.sharpe_ratio?.toFixed(2) ?? 'N/A'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {/* Single Result Detail */}
          {result && !result.error && (
            <>
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="h3" sx={{ mb: 1, color: '#00bcd4' }}>
                  {result.strategy} — {result.card_name}
                </Typography>
                <Grid container spacing={1} sx={{ mb: 2 }}>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox
                      label="Strategy Return"
                      value={`${result.strategy_return_pct >= 0 ? '+' : ''}${result.strategy_return_pct.toFixed(1)}%`}
                      color={result.strategy_return_pct >= 0 ? '#00ff41' : '#ff1744'}
                    />
                  </Grid>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox
                      label="Buy & Hold"
                      value={`${result.buy_hold_return_pct >= 0 ? '+' : ''}${result.buy_hold_return_pct.toFixed(1)}%`}
                      color={result.buy_hold_return_pct >= 0 ? '#00ff41' : '#ff1744'}
                    />
                  </Grid>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox
                      label="Alpha"
                      value={`${(result.strategy_return_pct - result.buy_hold_return_pct) >= 0 ? '+' : ''}${(result.strategy_return_pct - result.buy_hold_return_pct).toFixed(1)}%`}
                      color={(result.strategy_return_pct - result.buy_hold_return_pct) >= 0 ? '#00ff41' : '#ff1744'}
                    />
                  </Grid>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox label="Win Rate" value={`${result.win_rate}%`} color="#00bcd4" />
                  </Grid>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox label="Max Drawdown" value={`-${result.max_drawdown_pct}%`} color="#ff1744" />
                  </Grid>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox label="Sharpe Ratio" value={result.sharpe_ratio?.toFixed(2) ?? 'N/A'} />
                  </Grid>
                </Grid>
                <PerformanceChart data={result.daily_values} />
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Typography variant="h3" sx={{ mb: 1, color: '#00bcd4' }}>
                  TRADE LOG ({result.total_trades} trades)
                </Typography>
                <TradeTable result={result} />
              </Paper>
            </>
          )}
        </>
      )}

      {tab === 1 && (
        <>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid size={{ xs: 6, md: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Strategy</InputLabel>
                  <Select value={strategy} label="Strategy" onChange={e => setStrategy(e.target.value)}>
                    {strategies.map(s => (
                      <MenuItem key={s.key} value={s.key}>{s.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Total Capital ($)"
                  value={capital}
                  onChange={e => setCapital(e.target.value)}
                  type="number"
                />
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={runPortfolioBacktest}
                  disabled={portfolioLoading}
                  sx={{ bgcolor: '#00bcd4' }}
                >
                  {portfolioLoading ? 'Running...' : 'Run Portfolio Backtest'}
                </Button>
              </Grid>
            </Grid>
          </Paper>

          {portfolioResult && !portfolioResult.error && (
            <>
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="h3" sx={{ mb: 1, color: '#00bcd4' }}>
                  PORTFOLIO RESULTS — {portfolioResult.strategy}
                </Typography>
                <Grid container spacing={1} sx={{ mb: 2 }}>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox
                      label="Portfolio Return"
                      value={`${portfolioResult.portfolio_return_pct >= 0 ? '+' : ''}${portfolioResult.portfolio_return_pct.toFixed(1)}%`}
                      color={portfolioResult.portfolio_return_pct >= 0 ? '#00ff41' : '#ff1744'}
                    />
                  </Grid>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox
                      label="Buy & Hold"
                      value={`${portfolioResult.buy_hold_return_pct >= 0 ? '+' : ''}${portfolioResult.buy_hold_return_pct.toFixed(1)}%`}
                      color={portfolioResult.buy_hold_return_pct >= 0 ? '#00ff41' : '#ff1744'}
                    />
                  </Grid>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox
                      label="Alpha"
                      value={`${portfolioResult.alpha >= 0 ? '+' : ''}${portfolioResult.alpha.toFixed(1)}%`}
                      color={portfolioResult.alpha >= 0 ? '#00ff41' : '#ff1744'}
                    />
                  </Grid>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox label="Final Value" value={`$${portfolioResult.final_value.toLocaleString()}`} />
                  </Grid>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox label="Cards" value={`${portfolioResult.cards_count}`} color="#00bcd4" />
                  </Grid>
                  <Grid size={{ xs: 4, md: 2 }}>
                    <MetricBox label="Total Trades" value={`${portfolioResult.total_trades}`} />
                  </Grid>
                </Grid>
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Typography variant="h3" sx={{ mb: 1, color: '#00bcd4' }}>
                  PER-CARD BREAKDOWN
                </Typography>
                <TableContainer sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ color: '#00bcd4' }}>Card</TableCell>
                        <TableCell sx={{ color: '#00bcd4' }} align="right">Strategy</TableCell>
                        <TableCell sx={{ color: '#00bcd4' }} align="right">Buy&Hold</TableCell>
                        <TableCell sx={{ color: '#00bcd4' }} align="right">Alpha</TableCell>
                        <TableCell sx={{ color: '#00bcd4' }} align="right">Win Rate</TableCell>
                        <TableCell sx={{ color: '#00bcd4' }} align="right">Trades</TableCell>
                        <TableCell sx={{ color: '#00bcd4' }} align="right">Max DD</TableCell>
                        <TableCell sx={{ color: '#00bcd4' }} align="right">Sharpe</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {portfolioResult.card_results.map((r, i) => {
                        const alpha = r.strategy_return_pct - r.buy_hold_return_pct;
                        return (
                          <TableRow key={i}>
                            <TableCell sx={{ color: '#fff' }}>{r.card_name}</TableCell>
                            <TableCell align="right" sx={{
                              color: r.strategy_return_pct >= 0 ? '#00ff41' : '#ff1744',
                              fontFamily: 'monospace',
                            }}>
                              {r.strategy_return_pct >= 0 ? '+' : ''}{r.strategy_return_pct.toFixed(1)}%
                            </TableCell>
                            <TableCell align="right" sx={{
                              color: r.buy_hold_return_pct >= 0 ? '#00ff41' : '#ff1744',
                              fontFamily: 'monospace',
                            }}>
                              {r.buy_hold_return_pct >= 0 ? '+' : ''}{r.buy_hold_return_pct.toFixed(1)}%
                            </TableCell>
                            <TableCell align="right" sx={{
                              color: alpha >= 0 ? '#00ff41' : '#ff1744',
                              fontWeight: 700,
                              fontFamily: 'monospace',
                            }}>
                              {alpha >= 0 ? '+' : ''}{alpha.toFixed(1)}%
                            </TableCell>
                            <TableCell align="right" sx={{ color: '#fff', fontFamily: 'monospace' }}>
                              {r.win_rate}%
                            </TableCell>
                            <TableCell align="right" sx={{ color: '#fff', fontFamily: 'monospace' }}>
                              {r.total_trades}
                            </TableCell>
                            <TableCell align="right" sx={{ color: '#ff1744', fontFamily: 'monospace' }}>
                              -{r.max_drawdown_pct}%
                            </TableCell>
                            <TableCell align="right" sx={{ color: '#fff', fontFamily: 'monospace' }}>
                              {r.sharpe_ratio?.toFixed(2) ?? 'N/A'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </>
          )}

          {portfolioResult?.error && (
            <Paper sx={{ p: 2 }}>
              <Typography sx={{ color: '#ff1744' }}>{portfolioResult.error}</Typography>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
