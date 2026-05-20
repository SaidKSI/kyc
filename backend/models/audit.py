import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    verification_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("verifications.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # submitted | check_complete | decision | webhook_sent | manual_override
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # system | operator | agent:{id}
    actor: Mapped[str] = mapped_column(String(100), nullable=False, default="system")
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
