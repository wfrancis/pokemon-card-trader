from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from server.database import Base


class Card(Base):
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tcg_id = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    set_name = Column(String, nullable=False)
    set_id = Column(String, nullable=False)
    number = Column(String)
    rarity = Column(String)
    supertype = Column(String)
    subtypes = Column(String)  # JSON-encoded list
    hp = Column(String)
    types = Column(String)  # JSON-encoded list
    image_small = Column(String)
    image_large = Column(String)
    # Current price snapshot (latest sync)
    current_price = Column(Float)
    price_variant = Column(String)  # normal, holofoil, reverseHolofoil
    is_tracked = Column(Boolean, default=False, nullable=False, index=True)
    tcgplayer_product_id = Column(Integer, nullable=True, index=True)  # TCGCSV/TCGPlayer productId
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    price_history = relationship("PriceHistory", back_populates="card", cascade="all, delete-orphan")
