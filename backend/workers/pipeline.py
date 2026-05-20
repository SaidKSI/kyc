"""
Main pipeline task — runs all ML checks in order, writes results to DB.
Triggered by POST /v1/verify/{id}/submit.
"""
import asyncio
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from models.database import AsyncSessionLocal
from models.audit import AuditEvent
from models.verification import Verification
from services.scoring import compute_score
from services.storage import storage
from workers.celery_app import celery_app


@celery_app.task(bind=True, name="workers.pipeline.run_pipeline", max_retries=0)
def run_pipeline(self, verification_id: str) -> None:
    asyncio.run(_execute(verification_id))


async def _execute(verification_id: str) -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Verification).where(Verification.id == verification_id)
        )
        ver = result.scalar_one_or_none()
        if not ver:
            return

        ver.checks = ver.checks or {}

        # Load image bytes once
        try:
            front_bytes = await storage.read_bytes(ver.doc_front_key)
            selfie_bytes = await storage.read_bytes(ver.selfie_key)
            back_bytes = (
                await storage.read_bytes(ver.doc_back_key)
                if ver.doc_back_key
                else None
            )
        except Exception as exc:
            await _fail(session, ver, f"Failed to load images: {exc}")
            return

        # ── Step 4a: Document authenticity ────────────────────────────────
        await _run_step(
            session, ver, "doc_auth",
            lambda: _do_doc_auth(front_bytes, back_bytes),
        )

        # ── Step 4b: OCR ──────────────────────────────────────────────────
        ocr_result = await _run_step(
            session, ver, "ocr",
            lambda: _do_ocr(front_bytes, ver.document_type),
        )

        # ── Step 4c: Face match ───────────────────────────────────────────
        await _run_step(
            session, ver, "face_match",
            lambda: _do_face_match(front_bytes, selfie_bytes),
        )

        # ── Step 4d: Liveness ─────────────────────────────────────────────
        await _run_step(
            session, ver, "liveness",
            lambda: _do_liveness(selfie_bytes),
        )

        # ── Step 4e: Scoring ──────────────────────────────────────────────
        score_result = compute_score(ver.checks)
        ver.checks["scoring"] = score_result
        flag_modified(ver, "checks")

        ver.score = score_result["score"]
        ver.decision = score_result["decision"]
        ver.status = score_result["decision"]  # approved | rejected | review
        ver.completed_at = datetime.now(timezone.utc)

        # Persist extracted fields from OCR
        if ocr_result and not ocr_result.get("skipped"):
            ver.extracted_fields = ocr_result.get("extracted_fields")

        session.add(
            AuditEvent(
                verification_id=ver.id,
                event_type="decision",
                actor="system",
                payload={
                    "score": ver.score,
                    "decision": ver.decision,
                    "status": ver.status,
                },
            )
        )
        await session.commit()

    # Webhook dispatch (Phase 7 — no-op until implemented)
    try:
        from services.webhook import dispatch_webhook
        await dispatch_webhook(verification_id)
    except ImportError:
        pass


async def _run_step(session, ver, step_name: str, fn) -> dict:
    """Run one ML step, write result to checks JSONB, continue on soft error."""
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, fn)
    except Exception as exc:
        result = {"error": str(exc), "skipped": True}

    ver.checks = {**ver.checks, step_name: result}
    flag_modified(ver, "checks")
    await session.commit()

    session.add(
        AuditEvent(
            verification_id=ver.id,
            event_type="check_complete",
            actor="system",
            payload={"step": step_name, "skipped": result.get("skipped", False)},
        )
    )
    await session.commit()
    return result


async def _fail(session, ver, reason: str) -> None:
    ver.status = "error"
    ver.completed_at = datetime.now(timezone.utc)
    session.add(
        AuditEvent(
            verification_id=ver.id,
            event_type="decision",
            actor="system",
            payload={"error": reason},
        )
    )
    await session.commit()


# ── Pure sync ML wrappers (run in executor) ───────────────────────────────────

def _do_doc_auth(front_bytes: bytes, back_bytes: bytes | None) -> dict:
    from workers.doc_auth import check_doc_auth
    result = check_doc_auth(front_bytes)
    if back_bytes:
        back_result = check_doc_auth(back_bytes)
        result["flags"] = list(set(result.get("flags", []) + back_result.get("flags", [])))
        result["confidence"] = round((result["confidence"] + back_result["confidence"]) / 2, 3)
        result["authentic"] = result["authentic"] and back_result["authentic"]
    return result


def _do_ocr(front_bytes: bytes, document_type: str) -> dict:
    from workers.ocr import run_ocr
    return run_ocr(front_bytes, document_type)


def _do_face_match(front_bytes: bytes, selfie_bytes: bytes) -> dict:
    from workers.face_match import match_faces
    return match_faces(front_bytes, selfie_bytes)


def _do_liveness(selfie_bytes: bytes) -> dict:
    from workers.liveness import check_liveness
    return check_liveness(selfie_bytes)
