import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Box, Paper, Typography, Avatar, IconButton, TextField, Collapse,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  InputAdornment, CircularProgress, Snackbar, ClickAwayListener, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SellIcon from '@mui/icons-material/Sell';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SearchIcon from '@mui/icons-material/Search';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DownloadIcon from '@mui/icons-material/Download';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, LineChart, Line,
} from 'recharts';
import { api, Card, PricePoint } from '../services/api';
import type { RecapArchiveResponse } from '../services/api';
import GlossaryTooltip from '../components/GlossaryTooltip';

interface Lot {
  quantity: number;
  price: number;
  date: string;
}

interface WatchlistItem {
  cardId: number;
  costBasis: number | null;
  alertAbove: number | null;
  alertBelow: number | null;
  quantity?: number;
  lots?: Lot[];
  addedAt: string;
}

// Derive lots from legacy single costBasis/quantity if lots array is missing
function getLotsForItem(item: WatchlistItem): Lot[] {
  if (item.lots && item.lots.length > 0) return item.lots;
  if (item.costBasis != null && item.costBasis > 0) {
    return [{ quantity: item.quantity ?? 1, price: item.costBasis, date: item.addedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10) }];
  }
  if ((item.quantity ?? 1) > 0 && item.costBasis == null) {
    return [];
  }
  return [];
}

// Compute total quantity from lots
function totalQtyFromLots(lots: Lot[]): number {
  return lots.reduce((s, l) => s + l.quantity, 0) || 1;
}

// Compute weighted average cost basis from lots
function avgCostFromLots(lots: Lot[]): number | null {
  if (lots.length === 0) return null;
  const totalQty = lots.reduce((s, l) => s + l.quantity, 0);
  if (totalQty === 0) return null;
  const totalCost = lots.reduce((s, l) => s + l.quantity * l.price, 0);
  return totalCost / totalQty;
}

interface WatchlistRow extends WatchlistItem {
  card: Card | null;
  lots?: Lot[];
}

interface SoldCard {
  cardId: number;
  cardName: string;
  setName: string;
  buyPrice: number;
  sellPrice: number;
  sellDate: string;
  quantity: number;
  profit: number;
}

export default function Watchlist() {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Sold cards state
  const [soldCards, setSoldCards] = useState<SoldCard[]>(() =>
    JSON.parse(localStorage.getItem('pkmn_sold_cards') || '[]')
  );
  const [soldDialogOpen, setSoldDialogOpen] = useState(false);
  const [soldTarget, setSoldTarget] = useState<WatchlistRow | null>(null);
  const [soldSellPrice, setSoldSellPrice] = useState('');
  const [soldSellDate, setSoldSellDate] = useState(new Date().toISOString().slice(0, 10));

  // Lot editing dialog state
  const [lotDialogOpen, setLotDialogOpen] = useState(false);
  const [lotTarget, setLotTarget] = useState<WatchlistRow | null>(null);
  const [editLots, setEditLots] = useState<Lot[]>([]);

  useEffect(() => {
    document.title = 'Watchlist | PKMN Trader';
    return () => { document.title = 'PKMN Trader — Pokemon Card Market'; };
  }, []);

  const loadWatchlist = useCallback(async () => {
    setLoading(true);
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const loaded: WatchlistRow[] = await Promise.all(
      items.map(async (item) => {
        try {
          const card = await api.getCard(item.cardId);
          return { ...item, card };
        } catch {
          return { ...item, card: null };
        }
      })
    );
    setRows(loaded.filter(r => r.card !== null));
    setLoading(false);
  }, []);

  useEffect(() => { loadWatchlist(); }, [loadWatchlist]);

  const removeFromWatchlist = (cardId: number) => {
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    localStorage.setItem('pkmn_watchlist', JSON.stringify(items.filter(w => w.cardId !== cardId)));
    setRows(prev => prev.filter(r => r.cardId !== cardId));
  };

  const updateCostBasis = (cardId: number, value: string) => {
    const parsed = parseFloat(value);
    const numVal = value === '' || isNaN(parsed) ? null : parsed;
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const updated = items.map(w => w.cardId === cardId ? { ...w, costBasis: numVal } : w);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(updated));
    setRows(prev => prev.map(r => r.cardId === cardId ? { ...r, costBasis: numVal } : r));
  };

  const updateAlert = (cardId: number, field: 'alertAbove' | 'alertBelow', value: string) => {
    const parsed = parseFloat(value);
    const numVal = value === '' || isNaN(parsed) ? null : parsed;
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const updated = items.map(w => w.cardId === cardId ? { ...w, [field]: numVal } : w);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(updated));
    setRows(prev => prev.map(r => r.cardId === cardId ? { ...r, [field]: numVal } : r));
  };

  const updateQuantity = (cardId: number, value: string) => {
    const parsed = parseInt(value);
    const qty = value === '' || isNaN(parsed) || parsed < 1 ? 1 : parsed;
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const updated = items.map(w => w.cardId === cardId ? { ...w, quantity: qty } : w);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(updated));
    setRows(prev => prev.map(r => r.cardId === cardId ? { ...r, quantity: qty } : r));
  };

  const openLotDialog = (row: WatchlistRow) => {
    setLotTarget(row);
    const lots = getLotsForItem(row);
    setEditLots(lots.length > 0 ? lots.map(l => ({ ...l })) : [{ quantity: row.quantity ?? 1, price: row.costBasis ?? 0, date: new Date().toISOString().slice(0, 10) }]);
    setLotDialogOpen(true);
  };

  const saveLots = () => {
    if (!lotTarget) return;
    const validLots = editLots.filter(l => l.quantity > 0);
    const totalQty = totalQtyFromLots(validLots);
    const avgCost = avgCostFromLots(validLots);

    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    const updated = items.map(w => w.cardId === lotTarget.cardId ? { ...w, lots: validLots, quantity: totalQty, costBasis: avgCost } : w);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(updated));
    setRows(prev => prev.map(r => r.cardId === lotTarget.cardId ? { ...r, lots: validLots, quantity: totalQty, costBasis: avgCost } : r));
    setLotDialogOpen(false);
    setLotTarget(null);
    setSnackMsg(`Updated lots for ${lotTarget.card?.name}`);
  };

  const addLotRow = () => {
    setEditLots(prev => [...prev, { quantity: 1, price: 0, date: new Date().toISOString().slice(0, 10) }]);
  };

  const removeLotRow = (index: number) => {
    setEditLots(prev => prev.filter((_, i) => i !== index));
  };

  const updateLotField = (index: number, field: keyof Lot, value: string) => {
    setEditLots(prev => prev.map((lot, i) => {
      if (i !== index) return lot;
      if (field === 'date') return { ...lot, date: value };
      const num = parseFloat(value);
      if (field === 'quantity') return { ...lot, quantity: isNaN(num) || num < 1 ? 1 : Math.floor(num) };
      return { ...lot, price: isNaN(num) ? 0 : num };
    }));
  };

  const openSoldDialog = (row: WatchlistRow) => {
    setSoldTarget(row);
    setSoldSellPrice('');
    setSoldSellDate(new Date().toISOString().slice(0, 10));
    setSoldDialogOpen(true);
  };

  const confirmMarkAsSold = () => {
    if (!soldTarget) return;
    const sellPrice = parseFloat(soldSellPrice);
    if (isNaN(sellPrice) || sellPrice <= 0) return;

    const soldLots = getLotsForItem(soldTarget);
    const qty = soldLots.length > 0 ? totalQtyFromLots(soldLots) : (soldTarget.quantity ?? 1);
    const buyPrice = soldLots.length > 0 ? (avgCostFromLots(soldLots) ?? 0) : (soldTarget.costBasis ?? 0);
    const fees = sellPrice * qty * 0.1255;
    const profit = (sellPrice - buyPrice) * qty - fees;

    const soldEntry: SoldCard = {
      cardId: soldTarget.cardId,
      cardName: soldTarget.card?.name ?? 'Unknown',
      setName: soldTarget.card?.set_name ?? '',
      buyPrice,
      sellPrice,
      sellDate: soldSellDate,
      quantity: qty,
      profit,
    };

    const updatedSold = [...soldCards, soldEntry];
    setSoldCards(updatedSold);
    localStorage.setItem('pkmn_sold_cards', JSON.stringify(updatedSold));

    // Remove from active watchlist
    removeFromWatchlist(soldTarget.cardId);

    setSoldDialogOpen(false);
    setSoldTarget(null);
    setSnackMsg(`Marked ${soldEntry.cardName} as sold`);
  };

  const removeSoldCard = (index: number) => {
    const updated = soldCards.filter((_, i) => i !== index);
    setSoldCards(updated);
    localStorage.setItem('pkmn_sold_cards', JSON.stringify(updated));
  };

  // Sold cards summary
  const soldSummary = useMemo(() => {
    if (soldCards.length === 0) return null;
    const totalProfit = soldCards.reduce((s, c) => s + c.profit, 0);
    const totalTrades = soldCards.length;
    const avgRoi = soldCards.reduce((s, c) => {
      const cost = c.buyPrice * c.quantity;
      return s + (cost > 0 ? (c.profit / cost) * 100 : 0);
    }, 0) / totalTrades;
    return { totalProfit, totalTrades, avgRoi };
  }, [soldCards]);

  // Quick Add state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Card[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [snackMsg, setSnackMsg] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const watchlistIds = useMemo(() => new Set(rows.map(r => r.cardId)), [rows]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await api.getCards({ q: query.trim(), page_size: '8' });
        setSearchResults(res.data);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, []);

  const quickAdd = useCallback((card: Card) => {
    const items: WatchlistItem[] = JSON.parse(localStorage.getItem('pkmn_watchlist') || '[]');
    if (items.some(w => w.cardId === card.id)) {
      setSnackMsg(`${card.name} is already on your watchlist`);
      return;
    }
    const newItem: WatchlistItem = {
      cardId: card.id,
      costBasis: null,
      alertAbove: null,
      alertBelow: null,
      quantity: 1,
      addedAt: new Date().toISOString(),
    };
    items.push(newItem);
    localStorage.setItem('pkmn_watchlist', JSON.stringify(items));
    setRows(prev => [...prev, { ...newItem, card }]);
    setSnackMsg(`Added ${card.name} to watchlist`);
    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
  }, []);

  const [chartOpen, setChartOpen] = useState(true);
  const [chartData, setChartData] = useState<{ date: string; value: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [cardPriceHistories, setCardPriceHistories] = useState<Map<number, PricePoint[]>>(new Map());
  const [marketIndexHistory, setMarketIndexHistory] = useState<{ week: string; avg: number }[]>([]);

  // Fetch price histories for all watchlist cards and build portfolio value over time
  useEffect(() => {
    if (rows.length === 0) return;
    let cancelled = false;
    (async () => {
      setChartLoading(true);
      try {
        const priceResults = await Promise.all(
          rows.map(async (row) => {
            try {
              const res = await api.getCardPrices(row.cardId);
              return { cardId: row.cardId, data: res.data };
            } catch {
              return { cardId: row.cardId, data: [] as PricePoint[] };
            }
          })
        );
        if (cancelled) return;

        // Store per-card price histories for sparklines
        const histMap = new Map<number, PricePoint[]>();
        for (const { cardId, data } of priceResults) {
          histMap.set(cardId, data);
        }
        setCardPriceHistories(histMap);

        // Build a map of cardId -> { date -> price }, skipping $0/null prices
        // Also detect variant switches (>500% single-day jump) and use the new price baseline
        const cardPriceMap: Record<number, Record<string, number>> = {};
        for (const { cardId, data } of priceResults) {
          const dateMap: Record<string, number> = {};
          const validPts = data.filter(pt => pt.market_price && pt.market_price > 0);
          // Detect variant switch: if last price is >5x the median of earlier prices, use only post-switch data
          if (validPts.length >= 3) {
            const lastPrice = validPts[validPts.length - 1].market_price;
            const earlierPrices = validPts.slice(0, -3).map(p => p.market_price);
            if (earlierPrices.length > 0) {
              const medianEarlier = earlierPrices.sort((a, b) => a - b)[Math.floor(earlierPrices.length / 2)];
              if (lastPrice > medianEarlier * 5 || lastPrice < medianEarlier * 0.2) {
                // Variant switch detected — only use the most recent consistent prices
                const switchIdx = validPts.findIndex((pt, i) => {
                  if (i === 0) return false;
                  const prev = validPts[i - 1].market_price;
                  return pt.market_price > prev * 5 || pt.market_price < prev * 0.2;
                });
                const postSwitch = switchIdx > 0 ? validPts.slice(switchIdx) : validPts;
                for (const pt of postSwitch) {
                  dateMap[pt.date] = pt.market_price;
                }
                cardPriceMap[cardId] = dateMap;
                continue;
              }
            }
          }
          for (const pt of validPts) {
            dateMap[pt.date] = pt.market_price;
          }
          cardPriceMap[cardId] = dateMap;
        }

        // Generate last 30 days
        const dates: string[] = [];
        const now = new Date();
        for (let i = 29; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          dates.push(d.toISOString().slice(0, 10));
        }

        // Pre-seed lastKnown with the most recent valid price before the chart window
        // This prevents dips at the start of the chart when no data exists yet
        const lastKnown: Record<number, number> = {};
        for (const row of rows) {
          const priceMap = cardPriceMap[row.cardId] || {};
          const allDates = Object.keys(priceMap).sort();
          // Find the most recent price on or before the chart start
          const chartStart = dates[0];
          let seedPrice: number | null = null;
          for (const d of allDates) {
            if (d <= chartStart) {
              seedPrice = priceMap[d];
            } else {
              break;
            }
          }
          // Use seed price, or fallback to first available price, or current_price
          if (seedPrice && seedPrice > 0) {
            lastKnown[row.cardId] = seedPrice;
          } else if (allDates.length > 0) {
            lastKnown[row.cardId] = priceMap[allDates[0]];
          } else if (row.card?.current_price && row.card.current_price > 0) {
            lastKnown[row.cardId] = row.card.current_price;
          }
        }

        // For each date, sum portfolio value with forward-fill
        const series = dates.map(date => {
          let total = 0;
          for (const row of rows) {
            const lots = getLotsForItem(row);
            const qty = lots.length > 0 ? totalQtyFromLots(lots) : (row.quantity ?? 1);
            const priceMap = cardPriceMap[row.cardId] || {};
            if (priceMap[date] !== undefined && priceMap[date] > 0) {
              lastKnown[row.cardId] = priceMap[date];
            }
            const price = lastKnown[row.cardId] ?? row.card?.current_price ?? 0;
            total += price * qty;
          }
          return { date, value: parseFloat(total.toFixed(2)) };
        });

        setChartData(series);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rows]);

  // Fetch market index history for benchmark overlay
  useEffect(() => {
    api.getRecapArchive().then(async (archive: RecapArchiveResponse) => {
      const weeks = (archive.weeks || []).slice(-8);
      const results = await Promise.allSettled(
        weeks.map(w => api.getRecapForWeek(w.start).then(r => ({ week: w.start, avg: r?.market_index?.avg_price })))
      );
      const points = results
        .filter((r): r is PromiseFulfilledResult<{ week: string; avg: number | undefined }> => r.status === 'fulfilled' && !!r.value.avg)
        .map(r => ({ week: r.value.week, avg: r.value.avg! }));
      setMarketIndexHistory(points);
    }).catch(() => {});
  }, []);

  // Build normalized % change data for portfolio vs market benchmark
  const benchmarkChartData = useMemo(() => {
    if (chartData.length < 2) return [];
    const portfolioStart = chartData[0].value;
    if (portfolioStart === 0) return [];

    // Interpolate market index to daily data by mapping weekly points to chart dates
    // Build a map of date -> market avg using forward-fill from weekly data
    const marketByDate: Record<string, number> = {};
    if (marketIndexHistory.length > 0) {
      // Sort weeks chronologically
      const sorted = [...marketIndexHistory].sort((a, b) => a.week.localeCompare(b.week));
      let lastAvg = sorted[0].avg;
      // For each chart date, find the most recent weekly avg
      for (const dp of chartData) {
        for (const wp of sorted) {
          if (wp.week <= dp.date) lastAvg = wp.avg;
        }
        marketByDate[dp.date] = lastAvg;
      }
    }

    const marketStart = marketByDate[chartData[0].date];
    if (!marketStart || marketStart === 0) {
      // No market data available, just return portfolio % change
      return chartData.map(d => ({
        date: d.date,
        portfolioPct: ((d.value - portfolioStart) / portfolioStart) * 100,
        marketPct: undefined as number | undefined,
      }));
    }

    return chartData.map(d => ({
      date: d.date,
      portfolioPct: ((d.value - portfolioStart) / portfolioStart) * 100,
      marketPct: (marketByDate[d.date] != null
        ? ((marketByDate[d.date] - marketStart) / marketStart) * 100
        : undefined) as number | undefined,
    }));
  }, [chartData, marketIndexHistory]);

  // Compute portfolio vs market summary
  const vsMarket = useMemo(() => {
    if (benchmarkChartData.length < 2) return null;
    const last = benchmarkChartData[benchmarkChartData.length - 1];
    if (last.marketPct == null) return null;
    const diff = last.portfolioPct - last.marketPct;
    return { portfolioPct: last.portfolioPct, marketPct: last.marketPct, diff };
  }, [benchmarkChartData]);

  const totalValue = rows.reduce((sum, r) => {
    const lots = getLotsForItem(r);
    const qty = lots.length > 0 ? totalQtyFromLots(lots) : (r.quantity ?? 1);
    return sum + (r.card?.current_price || 0) * qty;
  }, 0);
  const totalCost = rows.reduce((sum, r) => {
    const lots = getLotsForItem(r);
    if (lots.length > 0) return sum + lots.reduce((s, l) => s + l.quantity * l.price, 0);
    return sum + (r.costBasis || 0) * (r.quantity ?? 1);
  }, 0);
  const totalPnL = totalCost > 0 ? totalValue - totalCost : null;

  const monthChange = useMemo(() => {
    if (chartData.length < 2) return null;
    const first = chartData[0].value;
    const last = chartData[chartData.length - 1].value;
    if (first === 0) return null;
    return { amount: last - first, pct: ((last - first) / first) * 100 };
  }, [chartData]);

  const exportCSV = useCallback(() => {
    const header = ['Card Name', 'Set', 'Price', 'Purchase Price', 'Quantity', 'Total Value', 'Total Cost', 'Profit/Loss', '7d Change %'];
    const csvRows = rows.map(row => {
      const card = row.card;
      const rowLots = getLotsForItem(row);
      const qty = rowLots.length > 0 ? totalQtyFromLots(rowLots) : (row.quantity ?? 1);
      const rowCostBasis = rowLots.length > 0 ? avgCostFromLots(rowLots) : row.costBasis;
      const price = card?.current_price ?? 0;
      const rowTotalValue = price * qty;
      const rowTotalCost = (rowCostBasis ?? 0) * qty;
      const rowPnL = rowCostBasis != null ? rowTotalValue - rowTotalCost : '';

      // 7d change from price history
      const priceHist = cardPriceHistories.get(row.cardId) || [];
      let change7dStr = '';
      if (priceHist.length >= 2) {
        const latest = priceHist[priceHist.length - 1].market_price;
        const idx7d = Math.max(0, priceHist.length - 8);
        const price7d = priceHist[idx7d].market_price;
        if (price7d > 0) {
          const raw = ((latest - price7d) / price7d) * 100;
          // Cap at +/- 500% to filter out data artifacts
          if (Math.abs(raw) <= 500) {
            change7dStr = raw.toFixed(2);
          }
        }
      }

      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      return [
        escape(card?.name ?? 'Unknown'),
        escape(card?.set_name ?? ''),
        price.toFixed(2),
        rowCostBasis != null ? rowCostBasis.toFixed(2) : '',
        String(qty),
        rowTotalValue.toFixed(2),
        rowCostBasis != null ? rowTotalCost.toFixed(2) : '',
        rowPnL !== '' ? (rowPnL as number).toFixed(2) : '',
        change7dStr,
      ].join(',');
    });

    const csv = [header.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `pkmn_portfolio_${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [rows, cardPriceHistories]);

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <BookmarkIcon sx={{ color: '#ffd700' }} />
        <Typography variant="h2" sx={{ color: '#ffd700' }}>WATCHLIST</Typography>
        <Typography variant="body2" sx={{ color: '#666', ml: 'auto' }}>
          {rows.length} cards
        </Typography>
      </Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ color: '#888', fontSize: '0.8rem' }}>
          Cards you're tracking. Add what you paid to see your profit.
        </Typography>
      </Box>
      {rows.length > 0 && (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#111', border: '1px solid #1e1e1e', flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography sx={{ color: '#4fc3f7', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem', fontWeight: 700 }}>
              EXPORT PORTFOLIO
            </Typography>
            <Typography sx={{ color: '#666', fontSize: '0.7rem', fontFamily: '"JetBrains Mono", monospace', display: { xs: 'none', sm: 'block' } }}>
              Download your portfolio as a spreadsheet
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={exportCSV}
            sx={{
              color: '#4fc3f7',
              borderColor: '#4fc3f7',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: { xs: '0.7rem', sm: '0.8rem' },
              textTransform: 'none',
              px: { xs: 2, sm: 3 },
              py: 1,
              '&:hover': { borderColor: '#81d4fa', bgcolor: 'rgba(79, 195, 247, 0.08)' },
            }}
          >
            Export CSV
          </Button>
        </Paper>
      )}

      {/* Quick Add Search */}
      <Paper sx={{ p: 1.5, mb: 2, position: 'relative' }}>
        <ClickAwayListener onClickAway={() => setShowDropdown(false)}>
          <Box ref={dropdownRef}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <AddCircleOutlineIcon sx={{ color: '#ffd700', fontSize: 18 }} />
              <Typography sx={{ color: '#ffd700', fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Quick Add
              </Typography>
            </Box>
            <TextField
              fullWidth
              size="small"
              placeholder="Search cards by name to add..."
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#555', fontSize: 18 }} />
                  </InputAdornment>
                ),
                endAdornment: searchLoading ? (
                  <InputAdornment position="end">
                    <CircularProgress size={16} sx={{ color: '#555' }} />
                  </InputAdornment>
                ) : null,
              }}
              sx={{
                '& .MuiInputBase-input': {
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: '0.85rem',
                  color: '#ccc',
                },
                '& .MuiOutlinedInput-root': {
                  '& fieldset': { borderColor: '#333' },
                  '&:hover fieldset': { borderColor: '#555' },
                  '&.Mui-focused fieldset': { borderColor: '#ffd700' },
                },
              }}
            />
            {showDropdown && searchResults.length > 0 && (
              <Paper
                sx={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: '100%',
                  zIndex: 1200,
                  maxHeight: 360,
                  overflowY: 'auto',
                  border: '1px solid #333',
                  bgcolor: '#0d0d1a',
                  mt: 0.5,
                }}
              >
                {searchResults.map(card => {
                  const alreadyAdded = watchlistIds.has(card.id);
                  return (
                    <Box
                      key={card.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 1.5,
                        py: 1,
                        borderBottom: '1px solid #1a1a2e',
                        '&:hover': { bgcolor: '#1a1a2e' },
                        cursor: alreadyAdded ? 'default' : 'pointer',
                        opacity: alreadyAdded ? 0.5 : 1,
                      }}
                      onClick={() => { if (!alreadyAdded) quickAdd(card); }}
                    >
                      <Avatar
                        src={card.image_small}
                        variant="rounded"
                        sx={{ width: 32, height: 44, flexShrink: 0 }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {card.name}
                        </Typography>
                        <Typography sx={{ color: '#666', fontSize: '0.65rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {card.set_name} &middot; {card.rarity}
                        </Typography>
                      </Box>
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        color: '#00ff41',
                        flexShrink: 0,
                      }}>
                        {card.current_price != null ? `$${card.current_price.toFixed(2)}` : '—'}
                      </Typography>
                      {alreadyAdded ? (
                        <CheckCircleIcon sx={{ color: '#555', fontSize: 20, flexShrink: 0 }} />
                      ) : (
                        <IconButton
                          size="small"
                          onClick={e => { e.stopPropagation(); quickAdd(card); }}
                          sx={{ color: '#ffd700', flexShrink: 0, '&:hover': { color: '#00ff41' } }}
                        >
                          <AddCircleOutlineIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                      )}
                    </Box>
                  );
                })}
              </Paper>
            )}
            {showDropdown && searchResults.length === 0 && searchQuery.trim().length >= 2 && !searchLoading && (
              <Paper
                sx={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: '100%',
                  zIndex: 1200,
                  border: '1px solid #333',
                  bgcolor: '#0d0d1a',
                  mt: 0.5,
                  p: 2,
                  textAlign: 'center',
                }}
              >
                <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  No cards found for "{searchQuery}"
                </Typography>
              </Paper>
            )}
          </Box>
        </ClickAwayListener>
      </Paper>

      {/* Portfolio Summary */}
      {rows.length > 0 && (
        <Box sx={{ display: 'flex', gap: { xs: 1, sm: 2 }, mb: 2, flexWrap: 'wrap' }}>
          <Paper sx={{ p: 1.5, flex: '1 1 auto', minWidth: { xs: '45%', sm: 120 }, textAlign: 'center' }}>
            <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>Total Value</Typography>
            <Typography sx={{ color: '#00ff41', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem' }}>
              ${totalValue.toFixed(2)}
            </Typography>
          </Paper>
          {totalCost > 0 && (
            <>
              <Paper sx={{ p: 1.5, flex: '1 1 auto', minWidth: { xs: '45%', sm: 120 }, textAlign: 'center' }}>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>Total Cost</Typography>
                <Typography sx={{ color: '#888', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem' }}>
                  ${totalCost.toFixed(2)}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, flex: '1 1 auto', minWidth: { xs: '45%', sm: 120 }, textAlign: 'center' }}>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}><GlossaryTooltip term="pnl">Profit/Loss</GlossaryTooltip></Typography>
                <Typography sx={{
                  color: totalPnL != null && totalPnL >= 0 ? '#00ff41' : '#ff1744',
                  fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem',
                }}>
                  {totalPnL != null && totalPnL >= 0 ? '+' : ''}${totalPnL?.toFixed(2)} ({totalCost > 0 ? ((totalPnL! / totalCost) * 100).toFixed(1) : '0'}%)
                </Typography>
              </Paper>
            </>
          )}
        </Box>
      )}

      {/* Portfolio Performance Chart */}
      {rows.length > 0 && (
        <Paper sx={{ mb: 2, overflow: 'hidden' }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, cursor: 'pointer', '&:hover': { bgcolor: '#1a1a2e' } }}
            onClick={() => setChartOpen(!chartOpen)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ color: '#ffd700', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 700, letterSpacing: 1 }}>
                PORTFOLIO PERFORMANCE
              </Typography>
              {monthChange && (
                <Typography sx={{
                  fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem', fontWeight: 700,
                  color: monthChange.amount >= 0 ? '#00ff41' : '#ff1744',
                }}>
                  Portfolio {monthChange.amount >= 0 ? 'up' : 'down'} {Math.abs(monthChange.pct).toFixed(1)}% this month
                </Typography>
              )}
              {vsMarket && (
                <Typography sx={{
                  fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem', fontWeight: 600,
                  color: vsMarket.diff >= 0 ? '#00ff41' : '#ff1744',
                  ml: 1,
                }}>
                  vs Market: {vsMarket.diff >= 0 ? '+' : ''}{vsMarket.diff.toFixed(1)}%
                </Typography>
              )}
            </Box>
            <IconButton size="small" sx={{ color: '#666' }}>
              {chartOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
          <Collapse in={chartOpen}>
            <Box sx={{ px: 2, pb: 2 }}>
              {/* Summary stats row */}
              <Box sx={{ display: 'flex', gap: 3, mb: 1.5, flexWrap: 'wrap' }}>
                <Box>
                  <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.6rem', textTransform: 'uppercase' }}>Current Value</Typography>
                  <Typography sx={{ color: '#00ff41', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '1rem' }}>
                    ${totalValue.toFixed(2)}
                  </Typography>
                </Box>
                {totalCost > 0 && (
                  <>
                    <Box>
                      <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.6rem', textTransform: 'uppercase' }}><GlossaryTooltip term="cost_basis">What You Paid</GlossaryTooltip></Typography>
                      <Typography sx={{ color: '#888', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '1rem' }}>
                        ${totalCost.toFixed(2)}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.6rem', textTransform: 'uppercase' }}><GlossaryTooltip term="pnl">Profit/Loss</GlossaryTooltip></Typography>
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '1rem',
                        color: totalPnL != null && totalPnL >= 0 ? '#00ff41' : '#ff1744',
                      }}>
                        {totalPnL != null && totalPnL >= 0 ? '+' : ''}${totalPnL?.toFixed(2)} ({totalCost > 0 ? ((totalPnL! / totalCost) * 100).toFixed(1) : '0'}%)
                      </Typography>
                    </Box>
                  </>
                )}
              </Box>
              {chartLoading ? (
                <Typography sx={{ color: '#555', textAlign: 'center', py: 4, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  Loading price history...
                </Typography>
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00ff41" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#00ff41" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
                      tickFormatter={(d: string) => d.slice(5)}
                      stroke="#333"
                    />
                    <YAxis
                      tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
                      tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                      stroke="#333"
                      domain={totalCost > 0
                        ? [
                            Math.min(totalCost, Math.min(...chartData.map(d => d.value))) * 0.95,
                            Math.max(totalCost, Math.max(...chartData.map(d => d.value))) * 1.05,
                          ]
                        : ['auto', 'auto']
                      }
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0a0a1a', border: '1px solid #333', fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}
                      labelStyle={{ color: '#888' }}
                      formatter={(value: any, name: string) => {
                        if (name === 'costLine') return [`$${Number(value).toFixed(2)}`, 'Cost Basis'];
                        return [`$${Number(value).toFixed(2)}`, 'Portfolio Value'];
                      }}
                    />
                    {totalCost > 0 && (
                      <ReferenceLine
                        y={totalCost}
                        stroke="#ffb74d"
                        strokeDasharray="8 4"
                        strokeWidth={1.5}
                        label={{ value: `Break-even $${totalCost.toFixed(0)}`, fill: '#ffb74d', fontSize: 10, fontFamily: 'monospace', position: 'right' }}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#00ff41"
                      strokeWidth={2}
                      fill="url(#portfolioGrad)"
                      dot={false}
                      activeDot={{ r: 4, stroke: '#00ff41', strokeWidth: 2, fill: '#0a0a1a' }}
                      name="Portfolio Value"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <Typography sx={{ color: '#555', textAlign: 'center', py: 4, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  No price history available
                </Typography>
              )}
              {totalCost > 0 && chartData.length > 0 && (
                <Box sx={{ display: 'flex', gap: 2, mt: 0.5, justifyContent: 'center' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 16, height: 2, bgcolor: '#00ff41', borderRadius: 1 }} />
                    <Typography sx={{ color: '#888', fontFamily: 'monospace', fontSize: '0.6rem' }}>Portfolio Value</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 16, height: 0, borderTop: '2px dashed #ffb74d', borderRadius: 1 }} />
                    <Typography sx={{ color: '#888', fontFamily: 'monospace', fontSize: '0.6rem' }}>Break-even (Cost Basis)</Typography>
                  </Box>
                </Box>
              )}

              {/* Benchmark Comparison Chart (% change) */}
              {benchmarkChartData.length > 1 && (
                <Box sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography sx={{ color: '#888', fontFamily: 'monospace', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Performance vs Market (% Change)
                    </Typography>
                    {vsMarket && (
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace', fontSize: '0.65rem', fontWeight: 700,
                        color: vsMarket.diff >= 0 ? '#00ff41' : '#ff1744',
                      }}>
                        {vsMarket.diff >= 0 ? 'Outperforming' : 'Underperforming'} market by {Math.abs(vsMarket.diff).toFixed(1)}%
                      </Typography>
                    )}
                  </Box>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={benchmarkChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
                        tickFormatter={(d: string) => d.slice(5)}
                        stroke="#333"
                      />
                      <YAxis
                        tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
                        tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
                        stroke="#333"
                        domain={['auto', 'auto']}
                      />
                      <ReferenceLine y={0} stroke="#444" strokeWidth={1} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0a0a1a', border: '1px solid #333', fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}
                        labelStyle={{ color: '#888' }}
                        formatter={(value: any, name: string) => {
                          const v = Number(value);
                          const label = name === 'portfolioPct' ? 'Your Portfolio' : 'Market Average';
                          return [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, label];
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="portfolioPct"
                        stroke="#00ff41"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, stroke: '#00ff41', strokeWidth: 2, fill: '#0a0a1a' }}
                        name="portfolioPct"
                      />
                      <Line
                        type="monotone"
                        dataKey="marketPct"
                        stroke="#888"
                        strokeWidth={1.5}
                        strokeDasharray="6 3"
                        dot={false}
                        activeDot={{ r: 3, stroke: '#888', strokeWidth: 2, fill: '#0a0a1a' }}
                        name="marketPct"
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <Box sx={{ display: 'flex', gap: 2, mt: 0.5, justifyContent: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 16, height: 2, bgcolor: '#00ff41', borderRadius: 1 }} />
                      <Typography sx={{ color: '#888', fontFamily: 'monospace', fontSize: '0.6rem' }}>Your Portfolio</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 16, height: 0, borderTop: '2px dashed #888', borderRadius: 1 }} />
                      <Typography sx={{ color: '#888', fontFamily: 'monospace', fontSize: '0.6rem' }}>Market Average</Typography>
                    </Box>
                  </Box>
                </Box>
              )}

              {/* Portfolio Allocation Bar */}
              {(() => {
                const ALLOC_COLORS = ['#4fc3f7', '#ffb74d', '#81c784', '#e57373', '#ba68c8', '#4db6ac', '#fff176', '#f06292', '#90a4ae', '#aed581'];
                const cardsWithValue = rows
                  .map((r, i) => {
                    const rLots = getLotsForItem(r);
                    const rQty = rLots.length > 0 ? totalQtyFromLots(rLots) : (r.quantity ?? 1);
                    return {
                      name: r.card?.name || 'Unknown',
                      value: (r.card?.current_price || 0) * rQty,
                      color: ALLOC_COLORS[i % ALLOC_COLORS.length],
                    };
                  })
                  .filter(c => c.value > 0);
                if (cardsWithValue.length < 2 || totalValue <= 0) return null;
                const allocations = cardsWithValue
                  .map(c => ({ ...c, pct: (c.value / totalValue) * 100 }))
                  .sort((a, b) => b.pct - a.pct);
                return (
                  <Box sx={{ mt: 2 }}>
                    <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.6rem', textTransform: 'uppercase', mb: 0.5 }}>
                      Portfolio Allocation
                    </Typography>
                    <Box sx={{ display: 'flex', width: '100%', height: 28, borderRadius: 1, overflow: 'hidden', border: '1px solid #333' }}>
                      {allocations.map((a, i) => (
                        <Box
                          key={i}
                          sx={{
                            width: `${a.pct}%`,
                            bgcolor: a.color,
                            opacity: 0.75,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            minWidth: a.pct > 3 ? undefined : 0,
                            '&:hover': { opacity: 1 },
                            transition: 'opacity 0.2s',
                          }}
                          title={`${a.name}: ${a.pct.toFixed(1)}% ($${a.value.toFixed(2)})`}
                        >
                          {a.pct >= 10 && (
                            <Typography sx={{
                              color: '#000',
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: '0.6rem',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              px: 0.5,
                            }}>
                              {a.name.length > 12 ? a.name.slice(0, 11) + '\u2026' : a.name} {a.pct.toFixed(0)}%
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 0.75 }}>
                      {allocations.map((a, i) => (
                        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: a.color, opacity: 0.75 }} />
                          <Typography sx={{ color: '#888', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.6rem' }}>
                            {a.name} {a.pct.toFixed(1)}%
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                );
              })()}
            </Box>
          </Collapse>
        </Paper>
      )}

      {loading ? (
        <Typography sx={{ color: '#666', textAlign: 'center', py: 4 }}>Loading watchlist...</Typography>
      ) : rows.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <BookmarkIcon sx={{ color: '#333', fontSize: 48, mb: 1 }} />
          <Typography sx={{ color: '#666', mb: 1 }}>Your watchlist is empty</Typography>
          <Typography sx={{ color: '#555', fontSize: '0.8rem' }}>
            Visit a card's detail page and click the bookmark icon to add it here.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>CARD</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>QTY</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>CURRENT</TableCell>
                <TableCell align="center" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem', width: 80 }}>TREND</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>7D</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}><GlossaryTooltip term="cost_basis">PAID</GlossaryTooltip></TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}><GlossaryTooltip term="pnl">Profit/Loss</GlossaryTooltip></TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}><GlossaryTooltip term="pnl">Profit/Loss %</GlossaryTooltip></TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>ALERT ▲</TableCell>
                <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>ALERT ▼</TableCell>
                <TableCell align="center" sx={{ width: 64 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(row => {
                const lots = getLotsForItem(row);
                const qty = lots.length > 0 ? totalQtyFromLots(lots) : (row.quantity ?? 1);
                const effectiveCostBasis = lots.length > 0 ? avgCostFromLots(lots) : row.costBasis;
                const price = row.card?.current_price || 0;
                const totalRowValue = price * qty;
                const totalRowCost = (effectiveCostBasis || 0) * qty;
                const pnl = effectiveCostBasis != null ? totalRowValue - totalRowCost : null;
                const pnlPct = effectiveCostBasis != null && effectiveCostBasis > 0 ? ((price - effectiveCostBasis) / effectiveCostBasis) * 100 : null;
                return (
                  <TableRow
                    key={row.cardId}
                    hover
                    sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#1a1a2e' } }}
                    onClick={() => navigate(`/card/${row.cardId}`)}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar src={row.card?.image_small} variant="rounded" sx={{ width: 32, height: 44 }} />
                        <Box>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.8rem' }}>{row.card?.name}</Typography>
                          <Typography sx={{ color: '#666', fontSize: '0.6rem' }}>{row.card?.set_name}</Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell align="right" onClick={e => { e.stopPropagation(); openLotDialog(row); }} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(255, 215, 0, 0.05)' } }}>
                      <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.85rem', color: '#ccc' }}>
                        {qty}
                      </Typography>
                      {lots.length > 1 && (
                        <Typography sx={{ color: '#4fc3f7', fontSize: '0.55rem', fontFamily: 'monospace' }}>
                          {lots.length} lots
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Typography sx={{ color: '#00ff41', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem' }}>
                        ${totalRowValue.toFixed(2)}
                      </Typography>
                      {qty > 1 && (
                        <Typography sx={{ color: '#555', fontFamily: 'monospace', fontSize: '0.6rem' }}>
                          ${price.toFixed(2)} ea
                        </Typography>
                      )}
                    </TableCell>
                    {(() => {
                      const priceHist = cardPriceHistories.get(row.cardId) || [];
                      // Last 14 days of data for sparkline
                      const sparkData = priceHist.slice(-14).map(p => ({ price: p.market_price }));
                      // 7d change calculation
                      let change7d: number | null = null;
                      if (priceHist.length >= 2) {
                        const latest = priceHist[priceHist.length - 1].market_price;
                        // Find price ~7 days ago
                        const idx7d = Math.max(0, priceHist.length - 8);
                        const price7d = priceHist[idx7d].market_price;
                        if (price7d > 0) {
                          const raw = ((latest - price7d) / price7d) * 100;
                          // Cap at +/- 500% to filter out data artifacts
                          change7d = Math.abs(raw) <= 500 ? raw : null;
                        }
                      }
                      const trendColor = change7d != null && change7d >= 0 ? '#00ff41' : '#ff1744';
                      return (
                        <>
                          <TableCell align="center" sx={{ width: 80, p: 0.5 }}>
                            {sparkData.length > 1 ? (
                              <ResponsiveContainer width={80} height={30}>
                                <LineChart data={sparkData}>
                                  <Line type="monotone" dataKey="price" stroke={trendColor} strokeWidth={1.5} dot={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            ) : (
                              <Typography sx={{ color: '#555', fontSize: '0.6rem' }}>—</Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{
                              fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem',
                              color: change7d != null ? (change7d >= 0 ? '#00ff41' : '#ff1744') : '#555',
                            }}>
                              {change7d != null ? `${change7d >= 0 ? '+' : ''}${change7d.toFixed(1)}%` : '—'}
                            </Typography>
                          </TableCell>
                        </>
                      );
                    })()}
                    <TableCell align="right" onClick={e => { e.stopPropagation(); openLotDialog(row); }} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(255, 215, 0, 0.05)' } }}>
                      <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.85rem', color: effectiveCostBasis != null ? '#888' : '#555' }}>
                        {effectiveCostBasis != null ? `$${effectiveCostBasis.toFixed(2)}` : 'Set cost'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem',
                        color: pnl != null ? (pnl >= 0 ? '#00ff41' : '#ff1744') : '#555',
                      }}>
                        {pnl != null ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem',
                        color: pnlPct != null ? (pnlPct >= 0 ? '#00ff41' : '#ff1744') : '#555',
                      }}>
                        {pnlPct != null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%` : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <TextField
                        size="small"
                        type="number"
                        value={row.alertAbove ?? ''}
                        onChange={e => updateAlert(row.cardId, 'alertAbove', e.target.value)}
                        placeholder="—"
                        sx={{
                          width: 80,
                          '& input': { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#00ff41', py: 0.5 },
                        }}
                        InputProps={{ startAdornment: <Typography sx={{ color: '#555', fontSize: '0.8rem', mr: 0.3 }}>$</Typography> }}
                      />
                    </TableCell>
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <TextField
                        size="small"
                        type="number"
                        value={row.alertBelow ?? ''}
                        onChange={e => updateAlert(row.cardId, 'alertBelow', e.target.value)}
                        placeholder="—"
                        sx={{
                          width: 80,
                          '& input': { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#ff1744', py: 0.5 },
                        }}
                        InputProps={{ startAdornment: <Typography sx={{ color: '#555', fontSize: '0.8rem', mr: 0.3 }}>$</Typography> }}
                      />
                    </TableCell>
                    <TableCell align="center" onClick={e => e.stopPropagation()}>
                      <Box sx={{ display: 'flex', gap: 0.25 }}>
                        <IconButton size="small" onClick={() => openSoldDialog(row)} sx={{ color: '#ffd700', '&:hover': { color: '#00ff41' } }} title="Mark as Sold">
                          <SellIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                        <IconButton size="small" onClick={() => removeFromWatchlist(row.cardId)} sx={{ color: '#ff1744' }}>
                          <DeleteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Mark as Sold Dialog */}
      <Dialog
        open={soldDialogOpen}
        onClose={() => setSoldDialogOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: '#0d0d1a',
            border: '1px solid #333',
            minWidth: 340,
          },
        }}
      >
        <DialogTitle sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.9rem', color: '#ffd700', pb: 1 }}>
          MARK AS SOLD
        </DialogTitle>
        <DialogContent>
          {soldTarget && (
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ color: '#ccc', fontSize: '0.85rem', fontWeight: 600 }}>
                {soldTarget.card?.name}
              </Typography>
              <Typography sx={{ color: '#666', fontSize: '0.7rem' }}>
                {soldTarget.card?.set_name} &middot; Qty: {(() => { const sl = getLotsForItem(soldTarget); return sl.length > 0 ? totalQtyFromLots(sl) : (soldTarget.quantity ?? 1); })()}
                {(() => { const sl = getLotsForItem(soldTarget); const ac = sl.length > 0 ? avgCostFromLots(sl) : soldTarget.costBasis; return ac != null ? ` \u00b7 Avg Cost: $${ac.toFixed(2)}/ea` : ''; })()}
              </Typography>
            </Box>
          )}
          <TextField
            fullWidth
            label="Sell Price (per card)"
            type="number"
            value={soldSellPrice}
            onChange={e => setSoldSellPrice(e.target.value)}
            autoFocus
            InputProps={{
              startAdornment: <InputAdornment position="start"><Typography sx={{ color: '#555' }}>$</Typography></InputAdornment>,
            }}
            sx={{
              mb: 2,
              '& .MuiInputBase-input': { fontFamily: '"JetBrains Mono", monospace', color: '#ccc' },
              '& .MuiInputLabel-root': { color: '#666' },
              '& .MuiOutlinedInput-root': {
                '& fieldset': { borderColor: '#333' },
                '&:hover fieldset': { borderColor: '#555' },
                '&.Mui-focused fieldset': { borderColor: '#ffd700' },
              },
            }}
          />
          <TextField
            fullWidth
            label="Sell Date"
            type="date"
            value={soldSellDate}
            onChange={e => setSoldSellDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{
              '& .MuiInputBase-input': { fontFamily: '"JetBrains Mono", monospace', color: '#ccc' },
              '& .MuiInputLabel-root': { color: '#666' },
              '& .MuiOutlinedInput-root': {
                '& fieldset': { borderColor: '#333' },
                '&:hover fieldset': { borderColor: '#555' },
                '&.Mui-focused fieldset': { borderColor: '#ffd700' },
              },
            }}
          />
          {soldSellPrice && parseFloat(soldSellPrice) > 0 && soldTarget && (
            <Box sx={{ mt: 2, p: 1.5, bgcolor: '#111', borderRadius: 1, border: '1px solid #1e1e1e' }}>
              {(() => {
                const sp = parseFloat(soldSellPrice);
                const soldPreviewLots = getLotsForItem(soldTarget);
                const qty = soldPreviewLots.length > 0 ? totalQtyFromLots(soldPreviewLots) : (soldTarget.quantity ?? 1);
                const bp = soldPreviewLots.length > 0 ? (avgCostFromLots(soldPreviewLots) ?? 0) : (soldTarget.costBasis ?? 0);
                const fees = sp * qty * 0.1255;
                const profit = (sp - bp) * qty - fees;
                return (
                  <>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.7rem' }}>Revenue</Typography>
                      <Typography sx={{ color: '#ccc', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem' }}>${(sp * qty).toFixed(2)}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.7rem' }}>Cost ({qty}x ${bp.toFixed(2)})</Typography>
                      <Typography sx={{ color: '#ccc', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem' }}>-${(bp * qty).toFixed(2)}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.7rem' }}>Fees (12.55%)</Typography>
                      <Typography sx={{ color: '#ff1744', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem' }}>-${fees.toFixed(2)}</Typography>
                    </Box>
                    <Box sx={{ borderTop: '1px solid #333', mt: 0.5, pt: 0.5, display: 'flex', justifyContent: 'space-between' }}>
                      <Typography sx={{ color: '#888', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 700 }}>Net Profit</Typography>
                      <Typography sx={{
                        fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem', fontWeight: 700,
                        color: profit >= 0 ? '#00ff41' : '#ff1744',
                      }}>
                        {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                      </Typography>
                    </Box>
                  </>
                );
              })()}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setSoldDialogOpen(false)} sx={{ color: '#666', fontFamily: 'monospace', textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            onClick={confirmMarkAsSold}
            disabled={!soldSellPrice || isNaN(parseFloat(soldSellPrice)) || parseFloat(soldSellPrice) <= 0}
            variant="contained"
            sx={{
              bgcolor: '#ffd700', color: '#000', fontFamily: '"JetBrains Mono", monospace', textTransform: 'none', fontWeight: 700,
              '&:hover': { bgcolor: '#ffea00' },
              '&.Mui-disabled': { bgcolor: '#333', color: '#555' },
            }}
          >
            Confirm Sale
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Lots Dialog */}
      <Dialog
        open={lotDialogOpen}
        onClose={() => setLotDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: '#0d0d1a',
            border: '1px solid #333',
          },
        }}
      >
        <DialogTitle sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.9rem', color: '#ffd700', pb: 1 }}>
          EDIT LOTS
        </DialogTitle>
        <DialogContent>
          {lotTarget && (
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ color: '#ccc', fontSize: '0.85rem', fontWeight: 600 }}>
                {lotTarget.card?.name}
              </Typography>
              <Typography sx={{ color: '#666', fontSize: '0.7rem' }}>
                {lotTarget.card?.set_name}
              </Typography>
            </Box>
          )}
          {/* Lots table */}
          <TableContainer sx={{ mb: 1.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem', borderBottom: '1px solid #333', py: 0.5 }}>QTY</TableCell>
                  <TableCell sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem', borderBottom: '1px solid #333', py: 0.5 }}>PRICE/CARD</TableCell>
                  <TableCell sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem', borderBottom: '1px solid #333', py: 0.5 }}>DATE</TableCell>
                  <TableCell sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem', borderBottom: '1px solid #333', py: 0.5, width: 40 }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {editLots.map((lot, idx) => (
                  <TableRow key={idx}>
                    <TableCell sx={{ borderBottom: '1px solid #1e1e1e', py: 0.5 }}>
                      <TextField
                        size="small"
                        type="number"
                        value={lot.quantity}
                        onChange={e => updateLotField(idx, 'quantity', e.target.value)}
                        inputProps={{ min: 1, style: { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#ccc', padding: '4px' } }}
                        sx={{ width: 60, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#333' }, '&:hover fieldset': { borderColor: '#555' }, '&.Mui-focused fieldset': { borderColor: '#ffd700' } } }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid #1e1e1e', py: 0.5 }}>
                      <TextField
                        size="small"
                        type="number"
                        value={lot.price || ''}
                        onChange={e => updateLotField(idx, 'price', e.target.value)}
                        placeholder="0.00"
                        InputProps={{ startAdornment: <Typography sx={{ color: '#555', fontSize: '0.8rem', mr: 0.3 }}>$</Typography> }}
                        inputProps={{ step: 0.01, style: { textAlign: 'right', fontSize: '0.8rem', fontFamily: '"JetBrains Mono", monospace', color: '#ccc', padding: '4px' } }}
                        sx={{ width: 100, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#333' }, '&:hover fieldset': { borderColor: '#555' }, '&.Mui-focused fieldset': { borderColor: '#ffd700' } } }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid #1e1e1e', py: 0.5 }}>
                      <TextField
                        size="small"
                        type="date"
                        value={lot.date}
                        onChange={e => updateLotField(idx, 'date', e.target.value)}
                        inputProps={{ style: { fontSize: '0.75rem', fontFamily: '"JetBrains Mono", monospace', color: '#ccc', padding: '4px' } }}
                        sx={{ width: 140, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#333' }, '&:hover fieldset': { borderColor: '#555' }, '&.Mui-focused fieldset': { borderColor: '#ffd700' } } }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid #1e1e1e', py: 0.5 }}>
                      <IconButton size="small" onClick={() => removeLotRow(idx)} sx={{ color: '#555', '&:hover': { color: '#ff1744' } }} disabled={editLots.length <= 1}>
                        <DeleteIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Button
            size="small"
            startIcon={<AddCircleOutlineIcon />}
            onClick={addLotRow}
            sx={{ color: '#4fc3f7', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem', textTransform: 'none', mb: 1.5 }}
          >
            Add Lot
          </Button>
          {/* Summary */}
          {editLots.length > 0 && (
            <Box sx={{ p: 1.5, bgcolor: '#111', borderRadius: 1, border: '1px solid #1e1e1e' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.7rem' }}>Total Quantity</Typography>
                <Typography sx={{ color: '#ccc', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem' }}>
                  {editLots.reduce((s, l) => s + l.quantity, 0)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.7rem' }}>Total Cost</Typography>
                <Typography sx={{ color: '#ccc', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem' }}>
                  ${editLots.reduce((s, l) => s + l.quantity * l.price, 0).toFixed(2)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.7rem' }}>Avg Cost/Card</Typography>
                <Typography sx={{ color: '#ffd700', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem', fontWeight: 700 }}>
                  ${(avgCostFromLots(editLots) ?? 0).toFixed(2)}
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setLotDialogOpen(false)} sx={{ color: '#666', fontFamily: 'monospace', textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            onClick={saveLots}
            variant="contained"
            sx={{
              bgcolor: '#ffd700', color: '#000', fontFamily: '"JetBrains Mono", monospace', textTransform: 'none', fontWeight: 700,
              '&:hover': { bgcolor: '#ffea00' },
            }}
          >
            Save Lots
          </Button>
        </DialogActions>
      </Dialog>

      {/* Completed Flips Section — always visible */}
      <Box sx={{ mt: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <SellIcon sx={{ color: '#ffd700', fontSize: 20 }} />
          <Typography sx={{ color: '#ffd700', fontSize: '1rem', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, letterSpacing: 1 }}>
            COMPLETED FLIPS
          </Typography>
          <Typography sx={{ color: '#666', ml: 'auto', fontFamily: 'monospace', fontSize: '0.7rem' }}>
            {soldCards.length} trade{soldCards.length !== 1 ? 's' : ''}
          </Typography>
        </Box>
        {soldCards.length === 0 && (
          <Paper sx={{ p: 2, bgcolor: '#0a0a0a', border: '1px solid #1a1a1a', textAlign: 'center' }}>
            <Typography sx={{ color: '#555', fontSize: '0.75rem', fontFamily: 'monospace' }}>
              No completed trades yet. Use the gold sell button on any card above to record a sale and track your realized profit.
            </Typography>
          </Paper>
        )}

        {soldCards.length > 0 && (<>
          {/* Summary Stats */}
          {soldSummary && (
            <Box sx={{ display: 'flex', gap: { xs: 1, sm: 2 }, mb: 2, flexWrap: 'wrap' }}>
              <Paper sx={{ p: 1.5, flex: '1 1 auto', minWidth: { xs: '45%', sm: 120 }, textAlign: 'center' }}>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>Realized Profit</Typography>
                <Typography sx={{
                  fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem',
                  color: soldSummary.totalProfit >= 0 ? '#00ff41' : '#ff1744',
                }}>
                  {soldSummary.totalProfit >= 0 ? '+' : ''}${soldSummary.totalProfit.toFixed(2)}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, flex: '1 1 auto', minWidth: { xs: '45%', sm: 120 }, textAlign: 'center' }}>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>Total Trades</Typography>
                <Typography sx={{ color: '#4fc3f7', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem' }}>
                  {soldSummary.totalTrades}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, flex: '1 1 auto', minWidth: { xs: '45%', sm: 120 }, textAlign: 'center' }}>
                <Typography sx={{ color: '#666', fontSize: '0.6rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>Avg ROI</Typography>
                <Typography sx={{
                  fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', fontSize: '1.2rem',
                  color: soldSummary.avgRoi >= 0 ? '#00ff41' : '#ff1744',
                }}>
                  {soldSummary.avgRoi >= 0 ? '+' : ''}{soldSummary.avgRoi.toFixed(1)}%
                </Typography>
              </Paper>
            </Box>
          )}

          <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>CARD</TableCell>
                  <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>QTY</TableCell>
                  <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>BUY</TableCell>
                  <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>SELL</TableCell>
                  <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>FEES</TableCell>
                  <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>NET PROFIT</TableCell>
                  <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>ROI%</TableCell>
                  <TableCell align="right" sx={{ color: '#666', fontFamily: 'monospace', fontSize: '0.65rem' }}>DATE</TableCell>
                  <TableCell align="center" sx={{ width: 40 }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {soldCards.map((sc, idx) => {
                  const fees = sc.sellPrice * sc.quantity * 0.1255;
                  const cost = sc.buyPrice * sc.quantity;
                  const roi = cost > 0 ? (sc.profit / cost) * 100 : 0;
                  return (
                    <TableRow key={idx} sx={{ '&:hover': { bgcolor: '#1a1a2e' } }}>
                      <TableCell>
                        <Box>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.8rem' }}>{sc.cardName}</Typography>
                          <Typography sx={{ color: '#666', fontSize: '0.6rem' }}>{sc.setName}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', color: '#ccc' }}>{sc.quantity}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', color: '#888' }}>${sc.buyPrice.toFixed(2)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', color: '#ccc' }}>${sc.sellPrice.toFixed(2)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', color: '#ff1744' }}>-${fees.toFixed(2)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography sx={{
                          fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem',
                          color: sc.profit >= 0 ? '#00ff41' : '#ff1744',
                        }}>
                          {sc.profit >= 0 ? '+' : ''}${sc.profit.toFixed(2)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography sx={{
                          fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: '0.85rem',
                          color: roi >= 0 ? '#00ff41' : '#ff1744',
                        }}>
                          {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem', color: '#888' }}>
                          {sc.sellDate}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <IconButton size="small" onClick={() => removeSoldCard(idx)} sx={{ color: '#555', '&:hover': { color: '#ff1744' } }}>
                          <DeleteIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>)}
      </Box>

      <Snackbar
        open={snackMsg !== null}
        autoHideDuration={2500}
        onClose={() => setSnackMsg(null)}
        message={snackMsg}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        ContentProps={{
          sx: {
            bgcolor: '#1a1a2e',
            border: '1px solid #333',
            color: '#00ff41',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '0.8rem',
          },
        }}
      />
    </Box>
  );
}
