# CLAUDE.md — KYC Verification Platform

## App overview

A self-hosted identity verification platform similar to Persona or Onfido. Businesses
integrate via API or iframe to verify their users' identities using government-issued
documents (national ID, passport, residence permit, driver's license) combined with a
selfie/liveness check. The platform extracts structured data from documents, checks
authenticity, matches the face to the ID photo, and produces a risk score with a
pass/fail decision. Operators can review flagged cases in a built-in dashboard.

Target market: MENA-region SaaS companies, fintechs, and marketplaces that need
KYC compliance. Primary document set: Moroccan CIN, Moroccan passport, residence
permit (carte de séjour), international passports with MRZ.

---

## Monorepo structure

```
kyc-platform/
├── CLAUDE.md                  ← this file
├── frontend/                  ← Next.js 15 (App Router)
│   ├── app/
│   │   ├── verify/            ← public-facing capture flow (embedded or standalone)
│   │   └── dashboard/         ← operator review dashboard
│   ├── components/
│   │   ├── capture/           ← camera, upload, review steps
│   │   └── ui/                ← shadcn/ui components
│   └── lib/
│       ├── api.ts             ← typed fetch wrappers for backend
│       └── verification.ts    ← shared types (VerificationStatus, DocumentType, etc.)
├── backend/                   ← FastAPI (Python 3.11+)
│   ├── main.py                ← FastAPI app, router registration, CORS, lifespan
│   ├── api/
│   │   ├── verifications.py   ← POST /verify, GET /verify/{id}, GET /verify/{id}/status
│   │   ├── webhooks.py        ← POST /webhooks (outbound delivery log + retry)
│   │   └── admin.py           ← GET /admin/queue, PATCH /admin/verify/{id}/decision
│   ├── workers/
│   │   ├── celery_app.py      ← Celery instance + Redis broker config
│   │   ├── pipeline.py        ← main orchestration task: runs all checks, writes result
│   │   ├── ocr.py             ← EasyOCR + MRZ extraction task
│   │   ├── doc_auth.py        ← OpenCV document authenticity task
│   │   ├── face_match.py      ← DeepFace face comparison task
│   │   └── liveness.py        ← MediaPipe liveness detection task
│   ├── models/
│   │   ├── database.py        ← SQLAlchemy engine + session factory
│   │   ├── verification.py    ← Verification ORM model
│   │   ├── document.py        ← Document ORM model (extracted fields)
│   │   └── audit.py           ← AuditEvent ORM model
│   ├── schemas/
│   │   ├── verification.py    ← Pydantic request/response schemas
│   │   └── document.py        ← Pydantic extracted-data schemas
│   ├── services/
│   │   ├── storage.py         ← S3/MinIO upload, presigned URL generation
│   │   ├── scoring.py         ← weighted risk score calculator
│   │   └── webhook.py         ← outbound webhook dispatch with retry
│   ├── migrations/            ← Alembic migrations
│   └── tests/
└── shared/
    └── types.py               ← Python enums shared between API and workers
```

---

## Tech stack

### Frontend
| Concern | Choice |
|---|---|
| Framework | Next.js 15, App Router, TypeScript |
| UI components | shadcn/ui + Tailwind CSS |
| Camera capture | `react-webcam` |
| Image pre-processing | HTML5 Canvas (blur check, crop, compress before upload) |
| State + server sync | TanStack Query v5 |
| Status updates | Server-Sent Events (SSE) from FastAPI |
| File upload | Direct-to-S3 via presigned URL (never proxied through API) |

### Backend
| Concern | Choice |
|---|---|
| Framework | FastAPI (Python 3.11+) |
| Validation | Pydantic v2 |
| ORM | SQLAlchemy 2.0 (async) + Alembic |
| Task queue | Celery 5 with Redis broker |
| Auth | API keys (hashed, stored in DB) + JWT for dashboard sessions |
| File storage | Local disk (dev) → S3-compatible in production |
| HTTP client | `httpx` (async) for outbound webhooks |

### ML / computer vision
| Check | Library | Notes |
|---|---|---|
| OCR | `easyocr` | Arabic + French + Latin; fine-tuned on Moroccan CIN layout |
| MRZ parsing | `passporteye` | Validates checksums on TD1/TD2/TD3 zones |
| Document authenticity | `opencv-python` + `Pillow` | Edge analysis, copy-move detection, metadata check |
| Face matching | `deepface` (ArcFace backend) | Returns cosine distance; threshold < 0.40 = match |
| Liveness | `mediapipe` Face Mesh | Passive: detects flat photo vs. live face via depth cues |

### Local infrastructure (no Docker)

| Service | How it runs |
|---|---|
| PostgreSQL | Laragon — running on `localhost:5432` |
| Redis | Windows service or `redis-server` — running on `localhost:6379` |
| File storage | Local disk in dev (`UPLOAD_DIR`), swap to S3 in production |

---

## Environment variables

```bash
# backend/.env

# PostgreSQL via Laragon (default Laragon credentials)
DATABASE_URL=postgresql+asyncpg://root:@localhost:5432/kyc_platform
# Note: Laragon's default PostgreSQL user is 'root' with no password.
# Create the database first: open Laragon → PostgreSQL → HeidiSQL → create DB 'kyc_platform'

# Redis (standalone, default port)
REDIS_URL=redis://localhost:6379/0

# Local file storage (dev) — absolute path to a folder outside the repo
# In production, swap STORAGE_BACKEND=s3 and fill S3_* vars instead
STORAGE_BACKEND=local
UPLOAD_DIR=C:/kyc-uploads        # Windows path; use /home/said/kyc-uploads on Linux

# S3 vars (ignored when STORAGE_BACKEND=local, required in production)
S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=kyc-documents
S3_REGION=eu-west-1

# Auth
JWT_SECRET=change-me-in-production
API_KEY_SALT=change-me-in-production

# Webhook
WEBHOOK_TIMEOUT_SECONDS=10

# Risk score thresholds
SCORE_APPROVE_THRESHOLD=75   # auto-approve above this
SCORE_REJECT_THRESHOLD=35    # auto-reject below this

# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Verification pipeline — detailed flow

### 1. Session initiation (client → API)

```
POST /v1/verify
Content-Type: application/json
X-API-Key: <operator_api_key>

{
  "reference_id": "user_abc123",   // operator's internal user ID
  "document_type": "national_id",  // national_id | passport | residence_permit | drivers_license
  "locale": "ar-MA"                // used to guide OCR language priority
}

→ 201 {
  "verification_id": "ver_xxxx",
  "upload_endpoint": "/v1/verify/ver_xxxx/upload",  // local dev: multipart POST
  "upload_urls": null,                               // populated only when STORAGE_BACKEND=s3
  "expires_at": "2025-01-01T12:05:00Z"
}
```

### 2. File upload (client → API → local disk)

In local dev (`STORAGE_BACKEND=local`), files are uploaded as multipart form data
to the FastAPI backend, which saves them to `UPLOAD_DIR/{verification_id}/`.
In production (`STORAGE_BACKEND=s3`), the API generates presigned S3 URLs and
the client uploads directly — never proxied through the API server.

The `services/storage.py` module abstracts both backends behind a common interface:
- `storage.save(verification_id, slot, file_bytes) → str`  (returns object key or path)
- `storage.get_url(key, expires=900) → str`                (presigned URL or local path)
- `storage.delete(key)`

Client-side quality checks before upload (run in browser Canvas):
- Minimum resolution: 640×480
- Blur detection: Laplacian variance > 100 (reject blurry captures)
- File size: compress to < 1.5 MB JPEG at 0.85 quality

### 3. Submission (client → API)

```
POST /verify/{verification_id}/submit

→ 202 {
  "verification_id": "ver_xxxx",
  "status": "processing",
  "estimated_seconds": 8
}
```

This triggers the Celery pipeline task. The API returns immediately.

### 4. ML pipeline (Celery workers — runs async)

All steps run as a **Celery chain** in this order. Each step writes its result
to the `checks` JSONB column on the Verification record. If any step raises a
hard error (corrupt file, unsupported format), the verification moves to `error`
status and the chain stops.

#### Step 4a — Document authentication (`workers/doc_auth.py`)

```python
checks performed:
- File metadata: EXIF GPS stripped, creation date plausibility check
- Edge integrity: Canny edge detection to detect cut-and-paste regions
- Color histogram: detect screenshot artifacts (over-saturated regions)
- Resolution sufficiency: reject < 640px on shortest side
- Supported document layout: template matching for known Moroccan doc formats

output: { "authentic": bool, "confidence": float, "flags": [str] }
```

#### Step 4b — OCR and field extraction (`workers/ocr.py`)

```python
document_type routing:
  national_id     → extract: full_name (Arabic + Latin), CIN number, DOB, 
                              expiry, place of birth, address
  passport        → extract MRZ (TD3): surname, given_names, doc_number, 
                              nationality, DOB, expiry, sex; validate all checksums
  residence_permit → extract: full_name, permit number, DOB, expiry, nationality
  drivers_license  → extract: full_name, license number, DOB, expiry, categories

MRZ validation:
  - Parse TD1/TD2/TD3 zones using passporteye
  - Validate all 7 checksums; flag any mismatch as tamper signal
  - Cross-check MRZ fields vs. VIZ (visual inspection zone) OCR fields

output: { "extracted_fields": {...}, "mrz_valid": bool, "ocr_confidence": float }
```

#### Step 4c — Face matching (`workers/face_match.py`)

```python
inputs: document_front image, selfie image
steps:
  1. Detect face in ID photo using RetinaFace detector (built into DeepFace)
  2. Detect face in selfie
  3. If either returns 0 faces: mark check as failed, flag "no_face_detected"
  4. If either returns > 1 face: use largest bounding box
  5. Compute ArcFace embedding for each face
  6. Calculate cosine distance
  7. distance < 0.40  → match (True)
     0.40–0.55        → low_confidence (needs manual review)
     > 0.55           → no_match (False)

output: { "match": bool, "distance": float, "confidence": "high"|"low"|"none" }
```

#### Step 4d — Liveness detection (`workers/liveness.py`)

```python
input: selfie image (or short video clip if provided)
steps (passive, single-frame):
  1. Run MediaPipe Face Mesh → 468 landmarks
  2. Compute face depth variance from landmark z-coordinates
     flat photo = low variance (< threshold), real face = higher variance
  3. Check eye aspect ratio (EAR) for naturalness
  4. Check texture variation in skin region (printed photos are smoother)

output: { "live": bool, "confidence": float, "method": "passive" }
```

#### Step 4e — Risk scoring (`services/scoring.py`)

```python
# Weighted score 0–100
weights = {
    "doc_authentic":   30,   # document not tampered
    "mrz_valid":       20,   # MRZ checksums pass
    "face_match":      25,   # selfie matches ID photo
    "liveness":        15,   # selfie is a live person
    "ocr_confidence":  10,   # fields extracted cleanly
}

# Each check contributes its weight × confidence (0.0–1.0)
# score >= SCORE_APPROVE_THRESHOLD  → status = "approved"
# score <= SCORE_REJECT_THRESHOLD   → status = "rejected"
# between thresholds                → status = "review" (manual queue)

output: { "score": int, "decision": "approved"|"rejected"|"review", "breakdown": {...} }
```

### 5. Status polling / SSE

```
GET /verify/{verification_id}/status

→ {
  "status": "approved" | "rejected" | "review" | "processing" | "error",
  "score": 82,
  "decision": "approved",
  "extracted_fields": { "full_name": "...", "doc_number": "...", ... },
  "completed_at": "2025-01-01T12:00:08Z"
}
```

SSE endpoint at `GET /verify/{verification_id}/stream` emits events on each
pipeline step completion so the frontend can show real-time progress.

### 6. Webhook delivery

When a verification reaches a terminal status (`approved`, `rejected`, `error`),
the platform POSTs to the operator's configured webhook URL:

```json
POST <operator_webhook_url>
X-KYC-Signature: sha256=<hmac>

{
  "event": "verification.completed",
  "verification_id": "ver_xxxx",
  "reference_id": "user_abc123",
  "status": "approved",
  "score": 82,
  "extracted_fields": { ... },
  "timestamp": "2025-01-01T12:00:09Z"
}
```

Retry policy: exponential backoff, 5 attempts, max delay 1 hour.
Signature: HMAC-SHA256 of the raw request body using operator's webhook secret.

---

## Database schema (key tables)

```sql
verifications
  id              uuid PK
  operator_id     uuid FK → operators
  reference_id    text                        -- operator's user ID
  document_type   text                        -- national_id | passport | ...
  status          text                        -- pending|processing|approved|rejected|review|error
  score           int
  decision        text
  checks          jsonb                       -- raw output from each ML step
  extracted_fields jsonb                      -- structured OCR output
  doc_front_key   text                        -- S3 object key
  doc_back_key    text
  selfie_key      text
  created_at      timestamptz
  completed_at    timestamptz

audit_events
  id              uuid PK
  verification_id uuid FK
  event_type      text                        -- submitted|check_complete|decision|webhook_sent
  actor           text                        -- system | operator | agent:{id}
  payload         jsonb
  created_at      timestamptz

operators
  id              uuid PK
  name            text
  api_key_hash    text
  webhook_url     text
  webhook_secret  text
  created_at      timestamptz
```

---

## API conventions

- All requests authenticated via `X-API-Key` header (operator routes) or Bearer JWT
  (dashboard routes)
- All timestamps: ISO 8601 UTC
- All IDs: UUID v4
- Errors follow RFC 9457 Problem Details:
  ```json
  { "type": "...", "title": "...", "status": 422, "detail": "...", "instance": "..." }
  ```
- Versioning: URL prefix `/v1/`
- Rate limiting: 100 req/min per API key (enforced via Redis sliding window)

---

## Security requirements

- In production: documents stored in S3 with server-side encryption (AES-256);
  bucket has no public access; access only via presigned URLs (15-min TTL)
- In local dev: documents stored in `UPLOAD_DIR` outside the repo root;
  never inside the Next.js `public/` folder or any web-accessible path
- PII fields in `extracted_fields` encrypted at rest using Fernet before DB write
- API keys stored as SHA-256 hashes; never logged
- All webhook payloads signed with HMAC-SHA256; operators must verify signature
- HTTPS enforced in production (TLS 1.2 minimum)
- Document images purged from S3 after configurable retention period (default: 90 days)
- Audit log is append-only; no UPDATE or DELETE on `audit_events`

---

## Frontend capture flow (UX steps)

```
Step 1 — Document type selection
  User picks: National ID / Passport / Residence permit / Driver's license

Step 2 — Document front capture
  Camera preview with overlay guide frame
  Client-side blur check before allowing "use this photo"
  Retry if quality fails

Step 3 — Document back capture (skipped for passports)
  Same quality checks

Step 4 — Selfie capture
  Oval face guide overlay
  Passive liveness cue: "blink once" instruction (optional active challenge)

Step 5 — Review screen
  User sees thumbnails of captured images
  Can retake any image

Step 6 — Processing screen
  SSE progress: Document check → OCR → Face match → Decision
  Animated steps, each lighting up as it completes

Step 7 — Result screen
  Approved: green, extracted name shown
  Review:   yellow, "we'll be in touch"
  Rejected: red, rejection reason (generic; never expose specific check details)
  Error:    retry option
```

---

## Local dev setup (no Docker)

### Prerequisites

- **Laragon** running with PostgreSQL active
- **Redis** running (`redis-server` or Windows service on port 6379)
- **Python 3.11+** (check: `python --version`)
- **Node.js 20+** (check: `node --version`)

### First-time setup

```bash
# 1. Create the database
#    Open Laragon → HeidiSQL → connect → right-click → Create new → Database
#    Name: kyc_platform  |  Collation: utf8mb4_unicode_ci

# 2. Create upload directory
mkdir C:\kyc-uploads        # Windows
# mkdir ~/kyc-uploads       # if on Linux/WSL

# 3. Backend
cd backend
python -m venv .venv

# Windows:
.venv\Scripts\activate
# Linux/WSL:
# source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env        # then edit DATABASE_URL and UPLOAD_DIR

alembic upgrade head        # runs migrations against Laragon PostgreSQL
```

### Daily dev (4 terminals)

```bash
# Terminal 1 — FastAPI
cd backend && .venv\Scripts\activate
uvicorn main:app --reload --port 8000

# Terminal 2 — Celery worker
cd backend && .venv\Scripts\activate
celery -A workers.celery_app worker --loglevel=info --concurrency=2 --pool=solo
# --pool=solo required on Windows (no fork support)

# Terminal 3 — Frontend
cd frontend
npm run dev                 # runs on http://localhost:3000

# Terminal 4 — (optional) Celery Flower — task monitor UI
cd backend && .venv\Scripts\activate
celery -A workers.celery_app flower --port=5555
# open http://localhost:5555
```

### Verify everything is connected

```bash
cd backend && python -c "
from models.database import engine
import asyncio, asyncpg
asyncio.run(engine.connect())   # should not raise
print('PostgreSQL OK')

import redis
r = redis.from_url('redis://localhost:6379/0')
r.ping()
print('Redis OK')
"
```

---

## Key implementation notes for Claude Code

- **Never store raw API keys** — hash with SHA-256 + salt on receipt, compare hashes
- **All ML calls are blocking CPU work** — always run inside Celery tasks, never in
  FastAPI route handlers directly
- **DeepFace downloads model weights on first use** — trigger pre-download once manually
  to avoid surprise delays: `python -c "from deepface import DeepFace; DeepFace.build_model('ArcFace')"`
- **EasyOCR Arabic support** — initialise with `easyocr.Reader(['ar', 'fr', 'en'])`
  to handle mixed-script Moroccan documents; first run downloads ~1 GB of models
- **Celery on Windows** — always start workers with `--pool=solo`; the default
  prefork pool requires `fork()` which Windows does not support
- **Storage abstraction** — always use `services/storage.py`, never call boto3 or
  `open()` directly in route handlers or tasks; this makes the local→S3 swap seamless
- **CORS** — frontend origin only (`http://localhost:3000` in dev); never `*`
- **Error handling** — wrap every ML step in try/except; a single bad image must not
  crash the whole pipeline; write `{ "error": "...", "skipped": true }` to the check
  result and continue with remaining checks
- **Idempotency** — `POST /v1/verify/{id}/submit` is idempotent; if called twice,
  return current status without re-queuing
- **Moroccan CIN specifics** — CIN number format: 1–2 letters + 5–6 digits (e.g. AB123456);
  validate with regex `^[A-Z]{1,2}\d{5,6}$` after OCR extraction
- **Laragon PostgreSQL port** — default is 5432 but some Laragon versions use 3306
  for MySQL and a different port for Postgres; confirm in Laragon settings before
  setting `DATABASE_URL`
