"""
Main pipeline task — runs all ML checks in order, writes results to DB.
Triggered by POST /v1/verify/{id}/submit.
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from models.database import AsyncSessionLocal
from models.audit import AuditEvent
from models.users import User
from models.verification import Verification
from services.scoring import compute_score
from services.storage import storage
from workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="workers.pipeline.run_pipeline", max_retries=0)
def run_pipeline(self, verification_id: str) -> None:
    # Dispose pool before new event loop — prevents "Future attached to
    # a different loop" when task runs after a previous task's loop closed
    try:
        from models.database import engine
        engine.sync_engine.dispose()
    except Exception:
        pass
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_execute(verification_id))
    finally:
        loop.close()


async def _execute(verification_id: str) -> None:
    logger.info(f"[PIPELINE] Starting for verification_id={verification_id}")
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Verification).where(Verification.id == verification_id)
        )
        ver = result.scalar_one_or_none()
        if not ver:
            logger.error(f"[PIPELINE] Verification {verification_id} not found")
            return

        logger.info(f"[PIPELINE] Loaded verification. doc_front_key={ver.doc_front_key}, doc_back_key={ver.doc_back_key}, selfie_key={ver.selfie_key}")
        ver.checks = ver.checks or {}

        # Load image bytes once
        try:
            logger.info(f"[PIPELINE] Loading image bytes from storage")
            front_bytes = await storage.read_bytes(ver.doc_front_key)
            logger.info(f"[PIPELINE] Front image loaded: {len(front_bytes)} bytes")
            selfie_bytes = await storage.read_bytes(ver.selfie_key)
            logger.info(f"[PIPELINE] Selfie image loaded: {len(selfie_bytes)} bytes")
            back_bytes = (
                await storage.read_bytes(ver.doc_back_key)
                if ver.doc_back_key
                else None
            )
            if back_bytes:
                logger.info(f"[PIPELINE] Back image loaded: {len(back_bytes)} bytes")
        except Exception as exc:
            logger.error(f"[PIPELINE] Failed to load images: {exc}", exc_info=True)
            await _fail(session, ver, f"Failed to load images: {exc}")
            return

        # ── Step 4a: Document authenticity ────────────────────────────────
        logger.info(f"[PIPELINE] Running doc_auth step")
        await _run_step(
            session, ver, "doc_auth",
            lambda: _do_doc_auth(front_bytes, back_bytes),
        )

        # ── Step 4b: OCR ──────────────────────────────────────────────────
        logger.info(f"[PIPELINE] Running ocr step for document_type={ver.document_type}")
        ocr_result = await _run_step(
            session, ver, "ocr",
            lambda: _do_ocr(front_bytes, ver.document_type, back_bytes),
        )
        logger.info(f"[PIPELINE] OCR result: {ocr_result}")

        # ── Step 4c: Face match ───────────────────────────────────────────
        logger.info(f"[PIPELINE] Running face_match step")
        await _run_step(
            session, ver, "face_match",
            lambda: _do_face_match(front_bytes, selfie_bytes),
        )

        # ── Step 4d: Liveness ─────────────────────────────────────────────
        logger.info(f"[PIPELINE] Running liveness step")
        await _run_step(
            session, ver, "liveness",
            lambda: _do_liveness(selfie_bytes),
        )

        # ── Step 4e: LLM vision fraud analysis ───────────────────────────
        logger.info(f"[PIPELINE] Running llm_analysis step")
        await _run_step(
            session, ver, "llm_analysis",
            lambda: _do_llm_analysis(front_bytes, ver.document_type, ver.extracted_fields, ver.checks),
        )

        # ── Step 4f: Scoring ──────────────────────────────────────────────
        logger.info(f"[PIPELINE] Running scoring with checks={ver.checks}")
        score_result = compute_score(ver.checks)
        logger.info(f"[PIPELINE] Score result: {score_result}")
        ver.checks["scoring"] = score_result
        flag_modified(ver, "checks")

        ver.score = score_result["score"]
        ver.decision = score_result["decision"]
        ver.status = score_result["decision"]  # approved | rejected | review
        ver.completed_at = datetime.now(timezone.utc)

        # Persist extracted fields from OCR
        if ocr_result and not ocr_result.get("skipped"):
            ver.extracted_fields = ocr_result.get("extracted_fields")
            logger.info(f"[PIPELINE] Extracted fields: {ver.extracted_fields}")

        # ── Step 4g: Rejection / review reason (LLM, text only) ──────────
        if ver.decision in ("rejected", "review"):
            logger.info(f"[PIPELINE] Generating rejection reason for decision={ver.decision}")
            reason = _generate_rejection_reason(ver.checks, ver.decision)
            ver.checks["rejection_reason"] = reason
            flag_modified(ver, "checks")
            logger.info(f"[PIPELINE] Rejection reason: {reason}")

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
        logger.info(f"[PIPELINE] Verification {verification_id} completed with status={ver.status}, score={ver.score}")

        # Check webhook URL while session is still open — avoid queuing
        # a Celery task for users who have no webhook configured
        user_result = await session.execute(
            select(User).where(User.id == ver.user_id)
        )
        user = user_result.scalar_one_or_none()
        has_webhook = bool(user and user.webhook_url)

    # Webhook dispatch — only if user has a webhook URL configured
    if has_webhook:
        try:
            from services.webhook import dispatch_webhook
            logger.info(f"[PIPELINE] Dispatching webhook for verification_id={verification_id}")
            dispatch_webhook.apply_async(args=[verification_id])
        except Exception as e:
            logger.error(f"[PIPELINE] Failed to dispatch webhook: {e}", exc_info=True)
    else:
        logger.info(f"[PIPELINE] No webhook URL configured for user — skipping dispatch")


async def _run_step(session, ver, step_name: str, fn) -> dict:
    """Run one ML step, write result to checks JSONB, continue on soft error."""
    logger.info(f"[STEP] Starting {step_name}")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, fn)
        logger.info(f"[STEP] {step_name} completed: {result}")
    except Exception as exc:
        logger.error(f"[STEP] {step_name} failed: {exc}", exc_info=True)
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


def _do_ocr(front_bytes: bytes, document_type: str, back_bytes: bytes | None) -> dict:
    from workers.ocr import run_ocr
    return run_ocr(front_bytes, document_type, back_bytes=back_bytes)


def _do_face_match(front_bytes: bytes, selfie_bytes: bytes) -> dict:
    from workers.face_match import match_faces
    return match_faces(front_bytes, selfie_bytes)


def _do_liveness(selfie_bytes: bytes) -> dict:
    from workers.liveness import check_liveness
    return check_liveness(selfie_bytes)


def _do_llm_analysis(
    front_bytes: bytes,
    document_type: str,
    extracted_fields: dict | None,
    checks: dict | None,
) -> dict:
    from workers.llm_analysis import run_llm_analysis
    return run_llm_analysis(front_bytes, document_type, extracted_fields, checks)


def _generate_rejection_reason(checks: dict, decision: str) -> dict:
    """
    GPT-4o-mini generates a safe, generic user-facing message from check flags.
    Never exposes specific check details or PII.
    """
    import os, json, logging
    log = logging.getLogger(__name__)

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key == "sk-your-key-here":
        return {"skipped": True, "message": _fallback_reason(checks, decision)}

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)

        # Summarise signals — no PII, no field values
        signals = []
        ocr = checks.get("ocr", {})
        doc_auth = checks.get("doc_auth", {})
        face = checks.get("face_match", {})
        liveness = checks.get("liveness", {})
        llm = checks.get("llm_analysis", {})

        if ocr.get("validation_flags"):
            signals.extend(ocr["validation_flags"])
        if [k for k, v in ocr.get("viz_mrz_cross_check", {}).items() if v == "mismatch"]:
            signals.append("data_field_inconsistency")
        if ocr.get("mrz_valid") is False:
            signals.append("mrz_checksum_failed")
        if not doc_auth.get("authentic"):
            signals.extend(doc_auth.get("flags", []))
        if not face.get("match"):
            signals.append("face_mismatch")
        if not liveness.get("live"):
            signals.append("liveness_failed")
        if llm.get("authentic_assessment") in ("suspicious", "likely_fake"):
            signals.append(f"document_{llm['authentic_assessment'].replace(' ', '_')}")
        if llm.get("doc_type_confirmed") is False:
            signals.append("doc_type_mismatch")

        prompt = f"""You are writing a KYC verification result message for an end user.
Decision: {decision}
Internal signals (do NOT expose these directly): {signals}

Write a helpful, polite, 1–2 sentence message explaining the result.
Rules:
- Do NOT mention specific technical checks, scores, or field names
- Do NOT reveal which specific check failed
- Be generic but helpful — guide the user on what to try
- Use simple language (no jargon)
- If decision is "review": explain their submission is under manual review

Return ONLY valid JSON: {{"message": "<user-facing message>", "category": "<main_issue>"}}
Categories: document_quality | document_expired | identity_mismatch | document_invalid | under_review"""

        resp = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=200,
            response_format={"type": "json_object"},
        )
        result = json.loads(resp.choices[0].message.content)
        log.info(f"[PIPELINE] Rejection reason: {result}")
        return result

    except Exception as exc:
        log.error(f"[PIPELINE] Rejection reason generation failed: {exc}", exc_info=True)
        return {"skipped": True, "message": _fallback_reason(checks, decision)}


def _fallback_reason(checks: dict, decision: str) -> str:
    """Static fallback when OpenAI is unavailable."""
    if decision == "review":
        return "Your submission is under manual review. We will notify you of the outcome shortly."
    ocr = checks.get("ocr", {})
    if "document_expired" in ocr.get("validation_flags", []):
        return "Your document appears to be expired. Please resubmit with a valid document."
    if not checks.get("face_match", {}).get("match"):
        return "We could not confirm your identity. Please ensure your selfie clearly shows your face."
    if not checks.get("liveness", {}).get("live"):
        return "We could not verify a live selfie. Please retake your selfie in good lighting."
    return "We were unable to verify your identity. Please ensure your document is clear, valid, and unobstructed."
