import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Paper, Typography, Grid, TextField, InputAdornment } from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import SearchIcon from '@mui/icons-material/Search';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import { LineChart, Line, ResponsiveContainer, Tooltip as ReTooltip, YAxis } from 'recharts';
import MarketTicker from '../components/MarketTicker';
import TopMovers from '../components/TopMovers';
import AgentFeed from '../components/AgentFeed';
import PriceAlerts from '../components/PriceAlerts';
import OnboardingBanner from '../components/OnboardingBanner';
import { api } from '../services/api';
import type { AgentInsight, WeeklyRecapResponse } from '../services/api';

interface MarketIndex {
  avg_price: number;
  total_cards: number;
  total_market_cap: number;
  last_sync_at: string | null;
}

function formatSyncTime(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Dashboard() {
  const [index, setIndex] = useState<MarketIndex | null>(null);
  const [hasAlerts, setHasAlerts] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [recap, setRecap] = useState<WeeklyRecapResponse | null>(null);
  const [indexHistory, setIndexHistory] = useState<{ week: string; avg: number }[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Dashboard | PKMN Trader';
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, []);

  useEffect(() => {
    api.getMarketIndex().then(setIndex).catch(console.error);
    api.getWeeklyRecap().then(setRecap).catch(() => {});
    // Fetch archive weeks to build historical market index sparkline
    api.getRecapArchive().then(async (archive) => {
      const weeks = (archive.weeks || []).slice(-8); // last 8 weeks
      const results = await Promise.allSettled(
        weeks.map(w => api.getRecapForWeek(w.start).then(r => ({ week: w.start, avg: r?.market_index?.avg_price })))
      );
      const points = results
        .filter((r): r is PromiseFulfilledResult<{ week: string; avg: number | undefined }> => r.status === 'fulfilled' && !!r.value.avg)
        .map(r => ({ week: r.value.week, avg: r.value.avg! }));
      setIndexHistory(points);
    }).catch(() => {});
    // Check if there are unread alerts
    api.getAgentInsights({ acknowledged: false, limit: 1 })
      .then((insights: AgentInsight[]) => setHasAlerts(insights.length > 0))
      .catch(() => {});
  }, []);

  return (
    <Box>
      <MarketTicker />

      <Box sx={{ p: { xs: 1.5, md: 2 } }}>
        {/* Onboarding */}
        <OnboardingBanner />

        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShowChartIcon sx={{ color: '#00ff41', fontSize: { xs: 24, md: 32 } }} />
            <Typography variant="h1" sx={{ color: '#00ff41' }}>
              PKMN MARKET
            </Typography>
          </Box>
          {index?.last_sync_at && (
            <Typography sx={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '0.65rem',
              color: '#666',
            }}>
              Last synced: {formatSyncTime(index.last_sync_at)}
            </Typography>
          )}
        </Box>

        {/* Hero Search */}
        <TextField
          fullWidth
          placeholder="Search any Pokemon card..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searchValue.trim()) {
              navigate(`/explore?q=${encodeURIComponent(searchValue.trim())}`);
            }
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: '#555' }} />
              </InputAdornment>
            ),
          }}
          sx={{
            mb: 2,
            '& .MuiOutlinedInput-root': {
              fontSize: '1rem',
              '& fieldset': { borderColor: '#222' },
              '&:hover fieldset': { borderColor: '#333' },
              '&.Mui-focused fieldset': { borderColor: '#00ff41' },
            },
          }}
        />

        {/* Market Index */}
        <Paper sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid size={{ xs: 12, md: 5 }}>
              <Typography sx={{ color: '#666', textTransform: 'uppercase', fontSize: '0.6rem', fontFamily: '"JetBrains Mono", monospace', letterSpacing: 1, mb: 0.5 }}>
                Market Index
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                <Typography sx={{ color: '#00ff41', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '2rem', lineHeight: 1 }}>
                  ${index?.avg_price?.toFixed(2) || '—'}
                </Typography>
                {recap?.market_index?.change_pct != null && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                    {recap.market_index.change_pct > 0 ? (
                      <TrendingUpIcon sx={{ color: '#00ff41', fontSize: 18 }} />
                    ) : recap.market_index.change_pct < 0 ? (
                      <TrendingDownIcon sx={{ color: '#ff1744', fontSize: 18 }} />
                    ) : (
                      <TrendingFlatIcon sx={{ color: '#666', fontSize: 18 }} />
                    )}
                    <Typography sx={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: recap.market_index.change_pct > 0 ? '#00ff41' : recap.market_index.change_pct < 0 ? '#ff1744' : '#666',
                    }}>
                      {recap.market_index.change_pct > 0 ? '+' : ''}{recap.market_index.change_pct.toFixed(1)}% 7d
                    </Typography>
                  </Box>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 3, mt: 1 }}>
                <Box>
                  <Typography sx={{ color: '#555', fontSize: '0.55rem', textTransform: 'uppercase', fontFamily: '"JetBrains Mono", monospace' }}>Catalog Value</Typography>
                  <Typography sx={{ color: '#00bcd4', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1rem' }}>
                    ${index?.total_market_cap ? (index.total_market_cap > 1000 ? `${(index.total_market_cap / 1000).toFixed(1)}K` : index.total_market_cap.toFixed(0)) : '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography sx={{ color: '#555', fontSize: '0.55rem', textTransform: 'uppercase', fontFamily: '"JetBrains Mono", monospace' }}>Cards Tracked</Typography>
                  <Typography sx={{ fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1rem' }}>
                    {index?.total_cards?.toLocaleString() || '—'}
                  </Typography>
                </Box>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              {indexHistory.length > 1 ? (
                <Box sx={{ width: '100%', height: 120 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={indexHistory} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                      <YAxis domain={['dataMin', 'dataMax']} hide />
                      <ReTooltip
                        contentStyle={{ background: '#111', border: '1px solid #333', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem' }}
                        labelStyle={{ color: '#888' }}
                        formatter={(v: number) => [`$${v.toFixed(2)}`, 'Avg Price']}
                        labelFormatter={(l: string) => `Week of ${l}`}
                      />
                      <Line type="monotone" dataKey="avg" stroke="#00ff41" strokeWidth={2} dot={{ r: 3, fill: '#00ff41' }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              ) : (
                <Box sx={{ width: '100%', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ color: '#333', fontSize: '0.7rem', fontFamily: '"JetBrains Mono", monospace' }}>
                    Index trend builds over time
                  </Typography>
                </Box>
              )}
            </Grid>
          </Grid>
        </Paper>

        {/* Price Alerts */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <NotificationsActiveIcon sx={{ color: '#ff9800', fontSize: 16 }} />
            <Typography sx={{
              fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem',
              color: '#ff9800', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
            }}>
              Alerts
            </Typography>
          </Box>
          <PriceAlerts />
          {hasAlerts && <AgentFeed limit={5} />}
        </Box>

        {/* Top Movers */}
        <TopMovers />
      </Box>
    </Box>
  );
}
