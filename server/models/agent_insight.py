from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey
from datetime import datetime, timezone
from server.database import Base


class AgentInsight(Base):
    """Agent-generated observation or alert, surfaced to user asynchronously."""
    __tablename__ = "agent_insights"

    id = Column(Integer, primary_key=True, autoincrement=True)
    type = Column(String, nullable=False, index=True)  # opportunity, warning, anomaly, milestone
    severity = Column(String, nullable=False, default="info")  # info, notable, urgent
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=True, index=True)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    metadata_json = Column(Text, nullable=True)  # structured data (prices, thresholds, etc.)
    created_at = Column(
        DateTime, nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
    acknowledged = Column(Boolean, nullable=False, default=False)
