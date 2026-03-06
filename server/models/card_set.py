from sqlalchemy import Column, String, Date, Integer, DateTime
from datetime import datetime, timezone
from server.database import Base


class CardSet(Base):
    __tablename__ = "card_sets"

    id = Column(String, primary_key=True)  # TCGdex set ID (e.g., "sv08")
    name = Column(String, nullable=False)
    release_date = Column(Date, nullable=True)
    card_count = Column(Integer, default=0)
    series_name = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    fetched_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
