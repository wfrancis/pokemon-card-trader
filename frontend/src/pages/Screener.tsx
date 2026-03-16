import { useEffect, useState, useCallback } from 'react';
import {
  Box, Paper, Typography, Grid, Avatar, Chip, LinearProgress,
  Pagination, Select, MenuItem, FormControl, InputLabel, Slider,
  Tooltip, Skeleton, TextField, InputAdornment,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';
import { api, ScreenerCard, ScreenerStats } from '../services/api';

const REGIME_COLORS: Record<string, string> = {
  markup: '#00ff41',
  accumulation: '#00bcd4',
  distribution: '#ff9800',
  markdown: '#ff1744',
  unknown: '#666',
};

const REGIME_LABELS: Record<string, string> = {
  markup: 'UPTREND',
  accumulation: 'ACCUMULATING',
  distribution: 'DISTRIBUTING',
  markdown: 'DOWNTREND',
  unknown: 'UNKNOWN',
};

function StatsBar({ stats }: { stats: ScreenerStats | null }) {
  if (!stats) {
    return (
      <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
        <Grid container spacing={2}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Grid size={{ xs: 6, md: 3 }} key={i}>
              <Skeleton variant="rounded" height={60} sx={{ bgcolor: '#1a1a1a' }} />
            </Grid>
          ))}
        </Grid>
      </Paper>
    );
  }

  const statItems = [
    { label: 'TRACKED', value: stats.total_tracked, color: '#e0e0e0' },
    { label: 'WITH LIQUIDITY', value: stats.with_liquidity_data, color: '#00bcd4' },
    { label: 'WITH TREND DATA', value: stats.with_appreciation_data, color: '#ff9800' },
    { label: 'INVESTMENT GRADE', value: stats.investment_grade_count, color: '#00ff41' },
  ];

  return (
    <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
      <Grid container spacing={2}>
        {statItems.map(({ label, value, color }) => (
          <Grid size={{ xs: 6, md: 3 }} key={label}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: '#666', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                {label}
              </Typography>
              <Typography variant="h3" sx={{ color, fontWeight: 700 }}>
                {value.toLocaleString()}
              </Typography>
            </Box>
          </Grid>
        ))}
      </Grid>
      {stats.regime_breakdown && Object.keys(stats.regime_breakdown).length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap', justifyContent: 'center' }}>
          {Object.entries(stats.regime_breakdown).map(([regime, count]) => (
            <Chip
              key={regime}
              label={`${REGIME_LABELS[regime] || regime}: ${count}`}
              size="small"
              sx={{
                bgcolor: 'transparent',
                border: `1px solid ${REGIME_COLORS[regime] || '#666'}`,
                color: REGIME_COLORS[regime] || '#666',
                fontSize: '0.6rem',
                height: 22,
              }}
            />
          ))}
        </Box>
      )}
      {stats.last_computed_at && (
        <Typography variant="body2" sx={{ color: '#444', fontSize: '0.6rem', textAlign: 'center', mt: 1 }}>
          Last computed: {new Date(stats.last_computed_at).toLocaleString()}
        </Typography>
      )}
    </Paper>
  );
}

function ScoreBar({ value, maxValue = 100, color, label }: {
  value: number | null;
  maxValue?: number;
  color: string;
  label: string;
}) {
  if (value === null || value === undefined) {
    return (
      <Box sx={{ mt: 0.3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="body2" sx={{ fontSize: '0.55rem', color: '#555' }}>{label}</Typography>
          <Typography variant="body2" sx={{ fontSize: '0.55rem', color: '#444' }}>--</Typography>
        </Box>
      </Box>
    );
  }
  return (
    <Box sx={{ mt: 0.3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="body2" sx={{ fontSize: '0.55rem', color: '#888' }}>{label}</Typography>
        <Typography variant="body2" sx={{ fontSize: '0.55rem', color, fontWeight: 700 }}>
          {value.toFixed(0)}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, (value / maxValue) * 100)}
        sx={{
          height: 3,
          borderRadius: 2,
          bgcolor: '#1a1a1a',
          '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 2 },
        }}
      />
    </Box>
  );
}

function CardTile({ card, rank }: { card: ScreenerCard; rank: number }) {
  const navigate = useNavigate();
  const regimeColor = REGIME_COLORS[card.regime || 'unknown'] || '#666';
  const isTopTier = (card.investment_score || 0) >= 50;

  return (
    <Paper
      sx={{
        p: 1,
        cursor: 'pointer',
        transition: 'all 0.15s',
        border: '1px solid',
        borderColor: isTopTier ? '#00ff41' : '#1e1e1e',
        bgcolor: isTopTier ? '#000a00' : 'transparent',
        '&:hover': {
          borderColor: '#00bcd4',
          transform: 'translateY(-2px)',
        },
      }}
      onClick={() => navigate(`/card/${card.id}`)}
    >
      {/* Rank + Regime badge */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Chip
          label={`#${rank}`}
          size="small"
          sx={{
            bgcolor: rank <= 3 ? '#00ff41' : rank <= 10 ? '#00bcd4' : '#333',
            color: rank <= 3 ? '#000' : '#fff',
            fontWeight: 700,
            fontSize: '0.6rem',
            height: 18,
          }}
        />
        {card.regime && (
          <Chip
            label={REGIME_LABELS[card.regime] || card.regime}
            size="small"
            sx={{
              bgcolor: 'transparent',
              border: `1px solid ${regimeColor}`,
              color: regimeColor,
              fontSize: '0.5rem',
              height: 16,
            }}
          />
        )}
      </Box>

      {/* Card image */}
      <Box sx={{ textAlign: 'center', mb: 0.5 }}>
        <Avatar
          src={card.image_small}
          variant="rounded"
          sx={{ width: '100%', height: 'auto', aspectRatio: '2.5/3.5', mx: 'auto' }}
          imgProps={{ loading: 'lazy' }}
        />
      </Box>

      {/* Name + Set */}
      <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.7rem' }}>
        {card.name}
      </Typography>
      <Typography variant="body2" sx={{ color: '#666', fontSize: '0.55rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {card.set_name}
      </Typography>

      {/* Price */}
      <Typography variant="body1" sx={{ fontWeight: 700, color: '#00ff41', mt: 0.3, fontSize: '0.85rem' }}>
        ${card.current_price.toFixed(2)}
      </Typography>

      {/* Investment Score (big number) */}
      {card.investment_score !== null && (
        <Tooltip title="Combined investment score (liquidity + appreciation)">
          <Box sx={{ textAlign: 'center', mt: 0.5, mb: 0.3 }}>
            <Typography variant="body2" sx={{ fontSize: '0.5rem', color: '#888', textTransform: 'uppercase' }}>
              Invest Score
            </Typography>
            <Typography
              variant="h4"
              sx={{
                fontWeight: 800,
                color: card.investment_score >= 50 ? '#00ff41' : card.investment_score >= 30 ? '#ff9800' : '#ff1744',
              }}
            >
              {card.investment_score.toFixed(0)}
            </Typography>
          </Box>
        </Tooltip>
      )}

      {/* Metric bars */}
      <ScoreBar value={card.liquidity_score} color="#00bcd4" label="Liquidity" />
      <ScoreBar value={card.appreciation_score} color="#ff9800" label="Appreciation" />

      {/* Appreciation details */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        {card.appreciation_slope !== null && (
          <Tooltip title="Daily % appreciation (linear regression slope)">
            <Typography variant="body2" sx={{
              fontSize: '0.55rem',
              color: card.appreciation_slope >= 0 ? '#00ff41' : '#ff1744',
            }}>
              {card.appreciation_slope >= 0 ? '+' : ''}{card.appreciation_slope.toFixed(3)}%/d
            </Typography>
          </Tooltip>
        )}
        {card.appreciation_win_rate !== null && (
          <Tooltip title="% of days with positive price change">
            <Typography variant="body2" sx={{
              fontSize: '0.55rem',
              color: card.appreciation_win_rate >= 55 ? '#00ff41' : card.appreciation_win_rate >= 45 ? '#ff9800' : '#ff1744',
            }}>
              W:{card.appreciation_win_rate.toFixed(0)}%
            </Typography>
          </Tooltip>
        )}
      </Box>

      {/* Breakeven */}
      {card.breakeven_pct !== null && (
        <Tooltip title="Minimum price increase needed to break even after TCGPlayer fees">
          <Typography variant="body2" sx={{ fontSize: '0.5rem', color: '#666', mt: 0.3, textAlign: 'center' }}>
            BE: +{card.breakeven_pct.toFixed(1)}%
          </Typography>
        </Tooltip>
      )}
    </Paper>
  );
}

export default function Screener() {
  const [cards, setCards] = useState<ScreenerCard[]>([]);
  const [stats, setStats] = useState<ScreenerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [minLiquidity, setMinLiquidity] = useState(0);
  const [minAppreciation, setMinAppreciation] = useState(0);
  const [regime, setRegime] = useState('');
  const [minPrice, setMinPrice] = useState(10);
  const [sortBy, setSortBy] = useState('investment_score');
  const [sortDir, setSortDir] = useState('desc');
  const [search, setSearch] = useState('');

  useEffect(() => {
    document.title = 'Screener | PKMN Trader';
    api.getScreenerStats().then(setStats).catch(console.error);
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, []);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        page_size: '48',
        sort_by: sortBy,
        sort_dir: sortDir,
        min_price: String(minPrice),
      };
      if (minLiquidity > 0) params.min_liquidity = String(minLiquidity);
      if (minAppreciation > 0) params.min_appreciation = String(minAppreciation);
      if (regime) params.regime = regime;

      const result = await api.getScreenerCards(params);

      // Client-side search filter (API doesn't have search on screener)
      let filtered = result.data;
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(c =>
          c.name.toLowerCase().includes(q) || c.set_name.toLowerCase().includes(q)
        );
      }

      setCards(filtered);
      setTotal(result.total);
      setTotalPages(result.total_pages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortDir, minLiquidity, minAppreciation, regime, minPrice, search]);

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
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <TrendingUpIcon sx={{ color: '#00ff41', fontSize: 28 }} />
        <Typography variant="h2" sx={{ color: '#00ff41' }}>
          INVESTMENT SCREENER
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ color: '#666', mb: 2, fontSize: '0.7rem' }}>
        Find cards that are consistently liquid AND have steady price appreciation. Sorted by combined investment score.
      </Typography>

      {/* Stats */}
      <StatsBar stats={stats} />

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <FilterListIcon sx={{ color: '#666', fontSize: 18 }} />
          <Typography variant="body2" sx={{ color: '#888', fontWeight: 600 }}>FILTERS</Typography>
        </Box>
        <Grid container spacing={2} alignItems="center">
          {/* Search */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              placeholder="Search cards..."
              size="small"
              fullWidth
              onChange={(e) => handleSearchChange(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#666', fontSize: 18 }} />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>

          {/* Min Liquidity */}
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <Typography variant="body2" sx={{ color: '#888', fontSize: '0.6rem', mb: 0.5 }}>
              <WaterDropIcon sx={{ fontSize: 12, mr: 0.3, verticalAlign: 'middle' }} />
              Min Liquidity: {minLiquidity}
            </Typography>
            <Slider
              value={minLiquidity}
              onChange={(_, v) => { setMinLiquidity(v as number); setPage(1); }}
              min={0} max={100} step={5}
              size="small"
              sx={{ color: '#00bcd4' }}
            />
          </Grid>

          {/* Min Appreciation */}
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <Typography variant="body2" sx={{ color: '#888', fontSize: '0.6rem', mb: 0.5 }}>
              <TrendingUpIcon sx={{ fontSize: 12, mr: 0.3, verticalAlign: 'middle' }} />
              Min Appreciation: {minAppreciation}
            </Typography>
            <Slider
              value={minAppreciation}
              onChange={(_, v) => { setMinAppreciation(v as number); setPage(1); }}
              min={0} max={100} step={5}
              size="small"
              sx={{ color: '#ff9800' }}
            />
          </Grid>

          {/* Regime */}
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Regime</InputLabel>
              <Select
                value={regime}
                label="Regime"
                onChange={(e) => { setRegime(e.target.value); setPage(1); }}
              >
                <MenuItem value="">All</MenuItem>
                <MenuItem value="markup">Uptrend</MenuItem>
                <MenuItem value="accumulation">Accumulating</MenuItem>
                <MenuItem value="distribution">Distributing</MenuItem>
                <MenuItem value="markdown">Downtrend</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Sort */}
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Sort By</InputLabel>
              <Select
                value={sortBy}
                label="Sort By"
                onChange={(e) => setSortBy(e.target.value)}
              >
                <MenuItem value="investment_score">Investment Score</MenuItem>
                <MenuItem value="liquidity_score">Liquidity</MenuItem>
                <MenuItem value="appreciation_score">Appreciation</MenuItem>
                <MenuItem value="appreciation_slope">Daily Growth</MenuItem>
                <MenuItem value="current_price">Price</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Min Price */}
          <Grid size={{ xs: 6, sm: 3, md: 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Min $</InputLabel>
              <Select
                value={minPrice}
                label="Min $"
                onChange={(e) => { setMinPrice(Number(e.target.value)); setPage(1); }}
              >
                <MenuItem value={2}>$2+</MenuItem>
                <MenuItem value={10}>$10+</MenuItem>
                <MenuItem value={20}>$20+</MenuItem>
                <MenuItem value={50}>$50+</MenuItem>
                <MenuItem value={100}>$100+</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {/* Results count */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" sx={{ color: '#666' }}>
          {total.toLocaleString()} cards
        </Typography>
        <FormControl size="small" sx={{ minWidth: 100 }}>
          <Select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value)}
            size="small"
            sx={{ fontSize: '0.75rem' }}
          >
            <MenuItem value="desc">High to Low</MenuItem>
            <MenuItem value="asc">Low to High</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Card Grid */}
      {loading ? (
        <Grid container spacing={1.5}>
          {Array.from({ length: 12 }).map((_, i) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={i}>
              <Skeleton variant="rounded" height={380} sx={{ bgcolor: '#1a1a1a' }} />
            </Grid>
          ))}
        </Grid>
      ) : cards.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: '#0a0a0a' }}>
          <Typography variant="body1" sx={{ color: '#666' }}>
            No cards match your filters. Try lowering the minimum scores or wait for metrics to be computed.
          </Typography>
          <Typography variant="body2" sx={{ color: '#444', mt: 1, fontSize: '0.7rem' }}>
            Investment metrics are computed during background sync (every 48 hours) or can be triggered manually.
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={1.5}>
          {cards.map((card, idx) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={card.id}>
              <CardTile card={card} rank={(page - 1) * 48 + idx + 1} />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, p) => setPage(p)}
            sx={{
              '& .MuiPaginationItem-root': { color: '#e0e0e0' },
              '& .Mui-selected': { bgcolor: '#00ff41 !important', color: '#000' },
            }}
          />
        </Box>
      )}
    </Box>
  );
}
