import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Paper, Typography, TextField, Button, Tabs, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Avatar, Stack, Snackbar, Alert, CircularProgress,
  InputAdornment,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import SearchIcon from '@mui/icons-material/Search';
import AddAlertIcon from '@mui/icons-material/AddAlert';
import { Link } from 'react-router-dom';
import { api, Card, PriceAlertResponse, AlertHistoryItem } from '../services/api';

const mono = '"JetBrains Mono", monospace';

export default function AlertsPage() {
  const [email, setEmail] = useState(() => localStorage.getItem('pkmn_alert_email') || '');
  const [savedEmail, setSavedEmail] = useState(() => localStorage.getItem('pkmn_alert_email') || '');
  const [tab, setTab] = useState(0);
  const [activeAlerts, setActiveAlerts] = useState<PriceAlertResponse[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [snack, setSnack] = useState<{ msg: string; severity?: 'success' | 'warning' | 'info' } | null>(null);

  // Quick Add Alert state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [alertAbove, setAlertAbove] = useState('');
  const [alertBelow, setAlertBelow] = useState('');
  const [alertSpread, setAlertSpread] = useState('');
  const [creating, setCreating] = useState(false);
  const [inlineEmail, setInlineEmail] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setSnack({ msg: 'Email saved' });
  };

  const handleDelete = async (alertId: number) => {
    try {
      await api.deleteAlert(alertId);
      setActiveAlerts(prev => prev.filter(a => a.id !== alertId));
      setSnack({ msg: 'Alert deleted' });
    } catch {
      setSnack({ msg: 'Failed to delete alert', severity: 'warning' });
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setSelectedCard(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await api.getCards({ q: value.trim(), page_size: '8' });
        setSearchResults(result.data);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  };

  const handleSelectCard = (card: Card) => {
    setSelectedCard(card);
    setSearchResults([]);
    setSearchQuery(card.name);
    setAlertAbove('');
    setAlertBelow('');
    setAlertSpread('');
  };

  const handleCreateAlert = async () => {
    if (!selectedCard) return;
    // Resolve email: use savedEmail, or save inlineEmail if provided
    let emailToUse = savedEmail;
    if (!emailToUse) {
      const trimmed = inlineEmail.trim();
      if (!trimmed) {
        setSnack({ msg: 'Please enter your email to receive alert notifications', severity: 'warning' });
        return;
      }
      // Save the inline email as the global email
      localStorage.setItem('pkmn_alert_email', trimmed);
      setSavedEmail(trimmed);
      setEmail(trimmed);
      emailToUse = trimmed;
    }
    const above = parseFloat(alertAbove);
    const below = parseFloat(alertBelow);
    const spread = parseFloat(alertSpread);
    if (isNaN(above) && isNaN(below) && isNaN(spread)) return;
    setCreating(true);
    try {
      await api.createAlert({
        card_id: selectedCard.id,
        email: emailToUse,
        threshold_above: !isNaN(above) && above > 0 ? above : null,
        threshold_below: !isNaN(below) && below > 0 ? below : null,
        spread_threshold: !isNaN(spread) && spread > 0 ? spread : null,
      });
      setSnack({ msg: `Alert created for ${selectedCard.name}` });
      setSelectedCard(null);
      setSearchQuery('');
      setAlertAbove('');
      setAlertBelow('');
      setAlertSpread('');
      setInlineEmail('');
      fetchAlerts(emailToUse);
    } catch {
      setSnack({ msg: 'Failed to create alert', severity: 'warning' });
    } finally {
      setCreating(false);
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

      {/* Quick Add Alert */}
      <Paper sx={{ p: 2.5, mb: 3, bgcolor: '#111', border: '1px solid #00bcd433' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <AddAlertIcon sx={{ color: '#00bcd4', fontSize: 22 }} />
          <Typography sx={{ color: '#00bcd4', fontSize: '0.9rem', fontFamily: mono, fontWeight: 700, letterSpacing: 1 }}>
            CREATE NEW ALERT
          </Typography>
          <Typography sx={{ color: '#555', fontSize: '0.75rem', fontFamily: mono }}>
            Search for any card and set price thresholds
          </Typography>
        </Stack>

          {/* Search input */}
          <TextField
            fullWidth
            placeholder="Search for a card by name to set a price alert..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  {searching ? (
                    <CircularProgress size={18} sx={{ color: '#555' }} />
                  ) : (
                    <SearchIcon sx={{ color: '#00bcd4', fontSize: 22 }} />
                  )}
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                fontFamily: mono,
                fontSize: '0.95rem',
                '& fieldset': { borderColor: '#333' },
                '&:hover fieldset': { borderColor: '#00bcd4' },
                '&.Mui-focused fieldset': { borderColor: '#00bcd4' },
              },
            }}
          />

          {/* Search results dropdown */}
          {searchResults.length > 0 && !selectedCard && (
            <Paper sx={{ mt: 0.5, bgcolor: '#0a0a0a', border: '1px solid #222', maxHeight: 320, overflow: 'auto' }}>
              {searchResults.map((card) => (
                <Box
                  key={card.id}
                  onClick={() => handleSelectCard(card)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1,
                    cursor: 'pointer', '&:hover': { bgcolor: '#1a1a2e' },
                    borderBottom: '1px solid #1a1a1a',
                  }}
                >
                  {card.image_small && (
                    <Avatar src={card.image_small} variant="rounded" sx={{ width: 28, height: 38 }} />
                  )}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ color: '#ccc', fontFamily: mono, fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {card.name}
                    </Typography>
                    <Typography sx={{ color: '#555', fontFamily: mono, fontSize: '0.65rem' }}>
                      {card.set_name} &middot; {card.rarity || 'Unknown'}
                    </Typography>
                  </Box>
                  <Typography sx={{ color: card.current_price ? '#00ff41' : '#333', fontFamily: mono, fontSize: '0.8rem', fontWeight: 700 }}>
                    {card.current_price != null ? `$${card.current_price.toFixed(2)}` : '--'}
                  </Typography>
                </Box>
              ))}
            </Paper>
          )}

          {/* Selected card + threshold inputs */}
          {selectedCard && (
            <Box sx={{ mt: 2, p: 2, bgcolor: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                {selectedCard.image_small && (
                  <Avatar src={selectedCard.image_small} variant="rounded" sx={{ width: 36, height: 50 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ color: '#00bcd4', fontFamily: mono, fontSize: '0.85rem', fontWeight: 700 }}>
                    {selectedCard.name}
                  </Typography>
                  <Typography sx={{ color: '#555', fontFamily: mono, fontSize: '0.7rem' }}>
                    {selectedCard.set_name} &middot; {selectedCard.rarity || 'Unknown'}
                  </Typography>
                </Box>
                <Typography sx={{ color: '#00ff41', fontFamily: mono, fontSize: '1rem', fontWeight: 700 }}>
                  {selectedCard.current_price != null ? `$${selectedCard.current_price.toFixed(2)}` : '--'}
                </Typography>
              </Stack>

              {!savedEmail && (
                <Box sx={{ mb: 2, p: 1.5, bgcolor: '#111', border: '1px solid #ff980033', borderRadius: 1 }}>
                  <Typography sx={{ color: '#ff9800', fontFamily: mono, fontSize: '0.75rem', mb: 1 }}>
                    Enter your email to receive alert notifications
                  </Typography>
                  <TextField
                    size="small"
                    type="email"
                    placeholder="your@email.com"
                    value={inlineEmail}
                    onChange={(e) => setInlineEmail(e.target.value)}
                    fullWidth
                    sx={{
                      maxWidth: 360,
                      '& .MuiOutlinedInput-root': { fontFamily: mono, fontSize: '0.85rem' },
                    }}
                  />
                </Box>
              )}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="flex-start">
                <TextField
                  size="small"
                  label="Alert when price rises above"
                  type="number"
                  value={alertAbove}
                  onChange={(e) => setAlertAbove(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  sx={{
                    flex: 1,
                    '& .MuiOutlinedInput-root': { fontFamily: mono, fontSize: '0.85rem' },
                    '& .MuiInputLabel-root': { fontSize: '0.75rem' },
                  }}
                />
                <TextField
                  size="small"
                  label="Alert when price drops below"
                  type="number"
                  value={alertBelow}
                  onChange={(e) => setAlertBelow(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  sx={{
                    flex: 1,
                    '& .MuiOutlinedInput-root': { fontFamily: mono, fontSize: '0.85rem' },
                    '& .MuiInputLabel-root': { fontSize: '0.75rem' },
                  }}
                />
                <TextField
                  size="small"
                  label="Alert when spread drops below %"
                  type="number"
                  value={alertSpread}
                  onChange={(e) => setAlertSpread(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start">%</InputAdornment> }}
                  sx={{
                    flex: 1,
                    '& .MuiOutlinedInput-root': { fontFamily: mono, fontSize: '0.85rem' },
                    '& .MuiInputLabel-root': { fontSize: '0.75rem' },
                  }}
                />
                <Button
                  variant="contained"
                  startIcon={creating ? <CircularProgress size={14} sx={{ color: '#00ff41' }} /> : <AddAlertIcon />}
                  onClick={handleCreateAlert}
                  disabled={creating || (isNaN(parseFloat(alertAbove)) && isNaN(parseFloat(alertBelow)) && isNaN(parseFloat(alertSpread)))}
                  sx={{
                    bgcolor: '#00ff4122',
                    color: '#00ff41',
                    border: '1px solid #00ff4133',
                    fontFamily: mono,
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    whiteSpace: 'nowrap',
                    minWidth: 140,
                    '&:hover': { bgcolor: '#00ff4133' },
                    '&.Mui-disabled': { color: '#00ff4144', borderColor: '#00ff4111' },
                  }}
                >
                  Create Alert
                </Button>
              </Stack>
            </Box>
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
            Save your email above to view existing alerts and alert history.
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
                No active alerts. Use Quick Add above or set alerts from any card detail page.
              </Typography>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={headSx}>CARD</TableCell>
                  <TableCell sx={headSx} align="right">ABOVE</TableCell>
                  <TableCell sx={headSx} align="right">BELOW</TableCell>
                  <TableCell sx={headSx} align="right">SPREAD</TableCell>
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
                    <TableCell sx={{ ...cellSx, color: alert.spread_threshold ? '#ff9800' : '#333' }} align="right">
                      {alert.spread_threshold != null ? `${alert.spread_threshold.toFixed(1)}%` : '--'}
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
                  <TableCell sx={headSx} align="right">SPREAD</TableCell>
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
                    <TableCell sx={{ ...cellSx, color: '#555' }} align="right">
                      {item.spread_threshold != null ? `${item.spread_threshold.toFixed(1)}%` : '--'}
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
        <Alert
          severity={snack?.severity || 'success'}
          onClose={() => setSnack(null)}
          sx={{
            bgcolor: '#1a1a2e',
            color: snack?.severity === 'warning' ? '#ff9800' : '#00ff41',
            border: `1px solid ${snack?.severity === 'warning' ? '#ff980033' : '#00ff4133'}`,
          }}
        >
          {snack?.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
