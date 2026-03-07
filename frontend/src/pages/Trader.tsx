import React, { useState } from 'react';
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
} from '@mui/material';
import Grid from '@mui/material/Grid';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { api } from '../services/api';
import type { MultiPersonaAnalysis, PersonaResult } from '../services/api';

const mono = { fontFamily: '"JetBrains Mono", "Fira Code", monospace' };

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
  const [analysis, setAnalysis] = useState<MultiPersonaAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getMultiPersonaAnalysis();
      if (result.error) {
        setError(result.error);
      } else {
        setAnalysis(result);
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
      {!analysis && !loading && !error && (
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
