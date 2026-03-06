from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Date, Index
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from server.database import Base


class PriceHistory(Base):
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    variant = Column(String, nullable=False)  # normal, holofoil, reverseHolofoil
    market_price = Column(Float)
    low_price = Column(Float)
    mid_price = Column(Float)
    high_price = Column(Float)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    card = relationship("Card", back_populates="price_history")

    __table_args__ = (
        Index("ix_price_history_card_date", "card_id", "date"),
    )
