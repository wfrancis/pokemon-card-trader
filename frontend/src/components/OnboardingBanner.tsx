import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Paper, Typography, Button, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CatchingPokemonIcon from '@mui/icons-material/CatchingPokemon';

const STORAGE_KEY = 'pkmn_first_visit_dismissed';

const quickLinks = [
  { label: 'Charizard', query: 'Charizard' },
  { label: 'Pikachu', query: 'Pikachu' },
  { label: 'Mewtwo', query: 'Mewtwo' },
];

export default function OnboardingBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true'
  );
  const navigate = useNavigate();

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setDismissed(true);
  };

  const handleQuickLink = (query: string) => {
    navigate(`/explore?q=${encodeURIComponent(query)}`);
  };

  return (
    <Paper sx={{
      p: { xs: 2, md: 2.5 },
      mb: 2,
      bgcolor: '#0d1117',
      border: '1px solid rgba(0, 188, 212, 0.3)',
      borderRadius: 2,
      position: 'relative',
    }}>
      {/* Dismiss button */}
      <IconButton
        onClick={handleDismiss}
        size="small"
        aria-label="Dismiss welcome banner"
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          color: '#555',
          '&:hover': { color: '#999', bgcolor: 'rgba(255,255,255,0.05)' },
        }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <CatchingPokemonIcon sx={{ color: '#00bcd4', fontSize: 22 }} />
        <Typography sx={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: { xs: '0.75rem', md: '0.85rem' },
          color: '#00bcd4',
          fontWeight: 700,
          letterSpacing: 0.5,
        }}>
          WELCOME, TRAINER!
        </Typography>
      </Box>

      {/* Message */}
      <Typography sx={{
        color: '#ccc',
        fontSize: { xs: '0.85rem', md: '0.95rem' },
        mb: 1.5,
        lineHeight: 1.5,
        pr: 4,
      }}>
        Found old Pokemon cards? Search any card to see what it's worth!
      </Typography>

      {/* Quick-link buttons */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{
          color: '#666',
          fontSize: '0.75rem',
          fontFamily: '"JetBrains Mono", monospace',
          alignSelf: 'center',
          mr: 0.5,
        }}>
          Try:
        </Typography>
        {quickLinks.map(({ label, query }) => (
          <Button
            key={label}
            size="small"
            variant="outlined"
            onClick={() => handleQuickLink(query)}
            sx={{
              color: '#00bcd4',
              borderColor: 'rgba(0, 188, 212, 0.3)',
              textTransform: 'none',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '0.75rem',
              px: 1.5,
              py: 0.25,
              borderRadius: 1,
              '&:hover': {
                borderColor: '#00bcd4',
                bgcolor: 'rgba(0, 188, 212, 0.08)',
              },
            }}
          >
            {label}
          </Button>
        ))}
      </Box>
    </Paper>
  );
}
