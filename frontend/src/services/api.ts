import { API_URL } from '../config';

async function fetchApi<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...fetchOptions } = options || {};
  const controller = new AbortController();
  const timeout = timeoutMs ?? 120_000; // default 2 min
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...fetchOptions,
    });
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (e: any) {
    if (e.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeout / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
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

  getHotCards: (limit = 12) =>
    fetchApi<HotCard[]>(`/api/market/hot?limit=${limit}`),

  syncCards: (pages = 3) =>
    fetchApi<Record<string, number>>(`/api/sync/cards?pages=${pages}`, { method: 'POST' }),

  syncPrices: (limit = 250) =>
    fetchApi<Record<string, number>>(`/api/sync/prices?limit=${limit}`, { method: 'POST' }),

  // Backtesting
  getStrategies: () =>
    fetchApi<{ strategies: { key: string; name: string }[] }>('/api/backtest/strategies'),

  backtestCard: (cardId: number, strategy = 'combined', capital = 1000) =>
    fetchApi<BacktestResult>(
      `/api/backtest/card/${cardId}?strategy=${strategy}&capital=${capital}`
    ),

  backtestCardAll: (cardId: number, capital = 1000) =>
    fetchApi<{ results: BacktestResult[] }>(
      `/api/backtest/card/${cardId}/all?capital=${capital}`
    ),

  backtestPortfolio: (strategy = 'combined', topN = 10, capital = 10000) =>
    fetchApi<PortfolioBacktestResult>(
      `/api/backtest/portfolio?strategy=${strategy}&top_n=${topN}&capital=${capital}`
    ),

  // AI Trader
  getTraderAnalysis: () =>
    fetchApi<TraderAnalysis>('/api/trader/analysis', { timeoutMs: 300_000 }),

  getMultiPersonaAnalysis: () =>
    fetchApi<MultiPersonaAnalysis>('/api/trader/personas', { timeoutMs: 600_000 }),

  getLatestPersonaAnalysis: () =>
    fetchApi<MultiPersonaAnalysis>('/api/trader/personas/latest'),

  getPersonaHistory: () =>
    fetchApi<SnapshotSummary[]>('/api/trader/personas/history'),

  getPersonaSnapshot: (id: number) =>
    fetchApi<MultiPersonaAnalysis>(`/api/trader/personas/snapshot/${id}`),

  getTraderCardAnalysis: (cardId: number) =>
    fetchApi<TraderCardAnalysis>(`/api/trader/card/${cardId}`),

  backtestPicks: () =>
    fetchApi<Record<number, BacktestPickResult>>('/api/trader/backtest-picks'),

  // Sales
  getCardSales: (cardId: number, limit = 500) =>
    fetchApi<CardSalesResponse>(`/api/cards/${cardId}/sales?limit=${limit}`),

  // Agent
  getAgentInsights: (params?: { type?: string; acknowledged?: boolean; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.acknowledged !== undefined) qs.set('acknowledged', String(params.acknowledged));
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return fetchApi<AgentInsight[]>(`/api/agent/insights${q ? '?' + q : ''}`);
  },

  acknowledgeInsight: (id: number) =>
    fetchApi<{ status: string }>(`/api/agent/insights/${id}/acknowledge`, { method: 'POST' }),

  getAgentStatus: () =>
    fetchApi<AgentStatus>('/api/agent/status'),

  getAgentAccuracy: () =>
    fetchApi<AccuracyReport>('/api/trader/accuracy'),

  getAgentPredictions: (outcome?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (outcome) params.set('outcome', outcome);
    params.set('limit', String(limit));
    return fetchApi<AgentPrediction[]>(`/api/trader/predictions?${params}`);
  },

  runAgentAnalysis: (model = 'gpt-5') =>
    fetchApi<AgentAnalysisResult>(`/api/trader/agent?model=${model}`, { timeoutMs: 300_000 }),
};

export interface BacktestTrade {
  date: string;
  action: string;
  price: number;
  signal_reason: string;
}

export interface BacktestDailyValue {
  date: string;
  price: number;
  portfolio_value: number;
  cash: number;
  holdings_value: number;
  in_position: boolean;
}

export interface BacktestResult {
  strategy: string;
  card_id: number;
  card_name: string;
  start_date: string;
  end_date: string;
  initial_price: number;
  final_price: number;
  buy_hold_return_pct: number;
  strategy_return_pct: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  max_drawdown_pct: number;
  sharpe_ratio: number | null;
  trades: BacktestTrade[];
  daily_values: BacktestDailyValue[];
  error?: string;
}

export interface BacktestPickResult {
  strategy?: string;
  buy_hold_return_pct?: number;
  fee_adjusted_return_pct?: number | null;
  total_fees?: number;
  max_drawdown_pct?: number;
  profitable_after_fees?: boolean;
  initial_price?: number;
  final_price?: number;
  start_date?: string | null;
  end_date?: string | null;
  hold_days?: number;
  error?: string;
}

export interface PortfolioCardResult {
  card_id: number;
  card_name: string;
  strategy_return_pct: number;
  buy_hold_return_pct: number;
  win_rate: number;
  total_trades: number;
  max_drawdown_pct: number;
  sharpe_ratio: number | null;
}

export interface TraderAnalysis {
  trader_name: string;
  analysis?: string;
  market_data_summary?: {
    total_cards: number;
    avg_price: number;
    market_cap: number;
    top_gainer: string | null;
    top_loser: string | null;
  };
  tokens_used?: { input: number; output: number };
  error?: string;
}

export interface TraderCardAnalysis {
  trader_name: string;
  card_name?: string;
  card_id?: number;
  analysis?: string;
  tokens_used?: { input: number; output: number };
  error?: string;
}

export interface PortfolioBacktestResult {
  strategy: string;
  cards_count: number;
  initial_capital: number;
  final_value: number;
  portfolio_return_pct: number;
  buy_hold_return_pct: number;
  alpha: number;
  total_trades: number;
  card_results: PortfolioCardResult[];
  error?: string;
}

export interface HotCard {
  card_id: number;
  tcg_id: string;
  name: string;
  set_name: string;
  rarity: string;
  image_small: string;
  current_price: number;
  activity_score: number;
  volatility: number | null;
  spread_ratio: number | null;
  momentum: number | null;
  price_change_7d: number | null;
  signal: string;
  signal_strength: number;
}

export interface CardIndicator {
  card_id: number;
  name: string;
  set_name: string;
  rarity: string;
  image_small: string;
  current_price: number;
  rsi_14: number | null;
  sma_7: number | null;
  sma_30: number | null;
  macd_histogram: number | null;
  momentum: number | null;
  price_change_7d: number | null;
  price_change_30d: number | null;
  support: number | null;
  resistance: number | null;
  bollinger_position: number | null;
  volatility: number | null;
  spread_ratio: number | null;
  activity_score: number | null;
  price_history_days: number;
  can_backtest: boolean;
  // AI signal fields (present after generate)
  signal?: string;
  conviction?: number;
  reasoning?: string;
  risk_note?: string;
  bull_case?: string;
  bear_case?: string;
  ta_pattern?: string;
  ta_summary?: string;
  catalyst?: string;
  catalyst_summary?: string;
  demand_type?: string;
  reprint_risk?: string;
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  time_horizon?: string;
  best_strategy?: string;
}

export interface SaleRecord {
  id: number;
  order_date: string;
  purchase_price: number;
  shipping_price: number;
  condition: string;
  variant: string;
  source: string;
  source_product_id: string;
  listing_title: string;
  quantity: number;
}

export interface CardSalesResponse {
  card_id: number;
  card_name: string;
  total_sales: number;
  median_price: number | null;
  current_price: number | null;
  sales: SaleRecord[];
}

export interface PersonaResult {
  id: string;
  name: string;
  title: string;
  subtitle: string;
  color: string;
  badges: string[];
  analysis: string | null;
  error: string | null;
}

export interface TradingEconomics {
  cards_above_minimum_trade_size: number;
  cards_below_minimum_trade_size: number;
  minimum_viable_trade_price: number;
  fee_schedule?: {
    platform: string;
    commission: string;
    payment_processing: string;
    shipping_cost: string;
    examples: Record<string, { sell_fee_pct: number; net_proceeds: number; breakeven_appreciation_pct: number }>;
  };
}

export interface AnalyzedCard {
  card_id: number;
  name: string;
  set_name: string;
  rarity: string;
  image_small: string | null;
  current_price: number;
  price_tier: 'premium' | 'mid_high' | 'mid';
  signal: string;
  signal_strength: number;
  breakeven_pct: number | null;
  liquidity_score: number | null;
  viable_trade: boolean;
  price_change_7d: number | null;
  price_change_30d: number | null;
}

export interface MultiPersonaAnalysis {
  personas?: Record<string, PersonaResult>;
  consensus?: string;
  consensus_picks?: AnalyzedCard[];
  market_data_summary?: {
    total_cards: number;
    avg_price: number;
    market_cap: number;
    top_gainer: string | null;
    top_loser: string | null;
  };
  trading_economics?: TradingEconomics;
  tokens_used?: { input: number; output: number };
  error?: string;
  created_at?: string;
}

export interface SnapshotSummary {
  id: number;
  created_at: string;
  tokens_input: number;
  tokens_output: number;
  pick_count: number;
}

// ── Agent Types ─────────────────────────────────────────────────────────────

export interface AgentInsight {
  id: number;
  type: 'opportunity' | 'warning' | 'anomaly' | 'milestone';
  severity: 'info' | 'notable' | 'urgent';
  card_id: number | null;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  acknowledged: boolean;
}

export interface AgentPrediction {
  id: number;
  card_id: number;
  card_name: string;
  card_image: string | null;
  signal: string;
  persona_source: string;
  entry_price: number;
  current_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  return_pct_7d: number | null;
  return_pct_30d: number | null;
  return_pct_90d: number | null;
  outcome: 'pending' | 'correct' | 'incorrect' | 'expired';
  predicted_at: string;
}

export interface AccuracyReport {
  total_predictions: number;
  resolved: number;
  pending: number;
  overall_hit_rate: number | null;
  by_persona: Record<string, { total: number; correct: number; hit_rate: number }>;
  by_signal: Record<string, { total: number; correct: number; hit_rate: number }>;
  best_pick: AgentPrediction | null;
  worst_pick: AgentPrediction | null;
  recent_picks: AgentPrediction[];
}

export interface AgentStatus {
  last_analysis_at: string | null;
  active_predictions: number;
  total_predictions: number;
  unread_insights: number;
  overall_hit_rate: number | null;
  resolved_predictions: number;
}

export interface AgentAnalysisResult {
  analysis?: string;
  consensus_picks?: AnalyzedCard[];
  model?: string;
  tool_calls?: number;
  tokens_used?: { input: number; output: number };
  predictions_created?: number;
  snapshot_id?: number;
  error?: string;
}
