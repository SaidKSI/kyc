import sys
import os

# Ensure backend/ is on path when worker is launched
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from celery import Celery
from core.config import settings

celery_app = Celery(
    "kyc",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["workers.pipeline", "services.webhook"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    # Prevent task result expiry confusion
    result_expires=3600,
)
