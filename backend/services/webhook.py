"""
Outbound webhook dispatch — Celery task with exponential backoff retry.
Called by the pipeline after a terminal status is written.

Retry policy: 5 attempts total, delays: 60s → 120s → 240s → 480s
"""
import asyncio
import hashlib
import hmac
import json
import logging
import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from core.config import settings
from models.database import AsyncSessionLocal
from models.users import User
from models.verification import Verification
from models.webhook_deliveries import WebhookDelivery
from workers.celery_app import celery_app

logger = logging.getLogger(__name__)

_RETRY_DELAYS = [60, 120, 240, 480]  # seconds between attempts 1-2, 2-3, 3-4, 4-5


@celery_app.task(bind=True, name="services.webhook.dispatch_webhook", max_retries=4)
def dispatch_webhook(self, verification_id: str) -> None:
    logger.info(f"[WEBHOOK] Starting dispatch for verification_id={verification_id}, attempt={self.request.retries + 1}")
    # Dispose connection pool so new loop gets fresh connections (avoids
    # "Future attached to a different loop" from the pipeline's loop)
    try:
        from models.database import engine
        engine.sync_engine.dispose()
    except Exception:
        pass
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_dispatch(self, verification_id))
    except Exception as e:
        logger.error(f"[WEBHOOK] Dispatch failed: {e}", exc_info=True)
        raise
    finally:
        loop.close()


async def _dispatch(task, verification_id: str) -> None:
    logger.info(f"[WEBHOOK] Fetching verification {verification_id}")
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Verification).where(Verification.id == verification_id)
        )
        ver = result.scalar_one_or_none()
        if not ver:
            logger.warning(f"[WEBHOOK] Verification {verification_id} not found")
            return

        result = await session.execute(
            select(User).where(User.id == ver.user_id)
        )
        op = result.scalar_one_or_none()
        if not op or not op.webhook_url:
            logger.info(f"[WEBHOOK] No webhook URL configured for user {ver.user_id}")
            return

        payload = {
            "event": "verification.completed",
            "verification_id": ver.id,
            "reference_id": ver.reference_id,
            "status": ver.status,
            "score": ver.score,
            "decision": ver.decision,
            "extracted_fields": ver.extracted_fields,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        body = json.dumps(payload, separators=(",", ":"))
        signature = hmac.new(
            (op.webhook_secret or "").encode(),
            body.encode(),
            hashlib.sha256,
        ).hexdigest()

        attempt_number = task.request.retries + 1
        logger.info(f"[WEBHOOK] Sending to {op.webhook_url} (attempt {attempt_number})")
        delivery = WebhookDelivery(
            id=str(uuid.uuid4()),
            verification_id=ver.id,
            user_id=op.id,
            url=op.webhook_url,
            payload=payload,
            attempt=attempt_number,
        )

        try:
            async with httpx.AsyncClient(timeout=settings.webhook_timeout_seconds) as client:
                resp = await client.post(
                    op.webhook_url,
                    content=body,
                    headers={
                        "Content-Type": "application/json",
                        "X-KYC-Signature": f"sha256={signature}",
                        "X-KYC-Event": "verification.completed",
                    },
                )
            delivery.status_code = resp.status_code
            logger.info(f"[WEBHOOK] Response: HTTP {resp.status_code}")
            if resp.is_success:
                delivery.delivered_at = datetime.now(timezone.utc)
                logger.info(f"[WEBHOOK] Success!")

        except Exception as exc:
            logger.error(f"[WEBHOOK] Request failed: {exc}", exc_info=True)
            session.add(delivery)
            await session.commit()
            countdown = _RETRY_DELAYS[min(task.request.retries, len(_RETRY_DELAYS) - 1)]
            logger.info(f"[WEBHOOK] Retrying in {countdown}s")
            raise task.retry(exc=exc, countdown=countdown)

        session.add(delivery)
        await session.commit()

        if not resp.is_success:
            countdown = _RETRY_DELAYS[min(task.request.retries, len(_RETRY_DELAYS) - 1)]
            logger.warning(f"[WEBHOOK] Failed with HTTP {resp.status_code}, retrying in {countdown}s")
            raise task.retry(
                exc=Exception(f"Webhook returned HTTP {resp.status_code}"),
                countdown=countdown,
            )
