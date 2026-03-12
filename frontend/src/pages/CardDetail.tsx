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

            {card.artist && (
              <Typography variant="body2" sx={{ mt: 1, color: '#888', fontStyle: 'italic' }}>
                Illustrated by {card.artist}
              </Typography>
            )}

            {card.current_price != null && (
              <Typography variant="h4" sx={{ mt: 2, color: '#00ff41', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                ${card.current_price.toFixed(2)}
              </Typography>
            )}

            {card.hp && (
              <Typography variant="body2" sx={{ mt: 0.5, color: '#00bcd4' }}>
                HP: {card.hp}
              </Typography>
            )}

            {card.price_variant && (
              <Chip
                label={card.price_variant.toUpperCase()}
                size="small"
                sx={{
                  mt: 1,
                  bgcolor: '#1a1a2e',
                  color: '#00bcd4',
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  border: '1px solid #00bcd433',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              />
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

            {/* Condition Pricing */}
            {sales.length > 0 && (() => {
              const conditionMap: Record<string, { total: number; count: number }> = {};
              const conditionOrder = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
              sales.forEach(s => {
                const cond = s.condition || 'Unknown';
                if (!conditionMap[cond]) conditionMap[cond] = { total: 0, count: 0 };
                conditionMap[cond].total += s.purchase_price;
                conditionMap[cond].count += 1;
              });
              const conditions = Object.entries(conditionMap)
                .sort((a, b) => {
                  const ai = conditionOrder.indexOf(a[0]);
                  const bi = conditionOrder.indexOf(b[0]);
                  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                });
              if (conditions.length === 0) return null;
              return (
                <Box sx={{ mt: 2.5 }}>
                  <Typography variant="body2" sx={{
                    color: '#00bcd4', fontWeight: 700, fontSize: '0.7rem', mb: 1,
                    fontFamily: '"JetBrains Mono", monospace', letterSpacing: 1,
                  }}>
                    CONDITION PRICING
                  </Typography>
                  <Box sx={{
                    border: '1px solid #333', borderRadius: 1, overflow: 'hidden',
                  }}>
                    {/* Header */}
                    <Box sx={{ display: 'flex', bgcolor: '#1a1a2e', px: 1, py: 0.5 }}>
                      <Typography sx={{ flex: 1, color: '#666', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700 }}>CONDITION</Typography>
                      <Typography sx={{ width: 55, textAlign: 'right', color: '#666', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700 }}>AVG</Typography>
                      <Typography sx={{ width: 30, textAlign: 'right', color: '#666', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700 }}>#</Typography>
                    </Box>
                    {conditions.map(([cond, data]) => (
                      <Box key={cond} sx={{ display: 'flex', px: 1, py: 0.4, borderTop: '1px solid #222', '&:hover': { bgcolor: '#1a1a2e33' } }}>
                        <Typography sx={{ flex: 1, color: '#ccc', fontSize: '0.7rem', fontFamily: 'monospace' }}>
                          {cond === 'Near Mint' ? 'NM' : cond === 'Lightly Played' ? 'LP' : cond === 'Moderately Played' ? 'MP' : cond === 'Heavily Played' ? 'HP' : cond === 'Damaged' ? 'DMG' : cond}
                        </Typography>
                        <Typography sx={{ width: 55, textAlign: 'right', color: '#00ff41', fontSize: '0.7rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                          ${(data.total / data.count).toFixed(2)}
                        </Typography>
                        <Typography sx={{ width: 30, textAlign: 'right', color: '#888', fontSize: '0.7rem', fontFamily: 'monospace' }}>
                          {data.count}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })()}

            {/* Market Activity */}
            {sales.length > 0 && (() => {
              const now = new Date();
              const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
              const d90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
              const sales30 = sales.filter(s => new Date(s.order_date) >= d30);
              const sales90 = sales.filter(s => new Date(s.order_date) >= d90);

              // Average days between sales (from sorted dates)
              let avgDaysBetween: number | null = null;
              if (sales.length >= 2) {
                const dates = sales.map(s => new Date(s.order_date).getTime()).sort((a, b) => a - b);
                const gaps: number[] = [];
                for (let i = 1; i < dates.length; i++) {
                  gaps.push((dates[i] - dates[i - 1]) / (24 * 60 * 60 * 1000));
                }
                avgDaysBetween = gaps.reduce((a, b) => a + b, 0) / gaps.length;
              }

              return (
                <Box sx={{ mt: 2.5 }}>
                  <Typography variant="body2" sx={{
                    color: '#00bcd4', fontWeight: 700, fontSize: '0.7rem', mb: 1,
                    fontFamily: '"JetBrains Mono", monospace', letterSpacing: 1,
                  }}>
                    MARKET ACTIVITY
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ color: '#666' }}>Sales (30d)</Typography>
                      <Typography variant="body2" sx={{ color: '#ccc', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                        {sales30.length}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ color: '#666' }}>Sales (90d)</Typography>
                      <Typography variant="body2" sx={{ color: '#ccc', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                        {sales90.length}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ color: '#666' }}>Avg days between</Typography>
                      <Typography variant="body2" sx={{
                        color: avgDaysBetween !== null && avgDaysBetween <= 3 ? '#00ff41' : avgDaysBetween !== null && avgDaysBetween <= 7 ? '#ff9800' : '#ff1744',
                        fontFamily: '"JetBrains Mono", monospace', fontWeight: 700,
                      }}>
                        {avgDaysBetween !== null ? avgDaysBetween.toFixed(1) : '--'}
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              );
            })()}
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
              <Typography sx={{
                color: '#ff9800', fontSize: '0.7rem', mb: 1.5, px: 1, py: 0.5,
                bgcolor: '#ff980010', borderRadius: 1, border: '1px solid #ff980033',
                fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.6,
              }}>
                Technical indicators have limited value for collectibles — card prices trade sporadically, not continuously like stocks. Use sales velocity and comparable cards instead.
              </Typography>
              <IndicatorPanel analysis={analysis} />
            </Box>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
