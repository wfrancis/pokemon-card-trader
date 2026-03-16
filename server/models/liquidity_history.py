from sqlalchemy import Column, Integer, Float, Date, ForeignKey, Index
from datetime import date as date_type
from server.database import Base


class LiquidityHistory(Base):
    __tablename__ = "liquidity_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    liquidity_score = Column(Integer, nullable=False)  # 0-100
    sales_30d = Column(Integer, default=0)
    sales_90d = Column(Integer, default=0)
    spread_pct = Column(Float, nullable=True)  # market vs median spread %

    __table_args__ = (
        Index("ix_liquidity_history_card_date", "card_id", "date", unique=True),
    )
