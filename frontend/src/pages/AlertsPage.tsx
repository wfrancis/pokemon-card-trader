import { useEffect, useState, useCallback } from 'react';
import {
  Box, Paper, Typography, TextField, Button, Tabs, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Avatar, Stack, Snackbar, Alert,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import { Link } from 'react-router-dom';
import { api, PriceAlertResponse, AlertHistoryItem } from '../services/api';

const mono = '"JetBrains Mono", monospace';

export default function AlertsPage() {
  const [email, setEmail] = useState(() => localStorage.getItem('pkmn_alert_email') || '');
  const [savedEmail, setSavedEmail] = useState(() => localStorage.getItem('pkmn_alert_email') || '');
  const [tab, setTab] = useState(0);
  const [activeAlerts, setActiveAlerts] = useState<PriceAlertResponse[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);

  const fetchAlerts = useCallback(async (e: string) => {
    if (!e) return;
    setLoading(true);
    try {
      const [active, hist] = await Promise.all([
        api.getAlerts(e),
        api.getAlertHistory(e),
      ]);
      setActiveAlerts(active);
      setHistory(hist);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (savedEmail) fetchAlerts(savedEmail);
  }, [savedEmail, fetchAlerts]);

  const handleSaveEmail = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    localStorage.setItem('pkmn_alert_email', trimmed);
    setSavedEmail(trimmed);
    setSnack('Email saved');
  };

  const handleDelete = async (alertId: number) => {
    try {
      await api.deleteAlert(alertId);
      setActiveAlerts(prev => prev.filter(a => a.id !== alertId));
      setSnack('Alert deleted');
    } catch {
      setSnack('Failed to delete alert');
    }
  };

  const cellSx = { color: '#ccc', fontFamily: mono, fontSize: '0.8rem', borderColor: '#1e1e1e', py: 1 };
  const headSx = { color: '#666', fontFamily: mono, fontSize: '0.7rem', fontWeight: 700, borderColor: '#1e1e1e', py: 0.8 };

  return (
    <Box sx={{ p: { xs: 1, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Typography variant="h2" sx={{ color: '#00bcd4', fontFamily: mono, fontWeight: 700, mb: 2, letterSpacing: 2 }}>
        PRICE ALERTS
      </Typography>

      {/* Email Config */}
      <Paper sx={{ p: 2, mb: 3, bgcolor: '#111', border: '1px solid #1e1e1e' }}>
        <Typography sx={{ color: '#888', fontSize: '0.8rem', fontFamily: mono, mb: 1 }}>
          NOTIFICATION EMAIL
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEmail(); }}
            sx={{
              flex: 1,
              maxWidth: 400,
              '& .MuiInputLabel-root': { color: '#666' },
              '& .MuiOutlinedInput-root': { fontFamily: mono, fontSize: '0.85rem' },
            }}
          />
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSaveEmail}
            sx={{
              bgcolor: '#00ff4122',
              color: '#00ff41',
              border: '1px solid #00ff4133',
              fontFamily: mono,
              fontWeight: 700,
              fontSize: '0.75rem',
              '&:hover': { bgcolor: '#00ff4133' },
            }}
          >
            Save
          </Button>
        </Stack>
        {savedEmail && (
          <Typography sx={{ color: '#555', fontSize: '0.7rem', fontFamily: mono, mt: 0.5 }}>
            Alerts will be sent to: {savedEmail}
          </Typography>
        )}
      </Paper>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          mb: 2,
          '& .MuiTab-root': { color: '#666', fontFamily: mono, fontWeight: 700, fontSize: '0.8rem', textTransform: 'none' },
          '& .Mui-selected': { color: '#00bcd4' },
          '& .MuiTabs-indicator': { bgcolor: '#00bcd4' },
        }}
      >
        <Tab label={`Active Alerts (${activeAlerts.length})`} />
        <Tab label={`Alert History (${history.length})`} />
      </Tabs>

      {!savedEmail && (
        <Paper sx={{ p: 3, bgcolor: '#111', border: '1px solid #1e1e1e', textAlign: 'center' }}>
          <Typography sx={{ color: '#888', fontFamily: mono, fontSize: '0.85rem' }}>
            Enter your email above to view and manage your price alerts.
          </Typography>
        </Paper>
      )}

      {savedEmail && loading && (
        <Typography sx={{ color: '#666', fontFamily: mono, fontSize: '0.8rem', textAlign: 'center', py: 4 }}>
          Loading...
        </Typography>
      )}

      {/* Active Alerts Tab */}
      {savedEmail && !loading && tab === 0 && (
        <TableContainer component={Paper} sx={{ bgcolor: '#111', border: '1px solid #1e1e1e' }}>
          {activeAlerts.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{ color: '#666', fontFamily: mono, fontSize: '0.85rem' }}>
                No active alerts. Set alerts from any card detail page.
              </Typography>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={headSx}>CARD</TableCell>
                  <TableCell sx={headSx} align="right">ABOVE</TableCell>
                  <TableCell sx={headSx} align="right">BELOW</TableCell>
                  <TableCell sx={headSx}>CREATED</TableCell>
                  <TableCell sx={headSx} align="center">ACTION</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {activeAlerts.map((alert) => (
                  <TableRow key={alert.id} sx={{ '&:hover': { bgcolor: '#1a1a2e' } }}>
                    <TableCell sx={cellSx}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        {alert.card_image && (
                          <Avatar
                            src={alert.card_image}
                            variant="rounded"
                            sx={{ width: 32, height: 44 }}
                          />
                        )}
                        <Typography
                          component={Link}
                          to={`/card/${alert.card_id}`}
                          sx={{ color: '#00bcd4', fontFamily: mono, fontSize: '0.8rem', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                        >
                          {alert.card_name || `Card #${alert.card_id}`}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ ...cellSx, color: alert.threshold_above ? '#00ff41' : '#333' }} align="right">
                      {alert.threshold_above != null ? `$${alert.threshold_above.toFixed(2)}` : '--'}
                    </TableCell>
                    <TableCell sx={{ ...cellSx, color: alert.threshold_below ? '#ff1744' : '#333' }} align="right">
                      {alert.threshold_below != null ? `$${alert.threshold_below.toFixed(2)}` : '--'}
                    </TableCell>
                    <TableCell sx={cellSx}>
                      {alert.created_at ? new Date(alert.created_at).toLocaleDateString() : '--'}
                    </TableCell>
                    <TableCell sx={cellSx} align="center">
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(alert.id)}
                        sx={{ color: '#ff1744', '&:hover': { bgcolor: '#ff174422' } }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TableContainer>
      )}

      {/* Alert History Tab */}
      {savedEmail && !loading && tab === 1 && (
        <TableContainer component={Paper} sx={{ bgcolor: '#111', border: '1px solid #1e1e1e' }}>
          {history.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{ color: '#666', fontFamily: mono, fontSize: '0.85rem' }}>
                No triggered alerts yet. Alerts fire when card prices cross your thresholds.
              </Typography>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={headSx}>CARD</TableCell>
                  <TableCell sx={headSx}>TRIGGERED</TableCell>
                  <TableCell sx={headSx} align="right">PRICE</TableCell>
                  <TableCell sx={headSx} align="right">ABOVE</TableCell>
                  <TableCell sx={headSx} align="right">BELOW</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((item) => (
                  <TableRow key={item.id} sx={{ '&:hover': { bgcolor: '#1a1a2e' } }}>
                    <TableCell sx={cellSx}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        {item.card_image && (
                          <Avatar
                            src={item.card_image}
                            variant="rounded"
                            sx={{ width: 32, height: 44 }}
                          />
                        )}
                        <Typography
                          component={Link}
                          to={`/card/${item.card_id}`}
                          sx={{ color: '#00bcd4', fontFamily: mono, fontSize: '0.8rem', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                        >
                          {item.card_name || `Card #${item.card_id}`}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={cellSx}>
                      {item.triggered_at ? new Date(item.triggered_at).toLocaleString() : '--'}
                    </TableCell>
                    <TableCell sx={{ ...cellSx, color: '#00ff41', fontWeight: 700 }} align="right">
                      {item.price_at_trigger != null ? `$${item.price_at_trigger.toFixed(2)}` : '--'}
                    </TableCell>
                    <TableCell sx={{ ...cellSx, color: '#555' }} align="right">
                      {item.threshold_above != null ? `$${item.threshold_above.toFixed(2)}` : '--'}
                    </TableCell>
                    <TableCell sx={{ ...cellSx, color: '#555' }} align="right">
                      {item.threshold_below != null ? `$${item.threshold_below.toFixed(2)}` : '--'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TableContainer>
      )}

      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSnack(null)} sx={{ bgcolor: '#1a1a2e', color: '#00ff41', border: '1px solid #00ff4133' }}>
          {snack}
        </Alert>
      </Snackbar>
    </Box>
  );
}
