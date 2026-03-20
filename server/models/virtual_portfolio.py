"""Virtual prop trading portfolio."""
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean
from sqlalchemy.sql import func
from server.database import Base


class VirtualPortfolio(Base):
    __tablename__ = "virtual_portfolios"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, default="Prop Desk Alpha")
    strategy = Column(String, default="momentum")  # momentum, mean_reversion, combined
    starting_capital = Column(Float, default=10000.0)
    cash_balance = Column(Float, default=10000.0)
    total_value = Column(Float, default=10000.0)  # cash + positions
    high_water_mark = Column(Float, default=10000.0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
