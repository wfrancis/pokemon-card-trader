import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Paper, Typography, Grid, Chip, Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { api, Card, PricePoint, Analysis, SaleRecord } from '../services/api';
import PriceChart from '../components/PriceChart';
import SalesChart from '../components/SalesChart';
import IndicatorPanel from '../components/IndicatorPanel';
import PredictionBadge from '../components/PredictionBadge';

type ChartView = 'sales' | 'history';

export default function CardDetail() {
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<Card | null>(null);
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [medianPrice, setMedianPrice] = useState<number | null>(null);
  const [chartView, setChartView] = useState<ChartView>('sales');
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
    api.getCardSales(cardId).then(data => {
      setSales(data.sales);
      setMedianPrice(data.median_price);
    }).catch(() => {});
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
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Grid container spacing={2}>
        {/* Left: Card Image + Info */}
        <Grid size={{ xs: 12, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            {(card.image_large || card.image_small) ? (
              <Box
                component="img"
                src={card.image_large || card.image_small}
                alt={card.name}
                sx={{ width: '100%', maxWidth: { xs: 200, sm: 300 }, borderRadius: 2 }}
              />
            ) : (
              <Box sx={{
                width: '100%', maxWidth: { xs: 200, sm: 300 }, height: 400, mx: 'auto',
                bgcolor: '#1a1a2e', borderRadius: 2,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid #333',
              }}>
                <Typography sx={{ color: '#555', fontSize: '0.9rem' }}>No Image Available</Typography>
              </Box>
            )}
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
            {/* Chart view toggle */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, md: 2 }, mb: 1 }}>
              <ToggleButtonGroup
                value={chartView}
                exclusive
                onChange={(_, v) => v && setChartView(v)}
                size="small"
                sx={{
                  '& .MuiToggleButton-root': {
                    color: '#888', border: '1px solid #333', px: { xs: 1.5, md: 2 }, py: { xs: 0.5, md: 0.3 },
                    fontSize: '0.75rem', fontWeight: 700, fontFamily: 'monospace',
                    '&.Mui-selected': { color: '#00bcd4', bgcolor: 'rgba(0,188,212,0.1)', borderColor: '#00bcd4' },
                  },
                }}
              >
                <ToggleButton value="sales">SALES</ToggleButton>
                <ToggleButton value="history">PRICE HISTORY</ToggleButton>
              </ToggleButtonGroup>
              {chartView === 'sales' && sales.length === 0 && (
                <Typography variant="body2" sx={{ color: '#ff9800', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                  No sales collected yet — run /api/sync/sales
                </Typography>
              )}
            </Box>

            {chartView === 'sales' ? (
              <SalesChart sales={sales} medianPrice={medianPrice} cardName={card.name} />
            ) : (
              <>
                <Typography variant="h3" sx={{ mb: 1, color: '#00bcd4' }}>
                  PRICE HISTORY
                </Typography>
                <PriceChart priceData={prices} analysis={analysis || undefined} />
              </>
            )}
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
