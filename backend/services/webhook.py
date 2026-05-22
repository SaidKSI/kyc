"""
Outbound webhook dispatch — Celery task with exponential backoff retry.
Called by the pipeline after a terminal status is written.

Retry policy: 5 attempts total, delays: 60s → 120s → 240s → 480s
"""
import asyncio
import hashlib
import hmac
import json
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

_RETRY_DELAYS = [60, 120, 240, 480]  # seconds between attempts 1-2, 2-3, 3-4, 4-5


@celery_app.task(bind=True, name="services.webhook.dispatch_webhook", max_retries=4)
def dispatch_webhook(self, verification_id: str) -> None:
    asyncio.run(_dispatch(self, verification_id))


async def _dispatch(task, verification_id: str) -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Verification).where(Verification.id == verification_id)
        )
        ver = result.scalar_one_or_none()
        if not ver:
            return

        result = await session.execute(
            select(User).where(User.id == ver.user_id)
        )
        op = result.scalar_one_or_none()
        if not op or not op.webhook_url:
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
            if resp.is_success:
                delivery.delivered_at = datetime.now(timezone.utc)

        except Exception as exc:
            session.add(delivery)
            await session.commit()
            countdown = _RETRY_DELAYS[min(task.request.retries, len(_RETRY_DELAYS) - 1)]
            raise task.retry(exc=exc, countdown=countdown)

        session.add(delivery)
        await session.commit()

        if not resp.is_success:
            countdown = _RETRY_DELAYS[min(task.request.retries, len(_RETRY_DELAYS) - 1)]
            raise task.retry(
                exc=Exception(f"Webhook returned HTTP {resp.status_code}"),
                countdown=countdown,
            )
