from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_session, require_admin
from models.audit import AuditEvent
from models.users import User
from models.verification import Verification
from models.webhook_deliveries import WebhookDelivery
from schemas.user import (
    AdminStatsResponse,
    AdminUserDetail,
    AdminUserListItem,
    AdminUserUpdate,
)
from schemas.verification import AdminDecisionUpdate, VerificationDetailResponse, VerificationListItem, WebhookDeliveryResponse
from services.storage import storage

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Review queue ──────────────────────────────────────────────────────────────

@router.get("/queue")
async def get_review_queue(
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
):
    result = await session.execute(
        select(Verification)
        .where(Verification.status == "review")
        .order_by(Verification.created_at.asc())
        .limit(min(limit, 200))
        .offset(offset)
    )
    items = result.scalars().all()
    return {
        "items": [
            {
                "verification_id": v.id,
                "reference_id": v.reference_id,
                "document_type": v.document_type,
                "score": v.score,
                "created_at": v.created_at.isoformat(),
                "doc_front_url": storage.get_url(v.doc_front_key) if v.doc_front_key else None,
            }
            for v in items
        ],
        "total": len(items),
        "limit": limit,
        "offset": offset,
    }


# ── All verifications ─────────────────────────────────────────────────────────

@router.get("/verifications", response_model=list[VerificationListItem])
async def list_all_verifications(
    status_filter: str | None = None,
    user_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
):
    q = select(Verification)
    if status_filter:
        q = q.where(Verification.status == status_filter)
    if user_id:
        q = q.where(Verification.user_id == user_id)
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


# ── Verification detail ───────────────────────────────────────────────────────

@router.get("/verify/{verification_id}", response_model=VerificationDetailResponse)
async def get_verification_detail(
    verification_id: str,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
):
    result = await session.execute(
        select(Verification).where(Verification.id == verification_id)
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


# ── Manual decision ───────────────────────────────────────────────────────────

@router.patch("/verify/{verification_id}/decision")
async def manual_decision(
    verification_id: str,
    body: AdminDecisionUpdate,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
):
    result = await session.execute(
        select(Verification).where(Verification.id == verification_id)
    )
    ver = result.scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="Verification not found")
    if ver.status != "review":
        raise HTTPException(
            status_code=409,
            detail=f"Manual override only allowed on 'review' status, got '{ver.status}'",
        )
    ver.status = body.decision
    ver.decision = body.decision
    ver.completed_at = datetime.now(timezone.utc)
    session.add(
        AuditEvent(
            verification_id=ver.id,
            event_type="manual_override",
            actor=f"agent:{admin.id}",
            payload={"decision": body.decision, "notes": body.notes},
        )
    )
    await session.commit()
    return {
        "verification_id": ver.id,
        "status": ver.status,
        "decision": ver.decision,
        "completed_at": ver.completed_at.isoformat(),
    }


# ── Webhooks ──────────────────────────────────────────────────────────────────

@router.get("/webhooks", response_model=list[WebhookDeliveryResponse])
async def list_webhook_deliveries(
    verification_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
):
    q = select(WebhookDelivery)
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


@router.post("/webhooks/{delivery_id}/retry", status_code=202)
async def retry_webhook(
    delivery_id: str,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
):
    result = await session.execute(
        select(WebhookDelivery).where(WebhookDelivery.id == delivery_id)
    )
    delivery = result.scalar_one_or_none()
    if not delivery:
        raise HTTPException(status_code=404, detail="Webhook delivery not found")
    if delivery.delivered_at:
        raise HTTPException(status_code=409, detail="Webhook already delivered successfully")

    try:
        from services.webhook import dispatch_webhook
        dispatch_webhook.delay(delivery.verification_id)
    except ImportError:
        pass

    return {"queued": True, "verification_id": delivery.verification_id}


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[AdminUserListItem])
async def list_users(
    status_filter: str | None = None,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
):
    q = select(User).where(User.deleted_at.is_(None))
    if status_filter:
        q = q.where(User.status == status_filter)
    q = q.order_by(User.created_at.desc()).limit(min(limit, 200)).offset(offset)
    result = await session.execute(q)
    return [
        AdminUserListItem(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role,
            plan=u.plan,
            status=u.status,
            created_at=u.created_at,
        )
        for u in result.scalars().all()
    ]


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user_detail(
    user_id: str,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
):
    result = await session.execute(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    counts = await session.execute(
        select(Verification.status, func.count(Verification.id))
        .where(Verification.user_id == user_id)
        .group_by(Verification.status)
    )
    by_status: dict[str, int] = {row[0]: row[1] for row in counts}

    return AdminUserDetail(
        id=u.id,
        name=u.name,
        email=u.email,
        role=u.role,
        plan=u.plan,
        status=u.status,
        webhook_url=u.webhook_url,
        created_at=u.created_at,
        total_verifications=sum(by_status.values()),
        approved=by_status.get("approved", 0),
        rejected=by_status.get("rejected", 0),
        review=by_status.get("review", 0),
    )


@router.patch("/users/{user_id}", response_model=AdminUserListItem)
async def update_user(
    user_id: str,
    body: AdminUserUpdate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
):
    result = await session.execute(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    if body.plan is not None:
        u.plan = body.plan
    if body.status is not None:
        u.status = body.status
    if body.name is not None:
        u.name = body.name
    if body.role is not None:
        u.role = body.role
    await session.commit()

    return AdminUserListItem(
        id=u.id,
        name=u.name,
        email=u.email,
        role=u.role,
        plan=u.plan,
        status=u.status,
        created_at=u.created_at,
    )


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=AdminStatsResponse)
async def get_stats(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
):
    status_counts = await session.execute(
        select(Verification.status, func.count(Verification.id)).group_by(Verification.status)
    )
    by_status: dict[str, int] = {row[0]: row[1] for row in status_counts}
    total = sum(by_status.values())

    terminal = by_status.get("approved", 0) + by_status.get("rejected", 0)
    approval_rate = (by_status.get("approved", 0) / terminal) if terminal > 0 else 0.0

    avg_result = await session.execute(
        select(func.avg(Verification.score)).where(Verification.score.is_not(None))
    )
    avg_score = avg_result.scalar_one_or_none()

    user_count = await session.execute(
        select(func.count(User.id)).where(User.deleted_at.is_(None))
    )

    return AdminStatsResponse(
        total_verifications=total,
        total_users=user_count.scalar_one(),
        by_status=by_status,
        approval_rate=round(approval_rate, 4),
        avg_score=round(float(avg_score), 2) if avg_score is not None else None,
    )
