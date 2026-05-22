import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_user
from core.config import settings
from models.audit import AuditEvent
from models.database import get_session
from models.users import User
from models.verification import Verification
from schemas.verification import (
    CreateVerificationRequest,
    CreateVerificationResponse,
    VerificationDetailResponse,
    VerificationListItem,
    VerificationStatusResponse,
)
from services.storage import storage

router = APIRouter(prefix="/v1", tags=["verifications"])

_EXPIRY_MINUTES = 30


async def _get_verification(
    verification_id: str,
    user: User,
    session: AsyncSession,
) -> Verification:
    result = await session.execute(
        select(Verification).where(
            Verification.id == verification_id,
            Verification.user_id == user.id,
        )
    )
    ver = result.scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="Verification not found")
    return ver


@router.post("/verify", status_code=201, response_model=CreateVerificationResponse)
async def create_verification(
    data: CreateVerificationRequest,
    request: Request,
    user: User = Depends(get_user),
    session: AsyncSession = Depends(get_session),
):
    ver_id = f"ver_{uuid.uuid4().hex[:16]}"
    session_token = f"ses_{secrets.token_urlsafe(32)}"
    session_expires_at = datetime.now(timezone.utc) + timedelta(minutes=_EXPIRY_MINUTES)

    session.add(
        Verification(
            id=ver_id,
            user_id=user.id,
            reference_id=data.reference_id,
            document_type=data.document_type,
            status="pending",
            session_token=session_token,
            session_expires_at=session_expires_at,
            locale=data.locale,
            redirect_url=data.redirect_url,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            metadata_=data.metadata,
        )
    )
    await session.flush()
    session.add(
        AuditEvent(
            verification_id=ver_id,
            event_type="submitted",
            actor=f"user:{user.id}",
            payload={
                "reference_id": data.reference_id,
                "document_type": data.document_type,
                "locale": data.locale,
            },
        )
    )
    await session.commit()

    upload_urls = None
    if settings.storage_backend == "s3":
        upload_urls = {
            slot: storage.get_url(f"{ver_id}/{slot}.jpg")
            for slot in ("doc_front", "doc_back", "selfie")
        }

    return CreateVerificationResponse(
        verification_id=ver_id,
        session_token=session_token,
        verify_url=f"{settings.frontend_origin}/verify/{session_token}",
        upload_endpoint=f"/v1/session/{session_token}/upload",
        upload_urls=upload_urls,
        expires_at=session_expires_at,
    )


@router.get("/verify", response_model=list[VerificationListItem])
async def list_verifications(
    status_filter: str | None = None,
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(get_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(Verification).where(Verification.user_id == user.id)
    if status_filter:
        q = q.where(Verification.status == status_filter)
    q = q.order_by(Verification.created_at.desc()).limit(min(limit, 200)).offset(offset)
    result = await session.execute(q)
    items = result.scalars().all()
    return [
        VerificationListItem(
            verification_id=v.id,
            reference_id=v.reference_id,
            document_type=v.document_type,
            status=v.status,
            score=v.score,
            decision=v.decision,
            created_at=v.created_at,
            completed_at=v.completed_at,
        )
        for v in items
    ]


@router.get("/verify/{verification_id}", response_model=VerificationDetailResponse)
async def get_verification_detail(
    verification_id: str,
    user: User = Depends(get_user),
    session: AsyncSession = Depends(get_session),
):
    ver = await _get_verification(verification_id, user, session)
    return VerificationDetailResponse(
        verification_id=ver.id,
        reference_id=ver.reference_id,
        document_type=ver.document_type,
        status=ver.status,
        score=ver.score,
        decision=ver.decision,
        extracted_fields=ver.extracted_fields,
        checks=ver.checks,
        locale=ver.locale,
        created_at=ver.created_at,
        completed_at=ver.completed_at,
        doc_front_url=storage.get_url(ver.doc_front_key) if ver.doc_front_key else None,
        doc_back_url=storage.get_url(ver.doc_back_key) if ver.doc_back_key else None,
        selfie_url=storage.get_url(ver.selfie_key) if ver.selfie_key else None,
    )


@router.get("/verify/{verification_id}/status", response_model=VerificationStatusResponse)
async def get_verification_status(
    verification_id: str,
    user: User = Depends(get_user),
    session: AsyncSession = Depends(get_session),
):
    ver = await _get_verification(verification_id, user, session)
    return VerificationStatusResponse(
        verification_id=ver.id,
        status=ver.status,
        score=ver.score,
        decision=ver.decision,
        extracted_fields=ver.extracted_fields,
        checks=ver.checks,
        completed_at=ver.completed_at,
    )
