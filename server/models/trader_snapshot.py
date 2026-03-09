from sqlalchemy import Column, Integer, DateTime, Text
from datetime import datetime, timezone
from server.database import Base


class TraderAnalysisSnapshot(Base):
    """Saved AI Trading Desk analysis result (immutable snapshot)."""
    __tablename__ = "trader_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(
        DateTime, nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
    personas_json = Column(Text)
    consensus = Column(Text)
    consensus_picks_json = Column(Text)
    market_data_summary_json = Column(Text)
    trading_economics_json = Column(Text)
    tokens_input = Column(Integer, default=0)
    tokens_output = Column(Integer, default=0)
