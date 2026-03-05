import { Box, Typography } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';

interface Props {
  signal: string;
  strength: number;
}

export default function PredictionBadge({ signal, strength }: Props) {
  const config = {
    bullish: { color: '#00ff41', bg: 'rgba(0,255,65,0.1)', icon: TrendingUpIcon, label: 'BULLISH' },
    bearish: { color: '#ff1744', bg: 'rgba(255,23,68,0.1)', icon: TrendingDownIcon, label: 'BEARISH' },
    hold: { color: '#ff9800', bg: 'rgba(255,152,0,0.1)', icon: TrendingFlatIcon, label: 'HOLD' },
  }[signal] || { color: '#666', bg: 'rgba(100,100,100,0.1)', icon: TrendingFlatIcon, label: 'N/A' };

  const Icon = config.icon;
  const pct = Math.abs(strength * 100).toFixed(0);

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 1,
        borderRadius: 1,
        bgcolor: config.bg,
        border: `1px solid ${config.color}`,
      }}
    >
      <Icon sx={{ color: config.color, fontSize: 28 }} />
      <Box>
        <Typography sx={{ color: config.color, fontWeight: 700, fontSize: '1rem', lineHeight: 1 }}>
          {config.label}
        </Typography>
        <Typography sx={{ color: '#666', fontSize: '0.7rem' }}>
          Strength: {pct}%
        </Typography>
      </Box>
    </Box>
  );
}
