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
import type { MultiPersonaAnalysis, PersonaResult, AnalyzedCard, SnapshotSummary, BacktestPickResult, AgentPrediction, AccuracyReport, AgentAnalysisResult } from '../services/api';

const mono = { fontFamily: '"JetBrains Mono", "Fira Code", monospace' };

const TIER_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  premium: { label: 'PREMIUM', color: '#ffd700', border: '#ffd70033' },
  mid_high: { label: 'MID-HIGH', color: '#00bcd4', border: '#00bcd433' },
  mid: { label: 'MID', color: '#888', border: '#88888833' },
};

const SIGNAL_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  buy: { label: 'BUY', color: '#00e676', bg: '#0a3a0a' },
  accumulate: { label: 'ACCUMULATE', color: '#69f0ae', bg: '#0a2a0a' },
  hold: { label: 'HOLD', color: '#ffd740', bg: '#2a2a0a' },
  watch: { label: 'HOLD', color: '#ffd740', bg: '#2a2a0a' },
  sell: { label: 'REDUCE', color: '#ff9100', bg: '#2a1a0a' },
  reduce: { label: 'REDUCE', color: '#ff9100', bg: '#2a1a0a' },
  avoid: { label: 'AVOID', color: '#ff1744', bg: '#3a0a0a' },
  bullish: { label: 'BUY', color: '#00e676', bg: '#0a3a0a' },
  bearish: { label: 'AVOID', color: '#ff1744', bg: '#3a0a0a' },
  neutral: { label: 'HOLD', color: '#ffd740', bg: '#2a2a0a' },
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

/** Detect tier section headers for special rendering */
const TIER_HEADERS: Record<string, { color: string; label: string }> = {
  'core holdings': { color: '#ffd700', label: 'PREMIUM' },
  'active trades': { color: '#00bcd4', label: 'MID-HIGH' },
  'growth plays': { color: '#ff9800', label: 'MID' },
  'watchlist': { color: '#888', label: 'WATCH' },
};

function isTierHeader(text: string): { color: string; label: string } | null {
  const lower = text.toLowerCase().replace(/[#*]/g, '').trim();
  for (const [key, val] of Object.entries(TIER_HEADERS)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    // Check for tier section headers (e.g., "### CORE HOLDINGS (Premium $100+)")
    const tierInfo = (trimmed.startsWith('#') || trimmed.startsWith('**')) ? isTierHeader(trimmed) : null;
    if (tierInfo) {
      const headerText = trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
      elements.push(
        <Box key={i} sx={{
          mt: 3, mb: 1.5, py: 1, px: 2,
          borderLeft: `3px solid ${tierInfo.color}`,
          bgcolor: `${tierInfo.color}08`,
          borderRadius: '0 4px 4px 0',
        }}>
          <Typography sx={{
            color: tierInfo.color, fontWeight: 700, ...mono,
            fontSize: '0.95rem', letterSpacing: 1.5,
          }}>
            {headerText}
          </Typography>
        </Box>
      );
      return;
    }

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

/** Normalize unicode quotes/dashes for comparison */
function normalize(s: string): string {
  return s
    .replace(/[\u2019\u2018]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2014\u2013]/g, '-')
    .toLowerCase();
}

/** Find the matching pick for a recommendation line */
function findPickForLine(line: string, picks: AnalyzedCard[], usedIds: Set<number>): AnalyzedCard | null {
  const lineLower = normalize(line);
  // Prefer longest name match first
  const sorted = [...picks].sort((a, b) => b.name.length - a.name.length);
  for (const pick of sorted) {
    if (usedIds.has(pick.card_id)) continue;
    if (lineLower.includes(normalize(pick.name))) {
      usedIds.add(pick.card_id);
      return pick;
    }
  }
  return null;
}

interface ConsensusSection {
  type: 'text' | 'rec';
  content: string;
  pick?: AnalyzedCard;
}

/** Tier header patterns to split on (so they don't get absorbed into the previous recommendation) */
const TIER_HEADER_RE = /^#+\s*(CORE HOLDINGS|ACTIVE TRADES|GROWTH PLAYS|WATCHLIST)/im;

/** Parse consensus text into sections, matching recommendation blocks to picks */
function parseConsensusWithPicks(text: string, picks: AnalyzedCard[]): ConsensusSection[] {
  const sections: ConsensusSection[] = [];
  const usedIds = new Set<number>();

  // Split at numbered recommendation boundaries AND tier section headers
  // This regex splits at: numbered items (N) ...) OR markdown headers containing tier keywords
  const parts = text.split(/\n(?=\s*\*{0,2}\d+\)\s|#+\s*(?:CORE HOLDINGS|ACTIVE TRADES|GROWTH PLAYS|WATCHLIST))/i);

  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    const match = part.match(/^\s*\*{0,2}(\d+)\)\s/);

    if (match) {
      // Check if this recommendation block contains a tier header mid-way
      // If so, split it: keep the rec content before the header, push the rest as text
      const tierIdx = part.search(/\n(?=#+\s*(?:CORE HOLDINGS|ACTIVE TRADES|GROWTH PLAYS|WATCHLIST))/i);
      let trailingText: string | null = null;
      if (tierIdx > 0) {
        trailingText = part.slice(tierIdx + 1); // text from the tier header onward
        part = part.slice(0, tierIdx);           // rec content before the header
      }

      const firstLine = part.split('\n')[0];
      const pick = findPickForLine(firstLine, picks, usedIds);

      if (pick) {
        sections.push({ type: 'rec', content: part, pick });
      } else {
        sections.push({ type: 'text', content: part });
      }

      // Push the trailing tier header as its own text section
      if (trailingText) {
        sections.push({ type: 'text', content: trailingText });
      }
    } else {
      sections.push({ type: 'text', content: part });
    }
  }

  return sections;
}

/** Inline recommendation: card image + analysis text side by side */
function InlineRecommendation({
  content,
  pick,
  onClick,
  backtestResult,
}: {
  content: string;
  pick: AnalyzedCard;
  onClick: () => void;
  backtestResult?: BacktestPickResult;
}) {
  const tier = TIER_CONFIG[pick.price_tier] || TIER_CONFIG.mid;
  const signal = SIGNAL_CONFIG[pick.signal] || { label: 'N/A', color: '#666', bg: '#1a1a1a' };

  // Strip the first line header (e.g. "**1) Umbreon VMAX SR — ...") and render the detail lines
  const lines = content.split('\n');
  // First line is the card title — we render it as a styled header
  const titleLine = lines[0].replace(/^\s*\*{0,2}\d+\)\s*/, '').replace(/\*\*/g, '').trim();
  const detailText = lines.slice(1).join('\n');

  return (
    <Paper
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        gap: { xs: 1.5, sm: 2 },
        p: { xs: 1.5, sm: 2 },
        mb: 1.5,
        bgcolor: '#0d0d0d',
        border: `1px solid ${tier.border}`,
        cursor: 'pointer',
        transition: 'all 0.15s',
        '&:hover': { borderColor: tier.color, bgcolor: '#111' },
      }}
      onClick={onClick}
    >
      {/* Left: Card image */}
      <Box sx={{
        flexShrink: 0,
        width: { xs: '100%', sm: 140 },
        display: 'flex',
        flexDirection: { xs: 'row', sm: 'column' },
        alignItems: { xs: 'center', sm: 'stretch' },
        gap: 1,
      }}>
        <Avatar
          src={pick.image_small || undefined}
          variant="rounded"
          sx={{
            width: { xs: 100, sm: 140 },
            height: 'auto',
            aspectRatio: '2.5/3.5',
            bgcolor: '#1a1a1a',
          }}
          imgProps={{ loading: 'lazy' }}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: { xs: 'flex-start', sm: 'center' } }}>
          <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono, fontSize: '1.1rem' }}>
            ${pick.current_price.toFixed(2)}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Chip label={tier.label} size="small" sx={{
              bgcolor: `${tier.color}15`, color: tier.color,
              fontSize: '0.55rem', height: 18, fontWeight: 700, ...mono,
            }} />
            <Chip label={signal.label} size="small" sx={{
              bgcolor: signal.bg, color: signal.color,
              fontSize: '0.55rem', height: 18, fontWeight: 700, ...mono,
            }} />
          </Box>
          {pick.breakeven_pct != null && (
            <Typography sx={{ color: '#ff9800', fontSize: '0.65rem', ...mono }}>
              {pick.breakeven_pct.toFixed(0)}% BE
            </Typography>
          )}
          <Typography sx={{ color: '#00bcd4', fontSize: '0.6rem', ...mono }}>
            View charts &rarr;
          </Typography>
        </Box>
      </Box>

      {/* Right: Analysis text */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          color: '#fff', fontWeight: 700, ...mono, fontSize: '0.9rem', mb: 0.5,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {titleLine}
        </Typography>
        <MarkdownBlock text={detailText} />

        {/* Historical Buy & Hold Backtest */}
        {backtestResult && !backtestResult.error && (
          <Box sx={{
            mt: 1.5, pt: 1, borderTop: '1px solid #222',
            display: 'flex', gap: { xs: 1, sm: 2 }, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <Typography sx={{ color: '#666', fontSize: '0.6rem', fontWeight: 700, ...mono, letterSpacing: 1 }}>
              BUY & HOLD
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography sx={{
                color: (backtestResult.fee_adjusted_return_pct ?? 0) >= 0 ? '#00ff41' : '#ff1744',
                fontSize: '0.7rem', fontWeight: 700, ...mono,
              }}>
                {(backtestResult.fee_adjusted_return_pct ?? 0) >= 0 ? '+' : ''}
                {backtestResult.fee_adjusted_return_pct?.toFixed(1)}% after fees
              </Typography>
              <Typography sx={{ color: '#888', fontSize: '0.65rem', ...mono }}>
                raw {(backtestResult.buy_hold_return_pct ?? 0) >= 0 ? '+' : ''}{backtestResult.buy_hold_return_pct?.toFixed(1)}%
              </Typography>
              <Typography sx={{ color: '#888', fontSize: '0.65rem', ...mono }}>
                {backtestResult.hold_days ?? '?'}d hold
              </Typography>
              <Typography sx={{ color: '#888', fontSize: '0.65rem', ...mono }}>
                -{backtestResult.max_drawdown_pct?.toFixed(0)}% max DD
              </Typography>
              <Chip
                label={backtestResult.profitable_after_fees ? 'PROFITABLE' : 'UNPROFITABLE'}
                size="small"
                sx={{
                  bgcolor: backtestResult.profitable_after_fees ? '#00ff4115' : '#ff174415',
                  color: backtestResult.profitable_after_fees ? '#00ff41' : '#ff1744',
                  fontSize: '0.5rem', height: 16, fontWeight: 700, ...mono,
                }}
              />
            </Box>
          </Box>
        )}
        {backtestResult?.error && (
          <Box sx={{ mt: 1, pt: 0.5, borderTop: '1px solid #222' }}>
            <Typography sx={{ color: '#555', fontSize: '0.6rem', ...mono }}>
              BACKTEST: {backtestResult.error}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
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
  const [backtestResults, setBacktestResults] = useState<Record<number, BacktestPickResult>>({});
  const [agentLoading, setAgentLoading] = useState(false);
  const [predictions, setPredictions] = useState<AgentPrediction[]>([]);
  const [accuracy, setAccuracy] = useState<AccuracyReport | null>(null);
  const [activeTab, setActiveTab] = useState<'desk' | 'predictions'>('desk');

  // Set page title
  useEffect(() => {
    document.title = 'AI Trader | PKMN Trader';
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, []);

  // Load latest saved analysis + history list on mount
  useEffect(() => {
    Promise.all([
      api.getLatestPersonaAnalysis().catch(() => ({ error: 'failed' } as MultiPersonaAnalysis)),
      api.getPersonaHistory().catch(() => [] as SnapshotSummary[]),
    ]).then(([latest, hist]) => {
      if (!latest.error) {
        setAnalysis(latest);
        if (hist.length > 0) setSelectedSnapshotId(hist[0].id);
        // Auto-fetch backtest results for consensus picks
        api.backtestPicks().then(setBacktestResults).catch(() => {});
      }
      setHistory(hist);
    }).finally(() => setInitialLoading(false));
  }, []);

  const loadSnapshot = async (snapshotId: number) => {
    setSelectedSnapshotId(snapshotId);
    try {
      const result = await api.getPersonaSnapshot(snapshotId);
      if (!result.error) {
        setAnalysis(result);
        api.backtestPicks().then(setBacktestResults).catch(() => {});
      }
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
        // Auto-fetch backtest results for new picks
        api.backtestPicks().then(setBacktestResults).catch(() => {});
      }
    } catch (err: any) {
      setError(err.message || 'Failed to get trading desk analysis');
    } finally {
      setLoading(false);
    }
  };

  // Load predictions and accuracy
  useEffect(() => {
    api.getAgentPredictions(undefined, 30).then(setPredictions).catch(() => {});
    api.getAgentAccuracy().then(setAccuracy).catch(() => {});
  }, []);

  const runAgent = async () => {
    setAgentLoading(true);
    setError(null);
    try {
      const result = await api.runAgentAnalysis('gpt-5');
      if (result.error) {
        setError(result.error);
      } else {
        // Refresh predictions after agent run
        api.getAgentPredictions(undefined, 30).then(setPredictions).catch(() => {});
        api.getAgentAccuracy().then(setAccuracy).catch(() => {});
        // Refresh analysis if one was produced
        api.getLatestPersonaAnalysis().then((latest) => {
          if (!latest.error) setAnalysis(latest);
        }).catch(() => {});
        api.getPersonaHistory().then(setHistory).catch(() => {});
      }
    } catch (err: any) {
      setError(err.message || 'Agent analysis failed');
    } finally {
      setAgentLoading(false);
    }
  };

  const personas = analysis?.personas;
  const personaOrder = ['quant', 'data_analytics', 'art_sales', 'liquidity', 'swe', 'pokemon_expert'] as const;

  return (
    <Box sx={{ p: { xs: 1.5, md: 2 }, maxWidth: 1600, mx: 'auto' }}>
      {/* Header */}
      <Paper sx={{
        p: { xs: 2, md: 3 }, mb: 3, bgcolor: '#111', border: '1px solid #1e1e1e',
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
                6 SPECIALIZED ANALYSTS · PARALLEL EXECUTION · CONSENSUS SYNTHESIS
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

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={agentLoading ? <CircularProgress size={16} sx={{ color: '#000' }} /> : <SmartToyIcon />}
              onClick={runAgent}
              disabled={agentLoading || loading}
              sx={{
                bgcolor: '#00bcd4', color: '#000', fontWeight: 700, ...mono, px: 3,
                '&:hover': { bgcolor: '#0097a7' },
                '&:disabled': { bgcolor: '#333', color: '#666' },
              }}
            >
              {agentLoading ? 'SCANNING...' : 'QUICK SCAN'}
            </Button>
            <Button
              variant="contained"
              startIcon={loading ? <CircularProgress size={16} sx={{ color: '#000' }} /> : <RocketLaunchIcon />}
              onClick={runAnalysis}
              disabled={loading || agentLoading}
              sx={{
                bgcolor: '#00ff41', color: '#000', fontWeight: 700, ...mono, px: 3,
                '&:hover': { bgcolor: '#00cc33' },
                '&:disabled': { bgcolor: '#333', color: '#666' },
              }}
            >
              {loading ? 'DEPLOYING...' : 'RUN FULL ANALYSIS'}
            </Button>
          </Box>
        </Box>

        {loading && (
          <Typography sx={{ color: '#666', mt: 1.5, fontSize: '0.75rem', ...mono }}>
            Running 6 parallel GPT-5.4 analyses + consensus synthesis...
          </Typography>
        )}
      </Paper>

      {/* Tab Toggle */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        {(['desk', 'predictions'] as const).map((tab) => (
          <Chip
            key={tab}
            label={tab === 'desk' ? 'TRADING DESK' : 'TRACK RECORD'}
            onClick={() => setActiveTab(tab)}
            sx={{
              ...mono, fontWeight: 700, fontSize: '0.7rem',
              bgcolor: activeTab === tab ? '#00ff4120' : '#1a1a1a',
              color: activeTab === tab ? '#00ff41' : '#666',
              border: `1px solid ${activeTab === tab ? '#00ff4144' : '#333'}`,
              '&:hover': { bgcolor: activeTab === tab ? '#00ff4130' : '#222' },
            }}
          />
        ))}
        {accuracy && accuracy.resolved > 0 && (
          <Chip
            label={`${accuracy.overall_hit_rate}% accuracy`}
            size="small"
            sx={{
              ...mono, fontSize: '0.6rem', height: 24, ml: 'auto',
              bgcolor: 'transparent',
              color: (accuracy.overall_hit_rate ?? 0) >= 60 ? '#00ff41' : (accuracy.overall_hit_rate ?? 0) >= 50 ? '#ffd700' : '#ff1744',
              border: '1px solid #333',
            }}
          />
        )}
      </Box>

      {/* Predictions Tab */}
      {activeTab === 'predictions' && (
        <Box>
          {/* Accuracy Summary */}
          {accuracy && accuracy.resolved > 0 && (
            <Paper sx={{ p: 2, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #222' }}>
              <Typography sx={{ ...mono, fontSize: '0.7rem', color: '#555', mb: 1, textTransform: 'uppercase' }}>
                Prediction Accuracy
              </Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6, md: 3 }}>
                  <Typography sx={{ ...mono, fontSize: '0.6rem', color: '#666' }}>OVERALL</Typography>
                  <Typography sx={{
                    ...mono, fontSize: '1.5rem', fontWeight: 700,
                    color: (accuracy.overall_hit_rate ?? 0) >= 60 ? '#00ff41' : '#ffd700',
                  }}>
                    {accuracy.overall_hit_rate}%
                  </Typography>
                  <Typography sx={{ ...mono, fontSize: '0.6rem', color: '#555' }}>
                    {accuracy.resolved} resolved / {accuracy.pending} pending
                  </Typography>
                </Grid>
                {Object.entries(accuracy.by_persona).map(([persona, stats]) => (
                  <Grid size={{ xs: 6, md: 3 }} key={persona}>
                    <Typography sx={{ ...mono, fontSize: '0.6rem', color: '#666', textTransform: 'uppercase' }}>
                      {persona}
                    </Typography>
                    <Typography sx={{
                      ...mono, fontSize: '1.2rem', fontWeight: 700,
                      color: stats.hit_rate >= 60 ? '#00ff41' : stats.hit_rate >= 50 ? '#ffd700' : '#ff1744',
                    }}>
                      {stats.hit_rate}%
                    </Typography>
                    <Typography sx={{ ...mono, fontSize: '0.55rem', color: '#555' }}>
                      {stats.correct}/{stats.total}
                    </Typography>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          )}

          {/* Predictions Table */}
          <Paper sx={{ bgcolor: '#0a0a0a', border: '1px solid #222', overflow: 'hidden' }}>
            <Box sx={{ p: 1.5, borderBottom: '1px solid #222' }}>
              <Typography sx={{ ...mono, fontSize: '0.7rem', color: '#555', textTransform: 'uppercase' }}>
                Active Predictions ({predictions.length})
              </Typography>
            </Box>
            {predictions.length === 0 ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography sx={{ ...mono, fontSize: '0.75rem', color: '#555' }}>
                  No predictions yet. Run the agent to generate picks.
                </Typography>
              </Box>
            ) : (
              predictions.map((pred) => {
                const returnPct = pred.current_price && pred.entry_price
                  ? ((pred.current_price - pred.entry_price) / pred.entry_price) * 100
                  : null;
                const outcomeColor = pred.outcome === 'correct' ? '#00ff41'
                  : pred.outcome === 'incorrect' ? '#ff1744'
                  : '#ffd700';
                const signal = SIGNAL_CONFIG[pred.signal] || { label: pred.signal?.toUpperCase(), color: '#888', bg: '#1a1a1a' };

                return (
                  <Box
                    key={pred.id}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1, p: 1,
                      borderBottom: '1px solid #111', cursor: 'pointer',
                      '&:hover': { bgcolor: '#111' },
                    }}
                    onClick={() => navigate(`/card/${pred.card_id}`)}
                  >
                    {pred.card_image && (
                      <Avatar src={pred.card_image} variant="rounded" sx={{ width: 28, height: 38 }} />
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ ...mono, fontSize: '0.7rem', color: '#fff', fontWeight: 600 }} noWrap>
                        {pred.card_name}
                      </Typography>
                      <Typography sx={{ ...mono, fontSize: '0.55rem', color: '#555' }}>
                        {pred.persona_source} · {new Date(pred.predicted_at).toLocaleDateString()}
                      </Typography>
                    </Box>
                    <Chip
                      label={signal.label}
                      size="small"
                      sx={{ ...mono, fontSize: '0.5rem', height: 16, color: signal.color, bgcolor: signal.bg }}
                    />
                    <Box sx={{ textAlign: 'right', minWidth: 60 }}>
                      <Typography sx={{ ...mono, fontSize: '0.65rem', color: '#888' }}>
                        ${pred.entry_price?.toFixed(2)}
                      </Typography>
                      {pred.current_price && (
                        <Typography sx={{
                          ...mono, fontSize: '0.65rem', fontWeight: 700,
                          color: returnPct && returnPct > 0 ? '#00ff41' : '#ff1744',
                        }}>
                          ${pred.current_price.toFixed(2)} ({returnPct ? `${returnPct > 0 ? '+' : ''}${returnPct.toFixed(1)}%` : '—'})
                        </Typography>
                      )}
                    </Box>
                    <Chip
                      label={pred.outcome.toUpperCase()}
                      size="small"
                      sx={{
                        ...mono, fontSize: '0.5rem', height: 16, minWidth: 60,
                        color: outcomeColor, bgcolor: 'transparent', border: `1px solid ${outcomeColor}44`,
                      }}
                    />
                  </Box>
                );
              })
            )}
          </Paper>
        </Box>
      )}

      {/* Trading Desk Tab */}
      {activeTab === 'desk' && <>
      {/* Market Summary Bar */}
      {analysis?.market_data_summary && (
        <Paper sx={{ p: 1.5, mb: 2, bgcolor: '#0a0a0a', border: '1px solid #222' }}>
          <Box sx={{ display: 'flex', gap: { xs: 1.5, md: 3 }, flexWrap: 'wrap' }}>
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
          <Box sx={{ display: 'flex', gap: { xs: 1, md: 2 }, flexWrap: 'wrap', alignItems: 'center' }}>
            <Box>
              <Typography sx={{ color: '#ff9800', fontSize: '0.6rem', fontWeight: 700, ...mono }}>PLATFORM</Typography>
              <Typography sx={{ color: '#fff', fontWeight: 700, ...mono, fontSize: '0.8rem' }}>
                TCGPlayer
              </Typography>
            </Box>
            <Box sx={{ borderLeft: { xs: 'none', md: '1px solid #333' }, pl: { xs: 0, md: 2 } }}>
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
            <Box sx={{ borderLeft: { xs: 'none', md: '1px solid #333' }, pl: { xs: 0, md: 2 } }}>
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
        <Grid container spacing={{ xs: 1.5, md: 2 }} sx={{ mb: 2 }}>
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

      {/* Consensus Panel — with inline card visuals for each recommendation */}
      {analysis?.consensus && (
        <Paper sx={{ p: { xs: 1.5, md: 3 }, mb: 2, bgcolor: '#111', border: '1px solid #ffffff33' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box sx={{ width: 4, height: 28, bgcolor: '#fff', borderRadius: 1 }} />
            <Box>
              <Typography variant="h6" sx={{ color: '#fff', fontWeight: 700, ...mono }}>
                DESK CONSENSUS
              </Typography>
              <Typography sx={{ color: '#888', fontSize: '0.7rem', ...mono }}>
                CIO SYNTHESIS — HIGH CONVICTION CALLS
                {analysis.consensus_picks && analysis.consensus_picks.length > 0 && (
                  <> · {analysis.consensus_picks.length} PICKS · CLICK ANY CARD TO VIEW CHARTS</>
                )}
              </Typography>
            </Box>
          </Box>

          {(() => {
            const picks = analysis.consensus_picks || [];
            const sections = parseConsensusWithPicks(analysis.consensus, picks);

            return sections.map((section, i) => {
              if (section.type === 'rec' && section.pick) {
                return (
                  <InlineRecommendation
                    key={i}
                    content={section.content}
                    pick={section.pick}
                    onClick={() => navigate(`/card/${section.pick!.card_id}`)}
                    backtestResult={backtestResults[section.pick!.card_id]}
                  />
                );
              }
              return <MarkdownBlock key={i} text={section.content} />;
            });
          })()}
        </Paper>
      )}

      {/* Token Usage */}
      {analysis?.tokens_used && (
        <Box sx={{ mt: 1, textAlign: 'right' }}>
          <Typography sx={{ color: '#444', fontSize: '0.7rem', ...mono }}>
            TOKENS: {analysis.tokens_used.input.toLocaleString()} in / {analysis.tokens_used.output.toLocaleString()} out
            {' · '}7 GPT-5.4 calls (6 parallel + consensus)
          </Typography>
        </Box>
      )}

      {/* Empty State */}
      {!analysis && !loading && !initialLoading && !error && (
        <Paper sx={{ p: 4, bgcolor: '#111', border: '1px solid #1e1e1e', textAlign: 'center' }}>
          <SmartToyIcon sx={{ color: '#333', fontSize: 60, mb: 2 }} />
          <Typography sx={{ color: '#666', ...mono, mb: 1 }}>
            Click "QUICK SCAN" for autonomous analysis or "RUN FULL ANALYSIS" for 6 parallel analysts
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: { xs: 1.5, md: 2 }, mt: 2, flexWrap: 'wrap' }}>
            {Object.values({
              quant: { title: 'QUANT', color: '#00bcd4' },
              data_analytics: { title: 'DATA ANALYTICS', color: '#ffd700' },
              art_sales: { title: 'ART & SALES', color: '#e040fb' },
              liquidity: { title: 'CONTRARIAN VALUE', color: '#ff9800' },
              swe: { title: 'SWE', color: '#69f0ae' },
              pokemon_expert: { title: 'POKEMON EXPERT', color: '#ff1744' },
            }).map(p => (
              <Box key={p.title} sx={{ textAlign: 'center' }}>
                <Typography sx={{ color: p.color, fontWeight: 700, ...mono, fontSize: '0.75rem' }}>
                  {p.title}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      )}
      </>}
    </Box>
  );
}
