"""
Trading Economics — Fee models, liquidity scoring, and hold period analysis
for realistic Pokemon card trading strategy evaluation.

Platform fee structures (as of 2026):
  TCGPlayer: 10.75% commission + 2.5% + $0.30 payment processing
  eBay: 13% FVF + 2.9% + $0.30 payment processing

Shipping: $4.50 tracked (bubble mailer + tracking), $1.25 PWE (risky)
"""
from dataclasses import dataclass
import math


# ── Fee Schedules ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class FeeSchedule:
    """Platform fee structure."""
    name: str
    commission_rate: float       # e.g. 0.1075 for TCGPlayer
    payment_processing_rate: float  # e.g. 0.025
    payment_flat_fee: float      # e.g. 0.30
    shipping_cost: float         # per-card tracked shipping
    buyer_shipping: float        # what buyer typically pays (0 for Direct)


TCGPLAYER_FEES = FeeSchedule(
    name="TCGPlayer",
    commission_rate=0.1075,
    payment_processing_rate=0.025,
    payment_flat_fee=0.30,
    shipping_cost=4.50,   # seller ships tracked
    buyer_shipping=0.0,   # Direct: free shipping on $5+
)

EBAY_FEES = FeeSchedule(
    name="eBay",
    commission_rate=0.13,
    payment_processing_rate=0.029,
    payment_flat_fee=0.30,
    shipping_cost=4.50,
    buyer_shipping=0.0,   # most listings offer free shipping (built into price)
)

PLATFORMS = {
    "tcgplayer": TCGPLAYER_FEES,
    "ebay": EBAY_FEES,
}


# ── Fee Calculations ─────────────────────────────────────────────────────────

def calc_sell_proceeds(sale_price: float, platform: str = "tcgplayer") -> dict:
    """Calculate net proceeds from selling a card.

    Returns dict with: gross, commission, processing, shipping, net_proceeds, total_fee_pct
    """
    fees = PLATFORMS.get(platform, TCGPLAYER_FEES)

    commission = sale_price * fees.commission_rate
    processing = sale_price * fees.payment_processing_rate + fees.payment_flat_fee
    shipping = fees.shipping_cost

    net = sale_price - commission - processing - shipping
    total_fees = commission + processing + shipping
    fee_pct = (total_fees / sale_price * 100) if sale_price > 0 else 100.0

    return {
        "gross": round(sale_price, 2),
        "commission": round(commission, 2),
        "processing": round(processing, 2),
        "shipping": round(shipping, 2),
        "net_proceeds": round(net, 2),
        "total_fees": round(total_fees, 2),
        "total_fee_pct": round(fee_pct, 1),
    }


def calc_buy_cost(list_price: float, platform: str = "tcgplayer") -> float:
    """Calculate total acquisition cost for buying a card.

    TCGPlayer Direct: free shipping on orders $5+, so most buys = list price.
    Non-Direct: add buyer shipping.
    """
    fees = PLATFORMS.get(platform, TCGPLAYER_FEES)
    return round(list_price + fees.buyer_shipping, 2)


def calc_roundtrip_pnl(
    buy_price: float,
    sell_price: float,
    platform: str = "tcgplayer",
) -> dict:
    """Calculate net P&L for a complete buy→sell roundtrip.

    Returns: net_pnl, gross_pnl, total_fees, fee_pct, return_pct, breakeven_sell_price
    """
    acquisition_cost = calc_buy_cost(buy_price, platform)
    sell_result = calc_sell_proceeds(sell_price, platform)

    gross_pnl = sell_price - buy_price
    net_pnl = sell_result["net_proceeds"] - acquisition_cost
    return_pct = (net_pnl / acquisition_cost * 100) if acquisition_cost > 0 else 0.0

    return {
        "buy_price": round(buy_price, 2),
        "acquisition_cost": round(acquisition_cost, 2),
        "sell_price": round(sell_price, 2),
        "net_proceeds": sell_result["net_proceeds"],
        "gross_pnl": round(gross_pnl, 2),
        "net_pnl": round(net_pnl, 2),
        "total_fees": sell_result["total_fees"],
        "fee_pct_of_sale": sell_result["total_fee_pct"],
        "net_return_pct": round(return_pct, 1),
    }


def calc_breakeven_appreciation(buy_price: float, platform: str = "tcgplayer") -> float:
    """Calculate the minimum % appreciation needed to break even after all fees.

    Solves for sell_price where net_proceeds == acquisition_cost.

    For TCGPlayer: net = sell * (1 - 0.1075 - 0.025) - 0.30 - 4.50
                   need net >= buy + buyer_shipping
                   sell >= (buy + buyer_shipping + 0.30 + 4.50) / (1 - 0.1325)
    """
    fees = PLATFORMS.get(platform, TCGPLAYER_FEES)
    acquisition_cost = buy_price + fees.buyer_shipping

    combined_rate = 1 - fees.commission_rate - fees.payment_processing_rate
    if combined_rate <= 0:
        return 999.0  # impossible to profit

    breakeven_sell = (acquisition_cost + fees.payment_flat_fee + fees.shipping_cost) / combined_rate

    if buy_price <= 0:
        return 999.0

    appreciation_pct = ((breakeven_sell - buy_price) / buy_price) * 100
    return round(appreciation_pct, 1)


def get_fee_schedule_summary(platform: str = "tcgplayer") -> dict:
    """Return human-readable fee schedule for AI prompts."""
    fees = PLATFORMS.get(platform, TCGPLAYER_FEES)

    # Example calculations at different price points
    examples = {}
    for price in [10, 20, 50, 100, 250, 500]:
        sell = calc_sell_proceeds(price, platform)
        breakeven = calc_breakeven_appreciation(price, platform)
        examples[f"${price}_card"] = {
            "sell_fee_pct": sell["total_fee_pct"],
            "net_proceeds": sell["net_proceeds"],
            "breakeven_appreciation_pct": breakeven,
        }

    return {
        "platform": fees.name,
        "commission": f"{fees.commission_rate * 100}%",
        "payment_processing": f"{fees.payment_processing_rate * 100}% + ${fees.payment_flat_fee}",
        "shipping_cost": f"${fees.shipping_cost}",
        "examples": examples,
        "minimum_viable_trade": "$20 (below this, fees eat all potential profit)",
    }


# ── Liquidity Scoring ────────────────────────────────────────────────────────

def estimate_time_to_sell(
    card_price: float,
    sales_90d: int = 0,
    sales_30d: int = 0,
) -> dict:
    """Estimate days to sell a card based on price tier and sales velocity.

    Returns: estimated_days, confidence, tier
    """
    # Price tier base estimates (from TCGPlayer marketplace data)
    if card_price < 5:
        base_days, tier = 1, "bulk"
    elif card_price < 20:
        base_days, tier = 3, "low"
    elif card_price < 100:
        base_days, tier = 7, "mid"
    elif card_price < 500:
        base_days, tier = 21, "high"
    else:
        base_days, tier = 45, "premium"

    # Adjust based on actual sales velocity
    confidence = "low"
    if sales_90d > 0:
        daily_velocity = sales_90d / 90
        if daily_velocity > 0:
            velocity_estimate = 1.0 / daily_velocity
            # Blend base estimate with velocity estimate
            estimated_days = (base_days * 0.3 + velocity_estimate * 0.7)
            confidence = "medium" if sales_90d >= 3 else "low"
            if sales_90d >= 10:
                confidence = "high"
        else:
            estimated_days = base_days * 2  # no velocity = slower
    else:
        estimated_days = base_days * 3  # no sales data = very uncertain
        confidence = "none"

    # Recent acceleration/deceleration
    if sales_30d > 0 and sales_90d > 0:
        recent_rate = sales_30d / 30
        overall_rate = sales_90d / 90
        if recent_rate > overall_rate * 1.5:
            estimated_days *= 0.6  # accelerating
        elif recent_rate < overall_rate * 0.5:
            estimated_days *= 1.5  # decelerating

    return {
        "estimated_days": round(max(1, estimated_days)),
        "confidence": confidence,
        "price_tier": tier,
        "sales_90d": sales_90d,
        "sales_30d": sales_30d,
    }


def calc_liquidity_score(
    sales_90d: int = 0,
    sales_30d: int = 0,
    card_price: float = 0,
    market_vs_median_spread_pct: float | None = None,
) -> int:
    """Calculate 0-100 liquidity score.

    Components:
    - Volume (40%): sales_90d — more sales = more liquid
    - Velocity (30%): sales_30d trend vs 90d — accelerating = good
    - Spread (20%): market vs median sale price — tight = liquid
    - Price tier (10%): $20-100 is the sweet spot for liquidity
    """
    score = 0.0

    # Volume component (0-40)
    if sales_90d >= 50:
        score += 40
    elif sales_90d >= 20:
        score += 30
    elif sales_90d >= 10:
        score += 25
    elif sales_90d >= 5:
        score += 15
    elif sales_90d >= 1:
        score += 5
    # 0 sales = 0 points

    # Velocity component (0-30)
    if sales_90d > 0 and sales_30d > 0:
        expected_30d = sales_90d / 3  # expected if flat
        if expected_30d > 0:
            velocity_ratio = sales_30d / expected_30d
            if velocity_ratio >= 1.5:
                score += 30  # accelerating
            elif velocity_ratio >= 1.0:
                score += 20  # stable
            elif velocity_ratio >= 0.5:
                score += 10  # decelerating
            # < 0.5 = drying up, 0 points
    elif sales_30d > 0:
        score += 15  # some recent activity

    # Spread component (0-20)
    if market_vs_median_spread_pct is not None:
        abs_spread = abs(market_vs_median_spread_pct)
        if abs_spread < 5:
            score += 20  # very tight
        elif abs_spread < 10:
            score += 15
        elif abs_spread < 20:
            score += 10
        elif abs_spread < 30:
            score += 5
        # > 30% spread = stale pricing, 0 points

    # Price tier component (0-10)
    if 20 <= card_price <= 100:
        score += 10  # sweet spot
    elif 10 <= card_price < 20 or 100 < card_price <= 250:
        score += 7
    elif 5 <= card_price < 10 or 250 < card_price <= 500:
        score += 4
    elif card_price > 500:
        score += 2  # premium = illiquid
    # < $5 = bulk, 0 points

    return min(100, max(0, round(score)))


# ── Hold Period Analysis ─────────────────────────────────────────────────────

def classify_hold_period(days_held: int) -> str:
    """Classify hold period: short (<30d), medium (30-180d), long (>180d)."""
    if days_held < 30:
        return "short"
    elif days_held <= 180:
        return "medium"
    else:
        return "long"


def analyze_hold_economics(
    buy_price: float,
    current_price: float,
    days_held: int,
    platform: str = "tcgplayer",
) -> dict:
    """Analyze the economics of holding a card for a given period.

    Returns: hold period classification, annualized return (gross and net),
    whether the trade is profitable after fees.
    """
    rt = calc_roundtrip_pnl(buy_price, current_price, platform)
    hold_period = classify_hold_period(days_held)

    # Annualized returns
    if days_held > 0 and buy_price > 0:
        gross_return = (current_price - buy_price) / buy_price
        net_return = rt["net_pnl"] / buy_price

        # Annualize: (1 + r)^(365/days) - 1
        if gross_return > -1:
            annualized_gross = ((1 + gross_return) ** (365 / days_held) - 1) * 100
        else:
            annualized_gross = -100.0

        if net_return > -1:
            annualized_net = ((1 + net_return) ** (365 / days_held) - 1) * 100
        else:
            annualized_net = -100.0
    else:
        annualized_gross = 0.0
        annualized_net = 0.0

    breakeven = calc_breakeven_appreciation(buy_price, platform)
    appreciation = ((current_price - buy_price) / buy_price * 100) if buy_price > 0 else 0

    return {
        "hold_period": hold_period,
        "days_held": days_held,
        "gross_appreciation_pct": round(appreciation, 1),
        "net_return_pct": rt["net_return_pct"],
        "annualized_gross_pct": round(annualized_gross, 1),
        "annualized_net_pct": round(annualized_net, 1),
        "breakeven_appreciation_pct": breakeven,
        "clears_hurdle": appreciation > breakeven,
        "total_fees": rt["total_fees"],
    }


# ── Backtest Fee Application ────────────────────────────────────────────────

def apply_buy_fees(cash: float, price: float, platform: str = "tcgplayer") -> tuple[float, float]:
    """Apply buy-side costs. Returns (holdings_acquired, cash_remaining).

    Buyer pays list price + any buyer shipping.
    """
    fees = PLATFORMS.get(platform, TCGPLAYER_FEES)
    total_cost_per_unit = price + fees.buyer_shipping
    if total_cost_per_unit <= 0:
        return 0.0, cash

    holdings = cash / total_cost_per_unit
    return holdings, 0.0


def apply_sell_fees(holdings: float, price: float, platform: str = "tcgplayer") -> float:
    """Apply sell-side costs. Returns net cash received.

    Seller pays: commission + processing + shipping.
    """
    fees = PLATFORMS.get(platform, TCGPLAYER_FEES)
    gross = holdings * price
    commission = gross * fees.commission_rate
    processing = gross * fees.payment_processing_rate + fees.payment_flat_fee
    shipping = fees.shipping_cost  # per transaction, not per unit

    net = gross - commission - processing - shipping
    return max(0.0, net)


def is_viable_trade(price: float) -> bool:
    """Check if a card is above the minimum viable trading threshold."""
    return price >= 20.0
