import { useEffect, useState, useCallback } from 'react';
import {
  Box, Paper, Typography, TextField, Grid, Avatar,
  Pagination, InputAdornment, Select, MenuItem, FormControl,
  InputLabel, Chip, LinearProgress, Skeleton,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { useNavigate } from 'react-router-dom';
import { api, Card, HotCard } from '../services/api';

function HotCardsSection() {
  const [hotCards, setHotCards] = useState<HotCard[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.getHotCards(12).then(setHotCards).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Paper sx={{ p: 2, mb: 3, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <WhatshotIcon sx={{ color: '#ff6d00' }} />
          <Typography variant="h3" sx={{ color: '#ff6d00' }}>HOT CARDS</Typography>
        </Box>
        <Grid container spacing={1.5}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={i}>
              <Skeleton variant="rounded" height={200} sx={{ bgcolor: '#1a1a1a' }} />
            </Grid>
          ))}
        </Grid>
      </Paper>
    );
  }

  if (hotCards.length === 0) return null;

  return (
    <Paper sx={{ p: 2, mb: 3, bgcolor: '#0a0a0a', border: '1px solid #2a1500' }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1, mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WhatshotIcon sx={{ color: '#ff6d00' }} />
          <Typography variant="h3" sx={{ color: '#ff6d00' }}>HOT CARDS</Typography>
        </Box>
        <Typography variant="body2" sx={{ color: '#666', ml: { xs: 0, sm: 'auto' } }}>
          Ranked by market activity
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ color: '#555', mb: 2, fontSize: '0.7rem' }}>
        Highest volatility, price movement, and bid-ask spread activity
      </Typography>

      <Grid container spacing={1.5}>
        {hotCards.map((card, idx) => (
          <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={card.card_id}>
            <Paper
              sx={{
                p: 1,
                cursor: 'pointer',
                transition: 'all 0.15s',
                border: '1px solid',
                borderColor: idx < 3 ? '#ff6d00' : '#2a1500',
                bgcolor: idx < 3 ? '#0e0800' : 'transparent',
                '&:hover': {
                  borderColor: '#ff6d00',
                  transform: 'translateY(-2px)',
                },
              }}
              onClick={() => navigate(`/card/${card.card_id}`)}
            >
              {/* Rank badge */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Chip
                  label={`#${idx + 1}`}
                  size="small"
                  sx={{
                    bgcolor: idx < 3 ? '#ff6d00' : '#333',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.65rem',
                    height: 18,
                  }}
                />
                <Chip
                  icon={card.signal === 'bullish' ? <TrendingUpIcon sx={{ fontSize: 12 }} /> : card.signal === 'bearish' ? <TrendingDownIcon sx={{ fontSize: 12 }} /> : undefined}
                  label={card.signal === 'bullish' ? 'BULL' : card.signal === 'bearish' ? 'BEAR' : 'HOLD'}
                  size="small"
                  sx={{
                    bgcolor: card.signal === 'bullish' ? '#0a3a0a' : card.signal === 'bearish' ? '#3a0a0a' : '#1a1a2a',
                    color: card.signal === 'bullish' ? '#00ff41' : card.signal === 'bearish' ? '#ff1744' : '#00bcd4',
                    fontSize: '0.6rem',
                    height: 18,
                  }}
                />
              </Box>

              <Box sx={{ textAlign: 'center', mb: 1 }}>
                <Avatar
                  src={card.image_small}
                  variant="rounded"
                  sx={{ width: '100%', height: 'auto', aspectRatio: '2.5/3.5', mx: 'auto' }}
                  imgProps={{ loading: 'lazy' }}
                />
              </Box>

              <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {card.name}
              </Typography>
              <Typography variant="body2" sx={{ color: '#666', fontSize: '0.6rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {card.set_name}
              </Typography>

              {/* Price */}
              <Typography
                variant="body1"
                sx={{ fontWeight: 700, color: '#00ff41', mt: 0.5 }}
              >
                ${card.current_price.toFixed(2)}
              </Typography>

              {/* Activity score bar */}
              <Box sx={{ mt: 0.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                  <Typography variant="body2" sx={{ fontSize: '0.6rem', color: '#888' }}>Activity</Typography>
                  <Typography variant="body2" sx={{ fontSize: '0.6rem', color: '#ff6d00', fontWeight: 700 }}>
                    {card.activity_score.toFixed(0)}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, card.activity_score)}
                  sx={{
                    height: 4,
                    borderRadius: 2,
                    bgcolor: '#1a1a1a',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: card.activity_score > 60 ? '#ff6d00' : card.activity_score > 30 ? '#ffab00' : '#666',
                      borderRadius: 2,
                    },
                  }}
                />
              </Box>

              {/* Key metrics */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                {card.price_change_7d !== null && (
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '0.6rem',
                      color: card.price_change_7d >= 0 ? '#00ff41' : '#ff1744',
                    }}
                  >
                    7d: {card.price_change_7d >= 0 ? '+' : ''}{card.price_change_7d.toFixed(1)}%
                  </Typography>
                )}
                {card.volatility !== null && (
                  <Typography variant="body2" sx={{ fontSize: '0.6rem', color: '#ff6d00' }}>
                    Vol: {card.volatility.toFixed(1)}%
                  </Typography>
                )}
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Paper>
  );
}

export default function CardExplorer() {
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('current_price');
  const [sortDir, setSortDir] = useState('desc');
  const navigate = useNavigate();

  const fetchCards = useCallback(async () => {
    try {
      const params: Record<string, string> = {
        page: String(page),
        page_size: '48',
        sort_by: sortBy,
        sort_dir: sortDir,
        has_price: 'true',
      };
      if (search) params.q = search;
      const result = await api.getCards(params);
      setCards(result.data);
      setTotal(result.total);
      setTotalPages(result.total_pages);
    } catch (err) {
      console.error(err);
    }
  }, [page, search, sortBy, sortDir]);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  // Debounced search
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const handleSearchChange = (value: string) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    setSearchTimeout(setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 300));
  };

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Typography variant="h2" sx={{ mb: 2, color: '#00bcd4' }}>
        CARD EXPLORER
      </Typography>

      {/* Hot Cards Section */}
      <HotCardsSection />

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          placeholder="Search cards..."
          size="small"
          onChange={(e) => handleSearchChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: '#666' }} />
              </InputAdornment>
            ),
          }}
          sx={{ flex: 1, maxWidth: { xs: 'none', sm: 400 }, width: { xs: '100%', sm: 'auto' } }}
        />
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Sort By</InputLabel>
          <Select value={sortBy} label="Sort By" onChange={(e) => setSortBy(e.target.value)}>
            <MenuItem value="current_price">Price</MenuItem>
            <MenuItem value="name">Name</MenuItem>
            <MenuItem value="set_name">Set</MenuItem>
            <MenuItem value="rarity">Rarity</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 100 }}>
          <InputLabel>Order</InputLabel>
          <Select value={sortDir} label="Order" onChange={(e) => setSortDir(e.target.value)}>
            <MenuItem value="desc">High to Low</MenuItem>
            <MenuItem value="asc">Low to High</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="body2" sx={{ color: '#666' }}>
          {total.toLocaleString()} cards
        </Typography>
      </Box>

      {/* Card Grid */}
      <Grid container spacing={1.5}>
        {cards.map(card => (
          <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={card.id}>
            <Paper
              sx={{
                p: 1,
                cursor: 'pointer',
                transition: 'all 0.15s',
                '&:hover': {
                  borderColor: '#00bcd4',
                  transform: 'translateY(-2px)',
                },
              }}
              onClick={() => navigate(`/card/${card.id}`)}
            >
              <Box sx={{ textAlign: 'center', mb: 1 }}>
                <Avatar
                  src={card.image_small}
                  variant="rounded"
                  sx={{ width: '100%', height: 'auto', aspectRatio: '2.5/3.5', mx: 'auto' }}
                  imgProps={{ loading: 'lazy' }}
                />
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {card.name}
              </Typography>
              <Typography variant="body2" sx={{ color: '#666', fontSize: '0.65rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {card.set_name}
              </Typography>
              <Typography
                variant="body1"
                sx={{
                  fontWeight: 700,
                  color: card.current_price ? '#00ff41' : '#666',
                  mt: 0.5,
                }}
              >
                {card.current_price ? `$${card.current_price.toFixed(2)}` : '—'}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, p) => setPage(p)}
            sx={{
              '& .MuiPaginationItem-root': { color: '#e0e0e0' },
              '& .Mui-selected': { bgcolor: '#00bcd4 !important' },
            }}
          />
        </Box>
      )}
    </Box>
  );
}
