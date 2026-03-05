import React, { useState, useEffect } from 'react';
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
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Tabs,
  Tab,
  LinearProgress,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import RemoveIcon from '@mui/icons-material/Remove';
import ScienceIcon from '@mui/icons-material/Science';
import { api } from '../services/api';
import type { CardIndicator, AISignalsResponse, QuickBacktestResult } from '../services/api';

const mono = { fontFamily: '"JetBrains Mono", "Fira Code", monospace' };

function SignalChip({ signal, conviction }: { signal: string; conviction?: number }) {
  const config: Record<string, { bg: string; color: string; icon: React.ReactElement }> = {
    BUY: { bg: '#0a2e0a', color: '#00ff41', icon: <TrendingUpIcon sx={{ fontSize: 14 }} /> },
    SELL: { bg: '#2e0a0a', color: '#ff1744', icon: <TrendingDownIcon sx={{ fontSize: 14 }} /> },
    HOLD: { bg: '#1a1a2e', color: '#00bcd4', icon: <RemoveIcon sx={{ fontSize: 14 }} /> },
  };
  const c = config[signal] || config.HOLD;
  return (
    <Chip
      icon={c.icon}
      label={`${signal}${conviction ? ` (${conviction}/10)` : ''}`}
      size="small"
      sx={{ bgcolor: c.bg, color: c.color, ...mono, fontSize: '0.75rem', fontWeight: 700 }}
    />
  );
}

function BacktestDialog({
  open,
  onClose,
  cardId,
  cardName,
}: {
  open: boolean;
  onClose: () => void;
  cardId: number;
  cardName: string;
}) {
  const [result, setResult] = useState<QuickBacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && cardId) {
      setLoading(true);
      setError(null);
      api
        .quickBacktest(cardId)
        .then((r) => {
          if (r.error) setError(r.error);
          else setResult(r);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [open, cardId]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { bgcolor: '#111', color: '#ccc', border: '1px solid #333' } }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ color: '#00bcd4', fontWeight: 700, ...mono }}>
          QUICK BACKTEST — {cardName}
        </Typography>
        <IconButton onClick={onClose} sx={{ color: '#666' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {loading && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CircularProgress sx={{ color: '#00bcd4' }} />
            <Typography sx={{ color: '#666', mt: 2, ...mono, fontSize: '0.8rem' }}>
              Running all 8 strategies on daily data...
            </Typography>
          </Box>
        )}
        {error && <Alert severity="error" sx={{ bgcolor: '#1a0000', color: '#ff4444' }}>{error}</Alert>}
        {result && (
          <>
            <Box sx={{ mb: 2, p: 1.5, bgcolor: '#0a0a0a', borderRadius: 1, border: '1px solid #222' }}>
              <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono }}>
                BEST: {result.best_strategy} ({result.best_return_pct > 0 ? '+' : ''}
                {result.best_return_pct.toFixed(1)}%)
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                      STRATEGY
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                      RETURN
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                      B&H
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                      ALPHA
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                      WIN%
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                      TRADES
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                      MAX DD
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.strategies.map((s) => (
                    <TableRow
                      key={s.strategy_key}
                      sx={{
                        bgcolor: s.strategy_key === result.best_strategy ? '#0a1a0a' : 'transparent',
                      }}
                    >
                      <TableCell sx={{ color: '#ccc', ...mono, fontSize: '0.75rem', borderColor: '#222' }}>
                        {s.strategy_name}
                        {s.strategy_key === result.best_strategy && (
                          <Chip label="BEST" size="small" sx={{ ml: 1, bgcolor: '#1a3a1a', color: '#00ff41', height: 18, fontSize: '0.6rem' }} />
                        )}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          color: s.return_pct >= 0 ? '#00ff41' : '#ff1744',
                          ...mono,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          borderColor: '#222',
                        }}
                      >
                        {s.return_pct >= 0 ? '+' : ''}{s.return_pct.toFixed(1)}%
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          color: s.buy_hold_return_pct >= 0 ? '#4caf50' : '#f44336',
                          ...mono,
                          fontSize: '0.75rem',
                          borderColor: '#222',
                        }}
                      >
                        {s.buy_hold_return_pct >= 0 ? '+' : ''}{s.buy_hold_return_pct.toFixed(1)}%
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          color: s.alpha >= 0 ? '#00bcd4' : '#ff9800',
                          ...mono,
                          fontSize: '0.75rem',
                          borderColor: '#222',
                        }}
                      >
                        {s.alpha >= 0 ? '+' : ''}{s.alpha.toFixed(1)}%
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: '#ccc', ...mono, fontSize: '0.75rem', borderColor: '#222' }}
                      >
                        {(s.win_rate * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: '#ccc', ...mono, fontSize: '0.75rem', borderColor: '#222' }}
                      >
                        {s.total_trades}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: '#ff9800', ...mono, fontSize: '0.75rem', borderColor: '#222' }}
                      >
                        {s.max_drawdown_pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Signals() {
  const [indicators, setIndicators] = useState<CardIndicator[]>([]);
  const [aiSignals, setAiSignals] = useState<AISignalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0); // 0=all, 1=buy, 2=sell, 3=hold
  const [backtestCard, setBacktestCard] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    api
      .getIndicators()
      .then((r) => setIndicators(r.cards))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const generateSignals = async () => {
    setAiLoading(true);
    setError(null);
    try {
      const result = await api.generateAISignals();
      if (result.error) {
        setError(result.error);
      } else {
        setAiSignals(result);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to generate AI signals');
    } finally {
      setAiLoading(false);
    }
  };

  const cards = aiSignals ? aiSignals.signals : indicators;
  const filtered =
    tab === 0
      ? cards
      : tab === 1
        ? cards.filter((c) => c.signal === 'BUY')
        : tab === 2
          ? cards.filter((c) => c.signal === 'SELL')
          : cards.filter((c) => c.signal === 'HOLD');

  const buyCount = aiSignals?.summary?.buy ?? 0;
  const sellCount = aiSignals?.summary?.sell ?? 0;
  const holdCount = aiSignals?.summary?.hold ?? 0;

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
                GPT-POWERED BUY/SELL/HOLD — DAILY TECHNICAL ANALYSIS
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
            <Typography sx={{ color: '#666', mt: 1, fontSize: '0.75rem', ...mono }}>
              Marcus is analyzing all cards with GPT... This may take 15-30 seconds.
            </Typography>
          </Box>
        )}
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2, bgcolor: '#1a0000', color: '#ff4444' }}>
          {error}
        </Alert>
      )}

      {/* Summary bar (only when AI signals are generated) */}
      {aiSignals && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: '#111', border: '1px solid #1e1e1e' }}>
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
            <Box>
              <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>TOTAL</Typography>
              <Typography sx={{ color: '#fff', fontWeight: 700, ...mono, fontSize: '1.2rem' }}>
                {aiSignals.summary.total}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>BUY</Typography>
              <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono, fontSize: '1.2rem' }}>
                {buyCount}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>SELL</Typography>
              <Typography sx={{ color: '#ff1744', fontWeight: 700, ...mono, fontSize: '1.2rem' }}>
                {sellCount}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>HOLD</Typography>
              <Typography sx={{ color: '#00bcd4', fontWeight: 700, ...mono, fontSize: '1.2rem' }}>
                {holdCount}
              </Typography>
            </Box>
            {aiSignals.tokens_used && (
              <Box sx={{ ml: 'auto' }}>
                <Typography sx={{ color: '#444', fontSize: '0.65rem', ...mono }}>
                  TOKENS: {aiSignals.tokens_used.input.toLocaleString()} in / {aiSignals.tokens_used.output.toLocaleString()} out
                </Typography>
              </Box>
            )}
          </Box>
        </Paper>
      )}

      {/* Tabs for filtering */}
      {aiSignals && (
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{
            mb: 2,
            '& .MuiTab-root': { color: '#666', ...mono, fontSize: '0.8rem', textTransform: 'none', minHeight: 36 },
            '& .Mui-selected': { color: '#00bcd4' },
            '& .MuiTabs-indicator': { bgcolor: '#00bcd4' },
          }}
        >
          <Tab label={`All (${aiSignals.summary.total})`} />
          <Tab label={`Buy (${buyCount})`} />
          <Tab label={`Sell (${sellCount})`} />
          <Tab label={`Hold (${holdCount})`} />
        </Tabs>
      )}

      {/* Cards table */}
      {loading ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <CircularProgress sx={{ color: '#00bcd4' }} />
        </Box>
      ) : (
        <TableContainer component={Paper} sx={{ bgcolor: '#111', border: '1px solid #1e1e1e' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>CARD</TableCell>
                <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                  PRICE
                </TableCell>
                <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                  RSI
                </TableCell>
                <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                  7D CHG
                </TableCell>
                <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                  30D CHG
                </TableCell>
                <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                  BOLL POS
                </TableCell>
                {aiSignals && (
                  <>
                    <TableCell sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>SIGNAL</TableCell>
                    <TableCell sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>REASONING</TableCell>
                    <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                      TARGET
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>
                      STOP
                    </TableCell>
                  </>
                )}
                <TableCell sx={{ color: '#666', ...mono, fontSize: '0.7rem', borderColor: '#222' }}>ACTIONS</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((card) => (
                <TableRow
                  key={card.card_id}
                  sx={{
                    '&:hover': { bgcolor: '#1a1a1a' },
                    bgcolor:
                      card.signal === 'BUY'
                        ? '#040e04'
                        : card.signal === 'SELL'
                          ? '#0e0404'
                          : 'transparent',
                  }}
                >
                  <TableCell sx={{ borderColor: '#222' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {card.image_small && (
                        <img
                          src={card.image_small}
                          alt=""
                          style={{ width: 28, height: 40, objectFit: 'contain', borderRadius: 2 }}
                        />
                      )}
                      <Box>
                        <Typography sx={{ color: '#fff', fontSize: '0.8rem', ...mono, fontWeight: 600 }}>
                          {card.name}
                        </Typography>
                        <Typography sx={{ color: '#555', fontSize: '0.65rem', ...mono }}>
                          {card.set_name} · {card.rarity}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ color: '#00bcd4', ...mono, fontSize: '0.8rem', fontWeight: 700, borderColor: '#222' }}>
                    ${card.current_price?.toFixed(2)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color: card.rsi_14 != null ? (card.rsi_14 < 30 ? '#00ff41' : card.rsi_14 > 70 ? '#ff1744' : '#ccc') : '#333',
                      ...mono,
                      fontSize: '0.8rem',
                      borderColor: '#222',
                    }}
                  >
                    {card.rsi_14?.toFixed(0) ?? '—'}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color: card.price_change_7d != null ? (card.price_change_7d >= 0 ? '#00ff41' : '#ff1744') : '#333',
                      ...mono,
                      fontSize: '0.8rem',
                      borderColor: '#222',
                    }}
                  >
                    {card.price_change_7d != null ? `${card.price_change_7d >= 0 ? '+' : ''}${card.price_change_7d.toFixed(1)}%` : '—'}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color: card.price_change_30d != null ? (card.price_change_30d >= 0 ? '#00ff41' : '#ff1744') : '#333',
                      ...mono,
                      fontSize: '0.8rem',
                      borderColor: '#222',
                    }}
                  >
                    {card.price_change_30d != null ? `${card.price_change_30d >= 0 ? '+' : ''}${card.price_change_30d.toFixed(1)}%` : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ borderColor: '#222' }}>
                    {card.bollinger_position != null ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                        <Box sx={{ width: 40, height: 6, bgcolor: '#222', borderRadius: 1, position: 'relative' }}>
                          <Box
                            sx={{
                              position: 'absolute',
                              left: `${Math.min(Math.max(card.bollinger_position * 100, 0), 100)}%`,
                              top: -1,
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              bgcolor:
                                card.bollinger_position < 0.2
                                  ? '#00ff41'
                                  : card.bollinger_position > 0.8
                                    ? '#ff1744'
                                    : '#00bcd4',
                              transform: 'translateX(-50%)',
                            }}
                          />
                        </Box>
                        <Typography sx={{ color: '#888', ...mono, fontSize: '0.7rem' }}>
                          {card.bollinger_position.toFixed(2)}
                        </Typography>
                      </Box>
                    ) : (
                      <Typography sx={{ color: '#333', ...mono, fontSize: '0.8rem' }}>—</Typography>
                    )}
                  </TableCell>
                  {aiSignals && (
                    <>
                      <TableCell sx={{ borderColor: '#222' }}>
                        {card.signal ? <SignalChip signal={card.signal} conviction={card.conviction} /> : '—'}
                      </TableCell>
                      <TableCell sx={{ borderColor: '#222', maxWidth: 250 }}>
                        <Typography sx={{ color: '#999', ...mono, fontSize: '0.7rem', lineHeight: 1.3 }}>
                          {card.reasoning || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: '#4caf50', ...mono, fontSize: '0.75rem', borderColor: '#222' }}
                      >
                        {card.target_price != null ? `$${card.target_price.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: '#f44336', ...mono, fontSize: '0.75rem', borderColor: '#222' }}
                      >
                        {card.stop_loss != null ? `$${card.stop_loss.toFixed(2)}` : '—'}
                      </TableCell>
                    </>
                  )}
                  <TableCell sx={{ borderColor: '#222' }}>
                    {card.can_backtest && (
                      <Button
                        size="small"
                        startIcon={<ScienceIcon sx={{ fontSize: 14 }} />}
                        onClick={() => setBacktestCard({ id: card.card_id, name: card.name })}
                        sx={{
                          color: '#00bcd4',
                          ...mono,
                          fontSize: '0.65rem',
                          textTransform: 'none',
                          minWidth: 'auto',
                          py: 0.25,
                        }}
                      >
                        Backtest
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {!loading && filtered.length === 0 && (
        <Paper sx={{ p: 4, bgcolor: '#111', border: '1px solid #1e1e1e', textAlign: 'center' }}>
          <Typography sx={{ color: '#666', ...mono }}>
            {aiSignals ? 'No cards match this filter.' : 'No cards with sufficient daily price data.'}
          </Typography>
        </Paper>
      )}

      {/* Backtest dialog */}
      {backtestCard && (
        <BacktestDialog
          open={!!backtestCard}
          onClose={() => setBacktestCard(null)}
          cardId={backtestCard.id}
          cardName={backtestCard.name}
        />
      )}
    </Box>
  );
}
