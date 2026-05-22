# KYC Platform — Implementation Plan

## Build Strategy

Thin slice first: `national_id` happy path (upload → mock ML → result) before real ML workers.
Avoids blocking on 1 GB model downloads while testing plumbing.

---

## Phase 1 — Project Scaffold

| # | Task | Files |
|---|------|-------|
| 1 | Create monorepo dirs | `backend/`, `frontend/`, `shared/` |
| 2 | Shared Python enums | `shared/types.py` |
| 3 | Backend deps + env template | `backend/requirements.txt`, `backend/.env.example` |
| 4 | Frontend init (Next.js 15, shadcn/ui, Tailwind, TanStack Query) | `frontend/` |

---

## Phase 2 — Backend Core (DB + Auth)

| # | Task | Files |
|---|------|-------|
| 5 | SQLAlchemy async engine + session factory | `backend/models/database.py` |
| 6 | ORM models | `backend/models/verification.py`, `document.py`, `audit.py`, `operators.py` |
| 7 | Alembic setup + initial migration | `backend/migrations/` |
| 8 | Auth helpers: API key hash/verify, JWT issue/verify | `backend/services/auth.py` |
| 9 | Operator seed script | `backend/scripts/create_operator.py` |

---

## Phase 3 — Storage Service

| # | Task | Files |
|---|------|-------|
| 10 | Local disk backend (save / get_url / delete) | `backend/services/storage.py` |
| 11 | S3 backend (same interface, `STORAGE_BACKEND` env switch) | `backend/services/storage.py` |

---

## Phase 4 — API Layer

| # | Task | Files |
|---|------|-------|
| 12 | FastAPI app: CORS, lifespan, router registration | `backend/main.py` |
| 13 | Verification routes | `backend/api/verifications.py` |
|    | `POST /v1/verify` — create session | |
|    | `POST /v1/verify/{id}/upload` — multipart file save | |
|    | `POST /v1/verify/{id}/submit` — trigger Celery chain (idempotent) | |
|    | `GET  /v1/verify/{id}/status` — poll result | |
|    | `GET  /v1/verify/{id}/stream` — SSE progress | |
| 14 | Admin routes | `backend/api/admin.py` |
|    | `GET  /admin/queue` — review queue | |
|    | `PATCH /admin/verify/{id}/decision` — manual decision | |
| 15 | Pydantic schemas | `backend/schemas/verification.py`, `backend/schemas/document.py` |
| 16 | Rate limiting middleware (Redis sliding window, 100 req/min) | `backend/middleware/rate_limit.py` |

---

## Phase 5 — Celery Worker Infrastructure

| # | Task | Files |
|---|------|-------|
| 17 | Celery instance + Redis broker config | `backend/workers/celery_app.py` |
| 18 | Pipeline orchestrator: Celery chain 4a→4b→4c→4d→4e, writes `checks` JSONB, hard error → `error` status | `backend/workers/pipeline.py` |

---

## Phase 6 — ML Workers

| # | Task | Files | Notes |
|---|------|-------|-------|
| 19 | Document auth | `backend/workers/doc_auth.py` | OpenCV: EXIF check, Canny edge, color histogram, resolution, template match |
| 20 | OCR + field extraction | `backend/workers/ocr.py` | EasyOCR + passporteye; per-doc routing; MRZ checksum; VIZ cross-check |
| 21 | Face matching | `backend/workers/face_match.py` | DeepFace ArcFace; detect → embed → cosine distance; 3-tier threshold (0.40 / 0.55) |
| 22 | Liveness detection | `backend/workers/liveness.py` | MediaPipe Face Mesh; depth variance + EAR + texture (passive only) |
| 23 | Risk scoring | `backend/services/scoring.py` | Weighted 0–100; auto-approve ≥75 / auto-reject ≤35 / review between |
| 24 | Model pre-warm script | `backend/scripts/download_models.py` | Run once after `pip install`; prevents first-request stalls |

### ML weight table

| Check | Weight | Library |
|-------|--------|---------|
| doc_authentic | 30 | opencv-python + Pillow |
| mrz_valid | 20 | passporteye |
| face_match | 25 | deepface (ArcFace) |
| liveness | 15 | mediapipe |
| ocr_confidence | 10 | easyocr |

---

## Phase 7 — Webhooks

| # | Task | Files |
|---|------|-------|
| 25 | Outbound dispatch: HMAC-SHA256 sign, httpx async POST, exponential backoff (5 attempts, max 1h) | `backend/services/webhook.py` |
| 26 | Delivery log + manual retry endpoint | `backend/api/webhooks.py` |

---

## Phase 8 — Frontend Capture Flow

| # | Task | Files |
|---|------|-------|
| 27 | Shared TS types | `frontend/lib/verification.ts` |
| 28 | Typed API fetch wrappers | `frontend/lib/api.ts` |
| 29 | Step 1: Document type selector | `frontend/app/verify/page.tsx` |
| 30 | Steps 2–3: Document capture (react-webcam + Canvas: blur, resolution, compress) | `frontend/components/capture/DocumentCapture.tsx` |
| 31 | Step 4: Selfie capture (oval overlay + liveness instruction) | `frontend/components/capture/SelfieCapture.tsx` |
| 32 | Step 5: Review screen (thumbnails + retake) | `frontend/components/capture/ReviewScreen.tsx` |
| 33 | Step 6: Processing screen (SSE listener, animated step progress) | `frontend/components/capture/ProcessingScreen.tsx` |
| 34 | Step 7: Result screen (approved / review / rejected / error) | `frontend/components/capture/ResultScreen.tsx` |

### Client-side quality checks (Canvas, before upload)

- Min resolution: 640×480
- Blur: Laplacian variance > 100
- File size: compress to < 1.5 MB JPEG @ 0.85 quality

---

## Phase 9 — Operator Dashboard

| # | Task | Files |
|---|------|-------|
| 35 | JWT-gated dashboard layout | `frontend/app/dashboard/layout.tsx` |
| 36 | Review queue page (filter status=review) | `frontend/app/dashboard/page.tsx` |
| 37 | Verification detail: images (presigned URLs), extracted fields, check breakdown, manual approve/reject | `frontend/app/dashboard/verify/[id]/page.tsx` |

---

## Phase 10 — Security Hardening + Tests

| # | Task | Files |
|---|------|-------|
| 38 | Fernet encryption for PII `extracted_fields` before DB write | `backend/services/encryption.py` |
| 39 | API integration tests + pipeline unit tests (mocked ML) | `backend/tests/` |
| 40 | Retention job: purge S3 objects older than 90 days | `backend/workers/retention.py` |

---

## Deferred (post-MVP)

- iframe embed + cross-origin `postMessage` result relay
- Active liveness challenge (blink detection, requires video frames)
- Operator self-registration UI (currently CLI seed only)
- Multi-tenant webhook secret rotation UI

---

## Key constraints (from CLAUDE.md)

- All ML calls → Celery tasks only, never in FastAPI route handlers
- CORS: `http://localhost:3000` only in dev, never `*`
- Celery on Windows: always `--pool=solo`
- Storage: always via `services/storage.py`, never raw `boto3` or `open()`
- API keys: SHA-256 + salt hash only, never logged
- Audit log: append-only, no UPDATE/DELETE on `audit_events`
- CIN regex: `^[A-Z]{1,2}\d{5,6}$`
- Face match thresholds: < 0.40 match, 0.40–0.55 low confidence, > 0.55 no match
