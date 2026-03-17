import { useEffect, useState } from 'react';
import { Box, Paper, Typography, Chip } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

interface WatchlistItem {
  cardId: number;
  costBasis: number | null;
  alertAbove: number | null;
  alertBelow: number | null;
}

interface TriggeredAlert {
  cardId: number;
  cardName: string;
  setName: string;
  currentPrice: number;
  type: 'above' | 'below';
  target: number;
}

export default function PriceAlerts() {
  const [alerts, setAlerts] = useState<TriggeredAlert[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const withAlerts = items.filter(i => i.alertAbove != null || i.alertBelow != null);
    if (withAlerts.length === 0) return;

    Promise.all(withAlerts.map(item =>
      api.getCard(item.cardId).then(card => ({ item, card })).catch(() => null)
    )).then(results => {
      const triggered: TriggeredAlert[] = [];
      for (const r of results) {
        if (!r || !r.card.current_price) continue;
        const { item, card } = r;
        const price = card.current_price!;
        if (item.alertAbove != null && price >= item.alertAbove) {
          triggered.push({
            cardId: item.cardId, cardName: card.name, setName: card.set_name,
            currentPrice: price, type: 'above', target: item.alertAbove,
          });
        }
        if (item.alertBelow != null && price <= item.alertBelow) {
          triggered.push({
            cardId: item.cardId, cardName: card.name, setName: card.set_name,
            currentPrice: price, type: 'below', target: item.alertBelow,
          });
        }
      }
      setAlerts(triggered);
    });
  }, []);

  if (alerts.length === 0) return null;

  return (
    <Box sx={{ mb: 1 }}>
      {alerts.map((alert, i) => (
        <Paper
          key={`${alert.cardId}-${alert.type}-${i}`}
          onClick={() => navigate(`/card/${alert.cardId}`)}
          sx={{
            p: 1, mb: 0.5, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 1,
            border: '1px solid',
            borderColor: alert.type === 'above' ? '#1a3a1a' : '#3a1a1a',
            bgcolor: alert.type === 'above' ? '#0a150a' : '#150a0a',
            '&:hover': { borderColor: alert.type === 'above' ? '#00ff41' : '#ff1744' },
          }}
        >
          {alert.type === 'above'
            ? <TrendingUpIcon sx={{ color: '#00ff41', fontSize: 18 }} />
            : <TrendingDownIcon sx={{ color: '#ff1744', fontSize: 18 }} />
          }
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>
              {alert.cardName}
              <Typography component="span" sx={{ color: '#555', fontSize: '0.65rem', ml: 1 }}>
                {alert.setName}
              </Typography>
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: '#888' }}>
              {alert.type === 'above' ? 'Hit' : 'Dropped to'} target: ${alert.target.toFixed(2)} — now ${alert.currentPrice.toFixed(2)}
            </Typography>
          </Box>
          <Chip
            label={alert.type === 'above' ? 'TARGET HIT' : 'PRICE DROP'}
            size="small"
            sx={{
              bgcolor: alert.type === 'above' ? '#00ff41' : '#ff1744',
              color: '#000',
              fontWeight: 700,
              fontSize: '0.55rem',
              height: 18,
            }}
          />
        </Paper>
      ))}
    </Box>
  );
}
