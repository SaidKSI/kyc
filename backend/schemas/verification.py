from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CreateVerificationRequest(BaseModel):
    reference_id: str = Field(..., max_length=255)
    document_type: str = Field(
        ...,
        pattern="^(national_id|passport|residence_permit|drivers_license)$",
    )
    locale: str = Field(default="en", max_length=10)
    redirect_url: Optional[str] = Field(default=None, max_length=500)
    metadata: Optional[dict] = None


class CreateVerificationResponse(BaseModel):
    verification_id: str
    session_token: str
    verify_url: str
    upload_endpoint: str          # kept for operator backend direct-upload
    upload_urls: Optional[dict[str, str]] = None
    expires_at: datetime


class SessionInfoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    verification_id: str
    document_type: str
    locale: str
    status: str
    require_selfie: bool = True
    redirect_url: Optional[str] = None
    expires_at: Optional[datetime] = None


class SubmitResponse(BaseModel):
    verification_id: str
    status: str
    estimated_seconds: int


class VerificationStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    verification_id: str
    status: str
    score: Optional[int] = None
    decision: Optional[str] = None
    extracted_fields: Optional[dict] = None
    checks: Optional[dict] = None
    completed_at: Optional[datetime] = None


class AdminDecisionUpdate(BaseModel):
    decision: str = Field(..., pattern="^(approved|rejected)$")
    notes: Optional[str] = None


class VerificationListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    verification_id: str
    reference_id: str
    document_type: str
    status: str
    score: Optional[int] = None
    decision: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None


class VerificationDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    verification_id: str
    reference_id: str
    document_type: str
    status: str
    score: Optional[int] = None
    decision: Optional[str] = None
    extracted_fields: Optional[dict] = None
    checks: Optional[dict] = None
    locale: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    doc_front_url: Optional[str] = None
    doc_back_url: Optional[str] = None
    selfie_url: Optional[str] = None


class WebhookDeliveryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    verification_id: str
    url: str
    status_code: Optional[int] = None
    attempt: int
    delivered_at: Optional[datetime] = None
    next_retry_at: Optional[datetime] = None
    created_at: datetime
