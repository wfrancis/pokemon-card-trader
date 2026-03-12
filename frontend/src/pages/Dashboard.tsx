import { useEffect, useState } from 'react';
import { Box, Paper, Typography, Grid, Button, CircularProgress, Snackbar, Alert, Chip } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import MarketTicker from '../components/MarketTicker';
import TopMovers from '../components/TopMovers';
import AgentFeed from '../components/AgentFeed';
import { api } from '../services/api';
import type { AgentStatus } from '../services/api';

interface MarketIndex {
  avg_price: number;
  total_cards: number;
  total_market_cap: number;
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Dashboard() {
  const [index, setIndex] = useState<MarketIndex | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  useEffect(() => {
    api.getMarketIndex().then(setIndex).catch(console.error);
    api.getAgentStatus().then(setAgentStatus).catch(() => {});
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await api.syncCards(2);
      setSnackbar({
        open: true,
        message: `Synced! ${result.total_created} new, ${result.total_updated} updated, ${result.total_prices} prices`,
        severity: 'success',
      });
      // Refresh index
      api.getMarketIndex().then(setIndex).catch(console.error);
    } catch (err) {
      setSnackbar({ open: true, message: `Sync failed: ${err}`, severity: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Box>
      <MarketTicker />

      <Box sx={{ p: { xs: 1.5, md: 2 } }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShowChartIcon sx={{ color: '#00ff41', fontSize: { xs: 24, md: 32 } }} />
            <Typography variant="h1" sx={{ color: '#00ff41' }}>
              PKMN MARKET
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={syncing ? <CircularProgress size={16} /> : <SyncIcon />}
            onClick={handleSync}
            disabled={syncing}
            size="small"
          >
            {syncing ? 'Syncing...' : 'Sync Data'}
          </Button>
        </Box>

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

        {/* Agent Status Bar */}
        <Paper sx={{
          p: 1, mb: 2, bgcolor: '#0a0a0a',
          border: '1px solid #00bcd422',
          display: 'flex', alignItems: 'center', gap: 1.5,
          flexWrap: 'wrap',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <SmartToyIcon sx={{ color: '#00bcd4', fontSize: 16 }} />
            <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.65rem', color: '#00bcd4', fontWeight: 700 }}>
              AGENT
            </Typography>
          </Box>
          {agentStatus && (
            <>
              <Chip
                label={`Last: ${agentStatus.last_analysis_at ? getTimeAgo(agentStatus.last_analysis_at) : 'never'}`}
                size="small"
                sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.55rem', height: 20, bgcolor: '#1a1a1a', color: '#888' }}
              />
              <Chip
                label={`${agentStatus.active_predictions} active predictions`}
                size="small"
                sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.55rem', height: 20, bgcolor: '#1a1a1a', color: '#00ff41' }}
              />
              {agentStatus.overall_hit_rate !== null && (
                <Chip
                  label={`${agentStatus.overall_hit_rate}% accuracy (${agentStatus.resolved_predictions} resolved)`}
                  size="small"
                  sx={{
                    fontFamily: '"JetBrains Mono", monospace', fontSize: '0.55rem', height: 20,
                    bgcolor: '#1a1a1a',
                    color: agentStatus.overall_hit_rate >= 60 ? '#00ff41' : agentStatus.overall_hit_rate >= 50 ? '#ffd700' : '#ff1744',
                  }}
                />
              )}
              {agentStatus.unread_insights > 0 && (
                <Chip
                  label={`${agentStatus.unread_insights} new insights`}
                  size="small"
                  sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.55rem', height: 20, bgcolor: '#ffd70015', color: '#ffd700' }}
                />
              )}
            </>
          )}
        </Paper>

        {/* Agent Insights Feed */}
        <Box sx={{ mb: 2 }}>
          <Typography sx={{
            fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem',
            color: '#555', textTransform: 'uppercase', mb: 0.5, letterSpacing: 1,
          }}>
            Agent Insights
          </Typography>
          <AgentFeed limit={5} />
        </Box>

        {/* Top Movers */}
        <TopMovers />
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
