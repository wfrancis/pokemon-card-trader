import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  Skeleton,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { AgentInsight } from '../services/api';

const mono = { fontFamily: '"JetBrains Mono", "Fira Code", monospace' };

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  opportunity: { icon: <TrendingUpIcon fontSize="small" />, color: '#00ff41', bg: '#0a3a0a' },
  warning: { icon: <WarningAmberIcon fontSize="small" />, color: '#ff9800', bg: '#2a1a0a' },
  anomaly: { icon: <ErrorOutlineIcon fontSize="small" />, color: '#ff1744', bg: '#3a0a0a' },
  milestone: { icon: <EmojiEventsIcon fontSize="small" />, color: '#ffd700', bg: '#2a2a0a' },
};

const SEVERITY_CONFIG: Record<string, { label: string; color: string }> = {
  info: { label: 'INFO', color: '#666' },
  notable: { label: 'NOTABLE', color: '#ffd700' },
  urgent: { label: 'URGENT', color: '#ff1744' },
};

interface AgentFeedProps {
  limit?: number;
  showAcknowledged?: boolean;
}

export default function AgentFeed({ limit = 10, showAcknowledged = false }: AgentFeedProps) {
  const [insights, setInsights] = useState<AgentInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.getAgentInsights({
      acknowledged: showAcknowledged ? undefined : false,
      limit,
    })
      .then(setInsights)
      .catch(() => setInsights([]))
      .finally(() => setLoading(false));
  }, [limit, showAcknowledged]);

  const handleAcknowledge = async (id: number) => {
    await api.acknowledgeInsight(id);
    setInsights((prev) => prev.filter((i) => i.id !== id));
  };

  if (loading) {
    return (
      <Box>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rectangular" height={56} sx={{ mb: 0.5, borderRadius: 1 }} />
        ))}
      </Box>
    );
  }

  if (insights.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 2, color: '#555' }}>
        <Typography sx={{ ...mono, fontSize: '0.75rem' }}>
          No new insights — agent is monitoring
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {insights.map((insight) => {
        const typeConfig = TYPE_CONFIG[insight.type] || TYPE_CONFIG.anomaly;
        const sevConfig = SEVERITY_CONFIG[insight.severity] || SEVERITY_CONFIG.info;
        const age = getTimeAgo(insight.created_at);

        return (
          <Paper
            key={insight.id}
            sx={{
              p: 1, mb: 0.5, bgcolor: typeConfig.bg, border: `1px solid ${typeConfig.color}22`,
              cursor: insight.card_id ? 'pointer' : 'default',
              '&:hover': insight.card_id ? { borderColor: typeConfig.color + '66' } : {},
              display: 'flex', alignItems: 'center', gap: 1,
            }}
            onClick={() => insight.card_id && navigate(`/card/${insight.card_id}`)}
          >
            <Box sx={{ color: typeConfig.color, display: 'flex', flexShrink: 0 }}>
              {typeConfig.icon}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ ...mono, fontSize: '0.7rem', color: '#fff', fontWeight: 600 }} noWrap>
                {insight.title}
              </Typography>
              <Typography sx={{ ...mono, fontSize: '0.6rem', color: '#888' }} noWrap>
                {insight.message}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
              <Chip
                label={sevConfig.label}
                size="small"
                sx={{ ...mono, fontSize: '0.5rem', height: 16, color: sevConfig.color, bgcolor: 'transparent', border: `1px solid ${sevConfig.color}44` }}
              />
              <Typography sx={{ ...mono, fontSize: '0.55rem', color: '#555' }}>
                {age}
              </Typography>
              <Tooltip title="Dismiss">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); handleAcknowledge(insight.id); }}
                  sx={{ color: '#555', '&:hover': { color: '#00ff41' }, p: 0.3 }}
                >
                  <CheckCircleOutlineIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Paper>
        );
      })}
    </Box>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
