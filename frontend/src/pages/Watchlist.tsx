import { useEffect, useState, useCallback } from 'react';
import {
  Box, Paper, Typography, Avatar, IconButton, TextField,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import { useNavigate } from 'react-router-dom';
import { api, Card } from '../services/api';
import GlossaryTooltip from '../components/GlossaryTooltip';

interface WatchlistItem {
  cardId: number;
  costBasis: number | null;
  alertAbove: number | null;
  alertBelow: number | null;
  quantity?: number;
  addedAt: string;
}

interface WatchlistRow extends WatchlistItem {
  card: Card | null;
}

export default function Watchlist() {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Watchlist | PKMN Trader';
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, []);

  const loadWatchlist = useCallback(async () => {
    setLoading(true);
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const loaded: WatchlistRow[] = await Promise.all(
      items.map(async (item) => {
        try {
          const card = await api.getCard(item.cardId);
          return { ...item, card };
        } catch {
          return { ...item, card: null };
        }
      })
    );
    setRows(loaded.filter(r => r.card !== null));
    setLoading(false);
  }, []);

  useEffect(() => { loadWatchlist(); }, [loadWatchlist]);

  const removeFromWatchlist = (cardId: number) => {
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    localStorage.setItem('pkmn_watchlist', JSON.stringify(items.filter(w => w.cardId !== cardId)));
    setRows(prev => prev.filter(r => r.cardId !== cardId));
  };

  const updateCostBasis = (cardId: number, value: string) => {
    const parsed = parseFloat(value);
    const numVal = value === '' || isNaN(parsed) ? null : parsed;
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const updated = items.map(w => w.cardId === cardId ? { ...w, costBasis: numVal } : w);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(updated));
    setRows(prev => prev.map(r => r.cardId === cardId ? { ...r, costBasis: numVal } : r));
  };

  const updateAlert = (cardId: number, field: 'alertAbove' | 'alertBelow', value: string) => {
    const parsed = parseFloat(value);
    const numVal = value === '' || isNaN(parsed) ? null : parsed;
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const updated = items.map(w => w.cardId === cardId ? { ...w, [field]: numVal } : w);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(updated));
    setRows(prev => prev.map(r => r.cardId === cardId ? { ...r, [field]: numVal } : r));
  };

  const updateQuantity = (cardId: number, value: string) => {
    const parsed = parseInt(value);
    const qty = value === '' || isNaN(parsed) || parsed < 1 ? 1 : parsed;
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const updated = items.map(w => w.cardId === cardId ? { ...w, quantity: qty } : w);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(updated));
    setRows(prev => prev.map(r => r.cardId === cardId ? { ...r, quantity: qty } : r));
  };

  const totalValue = rows.reduce((sum, r) => sum + (r.card?.current_price || 0) * (r.quantity ?? 1), 0);
  const totalCost = rows.reduce((sum, r) => sum + (r.costBasis || 0) * (r.quantity ?? 1), 0);
  const totalPnL = totalCost > 0 ? totalValue - totalCost : null;

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <BookmarkIcon sx={{ color: '#ffd700' }} />
        <Typography variant="h2" sx={{ color: '#ffd700' }}>WATCHLIST</Typography>
        <Typography variant="body2" sx={{ color: '#666', ml: 'auto' }}>
          {rows.length} cards
        </Typography>
      </Box>

      {/* Portfolio Summary */}
      {rows.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Paper sx={{ p: 1.5, flex: 1, minWidth: 120, textAlign: 'center' }}>
            <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>Total Value</Typography>
            <Typography sx={{ color: '#00ff41', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem' }}>
              ${totalValue.toFixed(2)}
            </Typography>
          </Paper>
          {totalCost > 0 && (
            <>
              <Paper sx={{ p: 1.5, flex: 1, minWidth: 120, textAlign: 'center' }}>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>Total Cost</Typography>
                <Typography sx={{ color: '#888', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem' }}>
                  ${totalCost.toFixed(2)}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, flex: 1, minWidth: 120, textAlign: 'center' }}>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>P&L</Typography>
                <Typography sx={{
                  color: totalPnL != null && totalPnL >= 0 ? '#00ff41' : '#ff1744',
                  fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem',
                }}>
                  {totalPnL != null && totalPnL >= 0 ? '+' : ''}${totalPnL?.toFixed(2)} ({totalCost > 0 ? ((totalPnL! / totalCost) * 100).toFixed(1) : '0'}%)
                </Typography>
              </Paper>
            </>
          )}
        </Box>
      )}

      {loading ? (
        <Typography sx={{ color: '#666', textAlign: 'center', py: 4 }}>Loading watchlist...</Typography>
      ) : rows.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <BookmarkIcon sx={{ color: '#333', fontSize: 48, mb: 1 }} />
          <Typography sx={{ color: '#666', mb: 1 }}>Your watchlist is empty</Typography>
          <Typography sx={{ color: '#555', fontSize: '0.8rem' }}>
            Visit a card's detail page and click the bookmark icon to add it here.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>CARD</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>QTY</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>CURRENT</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}><GlossaryTooltip term="cost_basis">COST BASIS</GlossaryTooltip></TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}><GlossaryTooltip term="pnl">P&L</GlossaryTooltip></TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}><GlossaryTooltip term="pnl">P&L %</GlossaryTooltip></TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>ALERT ▲</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>ALERT ▼</TableCell>
                <TableCell align="center" sx={{ width: 40 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(row => {
                const qty = row.quantity ?? 1;
                const price = row.card?.current_price || 0;
                const totalRowValue = price * qty;
                const totalRowCost = (row.costBasis || 0) * qty;
                const pnl = row.costBasis != null ? totalRowValue - totalRowCost : null;
                const pnlPct = row.costBasis != null && row.costBasis > 0 ? ((price - row.costBasis) / row.costBasis) * 100 : null;
                return (
                  <TableRow
                    key={row.cardId}
                    hover
                    sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#1a1a2e' } }}
                    onClick={() => navigate(`/card/${row.cardId}`)}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar src={row.card?.image_small} variant="rounded" sx={{ width: 32, height: 44 }} />
                        <Box>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.8rem' }}>{row.card?.name}</Typography>
                          <Typography sx={{ color: '#666', fontSize: '0.6rem' }}>{row.card?.set_name}</Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <TextField
                        size="small"
                        type="number"
                        value={qty}
                        onChange={e => updateQuantity(row.cardId, e.target.value)}
                        inputProps={{ min: 1, style: { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#ccc', padding: '4px' } }}
                        sx={{ width: 50 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography sx={{ color: '#00ff41', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem' }}>
                        ${totalRowValue.toFixed(2)}
                      </Typography>
                      {qty > 1 && (
                        <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.6rem' }}>
                          ${price.toFixed(2)} ea
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <TextField
                        size="small"
                        type="number"
                        value={row.costBasis ?? ''}
                        onChange={e => updateCostBasis(row.cardId, e.target.value)}
                        placeholder="—"
                        sx={{
                          width: 80,
                          '& input': { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#888', py: 0.5 },
                        }}
                        InputProps={{ startAdornment: <Typography sx={{ color: '#555', fontSize: '0.8rem', mr: 0.3 }}>$</Typography> }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem',
                        color: pnl != null ? (pnl >= 0 ? '#00ff41' : '#ff1744') : '#555',
                      }}>
                        {pnl != null ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem',
                        color: pnlPct != null ? (pnlPct >= 0 ? '#00ff41' : '#ff1744') : '#555',
                      }}>
                        {pnlPct != null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%` : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <TextField
                        size="small"
                        type="number"
                        value={row.alertAbove ?? ''}
                        onChange={e => updateAlert(row.cardId, 'alertAbove', e.target.value)}
                        placeholder="—"
                        sx={{
                          width: 80,
                          '& input': { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#00ff41', py: 0.5 },
                        }}
                        InputProps={{ startAdornment: <Typography sx={{ color: '#555', fontSize: '0.8rem', mr: 0.3 }}>$</Typography> }}
                      />
                    </TableCell>
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <TextField
                        size="small"
                        type="number"
                        value={row.alertBelow ?? ''}
                        onChange={e => updateAlert(row.cardId, 'alertBelow', e.target.value)}
                        placeholder="—"
                        sx={{
                          width: 80,
                          '& input': { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#ff1744', py: 0.5 },
                        }}
                        InputProps={{ startAdornment: <Typography sx={{ color: '#555', fontSize: '0.8rem', mr: 0.3 }}>$</Typography> }}
                      />
                    </TableCell>
                    <TableCell align="center" onClick={e => e.stopPropagation()}>
                      <IconButton size="small" onClick={() => removeFromWatchlist(row.cardId)} sx={{ color: '#ff1744' }}>
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
