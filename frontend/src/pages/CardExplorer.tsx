import { useEffect, useState, useCallback } from 'react';
import {
  Box, Paper, Typography, TextField, Grid, Avatar,
  Pagination, InputAdornment, Select, MenuItem, FormControl,
  InputLabel,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';
import { api, Card } from '../services/api';

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
    <Box sx={{ p: 2 }}>
      <Typography variant="h2" sx={{ mb: 2, color: '#00bcd4' }}>
        CARD EXPLORER
      </Typography>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
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
          sx={{ flex: 1, maxWidth: 400 }}
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
