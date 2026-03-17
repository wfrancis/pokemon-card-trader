import { useEffect, useState } from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Avatar, CircularProgress,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { useNavigate } from 'react-router-dom';
import { api, Mover } from '../services/api';

const RANGE_OPTIONS = [
  { value: 1, label: '1D' },
  { value: 3, label: '3D' },
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
];

export default function TopMovers() {
  const [gainers, setGainers] = useState<Mover[]>([]);
  const [losers, setLosers] = useState<Mover[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    api.getMovers(10, days).then(data => {
      setGainers(data.gainers);
      setLosers(data.losers);
    }).catch(console.error).finally(() => setLoading(false));
  }, [days]);

  const rangeLabel = `${days}d`;

  const renderTable = (title: string, movers: Mover[], isGainer: boolean) => (
    <Paper sx={{ flex: 1, p: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        {isGainer ? (
          <TrendingUpIcon sx={{ color: '#00ff41' }} />
        ) : (
          <TrendingDownIcon sx={{ color: '#ff1744' }} />
        )}
        <Typography variant="h4">{title}</Typography>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Card</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell align="right">{rangeLabel} Change</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {movers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} sx={{ textAlign: 'center', color: '#666' }}>
                  Sync more data to see movers
                </TableCell>
              </TableRow>
            ) : (
              movers.map(m => (
                <TableRow
                  key={m.card_id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/card/${m.card_id}`)}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar
                        src={m.image_small}
                        variant="rounded"
                        sx={{ width: 28, height: 38 }}
                      />
                      <Box>
                        <Typography variant="body2" sx={{
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: { xs: 120, sm: 'none' },
                        }}>
                          {m.name}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#666', fontSize: '0.7rem' }}>
                          {m.set_name}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      ${m.current_price?.toFixed(2)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 700,
                        color: m.change_pct >= 0 ? '#00ff41' : '#ff1744',
                      }}
                    >
                      {m.change_pct >= 0 ? '+' : ''}{m.change_pct}%{Math.abs(m.change_pct) > 200 ? ' \u26a0\ufe0f' : ''}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2 }}>
        <Paper sx={{ flex: 1, p: 4, textAlign: 'center' }}>
          <CircularProgress size={24} sx={{ color: '#00ff41' }} />
          <Typography sx={{ color: '#666', mt: 1, fontSize: '0.8rem' }}>Loading gainers...</Typography>
        </Paper>
        <Paper sx={{ flex: 1, p: 4, textAlign: 'center' }}>
          <CircularProgress size={24} sx={{ color: '#ff1744' }} />
          <Typography sx={{ color: '#666', mt: 1, fontSize: '0.8rem' }}>Loading losers...</Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <ToggleButtonGroup
          value={days}
          exclusive
          onChange={(_, v) => { if (v !== null) setDays(v); }}
          size="small"
        >
          {RANGE_OPTIONS.map(opt => (
            <ToggleButton
              key={opt.value}
              value={opt.value}
              sx={{
                px: 1.2,
                py: 0.3,
                fontFamily: 'monospace',
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#888',
                borderColor: '#333',
                '&.Mui-selected': {
                  color: '#00bcd4',
                  backgroundColor: 'rgba(0, 188, 212, 0.12)',
                  borderColor: '#00bcd4',
                  '&:hover': { backgroundColor: 'rgba(0, 188, 212, 0.2)' },
                },
                '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)' },
              }}
            >
              {opt.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2 }}>
        {renderTable(`Top Gainers (${rangeLabel})`, gainers, true)}
        {renderTable(`Top Losers (${rangeLabel})`, losers, false)}
      </Box>
    </Box>
  );
}
