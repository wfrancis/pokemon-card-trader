import { useEffect, useRef, useState } from 'react';
import {
  Box, Paper, Typography, Grid, Skeleton, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Avatar, LinearProgress, IconButton, Tooltip,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import { useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { api, WeeklyRecapResponse } from '../services/api';

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

export default function WeeklyRecap() {
  const [data, setData] = useState<WeeklyRecapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    api.getWeeklyRecap()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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
      <Typography sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.85rem', mb: 3 }}>
        {formatDate(period.start)} &mdash; {formatDate(period.end)}
      </Typography>

      {/* Market Summary */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
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
    </Box>
  );
}
