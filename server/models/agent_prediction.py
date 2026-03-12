from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from datetime import datetime, timezone
from server.database import Base


class AgentPrediction(Base):
    """Tracked AI prediction — measures agent accuracy over time."""
    __tablename__ = "agent_predictions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    snapshot_id = Column(Integer, ForeignKey("trader_snapshots.id"), nullable=True, index=True)

    # Prediction details
    signal = Column(String, nullable=False)  # buy, accumulate, watch, hold
    persona_source = Column(String, nullable=False, default="consensus")  # consensus, quant, pm, contrarian, agent
    entry_price = Column(Float, nullable=False)  # card price at prediction time
    target_price = Column(Float, nullable=True)  # AI's stated target
    stop_loss = Column(Float, nullable=True)  # AI's stated stop

    # Timestamps
    predicted_at = Column(
        DateTime, nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    # Actual prices — backfilled over time by prediction_tracker
    price_7d = Column(Float, nullable=True)
    price_14d = Column(Float, nullable=True)
    price_30d = Column(Float, nullable=True)
    price_60d = Column(Float, nullable=True)
    price_90d = Column(Float, nullable=True)

    # Computed returns
    return_pct_7d = Column(Float, nullable=True)
    return_pct_30d = Column(Float, nullable=True)
    return_pct_90d = Column(Float, nullable=True)

    # Outcome: pending, correct, incorrect, expired
    outcome = Column(String, nullable=False, default="pending")
