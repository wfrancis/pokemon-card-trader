import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  Divider,
  Skeleton,
  Avatar,
  Select,
  MenuItem,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { MultiPersonaAnalysis, PersonaResult, AnalyzedCard, SnapshotSummary } from '../services/api';

const mono = { fontFamily: '"JetBrains Mono", "Fira Code", monospace' };

const TIER_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  premium: { label: 'PREMIUM', color: '#ffd700', border: '#ffd70033' },
  mid_high: { label: 'MID-HIGH', color: '#00bcd4', border: '#00bcd433' },
  mid: { label: 'MID', color: '#888', border: '#88888833' },
};

const SIGNAL_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  buy: { label: 'BUY', color: '#00ff41', bg: '#0a3a0a' },
  accumulate: { label: 'ACCUM', color: '#66ff99', bg: '#0a2a0a' },
  watch: { label: 'WATCH', color: '#ffd700', bg: '#2a2a0a' },
  hold: { label: 'HOLD', color: '#00bcd4', bg: '#1a1a2a' },
  bullish: { label: 'BULL', color: '#00ff41', bg: '#0a3a0a' },
  bearish: { label: 'BEAR', color: '#ff1744', bg: '#3a0a0a' },
};

function AnalyzedCardTile({ card, onClick }: { card: AnalyzedCard; onClick: () => void }) {
  const tier = TIER_CONFIG[card.price_tier] || TIER_CONFIG.mid;
  const signal = SIGNAL_CONFIG[card.signal] || { label: 'N/A', color: '#666', bg: '#1a1a1a' };
  const beColor = (card.breakeven_pct ?? 100) < 25 ? '#00ff41'
    : (card.breakeven_pct ?? 100) < 30 ? '#ffd700' : '#ff9800';

  return (
    <Paper
      sx={{
        p: 1, cursor: 'pointer', transition: 'all 0.15s',
        border: `1px solid ${tier.border}`, bgcolor: '#0a0a0a',
        '&:hover': { borderColor: tier.color, transform: 'translateY(-2px)' },
        height: '100%', display: 'flex', flexDirection: 'column',
      }}
      onClick={onClick}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Chip label={tier.label} size="small" sx={{
          bgcolor: `${tier.color}15`, color: tier.color,
          fontSize: '0.5rem', height: 16, fontWeight: 700, ...mono,
        }} />
        <Chip label={signal.label} size="small" sx={{
          bgcolor: signal.bg, color: signal.color,
          fontSize: '0.5rem', height: 16, fontWeight: 700, ...mono,
        }} />
      </Box>

      <Box sx={{ textAlign: 'center', mb: 0.5, flexShrink: 0 }}>
        <Avatar
          src={card.image_small || undefined}
          variant="rounded"
          sx={{ width: '100%', height: 'auto', aspectRatio: '2.5/3.5', mx: 'auto', bgcolor: '#1a1a1a' }}
          imgProps={{ loading: 'lazy' }}
        />
      </Box>

      <Typography sx={{
        color: '#fff', fontWeight: 600, fontSize: '0.7rem', ...mono,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {card.name}
      </Typography>
      <Typography sx={{
        color: '#666', fontSize: '0.55rem', ...mono,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', mb: 0.5,
      }}>
        {card.set_name}
      </Typography>

      <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono, fontSize: '0.85rem' }}>
        ${card.current_price.toFixed(2)}
      </Typography>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 'auto', pt: 0.5 }}>
        {card.breakeven_pct != null && (
          <Typography sx={{ color: beColor, fontSize: '0.5rem', ...mono }}>
            {card.breakeven_pct.toFixed(0)}% BE
          </Typography>
        )}
        {card.liquidity_score != null && (
          <Typography sx={{ color: '#00bcd4', fontSize: '0.5rem', ...mono }}>
            LIQ {card.liquidity_score.toFixed(0)}
          </Typography>
        )}
        {card.price_change_7d != null && (
          <Typography sx={{
            color: card.price_change_7d >= 0 ? '#00ff41' : '#ff1744',
            fontSize: '0.5rem', ...mono,
          }}>
            {card.price_change_7d >= 0 ? '+' : ''}{card.price_change_7d.toFixed(1)}%
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('### ')) {
      elements.push(
        <Typography key={i} variant="subtitle1" sx={{ color: '#ff9800', mt: 2, mb: 0.5, fontWeight: 700 }}>
          {trimmed.replace('### ', '')}
        </Typography>
      );
    } else if (trimmed.startsWith('## ')) {
      elements.push(
        <Typography key={i} variant="h6" sx={{ color: '#00bcd4', mt: 3, mb: 1, fontWeight: 700 }}>
          {trimmed.replace('## ', '')}
        </Typography>
      );
    } else if (trimmed.startsWith('# ')) {
      elements.push(
        <Typography key={i} variant="h5" sx={{ color: '#00ff41', mt: 3, mb: 1, fontWeight: 700 }}>
          {trimmed.replace('# ', '')}
        </Typography>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.replace(/^[-*] /, '');
      elements.push(
        <Typography key={i} sx={{ color: '#ccc', pl: 2, py: 0.2, ...mono, fontSize: '0.8rem' }}>
          {'• '}{renderBold(content)}
        </Typography>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      elements.push(
        <Typography key={i} sx={{ color: '#ccc', pl: 2, py: 0.2, ...mono, fontSize: '0.8rem' }}>
          {renderBold(trimmed)}
        </Typography>
      );
    } else if (trimmed === '---') {
      elements.push(<Divider key={i} sx={{ borderColor: '#333', my: 2 }} />);
    } else if (trimmed === '') {
      elements.push(<Box key={i} sx={{ height: 6 }} />);
    } else {
      elements.push(
        <Typography key={i} sx={{ color: '#ccc', py: 0.2, ...mono, fontSize: '0.8rem', lineHeight: 1.6 }}>
          {renderBold(trimmed)}
        </Typography>
      );
    }
  });

  return <>{elements}</>;
}

function renderBold(text: string): React.ReactNode[] {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} style={{ color: '#fff', fontWeight: 700 }}>{part}</span>
    ) : (
      part
    )
  );
}

function PersonaCard({ persona, loading }: { persona?: PersonaResult; loading: boolean }) {
  if (loading) {
    const placeholderColor = '#333';
    return (
      <Paper sx={{ p: 2, bgcolor: '#111', border: `1px solid #222`, height: '100%', minHeight: 400 }}>
        <Skeleton variant="text" sx={{ bgcolor: '#222', width: '60%', height: 28 }} />
        <Skeleton variant="text" sx={{ bgcolor: '#1a1a1a', width: '80%', height: 16, mt: 0.5 }} />
        <Box sx={{ display: 'flex', gap: 0.5, mt: 1, mb: 2 }}>
          <Skeleton variant="rounded" sx={{ bgcolor: '#1a1a1a', width: 80, height: 20, borderRadius: 10 }} />
          <Skeleton variant="rounded" sx={{ bgcolor: '#1a1a1a', width: 90, height: 20, borderRadius: 10 }} />
        </Box>
        {[...Array(12)].map((_, i) => (
          <Skeleton key={i} variant="text" sx={{ bgcolor: '#1a1a1a', width: `${60 + Math.random() * 40}%`, height: 14, mt: 0.5 }} />
        ))}
      </Paper>
    );
  }

  if (!persona) return null;

  return (
    <Paper sx={{
      p: 2,
      bgcolor: '#111',
      border: `1px solid ${persona.color}33`,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Persona header */}
      <Typography variant="subtitle2" sx={{ color: persona.color, fontWeight: 700, ...mono, letterSpacing: 1 }}>
        {persona.title}
      </Typography>
      <Typography sx={{ color: '#fff', fontWeight: 700, ...mono, fontSize: '1rem' }}>
        {persona.name}
      </Typography>
      <Typography sx={{ color: '#666', fontSize: '0.7rem', ...mono, mb: 1 }}>
        {persona.subtitle}
      </Typography>

      {/* Badges */}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
        {persona.badges.map(badge => (
          <Chip
            key={badge}
            label={badge}
            size="small"
            sx={{
              bgcolor: `${persona.color}15`,
              color: persona.color,
              ...mono,
              fontSize: '0.6rem',
              fontWeight: 600,
              height: 20,
            }}
          />
        ))}
      </Box>

      {/* Analysis content */}
      <Box sx={{ flex: 1, overflow: 'auto', maxHeight: 600 }}>
        {persona.error ? (
          <Alert severity="error" sx={{ bgcolor: '#1a0000', color: '#ff4444', fontSize: '0.8rem' }}>
            {persona.error}
          </Alert>
        ) : persona.analysis ? (
          <MarkdownBlock text={persona.analysis} />
        ) : (
          <Typography sx={{ color: '#444', ...mono, fontSize: '0.8rem' }}>
            No analysis generated.
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

export default function Trader() {
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<MultiPersonaAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SnapshotSummary[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | 'latest'>('latest');

  // Load latest saved analysis + history list on mount
  useEffect(() => {
    Promise.all([
      api.getLatestPersonaAnalysis().catch(() => ({ error: 'failed' } as MultiPersonaAnalysis)),
      api.getPersonaHistory().catch(() => [] as SnapshotSummary[]),
    ]).then(([latest, hist]) => {
      if (!latest.error) {
        setAnalysis(latest);
        if (hist.length > 0) setSelectedSnapshotId(hist[0].id);
      }
      setHistory(hist);
    }).finally(() => setInitialLoading(false));
  }, []);

  const loadSnapshot = async (snapshotId: number) => {
    setSelectedSnapshotId(snapshotId);
    try {
      const result = await api.getPersonaSnapshot(snapshotId);
      if (!result.error) setAnalysis(result);
    } catch {}
  };

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getMultiPersonaAnalysis();
      if (result.error) {
        setError(result.error);
      } else {
        setAnalysis(result);
        // Refresh history list (new snapshot was auto-saved)
        api.getPersonaHistory().then(hist => {
          setHistory(hist);
          if (hist.length > 0) setSelectedSnapshotId(hist[0].id);
        }).catch(() => {});
      }
    } catch (err: any) {
      setError(err.message || 'Failed to get trading desk analysis');
    } finally {
      setLoading(false);
    }
  };

  const personas = analysis?.personas;
  const personaOrder = ['quant', 'pm', 'liquidity'] as const;

  return (
    <Box sx={{ p: 2, maxWidth: 1600, mx: 'auto' }}>
      {/* Header */}
      <Paper sx={{
        p: 3, mb: 3, bgcolor: '#111', border: '1px solid #1e1e1e',
        background: 'linear-gradient(135deg, #111 0%, #1a1a2e 100%)',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <SmartToyIcon sx={{ color: '#00ff41', fontSize: 40 }} />
            <Box>
              <Typography variant="h5" sx={{ color: '#00ff41', fontWeight: 700, ...mono }}>
                AI TRADING DESK
              </Typography>
              <Typography sx={{ color: '#666', fontSize: '0.8rem', ...mono }}>
                3 SPECIALIZED ANALYSTS · PARALLEL EXECUTION · CONSENSUS SYNTHESIS
              </Typography>
              {history.length > 0 && !loading && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>
                    VIEWING:
                  </Typography>
                  <Select
                    size="small"
                    value={selectedSnapshotId}
                    onChange={(e) => {
                      const val = e.target.value as number;
                      loadSnapshot(val);
                    }}
                    sx={{
                      color: '#00bcd4', fontSize: '0.7rem', ...mono,
                      '& .MuiSelect-select': { py: 0.25, px: 1 },
                      '& .MuiOutlinedInput-notchedOutline': { borderColor: '#333' },
                      '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#00bcd4' },
                      '& .MuiSvgIcon-root': { color: '#666', fontSize: '1rem' },
                    }}
                  >
                    {history.map((snap) => (
                      <MenuItem key={snap.id} value={snap.id} sx={{ fontSize: '0.75rem', ...mono }}>
                        {new Date(snap.created_at).toLocaleString()} · {snap.pick_count} picks
                      </MenuItem>
                    ))}
                  </Select>
                </Box>
              )}
            </Box>
          </Box>

          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} sx={{ color: '#000' }} /> : <RocketLaunchIcon />}
            onClick={runAnalysis}
            disabled={loading}
            sx={{
              bgcolor: '#00ff41', color: '#000', fontWeight: 700, ...mono, px: 3,
              '&:hover': { bgcolor: '#00cc33' },
              '&:disabled': { bgcolor: '#333', color: '#666' },
            }}
          >
            {loading ? 'DEPLOYING ANALYSTS...' : 'DEPLOY ALL ANALYSTS'}
          </Button>
        </Box>

        {loading && (
          <Typography sx={{ color: '#666', mt: 1.5, fontSize: '0.75rem', ...mono }}>
            Running 3 parallel GPT-5.4 analyses + consensus synthesis... ~40s
          </Typography>
        )}
      </Paper>

      {/* Market Summary Bar */}
      {analysis?.market_data_summary && (
        <Paper sx={{ p: 1.5, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #222' }}>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <Box>
              <Typography sx={{ color: '#666', fontSize: '0.6rem', ...mono }}>CARDS</Typography>
              <Typography sx={{ color: '#fff', fontWeight: 700, ...mono, fontSize: '0.9rem' }}>
                {analysis.market_data_summary.total_cards}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: '#666', fontSize: '0.6rem', ...mono }}>AVG PRICE</Typography>
              <Typography sx={{ color: '#00bcd4', fontWeight: 700, ...mono, fontSize: '0.9rem' }}>
                ${analysis.market_data_summary.avg_price?.toFixed(2)}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: '#666', fontSize: '0.6rem', ...mono }}>MARKET CAP</Typography>
              <Typography sx={{ color: '#00bcd4', fontWeight: 700, ...mono, fontSize: '0.9rem' }}>
                ${analysis.market_data_summary.market_cap?.toLocaleString()}
              </Typography>
            </Box>
            {analysis.market_data_summary.top_gainer && (
              <Box>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', ...mono }}>TOP GAINER</Typography>
                <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono, fontSize: '0.85rem' }}>
                  {analysis.market_data_summary.top_gainer}
                </Typography>
              </Box>
            )}
            {analysis.market_data_summary.top_loser && (
              <Box>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', ...mono }}>TOP LOSER</Typography>
                <Typography sx={{ color: '#ff1744', fontWeight: 700, ...mono, fontSize: '0.85rem' }}>
                  {analysis.market_data_summary.top_loser}
                </Typography>
              </Box>
            )}
          </Box>
        </Paper>
      )}

      {/* Trading Economics Bar — Tier-Segmented */}
      {analysis?.trading_economics && (
        <Paper sx={{ p: 1.5, mb: 2, bgcolor: '#1a0a0a', border: '1px solid #ff9800', borderStyle: 'dashed' }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Box>
              <Typography sx={{ color: '#ff9800', fontSize: '0.6rem', fontWeight: 700, ...mono }}>PLATFORM</Typography>
              <Typography sx={{ color: '#fff', fontWeight: 700, ...mono, fontSize: '0.8rem' }}>
                TCGPlayer
              </Typography>
            </Box>
            <Box sx={{ borderLeft: '1px solid #333', pl: 2 }}>
              <Typography sx={{ color: '#ff9800', fontSize: '0.6rem', fontWeight: 700, ...mono }}>$100+ BREAKEVEN</Typography>
              <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono, fontSize: '0.8rem' }}>
                {analysis.trading_economics.fee_schedule?.examples?.['$100_card']?.breakeven_appreciation_pct ?? '~22'}%
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: '#ff9800', fontSize: '0.6rem', fontWeight: 700, ...mono }}>$50 BREAKEVEN</Typography>
              <Typography sx={{ color: '#ffd700', fontWeight: 700, ...mono, fontSize: '0.8rem' }}>
                {analysis.trading_economics.fee_schedule?.examples?.['$50_card']?.breakeven_appreciation_pct ?? '~28'}%
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: '#ff9800', fontSize: '0.6rem', fontWeight: 700, ...mono }}>$20 BREAKEVEN</Typography>
              <Typography sx={{ color: '#ff9800', fontWeight: 700, ...mono, fontSize: '0.8rem' }}>
                {analysis.trading_economics.fee_schedule?.examples?.['$20_card']?.breakeven_appreciation_pct ?? '~38'}%
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: '#ff9800', fontSize: '0.6rem', fontWeight: 700, ...mono }}>$10 BREAKEVEN</Typography>
              <Typography sx={{ color: '#ff1744', fontWeight: 700, ...mono, fontSize: '0.8rem' }}>
                {analysis.trading_economics.fee_schedule?.examples?.['$10_card']?.breakeven_appreciation_pct ?? '~61'}%
              </Typography>
            </Box>
            <Box sx={{ borderLeft: '1px solid #333', pl: 2 }}>
              <Typography sx={{ color: '#ff9800', fontSize: '0.6rem', fontWeight: 700, ...mono }}>TRADEABLE</Typography>
              <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono, fontSize: '0.8rem' }}>
                {analysis.trading_economics.cards_above_minimum_trade_size}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: '#ff9800', fontSize: '0.6rem', fontWeight: 700, ...mono }}>EXCLUDED</Typography>
              <Typography sx={{ color: '#666', fontWeight: 700, ...mono, fontSize: '0.8rem' }}>
                {analysis.trading_economics.cards_below_minimum_trade_size}
              </Typography>
            </Box>
          </Box>
        </Paper>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2, bgcolor: '#1a0000', color: '#ff4444' }}>
          {error}
        </Alert>
      )}

      {/* 3-Column Persona Grid */}
      {(loading || personas) && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {personaOrder.map(pid => (
            <Grid key={pid} size={{ xs: 12, md: 4 }}>
              <PersonaCard
                persona={personas?.[pid]}
                loading={loading && !personas}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Consensus Panel */}
      {analysis?.consensus && (
        <Paper sx={{ p: 3, mb: 2, bgcolor: '#111', border: '1px solid #ffffff33' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box sx={{ width: 4, height: 28, bgcolor: '#fff', borderRadius: 1 }} />
            <Box>
              <Typography variant="h6" sx={{ color: '#fff', fontWeight: 700, ...mono }}>
                DESK CONSENSUS
              </Typography>
              <Typography sx={{ color: '#888', fontSize: '0.7rem', ...mono }}>
                CIO SYNTHESIS — HIGH CONVICTION CALLS
              </Typography>
            </Box>
          </Box>
          <MarkdownBlock text={analysis.consensus} />
        </Paper>
      )}

      {/* Consensus Picks — Card Tiles */}
      {analysis?.consensus_picks && analysis.consensus_picks.length > 0 && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #ffd70033' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box sx={{ width: 4, height: 24, bgcolor: '#ffd700', borderRadius: 1 }} />
            <Box>
              <Typography variant="h6" sx={{ color: '#ffd700', fontWeight: 700, ...mono, fontSize: '1rem' }}>
                RECOMMENDED PICKS
              </Typography>
              <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>
                {analysis.consensus_picks.length} CONSENSUS CARDS · CLICK TO VIEW DETAIL &amp; CHARTS
              </Typography>
            </Box>
          </Box>

          {(['premium', 'mid_high', 'mid'] as const).map(tier => {
            const tierCards = analysis.consensus_picks!.filter(c => c.price_tier === tier);
            if (tierCards.length === 0) return null;
            const tierLabel = { premium: 'CORE HOLDINGS ($100+)', mid_high: 'ACTIVE TRADES ($50-100)', mid: 'GROWTH PLAYS ($20-50)' }[tier];
            const tierColor = { premium: '#ffd700', mid_high: '#00bcd4', mid: '#888' }[tier];
            return (
              <Box key={tier} sx={{ mb: 2 }}>
                <Typography sx={{ color: tierColor, fontWeight: 700, fontSize: '0.75rem', ...mono, mb: 1 }}>
                  {tierLabel} — {tierCards.length} picks
                </Typography>
                <Grid container spacing={1}>
                  {tierCards.map(card => (
                    <Grid key={card.card_id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                      <AnalyzedCardTile card={card} onClick={() => navigate(`/card/${card.card_id}`)} />
                    </Grid>
                  ))}
                </Grid>
              </Box>
            );
          })}
        </Paper>
      )}

      {/* Token Usage */}
      {analysis?.tokens_used && (
        <Box sx={{ mt: 1, textAlign: 'right' }}>
          <Typography sx={{ color: '#444', fontSize: '0.7rem', ...mono }}>
            TOKENS: {analysis.tokens_used.input.toLocaleString()} in / {analysis.tokens_used.output.toLocaleString()} out
            {' · '}4 GPT-5.4 calls (3 parallel + consensus)
          </Typography>
        </Box>
      )}

      {/* Empty State */}
      {!analysis && !loading && !initialLoading && !error && (
        <Paper sx={{ p: 4, bgcolor: '#111', border: '1px solid #1e1e1e', textAlign: 'center' }}>
          <SmartToyIcon sx={{ color: '#333', fontSize: 60, mb: 2 }} />
          <Typography sx={{ color: '#666', ...mono, mb: 1 }}>
            Click "DEPLOY ALL ANALYSTS" to activate the trading desk
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3, mt: 2 }}>
            {Object.values({
              quant: { title: 'QUANT', color: '#00bcd4', name: 'Dr. Sarah Chen' },
              pm: { title: 'HEDGE FUND PM', color: '#ffd700', name: 'Jamie Blackwood' },
              liquidity: { title: 'LIQUIDITY', color: '#ff9800', name: 'Kai Nakamura' },
            }).map(p => (
              <Box key={p.title} sx={{ textAlign: 'center' }}>
                <Typography sx={{ color: p.color, fontWeight: 700, ...mono, fontSize: '0.75rem' }}>
                  {p.title}
                </Typography>
                <Typography sx={{ color: '#555', ...mono, fontSize: '0.7rem' }}>
                  {p.name}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      )}
    </Box>
  );
}
