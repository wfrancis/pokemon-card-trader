import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Paper, Typography, Grid, Chip, Stack } from '@mui/material';
import { api, Card, PricePoint, Analysis } from '../services/api';
import PriceChart from '../components/PriceChart';
import IndicatorPanel from '../components/IndicatorPanel';
import PredictionBadge from '../components/PredictionBadge';

export default function CardDetail() {
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<Card | null>(null);
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const cardId = parseInt(id);
    if (isNaN(cardId)) {
      setError('Invalid card ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api.getCard(cardId)
      .then(setCard)
      .catch(() => setError('Card not found'))
      .finally(() => setLoading(false));
    api.getCardPrices(cardId).then(data => setPrices(data.data)).catch(() => {});
    api.getCardAnalysis(cardId).then(data => setAnalysis(data.analysis)).catch(() => {});
  }, [id]);

  if (loading) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', color: '#666' }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  if (error || !card) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h4" sx={{ color: '#ff1744', mb: 1 }}>
          {error || 'Card not found'}
        </Typography>
        <Typography sx={{ color: '#666' }}>
          The card you're looking for doesn't exist or has been removed.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={2}>
        {/* Left: Card Image + Info */}
        <Grid size={{ xs: 12, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <img
              src={card.image_large || card.image_small}
              alt={card.name}
              style={{ width: '100%', maxWidth: 300, borderRadius: 8 }}
            />
            <Typography variant="h2" sx={{ mt: 2 }}>{card.name}</Typography>
            <Typography variant="body2" sx={{ color: '#666' }}>{card.set_name} #{card.number}</Typography>

            <Stack direction="row" spacing={0.5} sx={{ mt: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
              {card.rarity && card.rarity !== 'None' && <Chip label={card.rarity} size="small" variant="outlined" />}
              {card.supertype && <Chip label={card.supertype} size="small" variant="outlined" />}
              {card.types?.map(t => (
                <Chip key={t} label={t} size="small" sx={{ bgcolor: '#1a1a2e' }} />
              ))}
            </Stack>

            {card.hp && (
              <Typography variant="body2" sx={{ mt: 1, color: '#00bcd4' }}>
                HP: {card.hp}
              </Typography>
            )}

            {card.price_variant && (
              <Typography variant="body2" sx={{ mt: 0.5, color: '#666' }}>
                Variant: {card.price_variant}
              </Typography>
            )}

            {/* Prediction Badge */}
            {analysis && (
              <Box sx={{ mt: 2 }}>
                <PredictionBadge signal={analysis.signal} strength={analysis.signal_strength} />
              </Box>
            )}

            {/* Price Change Stats */}
            {analysis && (
              <Box sx={{ mt: 2 }}>
                {analysis.price_change_pct_7d !== null && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" sx={{ color: '#666' }}>7D Change</Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 700,
                      color: analysis.price_change_pct_7d >= 0 ? '#00ff41' : '#ff1744',
                    }}>
                      {analysis.price_change_pct_7d >= 0 ? '+' : ''}{analysis.price_change_pct_7d.toFixed(1)}%
                    </Typography>
                  </Box>
                )}
                {analysis.price_change_pct_30d !== null && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" sx={{ color: '#666' }}>30D Change</Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 700,
                      color: analysis.price_change_pct_30d >= 0 ? '#00ff41' : '#ff1744',
                    }}>
                      {analysis.price_change_pct_30d >= 0 ? '+' : ''}{analysis.price_change_pct_30d.toFixed(1)}%
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Right: Charts + Analysis */}
        <Grid size={{ xs: 12, md: 9 }}>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h3" sx={{ mb: 1, color: '#00bcd4' }}>
              PRICE HISTORY
            </Typography>
            <PriceChart priceData={prices} analysis={analysis || undefined} />
          </Paper>

          {analysis && (
            <Box>
              <Typography variant="h3" sx={{ mb: 1, color: '#00bcd4' }}>
                TECHNICAL INDICATORS
              </Typography>
              <IndicatorPanel analysis={analysis} />
            </Box>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
