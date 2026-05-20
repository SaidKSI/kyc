from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_current_user
from models.audit import AuditEvent
from models.database import get_session
from models.verification import Verification
from schemas.verification import AdminDecisionUpdate

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/queue")
async def get_review_queue(
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    user: dict = Depends(get_current_user),
):
    result = await session.execute(
        select(Verification)
        .where(Verification.status == "review")
        .order_by(Verification.created_at.asc())
        .limit(limit)
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
                "doc_front_url": None,  # populated in Phase 9 dashboard
            }
            for v in items
        ],
        "total": len(items),
        "limit": limit,
        "offset": offset,
    }


@router.patch("/verify/{verification_id}/decision")
async def manual_decision(
    verification_id: str,
    body: AdminDecisionUpdate,
    session: AsyncSession = Depends(get_session),
    user: dict = Depends(get_current_user),
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
            actor=f"agent:{user.get('sub', 'unknown')}",
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
