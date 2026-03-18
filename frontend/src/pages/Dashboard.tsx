import React, { useEffect, useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { Box, Paper, Typography, Grid, TextField, InputAdornment, Link, Tooltip, Autocomplete } from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import SearchIcon from '@mui/icons-material/Search';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
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
import type { AgentInsight, WeeklyRecapResponse, ScreenerCard } from '../services/api';

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
  const [searchSuggestions, setSearchSuggestions] = useState<{ id: string; name: string; set_name: string; current_price: number }[]>([]);
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recap, setRecap] = useState<WeeklyRecapResponse | null>(null);
  const [indexHistory, setIndexHistory] = useState<{ week: string; avg: number }[]>([]);
  const [topFlips, setTopFlips] = useState<ScreenerCard[]>([]);
  const [topFlipsLoading, setTopFlipsLoading] = useState(true);
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
    // Fetch top flip opportunities
    api.getScreenerCards({
      sort_by: 'est_profit',
      sort_dir: 'desc',
      min_profit: '0.01',
      min_velocity: '0.5',
      min_liquidity: '30',
      min_price: '2',
      page_size: '5',
    }).then(res => setTopFlips(res.data || [])).catch((err) => { console.error('Top Flips fetch failed:', err); }).finally(() => setTopFlipsLoading(false));
  }, []);

  return (
    <Box>
      <MarketTicker />

      <Box sx={{ p: { xs: 1.5, md: 2 } }}>
        {/* Onboarding */}
        <OnboardingBanner />

        {/* Collection Builder CTA */}
        <Paper
          sx={{ p: 2.5, mb: 2, bgcolor: '#001a00', border: '2px solid #00ff4133', borderRadius: 2, cursor: 'pointer', textAlign: 'center', '&:hover': { borderColor: '#00ff4166' } }}
          onClick={() => navigate('/collection-builder')}
        >
          <Typography sx={{ color: '#00ff41', fontSize: '1rem', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
            What's My Collection Worth?
          </Typography>
          <Typography sx={{ color: '#888', fontSize: '0.8rem', mt: 0.5 }}>
            Add your cards and find out instantly — no account needed
          </Typography>
        </Paper>

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

        {/* Hero Search with Autocomplete */}
        <Autocomplete
          freeSolo
          options={searchSuggestions}
          getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.name}
          filterOptions={(x) => x}
          inputValue={searchValue}
          onInputChange={(_, val) => {
            setSearchValue(val);
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
            if (val.trim().length >= 2) {
              searchTimerRef.current = setTimeout(() => {
                api.getCards({ q: val.trim(), page_size: '6' }).then(res => setSearchSuggestions(res.data.map(c => ({ id: c.id, name: c.name, set_name: c.set_name, current_price: c.current_price })))).catch(() => {});
              }, 300);
            } else {
              setSearchSuggestions([]);
            }
          }}
          onChange={(_, val) => {
            if (val && typeof val !== 'string') {
              navigate(`/card/${val.id}`);
            }
          }}
          renderOption={(props, opt) => (
            <li {...props} key={typeof opt === 'string' ? opt : opt.id}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <Box>
                  <Typography sx={{ fontSize: '0.8rem', color: '#ccc' }}>{typeof opt === 'string' ? opt : opt.name}</Typography>
                  {typeof opt !== 'string' && <Typography sx={{ fontSize: '0.6rem', color: '#666' }}>{opt.set_name}</Typography>}
                </Box>
                {typeof opt !== 'string' && <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem', color: '#00ff41', fontWeight: 700 }}>${opt.current_price?.toFixed(2)}</Typography>}
              </Box>
            </li>
          )}
          componentsProps={{ paper: { sx: { bgcolor: '#111', border: '1px solid #333', '& .MuiAutocomplete-option': { '&:hover': { bgcolor: '#1a2a1a' } } } } }}
          renderInput={(params) => (
            <TextField
              {...params}
              fullWidth
              placeholder="Search any Pokemon card..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchValue.trim()) {
                  navigate(`/explore?q=${encodeURIComponent(searchValue.trim())}`);
                }
              }}
              InputProps={{
                ...params.InputProps,
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
          )}
        />

        {/* Market Index */}
        <Paper sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid size={{ xs: 12, md: 5 }}>
              <Tooltip title="Average price across all tracked Pokemon cards — shows overall market health" arrow placement="top">
                <Typography sx={{ color: '#666', textTransform: 'uppercase', fontSize: '0.6rem', fontFamily: '"JetBrains Mono", monospace', letterSpacing: 1, mb: 0.5, cursor: 'help', borderBottom: '1px dotted #444' }}>
                  Market Index
                </Typography>
              </Tooltip>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                <Typography sx={{ color: '#00ff41', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: { xs: '1.5rem', md: '2rem' }, lineHeight: 1 }}>
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
                  <Tooltip title="Total value of all 6,600+ cards we track added together" arrow><Typography sx={{ color: '#555', fontSize: '0.55rem', textTransform: 'uppercase', fontFamily: '"JetBrains Mono", monospace', cursor: 'help', borderBottom: '1px dotted #333' }}>Catalog Value</Typography></Tooltip>
                  <Typography sx={{ color: '#00bcd4', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1rem' }}>
                    ${index?.total_market_cap ? (index.total_market_cap > 1000 ? `${(index.total_market_cap / 1000).toFixed(1)}K` : index.total_market_cap.toFixed(0)) : '—'}
                  </Typography>
                </Box>
                <Box>
                  <Tooltip title="Number of Pokemon cards with price data in our database" arrow><Typography sx={{ color: '#555', fontSize: '0.55rem', textTransform: 'uppercase', fontFamily: '"JetBrains Mono", monospace', cursor: 'help', borderBottom: '1px dotted #333' }}>Cards Tracked</Typography></Tooltip>
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
                    {recap ? 'Loading trend...' : 'Index trend builds over time'}
                  </Typography>
                </Box>
              )}
            </Grid>
          </Grid>
        </Paper>

        {/* Flip Finder CTA */}
        <Paper
          sx={{ p: 2, mb: 2, bgcolor: '#001a00', border: '2px solid #00ff4133', borderRadius: 2, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 2,
            '&:hover': { borderColor: '#00ff41', bgcolor: '#001a0a' } }}
          onClick={() => navigate('/screener?flipFinder=true')}
        >
          <MonetizationOnIcon sx={{ fontSize: 36, color: '#00ff41' }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ color: '#00ff41', fontSize: '0.95rem', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
              FLIP FINDER
            </Typography>
            <Typography sx={{ color: '#888', fontSize: '0.75rem' }}>
              {topFlips.length > 0 && topFlips[0].est_profit !== null
                ? `Best flip: ${topFlips[0].name} +$${topFlips[0].est_profit.toFixed(2)} (+${(topFlips[0].current_price > 0 ? (topFlips[0].est_profit / topFlips[0].current_price) * 100 : 0).toFixed(0)}% Return)`
                : `Find cards you can buy and resell for profit — ${topFlips.length || '50+'}  opportunities right now`}
            </Typography>
          </Box>
          <Box sx={{ ml: 'auto' }}>
            <ArrowForwardIcon sx={{ color: '#00ff4166' }} />
          </Box>
        </Paper>

        {/* Top Flip Opportunities */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LocalFireDepartmentIcon sx={{ color: '#ff9800', fontSize: 16 }} />
              <Tooltip title="Cards you can buy now and resell for a profit (after seller fees)" arrow>
                <Typography sx={{
                  fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem',
                  color: '#ff9800', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
                  cursor: 'help',
                }}>
                  Cards Worth Checking Out
                </Typography>
              </Tooltip>
              <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: { xs: '0.5rem', sm: '0.55rem' }, color: '#666', ml: 0.5, display: { xs: 'none', sm: 'block' } }}>
                These cards are selling for more than their listing price — potential money-makers
              </Typography>
            </Box>
            <Link
              component={RouterLink}
              to="/screener"
              sx={{
                fontFamily: '"JetBrains Mono", monospace', fontSize: '0.6rem',
                color: '#555', textDecoration: 'none', '&:hover': { color: '#00ff41' },
              }}
            >
              View All &rarr;
            </Link>
          </Box>
          {topFlipsLoading ? (
            <Paper sx={{ p: 2, mb: 0.5, border: '1px solid #1a2a1a', bgcolor: '#060d06', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem', color: '#555' }}>
                Loading top flips...
              </Typography>
            </Paper>
          ) : topFlips.length === 0 ? (
            <Paper sx={{ p: 2, mb: 0.5, border: '1px solid #1a2a1a', bgcolor: '#060d06', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem', color: '#555' }}>
                No flip opportunities found
              </Typography>
            </Paper>
          ) : (
            topFlips.map((card) => {
              const profit = card.est_profit;
              const roi = profit !== null && card.current_price > 0
                ? (profit / card.current_price) * 100 : null;
              return (
                <Paper
                  key={card.id}
                  onClick={() => navigate(`/card/${card.id}`)}
                  sx={{
                    p: 0.8, mb: 0.5, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 1.5,
                    border: '1px solid #1a2a1a', bgcolor: '#060d06',
                    '&:hover': { borderColor: '#00ff4144' },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: '0.7rem', fontWeight: 600, color: '#ccc' }}>
                      {card.name}
                      <Typography component="span" sx={{ color: '#444', fontSize: '0.6rem', ml: 1 }}>
                        {card.set_name}
                      </Typography>
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 }, flexShrink: 0 }}>
                    <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.65rem', color: '#00ff41', fontWeight: 700 }}>
                      {profit !== null ? `+$${profit.toFixed(2)}` : '--'}
                    </Typography>
                    {roi !== null && (
                      <Tooltip title="How much profit you'd make as a percentage of what you paid" arrow>
                        <Box sx={{
                          px: 0.7, py: 0.1, borderRadius: '3px',
                          bgcolor: roi >= 0 ? 'rgba(0,255,65,0.12)' : 'rgba(255,23,68,0.12)',
                          border: `1px solid ${roi >= 0 ? 'rgba(0,255,65,0.25)' : 'rgba(255,23,68,0.25)'}`,
                          cursor: 'help',
                        }}>
                          <Typography sx={{
                            fontFamily: '"JetBrains Mono", monospace', fontSize: '0.6rem', fontWeight: 700,
                            color: roi >= 0 ? '#00ff41' : '#ff1744',
                          }}>
                            {roi >= 0 ? '+' : ''}{roi.toFixed(0)}% Return
                          </Typography>
                        </Box>
                      </Tooltip>
                    )}
                    <Tooltip title="How often this card sells — higher means easier to resell" arrow>
                      <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.6rem', color: '#888', cursor: 'help', display: { xs: 'none', sm: 'block' } }}>
                        {card.sales_per_day !== null ? `Sells ${card.sales_per_day.toFixed(1)} times/day` : '--'}
                      </Typography>
                    </Tooltip>
                  </Box>
                </Paper>
              );
            })
          )}
        </Box>

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
