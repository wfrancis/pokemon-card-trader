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
    price_condition = Column(String, default="Near Mint")  # Near Mint, Lightly Played, etc.
    is_tracked = Column(Boolean, default=False, nullable=False, index=True)
    is_viable = Column(Boolean, default=False, nullable=False, index=True)  # Sticky: True once price >= $20
    artist = Column(String, nullable=True)  # Card illustrator/artist
    tcgplayer_product_id = Column(Integer, nullable=True, index=True)  # TCGCSV/TCGPlayer productId
    # Cached investment metrics (batch-computed by investment_screener service)
    liquidity_score = Column(Integer, nullable=True)  # 0-100
    appreciation_slope = Column(Float, nullable=True)  # Daily % appreciation from linear regression
    appreciation_consistency = Column(Float, nullable=True)  # R² of trend (0-1, higher = steadier)
    appreciation_win_rate = Column(Float, nullable=True)  # % of days with positive return
    appreciation_score = Column(Float, nullable=True)  # Composite 0-100 score
    cached_regime = Column(String, nullable=True)  # accumulation, markup, distribution, markdown
    cached_adx = Column(Float, nullable=True)  # Trend strength 0-100
    liquidity_updated_at = Column(DateTime, nullable=True)  # When metrics were last computed
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    price_history = relationship("PriceHistory", back_populates="card", cascade="all, delete-orphan")
