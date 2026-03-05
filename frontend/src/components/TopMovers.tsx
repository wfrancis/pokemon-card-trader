import { useEffect, useState } from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Avatar,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { useNavigate } from 'react-router-dom';
import { api, Mover } from '../services/api';

export default function TopMovers() {
  const [gainers, setGainers] = useState<Mover[]>([]);
  const [losers, setLosers] = useState<Mover[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.getMovers(10).then(data => {
      setGainers(data.gainers);
      setLosers(data.losers);
    }).catch(console.error);
  }, []);

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
              <TableCell align="right">Change</TableCell>
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
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
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
                      {m.change_pct >= 0 ? '+' : ''}{m.change_pct}%
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

  return (
    <Box sx={{ display: 'flex', gap: 2 }}>
      {renderTable('Top Gainers', gainers, true)}
      {renderTable('Top Losers', losers, false)}
    </Box>
  );
}
