from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from server.database import Base


class Sale(Base):
    """Individual completed sale record from TCGPlayer or eBay."""
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, autoincrement=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    source = Column(String, nullable=False)  # "tcgplayer", "ebay"
    source_product_id = Column(String)  # TCGPlayer product ID or eBay item ID
    order_date = Column(DateTime, nullable=False)
    purchase_price = Column(Float, nullable=False)
    shipping_price = Column(Float, default=0.0)
    condition = Column(String)  # "Near Mint", "Lightly Played", etc.
    variant = Column(String)  # "Holofoil", "Normal", "1st Edition Holofoil"
    language = Column(String, default="English")
    quantity = Column(Integer, default=1)
    listing_title = Column(String)
    listing_id = Column(String, unique=True)  # Dedup key
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    card = relationship("Card", backref="sales")

    __table_args__ = (
        Index("ix_sales_card_date", "card_id", "order_date"),
        Index("ix_sales_listing_id", "listing_id"),
    )
