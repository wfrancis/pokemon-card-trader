"""Open positions in the virtual portfolio."""
from sqlalchemy import Column, Integer, Float, DateTime, ForeignKey, String
from sqlalchemy.sql import func
from server.database import Base


class VirtualPosition(Base):
    __tablename__ = "virtual_positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    portfolio_id = Column(Integer, ForeignKey("virtual_portfolios.id"), nullable=False)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False)
    quantity = Column(Integer, default=1)
    avg_entry_price = Column(Float, nullable=False)
    current_price = Column(Float)
    unrealized_pnl = Column(Float, default=0.0)
    unrealized_pnl_pct = Column(Float, default=0.0)
    entry_date = Column(DateTime, server_default=func.now())
    entry_reason = Column(String)  # e.g. "SMA crossover + regime ACCUMULATE"
    stop_loss = Column(Float)  # auto-sell if price drops below
    take_profit = Column(Float)  # auto-sell if price rises above
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
