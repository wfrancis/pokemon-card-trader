import { Paper, Typography, Grid, Box } from '@mui/material';
import { Analysis } from '../services/api';

interface Props {
  analysis: Analysis;
}

function Stat({ label, value, suffix, color }: { label: string; value: number | null; suffix?: string; color?: string }) {
  return (
    <Box sx={{ textAlign: 'center', p: 1 }}>
      <Typography variant="body2" sx={{ color: '#666', fontSize: '0.65rem', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 700, color: color || '#e0e0e0' }}>
        {value !== null ? `${typeof value === 'number' ? value.toFixed(2) : value}${suffix || ''}` : '—'}
      </Typography>
    </Box>
  );
}

export default function IndicatorPanel({ analysis }: Props) {
  const rsiColor = analysis.rsi_14 !== null
    ? analysis.rsi_14 > 70 ? '#ff1744' : analysis.rsi_14 < 30 ? '#00ff41' : '#ff9800'
    : undefined;

  return (
    <Grid container spacing={1}>
      <Grid size={{ xs: 12, md: 4 }}>
        <Paper sx={{ p: 1.5 }}>
          <Typography variant="h4" sx={{ mb: 1, color: '#00bcd4' }}>Moving Averages</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'space-around' }}>
            <Stat label="SMA 7" value={analysis.sma_7} suffix="" />
            <Stat label="SMA 30" value={analysis.sma_30} suffix="" />
            <Stat label="SMA 90" value={analysis.sma_90} suffix="" />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-around', mt: 1 }}>
            <Stat label="EMA 12" value={analysis.ema_12} suffix="" />
            <Stat label="EMA 26" value={analysis.ema_26} suffix="" />
          </Box>
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 4 }}>
        <Paper sx={{ p: 1.5 }}>
          <Typography variant="h4" sx={{ mb: 1, color: '#00bcd4' }}>Oscillators</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'space-around' }}>
            <Stat label="RSI (14)" value={analysis.rsi_14} color={rsiColor} />
            <Stat label="Momentum" value={analysis.momentum} suffix="%" color={
              analysis.momentum !== null ? (analysis.momentum >= 0 ? '#00ff41' : '#ff1744') : undefined
            } />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-around', mt: 1 }}>
            <Stat label="MACD" value={analysis.macd_line} />
            <Stat label="Signal" value={analysis.macd_signal} />
            <Stat label="Histogram" value={analysis.macd_histogram} color={
              analysis.macd_histogram !== null ? (analysis.macd_histogram >= 0 ? '#00ff41' : '#ff1744') : undefined
            } />
          </Box>
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 4 }}>
        <Paper sx={{ p: 1.5 }}>
          <Typography variant="h4" sx={{ mb: 1, color: '#00bcd4' }}>Bollinger / S&R</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'space-around' }}>
            <Stat label="Upper" value={analysis.bollinger_upper} />
            <Stat label="Middle" value={analysis.bollinger_middle} />
            <Stat label="Lower" value={analysis.bollinger_lower} />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-around', mt: 1 }}>
            <Stat label="Support" value={analysis.support} suffix="" color="#ff9800" />
            <Stat label="Resistance" value={analysis.resistance} suffix="" color="#ff9800" />
          </Box>
        </Paper>
      </Grid>
    </Grid>
  );
}
