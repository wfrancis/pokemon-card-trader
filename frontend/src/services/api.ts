import { API_URL } from '../config';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface Card {
  id: number;
  tcg_id: string;
  name: string;
  set_name: string;
  set_id: string;
  number: string;
  rarity: string;
  supertype: string;
  subtypes: string[];
  hp: string;
  types: string[];
  image_small: string;
  image_large: string;
  current_price: number | null;
  price_variant: string | null;
}

export interface PricePoint {
  date: string;
  market_price: number;
  low_price: number;
  mid_price: number;
  high_price: number;
}

export interface Analysis {
  sma_7: number | null;
  sma_30: number | null;
  sma_90: number | null;
  ema_12: number | null;
  ema_26: number | null;
  rsi_14: number | null;
  macd_line: number | null;
  macd_signal: number | null;
  macd_histogram: number | null;
  bollinger_upper: number | null;
  bollinger_middle: number | null;
  bollinger_lower: number | null;
  momentum: number | null;
  price_change_pct_7d: number | null;
  price_change_pct_30d: number | null;
  support: number | null;
  resistance: number | null;
  signal: string;
  signal_strength: number;
}

export interface Mover {
  card_id: number;
  tcg_id: string;
  name: string;
  set_name: string;
  image_small: string;
  current_price: number;
  previous_price: number;
  change_pct: number;
  variant: string;
}

export const api = {
  getCards: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetchApi<{ data: Card[]; total: number; page: number; total_pages: number }>(
      `/api/cards${qs}`
    );
  },

  getCard: (id: number) => fetchApi<Card>(`/api/cards/${id}`),

  getCardPrices: (id: number) =>
    fetchApi<{ card_id: number; card_name: string; data: PricePoint[] }>(
      `/api/cards/${id}/prices`
    ),

  getCardAnalysis: (id: number) =>
    fetchApi<{ card_id: number; card_name: string; current_price: number; analysis: Analysis }>(
      `/api/cards/${id}/analysis`
    ),

  getMovers: (limit = 10) =>
    fetchApi<{ gainers: Mover[]; losers: Mover[] }>(`/api/market/movers?limit=${limit}`),

  getMarketIndex: () =>
    fetchApi<{ avg_price: number; total_cards: number; total_market_cap: number }>(
      '/api/market/index'
    ),

  getTicker: (limit = 20) =>
    fetchApi<{ id: number; name: string; set_name: string; price: number; variant: string }[]>(
      `/api/market/ticker?limit=${limit}`
    ),

  syncCards: (pages = 3) =>
    fetchApi<Record<string, number>>(`/api/sync/cards?pages=${pages}`, { method: 'POST' }),

  syncPrices: (limit = 250) =>
    fetchApi<Record<string, number>>(`/api/sync/prices?limit=${limit}`, { method: 'POST' }),
};
