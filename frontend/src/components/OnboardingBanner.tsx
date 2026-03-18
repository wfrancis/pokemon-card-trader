import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Paper, Typography, Button, IconButton, Chip, TextField, InputAdornment, Autocomplete } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CatchingPokemonIcon from '@mui/icons-material/CatchingPokemon';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import SummarizeIcon from '@mui/icons-material/Summarize';
import SearchIcon from '@mui/icons-material/Search';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import { api } from '../services/api';

const STORAGE_KEY = 'pkmn_first_visit_dismissed';

const quickLinks = [
  { label: 'Charizard', query: 'Charizard' },
  { label: 'Pikachu', query: 'Pikachu' },
  { label: 'Mewtwo', query: 'Mewtwo' },
];

const navLinks = [
  { label: 'Browse Top Cards', path: '/screener', icon: TrendingUpIcon },
  { label: 'Track Your Cards', path: '/watchlist', icon: BookmarkBorderIcon },
  { label: 'Weekly Report', path: '/recap', icon: SummarizeIcon },
];

const howItWorksSteps = [
  {
    icon: SearchIcon,
    title: 'Search any card',
    desc: 'Type a Pokemon name to find your card',
  },
  {
    icon: AssessmentIcon,
    title: 'Check the value',
    desc: 'See what it\'s worth in any condition',
  },
  {
    icon: BookmarkIcon,
    title: 'Track your cards',
    desc: 'Save cards to watch prices over time',
  },
];

export default function OnboardingBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true'
  );
  const [bannerSearch, setBannerSearch] = useState('');
  const [bannerSuggestions, setBannerSuggestions] = useState<{ id: string; name: string; set_name: string; current_price: number }[]>([]);
  const bannerTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
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
      p: { xs: 2, md: 3 },
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
        mb: 2,
        lineHeight: 1.5,
        pr: 4,
      }}>
        Found old Pokemon cards? Search any card to see what it's worth!
      </Typography>

      {/* Large prominent search bar */}
      <Autocomplete
        freeSolo
        options={bannerSuggestions}
        getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.name}
        filterOptions={(x) => x}
        inputValue={bannerSearch}
        onInputChange={(_, val) => {
          setBannerSearch(val);
          if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
          if (val.trim().length >= 2) {
            bannerTimerRef.current = setTimeout(() => {
              api.getCards({ q: val.trim(), page_size: '6' }).then(res => setBannerSuggestions(res.data.map(c => ({ id: c.id, name: c.name, set_name: c.set_name, current_price: c.current_price })))).catch(() => {});
            }, 300);
          } else {
            setBannerSuggestions([]);
          }
        }}
        onChange={(_, val) => {
          if (val && typeof val !== 'string') {
            navigate(`/card/${val.id}`);
          }
        }}
        renderOption={(props, opt) => (
          <li {...props} key={typeof opt === 'string' ? opt : opt.id}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <Box>
                <Typography sx={{ fontSize: '0.85rem', color: '#ccc' }}>{typeof opt === 'string' ? opt : opt.name}</Typography>
                {typeof opt !== 'string' && <Typography sx={{ fontSize: '0.65rem', color: '#666' }}>{opt.set_name}</Typography>}
              </Box>
              {typeof opt !== 'string' && <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', color: '#00ff41', fontWeight: 700 }}>${opt.current_price?.toFixed(2)}</Typography>}
            </Box>
          </li>
        )}
        componentsProps={{ paper: { sx: { bgcolor: '#111', border: '1px solid #333', '& .MuiAutocomplete-option': { '&:hover': { bgcolor: '#1a2a1a' } } } } }}
        renderInput={(params) => (
          <TextField
            {...params}
            fullWidth
            placeholder="Type any Pokemon name to check its value..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && bannerSearch.trim()) {
                navigate(`/explore?q=${encodeURIComponent(bannerSearch.trim())}`);
              }
            }}
            InputProps={{
              ...params.InputProps,
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: '#00bcd4', fontSize: 28 }} />
                </InputAdornment>
              ),
            }}
            sx={{
              mb: 1.5,
              '& .MuiOutlinedInput-root': {
                fontSize: '1.1rem',
                py: 0.5,
                bgcolor: 'rgba(0, 188, 212, 0.04)',
                '& fieldset': { borderColor: 'rgba(0, 188, 212, 0.4)', borderWidth: 2 },
                '&:hover fieldset': { borderColor: 'rgba(0, 188, 212, 0.6)' },
                '&.Mui-focused fieldset': { borderColor: '#00bcd4' },
              },
              '& .MuiInputBase-input::placeholder': {
                color: '#668',
                opacity: 1,
              },
            }}
          />
        )}
      />

      {/* Quick-link buttons */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2.5 }}>
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

      {/* How It Works */}
      <Box sx={{
        display: 'flex',
        gap: { xs: 1.5, md: 3 },
        flexDirection: { xs: 'column', sm: 'row' },
        mb: 2,
        p: { xs: 1.5, md: 2 },
        bgcolor: 'rgba(0, 188, 212, 0.03)',
        borderRadius: 1.5,
        border: '1px solid rgba(0, 188, 212, 0.1)',
      }}>
        <Typography sx={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '0.6rem',
          color: '#00bcd4',
          textTransform: 'uppercase',
          letterSpacing: 1.5,
          fontWeight: 700,
          alignSelf: { xs: 'flex-start', sm: 'center' },
          whiteSpace: 'nowrap',
          mr: { xs: 0, sm: 1 },
        }}>
          How It Works
        </Typography>
        {howItWorksSteps.map((step, i) => {
          const Icon = step.icon;
          return (
            <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flex: 1 }}>
              <Box sx={{
                bgcolor: 'rgba(0, 188, 212, 0.1)',
                borderRadius: '50%',
                p: 0.8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon sx={{ color: '#00bcd4', fontSize: 18 }} />
              </Box>
              <Box>
                <Typography sx={{
                  color: '#ccc',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  lineHeight: 1.3,
                }}>
                  {step.title}
                </Typography>
                <Typography sx={{
                  color: '#777',
                  fontSize: '0.68rem',
                  lineHeight: 1.4,
                }}>
                  {step.desc}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Explore more navigation links */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography sx={{
          color: '#666',
          fontSize: '0.75rem',
          fontFamily: '"JetBrains Mono", monospace',
          mr: 0.5,
        }}>
          Explore:
        </Typography>
        {navLinks.map(({ label, path, icon: Icon }) => (
          <Chip
            key={path}
            label={label}
            icon={<Icon sx={{ fontSize: 16, color: '#888 !important' }} />}
            variant="outlined"
            size="small"
            onClick={() => navigate(path)}
            sx={{
              color: '#aaa',
              borderColor: 'rgba(255, 255, 255, 0.12)',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '0.7rem',
              '&:hover': {
                borderColor: 'rgba(0, 188, 212, 0.4)',
                color: '#00bcd4',
                bgcolor: 'rgba(0, 188, 212, 0.06)',
                '& .MuiChip-icon': { color: '#00bcd4 !important' },
              },
            }}
          />
        ))}
      </Box>
    </Paper>
  );
}
