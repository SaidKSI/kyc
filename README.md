# KYC Verification Platform

Self-hosted identity verification platform for MENA-region businesses. Similar to Persona or Onfido — integrate via API or iframe to verify users against government-issued documents with face matching and liveness detection.

## What it does

1. User submits a photo of their ID document (Moroccan CIN, passport, residence permit, or driver's license) + a selfie
2. ML pipeline extracts and validates document fields, checks authenticity, matches the face, and detects liveness
3. Platform returns a risk score and a pass/fail/review decision
4. Operators review flagged cases in the dashboard; webhooks notify their system on completion

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, TypeScript, shadcn/ui, TanStack Query, SSE |
| Backend | FastAPI, SQLAlchemy 2.0 async, Alembic, Celery 5 |
| ML | EasyOCR (Arabic/French/Latin), DeepFace ArcFace, MediaPipe, OpenCV, passporteye |
| LLM | OpenAI GPT-4o-mini (OCR assist + fraud analysis) |
| Infra | PostgreSQL, Redis, S3-compatible storage |

## Monorepo layout

```
frontend/    Next.js app (capture flow + operator dashboard)
backend/     FastAPI API + Celery ML workers
shared/      Python enums shared between API and workers
```

## Local development

### Prerequisites

- Laragon (PostgreSQL on port 5432)
- Redis running on port 6379
- Python 3.11+
- Node.js 20+

### Setup

```bash
# 1. Create DB in Laragon → HeidiSQL → create database 'kyc_platform'

# 2. Create upload directory
mkdir C:\kyc-uploads

# 3. Backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # edit DATABASE_URL, FERNET_KEY, OPENAI_API_KEY
alembic upgrade head

# 4. Frontend
cd frontend
npm install
cp .env.example .env.local
```

### Run (4 terminals)

```bash
# API
cd backend && .venv\Scripts\activate
uvicorn main:app --reload --port 8000

# Celery worker (--pool=solo required on Windows)
cd backend && .venv\Scripts\activate
celery -A workers.celery_app worker --loglevel=info --concurrency=2 --pool=solo

# Frontend
cd frontend
npm run dev

# (Optional) Celery Flower — task monitor at http://localhost:5555
cd backend && .venv\Scripts\activate
celery -A workers.celery_app flower --port=5555
```

Frontend: http://localhost:3000  
API docs: http://localhost:8000/docs  

## Production deployment

See [DEPLOY.md](DEPLOY.md) — Docker Compose + aaPanel reverse proxy + Let's Encrypt SSL.

## Verification pipeline

```
Document upload
    └── Doc authenticity check   (OpenCV edge/copy-move/metadata analysis)
    └── OCR + field extraction   (EasyOCR + passporteye MRZ validation)
    └── Face match               (DeepFace ArcFace, cosine distance < 0.40)
    └── Liveness detection       (MediaPipe Face Mesh depth variance)
    └── Risk scoring             (weighted 0–100 score → approved/review/rejected)
```

## API quick reference

```
POST   /v1/verify                          Create verification session
POST   /v1/verify/{id}/upload              Upload document images
POST   /v1/verify/{id}/submit              Trigger ML pipeline
GET    /v1/verify/{id}/status              Poll result
GET    /v1/verify/{id}/stream              SSE real-time progress
GET    /admin/queue                        Operator review queue
PATCH  /admin/verify/{id}/decision        Manual override
GET    /health                             Health check
```

Auth: `X-API-Key` header for operator routes, Bearer JWT for dashboard.

## Security notes

- PII fields encrypted at rest with Fernet before DB write
- API keys stored as SHA-256 hashes, never logged
- Webhook payloads signed with HMAC-SHA256
- Document images purged after configurable retention period (default 90 days)
- All ports bind to `127.0.0.1` in production; aaPanel Nginx is the only public entry point

## First-run ML model pre-download

EasyOCR and DeepFace download ~1.5 GB of model weights on first use. Pre-warm before accepting traffic:

```bash
# Local dev
python -c "import easyocr; easyocr.Reader(['ar', 'fr', 'en'])"
python -c "from deepface import DeepFace; DeepFace.build_model('ArcFace')"

# Docker
docker compose exec celery python -c "import easyocr; easyocr.Reader(['ar', 'fr', 'en'])"
docker compose exec celery python -c "from deepface import DeepFace; DeepFace.build_model('ArcFace')"
```


DATABASE CONTAINER 
ssh -i $HOME\.ssh\id_ed25519 -L 8080:127.0.0.1:8080 root@185.197.250.146
Server/Host: 127.0.0.1 or localhost
Port: 5432
Username: kyc
Password: LKatTzr8ibaDcjLs
Database: kyc_platform

created caarent@kyc.com (role=user)
    API Key : kyc_Cmp0lDQ-J0DdeWt3_YFdGj7j2Gi4ao3CgzUeE4G-dM0
    Password: password123
  created admin@kyc.com (role=admin)
    API Key : kyc_nFVDkEcaN0yH44UJwgfUj9iHZaev-fukiP85YEB-9jY
    Password: password123
