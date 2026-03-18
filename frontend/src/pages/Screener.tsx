import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Paper, Typography, Grid, Avatar, Chip, LinearProgress,
  Pagination, Select, MenuItem, FormControl, InputLabel, Slider,
  Tooltip, Skeleton, TextField, InputAdornment, ToggleButtonGroup, ToggleButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  Switch, IconButton, CircularProgress, Collapse,
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
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import StyleIcon from '@mui/icons-material/Style';
import { useNavigate } from 'react-router-dom';
import { api, ScreenerCard, ScreenerStats, SetAnalytics } from '../services/api';
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

const REGIME_LABELS_SIMPLE: Record<string, string> = {
  markup: 'Rising in value',
  accumulation: 'Building momentum',
  distribution: 'Cooling off',
  markdown: 'Dropping in value',
  unknown: 'Unknown',
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

function calcFlipProfit(card: ScreenerCard): number | null {
  if (card.median_sold == null || card.current_price == null) return null;
  // 12.55% seller fees
  return card.median_sold - (card.current_price * 1.1255);
}

function calcFlipROI(card: ScreenerCard): number | null {
  const profit = calcFlipProfit(card);
  if (profit === null || card.current_price == null || card.current_price === 0) return null;
  return (profit / card.current_price) * 100;
}

function SimpleCardTile({ card, flipFinderActive }: { card: ScreenerCard; flipFinderActive?: boolean }) {
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

      {/* Flip profit (shown when Flip Finder is active) */}
      {(() => {
        const profit = calcFlipProfit(card);
        const roi = calcFlipROI(card);
        if (profit === null) return null;
        return (
          <>
          <Typography variant="body2" sx={{
            fontSize: '0.65rem',
            fontWeight: 600,
            color: '#888',
            mt: 0.2,
          }}>
            Buy for <span style={{ color: '#00bcd4', fontFamily: 'monospace' }}>${card.current_price.toFixed(2)}</span>, sells for <span style={{ color: '#00ff41', fontFamily: 'monospace' }}>~${card.median_sold?.toFixed(2)}</span>
          </Typography>
          <Typography variant="body2" sx={{
            fontSize: '0.65rem',
            fontWeight: 700,
            fontFamily: 'monospace',
            color: profit >= 0 ? '#00ff41' : '#ff1744',
            mt: 0.2,
          }}>
            {profit >= 0 ? '+' : ''}${profit.toFixed(2)}{roi !== null && ` (${roi >= 0 ? '+' : ''}${roi.toFixed(0)}% ROI)`}
          </Typography>
          </>
        );
      })()}

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

      {/* Value badge + Regime */}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5, alignItems: 'center' }}>
        <Chip
          label={badge.label}
          size="small"
          sx={{
            bgcolor: badge.bgcolor,
            color: badge.color,
            fontWeight: 700,
            fontSize: '0.65rem',
            height: 22,
          }}
        />
        {card.regime && (
          <Chip
            label={REGIME_LABELS_SIMPLE[card.regime] || card.regime}
            size="small"
            sx={{
              bgcolor: 'transparent',
              border: `1px solid ${REGIME_COLORS[card.regime || 'unknown'] || '#666'}`,
              color: REGIME_COLORS[card.regime || 'unknown'] || '#666',
              fontSize: '0.55rem',
              height: 20,
            }}
          />
        )}
      </Box>
    </Paper>
  );
}

function CardTile({ card, rank, flipFinderActive }: { card: ScreenerCard; rank: number; flipFinderActive?: boolean }) {
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

      {/* Flip profit (shown when Flip Finder is active) */}
      {(() => {
        const profit = calcFlipProfit(card);
        const roi = calcFlipROI(card);
        if (profit === null) return null;
        return (
          <Typography variant="body2" sx={{
            fontSize: '0.65rem',
            fontFamily: 'monospace',
            fontWeight: 600,
            color: profit >= 0 ? '#00ff41' : '#ff1744',
            mt: 0.2,
          }}>
            {profit >= 0 ? '+' : ''}${profit.toFixed(2)}{roi !== null && ` (${roi >= 0 ? '+' : ''}${roi.toFixed(0)}% ROI)`}
          </Typography>
        );
      })()}

      {/* Time to sell + Velocity */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <TimeToSellBadge value={card.time_to_sell} />
        {card.sales_per_day != null && (
          <GlossaryTooltip term="sales_per_day">
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
          </GlossaryTooltip>
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

function SimpleCardTable({ cards, page, onSort, sortBy, sortDir, flipFinderActive }: {
  cards: ScreenerCard[];
  page: number;
  onSort: (col: string) => void;
  sortBy: string;
  sortDir: string;
  flipFinderActive?: boolean;
}) {
  const navigate = useNavigate();
  const baseColumns: { id: string; label: string; width?: number; sortable?: boolean; glossary?: string }[] = [
    { id: 'rank', label: '#', width: 40 },
    { id: 'name', label: 'Card', sortable: true },
    { id: 'current_price', label: 'Price', width: 80, sortable: true },
    { id: 'trend', label: '7d Trend', width: 90 },
    { id: 'good_buy', label: 'Good Buy?', width: 90 },
  ];
  const columns = flipFinderActive
    ? [
        ...baseColumns.slice(0, 3),
        { id: 'est_profit', label: 'Est. Profit', width: 90, glossary: 'flip_profit' },
        { id: 'roi_pct', label: 'ROI%', width: 70 },
        { id: 'spread_pct', label: 'Spread', width: 70 },
        ...baseColumns.slice(3),
      ]
    : baseColumns;

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
                {(() => {
                  const profit = calcFlipProfit(card);
                  const roi = calcFlipROI(card);
                  const spreadPct = card.median_sold != null && card.median_sold > 0
                    ? ((card.current_price - card.median_sold) / card.median_sold * 100)
                    : null;
                  return (
                    <>
                    <TableCell sx={{ fontSize: '0.7rem' }}>
                      {profit !== null ? (
                        <span style={{ color: '#888' }}>
                          Sells for <span style={{ color: '#00ff41', fontFamily: 'monospace', fontWeight: 700 }}>~${card.median_sold?.toFixed(2)}</span>
                        </span>
                      ) : '--'}
                    </TableCell>
                    <TableCell sx={{
                      fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 700,
                      color: roi !== null ? (roi >= 0 ? '#00ff41' : '#ff1744') : '#444',
                    }}>
                      {roi !== null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(0)}%` : '--'}
                    </TableCell>
                    <TableCell sx={{
                      fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700,
                      color: spreadPct !== null ? (spreadPct <= 0 ? '#00ff41' : '#ff1744') : '#444',
                    }}>
                      {spreadPct !== null ? `${spreadPct >= 0 ? '+' : ''}${Math.abs(spreadPct) > 999 ? '>999%' : spreadPct.toFixed(1) + '%'}` : '--'}
                    </TableCell>
                    </>
                  );
                })()}
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

function CardTable({ cards, page, onSort, sortBy, sortDir, flipFinderActive }: {
  cards: ScreenerCard[];
  page: number;
  onSort: (col: string) => void;
  sortBy: string;
  sortDir: string;
  flipFinderActive?: boolean;
}) {
  const navigate = useNavigate();
  const baseColumns: { id: string; label: string; width?: number; glossary?: string }[] = [
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
  // Always show Est. Profit, ROI%, and Spread columns after Price
  const columns = [
    ...baseColumns.slice(0, 3),
    { id: 'est_profit', label: 'Est. Profit', width: 85, glossary: 'flip_profit' },
    { id: 'roi_pct', label: 'ROI%', width: 65 },
    { id: 'spread_pct', label: 'Spread', width: 65 },
    ...baseColumns.slice(3),
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
                {(() => {
                  const profit = calcFlipProfit(card);
                  const roi = calcFlipROI(card);
                  const spreadPct = card.median_sold != null && card.median_sold > 0
                    ? ((card.current_price - card.median_sold) / card.median_sold * 100)
                    : null;
                  return (
                    <>
                    <TableCell sx={{
                      fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 700,
                      color: profit !== null ? (profit >= 0 ? '#00ff41' : '#ff1744') : '#444',
                    }}>
                      {profit !== null ? `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}` : '--'}
                    </TableCell>
                    <TableCell sx={{
                      fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 700,
                      color: roi !== null ? (roi >= 0 ? '#00ff41' : '#ff1744') : '#444',
                    }}>
                      {roi !== null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(0)}%` : '--'}
                    </TableCell>
                    <TableCell sx={{
                      fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700,
                      color: spreadPct !== null ? (spreadPct <= 0 ? '#00ff41' : '#ff1744') : '#444',
                    }}>
                      {spreadPct !== null ? `${spreadPct >= 0 ? '+' : ''}${Math.abs(spreadPct) > 999 ? '>999%' : spreadPct.toFixed(1) + '%'}` : '--'}
                    </TableCell>
                    </>
                  );
                })()}
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
    // Clean old keys from previous versions
    ['pkmn_screener_mode', 'pkmn_screener_mode_v2', 'pkmn_screener_mode_v3', 'pkmn_screener_mode_v4', 'pkmn_screener_mode_v5'].forEach(k => localStorage.removeItem(k));
    const stored = localStorage.getItem('pkmn_screener_mode_v6');
    // First visit: default to Simple. After that, remember choice.
    return stored === null ? true : stored === 'simple';
  });

  const handleSimpleModeToggle = (checked: boolean) => {
    setSimpleMode(checked);
    localStorage.setItem('pkmn_screener_mode_v6', checked ? 'simple' : 'advanced');
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
  const [flipSortMode, setFlipSortMode] = useState<'profit' | 'roi'>('profit');
  // Set Analytics
  const [setAnalytics, setSetAnalytics] = useState<SetAnalytics[]>([]);
  const [setAnalyticsOpen, setSetAnalyticsOpen] = useState(false);
  // Ref mirrors flipFinderActive to avoid stale closures in fetchCards
  const flipFinderRef = useRef(false);

  useEffect(() => {
    document.title = 'Screener | PKMN Trader';
    api.getScreenerStats().then(setStats).catch(console.error);
    api.getSetAnalytics().then(setSetAnalytics).catch(console.error);
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, []);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      // When Flip Finder is active, always use its preset values
      // regardless of what individual filter state says (prevents drift)
      const isFlip = flipFinderRef.current;
      const effectiveSortBy = isFlip ? 'est_profit' : sortBy;
      const effectiveSortDir = isFlip ? 'desc' : sortDir;
      const effectiveMinPrice = isFlip ? 2 : minPrice;
      const effectiveMinLiquidity = isFlip ? 30 : minLiquidity;
      const effectiveMinVelocity = isFlip ? 0.5 : minVelocity;
      const effectiveMinAppreciation = isFlip ? 0 : minAppreciation;
      const effectiveRegime = isFlip ? '' : regime;
      const effectiveMaxPrice = isFlip ? '' : maxPrice;
      const effectiveSearch = isFlip ? '' : search;

      // ROI% sort is client-side only — send est_profit to backend as proxy
      const needsClientSort = effectiveSortBy === 'roi';
      const needsFullFetch = isFlip && flipSortMode === 'roi';
      const params: Record<string, string> = {
        page: needsFullFetch ? '1' : String(page),
        page_size: needsFullFetch ? '200' : '48',
        sort_by: needsClientSort ? 'est_profit' : effectiveSortBy,
        sort_dir: effectiveSortDir,
        min_price: String(effectiveMinPrice),
      };
      // Investment Grade preset overrides individual liquidity/appreciation filters
      if (!isFlip && investmentGradeOnly) {
        params.min_liquidity = '30';
        params.min_appreciation = '40';
      } else {
        if (effectiveMinLiquidity > 0) params.min_liquidity = String(effectiveMinLiquidity);
        if (effectiveMinAppreciation > 0) params.min_appreciation = String(effectiveMinAppreciation);
      }
      if (effectiveRegime) params.regime = effectiveRegime;
      if (effectiveMaxPrice !== '' && Number(effectiveMaxPrice) > 0) params.max_price = effectiveMaxPrice;
      if (effectiveSearch) params.q = effectiveSearch;
      if (effectiveMinVelocity > 0) params.min_velocity = String(effectiveMinVelocity);
      if (isFlip) {
        params.min_profit = '0.01';
        params.exclude_regime = 'markdown';
      }

      const result = await api.getScreenerCards(params);
      // Flip Finder: filter out DOWNTREND cards
      if (isFlip) {
        result.data = result.data.filter(c => c.regime !== 'markdown');
      }
      // Client-side ROI% sort (used both in Flip Finder ROI mode and regular ROI% sort)
      if (needsClientSort || (isFlip && flipSortMode === 'roi')) {
        const descending = effectiveSortDir !== 'asc';
        result.data.sort((a, b) => {
          const roiA = a.current_price > 0 && a.est_profit != null ? (a.est_profit / a.current_price) * 100 : -Infinity;
          const roiB = b.current_price > 0 && b.est_profit != null ? (b.est_profit / b.current_price) * 100 : -Infinity;
          return descending ? (roiB - roiA) : (roiA - roiB);
        });
      }
      setCards(result.data);
      setTotal(result.total);
      setTotalPages(result.total_pages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortDir, minLiquidity, minAppreciation, regime, minPrice, maxPrice, search, minVelocity, investmentGradeOnly, flipSortMode]);

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
    flipFinderRef.current = true;
    setFlipFinderActive(true);
    setFlipSortMode('profit');
    setInvestmentGradeOnly(false);
    setSortBy('est_profit');
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
    flipFinderRef.current = false;
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
          {simpleMode ? 'FIND VALUABLE CARDS' : 'INVESTMENT SCREENER'}
        </Typography>
      </Box>
      {simpleMode ? (
        <Typography variant="body2" sx={{ color: '#666', mb: 2, fontSize: '0.7rem' }}>
          Search through thousands of Pokemon cards ranked by investment potential.
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ color: '#666', mb: 2, fontSize: '0.7rem' }}>
          Find cards that are consistently liquid AND have steady price appreciation. Sorted by combined investment score.
        </Typography>
      )}

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
          Simple View
        </Typography>
        {simpleMode && (
          <Typography variant="body2" sx={{ color: '#555', fontSize: '0.65rem', ml: 1 }}>
            Showing simplified view — toggle Advanced for full data
          </Typography>
        )}
      </Box>

      {/* Simple mode explanation banner */}
      {simpleMode && (
        <Paper sx={{ p: 1.5, mb: 2, bgcolor: '#0a1a1a', border: '1px solid #00bcd433', borderRadius: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="caption" sx={{ color: '#888' }}>
              {flipFinderActive
                ? 'These cards can be bought and resold for profit. The profit shown is after seller fees (12.55%).'
                : 'Find cards that are good investments \u2014 liquid (easy to sell) and trending up in price.'}
            </Typography>
            {flipFinderActive && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography sx={{ color: '#888', fontSize: '0.6rem', fontFamily: 'monospace', mr: 0.5 }}>Sort:</Typography>
                <Chip
                  label="Profit"
                  size="small"
                  onClick={() => { setFlipSortMode('profit'); setPage(1); }}
                  sx={{
                    height: 22, fontSize: '0.6rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700,
                    bgcolor: flipSortMode === 'profit' ? '#00ff41' : 'transparent',
                    color: flipSortMode === 'profit' ? '#000' : '#00ff41',
                    border: '1px solid #00ff4155',
                    '&:hover': { bgcolor: flipSortMode === 'profit' ? '#00cc33' : '#00ff4118' },
                  }}
                />
                <Chip
                  label="ROI%"
                  size="small"
                  onClick={() => { setFlipSortMode('roi'); setPage(1); }}
                  sx={{
                    height: 22, fontSize: '0.6rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700,
                    bgcolor: flipSortMode === 'roi' ? '#00ff41' : 'transparent',
                    color: flipSortMode === 'roi' ? '#000' : '#00ff41',
                    border: '1px solid #00ff4155',
                    '&:hover': { bgcolor: flipSortMode === 'roi' ? '#00cc33' : '#00ff4118' },
                  }}
                />
              </Box>
            )}
          </Box>
        </Paper>
      )}

      {/* Stats */}
      {!simpleMode && <StatsBar stats={stats} />}

      {/* Set Analytics */}
      {setAnalytics.length > 0 && (
        <Paper sx={{ mb: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a', overflow: 'hidden' }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, cursor: 'pointer', '&:hover': { bgcolor: '#111' } }}
            onClick={() => setSetAnalyticsOpen(!setAnalyticsOpen)}
          >
            <StyleIcon sx={{ color: '#ff9800', fontSize: 18 }} />
            <Typography variant="body2" sx={{ color: '#ff9800', fontWeight: 700, fontSize: '0.75rem' }}>
              SET ANALYTICS
            </Typography>
            <Typography variant="body2" sx={{ color: '#555', fontSize: '0.65rem' }}>
              ({setAnalytics.length} sets)
            </Typography>
            <Box sx={{ ml: 'auto' }}>
              {setAnalyticsOpen ? <ExpandLessIcon sx={{ color: '#666', fontSize: 18 }} /> : <ExpandMoreIcon sx={{ color: '#666', fontSize: 18 }} />}
            </Box>
          </Box>
          <Collapse in={setAnalyticsOpen}>
            <Box sx={{
              display: 'flex', gap: 1.5, overflowX: 'auto', p: 1.5, pt: 0,
              '&::-webkit-scrollbar': { height: 6 },
              '&::-webkit-scrollbar-thumb': { bgcolor: '#333', borderRadius: 3 },
            }}>
              {setAnalytics.map((s) => (
                <Paper
                  key={s.set_name}
                  sx={{
                    minWidth: 200, maxWidth: 220, p: 1.5, bgcolor: '#111', border: '1px solid #222',
                    cursor: 'pointer', flexShrink: 0, transition: 'border-color 0.2s',
                    '&:hover': { borderColor: '#ff9800' },
                  }}
                  onClick={() => {
                    setSearch(s.set_name);
                    setPage(1);
                    setSetAnalyticsOpen(false);
                  }}
                >
                  <Typography variant="body2" sx={{ color: '#e0e0e0', fontWeight: 700, fontSize: '0.7rem', mb: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.set_name}
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                    <Typography variant="body2" sx={{ color: '#888', fontSize: '0.6rem' }}>Cards</Typography>
                    <Typography variant="body2" sx={{ color: '#e0e0e0', fontSize: '0.6rem', fontFamily: 'monospace' }}>{s.card_count}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                    <Typography variant="body2" sx={{ color: '#888', fontSize: '0.6rem' }}>Avg Price</Typography>
                    <Typography variant="body2" sx={{ color: '#00ff41', fontSize: '0.6rem', fontFamily: 'monospace' }}>${s.avg_price.toFixed(2)}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                    <Typography variant="body2" sx={{ color: '#888', fontSize: '0.6rem' }}>Total Value</Typography>
                    <Typography variant="body2" sx={{ color: '#00bcd4', fontSize: '0.6rem', fontFamily: 'monospace' }}>${s.total_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Typography>
                  </Box>
                  {s.avg_7d_change !== null && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ color: '#888', fontSize: '0.6rem' }}>7d Trend</Typography>
                      <Typography variant="body2" sx={{
                        color: s.avg_7d_change >= 0 ? '#00ff41' : '#ff1744',
                        fontSize: '0.6rem', fontFamily: 'monospace', fontWeight: 700,
                      }}>
                        {s.avg_7d_change >= 0 ? '+' : ''}{s.avg_7d_change.toFixed(2)}%
                      </Typography>
                    </Box>
                  )}
                </Paper>
              ))}
            </Box>
          </Collapse>
        </Paper>
      )}

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
          <FilterListIcon sx={{ color: '#666', fontSize: 18 }} />
          <Typography variant="body2" sx={{ color: '#888', fontWeight: 600 }}>FILTERS</Typography>
          {simpleMode && !flipFinderActive && (
            <Typography variant="body2" sx={{ color: '#555', fontSize: '0.6rem' }}>
              (Search + price only — switch to Advanced for more)
            </Typography>
          )}
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
          {!simpleMode && (
            <Chip
              label="Investment Grade"
              size="small"
              onClick={() => { setInvestmentGradeOnly(!investmentGradeOnly); flipFinderRef.current = false; setFlipFinderActive(false); setPage(1); }}
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
          <Box sx={{ mb: 1.5, p: 1.5, bgcolor: '#00ff4118', border: '2px solid #00ff4166', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2" sx={{ color: '#00ff41', fontSize: '0.75rem', fontWeight: 700 }}>
              <MonetizationOnIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }} />
              FLIP FINDER ACTIVE — Profitable flips only (after 12.55% fees, min 0.5 sales/day)
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ color: '#888', fontSize: '0.6rem', fontFamily: 'monospace', mr: 0.5 }}>Sort by:</Typography>
              <Chip
                label="Profit"
                size="small"
                onClick={() => { setFlipSortMode('profit'); setPage(1); }}
                sx={{
                  height: 22, fontSize: '0.6rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700,
                  bgcolor: flipSortMode === 'profit' ? '#00ff41' : 'transparent',
                  color: flipSortMode === 'profit' ? '#000' : '#00ff41',
                  border: '1px solid #00ff4155',
                  '&:hover': { bgcolor: flipSortMode === 'profit' ? '#00cc33' : '#00ff4118' },
                }}
              />
              <Chip
                label="ROI%"
                size="small"
                onClick={() => { setFlipSortMode('roi'); setPage(1); }}
                sx={{
                  height: 22, fontSize: '0.6rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700,
                  bgcolor: flipSortMode === 'roi' ? '#00ff41' : 'transparent',
                  color: flipSortMode === 'roi' ? '#000' : '#00ff41',
                  border: '1px solid #00ff4155',
                  '&:hover': { bgcolor: flipSortMode === 'roi' ? '#00cc33' : '#00ff4118' },
                }}
              />
            </Box>
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
            {simpleMode && <Typography variant="caption" sx={{ color: '#888', fontSize: '0.55rem', mt: 0.3, display: 'block' }}>Skip cheap cards</Typography>}
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
                  Min <GlossaryTooltip term="sales_per_day">Velocity</GlossaryTooltip>: {minVelocity} sales/day
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
                <FormControl size="small" fullWidth disabled={flipFinderActive}>
                  <InputLabel>{flipFinderActive ? 'Sorted by Profit' : 'Sort By'}</InputLabel>
                  <Select
                    value={flipFinderActive ? 'est_profit' : sortBy}
                    label={flipFinderActive ? 'Sorted by Profit' : 'Sort By'}
                    onChange={(e) => { if (!flipFinderActive) { setSortBy(e.target.value); setPage(1); } }}
                  >
                    <MenuItem value="investment_score"><GlossaryTooltip term="investment_score">Investment Score</GlossaryTooltip></MenuItem>
                    <MenuItem value="est_profit">Profit (Est.)</MenuItem>
                    <MenuItem value="roi">ROI %</MenuItem>
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={14} sx={{ color: '#00ff41' }} />
              <Typography variant="body2" sx={{ color: '#666' }}>
                Loading cards...
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" sx={{ color: '#666' }}>
              {total.toLocaleString()} cards
            </Typography>
          )}
          {cards.length > 0 && (
            <Tooltip title="Export current page as CSV">
              <IconButton
                size="small"
                onClick={() => {
                  const headers = ['Name', 'Set', 'Price', 'Investment Score', 'Liquidity', 'Appreciation', 'Regime', 'Est Profit', 'ROI%', 'Velocity'];
                  const rows = cards.map(c => [
                    `"${c.name}"`, `"${c.set_name}"`, c.current_price?.toFixed(2) ?? '',
                    c.investment_score?.toFixed(1) ?? '', c.liquidity_score?.toFixed(1) ?? '',
                    c.appreciation_score?.toFixed(1) ?? '', c.regime ?? '',
                    c.est_profit?.toFixed(2) ?? '',
                    c.est_profit != null && c.current_price > 0 ? ((c.est_profit / c.current_price) * 100).toFixed(1) : '',
                    c.sales_per_day?.toFixed(2) ?? '',
                  ]);
                  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url;
                  a.download = `screener_${new Date().toISOString().slice(0,10)}.csv`;
                  a.click(); URL.revokeObjectURL(url);
                }}
                sx={{ color: '#666', '&:hover': { color: '#00ff41' } }}
              >
                <DownloadIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
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
          <Paper sx={{ bgcolor: '#0a0a0a', border: '1px solid #1a1a1a', overflow: 'hidden' }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, borderBottom: '1px solid #1a1a1a' }}>
                <Skeleton variant="rounded" width={28} height={38} sx={{ bgcolor: '#1a1a1a', flexShrink: 0 }} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width={`${40 + Math.random() * 30}%`} sx={{ bgcolor: '#1a1a1a', fontSize: '0.75rem' }} />
                  <Skeleton variant="text" width={`${20 + Math.random() * 20}%`} sx={{ bgcolor: '#151515', fontSize: '0.6rem' }} />
                </Box>
                <Skeleton variant="text" width={50} sx={{ bgcolor: '#1a1a1a', fontSize: '0.75rem' }} />
                <Skeleton variant="text" width={40} sx={{ bgcolor: '#1a1a1a', fontSize: '0.75rem' }} />
                <Skeleton variant="text" width={40} sx={{ bgcolor: '#1a1a1a', fontSize: '0.75rem' }} />
              </Box>
            ))}
          </Paper>
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
                <SimpleCardTile card={card} flipFinderActive={flipFinderActive} />
              ) : (
                <CardTile card={card} rank={(page - 1) * 48 + idx + 1} flipFinderActive={flipFinderActive} />
              )}
            </Grid>
          ))}
        </Grid>
      ) : simpleMode ? (
        <SimpleCardTable cards={cards} page={page} onSort={handleTableSort} sortBy={sortBy} sortDir={sortDir} flipFinderActive={flipFinderActive} />
      ) : (
        <CardTable cards={cards} page={page} onSort={handleTableSort} sortBy={sortBy} sortDir={sortDir} flipFinderActive={flipFinderActive} />
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
