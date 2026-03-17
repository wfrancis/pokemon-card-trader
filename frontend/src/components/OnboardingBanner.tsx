import { useState } from 'react';
import { Box, Paper, Typography, Button } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';

const STORAGE_KEY = 'pkmn_onboarding_dismissed';

export default function OnboardingBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === '1'
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  };

  const steps = [
    { icon: <SearchIcon sx={{ color: '#00ff41', fontSize: 20 }} />, text: 'Search for any Pokemon card to check its value' },
    { icon: <BookmarkIcon sx={{ color: '#ffd700', fontSize: 20 }} />, text: 'Add cards to your Watchlist to track prices & P\u0026L' },
    { icon: <TrendingUpIcon sx={{ color: '#00bcd4', fontSize: 20 }} />, text: 'Set price alerts to know when to buy or sell' },
  ];

  return (
    <Paper sx={{
      p: 2, mb: 2,
      bgcolor: '#060d06',
      border: '1px solid #1a3a1a',
      borderLeft: '3px solid #00ff41',
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
        <Typography sx={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '0.8rem',
          color: '#00ff41',
          fontWeight: 700,
          letterSpacing: 1,
        }}>
          WELCOME TO PKMN MARKET
        </Typography>
        <Button
          size="small"
          onClick={handleDismiss}
          sx={{ color: '#555', textTransform: 'none', fontSize: '0.7rem', minWidth: 0, p: '2px 8px' }}
        >
          Got it
        </Button>
      </Box>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {steps.map((step, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ color: '#444', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 700 }}>
              {i + 1}.
            </Typography>
            {step.icon}
            <Typography sx={{ color: '#999', fontSize: '0.75rem' }}>
              {step.text}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
