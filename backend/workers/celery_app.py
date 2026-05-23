import logging
import os
import sys

# Ensure backend/ is on path when worker is launched
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load .env before any app imports so os.environ is populated for all workers
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from celery import Celery
from celery.signals import after_setup_logger, after_setup_task_logger, worker_process_init
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
    result_expires=3600,
    # Let Celery manage root logger so all app loggers inherit its handlers/level
    worker_hijack_root_logger=True,
    worker_redirect_stdouts=True,
    worker_redirect_stdouts_level="INFO",
)


@after_setup_logger.connect
@after_setup_task_logger.connect
def propagate_app_loggers(logger, loglevel, *args, **kwargs):
    """
    After Celery configures its logger, set the same level on all
    app package loggers so they propagate to Celery's handlers.
    """
    level = loglevel if isinstance(loglevel, int) else logging.getLevelName(loglevel)
    for name in ("workers", "services", "models", "api", "core"):
        logging.getLogger(name).setLevel(level)
    # Also set root so nothing is silently dropped
    logging.getLogger().setLevel(level)


@worker_process_init.connect
def dispose_engine_pool(**kwargs):
    """
    Each Celery worker process gets a fresh event loop.
    Dispose the SQLAlchemy async engine pool so it doesn't
    carry connections from a previous loop — prevents the
    'Future attached to a different loop' RuntimeError.
    """
    try:
        from models.database import engine
        engine.sync_engine.dispose()
    except Exception:
        pass
