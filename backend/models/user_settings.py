from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    allowed_doc_types: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    require_liveness: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    require_selfie: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    allowed_origins: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    score_approve_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score_reject_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
