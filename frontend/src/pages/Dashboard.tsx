import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Paper, Typography, Grid, TextField, InputAdornment } from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import SearchIcon from '@mui/icons-material/Search';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import MarketTicker from '../components/MarketTicker';
import TopMovers from '../components/TopMovers';
import AgentFeed from '../components/AgentFeed';
import PriceAlerts from '../components/PriceAlerts';
import OnboardingBanner from '../components/OnboardingBanner';
import { api } from '../services/api';
import type { AgentInsight } from '../services/api';

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
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Dashboard | PKMN Trader';
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, []);

  useEffect(() => {
    api.getMarketIndex().then(setIndex).catch(console.error);
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

        {/* Market Index Cards */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: '#666', textTransform: 'uppercase', fontSize: '0.65rem' }}>
                Avg Card Price
              </Typography>
              <Typography variant="h2" sx={{ color: '#00ff41', fontWeight: 700 }}>
                ${index?.avg_price?.toFixed(2) || '—'}
              </Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: '#666', textTransform: 'uppercase', fontSize: '0.65rem' }}>
                Catalog Value
              </Typography>
              <Typography variant="h2" sx={{ color: '#00bcd4', fontWeight: 700 }}>
                ${index?.total_market_cap ? (index.total_market_cap > 1000 ? `${(index.total_market_cap / 1000).toFixed(1)}K` : index.total_market_cap.toFixed(0)) : '—'}
              </Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: '#666', textTransform: 'uppercase', fontSize: '0.65rem' }}>
                Cards Tracked
              </Typography>
              <Typography variant="h2" sx={{ fontWeight: 700 }}>
                {index?.total_cards?.toLocaleString() || '—'}
              </Typography>
            </Paper>
          </Grid>
        </Grid>

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
