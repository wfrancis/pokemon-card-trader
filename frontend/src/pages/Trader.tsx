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
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { api } from '../services/api';
import type { TraderAnalysis } from '../services/api';

const mono = { fontFamily: '"JetBrains Mono", "Fira Code", monospace' };

function MarkdownBlock({ text }: { text: string }) {
  // Simple markdown-to-JSX: headers, bold, bullets, numbered lists
  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      elements.push(
        <Typography
          key={i}
          variant="h6"
          sx={{ color: '#00bcd4', mt: 3, mb: 1, fontWeight: 700 }}
        >
          {trimmed.replace('## ', '')}
        </Typography>
      );
    } else if (trimmed.startsWith('# ')) {
      elements.push(
        <Typography
          key={i}
          variant="h5"
          sx={{ color: '#00ff41', mt: 3, mb: 1, fontWeight: 700 }}
        >
          {trimmed.replace('# ', '')}
        </Typography>
      );
    } else if (trimmed.startsWith('### ')) {
      elements.push(
        <Typography
          key={i}
          variant="subtitle1"
          sx={{ color: '#ff9800', mt: 2, mb: 0.5, fontWeight: 700 }}
        >
          {trimmed.replace('### ', '')}
        </Typography>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.replace(/^[-*] /, '');
      elements.push(
        <Typography
          key={i}
          sx={{ color: '#ccc', pl: 2, py: 0.2, ...mono, fontSize: '0.85rem' }}
        >
          {'• '}{renderBold(content)}
        </Typography>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      elements.push(
        <Typography
          key={i}
          sx={{ color: '#ccc', pl: 2, py: 0.2, ...mono, fontSize: '0.85rem' }}
        >
          {renderBold(trimmed)}
        </Typography>
      );
    } else if (trimmed === '---') {
      elements.push(<Divider key={i} sx={{ borderColor: '#333', my: 2 }} />);
    } else if (trimmed === '') {
      elements.push(<Box key={i} sx={{ height: 8 }} />);
    } else {
      elements.push(
        <Typography
          key={i}
          sx={{ color: '#ccc', py: 0.2, ...mono, fontSize: '0.85rem', lineHeight: 1.6 }}
        >
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
      <span key={i} style={{ color: '#fff', fontWeight: 700 }}>
        {part}
      </span>
    ) : (
      part
    )
  );
}

export default function Trader() {
  const [analysis, setAnalysis] = useState<TraderAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getTraderAnalysis();
      if (result.error) {
        setError(result.error);
      } else if (!result.analysis) {
        setError('AI model returned empty analysis. This can happen when the model uses all tokens on reasoning. Please try again.');
      } else {
        setAnalysis(result);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to get trader analysis');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 2, maxWidth: 1000, mx: 'auto' }}>
      {/* Header */}
      <Paper
        sx={{
          p: 3,
          mb: 3,
          bgcolor: '#111',
          border: '1px solid #1e1e1e',
          background: 'linear-gradient(135deg, #111 0%, #1a1a2e 100%)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <SmartToyIcon sx={{ color: '#00ff41', fontSize: 40 }} />
          <Box>
            <Typography variant="h5" sx={{ color: '#00ff41', fontWeight: 700, ...mono }}>
              MARCUS "THE COLLECTOR" VEGA
            </Typography>
            <Typography sx={{ color: '#666', fontSize: '0.85rem', ...mono }}>
              AI TRADING AGENT — EX-GOLDMAN SACHS — ALTERNATIVE ASSETS SPECIALIST
            </Typography>
          </Box>
        </Box>
        <Typography sx={{ color: '#999', fontSize: '0.8rem', ...mono, mb: 2 }}>
          15 years on the Street trading exotic derivatives. Now applying the same analytical
          rigor to Pokemon cards, sports memorabilia, and collectibles. Every card is just
          another instrument — supply, demand, and sentiment drive everything.
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Chip label="TECHNICAL ANALYSIS" size="small" sx={{ bgcolor: '#1a3a1a', color: '#00ff41', ...mono, fontSize: '0.7rem' }} />
          <Chip label="RISK MANAGEMENT" size="small" sx={{ bgcolor: '#1a1a3a', color: '#00bcd4', ...mono, fontSize: '0.7rem' }} />
          <Chip label="COLLECTIBLES" size="small" sx={{ bgcolor: '#3a1a1a', color: '#ff9800', ...mono, fontSize: '0.7rem' }} />
          <Chip label="ALTERNATIVE ASSETS" size="small" sx={{ bgcolor: '#2a2a1a', color: '#ffd700', ...mono, fontSize: '0.7rem' }} />
        </Box>

        <Button
          variant="contained"
          startIcon={loading ? <CircularProgress size={16} sx={{ color: '#000' }} /> : <TrendingUpIcon />}
          onClick={runAnalysis}
          disabled={loading}
          sx={{
            bgcolor: '#00ff41',
            color: '#000',
            fontWeight: 700,
            ...mono,
            '&:hover': { bgcolor: '#00cc33' },
            '&:disabled': { bgcolor: '#333', color: '#666' },
          }}
        >
          {loading ? 'ANALYZING MARKET...' : 'RUN MARKET ANALYSIS'}
        </Button>

        {loading && (
          <Typography sx={{ color: '#666', mt: 1, fontSize: '0.75rem', ...mono }}>
            Marcus is reviewing all cards, technical indicators, and backtest results...
          </Typography>
        )}
      </Paper>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2, bgcolor: '#1a0000', color: '#ff4444' }}>
          {error}
        </Alert>
      )}

      {/* Analysis Results */}
      {analysis?.analysis && (
        <Paper sx={{ p: 3, bgcolor: '#111', border: '1px solid #1e1e1e' }}>
          {/* Market Data Summary Bar */}
          {analysis.market_data_summary && (
            <Box
              sx={{
                display: 'flex',
                gap: 3,
                mb: 3,
                p: 1.5,
                bgcolor: '#0a0a0a',
                borderRadius: 1,
                border: '1px solid #222',
                flexWrap: 'wrap',
              }}
            >
              <Box>
                <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>CARDS</Typography>
                <Typography sx={{ color: '#fff', fontWeight: 700, ...mono }}>
                  {analysis.market_data_summary.total_cards}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>AVG PRICE</Typography>
                <Typography sx={{ color: '#00bcd4', fontWeight: 700, ...mono }}>
                  ${analysis.market_data_summary.avg_price?.toFixed(2)}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>MARKET CAP</Typography>
                <Typography sx={{ color: '#00bcd4', fontWeight: 700, ...mono }}>
                  ${analysis.market_data_summary.market_cap?.toLocaleString()}
                </Typography>
              </Box>
              {analysis.market_data_summary.top_gainer && (
                <Box>
                  <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>TOP GAINER</Typography>
                  <Typography sx={{ color: '#00ff41', fontWeight: 700, ...mono, fontSize: '0.85rem' }}>
                    {analysis.market_data_summary.top_gainer}
                  </Typography>
                </Box>
              )}
              {analysis.market_data_summary.top_loser && (
                <Box>
                  <Typography sx={{ color: '#666', fontSize: '0.65rem', ...mono }}>TOP LOSER</Typography>
                  <Typography sx={{ color: '#ff1744', fontWeight: 700, ...mono, fontSize: '0.85rem' }}>
                    {analysis.market_data_summary.top_loser}
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* Analysis Content */}
          <MarkdownBlock text={analysis.analysis} />

          {/* Token Usage Footer */}
          {analysis.tokens_used && (
            <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid #222' }}>
              <Typography sx={{ color: '#444', fontSize: '0.7rem', ...mono }}>
                TOKENS: {analysis.tokens_used.input.toLocaleString()} in / {analysis.tokens_used.output.toLocaleString()} out
              </Typography>
            </Box>
          )}
        </Paper>
      )}

      {/* Empty State */}
      {!analysis && !loading && !error && (
        <Paper
          sx={{
            p: 4,
            bgcolor: '#111',
            border: '1px solid #1e1e1e',
            textAlign: 'center',
          }}
        >
          <SmartToyIcon sx={{ color: '#333', fontSize: 60, mb: 2 }} />
          <Typography sx={{ color: '#666', ...mono, mb: 1 }}>
            Click "RUN MARKET ANALYSIS" to get Marcus's trading brief
          </Typography>
          <Typography sx={{ color: '#444', fontSize: '0.75rem', ...mono }}>
            The AI trader will analyze all cards, technical indicators, backtest results,
            and provide actionable recommendations
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
