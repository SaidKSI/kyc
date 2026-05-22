from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class UserProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    email: str
    role: str
    plan: str
    status: str
    webhook_url: Optional[str] = None
    created_at: datetime


class UserProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    webhook_url: Optional[str] = Field(None, max_length=2048)
    webhook_secret: Optional[str] = Field(None, max_length=255)


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


class ApiKeyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    environment: str
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: datetime
    revoked_at: Optional[datetime] = None


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    environment: str = Field(default="production", pattern="^(sandbox|production)$")


class ApiKeyCreateResponse(BaseModel):
    id: str
    name: str
    environment: str
    raw_key: str
    created_at: datetime


class UserSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    require_liveness: bool
    retention_days: int
    score_approve_threshold: Optional[int] = None
    score_reject_threshold: Optional[int] = None
    allowed_doc_types: Optional[list[str]] = None
    allowed_origins: Optional[list[str]] = None


class UserSettingsUpdate(BaseModel):
    require_liveness: Optional[bool] = None
    retention_days: Optional[int] = Field(None, ge=1, le=3650)
    score_approve_threshold: Optional[int] = Field(None, ge=0, le=100)
    score_reject_threshold: Optional[int] = Field(None, ge=0, le=100)
    allowed_doc_types: Optional[list[str]] = None
    allowed_origins: Optional[list[str]] = None


class AdminUserListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    email: str
    role: str
    plan: str
    status: str
    created_at: datetime


class AdminUserDetail(BaseModel):
    id: str
    name: str
    email: str
    role: str
    plan: str
    status: str
    webhook_url: Optional[str] = None
    created_at: datetime
    total_verifications: int
    approved: int
    rejected: int
    review: int


class AdminUserUpdate(BaseModel):
    plan: Optional[str] = Field(None, pattern="^(free|pro|enterprise)$")
    status: Optional[str] = Field(None, pattern="^(active|suspended)$")
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    role: Optional[str] = Field(None, pattern="^(user|admin)$")


class AdminStatsResponse(BaseModel):
    total_verifications: int
    total_users: int
    by_status: dict[str, int]
    approval_rate: float
    avg_score: Optional[float] = None
