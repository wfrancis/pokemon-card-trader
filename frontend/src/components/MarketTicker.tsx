import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { api } from '../services/api';

interface TickerItem {
  id: number;
  name: string;
  set_name: string;
  price: number;
  variant: string;
}

export default function MarketTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    api.getTicker(30).then(setItems).catch(console.error);
    const interval = setInterval(() => {
      api.getTicker(30).then(setItems).catch(console.error);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  if (items.length === 0) return null;

  // Duplicate for seamless scrolling
  const doubled = [...items, ...items];

  return (
    <Box
      sx={{
        overflow: 'hidden',
        bgcolor: '#000',
        borderBottom: '1px solid #1e1e1e',
        py: 0.5,
        whiteSpace: 'nowrap',
      }}
    >
      <Box
        sx={{
          display: 'inline-flex',
          animation: 'ticker 60s linear infinite',
          '@keyframes ticker': {
            '0%': { transform: 'translateX(0)' },
            '100%': { transform: 'translateX(-50%)' },
          },
        }}
      >
        {doubled.map((item, i) => (
          <Box
            key={`${item.id}-${i}`}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              mx: { xs: 1.5, md: 2 },
              gap: 0.5,
            }}
          >
            <Typography variant="body2" sx={{ color: '#00bcd4', fontWeight: 600 }}>
              {item.name}
            </Typography>
            <Typography variant="body2" sx={{ color: '#fff' }}>
              ${item.price?.toFixed(2)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
