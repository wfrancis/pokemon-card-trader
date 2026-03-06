import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Divider,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import RemoveIcon from '@mui/icons-material/Remove';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ScienceIcon from '@mui/icons-material/Science';
import { api } from '../services/api';
import type { CardIndicator, AISignalsResponse, QuickBacktestResult, SignalJobStatus } from '../services/api';

const mono = { fontFamily: '"JetBrains Mono", "Fira Code", monospace' };

type SvgIconComponent = typeof TrendingUpIcon;

const SIGNAL_CONFIG: Record<string, { bg: string; border: string; color: string; label: string; Icon: SvgIconComponent }> = {
  BUY: { bg: '#040e04', border: '#0a3a0a', color: '#00ff41', label: 'BUY', Icon: TrendingUpIcon },
  SELL: { bg: '#0e0404', border: '#3a0a0a', color: '#ff1744', label: 'SELL', Icon: TrendingDownIcon },
  HOLD: { bg: '#04040e', border: '#0a0a3a', color: '#00bcd4', label: 'HOLD', Icon: RemoveIcon },
};

/* ─── Card tile in the BUY/SELL/HOLD grid ─── */
function SignalCard({
  card,
  onClick,
}: {
  card: CardIndicator;
  onClick: () => void;
}) {
  const cfg = SIGNAL_CONFIG[card.signal || 'HOLD'];
  return (
    <Paper
      onClick={onClick}
      sx={{
        p: 2,
        bgcolor: cfg.bg,
        border: `1px solid ${cfg.border}`,
        cursor: 'pointer',
        transition: 'all 0.15s',
        '&:hover': { borderColor: cfg.color, transform: 'translateY(-2px)' },
        display: 'flex',
        gap: 1.5,
        alignItems: 'flex-start',
      }}
    >
      {card.image_small && (
        <img
          src={card.image_small}
          alt=""
          style={{ width: 48, height: 68, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }}
        />
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography
            sx={{
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 700,
              ...mono,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {card.name}
          </Typography>
          <Chip
            label={`${card.conviction}/10`}
            size="small"
            sx={{
              bgcolor: cfg.border,
              color: cfg.color,
              ...mono,
              fontSize: '0.7rem',
              fontWeight: 700,
              height: 20,
              flexShrink: 0,
            }}
          />
        </Box>
        <Typography sx={{ color: '#555', fontSize: '0.7rem', ...mono }}>
          {card.set_name} · {card.rarity}
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, mt: 1, alignItems: 'baseline' }}>
          <Typography sx={{ color: '#00bcd4', fontSize: '1rem', fontWeight: 700, ...mono }}>
            ${card.current_price?.toFixed(2)}
          </Typography>
          {card.price_change_7d != null && (
            <Typography
              sx={{
                color: card.price_change_7d >= 0 ? '#00ff41' : '#ff1744',
                fontSize: '0.75rem',
                ...mono,
              }}
            >
              {card.price_change_7d >= 0 ? '+' : ''}
              {card.price_change_7d.toFixed(1)}% 7d
            </Typography>
          )}
        </Box>

        {card.reasoning && (
          <Typography
            sx={{
              color: '#888',
              fontSize: '0.7rem',
              ...mono,
              mt: 0.5,
              lineHeight: 1.4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {card.reasoning}
          </Typography>
        )}

        {/* TA pattern + reprint risk chips */}
        {(card.ta_pattern || card.reprint_risk) && (
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
            {card.ta_pattern && (
              <Chip label={card.ta_pattern} size="small" sx={{ bgcolor: '#1a1a3a', color: '#7c8aff', height: 18, fontSize: '0.55rem', ...mono }} />
            )}
            {card.reprint_risk && (
              <Chip
                label={`REPRINT: ${card.reprint_risk.toUpperCase()}`}
                size="small"
                sx={{
                  height: 18, fontSize: '0.55rem', ...mono,
                  bgcolor: card.reprint_risk === 'high' ? '#2a0a0a' : card.reprint_risk === 'medium' ? '#2a1a0a' : '#0a2a0a',
                  color: card.reprint_risk === 'high' ? '#ff4444' : card.reprint_risk === 'medium' ? '#ff9800' : '#4caf50',
                }}
              />
            )}
          </Box>
        )}

        {/* Price targets row */}
        {(card.entry_price != null || card.target_price != null || card.stop_loss != null) && (
          <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5 }}>
            {card.entry_price != null && (
              <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>
                ENTRY <span style={{ color: '#fff' }}>${card.entry_price.toFixed(2)}</span>
              </Typography>
            )}
            {card.target_price != null && (
              <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>
                TARGET <span style={{ color: '#4caf50' }}>${card.target_price.toFixed(2)}</span>
              </Typography>
            )}
            {card.stop_loss != null && (
              <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>
                STOP <span style={{ color: '#f44336' }}>${card.stop_loss.toFixed(2)}</span>
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Paper>
  );
}

/* ─── Signal group (BUY / SELL / HOLD section) ─── */
function SignalGroup({
  signal,
  cards,
  onCardClick,
}: {
  signal: string;
  cards: CardIndicator[];
  onCardClick: (card: CardIndicator) => void;
}) {
  const cfg = SIGNAL_CONFIG[signal];
  if (cards.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <cfg.Icon sx={{ color: cfg.color, fontSize: 24 }} />
        <Typography variant="h6" sx={{ color: cfg.color, fontWeight: 700, ...mono }}>
          {cfg.label}
        </Typography>
        <Chip
          label={cards.length}
          size="small"
          sx={{ bgcolor: cfg.border, color: cfg.color, ...mono, fontSize: '0.8rem', fontWeight: 700 }}
        />
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
          gap: 1.5,
        }}
      >
        {cards.map((c) => (
          <SignalCard key={c.card_id} card={c} onClick={() => onCardClick(c)} />
        ))}
      </Box>
    </Box>
  );
}

/* ─── Drill-down detail view for a single card ─── */
function CardDrillDown({
  card,
  onBack,
}: {
  card: CardIndicator;
  onBack: () => void;
}) {
  const [backtest, setBacktest] = useState<QuickBacktestResult | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);

  useEffect(() => {
    if (card.can_backtest) {
      setBtLoading(true);
      setBtError(null);
      api
        .quickBacktest(card.card_id)
        .then((r) => {
          if (r.error) setBtError(r.error);
          else setBacktest(r);
        })
        .catch((e) => setBtError(e.message))
        .finally(() => setBtLoading(false));
    }
  }, [card.card_id, card.can_backtest]);

  const cfg = SIGNAL_CONFIG[card.signal || 'HOLD'];

  return (
    <Box>
      {/* Back button */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={onBack}
        sx={{ color: '#666', ...mono, textTransform: 'none', mb: 2 }}
      >
        Back to signals
      </Button>

      {/* Card header */}
      <Paper
        sx={{
          p: 3,
          mb: 2,
          bgcolor: cfg.bg,
          border: `1px solid ${cfg.border}`,
        }}
      >
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {card.image_small && (
            <img
              src={card.image_small}
              alt=""
              style={{ width: 80, height: 112, objectFit: 'contain', borderRadius: 6 }}
            />
          )}
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
              <Typography variant="h5" sx={{ color: '#fff', fontWeight: 700, ...mono }}>
                {card.name}
              </Typography>
              {card.signal && (
                <Chip
                  icon={<cfg.Icon sx={{ color: `${cfg.color} !important`, fontSize: 16 }} />}
                  label={`${card.signal} — ${card.conviction}/10 conviction`}
                  sx={{
                    bgcolor: cfg.border,
                    color: cfg.color,
                    ...mono,
                    fontSize: '0.8rem',
                    fontWeight: 700,
                  }}
                />
              )}
            </Box>
            <Typography sx={{ color: '#666', ...mono, fontSize: '0.85rem' }}>
              {card.set_name} · {card.rarity}
            </Typography>

            <Box sx={{ display: 'flex', gap: 4, mt: 2, flexWrap: 'wrap' }}>
              <Box>
                <Typography sx={{ color: '#555', fontSize: '0.65rem', ...mono }}>PRICE</Typography>
                <Typography sx={{ color: '#00bcd4', fontSize: '1.3rem', fontWeight: 700, ...mono }}>
                  ${card.current_price?.toFixed(2)}
                </Typography>
              </Box>
              {card.entry_price != null && (
                <Box>
                  <Typography sx={{ color: '#555', fontSize: '0.65rem', ...mono }}>ENTRY</Typography>
                  <Typography sx={{ color: '#fff', fontSize: '1.3rem', fontWeight: 700, ...mono }}>
                    ${card.entry_price.toFixed(2)}
                  </Typography>
                </Box>
              )}
              {card.target_price != null && (
                <Box>
                  <Typography sx={{ color: '#555', fontSize: '0.65rem', ...mono }}>TARGET</Typography>
                  <Typography sx={{ color: '#4caf50', fontSize: '1.3rem', fontWeight: 700, ...mono }}>
                    ${card.target_price.toFixed(2)}
                  </Typography>
                </Box>
              )}
              {card.stop_loss != null && (
                <Box>
                  <Typography sx={{ color: '#555', fontSize: '0.65rem', ...mono }}>STOP LOSS</Typography>
                  <Typography sx={{ color: '#f44336', fontSize: '1.3rem', fontWeight: 700, ...mono }}>
                    ${card.stop_loss.toFixed(2)}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Paper>

      {/* Portfolio Manager Decision + Risk Note */}
      <Paper sx={{ p: 3, mb: 2, bgcolor: '#111', border: '1px solid #1e1e1e' }}>
        <Typography sx={{ color: '#ffd700', fontWeight: 700, ...mono, mb: 1.5, fontSize: '0.9rem' }}>
          PORTFOLIO MANAGER DECISION
        </Typography>
        <Typography sx={{ color: '#ccc', ...mono, fontSize: '0.85rem', lineHeight: 1.7 }}>
          {card.reasoning || 'No reasoning available — generate AI signals first.'}
        </Typography>
        {card.risk_note && (
          <Box sx={{ mt: 1.5, p: 1.5, bgcolor: '#1a1a0a', borderRadius: 1, border: '1px solid #333300' }}>
            <Typography sx={{ color: '#ff9800', fontWeight: 700, ...mono, fontSize: '0.7rem', mb: 0.5 }}>
              RISK MANAGER
            </Typography>
            <Typography sx={{ color: '#cc9', ...mono, fontSize: '0.8rem', lineHeight: 1.6 }}>
              {card.risk_note}
            </Typography>
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          {card.best_strategy && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ScienceIcon sx={{ color: '#00bcd4', fontSize: 18 }} />
              <Typography sx={{ color: '#00bcd4', ...mono, fontSize: '0.8rem' }}>
                STRATEGY: <span style={{ color: '#fff', fontWeight: 700 }}>{card.best_strategy}</span>
              </Typography>
            </Box>
          )}
          {card.time_horizon && (
            <Chip
              label={`${card.time_horizon.toUpperCase()} TERM`}
              size="small"
              sx={{ bgcolor: '#1a1a2e', color: '#ffd700', ...mono, fontSize: '0.7rem', fontWeight: 700 }}
            />
          )}
          {card.reprint_risk && (
            <Chip
              label={`REPRINT: ${card.reprint_risk.toUpperCase()}`}
              size="small"
              sx={{
                bgcolor: card.reprint_risk === 'high' ? '#2a0a0a' : card.reprint_risk === 'medium' ? '#2a1a0a' : '#0a2a0a',
                color: card.reprint_risk === 'high' ? '#ff4444' : card.reprint_risk === 'medium' ? '#ff9800' : '#4caf50',
                ...mono, fontSize: '0.7rem', fontWeight: 700,
              }}
            />
          )}
          {card.demand_type && (
            <Chip
              label={card.demand_type.toUpperCase()}
              size="small"
              sx={{ bgcolor: '#0a0a2a', color: '#7c8aff', ...mono, fontSize: '0.7rem', fontWeight: 700 }}
            />
          )}
        </Box>
      </Paper>

      {/* Technical Analysis + Catalyst side by side */}
      {(card.ta_summary || card.catalyst_summary) && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexDirection: { xs: 'column', md: 'row' } }}>
          {card.ta_summary && (
            <Paper sx={{ flex: 1, p: 3, bgcolor: '#0a0a14', border: '1px solid #1a1a3a' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Typography sx={{ color: '#7c8aff', fontWeight: 700, ...mono, fontSize: '0.9rem' }}>
                  TECHNICAL ANALYSIS
                </Typography>
                {card.ta_pattern && (
                  <Chip
                    label={card.ta_pattern}
                    size="small"
                    sx={{ bgcolor: '#1a1a3a', color: '#aab', ...mono, fontSize: '0.65rem', fontWeight: 700 }}
                  />
                )}
              </Box>
              <Typography sx={{ color: '#aab8cc', ...mono, fontSize: '0.8rem', lineHeight: 1.7 }}>
                {card.ta_summary}
              </Typography>
            </Paper>
          )}
          {card.catalyst_summary && (
            <Paper sx={{ flex: 1, p: 3, bgcolor: '#14100a', border: '1px solid #3a2a1a' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Typography sx={{ color: '#ffab40', fontWeight: 700, ...mono, fontSize: '0.9rem' }}>
                  CATALYST ANALYSIS
                </Typography>
                {card.catalyst && (
                  <Chip
                    label={card.catalyst}
                    size="small"
                    sx={{ bgcolor: '#3a2a1a', color: '#cc9', ...mono, fontSize: '0.65rem', fontWeight: 700 }}
                  />
                )}
              </Box>
              <Typography sx={{ color: '#ccb8aa', ...mono, fontSize: '0.8rem', lineHeight: 1.7 }}>
                {card.catalyst_summary}
              </Typography>
            </Paper>
          )}
        </Box>
      )}

      {/* Bull vs Bear Debate */}
      {(card.bull_case || card.bear_case) && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexDirection: { xs: 'column', md: 'row' } }}>
          {card.bull_case && (
            <Paper sx={{ flex: 1, p: 3, bgcolor: '#040e04', border: '1px solid #0a3a0a' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <TrendingUpIcon sx={{ color: '#00ff41', fontSize: 20 }} />
                <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono, fontSize: '0.9rem' }}>
                  BULL CASE
                </Typography>
              </Box>
              <Typography sx={{ color: '#aac9aa', ...mono, fontSize: '0.8rem', lineHeight: 1.7 }}>
                {card.bull_case}
              </Typography>
            </Paper>
          )}
          {card.bear_case && (
            <Paper sx={{ flex: 1, p: 3, bgcolor: '#0e0404', border: '1px solid #3a0a0a' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <TrendingDownIcon sx={{ color: '#ff1744', fontSize: 20 }} />
                <Typography sx={{ color: '#ff1744', fontWeight: 700, ...mono, fontSize: '0.9rem' }}>
                  BEAR CASE
                </Typography>
              </Box>
              <Typography sx={{ color: '#c9aaaa', ...mono, fontSize: '0.8rem', lineHeight: 1.7 }}>
                {card.bear_case}
              </Typography>
            </Paper>
          )}
        </Box>
      )}

      {/* Technical Indicators */}
      <Paper sx={{ p: 3, mb: 2, bgcolor: '#111', border: '1px solid #1e1e1e' }}>
        <Typography sx={{ color: '#00bcd4', fontWeight: 700, ...mono, mb: 1.5, fontSize: '0.9rem' }}>
          TECHNICAL INDICATORS
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr' },
            gap: 2,
          }}
        >
          <IndicatorBox label="RSI (14)" value={card.rsi_14?.toFixed(1) ?? '—'} color={
            card.rsi_14 != null ? (card.rsi_14 < 30 ? '#00ff41' : card.rsi_14 > 70 ? '#ff1744' : '#ccc') : '#555'
          } sub={card.rsi_14 != null ? (card.rsi_14 < 30 ? 'OVERSOLD' : card.rsi_14 > 70 ? 'OVERBOUGHT' : 'NEUTRAL') : undefined} />
          <IndicatorBox label="SMA 7" value={card.sma_7 != null ? `$${card.sma_7.toFixed(2)}` : '—'} color="#ccc" />
          <IndicatorBox label="SMA 30" value={card.sma_30 != null ? `$${card.sma_30.toFixed(2)}` : '—'} color="#ccc" />
          <IndicatorBox label="MACD HIST" value={card.macd_histogram?.toFixed(4) ?? '—'} color={
            card.macd_histogram != null ? (card.macd_histogram > 0 ? '#00ff41' : '#ff1744') : '#555'
          } />
          <IndicatorBox label="MOMENTUM" value={card.momentum?.toFixed(2) ?? '—'} color={
            card.momentum != null ? (card.momentum > 0 ? '#00ff41' : '#ff1744') : '#555'
          } />
          <IndicatorBox label="7D CHANGE" value={card.price_change_7d != null ? `${card.price_change_7d >= 0 ? '+' : ''}${card.price_change_7d.toFixed(1)}%` : '—'} color={
            card.price_change_7d != null ? (card.price_change_7d >= 0 ? '#00ff41' : '#ff1744') : '#555'
          } />
          <IndicatorBox label="30D CHANGE" value={card.price_change_30d != null ? `${card.price_change_30d >= 0 ? '+' : ''}${card.price_change_30d.toFixed(1)}%` : '—'} color={
            card.price_change_30d != null ? (card.price_change_30d >= 0 ? '#00ff41' : '#ff1744') : '#555'
          } />
          <IndicatorBox label="BOLLINGER POS" value={card.bollinger_position?.toFixed(2) ?? '—'} color={
            card.bollinger_position != null ? (card.bollinger_position < 0.2 ? '#00ff41' : card.bollinger_position > 0.8 ? '#ff1744' : '#00bcd4') : '#555'
          } sub={card.bollinger_position != null ? (card.bollinger_position < 0.2 ? 'NEAR LOWER' : card.bollinger_position > 0.8 ? 'NEAR UPPER' : 'MID-BAND') : undefined} />
          <IndicatorBox label="SUPPORT" value={card.support != null ? `$${card.support.toFixed(2)}` : '—'} color="#4caf50" />
          <IndicatorBox label="RESISTANCE" value={card.resistance != null ? `$${card.resistance.toFixed(2)}` : '—'} color="#f44336" />
          <IndicatorBox label="VOLATILITY" value={card.volatility != null ? `${card.volatility.toFixed(1)}%` : '—'} color={
            card.volatility != null ? (card.volatility > 5 ? '#ff6d00' : '#888') : '#555'
          } sub={card.volatility != null ? (card.volatility > 5 ? 'HIGH' : card.volatility > 2 ? 'MODERATE' : 'LOW') : undefined} />
          <IndicatorBox label="SPREAD" value={card.spread_ratio != null ? `${card.spread_ratio.toFixed(1)}%` : '—'} color={
            card.spread_ratio != null ? (card.spread_ratio > 3 ? '#ff6d00' : '#888') : '#555'
          } />
          <IndicatorBox label="ACTIVITY" value={card.activity_score != null ? card.activity_score.toFixed(0) : '—'} color={
            card.activity_score != null ? (card.activity_score > 60 ? '#ff6d00' : card.activity_score > 30 ? '#ffab00' : '#888') : '#555'
          } sub={card.activity_score != null ? (card.activity_score > 60 ? 'HOT' : card.activity_score > 30 ? 'ACTIVE' : 'QUIET') : undefined} />
          <IndicatorBox label="PRICE DATA" value={`${card.price_history_days} days`} color="#888" />
        </Box>
      </Paper>

      {/* Backtest Results */}
      <Paper sx={{ p: 3, bgcolor: '#111', border: '1px solid #1e1e1e' }}>
        <Typography sx={{ color: '#00bcd4', fontWeight: 700, ...mono, mb: 1.5, fontSize: '0.9rem' }}>
          BACKTEST — ALL 8 STRATEGIES
        </Typography>

        {!card.can_backtest && (
          <Typography sx={{ color: '#666', ...mono, fontSize: '0.8rem' }}>
            Need 35+ days of price history to backtest (currently {card.price_history_days} days).
          </Typography>
        )}

        {btLoading && (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <CircularProgress size={24} sx={{ color: '#00bcd4' }} />
            <Typography sx={{ color: '#666', mt: 1, ...mono, fontSize: '0.8rem' }}>
              Running all strategies on daily data...
            </Typography>
          </Box>
        )}

        {btError && (
          <Alert severity="error" sx={{ bgcolor: '#1a0000', color: '#ff4444' }}>
            {btError}
          </Alert>
        )}

        {backtest && (
          <>
            <Box sx={{ mb: 2, p: 1.5, bgcolor: '#0a0a0a', borderRadius: 1, border: '1px solid #222' }}>
              <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono }}>
                BEST STRATEGY: {backtest.best_strategy} ({backtest.best_return_pct > 0 ? '+' : ''}
                {backtest.best_return_pct.toFixed(1)}% return)
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {['STRATEGY', 'RETURN', 'BUY & HOLD', 'ALPHA', 'WIN RATE', 'TRADES', 'MAX DRAWDOWN', 'SHARPE'].map(
                      (h) => (
                        <TableCell
                          key={h}
                          align={h === 'STRATEGY' ? 'left' : 'right'}
                          sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}
                        >
                          {h}
                        </TableCell>
                      )
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {backtest.strategies.map((s) => {
                    const isBest = s.strategy_key === backtest.best_strategy;
                    const isRecommended = s.strategy_key === card.best_strategy;
                    return (
                      <TableRow key={s.strategy_key} sx={{ bgcolor: isBest ? '#0a1a0a' : isRecommended ? '#0a0a1a' : 'transparent' }}>
                        <TableCell sx={{ color: '#ccc', ...mono, fontSize: '0.75rem', borderColor: '#222' }}>
                          {s.strategy_name}
                          {isBest && (
                            <Chip label="BEST" size="small" sx={{ ml: 1, bgcolor: '#1a3a1a', color: '#00ff41', height: 18, fontSize: '0.6rem' }} />
                          )}
                          {isRecommended && !isBest && (
                            <Chip label="AI PICK" size="small" sx={{ ml: 1, bgcolor: '#1a1a3a', color: '#ffd700', height: 18, fontSize: '0.6rem' }} />
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ color: s.return_pct >= 0 ? '#00ff41' : '#ff1744', ...mono, fontSize: '0.75rem', fontWeight: 700, borderColor: '#222' }}>
                          {s.return_pct >= 0 ? '+' : ''}{s.return_pct.toFixed(1)}%
                        </TableCell>
                        <TableCell align="right" sx={{ color: s.buy_hold_return_pct >= 0 ? '#4caf50' : '#f44336', ...mono, fontSize: '0.75rem', borderColor: '#222' }}>
                          {s.buy_hold_return_pct >= 0 ? '+' : ''}{s.buy_hold_return_pct.toFixed(1)}%
                        </TableCell>
                        <TableCell align="right" sx={{ color: s.alpha >= 0 ? '#00bcd4' : '#ff9800', ...mono, fontSize: '0.75rem', borderColor: '#222' }}>
                          {s.alpha >= 0 ? '+' : ''}{s.alpha.toFixed(1)}%
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#ccc', ...mono, fontSize: '0.75rem', borderColor: '#222' }}>
                          {s.win_rate.toFixed(0)}%
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#ccc', ...mono, fontSize: '0.75rem', borderColor: '#222' }}>
                          {s.total_trades}
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#ff9800', ...mono, fontSize: '0.75rem', borderColor: '#222' }}>
                          {s.max_drawdown_pct.toFixed(1)}%
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#ccc', ...mono, fontSize: '0.75rem', borderColor: '#222' }}>
                          {s.sharpe_ratio != null ? s.sharpe_ratio.toFixed(2) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Paper>
    </Box>
  );
}

function IndicatorBox({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <Box sx={{ p: 1.5, bgcolor: '#0a0a0a', borderRadius: 1, border: '1px solid #1a1a1a' }}>
      <Typography sx={{ color: '#555', fontSize: '0.6rem', ...mono, mb: 0.5 }}>{label}</Typography>
      <Typography sx={{ color, fontSize: '1rem', fontWeight: 700, ...mono }}>{value}</Typography>
      {sub && (
        <Typography sx={{ color: color, fontSize: '0.6rem', ...mono, opacity: 0.7 }}>{sub}</Typography>
      )}
    </Box>
  );
}

/* ─── Pre-signal view: indicator table (before AI is run) ─── */
function IndicatorTable({ cards, onCardClick }: { cards: CardIndicator[]; onCardClick: (c: CardIndicator) => void }) {
  return (
    <TableContainer component={Paper} sx={{ bgcolor: '#111', border: '1px solid #1e1e1e' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {['CARD', 'PRICE', 'RSI', '7D CHG', '30D CHG', 'BOLL POS', 'MOMENTUM', 'DAYS'].map((h) => (
              <TableCell
                key={h}
                align={h === 'CARD' ? 'left' : 'right'}
                sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}
              >
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {cards.map((card) => (
            <TableRow
              key={card.card_id}
              onClick={() => onCardClick(card)}
              sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#1a1a1a' } }}
            >
              <TableCell sx={{ borderColor: '#222' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {card.image_small && (
                    <img src={card.image_small} alt="" style={{ width: 28, height: 40, objectFit: 'contain', borderRadius: 2 }} />
                  )}
                  <Box>
                    <Typography sx={{ color: '#fff', fontSize: '0.8rem', ...mono, fontWeight: 600 }}>{card.name}</Typography>
                    <Typography sx={{ color: '#555', fontSize: '0.65rem', ...mono }}>{card.set_name}</Typography>
                  </Box>
                </Box>
              </TableCell>
              <TableCell align="right" sx={{ color: '#00bcd4', ...mono, fontSize: '0.8rem', fontWeight: 700, borderColor: '#222' }}>
                ${card.current_price?.toFixed(2)}
              </TableCell>
              <TableCell align="right" sx={{
                color: card.rsi_14 != null ? (card.rsi_14 < 30 ? '#00ff41' : card.rsi_14 > 70 ? '#ff1744' : '#ccc') : '#333',
                ...mono, fontSize: '0.8rem', borderColor: '#222',
              }}>
                {card.rsi_14?.toFixed(0) ?? '—'}
              </TableCell>
              <TableCell align="right" sx={{
                color: card.price_change_7d != null ? (card.price_change_7d >= 0 ? '#00ff41' : '#ff1744') : '#333',
                ...mono, fontSize: '0.8rem', borderColor: '#222',
              }}>
                {card.price_change_7d != null ? `${card.price_change_7d >= 0 ? '+' : ''}${card.price_change_7d.toFixed(1)}%` : '—'}
              </TableCell>
              <TableCell align="right" sx={{
                color: card.price_change_30d != null ? (card.price_change_30d >= 0 ? '#00ff41' : '#ff1744') : '#333',
                ...mono, fontSize: '0.8rem', borderColor: '#222',
              }}>
                {card.price_change_30d != null ? `${card.price_change_30d >= 0 ? '+' : ''}${card.price_change_30d.toFixed(1)}%` : '—'}
              </TableCell>
              <TableCell align="right" sx={{ color: '#888', ...mono, fontSize: '0.8rem', borderColor: '#222' }}>
                {card.bollinger_position?.toFixed(2) ?? '—'}
              </TableCell>
              <TableCell align="right" sx={{
                color: card.momentum != null ? (card.momentum > 0 ? '#00ff41' : '#ff1744') : '#333',
                ...mono, fontSize: '0.8rem', borderColor: '#222',
              }}>
                {card.momentum?.toFixed(2) ?? '—'}
              </TableCell>
              <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.8rem', borderColor: '#222' }}>
                {card.price_history_days}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* ─── Main Signals Page ─── */
export default function Signals() {
  const [indicators, setIndicators] = useState<CardIndicator[]>([]);
  const [aiSignals, setAiSignals] = useState<AISignalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [pipelineStep, setPipelineStep] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardIndicator | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Check if there's already a running job on page load
  useEffect(() => {
    api
      .getIndicators()
      .then((r) => setIndicators(r.cards))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    // Check for in-progress job
    api.getSignalStatus().then((status) => {
      if (status.status === 'processing') {
        setAiLoading(true);
        setPipelineStep(status.step || 'Processing...');
        setElapsed(status.elapsed_seconds || 0);
        startPolling();
      } else if (status.status === 'done' && status.signals) {
        setAiSignals({
          signals: status.signals,
          summary: status.summary!,
          pipeline: status.pipeline,
          tokens_used: status.tokens_used!,
        });
      }
    }).catch(() => { /* ignore — status endpoint may not exist yet */ });
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getSignalStatus();
        if (status.status === 'processing') {
          setPipelineStep(status.step || 'Processing...');
          setElapsed(status.elapsed_seconds || 0);
        } else if (status.status === 'done' && status.signals) {
          // Pipeline complete!
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setAiLoading(false);
          setPipelineStep('');
          setAiSignals({
            signals: status.signals,
            summary: status.summary!,
            pipeline: status.pipeline,
            tokens_used: status.tokens_used!,
          });
        } else if (status.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setAiLoading(false);
          setPipelineStep('');
          setError(status.error || 'Pipeline failed');
        } else if (status.status === 'idle') {
          // Job finished or was never started — stop polling
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setAiLoading(false);
          setPipelineStep('');
        }
      } catch {
        // Network blip — keep polling
      }
    }, 3000);
  }, []);

  const generateSignals = async () => {
    setAiLoading(true);
    setError(null);
    setPipelineStep('Starting pipeline...');
    setElapsed(0);
    try {
      await api.generateAISignals(); // Returns immediately
      startPolling();
    } catch (e: any) {
      setError(e.message || 'Failed to start signal generation');
      setAiLoading(false);
      setPipelineStep('');
    }
  };

  const cards = aiSignals ? aiSignals.signals : indicators;
  const buyCards = cards.filter((c) => c.signal === 'BUY').sort((a, b) => (b.conviction ?? 0) - (a.conviction ?? 0));
  const sellCards = cards.filter((c) => c.signal === 'SELL').sort((a, b) => (b.conviction ?? 0) - (a.conviction ?? 0));
  const holdCards = cards.filter((c) => c.signal === 'HOLD').sort((a, b) => (b.conviction ?? 0) - (a.conviction ?? 0));

  // Drill-down view
  if (selectedCard) {
    return (
      <Box sx={{ p: 2, maxWidth: 1200, mx: 'auto' }}>
        <CardDrillDown card={selectedCard} onBack={() => setSelectedCard(null)} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 1400, mx: 'auto' }}>
      {/* Header */}
      <Paper
        sx={{
          p: 3,
          mb: 2,
          bgcolor: '#111',
          border: '1px solid #1e1e1e',
          background: 'linear-gradient(135deg, #111 0%, #0a1a0a 100%)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <AutoAwesomeIcon sx={{ color: '#ffd700', fontSize: 36 }} />
            <Box>
              <Typography variant="h5" sx={{ color: '#00ff41', fontWeight: 700, ...mono }}>
                AI TRADING SIGNALS
              </Typography>
              <Typography sx={{ color: '#666', fontSize: '0.8rem', ...mono }}>
                GPT-POWERED BUY/SELL/HOLD — CLICK ANY CARD TO DRILL DOWN
              </Typography>
            </Box>
          </Box>
          <Button
            variant="contained"
            startIcon={aiLoading ? <CircularProgress size={16} sx={{ color: '#000' }} /> : <AutoAwesomeIcon />}
            onClick={generateSignals}
            disabled={aiLoading}
            sx={{
              bgcolor: '#ffd700',
              color: '#000',
              fontWeight: 700,
              ...mono,
              '&:hover': { bgcolor: '#ffb300' },
              '&:disabled': { bgcolor: '#333', color: '#666' },
            }}
          >
            {aiLoading ? 'AI ANALYZING...' : 'GENERATE AI SIGNALS'}
          </Button>
        </Box>

        {aiLoading && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress sx={{ bgcolor: '#222', '& .MuiLinearProgress-bar': { bgcolor: '#ffd700' } }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
              <Typography sx={{ color: '#ffd700', fontSize: '0.75rem', ...mono, fontWeight: 600 }}>
                {pipelineStep || 'Starting pipeline...'}
              </Typography>
              <Typography sx={{ color: '#555', fontSize: '0.7rem', ...mono }}>
                {elapsed > 0 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : ''}
              </Typography>
            </Box>
            <Typography sx={{ color: '#444', mt: 0.5, fontSize: '0.65rem', ...mono }}>
              7-step pipeline: Quant → TA → Catalyst → Bull → Bear → PM → Risk Manager
            </Typography>
          </Box>
        )}
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2, bgcolor: '#1a0000', color: '#ff4444' }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <CircularProgress sx={{ color: '#00bcd4' }} />
        </Box>
      )}

      {/* Before AI signals: show indicator table */}
      {!loading && !aiSignals && (
        <>
          <Paper sx={{ p: 2, mb: 2, bgcolor: '#111', border: '1px solid #1e1e1e' }}>
            <Typography sx={{ color: '#888', ...mono, fontSize: '0.8rem' }}>
              Showing raw technical indicators for {indicators.length} cards. Click &quot;GENERATE AI SIGNALS&quot; to get BUY/SELL/HOLD recommendations from GPT.
            </Typography>
          </Paper>
          <IndicatorTable cards={indicators} onCardClick={setSelectedCard} />
        </>
      )}

      {/* After AI signals: show BUY / SELL / HOLD sections */}
      {!loading && aiSignals && (
        <>
          {/* Summary bar */}
          <Paper sx={{ p: 2, mb: 3, bgcolor: '#111', border: '1px solid #1e1e1e' }}>
            <Box sx={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <Box>
                <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>TOTAL</Typography>
                <Typography sx={{ color: '#fff', fontWeight: 700, ...mono, fontSize: '1.3rem' }}>
                  {aiSignals.summary.total}
                </Typography>
              </Box>
              <Divider orientation="vertical" flexItem sx={{ borderColor: '#222' }} />
              <Box>
                <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>BUY</Typography>
                <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono, fontSize: '1.3rem' }}>
                  {aiSignals.summary.buy}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>SELL</Typography>
                <Typography sx={{ color: '#ff1744', fontWeight: 700, ...mono, fontSize: '1.3rem' }}>
                  {aiSignals.summary.sell}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>HOLD</Typography>
                <Typography sx={{ color: '#00bcd4', fontWeight: 700, ...mono, fontSize: '1.3rem' }}>
                  {aiSignals.summary.hold}
                </Typography>
              </Box>
              <Box sx={{ ml: 'auto', textAlign: 'right' }}>
                {aiSignals.pipeline && (
                  <Typography sx={{ color: '#555', fontSize: '0.6rem', ...mono }}>
                    {aiSignals.pipeline}
                  </Typography>
                )}
                {aiSignals.tokens_used && (
                  <Typography sx={{ color: '#444', fontSize: '0.6rem', ...mono }}>
                    TOKENS: {aiSignals.tokens_used.input.toLocaleString()} in / {aiSignals.tokens_used.output.toLocaleString()} out
                  </Typography>
                )}
              </Box>
            </Box>
          </Paper>

          {/* BUY section */}
          <SignalGroup signal="BUY" cards={buyCards} onCardClick={setSelectedCard} />

          {/* SELL section */}
          <SignalGroup signal="SELL" cards={sellCards} onCardClick={setSelectedCard} />

          {/* HOLD section */}
          <SignalGroup signal="HOLD" cards={holdCards} onCardClick={setSelectedCard} />
        </>
      )}

      {/* Empty state */}
      {!loading && cards.length === 0 && (
        <Paper sx={{ p: 4, bgcolor: '#111', border: '1px solid #1e1e1e', textAlign: 'center' }}>
          <Typography sx={{ color: '#666', ...mono }}>
            No cards with sufficient daily price data.
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
