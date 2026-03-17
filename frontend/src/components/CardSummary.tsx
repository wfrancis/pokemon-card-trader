import { Box, Typography } from '@mui/material';
import { Card, SaleRecord, Analysis } from '../services/api';

interface CardSummaryProps {
  card: Card;
  sales: SaleRecord[];
  medianPrice: number | null;
  analysis: Analysis | null;
}

export default function CardSummary({ card, sales, medianPrice, analysis }: CardSummaryProps) {
  const price = medianPrice ?? card.current_price;

  const buildSummary = (): string => {
    if (price == null) {
      return 'Price data is not yet available for this card.';
    }

    const parts: string[] = [];

    // Sentence 1: price
    if (medianPrice != null) {
      parts.push(`This card is worth ~$${price.toFixed(2)} based on recent sales.`);
    } else {
      parts.push(`This card is listed at $${price.toFixed(2)} on TCGPlayer.`);
    }

    // Sentence 2: sales activity
    const now = Date.now();
    const d30 = now - 30 * 24 * 60 * 60 * 1000;
    const recentSales = sales.filter(s => new Date(s.order_date).getTime() >= d30);

    if (sales.length === 0) {
      parts.push('No recent sales have been recorded yet.');
    } else if (recentSales.length > 0) {
      parts.push(
        `It sold ${recentSales.length} time${recentSales.length !== 1 ? 's' : ''} in the last 30 days.`
      );
    } else {
      parts.push(`${sales.length} sale${sales.length !== 1 ? 's' : ''} on record, but none in the last 30 days.`);
    }

    // Sentence 3: trend (from SMA crossover)
    if (analysis?.sma_30 != null && analysis?.sma_90 != null) {
      if (analysis.sma_30 > analysis.sma_90) {
        parts.push('Prices have been trending up.');
      } else {
        parts.push('Prices have been trending down.');
      }
    }

    // Sentence 4: actionable guidance
    if (price != null && card.current_price != null) {
      const spread = ((card.current_price - price) / price) * 100;
      const velocity = analysis?.sales_per_day;
      if (spread < -10 && velocity != null && velocity >= 0.5) {
        parts.push('This looks like a good buying opportunity — listed below recent sale prices with steady demand.');
      } else if (spread > 50) {
        parts.push('Currently listed well above recent sales — consider waiting for a price drop or shopping around.');
      } else if (velocity != null && velocity < 0.2) {
        parts.push('This card sells infrequently, so it may take a while to find a buyer if you sell.');
      } else if (spread >= -10 && spread <= 20) {
        parts.push('The listing price is close to recent sale values — fairly priced right now.');
      }
    }

    return parts.join(' ');
  };

  return (
    <Box
      sx={{
        border: '1px solid #333',
        borderRadius: 1,
        px: 2,
        py: 1.5,
        mb: 2,
        bgcolor: '#0a0a1a',
      }}
    >
      <Typography
        sx={{
          color: '#aaa',
          fontSize: '0.95rem',
          lineHeight: 1.6,
          fontFamily: '"Inter", "Roboto", sans-serif',
        }}
      >
        {buildSummary()}
      </Typography>
    </Box>
  );
}
