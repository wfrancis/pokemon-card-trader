import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Paper, Typography, Grid, Avatar, Chip, LinearProgress,
  Pagination, Select, MenuItem, FormControl, InputLabel, Slider,
  Tooltip, Skeleton, TextField, InputAdornment, ToggleButtonGroup, ToggleButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  Switch,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
import DiamondIcon from '@mui/icons-material/Diamond';
import StarIcon from '@mui/icons-material/Star';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import ClearIcon from '@mui/icons-material/Clear';
import { useNavigate } from 'react-router-dom';
import { api, ScreenerCard, ScreenerStats } from '../services/api';
import GlossaryTooltip from '../components/GlossaryTooltip';

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
    { label: 'TRACKED', value: stats.total_tracked, color: '#e0e0e0', glossary: '' },
    { label: 'WITH LIQUIDITY', value: stats.with_liquidity_data, color: '#00bcd4', glossary: 'liquidity' },
    { label: 'WITH TREND DATA', value: stats.with_appreciation_data, color: '#ff9800', glossary: 'appreciation_slope' },
    { label: 'INVESTMENT GRADE', value: stats.investment_grade_count, color: '#00ff41', glossary: 'investment_grade' },
  ];

  return (
    <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
      <Grid container spacing={2}>
        {statItems.map(({ label, value, color, glossary }) => (
          <Grid size={{ xs: 6, md: 3 }} key={label}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: '#666', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                {glossary ? <GlossaryTooltip term={glossary}>{label}</GlossaryTooltip> : label}
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
            <GlossaryTooltip key={regime} term={regime === 'markup' ? 'uptrend' : regime === 'markdown' ? 'downtrend' : regime}>
            <Chip
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
            </GlossaryTooltip>
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

function ScoreBar({ value, maxValue = 100, color, label, glossaryTerm }: {
  value: number | null;
  maxValue?: number;
  color: string;
  label: string;
  glossaryTerm?: string;
}) {
  if (value === null || value === undefined) {
    return (
      <Box sx={{ mt: 0.3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="body2" sx={{ fontSize: '0.55rem', color: '#555' }}>{glossaryTerm ? <GlossaryTooltip term={glossaryTerm}>{label}</GlossaryTooltip> : label}</Typography>
          <Typography variant="body2" sx={{ fontSize: '0.55rem', color: '#444' }}>--</Typography>
        </Box>
      </Box>
    );
  }
  return (
    <Box sx={{ mt: 0.3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="body2" sx={{ fontSize: '0.55rem', color: '#888' }}>{glossaryTerm ? <GlossaryTooltip term={glossaryTerm}>{label}</GlossaryTooltip> : label}</Typography>
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

function TimeToSellBadge({ value }: { value: { estimated_days: number; confidence: string; sales_90d: number } | null }) {
  if (!value) return null;
  const days = value.estimated_days;
  let label: string;
  if (days <= 1) label = '< 1 day';
  else if (days <= 3) label = `${days}d`;
  else if (days <= 7) label = `~${days}d`;
  else if (days <= 21) label = `~${Math.round(days / 7)}wk`;
  else label = `~${Math.round(days / 30)}mo`;

  const color = days <= 3 ? '#00ff41' : days <= 14 ? '#ff9800' : '#ff1744';
  const confLabel = value.confidence === 'high' ? '' : value.confidence === 'medium' ? ' ~' : ' ?';
  return (
    <Tooltip title={`Est. ${days}d to sell (${value.confidence} confidence, ${value.sales_90d} sales/90d)`}>
      <Chip
        label={`${label}${confLabel}`}
        size="small"
        sx={{
          bgcolor: 'transparent',
          border: `1px solid ${color}`,
          color,
          fontSize: '0.5rem',
          height: 18,
          mt: 0.3,
        }}
      />
    </Tooltip>
  );
}

function getValueBadge(card: ScreenerCard): { label: string; color: string; bgcolor: string } {
  const score = card.investment_score ?? 0;
  const slope = card.breakeven_adjusted_slope;
  if (score >= 70 && slope !== null && slope > 0) {
    return { label: 'Good Value', color: '#000', bgcolor: '#00ff41' };
  }
  if (score < 30 || (slope !== null && slope < -0.1)) {
    return { label: 'Overpriced', color: '#fff', bgcolor: '#ff1744' };
  }
  return { label: 'Fair', color: '#000', bgcolor: '#ff9800' };
}

function isGoodBuy(card: ScreenerCard): boolean {
  return (card.investment_score ?? 0) >= 70 && card.breakeven_adjusted_slope !== null && card.breakeven_adjusted_slope > 0;
}

function SimpleCardTile({ card }: { card: ScreenerCard }) {
  const navigate = useNavigate();
  const badge = getValueBadge(card);
  const trend7d = card.appreciation_slope !== null ? card.appreciation_slope * 7 : null;

  return (
    <Paper
      sx={{
        p: 1,
        cursor: 'pointer',
        transition: 'all 0.15s',
        border: '1px solid #1e1e1e',
        '&:hover': {
          borderColor: '#00bcd4',
          transform: 'translateY(-2px)',
        },
      }}
      onClick={() => navigate(`/card/${card.id}`)}
    >
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
      <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.75rem' }}>
        {card.name}
      </Typography>
      <Typography variant="body2" sx={{ color: '#666', fontSize: '0.6rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {card.set_name}
      </Typography>

      {/* Price */}
      <Typography variant="body1" sx={{ fontWeight: 700, color: '#00ff41', mt: 0.5, fontSize: '0.95rem', fontFamily: 'monospace' }}>
        ${card.current_price.toFixed(2)}
      </Typography>

      {/* 7d trend */}
      {trend7d !== null && (
        <Typography variant="body2" sx={{
          fontSize: '0.7rem',
          fontFamily: 'monospace',
          color: trend7d >= 0 ? '#00ff41' : '#ff1744',
          mt: 0.3,
        }}>
          {trend7d >= 0 ? '+' : ''}{trend7d.toFixed(1)}% / 7d
        </Typography>
      )}

      {/* Value badge */}
      <Chip
        label={badge.label}
        size="small"
        sx={{
          mt: 0.5,
          bgcolor: badge.bgcolor,
          color: badge.color,
          fontWeight: 700,
          fontSize: '0.65rem',
          height: 22,
        }}
      />
    </Paper>
  );
}

function CardTile({ card, rank }: { card: ScreenerCard; rank: number }) {
  const navigate = useNavigate();
  const regimeColor = REGIME_COLORS[card.regime || 'unknown'] || '#666';
  const isTopTier = (card.investment_score || 0) >= 50;

  // Breakeven color: green if adjusted slope is positive, red if negative
  const beColor = card.breakeven_adjusted_slope !== null
    ? (card.breakeven_adjusted_slope > 0 ? '#00ff41' : '#ff1744')
    : '#666';

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
      {/* Rank + Regime + Blue Chip badges */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, flexWrap: 'wrap', gap: 0.3 }}>
        <Box sx={{ display: 'flex', gap: 0.3, alignItems: 'center' }}>
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
          {card.is_blue_chip && (
            <Tooltip title="Blue-chip Pokemon — high collector demand">
              <StarIcon sx={{ color: '#ffd700', fontSize: 14 }} />
            </Tooltip>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.3, alignItems: 'center' }}>
          {card.rarity_score !== null && card.rarity_score >= 60 && (
            <Tooltip title={`Rarity: ${card.rarity} (${card.rarity_score}/100)`}>
              <DiamondIcon sx={{ color: '#e040fb', fontSize: 13 }} />
            </Tooltip>
          )}
          {card.regime && (
            <GlossaryTooltip term={card.regime === 'markup' ? 'uptrend' : card.regime === 'markdown' ? 'downtrend' : card.regime}>
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
            </GlossaryTooltip>
          )}
        </Box>
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

      {/* Time to sell + Velocity */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <TimeToSellBadge value={card.time_to_sell} />
        {card.sales_per_day != null && (
          <Chip
            size="small"
            label={`${card.sales_per_day.toFixed(1)}/day`}
            sx={{
              height: 18, fontSize: '0.5rem', fontWeight: 600, fontFamily: 'monospace', mt: 0.3,
              bgcolor: 'transparent',
              color: card.sales_per_day >= 1 ? '#00bcd4' : card.sales_per_day >= 0.5 ? '#ff9800' : '#666',
              border: '1px solid',
              borderColor: card.sales_per_day >= 1 ? '#00bcd433' : card.sales_per_day >= 0.5 ? '#ff980033' : '#33333366',
            }}
          />
        )}
      </Box>

      {/* Investment Score (big number) with breakdown tooltip */}
      {card.investment_score !== null && (
        <Tooltip title={
          `Score: ${card.investment_score.toFixed(1)} = ` +
          `App(${card.appreciation_score?.toFixed(0) ?? '?'}) × ` +
          `Liq modifier(${card.liquidity_score ?? '?'}) + ` +
          `Rarity(${card.rarity_score ?? '?'}/100)` +
          (card.appreciation_consistency !== null ? ` | R²=${card.appreciation_consistency.toFixed(2)}` : '')
        }>
          <Box sx={{ textAlign: 'center', mt: 0.5, mb: 0.3 }}>
            <Typography variant="body2" sx={{ fontSize: '0.5rem', color: '#888', textTransform: 'uppercase' }}>
              <GlossaryTooltip term="investment_score">Invest Score</GlossaryTooltip>
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
      <ScoreBar value={card.liquidity_score} color="#00bcd4" label="Liquidity" glossaryTerm="liquidity_score" />
      <ScoreBar value={card.appreciation_score} color="#ff9800" label="Appreciation" glossaryTerm="appreciation_slope" />

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

      {/* Breakeven — color-coded and prominent */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.3, gap: 0.5 }}>
        {card.breakeven_pct !== null && (
          <Tooltip title={`Breakeven: +${card.breakeven_pct.toFixed(1)}% needed after fees${card.days_to_breakeven ? ` (~${card.days_to_breakeven}d at current pace)` : ''}`}>
            <Typography variant="body2" sx={{ fontSize: '0.5rem', color: beColor, fontWeight: 600 }}>
              BE: +{card.breakeven_pct.toFixed(1)}%
              {card.days_to_breakeven !== null && (
                <span style={{ color: '#888', fontWeight: 400 }}> ({card.days_to_breakeven}d)</span>
              )}
            </Typography>
          </Tooltip>
        )}
      </Box>
    </Paper>
  );
}

function SimpleCardTable({ cards, page, onSort, sortBy, sortDir }: {
  cards: ScreenerCard[];
  page: number;
  onSort: (col: string) => void;
  sortBy: string;
  sortDir: string;
}) {
  const navigate = useNavigate();
  const columns: { id: string; label: string; width?: number; sortable?: boolean }[] = [
    { id: 'rank', label: '#', width: 40 },
    { id: 'name', label: 'Card', sortable: true },
    { id: 'current_price', label: 'Price', width: 80, sortable: true },
    { id: 'trend', label: '7d Trend', width: 90 },
    { id: 'good_buy', label: 'Good Buy?', width: 90 },
  ];

  return (
    <TableContainer component={Paper} sx={{ bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
      <Table size="small" sx={{ '& td, & th': { borderColor: '#1a1a1a', py: 0.75 } }}>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell
                key={col.id}
                sx={{ color: '#888', fontSize: '0.7rem', fontWeight: 600, width: col.width }}
              >
                {col.sortable ? (
                  <TableSortLabel
                    active={sortBy === col.id}
                    direction={sortBy === col.id ? (sortDir as 'asc' | 'desc') : 'desc'}
                    onClick={() => onSort(col.id)}
                    sx={{ color: '#888 !important', '& .MuiTableSortLabel-icon': { color: '#666 !important' } }}
                  >
                    {col.label}
                  </TableSortLabel>
                ) : col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {cards.map((card, idx) => {
            const rank = (page - 1) * 48 + idx + 1;
            const trend7d = card.appreciation_slope !== null ? card.appreciation_slope * 7 : null;
            const goodBuy = isGoodBuy(card);
            return (
              <TableRow
                key={card.id}
                hover
                sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#111' } }}
                onClick={() => navigate(`/card/${card.id}`)}
              >
                <TableCell sx={{ color: '#888', fontWeight: 700, fontSize: '0.75rem' }}>
                  {rank}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Avatar src={card.image_small} variant="rounded" sx={{ width: 32, height: 44 }} imgProps={{ loading: 'lazy' }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {card.name}
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#555', fontSize: '0.6rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {card.set_name}
                      </Typography>
                    </Box>
                  </Box>
                </TableCell>
                <TableCell sx={{ color: '#00ff41', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'monospace' }}>
                  ${card.current_price.toFixed(2)}
                </TableCell>
                <TableCell sx={{
                  fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 600,
                  color: trend7d !== null ? (trend7d >= 0 ? '#00ff41' : '#ff1744') : '#444',
                }}>
                  {trend7d !== null ? `${trend7d >= 0 ? '+' : ''}${trend7d.toFixed(1)}%` : '--'}
                </TableCell>
                <TableCell>
                  {goodBuy ? (
                    <Tooltip title="High investment score with positive growth after fees">
                      <CheckCircleIcon sx={{ color: '#00ff41', fontSize: 22 }} />
                    </Tooltip>
                  ) : (
                    <Tooltip title="Does not meet Good Buy criteria (score 70+ and positive growth after fees)">
                      <CancelIcon sx={{ color: '#444', fontSize: 18 }} />
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function CardTable({ cards, page, onSort, sortBy, sortDir }: {
  cards: ScreenerCard[];
  page: number;
  onSort: (col: string) => void;
  sortBy: string;
  sortDir: string;
}) {
  const navigate = useNavigate();
  const columns: { id: string; label: string; width?: number; glossary?: string }[] = [
    { id: 'rank', label: '#', width: 40 },
    { id: 'name', label: 'Card' },
    { id: 'current_price', label: 'Price', width: 75 },
    { id: 'investment_score', label: 'Score', width: 60, glossary: 'investment_score' },
    { id: 'liquidity_score', label: 'Liq', width: 50, glossary: 'liquidity_score' },
    { id: 'appreciation_score', label: 'App', width: 50, glossary: 'appreciation_slope' },
    { id: 'appreciation_consistency', label: 'R²', width: 50, glossary: 'appreciation_consistency' },
    { id: 'appreciation_slope', label: '%/Day', width: 65, glossary: 'appreciation_slope' },
    { id: 'breakeven_pct', label: 'BE%', width: 55, glossary: 'breakeven' },
    { id: 'days_to_breakeven', label: 'BE Days', width: 60, glossary: 'breakeven' },
    { id: 'time_to_sell', label: 'TTS', width: 75, glossary: 'time_to_sell' },
    { id: 'regime', label: 'Regime', width: 85, glossary: 'regime' },
  ];

  const sortable = ['name', 'current_price', 'investment_score', 'liquidity_score', 'appreciation_score', 'appreciation_consistency', 'appreciation_slope'];

  return (
    <TableContainer component={Paper} sx={{ bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
      <Table size="small" sx={{ '& td, & th': { borderColor: '#1a1a1a', py: 0.5 } }}>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell
                key={col.id}
                sx={{ color: '#888', fontSize: '0.65rem', fontWeight: 600, width: col.width }}
              >
                {sortable.includes(col.id) ? (
                  <TableSortLabel
                    active={sortBy === col.id}
                    direction={sortBy === col.id ? (sortDir as 'asc' | 'desc') : 'desc'}
                    onClick={() => onSort(col.id)}
                    sx={{ color: '#888 !important', '& .MuiTableSortLabel-icon': { color: '#666 !important' } }}
                  >
                    {col.glossary ? <GlossaryTooltip term={col.glossary}>{col.label}</GlossaryTooltip> : col.label}
                  </TableSortLabel>
                ) : col.glossary ? <GlossaryTooltip term={col.glossary}>{col.label}</GlossaryTooltip> : col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {cards.map((card, idx) => {
            const rank = (page - 1) * 48 + idx + 1;
            const regimeColor = REGIME_COLORS[card.regime || 'unknown'] || '#666';
            const scoreColor = (card.investment_score || 0) >= 50 ? '#00ff41' : (card.investment_score || 0) >= 30 ? '#ff9800' : '#ff1744';
            return (
              <TableRow
                key={card.id}
                hover
                sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#111' } }}
                onClick={() => navigate(`/card/${card.id}`)}
              >
                <TableCell sx={{ color: rank <= 3 ? '#00ff41' : '#888', fontWeight: 700, fontSize: '0.7rem' }}>
                  {rank}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Avatar src={card.image_small} variant="rounded" sx={{ width: 28, height: 38 }} imgProps={{ loading: 'lazy' }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {card.name}
                        </Typography>
                        {card.is_blue_chip && <StarIcon sx={{ color: '#ffd700', fontSize: 12 }} />}
                        {card.rarity_score !== null && card.rarity_score >= 60 && <DiamondIcon sx={{ color: '#e040fb', fontSize: 11 }} />}
                      </Box>
                      <Typography variant="body2" sx={{ color: '#555', fontSize: '0.55rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {card.set_name}
                      </Typography>
                    </Box>
                  </Box>
                </TableCell>
                <TableCell sx={{ color: '#00ff41', fontWeight: 700, fontSize: '0.75rem', fontFamily: 'monospace' }}>
                  ${card.current_price.toFixed(2)}
                </TableCell>
                <TableCell sx={{ color: scoreColor, fontWeight: 800, fontSize: '0.8rem', fontFamily: 'monospace' }}>
                  {card.investment_score !== null ? card.investment_score.toFixed(0) : '--'}
                </TableCell>
                <TableCell sx={{ color: '#00bcd4', fontSize: '0.7rem', fontFamily: 'monospace' }}>
                  {card.liquidity_score ?? '--'}
                </TableCell>
                <TableCell sx={{ color: '#ff9800', fontSize: '0.7rem', fontFamily: 'monospace' }}>
                  {card.appreciation_score !== null ? card.appreciation_score.toFixed(0) : '--'}
                </TableCell>
                <TableCell sx={{
                  fontFamily: 'monospace', fontSize: '0.65rem',
                  color: card.appreciation_consistency !== null
                    ? (card.appreciation_consistency >= 0.5 ? '#00ff41' : card.appreciation_consistency >= 0.3 ? '#ff9800' : '#ff1744')
                    : '#444',
                }}>
                  {card.appreciation_consistency !== null ? card.appreciation_consistency.toFixed(2) : '--'}
                </TableCell>
                <TableCell sx={{
                  color: card.appreciation_slope !== null ? (card.appreciation_slope >= 0 ? '#00ff41' : '#ff1744') : '#444',
                  fontSize: '0.65rem', fontFamily: 'monospace',
                }}>
                  {card.appreciation_slope !== null ? `${card.appreciation_slope >= 0 ? '+' : ''}${card.appreciation_slope.toFixed(3)}%` : '--'}
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#888' }}>
                  {card.breakeven_pct !== null ? `+${card.breakeven_pct.toFixed(1)}%` : '--'}
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.65rem', color: card.days_to_breakeven !== null ? (card.days_to_breakeven <= 90 ? '#00ff41' : card.days_to_breakeven <= 365 ? '#ff9800' : '#ff1744') : '#444' }}>
                  {card.days_to_breakeven !== null ? `${card.days_to_breakeven}d` : '--'}
                </TableCell>
                <TableCell>
                  {card.time_to_sell ? (
                    <TimeToSellBadge value={card.time_to_sell} />
                  ) : (
                    <Typography variant="body2" sx={{ color: '#444', fontSize: '0.6rem' }}>--</Typography>
                  )}
                </TableCell>
                <TableCell>
                  {card.regime && (
                    <GlossaryTooltip term={card.regime === 'markup' ? 'uptrend' : card.regime === 'markdown' ? 'downtrend' : card.regime}>
                    <Chip
                      label={REGIME_LABELS[card.regime] || card.regime}
                      size="small"
                      sx={{
                        bgcolor: 'transparent',
                        border: `1px solid ${regimeColor}`,
                        color: regimeColor,
                        fontSize: '0.5rem',
                        height: 18,
                      }}
                    />
                    </GlossaryTooltip>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function Screener() {
  const [cards, setCards] = useState<ScreenerCard[]>([]);
  const [stats, setStats] = useState<ScreenerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [simpleMode, setSimpleMode] = useState<boolean>(() => {
    const stored = localStorage.getItem('pkmn_screener_mode');
    return stored === null ? true : stored === 'simple';
  });

  const handleSimpleModeToggle = (checked: boolean) => {
    setSimpleMode(checked);
    localStorage.setItem('pkmn_screener_mode', checked ? 'simple' : 'advanced');
  };

  // Filters
  const [minLiquidity, setMinLiquidity] = useState(0);
  const [minAppreciation, setMinAppreciation] = useState(0);
  const [regime, setRegime] = useState('');
  const [minPrice, setMinPrice] = useState(10);
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [sortBy, setSortBy] = useState('investment_score');
  const [sortDir, setSortDir] = useState('desc');
  const [search, setSearch] = useState('');
  const [minVelocity, setMinVelocity] = useState(0);
  const [investmentGradeOnly, setInvestmentGradeOnly] = useState(false);
  const [flipFinderActive, setFlipFinderActive] = useState(false);

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
      // Investment Grade preset overrides individual liquidity/appreciation filters
      if (investmentGradeOnly) {
        params.min_liquidity = '30';
        params.min_appreciation = '40';
      } else {
        if (minLiquidity > 0) params.min_liquidity = String(minLiquidity);
        if (minAppreciation > 0) params.min_appreciation = String(minAppreciation);
      }
      if (regime) params.regime = regime;
      if (maxPrice !== '' && Number(maxPrice) > 0) params.max_price = maxPrice;
      if (search) params.q = search;
      if (minVelocity > 0) params.min_velocity = String(minVelocity);

      const result = await api.getScreenerCards(params);
      setCards(result.data);
      setTotal(result.total);
      setTotalPages(result.total_pages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortDir, minLiquidity, minAppreciation, regime, minPrice, maxPrice, search, minVelocity, investmentGradeOnly]);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  // Debounced search using ref to avoid stale closure issues
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleSearchChange = (value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 300);
  };
  useEffect(() => {
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, []);

  const handleTableSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
    setPage(1);
  };

  const activateFlipFinder = () => {
    setFlipFinderActive(true);
    setInvestmentGradeOnly(false);
    setSortBy('liquidity_score');
    setSortDir('desc');
    setMinLiquidity(30);
    setMinVelocity(0.5);
    setMinAppreciation(0);
    setRegime('');
    setMinPrice(2);
    setMaxPrice('');
    setSearch('');
    setPage(1);
  };

  const clearAllFilters = () => {
    setFlipFinderActive(false);
    setInvestmentGradeOnly(false);
    setMinLiquidity(0);
    setMinAppreciation(0);
    setRegime('');
    setMinPrice(10);
    setMaxPrice('');
    setSortBy('investment_score');
    setSortDir('desc');
    setSearch('');
    setMinVelocity(0);
    setPage(1);
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

      {/* Simple / Advanced Mode Toggle */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography variant="body2" sx={{ color: simpleMode ? '#666' : '#00ff41', fontSize: '0.75rem', fontWeight: simpleMode ? 400 : 700 }}>
          Advanced
        </Typography>
        <Switch
          checked={simpleMode}
          onChange={(e) => handleSimpleModeToggle(e.target.checked)}
          size="small"
          sx={{
            '& .MuiSwitch-switchBase.Mui-checked': { color: '#00bcd4' },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#00bcd4' },
            '& .MuiSwitch-track': { bgcolor: '#333' },
          }}
        />
        <Typography variant="body2" sx={{ color: simpleMode ? '#00bcd4' : '#666', fontSize: '0.75rem', fontWeight: simpleMode ? 700 : 400 }}>
          Simple
        </Typography>
        {simpleMode && (
          <Typography variant="body2" sx={{ color: '#555', fontSize: '0.65rem', ml: 1 }}>
            Showing simplified view — toggle Advanced for full data
          </Typography>
        )}
      </Box>

      {/* Stats */}
      {!simpleMode && <StatsBar stats={stats} />}

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <FilterListIcon sx={{ color: '#666', fontSize: 18 }} />
          <Typography variant="body2" sx={{ color: '#888', fontWeight: 600 }}>FILTERS</Typography>
          {simpleMode && (
            <Typography variant="body2" sx={{ color: '#555', fontSize: '0.6rem' }}>
              (Search + price only — switch to Advanced for more)
            </Typography>
          )}
          {!simpleMode && (
            <Chip
              icon={<MonetizationOnIcon sx={{ fontSize: 14, color: flipFinderActive ? '#000' : '#00ff41' }} />}
              label="FLIP FINDER"
              size="small"
              onClick={() => { if (flipFinderActive) { clearAllFilters(); } else { activateFlipFinder(); } }}
              sx={{
                bgcolor: flipFinderActive ? '#00ff41' : 'transparent',
                color: flipFinderActive ? '#000' : '#00ff41',
                border: '1px solid #00ff41',
                fontWeight: 700,
                fontSize: '0.6rem',
                height: 24,
                cursor: 'pointer',
                '&:hover': { bgcolor: flipFinderActive ? '#00cc33' : '#00ff4118' },
              }}
            />
          )}
          {!simpleMode && (
            <Chip
              label="Investment Grade"
              size="small"
              onClick={() => { setInvestmentGradeOnly(!investmentGradeOnly); setFlipFinderActive(false); setPage(1); }}
              sx={{
                bgcolor: investmentGradeOnly ? '#00ff41' : 'transparent',
                color: investmentGradeOnly ? '#000' : '#00ff41',
                border: '1px solid #00ff41',
                fontWeight: 600,
                fontSize: '0.6rem',
                height: 24,
                cursor: 'pointer',
              }}
            />
          )}
          {(flipFinderActive || investmentGradeOnly || minLiquidity > 0 || minAppreciation > 0 || regime || minVelocity > 0 || minPrice !== 10 || maxPrice !== '' || search) && (
            <Chip
              icon={<ClearIcon sx={{ fontSize: 14, color: '#ff1744' }} />}
              label="CLEAR FILTERS"
              size="small"
              onClick={clearAllFilters}
              sx={{
                bgcolor: 'transparent',
                color: '#ff1744',
                border: '1px solid #ff174466',
                fontWeight: 600,
                fontSize: '0.6rem',
                height: 24,
                cursor: 'pointer',
                '&:hover': { bgcolor: '#ff174418' },
              }}
            />
          )}
        </Box>
        {!simpleMode && flipFinderActive && (
          <Box sx={{ mb: 1.5, p: 1, bgcolor: '#00ff4110', border: '1px solid #00ff4133', borderRadius: 1 }}>
            <Typography variant="body2" sx={{ color: '#00ff41', fontSize: '0.65rem', fontWeight: 600 }}>
              <MonetizationOnIcon sx={{ fontSize: 13, mr: 0.5, verticalAlign: 'middle' }} />
              Showing cards where you can buy below median sale price with decent sales velocity. Min 0.5 sales/day, liquidity 30+.
            </Typography>
          </Box>
        )}
        <Grid container spacing={2} alignItems="center">
          {/* Search */}
          <Grid size={{ xs: 12, sm: 6, md: simpleMode ? 6 : 3 }}>
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

          {/* Min Price — always visible */}
          <Grid size={{ xs: 3, sm: 2, md: simpleMode ? 3 : 1 }}>
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

          {/* Max Price — always visible */}
          <Grid size={{ xs: 3, sm: 2, md: simpleMode ? 3 : 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Max $</InputLabel>
              <Select
                value={maxPrice}
                label="Max $"
                onChange={(e) => { setMaxPrice(String(e.target.value)); setPage(1); }}
              >
                <MenuItem value="">No max</MenuItem>
                <MenuItem value="25">$25</MenuItem>
                <MenuItem value="50">$50</MenuItem>
                <MenuItem value="100">$100</MenuItem>
                <MenuItem value="250">$250</MenuItem>
                <MenuItem value="500">$500</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Advanced-only filters */}
          {!simpleMode && (
            <>
              {/* Min Liquidity */}
              <Grid size={{ xs: 6, sm: 3, md: 2 }}>
                <Typography variant="body2" sx={{ color: '#888', fontSize: '0.6rem', mb: 0.5 }}>
                  <WaterDropIcon sx={{ fontSize: 12, mr: 0.3, verticalAlign: 'middle' }} />
                  Min <GlossaryTooltip term="liquidity_score">Liquidity</GlossaryTooltip>: {minLiquidity}
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
                  Min <GlossaryTooltip term="appreciation_slope">Appreciation</GlossaryTooltip>: {minAppreciation}
                </Typography>
                <Slider
                  value={minAppreciation}
                  onChange={(_, v) => { setMinAppreciation(v as number); setPage(1); }}
                  min={0} max={100} step={5}
                  size="small"
                  sx={{ color: '#ff9800' }}
                />
              </Grid>

              {/* Min Velocity */}
              <Grid size={{ xs: 6, sm: 3, md: 2 }}>
                <Typography variant="body2" sx={{ color: '#888', fontSize: '0.6rem', mb: 0.5 }}>
                  Min Velocity: {minVelocity} sales/day
                </Typography>
                <Slider
                  value={minVelocity}
                  onChange={(_, v) => { setMinVelocity(v as number); setPage(1); }}
                  min={0} max={5} step={0.5}
                  size="small"
                  sx={{ color: '#e040fb' }}
                />
              </Grid>

              {/* Regime */}
              <Grid size={{ xs: 6, sm: 3, md: 1.5 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel><GlossaryTooltip term="regime">Regime</GlossaryTooltip></InputLabel>
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
              <Grid size={{ xs: 6, sm: 3, md: 1.5 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Sort By</InputLabel>
                  <Select
                    value={sortBy}
                    label="Sort By"
                    onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                  >
                    <MenuItem value="investment_score"><GlossaryTooltip term="investment_score">Investment Score</GlossaryTooltip></MenuItem>
                    <MenuItem value="liquidity_score"><GlossaryTooltip term="liquidity_score">Liquidity</GlossaryTooltip></MenuItem>
                    <MenuItem value="appreciation_score"><GlossaryTooltip term="appreciation_slope">Appreciation</GlossaryTooltip></MenuItem>
                    <MenuItem value="appreciation_consistency"><GlossaryTooltip term="appreciation_consistency">Consistency (R²)</GlossaryTooltip></MenuItem>
                    <MenuItem value="appreciation_slope"><GlossaryTooltip term="appreciation_slope">Daily Growth</GlossaryTooltip></MenuItem>
                    <MenuItem value="current_price">Price</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}
        </Grid>
      </Paper>

      {/* Results count + view toggle */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" sx={{ color: '#666' }}>
          {total.toLocaleString()} cards
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
            size="small"
            sx={{ '& .MuiToggleButton-root': { color: '#666', borderColor: '#333', p: 0.5 }, '& .Mui-selected': { color: '#00ff41 !important', bgcolor: '#111 !important' } }}
          >
            <ToggleButton value="grid"><ViewModuleIcon sx={{ fontSize: 18 }} /></ToggleButton>
            <ToggleButton value="table"><ViewListIcon sx={{ fontSize: 18 }} /></ToggleButton>
          </ToggleButtonGroup>
          <FormControl size="small" sx={{ minWidth: 100 }}>
            <Select
              value={sortDir}
              onChange={(e) => { setSortDir(e.target.value); setPage(1); }}
              size="small"
              sx={{ fontSize: '0.75rem' }}
            >
              <MenuItem value="desc">High to Low</MenuItem>
              <MenuItem value="asc">Low to High</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Card Grid or Table */}
      {loading ? (
        viewMode === 'grid' ? (
          <Grid container spacing={1.5}>
            {Array.from({ length: 12 }).map((_, i) => (
              <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={i}>
                <Skeleton variant="rounded" height={380} sx={{ bgcolor: '#1a1a1a' }} />
              </Grid>
            ))}
          </Grid>
        ) : (
          <Skeleton variant="rounded" height={400} sx={{ bgcolor: '#1a1a1a' }} />
        )
      ) : cards.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: '#0a0a0a' }}>
          <Typography variant="body1" sx={{ color: '#666' }}>
            No cards match your filters. Try lowering the minimum scores or wait for metrics to be computed.
          </Typography>
          <Typography variant="body2" sx={{ color: '#444', mt: 1, fontSize: '0.7rem' }}>
            Investment metrics are computed during background sync (every 48 hours) or can be triggered manually.
          </Typography>
        </Paper>
      ) : viewMode === 'grid' ? (
        <Grid container spacing={1.5}>
          {cards.map((card, idx) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={card.id}>
              {simpleMode ? (
                <SimpleCardTile card={card} />
              ) : (
                <CardTile card={card} rank={(page - 1) * 48 + idx + 1} />
              )}
            </Grid>
          ))}
        </Grid>
      ) : simpleMode ? (
        <SimpleCardTable cards={cards} page={page} onSort={handleTableSort} sortBy={sortBy} sortDir={sortDir} />
      ) : (
        <CardTable cards={cards} page={page} onSort={handleTableSort} sortBy={sortBy} sortDir={sortDir} />
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
