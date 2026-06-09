"""
Session-token routes — used by the end-user browser.
No API key required; authentication is via short-lived session_token in the URL.

Flow:
  Operator backend  → POST /v1/verify (API key)  → gets session_token
  Operator sends session_token to end-user
  End-user browser  → GET  /verify/{token}        → opens capture UI
  End-user browser  → POST /v1/session/{token}/upload, /submit, /status, /stream
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from sqlalchemy import select

from api.deps import get_verification_by_token
from models.audit import AuditEvent
from models.database import AsyncSessionLocal, get_session
from models.user_settings import UserSettings
from models.verification import Verification
from schemas.verification import SessionInfoResponse, SubmitResponse, VerificationStatusResponse
from services.encryption import decrypt_fields
from services.storage import storage

router = APIRouter(prefix="/v1/session", tags=["session"])

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB


# ── GET /v1/session/{token} ───────────────────────────────────────────────────

@router.get("/{token}", response_model=SessionInfoResponse)
async def get_session_info(
    ver: Verification = Depends(get_verification_by_token),
    session: AsyncSession = Depends(get_session),
):
    require_selfie = True
    result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == ver.user_id)
    )
    settings = result.scalar_one_or_none()
    if settings:
        require_selfie = settings.require_selfie

    return SessionInfoResponse(
        verification_id=ver.id,
        document_type=ver.document_type,
        locale=ver.locale,
        status=ver.status,
        require_selfie=require_selfie,
        redirect_url=ver.redirect_url,
        expires_at=ver.session_expires_at,
    )


# ── POST /v1/session/{token}/upload ──────────────────────────────────────────

@router.post("/{token}/upload")
async def session_upload(
    slot: str = Form(...),
    file: UploadFile = File(...),
    ver: Verification = Depends(get_verification_by_token),
    session: AsyncSession = Depends(get_session),
):
    if ver.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot upload to verification with status '{ver.status}'",
        )
    if slot not in ("doc_front", "doc_back", "selfie"):
        raise HTTPException(status_code=422, detail=f"Invalid slot '{slot}'")

    content_type = file.content_type or "image/jpeg"
    if content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Unsupported content type '{content_type}'")

    file_bytes = await file.read()
    if len(file_bytes) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=422, detail="File exceeds 10 MB limit")

    key = await storage.save(ver.id, slot, file_bytes, content_type)

    if slot == "doc_front":
        ver.doc_front_key = key
    elif slot == "doc_back":
        ver.doc_back_key = key
    else:
        ver.selfie_key = key

    await session.commit()
    return {"slot": slot, "key": key}


# ── POST /v1/session/{token}/submit ──────────────────────────────────────────

@router.post("/{token}/submit", status_code=202, response_model=SubmitResponse)
async def session_submit(
    ver: Verification = Depends(get_verification_by_token),
    session: AsyncSession = Depends(get_session),
):
    # Idempotent — return current state if already submitted
    if ver.status in ("processing", "approved", "rejected", "review", "error"):
        return SubmitResponse(
            verification_id=ver.id,
            status=ver.status,
            estimated_seconds=0,
        )

    if not ver.doc_front_key:
        raise HTTPException(status_code=422, detail="doc_front image required before submit")

    require_selfie = True
    result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == ver.user_id)
    )
    settings = result.scalar_one_or_none()
    if settings:
        require_selfie = settings.require_selfie

    if require_selfie and not ver.selfie_key:
        raise HTTPException(status_code=422, detail="selfie image required before submit")

    ver.status = "processing"
    session.add(
        AuditEvent(
            verification_id=ver.id,
            event_type="check_complete",
            actor="system",
            payload={"action": "pipeline_queued"},
        )
    )
    await session.commit()

    try:
        from workers.pipeline import run_pipeline
        run_pipeline.delay(ver.id)
    except ImportError:
        pass

    return SubmitResponse(
        verification_id=ver.id,
        status="processing",
        estimated_seconds=15,
    )


# ── GET /v1/session/{token}/status ───────────────────────────────────────────

@router.get("/{token}/status", response_model=VerificationStatusResponse)
async def session_status(
    ver: Verification = Depends(get_verification_by_token),
):
    return VerificationStatusResponse(
        verification_id=ver.id,
        status=ver.status,
        score=ver.score,
        decision=ver.decision,
        extracted_fields=decrypt_fields(ver.extracted_fields),
        checks=ver.checks,
        completed_at=ver.completed_at,
    )


# ── GET /v1/session/{token}/stream ───────────────────────────────────────────

@router.get("/{token}/stream")
async def session_stream(
    token: str,
    ver: Verification = Depends(get_verification_by_token),
):
    verification_id = ver.id

    async def event_stream() -> AsyncGenerator[str, None]:
        seen: set[str] = set()
        async with AsyncSessionLocal() as s:
            from sqlalchemy import select
            for _ in range(120):  # 2-minute timeout
                await asyncio.sleep(1)
                res = await s.execute(
                    select(Verification).where(Verification.id == verification_id)
                )
                v = res.scalar_one_or_none()
                if not v:
                    break

                for step, check_result in (v.checks or {}).items():
                    if step not in seen:
                        seen.add(step)
                        yield f"data: {json.dumps({'step': step, 'status': 'complete'})}\n\n"

                if v.status in ("approved", "rejected", "review", "error"):
                    yield f"data: {json.dumps({'step': 'done', 'status': v.status, 'score': v.score, 'decision': v.decision})}\n\n"
                    break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
