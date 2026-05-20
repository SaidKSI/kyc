from enum import Enum


class DocumentType(str, Enum):
    national_id = "national_id"
    passport = "passport"
    residence_permit = "residence_permit"
    drivers_license = "drivers_license"


class VerificationStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    approved = "approved"
    rejected = "rejected"
    review = "review"
    error = "error"


class CheckName(str, Enum):
    doc_auth = "doc_auth"
    ocr = "ocr"
    face_match = "face_match"
    liveness = "liveness"
    scoring = "scoring"


class FaceMatchConfidence(str, Enum):
    high = "high"
    low = "low"
    none = "none"


class AuditEventType(str, Enum):
    submitted = "submitted"
    check_complete = "check_complete"
    decision = "decision"
    webhook_sent = "webhook_sent"
    manual_override = "manual_override"
