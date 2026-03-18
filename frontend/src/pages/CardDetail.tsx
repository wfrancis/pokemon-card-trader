import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Paper, Typography, Grid, Chip, Stack, ToggleButton, ToggleButtonGroup,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Menu, MenuItem, CardMedia, Card as MuiCard, CardContent, CardActionArea,
  Collapse, List, ListItemButton, ListItemAvatar, Avatar, ListItemText,
  InputAdornment, CircularProgress,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import NotificationsIcon from '@mui/icons-material/Notifications';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import SearchIcon from '@mui/icons-material/Search';
import { api, Card, PricePoint, SaleRecord, Analysis, SimilarCard } from '../services/api';
import PriceChart from '../components/PriceChart';
import SalesChart from '../components/SalesChart';
import GlossaryTooltip from '../components/GlossaryTooltip';
import CardSummary from '../components/CardSummary';

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
  const navigate = useNavigate();
  const [card, setCard] = useState<Card | null>(null);
  const [similarCards, setSimilarCards] = useState<SimilarCard[]>([]);
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [medianPrice, setMedianPrice] = useState<number | null>(null);
  const [chartView, setChartView] = useState<ChartView>('sales');
  const [condition, setCondition] = useState<string>('Near Mint');
  const [availableConditions, setAvailableConditions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isWatchlisted, setIsWatchlisted] = useState(false);

  // Compare mode state
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [compareSearchQuery, setCompareSearchQuery] = useState('');
  const [compareSearchResults, setCompareSearchResults] = useState<Card[]>([]);
  const [compareSearching, setCompareSearching] = useState(false);
  const [compareCard, setCompareCard] = useState<Card | null>(null);
  const [comparePrices, setComparePrices] = useState<PricePoint[]>([]);
  const compareSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced compare card search
  const handleCompareSearch = useCallback((query: string) => {
    setCompareSearchQuery(query);
    if (compareSearchTimer.current) clearTimeout(compareSearchTimer.current);
    if (query.trim().length < 2) {
      setCompareSearchResults([]);
      return;
    }
    compareSearchTimer.current = setTimeout(async () => {
      setCompareSearching(true);
      try {
        const result = await api.getCards({ q: query.trim(), page_size: '10' });
        // Exclude current card from results
        setCompareSearchResults(result.data.filter(c => c.id !== parseInt(id || '0')));
      } catch {
        setCompareSearchResults([]);
      } finally {
        setCompareSearching(false);
      }
    }, 300);
  }, [id]);

  // Select a compare card
  const handleSelectCompareCard = useCallback(async (selectedCard: Card) => {
    setCompareDialogOpen(false);
    setCompareCard(selectedCard);
    setCompareSearchQuery('');
    setCompareSearchResults([]);
    try {
      const priceData = await api.getCardPrices(selectedCard.id);
      setComparePrices(priceData.data);
    } catch {
      setComparePrices([]);
    }
  }, []);

  // Remove comparison
  const handleRemoveCompare = useCallback(() => {
    setCompareCard(null);
    setComparePrices([]);
  }, []);

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
  const [conditionGuideOpen, setConditionGuideOpen] = useState(true);
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [alertDialogAbove, setAlertDialogAbove] = useState('');
  const [alertDialogBelow, setAlertDialogBelow] = useState('');
  const [alertDialogSpread, setAlertDialogSpread] = useState('');
  const [alertDialogEmail, setAlertDialogEmail] = useState(() => localStorage.getItem('pkmn_alert_email') || '');
  const [alertSubmitting, setAlertSubmitting] = useState(false);

  const handleOpenAlertDialog = () => {
    setAlertDialogAbove('');
    setAlertDialogBelow('');
    setAlertDialogSpread('');
    setAlertDialogEmail(localStorage.getItem('pkmn_alert_email') || '');
    setAlertDialogOpen(true);
  };

  const handleSubmitAlert = async () => {
    if (!card) return;
    const email = alertDialogEmail.trim();
    const above = parseFloat(alertDialogAbove);
    const below = parseFloat(alertDialogBelow);
    const spread = parseFloat(alertDialogSpread);
    if (!email) return;
    if (isNaN(above) && isNaN(below) && isNaN(spread)) return;
    setAlertSubmitting(true);
    try {
      localStorage.setItem('pkmn_alert_email', email);
      await api.createAlert({
        card_id: card.id,
        email,
        threshold_above: !isNaN(above) && above > 0 ? above : null,
        threshold_below: !isNaN(below) && below > 0 ? below : null,
        spread_threshold: !isNaN(spread) && spread > 0 ? spread : null,
      });
      setAlertDialogOpen(false);
    } catch {
      // best effort
    } finally {
      setAlertSubmitting(false);
    }
  };

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
    api.getSimilarCards(cardId).then(data => {
      setSimilarCards(data.similar);
    }).catch(() => {});
  }, [id]);

  // Re-fetch prices when condition changes — keep existing data if new fetch returns empty
  useEffect(() => {
    if (!id) return;
    const cardId = parseInt(id);
    if (isNaN(cardId)) return;
    api.getCardPrices(cardId, condition).then(data => {
      if (data.data && data.data.length > 0) {
        setPrices(data.data);
      }
    }).catch(() => {});
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
                sx={{ width: '100%', maxWidth: { xs: 180, sm: 300 }, borderRadius: 2, mx: 'auto', display: 'block' }}
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
                    {/* Suggested buy price when overpriced */}
                    {!isProfitable && medianPrice > 0 && (
                      <Box sx={{ mt: 0.3, p: 0.5, bgcolor: '#1a1a0a', border: '1px solid #33330033', borderRadius: 0.5 }}>
                        <Typography sx={{ color: '#ff9800', fontSize: '0.55rem', fontFamily: 'monospace' }}>
                          Buy below ${(medianPrice * SELLER_FEE_RATE).toFixed(2)} for a profitable flip
                        </Typography>
                      </Box>
                    )}
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
                      {analysis?.sales_per_day != null && analysis.sales_per_day < 0.5 && (
                        <Chip
                          size="small"
                          label="LOW LIQUIDITY"
                          sx={{
                            height: 18, fontSize: '0.6rem', fontWeight: 700, fontFamily: 'monospace',
                            bgcolor: '#66666622',
                            color: '#999',
                            border: '1px solid #66666633',
                          }}
                        />
                      )}
                      {analysis?.sales_per_day != null && (
                        <Chip
                          size="small"
                          label={`${analysis.sales_per_day.toFixed(1)} sales/day`}
                          sx={{
                            height: 18, fontSize: '0.55rem', fontWeight: 600, fontFamily: 'monospace',
                            bgcolor: 'transparent',
                            color: analysis.sales_per_day >= 1 ? '#00bcd4' : analysis.sales_per_day >= 0.5 ? '#ff9800' : '#666',
                            border: '1px solid',
                            borderColor: analysis.sales_per_day >= 1 ? '#00bcd433' : analysis.sales_per_day >= 0.5 ? '#ff980033' : '#33333366',
                          }}
                        />
                      )}
                      {analysis?.sma_30 != null && analysis?.sma_90 != null && (() => {
                        const pctDiff = analysis.sma_90 > 0 ? ((analysis.sma_30 - analysis.sma_90) / analysis.sma_90) * 100 : 0;
                        const isSideways = Math.abs(pctDiff) < 5;
                        const isUp = pctDiff >= 5;
                        const color = isSideways ? '#888' : isUp ? '#00ff41' : '#ff1744';
                        const label = isSideways ? 'Sideways' : isUp ? 'Trending Up' : 'Trending Down';
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                            {isSideways ? null : isUp ? (
                              <TrendingUpIcon sx={{ fontSize: 14, color }} />
                            ) : (
                              <TrendingDownIcon sx={{ fontSize: 14, color }} />
                            )}
                            <Typography sx={{ fontSize: '0.55rem', fontFamily: 'monospace', color }}>
                              {label}
                            </Typography>
                          </Box>
                        );
                      })()}
                    </Box>
                    {/* Buy on TCGPlayer Button */}
                    {(() => {
                      const tcgUrl = card.tcgplayer_product_id
                        ? `https://www.tcgplayer.com/product/${card.tcgplayer_product_id}`
                        : `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(card.name + ' ' + card.set_name)}`;
                      return (
                        <Button
                          variant="outlined"
                          size="small"
                          href={tcgUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          endIcon={<OpenInNewIcon sx={{ fontSize: '14px !important' }} />}
                          sx={{
                            mt: 0.5,
                            width: '100%',
                            height: 28,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            fontFamily: '"JetBrains Mono", monospace',
                            color: '#ff9800',
                            borderColor: '#ff980066',
                            textTransform: 'none',
                            '&:hover': {
                              borderColor: '#ff9800',
                              bgcolor: '#ff980011',
                            },
                          }}
                        >
                          Buy on TCGPlayer
                        </Button>
                      );
                    })()}
                  </Box>
                </Box>
              );
            })()}

            {/* Standalone Buy on TCGPlayer - shows when spread analysis is hidden */}
            {!(card.current_price != null && card.current_price > 0 && medianPrice != null && medianPrice > 0) && (() => {
              const tcgUrl = card.tcgplayer_product_id
                ? `https://www.tcgplayer.com/product/${card.tcgplayer_product_id}`
                : `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(card.name + ' ' + card.set_name)}`;
              return (
                <Button
                  variant="outlined"
                  size="small"
                  href={tcgUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  endIcon={<OpenInNewIcon sx={{ fontSize: '14px !important' }} />}
                  sx={{
                    mt: 1.5,
                    width: '100%',
                    maxWidth: 220,
                    height: 32,
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    fontFamily: '"JetBrains Mono", monospace',
                    color: '#ff9800',
                    borderColor: '#ff980066',
                    textTransform: 'none',
                    '&:hover': {
                      borderColor: '#ff9800',
                      bgcolor: '#ff980011',
                    },
                  }}
                >
                  Buy on TCGPlayer
                </Button>
              );
            })()}

            {/* Set Price Alert Button */}
            <Button
              variant="outlined"
              startIcon={<NotificationsIcon />}
              onClick={handleOpenAlertDialog}
              sx={{
                mt: 1.5,
                width: '100%',
                maxWidth: 220,
                fontWeight: 700,
                fontSize: '0.7rem',
                fontFamily: 'monospace',
                color: '#ff9800',
                borderColor: '#ff980055',
                '&:hover': { borderColor: '#ff9800', bgcolor: '#ff980011' },
              }}
            >
              Set Price Alert
            </Button>

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
            <Stack direction="column" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
              <Button
                variant={isWatchlisted ? 'contained' : 'outlined'}
                onClick={toggleWatchlist}
                startIcon={isWatchlisted ? <BookmarkIcon /> : <BookmarkBorderIcon />}
                sx={{
                  width: '100%',
                  maxWidth: 220,
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  ...(isWatchlisted
                    ? {
                        bgcolor: '#ffd70022',
                        color: '#ffd700',
                        border: '1px solid #ffd70055',
                        '&:hover': { bgcolor: '#ffd70033', border: '1px solid #ffd700' },
                      }
                    : {
                        color: '#ccc',
                        borderColor: '#555',
                        '&:hover': { borderColor: '#ffd700', color: '#ffd700', bgcolor: '#ffd70011' },
                      }),
                }}
              >
                {isWatchlisted ? 'Saved \u2713' : 'Save to Watchlist'}
              </Button>
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
              // Get NM median as reference price for outlier detection
              const nmData = conditionMap['Near Mint'];
              const nmMedian = nmData ? getMedian(nmData.prices) : null;

              // Filter out outlier sales: if NM median exists and is >= $10, remove sales
              // that are < 20% of NM median from lower conditions (likely misgraded or bulk lots)
              if (nmMedian && nmMedian >= 10) {
                const lowerConditions = ['Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
                for (const cond of lowerConditions) {
                  if (conditionMap[cond]) {
                    const outlierThreshold = nmMedian * 0.20;
                    conditionMap[cond].prices = conditionMap[cond].prices.filter(
                      p => p >= outlierThreshold
                    );
                    // Remove entry if no prices remain after filtering
                    if (conditionMap[cond].prices.length === 0) {
                      delete conditionMap[cond];
                    }
                  }
                }
              }

              const conditions = Object.entries(conditionMap)
                .sort((a, b) => {
                  const ai = conditionOrder.indexOf(a[0]);
                  const bi = conditionOrder.indexOf(b[0]);
                  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                });
              if (conditions.length === 0) return null;
              const LOW_SAMPLE_THRESHOLD = 5;

              // Check if a condition's median is suspiciously low compared to NM
              const isSuspiciousPrice = (cond: string, median: number, count: number): boolean => {
                if (!nmMedian || nmMedian < 10) return false;
                if (cond === 'Near Mint') return false;
                // If median is still < 30% of NM after outlier filtering and sample is tiny, flag it
                return median < nmMedian * 0.30 && count < LOW_SAMPLE_THRESHOLD;
              };
              const conditionGuideData: { abbr: string; name: string; color: string; description: string; condKey: string }[] = [
                { abbr: 'NM', name: 'Near Mint', color: '#00ff41', description: 'Looks brand new \u2014 sharp corners, clean surface, no marks', condKey: 'Near Mint' },
                { abbr: 'LP', name: 'Lightly Played', color: '#8bc34a', description: 'Minor edge wear or small scratches \u2014 still looks great', condKey: 'Lightly Played' },
                { abbr: 'MP', name: 'Moderately Played', color: '#ff9800', description: 'Noticeable wear, some creases or whitening on edges', condKey: 'Moderately Played' },
                { abbr: 'HP', name: 'Heavily Played', color: '#f44336', description: 'Significant wear \u2014 major creases, heavy edge whitening', condKey: 'Heavily Played' },
                { abbr: 'DMG', name: 'Damaged', color: '#9e9e9e', description: 'Structural damage \u2014 tears, water damage, or heavy bending', condKey: 'Damaged' },
              ];
              return (
                <Box sx={{ mt: 2.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
                    <Typography variant="body2" sx={{
                      color: '#00bcd4', fontWeight: 700, fontSize: '0.7rem',
                      fontFamily: '"JetBrains Mono", monospace', letterSpacing: 1,
                    }}>
                      CONDITION PRICING
                    </Typography>
                    <Box
                      component="button"
                      onClick={() => setConditionGuideOpen(!conditionGuideOpen)}
                      sx={{
                        display: 'inline-flex', alignItems: 'center', gap: 0.3,
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        color: conditionGuideOpen ? '#00bcd4' : '#555',
                        '&:hover': { color: '#00bcd4' },
                        transition: 'color 0.2s',
                      }}
                    >
                      <HelpOutlineIcon sx={{ fontSize: 13 }} />
                      <Typography sx={{ fontSize: '0.6rem', fontFamily: 'monospace' }}>
                        {conditionGuideOpen ? 'hide guide' : "what's my card's condition?"}
                      </Typography>
                    </Box>
                  </Box>
                  <Collapse in={conditionGuideOpen}>
                    <Box sx={{ mb: 1.5, border: '1px solid #333', borderLeft: '3px solid #00bcd4', borderRadius: 1, bgcolor: '#0d0d1a', overflow: 'hidden' }}>
                      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: '#0a1929' }}>
                        <InfoOutlinedIcon sx={{ color: '#00bcd4', fontSize: 14 }} />
                        <Typography sx={{ color: '#00bcd4', fontSize: '0.7rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, letterSpacing: 1 }}>
                          CONDITION GUIDE
                        </Typography>
                      </Box>
                      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid #222' }}>
                        <Typography sx={{ color: '#aaa', fontSize: '0.65rem', fontFamily: 'monospace', lineHeight: 1.6, mb: 0.8 }}>
                          Not sure what condition your card is? Here's a quick guide — most cards found in old collections are <Box component="span" sx={{ color: '#8bc34a', fontWeight: 700 }}>Lightly Played (LP)</Box> or <Box component="span" sx={{ color: '#ff9800', fontWeight: 700 }}>Moderately Played (MP)</Box>.
                        </Typography>
                        <Typography sx={{ color: '#aaa', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700, mb: 0.5 }}>
                          QUICK CHECK
                        </Typography>
                        <Box sx={{ pl: 0.5 }}>
                          <Typography sx={{ color: '#ccc', fontSize: '0.65rem', fontFamily: 'monospace', lineHeight: 1.8 }}>
                            1. Any creases, bends, or tears? &rarr; <Box component="span" sx={{ color: '#f44336', fontWeight: 700 }}>HP</Box> or <Box component="span" sx={{ color: '#9e9e9e', fontWeight: 700 }}>DMG</Box>
                          </Typography>
                          <Typography sx={{ color: '#ccc', fontSize: '0.65rem', fontFamily: 'monospace', lineHeight: 1.8 }}>
                            2. Edges white or worn? &rarr; <Box component="span" sx={{ color: '#ff9800', fontWeight: 700 }}>MP</Box> or <Box component="span" sx={{ color: '#8bc34a', fontWeight: 700 }}>LP</Box>
                          </Typography>
                          <Typography sx={{ color: '#ccc', fontSize: '0.65rem', fontFamily: 'monospace', lineHeight: 1.8 }}>
                            3. Looks brand new, sharp corners? &rarr; <Box component="span" sx={{ color: '#00ff41', fontWeight: 700 }}>NM</Box>
                          </Typography>
                        </Box>
                      </Box>
                      {conditionGuideData.map((cg) => {
                        const matchedCond = conditions.find(([c]) => c === cg.condKey);
                        const medianVal = matchedCond ? getMedian(matchedCond[1].prices) : null;
                        const sampleCount = matchedCond ? matchedCond[1].prices.length : 0;
                        const suspicious = medianVal !== null && isSuspiciousPrice(cg.condKey, medianVal, sampleCount);
                        return (
                          <Box key={cg.abbr} sx={{ px: 1.5, py: 0.8, borderBottom: '1px solid #1a1a2e', display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                            <Typography sx={{ color: cg.color, fontWeight: 700, fontSize: '0.7rem', fontFamily: '"JetBrains Mono", monospace', minWidth: 30 }}>
                              {cg.abbr}
                            </Typography>
                            <Box sx={{ flex: 1 }}>
                              <Typography sx={{ color: '#ccc', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                                <Box component="span" sx={{ fontWeight: 700 }}>{cg.name}</Box> &mdash; {cg.description}
                              </Typography>
                              {medianVal !== null && (
                                suspicious ? (
                                  <Typography sx={{ color: '#ff9800', fontSize: '0.6rem', fontFamily: '"JetBrains Mono", monospace', mt: 0.3 }}>
                                    Insufficient data ({sampleCount} sale{sampleCount !== 1 ? 's' : ''})
                                  </Typography>
                                ) : (
                                  <Typography sx={{ color: cg.color, fontSize: '0.6rem', fontFamily: '"JetBrains Mono", monospace', mt: 0.3 }}>
                                    This card: ~${medianVal.toFixed(2)} median
                                  </Typography>
                                )
                              )}
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
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
                      const suspicious = isSuspiciousPrice(cond, median, count);
                      const sorted = [...data.prices].sort((a, b) => a - b);
                      const low = sorted[0];
                      const high = sorted[sorted.length - 1];
                      return (
                        <Box key={cond} sx={{ borderTop: '1px solid #222', opacity: (isLowSample || suspicious) ? 0.5 : 1, '&:hover': { bgcolor: '#1a1a2e33' } }}>
                          <Box sx={{ display: 'flex', px: 1, py: 0.4, alignItems: 'center' }}>
                            <Typography sx={{ flex: 1, color: (isLowSample || suspicious) ? '#666' : '#ccc', fontSize: '0.7rem', fontFamily: 'monospace' }}>
                              {cond === 'Near Mint' ? <GlossaryTooltip term="nm">NM</GlossaryTooltip> : cond === 'Lightly Played' ? <GlossaryTooltip term="lp">LP</GlossaryTooltip> : cond === 'Moderately Played' ? <GlossaryTooltip term="mp">MP</GlossaryTooltip> : cond === 'Heavily Played' ? <GlossaryTooltip term="hp">HP</GlossaryTooltip> : cond === 'Damaged' ? <GlossaryTooltip term="dmg">DMG</GlossaryTooltip> : cond}
                            </Typography>
                            {suspicious ? (
                              <Typography sx={{ width: 110, textAlign: 'right', color: '#ff9800', fontSize: '0.6rem', fontFamily: '"JetBrains Mono", monospace', fontStyle: 'italic' }}>
                                Insufficient data
                              </Typography>
                            ) : (
                              <>
                                <Typography sx={{ width: 55, textAlign: 'right', color: isLowSample ? '#666' : '#00ff41', fontSize: '0.7rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                                  ${median.toFixed(2)}
                                </Typography>
                                <Typography sx={{ width: 55, textAlign: 'right', fontSize: '0.65rem', fontFamily: 'monospace', color: isLowSample ? '#ff9800' : '#888' }}>
                                  {count}{isLowSample && ' *'}
                                </Typography>
                              </>
                            )}
                          </Box>
                          {!suspicious && count > 1 && (
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
          <CardSummary card={card} sales={sales} medianPrice={medianPrice} analysis={analysis} />
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
                  Sale data not yet available for this card.
                </Typography>
              )}
              {chartView === 'history' && (
                <Button
                  size="small"
                  startIcon={<CompareArrowsIcon sx={{ fontSize: 16 }} />}
                  onClick={() => { setCompareSearchQuery(''); setCompareSearchResults([]); setCompareDialogOpen(true); }}
                  sx={{
                    color: compareCard ? '#00bcd4' : '#888',
                    borderColor: compareCard ? '#00bcd4' : '#333',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    textTransform: 'none',
                    px: 1.5,
                    py: 0.3,
                    border: '1px solid',
                    '&:hover': { borderColor: '#00bcd4', color: '#00bcd4', bgcolor: 'rgba(0,188,212,0.08)' },
                  }}
                >
                  {compareCard ? `vs ${compareCard.name}` : 'Compare'}
                </Button>
              )}
            </Box>

            {chartView === 'sales' ? (
              <SalesChart sales={sales} medianPrice={medianPrice} cardName={card.name} />
            ) : (
              <>
                <Typography variant="h3" sx={{ mb: 0.3, color: '#00bcd4' }}>
                  PRICE HISTORY
                </Typography>
                <Typography sx={{ color: '#555', fontSize: '0.6rem', fontFamily: 'monospace', mb: 1 }}>
                  TCGPlayer listing price over time (may differ from actual sale prices shown in Sales tab)
                </Typography>
                <PriceChart
                  priceData={prices}
                  cardName={card.name}
                  compareData={compareCard ? { priceData: comparePrices, cardName: compareCard.name, currentPrice: compareCard.current_price } : null}
                  onRemoveCompare={handleRemoveCompare}
                />
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

      {/* Price Alert Dialog */}
      <Dialog
        open={alertDialogOpen}
        onClose={() => setAlertDialogOpen(false)}
        PaperProps={{ sx: { bgcolor: '#111', border: '1px solid #1e1e1e', minWidth: 320 } }}
      >
        <DialogTitle sx={{ color: '#ff9800', fontFamily: 'monospace', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 1 }}>
          <NotificationsIcon sx={{ fontSize: 20 }} />
          Set Price Alert
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: '#888', fontSize: '0.8rem', mb: 2 }}>
            Get notified when {card?.name || 'this card'} hits your price targets.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            type="number"
            label="Alert when price rises above"
            placeholder="e.g. 50.00"
            value={alertDialogAbove}
            onChange={(e) => setAlertDialogAbove(e.target.value)}
            InputProps={{ startAdornment: <Typography sx={{ color: '#555', mr: 0.5 }}>$</Typography> }}
            sx={{ mb: 2, '& .MuiInputLabel-root': { color: '#666' } }}
          />
          <TextField
            fullWidth
            size="small"
            type="number"
            label="Alert when price drops below"
            placeholder="e.g. 20.00"
            value={alertDialogBelow}
            onChange={(e) => setAlertDialogBelow(e.target.value)}
            InputProps={{ startAdornment: <Typography sx={{ color: '#555', mr: 0.5 }}>$</Typography> }}
            sx={{ mb: 2, '& .MuiInputLabel-root': { color: '#666' } }}
          />
          <TextField
            fullWidth
            size="small"
            type="number"
            label="Alert when spread drops below %"
            placeholder="e.g. 20"
            value={alertDialogSpread}
            onChange={(e) => setAlertDialogSpread(e.target.value)}
            InputProps={{ startAdornment: <Typography sx={{ color: '#555', mr: 0.5 }}>%</Typography> }}
            sx={{ mb: 2, '& .MuiInputLabel-root': { color: '#666' } }}
          />
          <TextField
            fullWidth
            size="small"
            type="email"
            label="Email"
            placeholder="your@email.com"
            value={alertDialogEmail}
            onChange={(e) => setAlertDialogEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitAlert(); }}
            helperText="Required — where to send alert notifications"
            sx={{ '& .MuiInputLabel-root': { color: '#666' }, '& .MuiFormHelperText-root': { color: '#555' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAlertDialogOpen(false)} sx={{ color: '#666' }}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmitAlert}
            disabled={alertSubmitting || !alertDialogEmail.trim() || (isNaN(parseFloat(alertDialogAbove)) && isNaN(parseFloat(alertDialogBelow)) && isNaN(parseFloat(alertDialogSpread)))}
            sx={{ color: '#ff9800', fontWeight: 700 }}
          >
            {alertSubmitting ? 'Saving...' : 'Create Alert'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Compare Card Search Dialog */}
      <Dialog
        open={compareDialogOpen}
        onClose={() => setCompareDialogOpen(false)}
        PaperProps={{ sx: { bgcolor: '#111', border: '1px solid #1e1e1e', minWidth: 380, maxHeight: '70vh' } }}
      >
        <DialogTitle sx={{ color: '#00bcd4', fontFamily: 'monospace', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 1 }}>
          <CompareArrowsIcon sx={{ fontSize: 20 }} />
          Compare Price History
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: '#888', fontSize: '0.8rem', mb: 2 }}>
            Search for a card to overlay on the price chart.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="Search cards by name..."
            value={compareSearchQuery}
            onChange={(e) => handleCompareSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: '#555', fontSize: 18 }} />
                </InputAdornment>
              ),
              endAdornment: compareSearching ? (
                <InputAdornment position="end">
                  <CircularProgress size={16} sx={{ color: '#00bcd4' }} />
                </InputAdornment>
              ) : null,
            }}
            sx={{ mb: 1, '& .MuiInputLabel-root': { color: '#666' } }}
          />
          {compareSearchResults.length > 0 && (
            <List dense sx={{ maxHeight: 320, overflow: 'auto', '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: '#333', borderRadius: 2 } }}>
              {compareSearchResults.map((c) => (
                <ListItemButton
                  key={c.id}
                  onClick={() => handleSelectCompareCard(c)}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5,
                    '&:hover': { bgcolor: 'rgba(0,188,212,0.08)' },
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 44 }}>
                    <Avatar
                      src={c.image_small}
                      variant="rounded"
                      sx={{ width: 32, height: 44, bgcolor: '#1a1a2e' }}
                    />
                  </ListItemAvatar>
                  <ListItemText
                    primary={c.name}
                    secondary={c.set_name}
                    primaryTypographyProps={{ sx: { color: '#ccc', fontSize: '0.8rem', fontWeight: 600 } }}
                    secondaryTypographyProps={{ sx: { color: '#666', fontSize: '0.65rem', fontFamily: 'monospace' } }}
                  />
                  <Typography sx={{ color: '#00ff41', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, ml: 1 }}>
                    {c.current_price != null ? `$${c.current_price.toFixed(2)}` : '--'}
                  </Typography>
                </ListItemButton>
              ))}
            </List>
          )}
          {compareSearchQuery.trim().length >= 2 && !compareSearching && compareSearchResults.length === 0 && (
            <Typography sx={{ color: '#555', fontSize: '0.8rem', fontFamily: 'monospace', textAlign: 'center', py: 2 }}>
              No cards found
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompareDialogOpen(false)} sx={{ color: '#666' }}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Similar Cards Section */}
      <Paper sx={{ mt: 2, p: 2 }}>
        <Typography variant="h3" sx={{ color: '#00bcd4', mb: 2, fontSize: '0.85rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, letterSpacing: 1 }}>
          SIMILAR CARDS
        </Typography>
        {similarCards.length === 0 ? (
          <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.8rem' }}>
            No similar cards found
          </Typography>
        ) : (
          <Box sx={{
            display: 'flex',
            gap: 2,
            overflowX: 'auto',
            pb: 1,
            '&::-webkit-scrollbar': { height: 6 },
            '&::-webkit-scrollbar-thumb': { bgcolor: '#333', borderRadius: 3 },
          }}>
            {similarCards.map((sc) => (
              <MuiCard
                key={sc.id}
                sx={{
                  minWidth: { xs: 140, sm: 160 }, maxWidth: 180, bgcolor: '#0a0a1a', border: '1px solid #222',
                  flexShrink: 0, '&:hover': { borderColor: '#00bcd4' },
                }}
              >
                <CardActionArea onClick={() => navigate(`/card/${sc.id}`)}>
                  {sc.image_small ? (
                    <CardMedia
                      component="img"
                      image={sc.image_small}
                      alt={sc.name}
                      sx={{ height: 220, objectFit: 'contain', bgcolor: '#111', p: 1 }}
                    />
                  ) : (
                    <Box sx={{ height: 220, bgcolor: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography sx={{ color: '#333', fontSize: '0.7rem' }}>No Image</Typography>
                    </Box>
                  )}
                  <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                    <Typography sx={{ color: '#ccc', fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.2, mb: 0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sc.name}
                    </Typography>
                    <Typography sx={{ color: '#666', fontSize: '0.6rem', fontFamily: 'monospace', mb: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sc.set_name}
                    </Typography>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography sx={{ color: '#00ff41', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                        {sc.current_price != null ? `$${sc.current_price.toFixed(2)}` : '--'}
                      </Typography>
                      {sc.price_change_7d != null && Math.abs(sc.price_change_7d) <= 500 && (
                        <Typography sx={{
                          color: sc.price_change_7d >= 0 ? '#00ff41' : '#ff1744',
                          fontSize: '0.65rem',
                          fontFamily: '"JetBrains Mono", monospace',
                          fontWeight: 700,
                        }}>
                          {sc.price_change_7d >= 0 ? '+' : ''}{sc.price_change_7d.toFixed(1)}%
                        </Typography>
                      )}
                    </Box>
                  </CardContent>
                </CardActionArea>
              </MuiCard>
            ))}
          </Box>
        )}
      </Paper>
    </Box>
  );
}
