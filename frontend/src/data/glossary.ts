export const GLOSSARY: Record<string, string> = {
  liquidity:
    'How easy it is to sell this card quickly. High liquidity means lots of buyers and frequent sales.',
  liquidity_score:
    'A 0-100 score measuring how actively a card is traded. Higher means it sells faster and more often.',
  regime:
    'The current market phase of a card: accumulating (buyers building positions), uptrend (price rising), distributing (sellers offloading), or downtrend (price falling).',
  accumulation:
    'A market phase where smart buyers are quietly building positions before a price increase.',
  distribution:
    'A market phase where holders are selling off their cards, often before a price drop.',
  uptrend:
    'The card price is consistently rising over time.',
  downtrend:
    'The card price is consistently falling over time.',
  breakeven:
    'The percentage a card must appreciate before you break even after marketplace fees (seller fees, shipping, etc.).',
  appreciation_slope:
    'The average daily percentage change in price, calculated using a trend line. Positive means the price is trending up.',
  appreciation_consistency:
    'How closely the price follows a straight trend line (R-squared). 1.0 = perfectly consistent trend, 0.0 = completely random.',
  investment_score:
    'A combined score (0-100) that weighs price appreciation, liquidity, rarity, and trend consistency. Higher is a better investment candidate.',
  time_to_sell:
    'Estimated number of days to sell this card based on recent sales velocity.',
  spread:
    'The gap between the lowest listing price and the market price. A smaller spread means tighter, more efficient pricing.',
  rarity_score:
    'A 0-100 score based on the card rarity tier. Rarer cards (e.g., Illustration Rare, Special Art) score higher.',
  win_rate:
    'The percentage of days where the card price went up. Above 50% means more up days than down days.',
  volatility:
    'How much the price swings day-to-day. High volatility means bigger price moves, both up and down.',
  activity_score:
    'A measure of how frequently a card is bought and sold. Higher means more market activity.',
  nm: 'Near Mint — card looks brand new with minimal to no wear',
  lp: 'Lightly Played — minor edge wear or small scratches, still presentable',
  mp: 'Moderately Played — noticeable wear, creases, or whitening on edges',
  hp: 'Heavily Played — significant wear, major creases, heavy whitening',
  dmg: 'Damaged — structural damage like tears, water damage, or heavy bending',
  pnl: 'Profit & Loss — the difference between current value and what you paid',
  cost_basis: 'What you paid for the card, used to calculate your profit or loss',
  sma: 'Simple Moving Average — smoothed price trend over a rolling time window',
  sma_30d: '30-day moving average — short-term trend, shows recent momentum',
  sma_180d: '6-month moving average — long-term trend, shows overall direction',
  flip_profit: 'Expected profit buying at market and selling at median, minus 12.55% seller fees',
  market_price: 'Current listed price from TCGPlayer marketplace',
  median_sold: 'Middle value of recent completed sales — half sold above, half below',
  condition_pricing: 'Median prices broken down by card condition (NM, LP, MP, HP, DMG)',
  appreciation:
    'The rate at which a card\'s price has been increasing over time',
  accumulating:
    'Market phase where buyers are steadily acquiring cards, often before a price increase',
  distributing:
    'Market phase where holders are selling cards, often before a price decrease',
  investment_grade:
    'Cards rated as top investment picks based on our scoring system — high liquidity, strong appreciation, and favorable market regime',
};
