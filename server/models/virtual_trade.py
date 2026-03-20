"""Executed trades (filled orders) in the virtual portfolio."""
from sqlalchemy import Column, Integer, Float, DateTime, ForeignKey, String
from sqlalchemy.sql import func
from server.database import Base


class VirtualTrade(Base):
    __tablename__ = "virtual_trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    portfolio_id = Column(Integer, ForeignKey("virtual_portfolios.id"), nullable=False)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False)
    side = Column(String, nullable=False)  # "buy" or "sell"
    quantity = Column(Integer, default=1)
    signal_price = Column(Float, nullable=False)  # market price at signal time
    execution_price = Column(Float, nullable=False)  # price after slippage
    slippage_cost = Column(Float, default=0.0)  # dollar cost of slippage
    slippage_pct = Column(Float, default=0.0)  # percentage slippage
    fee_cost = Column(Float, default=0.0)  # TCGPlayer seller fee (12.55%)
    total_cost = Column(Float, nullable=False)  # execution_price * qty + fees
    realized_pnl = Column(Float)  # only for sells: profit/loss after all costs
    realized_pnl_pct = Column(Float)  # percentage return on the trade
    signal = Column(String)  # what triggered: "sma_crossover", "rsi_oversold", "bb_bounce", etc.
    strategy = Column(String)  # which strategy: "momentum", "mean_reversion", "combined"
    notes = Column(String)  # human-readable explanation
    executed_at = Column(DateTime, server_default=func.now())
