"""User self-service portal routes (JWT auth)."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_current_user, get_session
from models.api_keys import ApiKey
from models.user_settings import UserSettings
from models.users import User
from models.verification import Verification
from models.webhook_deliveries import WebhookDelivery
from schemas.user import (
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    ApiKeyResponse,
    UserProfileResponse,
    UserProfileUpdate,
    UserSettingsResponse,
    UserSettingsUpdate,
    PasswordChangeRequest,
)
from schemas.verification import VerificationDetailResponse, VerificationListItem, WebhookDeliveryResponse
from services.auth import generate_api_key, hash_api_key, hash_password, verify_password
from services.storage import storage

router = APIRouter(prefix="/v1", tags=["user"])


# ── Profile ───────────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserProfileResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserProfileResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        plan=user.plan,
        status=user.status,
        webhook_url=user.webhook_url,
        created_at=user.created_at,
    )


@router.patch("/me", response_model=UserProfileResponse)
async def update_me(
    body: UserProfileUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if body.name is not None:
        user.name = body.name
    if body.webhook_url is not None:
        user.webhook_url = body.webhook_url
    if body.webhook_secret is not None:
        user.webhook_secret = body.webhook_secret
    await session.commit()
    return UserProfileResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        plan=user.plan,
        status=user.status,
        webhook_url=user.webhook_url,
        created_at=user.created_at,
    )


@router.patch("/me/password", status_code=204)
async def change_password(
    body: PasswordChangeRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password incorrect")
    user.password_hash = hash_password(body.new_password)
    await session.commit()


# ── API Keys ──────────────────────────────────────────────────────────────────

@router.get("/keys", response_model=list[ApiKeyResponse])
async def list_keys(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(ApiKey)
        .where(ApiKey.user_id == user.id)
        .order_by(ApiKey.created_at.desc())
    )
    return [
        ApiKeyResponse(
            id=k.id,
            name=k.name,
            environment=k.environment,
            last_used_at=k.last_used_at,
            expires_at=k.expires_at,
            created_at=k.created_at,
            revoked_at=k.revoked_at,
        )
        for k in result.scalars().all()
    ]


@router.post("/keys", status_code=201, response_model=ApiKeyCreateResponse)
async def create_key(
    body: ApiKeyCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    raw_key = generate_api_key()
    key = ApiKey(
        id=str(uuid.uuid4()),
        user_id=user.id,
        name=body.name,
        key_hash=hash_api_key(raw_key),
        environment=body.environment,
    )
    session.add(key)
    await session.commit()
    return ApiKeyCreateResponse(
        id=key.id,
        name=key.name,
        environment=key.environment,
        raw_key=raw_key,
        created_at=key.created_at,
    )


@router.post("/keys/{key_id}/regenerate", status_code=200, response_model=ApiKeyCreateResponse)
async def regenerate_key(
    key_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user.id)
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    if key.revoked_at:
        raise HTTPException(status_code=409, detail="API key already revoked")

    raw_key = generate_api_key()
    key.key_hash = hash_api_key(raw_key)
    await session.commit()

    return ApiKeyCreateResponse(
        id=key.id,
        name=key.name,
        environment=key.environment,
        raw_key=raw_key,
        created_at=key.created_at,
    )


@router.delete("/keys/{key_id}", status_code=204)
async def revoke_key(
    key_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user.id)
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    if key.revoked_at:
        raise HTTPException(status_code=409, detail="API key already revoked")
    key.revoked_at = datetime.now(timezone.utc)
    await session.commit()


# ── Webhooks ──────────────────────────────────────────────────────────────────

@router.get("/webhooks", response_model=list[WebhookDeliveryResponse])
async def list_my_webhooks(
    verification_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(WebhookDelivery).where(WebhookDelivery.user_id == user.id)
    if verification_id:
        q = q.where(WebhookDelivery.verification_id == verification_id)
    q = q.order_by(WebhookDelivery.created_at.desc()).limit(min(limit, 200)).offset(offset)
    result = await session.execute(q)
    return [
        WebhookDeliveryResponse(
            id=d.id,
            verification_id=d.verification_id,
            url=d.url,
            status_code=d.status_code,
            attempt=d.attempt,
            delivered_at=d.delivered_at,
            next_retry_at=d.next_retry_at,
            created_at=d.created_at,
        )
        for d in result.scalars().all()
    ]


# ── Settings ──────────────────────────────────────────────────────────────────

async def _get_or_create_settings(user_id: str, session: AsyncSession) -> UserSettings:
    result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == user_id)
    )
    s = result.scalar_one_or_none()
    if not s:
        s = UserSettings(user_id=user_id)
        session.add(s)
        await session.flush()
    return s


@router.get("/settings", response_model=UserSettingsResponse)
async def get_settings(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    s = await _get_or_create_settings(user.id, session)
    return UserSettingsResponse(
        require_liveness=s.require_liveness,
        require_selfie=s.require_selfie,
        retention_days=s.retention_days,
        score_approve_threshold=s.score_approve_threshold,
        score_reject_threshold=s.score_reject_threshold,
        allowed_doc_types=s.allowed_doc_types,
        allowed_origins=s.allowed_origins,
    )


@router.patch("/settings", response_model=UserSettingsResponse)
async def update_settings(
    body: UserSettingsUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    s = await _get_or_create_settings(user.id, session)
    if body.require_liveness is not None:
        s.require_liveness = body.require_liveness
    if body.require_selfie is not None:
        s.require_selfie = body.require_selfie
    if body.retention_days is not None:
        s.retention_days = body.retention_days
    if body.score_approve_threshold is not None:
        s.score_approve_threshold = body.score_approve_threshold
    if body.score_reject_threshold is not None:
        s.score_reject_threshold = body.score_reject_threshold
    if body.allowed_doc_types is not None:
        s.allowed_doc_types = body.allowed_doc_types
    if body.allowed_origins is not None:
        s.allowed_origins = body.allowed_origins
    s.updated_at = datetime.now(timezone.utc)
    await session.commit()
    return UserSettingsResponse(
        require_liveness=s.require_liveness,
        require_selfie=s.require_selfie,
        retention_days=s.retention_days,
        score_approve_threshold=s.score_approve_threshold,
        score_reject_threshold=s.score_reject_threshold,
        allowed_doc_types=s.allowed_doc_types,
        allowed_origins=s.allowed_origins,
    )


# ── Dashboard verification views (JWT auth) ───────────────────────────────────

@router.get("/verifications", response_model=list[VerificationListItem])
async def list_my_verifications(
    status_filter: str | None = None,
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(Verification).where(Verification.user_id == user.id)
    if status_filter:
        q = q.where(Verification.status == status_filter)
    q = q.order_by(Verification.created_at.desc()).limit(min(limit, 200)).offset(offset)
    result = await session.execute(q)
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
        for v in result.scalars().all()
    ]


@router.get("/verifications/{verification_id}", response_model=VerificationDetailResponse)
async def get_my_verification(
    verification_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Verification).where(
            Verification.id == verification_id,
            Verification.user_id == user.id,
        )
    )
    ver = result.scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="Verification not found")
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
