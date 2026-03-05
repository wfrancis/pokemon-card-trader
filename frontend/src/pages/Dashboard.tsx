import { useEffect, useState } from 'react';
import { Box, Paper, Typography, Grid, Button, CircularProgress, Snackbar, Alert } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import MarketTicker from '../components/MarketTicker';
import TopMovers from '../components/TopMovers';
import { api } from '../services/api';

interface MarketIndex {
  avg_price: number;
  total_cards: number;
  total_market_cap: number;
}

export default function Dashboard() {
  const [index, setIndex] = useState<MarketIndex | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  useEffect(() => {
    api.getMarketIndex().then(setIndex).catch(console.error);
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

      <Box sx={{ p: 2 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShowChartIcon sx={{ color: '#00ff41', fontSize: 32 }} />
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
                Market Index (Avg Price)
              </Typography>
              <Typography variant="h2" sx={{ color: '#00ff41', fontWeight: 700 }}>
                ${index?.avg_price?.toFixed(2) || '—'}
              </Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: '#666', textTransform: 'uppercase', fontSize: '0.65rem' }}>
                Total Market Cap
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
