"""Daily portfolio value snapshots for equity curve charting."""
from sqlalchemy import Column, Integer, Float, DateTime, Date, ForeignKey
from sqlalchemy.sql import func
from server.database import Base


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    portfolio_id = Column(Integer, ForeignKey("virtual_portfolios.id"), nullable=False)
    date = Column(Date, nullable=False)
    cash = Column(Float, nullable=False)
    positions_value = Column(Float, nullable=False)
    total_value = Column(Float, nullable=False)
    daily_pnl = Column(Float, default=0.0)
    daily_pnl_pct = Column(Float, default=0.0)
    cumulative_pnl = Column(Float, default=0.0)
    cumulative_pnl_pct = Column(Float, default=0.0)
    num_positions = Column(Integer, default=0)
    high_water_mark = Column(Float)
    drawdown_pct = Column(Float, default=0.0)
