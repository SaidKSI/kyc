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


class CreateVerificationResponse(BaseModel):
    verification_id: str
    upload_endpoint: str
    upload_urls: Optional[dict[str, str]] = None
    expires_at: datetime


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
