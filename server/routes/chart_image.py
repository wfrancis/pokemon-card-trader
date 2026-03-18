"""Generate embeddable chart images for cards."""
import io
from datetime import datetime

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import asc

from server.database import get_db
from server.models.card import Card
from server.models.price_history import PriceHistory
from server.services.market_analysis import _filter_dominant_variant

router = APIRouter(prefix="/api/cards", tags=["chart-image"])


@router.get("/{card_id}/chart-image")
def get_chart_image(
    card_id: int,
    days: int = Query(90, ge=7, le=365, description="Number of days to show"),
    width: int = Query(800, ge=400, le=1600),
    height: int = Query(400, ge=200, le=800),
    db: Session = Depends(get_db),
):
    """Return a PNG chart image of a card's price history, suitable for embedding."""
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    # Fetch price history
    query = (
        db.query(PriceHistory)
        .filter(PriceHistory.card_id == card_id, PriceHistory.market_price.isnot(None))
    )
    if card.price_variant:
        records = query.filter(PriceHistory.variant == card.price_variant).order_by(asc(PriceHistory.date)).all()
        if not records:
            records = query.order_by(asc(PriceHistory.date)).all()
            records = _filter_dominant_variant(records)
    else:
        records = query.order_by(asc(PriceHistory.date)).all()
        records = _filter_dominant_variant(records)

    # Deduplicate by date
    by_date: dict[str, float] = {}
    for r in records:
        d = r.date.isoformat()
        by_date[d] = r.market_price

    if len(by_date) < 2:
        raise HTTPException(status_code=404, detail="Not enough price data for chart")

    # Sort and limit to requested days
    sorted_dates = sorted(by_date.keys())
    if len(sorted_dates) > days:
        sorted_dates = sorted_dates[-days:]

    dates = [datetime.strptime(d, "%Y-%m-%d") for d in sorted_dates]
    prices = [by_date[d] for d in sorted_dates]

    # Calculate price change
    price_change = prices[-1] - prices[0]
    price_change_pct = (price_change / prices[0] * 100) if prices[0] > 0 else 0
    line_color = '#00ff41' if price_change >= 0 else '#ff1744'

    # Create the chart with dark theme
    fig, ax = plt.subplots(figsize=(width / 100, height / 100), dpi=100)
    fig.patch.set_facecolor('#0a0a0a')
    ax.set_facecolor('#0a0a0a')

    # Plot price line
    ax.plot(dates, prices, color=line_color, linewidth=2, solid_capstyle='round')

    # Fill under the line with gradient-like effect
    ax.fill_between(dates, prices, min(prices) * 0.98, color=line_color, alpha=0.08)

    # Style axes
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_color('#333')
    ax.spines['left'].set_color('#333')
    ax.tick_params(colors='#666', labelsize=8)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'${x:.2f}'))
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    ax.grid(axis='y', color='#1a1a2e', linewidth=0.5)

    # Title: card name + current price + change
    sign = '+' if price_change_pct >= 0 else ''
    title = f"{card.name}  |  ${prices[-1]:.2f}  ({sign}{price_change_pct:.1f}%)"
    ax.set_title(title, color='#e0e0e0', fontsize=11, fontweight='bold',
                 fontfamily='monospace', loc='left', pad=10)

    # Subtitle: set name + variant
    variant_str = f" ({card.price_variant})" if card.price_variant else ""
    subtitle = f"{card.set_name}{variant_str}"
    ax.text(0.0, 1.02, subtitle, transform=ax.transAxes, color='#666',
            fontsize=8, fontfamily='monospace')

    # Watermark
    fig.text(0.98, 0.02, 'PKMN TRADER', ha='right', va='bottom',
             color='#333', fontsize=7, fontfamily='monospace', alpha=0.8)
    fig.text(0.02, 0.02, 'pokemon-card-trader.fly.dev', ha='left', va='bottom',
             color='#333', fontsize=7, fontfamily='monospace', alpha=0.8)

    plt.tight_layout()

    # Render to PNG
    buf = io.BytesIO()
    fig.savefig(buf, format='png', facecolor=fig.get_facecolor(), edgecolor='none',
                bbox_inches='tight', pad_inches=0.3)
    plt.close(fig)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": f'inline; filename="{card.name.replace(" ", "_")}_chart.png"',
        },
    )
