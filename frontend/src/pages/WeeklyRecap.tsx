import { useEffect, useRef, useState } from 'react';
import {
  Box, Paper, Typography, Grid, Skeleton, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Avatar, LinearProgress, IconButton, Tooltip,
  Button, Chip, CircularProgress,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import HistoryIcon from '@mui/icons-material/History';
import { useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { api, WeeklyRecapResponse, RecapArchiveResponse } from '../services/api';

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ChangePct({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <Typography sx={{ color: '#666', fontFamily: 'monospace' }}>--</Typography>;
  const color = value >= 0 ? '#00ff41' : '#ff1744';
  const sign = value >= 0 ? '+' : '';
  return (
    <Typography sx={{ color, fontFamily: 'monospace', fontWeight: 700 }}>
      {sign}{value.toFixed(2)}%
    </Typography>
  );
}

function LoadingSkeleton() {
  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
      <Skeleton variant="rounded" height={40} sx={{ bgcolor: '#1a1a1a', mb: 1, width: 350 }} />
      <Skeleton variant="rounded" height={20} sx={{ bgcolor: '#1a1a1a', mb: 3, width: 200 }} />
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[1, 2, 3].map(i => (
          <Grid size={{ xs: 12, md: 4 }} key={i}>
            <Skeleton variant="rounded" height={100} sx={{ bgcolor: '#1a1a1a' }} />
          </Grid>
        ))}
      </Grid>
      {[1, 2, 3].map(i => (
        <Skeleton key={i} variant="rounded" height={200} sx={{ bgcolor: '#1a1a1a', mb: 2 }} />
      ))}
    </Box>
  );
}

function formatWeekLabel(start: string, end: string) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export default function WeeklyRecap() {
  const [data, setData] = useState<WeeklyRecapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archive, setArchive] = useState<RecapArchiveResponse | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null); // null = current week
  const [weekLoading, setWeekLoading] = useState(false);
  const [trendData, setTrendData] = useState<{ date: string; avg_price: number }[]>([]);
  const navigate = useNavigate();
  const recapRef = useRef<HTMLDivElement>(null);

  const handleExport = async () => {
    if (!recapRef.current || !data) return;
    const watermark = document.createElement('div');
    watermark.style.cssText = 'text-align:center;padding:16px;color:#666;font-size:14px;font-family:monospace;';
    watermark.textContent = 'PKMN TRADER \u2022 pokemon-card-trader.fly.dev';
    recapRef.current.appendChild(watermark);

    const canvas = await html2canvas(recapRef.current, {
      backgroundColor: '#0a0a0a',
      scale: 2,
    });

    recapRef.current.removeChild(watermark);

    const link = document.createElement('a');
    link.download = `pkmn_recap_${data.period.start}_${data.period.end}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  // Load current week recap + archive list on mount
  useEffect(() => {
    Promise.all([
      api.getWeeklyRecap(),
      api.getRecapArchive(),
    ])
      .then(([recapData, archiveData]) => {
        setData(recapData);
        setArchive(archiveData);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Load market index trend from archive weeks
  useEffect(() => {
    if (!archive || archive.weeks.length < 2) return;
    const weeks = archive.weeks;
    Promise.allSettled(
      weeks.map(w => api.getRecapForWeek(w.start))
    ).then(results => {
      const points: { date: string; avg_price: number }[] = [];
      results.forEach((res, i) => {
        if (res.status === 'fulfilled') {
          points.push({
            date: weeks[i].end,
            avg_price: res.value.market_index.avg_price,
          });
        }
      });
      // Sort chronologically
      points.sort((a, b) => a.date.localeCompare(b.date));
      setTrendData(points);
    });
  }, [archive]);

  // Load a specific historical week
  const handleWeekSelect = (startDate: string | null) => {
    if (startDate === selectedWeek) return;
    setSelectedWeek(startDate);
    setWeekLoading(true);

    const fetchPromise = startDate
      ? api.getRecapForWeek(startDate)
      : api.getWeeklyRecap();

    fetchPromise
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setWeekLoading(false));
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography sx={{ color: '#ff1744' }}>Error: {error}</Typography>
    </Box>
  );
  if (!data) return null;

  const { period, market_index, gainers, losers, hottest } = data;
  const maxActivity = Math.max(...hottest.map(h => h.activity_score), 1);

  return (
    <Box ref={recapRef} sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="h4" sx={{ color: '#00bcd4', fontWeight: 700, letterSpacing: 3 }}>
          WEEKLY MARKET RECAP
        </Typography>
        <Tooltip title="Export as Image">
          <IconButton
            onClick={handleExport}
            sx={{ color: '#00bcd4', '&:hover': { bgcolor: '#1a1a1a' } }}
          >
            <CameraAltIcon />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.85rem', mb: 1.5 }}>
        {formatDate(period.start)} &mdash; {formatDate(period.end)}
      </Typography>

      {/* Week Selector */}
      {archive && archive.weeks.length > 1 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, flexWrap: 'wrap' }}>
          <HistoryIcon sx={{ color: '#666', fontSize: 18 }} />
          <Chip
            label="This Week"
            size="small"
            onClick={() => handleWeekSelect(null)}
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              bgcolor: selectedWeek === null ? '#00bcd4' : '#1a1a1a',
              color: selectedWeek === null ? '#000' : '#888',
              border: '1px solid',
              borderColor: selectedWeek === null ? '#00bcd4' : '#333',
              '&:hover': { bgcolor: selectedWeek === null ? '#00bcd4' : '#252525' },
              fontWeight: selectedWeek === null ? 700 : 400,
            }}
          />
          {archive.weeks.slice(1).map((week) => (
            <Chip
              key={week.start}
              label={formatWeekLabel(week.start, week.end)}
              size="small"
              onClick={() => handleWeekSelect(week.start)}
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                bgcolor: selectedWeek === week.start ? '#00bcd4' : '#1a1a1a',
                color: selectedWeek === week.start ? '#000' : '#888',
                border: '1px solid',
                borderColor: selectedWeek === week.start ? '#00bcd4' : '#333',
                '&:hover': { bgcolor: selectedWeek === week.start ? '#00bcd4' : '#252525' },
                fontWeight: selectedWeek === week.start ? 700 : 400,
              }}
            />
          ))}
          {weekLoading && <CircularProgress size={16} sx={{ color: '#00bcd4', ml: 1 }} />}
        </Box>
      )}

      {/* Plain-English Market Summary */}
      <Paper sx={{ p: 2.5, mb: 2, bgcolor: '#0d0d0d', border: '1px solid #1e1e1e' }}>
        <Typography sx={{ color: '#c0c0c0', fontFamily: 'monospace', fontSize: '0.95rem', lineHeight: 1.7 }}>
          {(() => {
            const pct = market_index.change_pct;
            const direction = pct === null ? 'held steady' : pct >= 0 ? `rose ${pct.toFixed(1)}%` : `fell ${Math.abs(pct).toFixed(1)}%`;
            const topGainer = gainers.length > 0
              ? ` Top gainer: ${gainers[0].name} rose ${gainers[0].change_pct?.toFixed(1) ?? '?'}%.`
              : '';
            const topLoser = losers.length > 0
              ? ` Top loser: ${losers[0].name} fell ${Math.abs(losers[0].change_pct ?? 0).toFixed(1)}%.`
              : '';
            return `The Pokemon card market ${direction} this week. ${market_index.total_cards.toLocaleString()} cards are tracked with an average price of $${market_index.avg_price.toFixed(2)}.${topGainer}${topLoser}`;
          })()}
        </Typography>
      </Paper>

      {/* Market Stats */}
      <Grid container spacing={2} sx={{ mb: 1 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2.5, bgcolor: '#0d0d0d', border: '1px solid #1e1e1e', textAlign: 'center' }}>
            <Typography sx={{ color: '#666', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
              Avg Price
            </Typography>
            <Typography variant="h4" sx={{ color: '#e0e0e0', fontFamily: 'monospace', fontWeight: 700 }}>
              ${market_index.avg_price.toFixed(2)}
            </Typography>
            <ChangePct value={market_index.change_pct} />
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2.5, bgcolor: '#0d0d0d', border: '1px solid #1e1e1e', textAlign: 'center' }}>
            <Typography sx={{ color: '#666', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
              Cards Tracked
            </Typography>
            <Typography variant="h4" sx={{ color: '#00bcd4', fontFamily: 'monospace', fontWeight: 700 }}>
              {market_index.total_cards.toLocaleString()}
            </Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2.5, bgcolor: '#0d0d0d', border: '1px solid #1e1e1e', textAlign: 'center' }}>
            <Typography sx={{ color: '#666', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
              Catalog Value
            </Typography>
            <Typography variant="h4" sx={{ color: '#e0e0e0', fontFamily: 'monospace', fontWeight: 700 }}>
              ${market_index.total_market_cap.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* What This Means */}
      <Paper sx={{ px: 2.5, py: 1.5, mb: 3, bgcolor: '#111', border: '1px solid #1e1e1e', borderLeft: '3px solid #00bcd4' }}>
        <Typography sx={{ color: '#aaa', fontSize: '0.85rem', fontFamily: 'monospace' }}>
          {market_index.change_pct === null
            ? '\u{1F4CA} Not enough historical data yet for comparison.'
            : market_index.change_pct > 2
              ? '\u{1F4C8} Strong week \u2014 prices rose significantly. Good time to review your collection.'
              : market_index.change_pct >= 0
                ? '\u{1F4CA} Steady market \u2014 prices holding or slightly up.'
                : market_index.change_pct < -2
                  ? '\u{1F4C9} Down week \u2014 could be buying opportunities.'
                  : '\u{1F4CA} Steady market \u2014 prices slightly down but stable.'}
        </Typography>
      </Paper>

      {/* Market Index Trend */}
      {trendData.length >= 2 && (
        <Paper sx={{ p: 2.5, mb: 2, bgcolor: '#0d0d0d', border: '1px solid #1e1e1e' }}>
          <Typography sx={{ color: '#00ff41', fontWeight: 700, letterSpacing: 1, fontSize: '0.85rem', mb: 0.5 }}>
            MARKET INDEX TREND
          </Typography>
          <Typography sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.7rem', mb: 1.5 }}>
            Average card price across tracked cards
          </Typography>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
                tickFormatter={(d: string) => {
                  const dt = new Date(d + 'T00:00:00');
                  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }}
                stroke="#333"
              />
              <YAxis
                tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                stroke="#333"
                domain={['auto', 'auto']}
              />
              <RechartsTooltip
                contentStyle={{ backgroundColor: '#0a0a1a', border: '1px solid #333', fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}
                labelStyle={{ color: '#888' }}
                labelFormatter={(d: string) => {
                  const dt = new Date(d + 'T00:00:00');
                  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                }}
                formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Avg Price']}
              />
              <Line
                type="monotone"
                dataKey="avg_price"
                stroke="#00ff41"
                strokeWidth={2}
                dot={{ r: 3, fill: '#00ff41', stroke: '#0a0a1a', strokeWidth: 1 }}
                activeDot={{ r: 5, stroke: '#00ff41', strokeWidth: 2, fill: '#0a0a1a' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      )}

      {/* Top 5 Gainers */}
      <Paper sx={{ mb: 2, bgcolor: '#0d0d0d', border: '1px solid #1e1e1e' }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #1e1e1e' }}>
          <TrendingUpIcon sx={{ color: '#00ff41' }} />
          <Typography sx={{ color: '#00ff41', fontWeight: 700, letterSpacing: 1 }}>TOP 5 GAINERS</Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>#</TableCell>
                <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>CARD</TableCell>
                <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>SET</TableCell>
                <TableCell align="right" sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>PRICE</TableCell>
                <TableCell align="right" sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>CHANGE</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {gainers.map((card, i) => (
                <TableRow
                  key={card.card_id}
                  hover
                  onClick={() => navigate(`/card/${card.card_id}`)}
                  sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#1a1a1a' } }}
                >
                  <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace' }}>{i + 1}</TableCell>
                  <TableCell sx={{ borderColor: '#1e1e1e' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar src={card.image_small} variant="rounded" sx={{ width: 32, height: 44 }} />
                      <Typography sx={{ color: '#e0e0e0', fontSize: '0.85rem' }}>{card.name}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ color: '#888', borderColor: '#1e1e1e', fontSize: '0.8rem' }}>{card.set_name}</TableCell>
                  <TableCell align="right" sx={{ color: '#e0e0e0', borderColor: '#1e1e1e', fontFamily: 'monospace', fontWeight: 600 }}>
                    ${card.current_price.toFixed(2)}
                  </TableCell>
                  <TableCell align="right" sx={{ borderColor: '#1e1e1e' }}>
                    <ChangePct value={card.change_pct} />
                  </TableCell>
                </TableRow>
              ))}
              {gainers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ color: '#666', borderColor: '#1e1e1e', textAlign: 'center' }}>No data</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Top 5 Losers */}
      <Paper sx={{ mb: 2, bgcolor: '#0d0d0d', border: '1px solid #1e1e1e' }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #1e1e1e' }}>
          <TrendingDownIcon sx={{ color: '#ff1744' }} />
          <Typography sx={{ color: '#ff1744', fontWeight: 700, letterSpacing: 1 }}>TOP 5 LOSERS</Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>#</TableCell>
                <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>CARD</TableCell>
                <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>SET</TableCell>
                <TableCell align="right" sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>PRICE</TableCell>
                <TableCell align="right" sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>CHANGE</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {losers.map((card, i) => (
                <TableRow
                  key={card.card_id}
                  hover
                  onClick={() => navigate(`/card/${card.card_id}`)}
                  sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#1a1a1a' } }}
                >
                  <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace' }}>{i + 1}</TableCell>
                  <TableCell sx={{ borderColor: '#1e1e1e' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar src={card.image_small} variant="rounded" sx={{ width: 32, height: 44 }} />
                      <Typography sx={{ color: '#e0e0e0', fontSize: '0.85rem' }}>{card.name}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ color: '#888', borderColor: '#1e1e1e', fontSize: '0.8rem' }}>{card.set_name}</TableCell>
                  <TableCell align="right" sx={{ color: '#e0e0e0', borderColor: '#1e1e1e', fontFamily: 'monospace', fontWeight: 600 }}>
                    ${card.current_price.toFixed(2)}
                  </TableCell>
                  <TableCell align="right" sx={{ borderColor: '#1e1e1e' }}>
                    <ChangePct value={card.change_pct} />
                  </TableCell>
                </TableRow>
              ))}
              {losers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ color: '#666', borderColor: '#1e1e1e', textAlign: 'center' }}>No data</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Top 5 Hottest Cards */}
      <Paper sx={{ mb: 2, bgcolor: '#0d0d0d', border: '1px solid #1e1e1e' }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #1e1e1e' }}>
          <WhatshotIcon sx={{ color: '#ff9800' }} />
          <Typography sx={{ color: '#ff9800', fontWeight: 700, letterSpacing: 1 }}>TOP 5 HOTTEST CARDS</Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>#</TableCell>
                <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>CARD</TableCell>
                <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>SET</TableCell>
                <TableCell align="right" sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem' }}>PRICE</TableCell>
                <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.7rem', width: '30%' }}>ACTIVITY</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {hottest.map((card, i) => (
                <TableRow
                  key={card.card_id}
                  hover
                  onClick={() => navigate(`/card/${card.card_id}`)}
                  sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#1a1a1a' } }}
                >
                  <TableCell sx={{ color: '#666', borderColor: '#1e1e1e', fontFamily: 'monospace' }}>{i + 1}</TableCell>
                  <TableCell sx={{ borderColor: '#1e1e1e' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar src={card.image_small} variant="rounded" sx={{ width: 32, height: 44 }} />
                      <Typography sx={{ color: '#e0e0e0', fontSize: '0.85rem' }}>{card.name}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ color: '#888', borderColor: '#1e1e1e', fontSize: '0.8rem' }}>{card.set_name}</TableCell>
                  <TableCell align="right" sx={{ color: '#e0e0e0', borderColor: '#1e1e1e', fontFamily: 'monospace', fontWeight: 600 }}>
                    ${card.current_price.toFixed(2)}
                  </TableCell>
                  <TableCell sx={{ borderColor: '#1e1e1e' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={(card.activity_score / maxActivity) * 100}
                        sx={{
                          flex: 1,
                          height: 8,
                          borderRadius: 1,
                          bgcolor: '#1a1a1a',
                          '& .MuiLinearProgress-bar': { bgcolor: '#ff9800' },
                        }}
                      />
                      <Typography sx={{ color: '#ff9800', fontFamily: 'monospace', fontSize: '0.75rem', minWidth: 32, textAlign: 'right' }}>
                        {card.activity_score.toFixed(0)}
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {hottest.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ color: '#666', borderColor: '#1e1e1e', textAlign: 'center' }}>No data</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Export Button */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3, mb: 1 }}>
        <Button
          variant="outlined"
          startIcon={<CameraAltIcon />}
          onClick={handleExport}
          sx={{
            color: '#00bcd4',
            borderColor: '#00bcd4',
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: 1,
            px: 4,
            py: 1.2,
            '&:hover': { bgcolor: '#0d2a2f', borderColor: '#00e5ff' },
          }}
        >
          Export as Image
        </Button>
      </Box>
    </Box>
  );
}
