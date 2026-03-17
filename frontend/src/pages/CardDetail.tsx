import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Paper, Typography, Grid, Chip, Stack, ToggleButton, ToggleButtonGroup,
  Button, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Menu, MenuItem,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { api, Card, PricePoint, SaleRecord, Analysis } from '../services/api';
import PriceChart from '../components/PriceChart';
import SalesChart from '../components/SalesChart';
import GlossaryTooltip from '../components/GlossaryTooltip';

function formatVariant(variant: string): string {
  const map: Record<string, string> = {
    holofoil: 'Holo',
    reverseHolofoil: 'Reverse Holo',
    '1stEditionHolofoil': '1st Ed. Holo',
    '1stEditionNormal': '1st Ed.',
    normal: 'Normal',
  };
  return map[variant] || variant.replace(/([A-Z])/g, ' $1').trim();
}

type ChartView = 'sales' | 'history';

export default function CardDetail() {
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<Card | null>(null);
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [medianPrice, setMedianPrice] = useState<number | null>(null);
  const [chartView, setChartView] = useState<ChartView>('sales');
  const [condition, setCondition] = useState<string>('Near Mint');
  const [availableConditions, setAvailableConditions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isWatchlisted, setIsWatchlisted] = useState(false);

  // Set page title
  useEffect(() => {
    document.title = card ? `${card.name} | PKMN Trader` : 'PKMN Trader';
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, [card]);

  // Check watchlist status
  useEffect(() => {
    if (!id) return;
    const watchlist = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    setIsWatchlisted(watchlist.some((w: any) => w.cardId === parseInt(id)));
  }, [id]);

  const [costBasisOpen, setCostBasisOpen] = useState(false);
  const [costBasisValue, setCostBasisValue] = useState('');
  const [alertAboveValue, setAlertAboveValue] = useState('');
  const [alertBelowValue, setAlertBelowValue] = useState('');
  const [alertEmail, setAlertEmail] = useState(() => localStorage.getItem('pkmn_alert_email') || '');
  const [quantityValue, setQuantityValue] = useState('1');
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const toggleWatchlist = (e: React.MouseEvent<HTMLElement>) => {
    if (!card) return;
    if (isWatchlisted) {
      setMenuAnchor(e.currentTarget);
    } else {
      setCostBasisValue('');
      setAlertAboveValue('');
      setAlertBelowValue('');
      setQuantityValue('1');
      setCostBasisOpen(true);
    }
  };

  const openEditAlerts = () => {
    if (!card) return;
    setMenuAnchor(null);
    const items = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const item = items.find((w: any) => w.cardId === card.id);
    setCostBasisValue(item?.costBasis != null ? String(item.costBasis) : '');
    setAlertAboveValue(item?.alertAbove != null ? String(item.alertAbove) : '');
    setAlertBelowValue(item?.alertBelow != null ? String(item.alertBelow) : '');
    setQuantityValue(item?.quantity != null ? String(item.quantity) : '1');
    setCostBasisOpen(true);
  };

  const removeFromWatchlist = () => {
    if (!card) return;
    setMenuAnchor(null);
    const items = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    localStorage.setItem('pkmn_watchlist', JSON.stringify(items.filter((w: any) => w.cardId !== card.id)));
    setIsWatchlisted(false);
  };

  const handleAddToWatchlist = () => {
    if (!card) return;
    const watchlist: any[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const parsedCost = parseFloat(costBasisValue);
    const parsedAbove = parseFloat(alertAboveValue);
    const parsedBelow = parseFloat(alertBelowValue);
    const parsedQty = parseInt(quantityValue);
    const newItem = {
      cardId: card.id,
      costBasis: !isNaN(parsedCost) && parsedCost > 0 ? parsedCost : null,
      alertAbove: !isNaN(parsedAbove) && parsedAbove > 0 ? parsedAbove : null,
      alertBelow: !isNaN(parsedBelow) && parsedBelow > 0 ? parsedBelow : null,
      quantity: !isNaN(parsedQty) && parsedQty > 0 ? parsedQty : 1,
      addedAt: new Date().toISOString(),
    };
    const idx = watchlist.findIndex((w: any) => w.cardId === card.id);
    if (idx >= 0) {
      watchlist[idx] = { ...watchlist[idx], ...newItem };
    } else {
      watchlist.push(newItem);
    }
    localStorage.setItem('pkmn_watchlist', JSON.stringify(watchlist));
    setIsWatchlisted(true);
    setCostBasisOpen(false);

    // Sync server-side email alert if email + thresholds provided
    const email = alertEmail.trim();
    if (email && (newItem.alertAbove || newItem.alertBelow)) {
      localStorage.setItem('pkmn_alert_email', email);
      api.createAlert({
        card_id: card.id,
        email,
        threshold_above: newItem.alertAbove,
        threshold_below: newItem.alertBelow,
      }).catch(() => {}); // best-effort
    }
  };

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
    api.getCardPrices(cardId).then(data => {
      setPrices(data.data);
      if (data.available_conditions?.length > 0) {
        setAvailableConditions(data.available_conditions);
      }
    }).catch(() => {});
    api.getCardSales(cardId).then(data => {
      setSales(data.sales);
      setMedianPrice(data.median_price);
    }).catch(() => {});
    api.getCardAnalysis(cardId).then(data => {
      setAnalysis(data.analysis);
    }).catch(() => {});
  }, [id]);

  // Re-fetch prices when condition changes
  useEffect(() => {
    if (!id) return;
    const cardId = parseInt(id);
    if (isNaN(cardId)) return;
    api.getCardPrices(cardId, condition).then(data => setPrices(data.data)).catch(() => {});
  }, [id, condition]);

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
            <Typography variant="body2" sx={{ color: '#666' }}>
              {card.set_name} #{card.number}
              {card.set_total_cards != null && ` of ${card.set_total_cards}`}
              {card.set_total_cards != null && card.number && parseInt(card.number) > card.set_total_cards && (
                <Chip label="Secret Rare" size="small" sx={{ ml: 0.5, height: 16, fontSize: '0.55rem', bgcolor: '#ffd70033', color: '#ffd700' }} />
              )}
            </Typography>

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

            {/* Price: use median sale price when available, fall back to API price */}
            {(medianPrice != null || card.current_price != null) && (
              <Typography variant="h4" sx={{ mt: 2, color: '#00ff41', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                ${(medianPrice ?? card.current_price!).toFixed(2)}
              </Typography>
            )}
            {medianPrice != null && (
              <Typography variant="body2" sx={{ color: '#888', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                median sale price
              </Typography>
            )}

            {/* Spread Analysis */}
            {card.current_price != null && card.current_price > 0 && medianPrice != null && medianPrice > 0 && (() => {
              const spread = ((card.current_price! - medianPrice) / medianPrice) * 100;
              const SELLER_FEE_RATE = 0.8745; // 1 - 12.55% (10.25% seller + 2.3% payment)
              const flipProfit = medianPrice * SELLER_FEE_RATE - card.current_price!;
              const isProfitable = flipProfit > 0;
              return (
                <Box sx={{ mt: 2, border: '1px solid #333', borderRadius: 1, overflow: 'hidden' }}>
                  <Box sx={{ bgcolor: '#1a1a2e', px: 1, py: 0.4 }}>
                    <Typography sx={{ color: '#00bcd4', fontWeight: 700, fontSize: '0.65rem', fontFamily: '"JetBrains Mono", monospace', letterSpacing: 1 }}>
                      SPREAD ANALYSIS
                    </Typography>
                  </Box>
                  <Box sx={{ px: 1, py: 0.5, display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography sx={{ color: '#666', fontSize: '0.65rem', fontFamily: 'monospace' }}><GlossaryTooltip term="market_price">Market</GlossaryTooltip></Typography>
                      <Typography sx={{ color: '#ccc', fontSize: '0.65rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                        ${card.current_price!.toFixed(2)}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography sx={{ color: '#666', fontSize: '0.65rem', fontFamily: 'monospace' }}><GlossaryTooltip term="median_sold">Median Sold</GlossaryTooltip></Typography>
                      <Typography sx={{ color: '#ccc', fontSize: '0.65rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                        ${medianPrice.toFixed(2)}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #222', pt: 0.3 }}>
                      <Typography sx={{ color: '#666', fontSize: '0.65rem', fontFamily: 'monospace' }}><GlossaryTooltip term="spread">Spread</GlossaryTooltip></Typography>
                      <Typography sx={{
                        color: spread > 0 ? '#ff1744' : '#00ff41',
                        fontSize: '0.65rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700,
                      }}>
                        {spread > 0 ? '+' : ''}{spread.toFixed(1)}%
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography sx={{ color: '#666', fontSize: '0.65rem', fontFamily: 'monospace' }}><GlossaryTooltip term="flip_profit">Flip Profit</GlossaryTooltip></Typography>
                      <Typography sx={{
                        color: isProfitable ? '#00ff41' : '#ff1744',
                        fontSize: '0.65rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700,
                      }}>
                        {isProfitable ? '+' : ''}{flipProfit >= 0 ? '$' : '-$'}{Math.abs(flipProfit).toFixed(2)}
                      </Typography>
                    </Box>
                    <Typography sx={{ color: '#555', fontSize: '0.55rem', fontFamily: 'monospace', mt: 0.2 }}>
                      after 12.55% seller fees
                    </Typography>
                    {/* Buy Zone Indicator */}
                    <Box sx={{ mt: 0.5, pt: 0.5, borderTop: '1px solid #222', display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        label={
                          isProfitable ? 'BUY ZONE' :
                          spread > 50 ? 'OVERPRICED' :
                          spread > 20 ? 'FAIR VALUE' :
                          'TIGHT SPREAD'
                        }
                        sx={{
                          height: 18, fontSize: '0.6rem', fontWeight: 700, fontFamily: 'monospace',
                          bgcolor: isProfitable ? '#00ff4122' : spread > 50 ? '#ff174422' : '#ff980022',
                          color: isProfitable ? '#00ff41' : spread > 50 ? '#ff1744' : '#ff9800',
                          border: '1px solid',
                          borderColor: isProfitable ? '#00ff4133' : spread > 50 ? '#ff174433' : '#ff980033',
                        }}
                      />
                      {analysis?.sma_30 != null && analysis?.sma_90 != null && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                          {analysis.sma_30 > analysis.sma_90 ? (
                            <TrendingUpIcon sx={{ fontSize: 14, color: '#00ff41' }} />
                          ) : (
                            <TrendingDownIcon sx={{ fontSize: 14, color: '#ff1744' }} />
                          )}
                          <Typography sx={{ fontSize: '0.55rem', fontFamily: 'monospace', color: analysis.sma_30 > analysis.sma_90 ? '#00ff41' : '#ff1744' }}>
                            {analysis.sma_30 > analysis.sma_90 ? 'Trending Up' : 'Trending Down'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                </Box>
              );
            })()}

            {card.price_variant && (
              <Chip
                label={formatVariant(card.price_variant)}
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

            {/* Action Buttons */}
            <Stack direction="row" spacing={1} sx={{ mt: 2, justifyContent: 'center' }}>
              {card.tcgplayer_product_id && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                  href={`https://www.tcgplayer.com/product/${card.tcgplayer_product_id}`}
                  target="_blank"
                  sx={{
                    color: '#00bcd4', borderColor: '#00bcd433', fontSize: '0.65rem',
                    '&:hover': { borderColor: '#00bcd4', bgcolor: '#00bcd410' },
                  }}
                >
                  TCGPlayer
                </Button>
              )}
              <Tooltip title={isWatchlisted ? 'Watchlist options' : 'Add to Watchlist'}>
                <IconButton onClick={toggleWatchlist} size="small" sx={{ color: isWatchlisted ? '#ffd700' : '#666' }}>
                  {isWatchlisted ? <BookmarkIcon /> : <BookmarkBorderIcon />}
                </IconButton>
              </Tooltip>
            </Stack>


            {/* Condition Pricing */}
            {sales.length > 0 && (() => {
              const conditionMap: Record<string, { prices: number[] }> = {};
              const conditionOrder = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
              sales.forEach(s => {
                const cond = s.condition || 'Unknown';
                if (!conditionMap[cond]) conditionMap[cond] = { prices: [] };
                conditionMap[cond].prices.push(s.purchase_price);
              });
              const getMedian = (arr: number[]): number => {
                const sorted = [...arr].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
              };
              const conditions = Object.entries(conditionMap)
                .sort((a, b) => {
                  const ai = conditionOrder.indexOf(a[0]);
                  const bi = conditionOrder.indexOf(b[0]);
                  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                });
              if (conditions.length === 0) return null;
              const LOW_SAMPLE_THRESHOLD = 5;
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
                      <Typography sx={{ width: 55, textAlign: 'right', color: '#666', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700 }}>MEDIAN</Typography>
                      <Typography sx={{ width: 55, textAlign: 'right', color: '#666', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700 }}>SALES</Typography>
                    </Box>
                    {conditions.map(([cond, data]) => {
                      const count = data.prices.length;
                      const median = getMedian(data.prices);
                      const isLowSample = count < LOW_SAMPLE_THRESHOLD;
                      const sorted = [...data.prices].sort((a, b) => a - b);
                      const low = sorted[0];
                      const high = sorted[sorted.length - 1];
                      return (
                        <Box key={cond} sx={{ borderTop: '1px solid #222', opacity: isLowSample ? 0.5 : 1, '&:hover': { bgcolor: '#1a1a2e33' } }}>
                          <Box sx={{ display: 'flex', px: 1, py: 0.4, alignItems: 'center' }}>
                            <Typography sx={{ flex: 1, color: isLowSample ? '#666' : '#ccc', fontSize: '0.7rem', fontFamily: 'monospace' }}>
                              {cond === 'Near Mint' ? <GlossaryTooltip term="nm">NM</GlossaryTooltip> : cond === 'Lightly Played' ? <GlossaryTooltip term="lp">LP</GlossaryTooltip> : cond === 'Moderately Played' ? <GlossaryTooltip term="mp">MP</GlossaryTooltip> : cond === 'Heavily Played' ? <GlossaryTooltip term="hp">HP</GlossaryTooltip> : cond === 'Damaged' ? <GlossaryTooltip term="dmg">DMG</GlossaryTooltip> : cond}
                            </Typography>
                            <Typography sx={{ width: 55, textAlign: 'right', color: isLowSample ? '#666' : '#00ff41', fontSize: '0.7rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                              ${median.toFixed(2)}
                            </Typography>
                            <Typography sx={{ width: 55, textAlign: 'right', fontSize: '0.65rem', fontFamily: 'monospace', color: isLowSample ? '#ff9800' : '#888' }}>
                              {count}{isLowSample && ' *'}
                            </Typography>
                          </Box>
                          {count > 1 && (
                            <Typography sx={{ px: 1, pb: 0.3, color: '#555', fontSize: '0.6rem', fontFamily: 'monospace' }}>
                              range ${low.toFixed(2)} - ${high.toFixed(2)}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                  {conditions.some(([, data]) => data.prices.length < LOW_SAMPLE_THRESHOLD) && (
                    <Typography sx={{ mt: 0.5, color: '#ff9800', fontSize: '0.6rem', fontFamily: 'monospace' }}>
                      * Low sample — fewer than {LOW_SAMPLE_THRESHOLD} sales
                    </Typography>
                  )}
                  {/* Graded pricing info */}
                  <Box sx={{ mt: 1.5, p: 1, bgcolor: '#0a0a1a', border: '1px solid #222', borderRadius: 1, display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                    <InfoOutlinedIcon sx={{ fontSize: 14, color: '#555', mt: 0.2 }} />
                    <Box>
                      <Typography sx={{ color: '#888', fontSize: '0.6rem', fontFamily: 'monospace' }}>
                        Prices are for raw/ungraded cards.
                      </Typography>
                      <Typography sx={{ color: '#555', fontSize: '0.55rem', fontFamily: 'monospace', mt: 0.3 }}>
                        For graded values (PSA, CGC, Beckett):{' '}
                        <a href={`https://www.pricecharting.com/search-products?q=${encodeURIComponent(card.name)}&type=price`} target="_blank" rel="noopener noreferrer" style={{ color: '#00bcd4' }}>PriceCharting</a>
                        {' · '}
                        <a href="https://www.psacard.com/auctionprices" target="_blank" rel="noopener noreferrer" style={{ color: '#00bcd4' }}>PSA Auctions</a>
                      </Typography>
                    </Box>
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
            {/* Chart view + condition toggles */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, md: 2 }, mb: 1, flexWrap: 'wrap' }}>
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
              {availableConditions.length > 1 && (
                <ToggleButtonGroup
                  value={condition}
                  exclusive
                  onChange={(_, v) => v && setCondition(v)}
                  size="small"
                  sx={{
                    '& .MuiToggleButton-root': {
                      color: '#888', border: '1px solid #333', px: { xs: 1, md: 1.5 }, py: { xs: 0.5, md: 0.3 },
                      fontSize: '0.65rem', fontWeight: 700, fontFamily: 'monospace',
                      '&.Mui-selected': { color: '#ffd740', bgcolor: 'rgba(255,215,64,0.1)', borderColor: '#ffd740' },
                    },
                  }}
                >
                  {availableConditions.map(c => (
                    <ToggleButton key={c} value={c}>
                      {c === 'Near Mint' ? 'NM' : c === 'Lightly Played' ? 'LP' : c === 'Moderately Played' ? 'MP' : c === 'Heavily Played' ? 'HP' : c === 'Damaged' ? 'DMG' : c}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              )}
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
                <PriceChart priceData={prices} cardName={card.name} />
              </>
            )}
          </Paper>

        </Grid>
      </Grid>

      {/* Watchlist Menu (for already-watchlisted cards) */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        PaperProps={{ sx: { bgcolor: '#111', border: '1px solid #1e1e1e' } }}
      >
        <MenuItem onClick={openEditAlerts} sx={{ fontSize: '0.8rem' }}>Edit Alerts & Cost Basis</MenuItem>
        <MenuItem onClick={removeFromWatchlist} sx={{ fontSize: '0.8rem', color: '#ff1744' }}>Remove from Watchlist</MenuItem>
      </Menu>

      {/* Watchlist Dialog */}
      <Dialog
        open={costBasisOpen}
        onClose={() => setCostBasisOpen(false)}
        PaperProps={{ sx: { bgcolor: '#111', border: '1px solid #1e1e1e', minWidth: 320 } }}
      >
        <DialogTitle sx={{ color: '#00bcd4', fontFamily: 'monospace', fontSize: '0.95rem' }}>
          {isWatchlisted ? 'Edit Watchlist Card' : 'Add to Watchlist'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: '#888', fontSize: '0.8rem', mb: 2 }}>
            Set cost basis, quantity, and price alerts (all optional).
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              autoFocus
              size="small"
              type="number"
              label="Cost Basis"
              placeholder="e.g. 25.00"
              value={costBasisValue}
              onChange={(e) => setCostBasisValue(e.target.value)}
              InputProps={{ startAdornment: <Typography sx={{ color: '#555', mr: 0.5 }}>$</Typography> }}
              sx={{ flex: 2, '& .MuiInputLabel-root': { color: '#666' } }}
            />
            <TextField
              size="small"
              type="number"
              label="Qty"
              value={quantityValue}
              onChange={(e) => setQuantityValue(e.target.value)}
              inputProps={{ min: 1 }}
              sx={{ flex: 1, '& .MuiInputLabel-root': { color: '#666' } }}
            />
          </Box>
          <TextField
            fullWidth
            size="small"
            type="number"
            label="Alert above"
            placeholder="Notify when price rises above..."
            value={alertAboveValue}
            onChange={(e) => setAlertAboveValue(e.target.value)}
            InputProps={{ startAdornment: <Typography sx={{ color: '#555', mr: 0.5 }}>$</Typography> }}
            sx={{ mb: 2, '& .MuiInputLabel-root': { color: '#666' } }}
          />
          <TextField
            fullWidth
            size="small"
            type="number"
            label="Alert below"
            placeholder="Notify when price drops below..."
            value={alertBelowValue}
            onChange={(e) => setAlertBelowValue(e.target.value)}
            InputProps={{ startAdornment: <Typography sx={{ color: '#555', mr: 0.5 }}>$</Typography> }}
            sx={{ mb: 2, '& .MuiInputLabel-root': { color: '#666' } }}
          />
          <TextField
            fullWidth
            size="small"
            type="email"
            label="Email for alerts"
            placeholder="Get email when price targets hit"
            value={alertEmail}
            onChange={(e) => setAlertEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddToWatchlist(); }}
            helperText="Optional — receive email notifications for price alerts"
            sx={{ '& .MuiInputLabel-root': { color: '#666' }, '& .MuiFormHelperText-root': { color: '#555' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCostBasisOpen(false)} sx={{ color: '#666' }}>
            Cancel
          </Button>
          <Button onClick={handleAddToWatchlist} sx={{ color: '#00ff41' }}>
            {isWatchlisted ? 'Save' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
