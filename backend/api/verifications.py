import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_operator
from core.config import settings
from models.audit import AuditEvent
from models.database import AsyncSessionLocal, get_session
from models.operators import Operator
from models.verification import Verification
from schemas.verification import (
    CreateVerificationRequest,
    CreateVerificationResponse,
    SubmitResponse,
    VerificationStatusResponse,
)
from services.auth import hash_api_key
from services.storage import storage

router = APIRouter(prefix="/v1", tags=["verifications"])

_EXPIRY_MINUTES = 30
_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB


async def _get_verification(
    verification_id: str,
    operator: Operator,
    session: AsyncSession,
) -> Verification:
    result = await session.execute(
        select(Verification).where(
            Verification.id == verification_id,
            Verification.operator_id == operator.id,
        )
    )
    ver = result.scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="Verification not found")
    return ver


@router.post("/verify", status_code=201, response_model=CreateVerificationResponse)
async def create_verification(
    data: CreateVerificationRequest,
    operator: Operator = Depends(get_operator),
    session: AsyncSession = Depends(get_session),
):
    ver_id = f"ver_{uuid.uuid4().hex[:16]}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=_EXPIRY_MINUTES)

    session.add(
        Verification(
            id=ver_id,
            operator_id=operator.id,
            reference_id=data.reference_id,
            document_type=data.document_type,
            status="pending",
        )
    )
    session.add(
        AuditEvent(
            verification_id=ver_id,
            event_type="submitted",
            actor=f"operator:{operator.id}",
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
        upload_endpoint=f"/v1/verify/{ver_id}/upload",
        upload_urls=upload_urls,
        expires_at=expires_at,
    )


@router.post("/verify/{verification_id}/upload")
async def upload_file(
    verification_id: str,
    slot: str = Form(...),
    file: UploadFile = File(...),
    operator: Operator = Depends(get_operator),
    session: AsyncSession = Depends(get_session),
):
    ver = await _get_verification(verification_id, operator, session)

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

    key = await storage.save(verification_id, slot, file_bytes, content_type)

    if slot == "doc_front":
        ver.doc_front_key = key
    elif slot == "doc_back":
        ver.doc_back_key = key
    else:
        ver.selfie_key = key

    await session.commit()
    return {"slot": slot, "key": key}


@router.post(
    "/verify/{verification_id}/submit",
    status_code=202,
    response_model=SubmitResponse,
)
async def submit_verification(
    verification_id: str,
    operator: Operator = Depends(get_operator),
    session: AsyncSession = Depends(get_session),
):
    ver = await _get_verification(verification_id, operator, session)

    # Idempotent — return current state if already submitted
    if ver.status in ("processing", "approved", "rejected", "review", "error"):
        return SubmitResponse(
            verification_id=ver.id,
            status=ver.status,
            estimated_seconds=0,
        )

    if not ver.doc_front_key:
        raise HTTPException(status_code=422, detail="doc_front image required before submit")
    if not ver.selfie_key:
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

    # Phase 5 will implement the worker; import guard keeps server bootable now
    try:
        from workers.pipeline import run_pipeline
        run_pipeline.delay(verification_id)
    except ImportError:
        pass

    return SubmitResponse(
        verification_id=ver.id,
        status="processing",
        estimated_seconds=8,
    )


@router.get("/verify/{verification_id}/status", response_model=VerificationStatusResponse)
async def get_verification_status(
    verification_id: str,
    operator: Operator = Depends(get_operator),
    session: AsyncSession = Depends(get_session),
):
    ver = await _get_verification(verification_id, operator, session)
    return VerificationStatusResponse(
        verification_id=ver.id,
        status=ver.status,
        score=ver.score,
        decision=ver.decision,
        extracted_fields=ver.extracted_fields,
        checks=ver.checks,
        completed_at=ver.completed_at,
    )


@router.get("/verify/{verification_id}/stream")
async def stream_verification_progress(
    verification_id: str,
    api_key: str,  # query param — EventSource cannot set custom headers
    session: AsyncSession = Depends(get_session),
):
    # Validate key via query param
    key_hash = hash_api_key(api_key)
    result = await session.execute(
        select(Operator).where(Operator.api_key_hash == key_hash)
    )
    operator = result.scalar_one_or_none()
    if not operator:
        raise HTTPException(status_code=401, detail="Invalid API key")

    async def event_stream() -> AsyncGenerator[str, None]:
        seen: set[str] = set()
        async with AsyncSessionLocal() as s:
            for _ in range(120):  # 2-minute timeout
                await asyncio.sleep(1)
                res = await s.execute(
                    select(Verification).where(
                        Verification.id == verification_id,
                        Verification.operator_id == operator.id,
                    )
                )
                ver = res.scalar_one_or_none()
                if not ver:
                    break

                for step, check_result in (ver.checks or {}).items():
                    if step not in seen:
                        seen.add(step)
                        yield f"data: {json.dumps({'step': step, 'status': 'complete'})}\n\n"

                if ver.status in ("approved", "rejected", "review", "error"):
                    yield f"data: {json.dumps({'step': 'done', 'status': ver.status, 'score': ver.score, 'decision': ver.decision})}\n\n"
                    break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
