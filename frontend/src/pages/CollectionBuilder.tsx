import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  TextField,
  InputAdornment,
  Select,
  MenuItem,
  IconButton,
  Button,
  Autocomplete,
  Fade,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StyleIcon from '@mui/icons-material/Style';
import { api } from '../services/api';
import type { Card } from '../services/api';

type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

const CONDITION_LABELS: Record<Condition, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

const CONDITION_MULTIPLIERS: Record<Condition, number> = {
  NM: 1.0,
  LP: 0.85,
  MP: 0.7,
  HP: 0.5,
  DMG: 0.3,
};

interface CollectionCard {
  card: Card;
  condition: Condition;
}

export default function CollectionBuilder() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<CollectionCard[]>([]);
  const [searchValue, setSearchValue] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<Card[]>([]);
  const [saved, setSaved] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.title = "What's My Collection Worth? | PKMN Trader";
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, []);

  const handleSearch = useCallback((val: string) => {
    setSearchValue(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (val.trim().length >= 2) {
      searchTimerRef.current = setTimeout(() => {
        api.getCards({ q: val.trim(), page_size: '8' })
          .then(res => setSearchSuggestions(res.data))
          .catch(() => {});
      }, 300);
    } else {
      setSearchSuggestions([]);
    }
  }, []);

  const addCard = useCallback((card: Card) => {
    setCards(prev => {
      // Don't add duplicates
      if (prev.some(c => c.card.id === card.id)) return prev;
      return [...prev, { card, condition: 'NM' }];
    });
    setSearchValue('');
    setSearchSuggestions([]);
    setSaved(false);
  }, []);

  const removeCard = useCallback((cardId: number) => {
    setCards(prev => prev.filter(c => c.card.id !== cardId));
    setSaved(false);
  }, []);

  const updateCondition = useCallback((cardId: number, condition: Condition) => {
    setCards(prev => prev.map(c => c.card.id === cardId ? { ...c, condition } : c));
    setSaved(false);
  }, []);

  const getEstimatedValue = (card: Card, condition: Condition): number => {
    const basePrice = card.current_price ?? 0;
    return basePrice * CONDITION_MULTIPLIERS[condition];
  };

  const totalValue = cards.reduce((sum, c) => sum + getEstimatedValue(c.card, c.condition), 0);

  const mostValuable = cards.length > 0
    ? cards.reduce((best, c) => getEstimatedValue(c.card, c.condition) > getEstimatedValue(best.card, best.condition) ? c : best)
    : null;
  const leastValuable = cards.length > 0
    ? cards.reduce((least, c) => getEstimatedValue(c.card, c.condition) < getEstimatedValue(least.card, least.condition) ? c : least)
    : null;

  const saveToWatchlist = () => {
    const existing: any[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    let added = 0;
    for (const { card, condition } of cards) {
      if (!existing.some((w: any) => w.cardId === card.id)) {
        existing.push({
          cardId: card.id,
          costBasis: null,
          alertAbove: null,
          alertBelow: null,
          quantity: 1,
          condition,
          addedAt: new Date().toISOString(),
        });
        added++;
      }
    }
    localStorage.setItem('pkmn_watchlist', JSON.stringify(existing));
    setSaved(true);
  };

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 800, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ textAlign: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 1 }}>
          <StyleIcon sx={{ color: '#00ff41', fontSize: 28 }} />
          <Typography sx={{
            color: '#00ff41',
            fontWeight: 700,
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: { xs: '1.1rem', md: '1.4rem' },
            letterSpacing: 1,
          }}>
            WHAT'S MY COLLECTION WORTH?
          </Typography>
        </Box>
        <Typography sx={{ color: '#888', fontSize: '0.85rem', maxWidth: 500, mx: 'auto' }}>
          Add your Pokemon cards below to find out their total value instantly. No account needed.
        </Typography>
      </Box>

      {/* Step 1: Search and Add */}
      <Paper sx={{ p: 2, mb: 2, bgcolor: '#0d0d0d', border: '1px solid #1e1e1e' }}>
        <Typography sx={{
          color: '#00bcd4',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '0.75rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 1,
          mb: 1.5,
        }}>
          Step 1: Add Your Cards
        </Typography>

        <Autocomplete
          freeSolo
          options={searchSuggestions}
          getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.name}
          filterOptions={(x) => x}
          inputValue={searchValue}
          onInputChange={(_, val) => handleSearch(val)}
          onChange={(_, val) => {
            if (val && typeof val !== 'string') addCard(val);
          }}
          renderOption={(props, opt) => (
            <li {...props} key={typeof opt === 'string' ? opt : opt.id}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', gap: 1 }}>
                {typeof opt !== 'string' && opt.image_small && (
                  <Box
                    component="img"
                    src={opt.image_small}
                    alt=""
                    sx={{ width: 32, height: 44, objectFit: 'contain', flexShrink: 0, borderRadius: '2px' }}
                  />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.8rem', color: '#ccc' }}>
                    {typeof opt === 'string' ? opt : opt.name}
                  </Typography>
                  {typeof opt !== 'string' && (
                    <Typography noWrap sx={{ fontSize: '0.6rem', color: '#666' }}>{opt.set_name}</Typography>
                  )}
                </Box>
                {typeof opt !== 'string' && (
                  <Typography sx={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '0.75rem',
                    color: '#00ff41',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>
                    ${opt.current_price?.toFixed(2) ?? '—'}
                  </Typography>
                )}
              </Box>
            </li>
          )}
          componentsProps={{
            paper: {
              sx: {
                bgcolor: '#111',
                border: '1px solid #333',
                '& .MuiAutocomplete-option': { '&:hover': { bgcolor: '#1a2a1a' } },
              },
            },
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              fullWidth
              placeholder="Type a Pokemon name to add it..."
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#555' }} />
                  </InputAdornment>
                ),
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  fontSize: '0.95rem',
                  '& fieldset': { borderColor: '#333' },
                  '&:hover fieldset': { borderColor: '#444' },
                  '&.Mui-focused fieldset': { borderColor: '#00ff41' },
                },
              }}
            />
          )}
        />

        {cards.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Typography sx={{ color: '#444', fontSize: '0.8rem' }}>
              Search for cards above to start building your collection
            </Typography>
            <Typography sx={{ color: '#333', fontSize: '0.7rem', mt: 0.5 }}>
              Try: Charizard, Pikachu, Mewtwo, Lugia, Gengar
            </Typography>
          </Box>
        )}

        {/* Card List */}
        {cards.map(({ card, condition }) => {
          const estValue = getEstimatedValue(card, condition);
          return (
            <Paper
              key={card.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: { xs: 1, sm: 1.5 },
                p: 1,
                mt: 1,
                bgcolor: '#080808',
                border: '1px solid #1a1a1a',
                flexWrap: { xs: 'wrap', sm: 'nowrap' },
              }}
            >
              {card.image_small && (
                <Box
                  component="img"
                  src={card.image_small}
                  alt={card.name}
                  sx={{
                    width: { xs: 36, sm: 42 },
                    height: { xs: 50, sm: 58 },
                    objectFit: 'contain',
                    borderRadius: '3px',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                  onClick={() => navigate(`/card/${card.id}`)}
                />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: '#ccc' }}>
                  {card.name}
                </Typography>
                <Typography noWrap sx={{ fontSize: '0.6rem', color: '#555' }}>
                  {card.set_name}
                </Typography>
              </Box>
              <Select
                size="small"
                value={condition}
                onChange={(e) => updateCondition(card.id, e.target.value as Condition)}
                sx={{
                  fontSize: '0.7rem',
                  fontFamily: '"JetBrains Mono", monospace',
                  color: '#aaa',
                  width: { xs: 80, sm: 100 },
                  flexShrink: 0,
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#222' },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#333' },
                  '& .MuiSelect-icon': { color: '#444' },
                }}
                MenuProps={{ PaperProps: { sx: { bgcolor: '#111', border: '1px solid #333' } } }}
              >
                {(Object.keys(CONDITION_LABELS) as Condition[]).map(c => (
                  <MenuItem key={c} value={c} sx={{ fontSize: '0.7rem', fontFamily: '"JetBrains Mono", monospace' }}>
                    {c}
                  </MenuItem>
                ))}
              </Select>
              <Typography sx={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: '0.8rem',
                fontWeight: 700,
                color: '#00ff41',
                flexShrink: 0,
                minWidth: 60,
                textAlign: 'right',
              }}>
                ${estValue.toFixed(2)}
              </Typography>
              <IconButton size="small" onClick={() => removeCard(card.id)} sx={{ color: '#555', '&:hover': { color: '#ff1744' } }}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Paper>
          );
        })}
      </Paper>

      {/* Step 2: Collection Value (shows when cards exist) */}
      {cards.length > 0 && (
        <Fade in>
          <Paper sx={{ p: 2.5, mb: 2, bgcolor: '#001a00', border: '2px solid #00ff4133' }}>
            <Typography sx={{
              color: '#00bcd4',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              mb: 1,
            }}>
              Step 2: Your Collection Value
            </Typography>

            <Typography sx={{
              color: '#00ff41',
              fontWeight: 700,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: { xs: '1.8rem', md: '2.4rem' },
              textAlign: 'center',
              my: 2,
            }}>
              YOUR COLLECTION IS WORTH ${totalValue.toFixed(2)}
            </Typography>

            <Typography sx={{ color: '#666', fontSize: '0.65rem', textAlign: 'center', mb: 2, fontFamily: '"JetBrains Mono", monospace' }}>
              {cards.length} card{cards.length !== 1 ? 's' : ''} &middot; Prices based on recent market data
            </Typography>

            {/* Most / Least Valuable */}
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
              {mostValuable && cards.length > 1 && (
                <Paper sx={{ px: 2, py: 1, bgcolor: '#0a1a0a', border: '1px solid #00ff4122', textAlign: 'center', minWidth: 160 }}>
                  <Typography sx={{ color: '#555', fontSize: '0.55rem', textTransform: 'uppercase', fontFamily: '"JetBrains Mono", monospace', mb: 0.3 }}>
                    Most Valuable
                  </Typography>
                  <Typography noWrap sx={{ color: '#ccc', fontSize: '0.75rem', fontWeight: 600 }}>
                    {mostValuable.card.name}
                  </Typography>
                  <Typography sx={{ color: '#00ff41', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.85rem', fontWeight: 700 }}>
                    ${getEstimatedValue(mostValuable.card, mostValuable.condition).toFixed(2)}
                  </Typography>
                </Paper>
              )}
              {leastValuable && cards.length > 1 && mostValuable?.card.id !== leastValuable?.card.id && (
                <Paper sx={{ px: 2, py: 1, bgcolor: '#0d0808', border: '1px solid #ff174422', textAlign: 'center', minWidth: 160 }}>
                  <Typography sx={{ color: '#555', fontSize: '0.55rem', textTransform: 'uppercase', fontFamily: '"JetBrains Mono", monospace', mb: 0.3 }}>
                    Least Valuable
                  </Typography>
                  <Typography noWrap sx={{ color: '#ccc', fontSize: '0.75rem', fontWeight: 600 }}>
                    {leastValuable.card.name}
                  </Typography>
                  <Typography sx={{ color: '#ff9800', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.85rem', fontWeight: 700 }}>
                    ${getEstimatedValue(leastValuable.card, leastValuable.condition).toFixed(2)}
                  </Typography>
                </Paper>
              )}
            </Box>
          </Paper>
        </Fade>
      )}

      {/* Step 3: Save & Track */}
      {cards.length > 0 && (
        <Fade in>
          <Paper sx={{ p: 2.5, mb: 2, bgcolor: '#0d0d0d', border: '1px solid #1e1e1e', textAlign: 'center' }}>
            <Typography sx={{
              color: '#00bcd4',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              mb: 1.5,
            }}>
              Step 3: Save & Track
            </Typography>

            {!saved ? (
              <>
                <Button
                  variant="contained"
                  startIcon={<BookmarkAddIcon />}
                  onClick={saveToWatchlist}
                  sx={{
                    bgcolor: '#00ff41',
                    color: '#000',
                    fontWeight: 700,
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '0.85rem',
                    px: 4,
                    py: 1,
                    '&:hover': { bgcolor: '#00cc33' },
                    textTransform: 'none',
                  }}
                >
                  Save All to Watchlist
                </Button>
                <Typography sx={{ color: '#555', fontSize: '0.7rem', mt: 1 }}>
                  Track price changes over time for all your cards
                </Typography>
              </>
            ) : (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 1 }}>
                  <CheckCircleIcon sx={{ color: '#00ff41', fontSize: 28 }} />
                  <Typography sx={{ color: '#00ff41', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1rem' }}>
                    SAVED!
                  </Typography>
                </Box>
                <Typography sx={{ color: '#aaa', fontSize: '0.8rem', mb: 2 }}>
                  You're now tracking {cards.length} card{cards.length !== 1 ? 's' : ''} worth ${totalValue.toFixed(2)}!
                  <br />
                  Visit your Watchlist to watch prices change over time.
                </Typography>
                <Button
                  variant="outlined"
                  onClick={() => navigate('/watchlist')}
                  sx={{
                    borderColor: '#00ff41',
                    color: '#00ff41',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontWeight: 600,
                    textTransform: 'none',
                    '&:hover': { borderColor: '#00cc33', bgcolor: '#00ff4111' },
                  }}
                >
                  Go to Watchlist
                </Button>
              </Box>
            )}
          </Paper>
        </Fade>
      )}

      {/* Condition guide hint */}
      {cards.length > 0 && (
        <Typography sx={{ color: '#333', fontSize: '0.6rem', textAlign: 'center', fontFamily: '"JetBrains Mono", monospace' }}>
          NM = Near Mint (full price) &middot; LP = Lightly Played (~85%) &middot; MP = Moderately Played (~70%) &middot; HP = Heavily Played (~50%) &middot; DMG = Damaged (~30%)
        </Typography>
      )}
    </Box>
  );
}
