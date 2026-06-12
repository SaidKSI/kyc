# KYC Backend

FastAPI + Celery backend — REST API, async ML pipeline workers, webhook delivery.

## Stack

- FastAPI, Python 3.11+
- SQLAlchemy 2.0 async + Alembic migrations
- Celery 5 + Redis broker
- PostgreSQL (via asyncpg)
- EasyOCR, DeepFace, MediaPipe, OpenCV, passporteye
- OpenAI GPT-4o-mini (OCR assist + fraud analysis)

## Structure

```
main.py              FastAPI app, router registration, CORS, lifespan
api/
  verifications.py   POST /verify, GET /verify/{id}, GET /verify/{id}/status
  admin.py           GET /admin/queue, PATCH /admin/verify/{id}/decision
  auth.py            JWT login for dashboard
  user.py            User/operator management
  session.py         SSE stream endpoints
workers/
  celery_app.py      Celery instance + Redis config
  pipeline.py        Main orchestration task
  ocr.py             EasyOCR + MRZ extraction
  doc_auth.py        OpenCV document authenticity
  face_match.py      DeepFace ArcFace face comparison
  liveness.py        MediaPipe liveness detection
models/
  verification.py    Verification ORM model
  document.py        Document ORM model
  audit.py           AuditEvent ORM model (append-only)
  database.py        SQLAlchemy engine + session factory
schemas/
  verification.py    Pydantic request/response schemas
  document.py        Pydantic extracted-data schemas
services/
  storage.py         Local disk / S3 abstraction
  scoring.py         Weighted risk score calculator
  webhook.py         Outbound webhook dispatch + retry
core/
  config.py          Pydantic-settings config (reads .env)
migrations/          Alembic migrations
```

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/macOS

pip install -r requirements.txt
cp .env.example .env            # fill DATABASE_URL, FERNET_KEY, OPENAI_API_KEY
alembic upgrade head
```

## Run

```bash
# API server
uvicorn main:app --reload --port 8000

# Celery worker (--pool=solo required on Windows)
celery -A workers.celery_app worker --loglevel=info --concurrency=2 --pool=solo

# (Optional) Flower task monitor — http://localhost:5555
celery -A workers.celery_app flower --port=5555
```

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | asyncpg connection string |
| `REDIS_URL` | Redis broker URL |
| `STORAGE_BACKEND` | `local` or `s3` |
| `UPLOAD_DIR` | Local upload path (when `STORAGE_BACKEND=local`) |
| `S3_*` | S3/MinIO credentials (when `STORAGE_BACKEND=s3`) |
| `JWT_SECRET` | Dashboard JWT signing secret |
| `API_KEY_SALT` | Salt for operator API key hashing |
| `FERNET_KEY` | Fernet key for PII encryption at rest |
| `FRONTEND_ORIGIN` | CORS allowed origin |
| `OPENAI_API_KEY` | OpenAI key for LLM-assisted OCR and fraud analysis |
| `OPENAI_MODEL` | Model ID (default: `gpt-4o-mini`) |
| `SCORE_APPROVE_THRESHOLD` | Auto-approve above this score (default: 75) |
| `SCORE_REJECT_THRESHOLD` | Auto-reject below this score (default: 35) |
| `DOCUMENT_RETENTION_DAYS` | Days before document images are purged (default: 90) |
| `ENVIRONMENT` | `development` or `production` (controls /docs visibility) |

Generate secrets:
```bash
# JWT_SECRET / API_KEY_SALT
python -c "import secrets; print(secrets.token_hex(32))"

# FERNET_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

## ML pipeline

Runs as a Celery chain — each step writes to the `checks` JSONB column:

| Step | Worker | Output |
|---|---|---|
| Document auth | `doc_auth.py` | Edge/copy-move/metadata checks |
| OCR + MRZ | `ocr.py` | Extracted fields, MRZ checksum validation |
| Face match | `face_match.py` | ArcFace cosine distance, match bool |
| Liveness | `liveness.py` | MediaPipe depth variance, live bool |
| Risk score | `services/scoring.py` | 0–100 score → approved/review/rejected |

A hard error in any step writes `{ "error": "...", "skipped": true }` and continues remaining steps.

## First-run model pre-download

```bash
python -c "import easyocr; easyocr.Reader(['ar', 'fr', 'en'])"           # ~1 GB
python -c "from deepface import DeepFace; DeepFace.build_model('ArcFace')"  # ~500 MB
```

## API conventions

- Operator routes: `X-API-Key` header
- Dashboard routes: `Authorization: Bearer <jwt>`
- All timestamps: ISO 8601 UTC
- All IDs: UUID v4
- Errors: RFC 9457 Problem Details
- URL prefix: `/v1/`
- Rate limit: 100 req/min per API key (Redis sliding window)

## Migrations

```bash
# Apply
alembic upgrade head

# New migration
alembic revision --autogenerate -m "description"

# Rollback one step
alembic downgrade -1
```
