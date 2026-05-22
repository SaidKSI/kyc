# Verification Flow

End-to-end walkthrough from opening the URL to receiving a result.

---

## 1. Setup (Browser)

User opens `localhost:3000/verify`, enters API key → frontend stores it in React state.

---

## 2. Session Creation (Browser → API)

User picks document type → frontend calls:

```
POST /v1/verify  { document_type, reference_id }
→ 201  { verification_id: "ver_308066..." }
```

Backend creates a `verifications` row with `status=pending` and records an audit event.

---

## 3. Image Capture (Browser only)

For each image (front, back, selfie):

- Webcam captures frame → canvas runs blur check + resolution check
- Passes → compressed to JPEG ≤ 1.5 MB
- User confirms → image held in React state as a `File`

---

## 4. Upload (Browser → API → Disk)

On "Submit", frontend uploads each file:

```
POST /v1/verify/ver_.../upload  (multipart, slot=doc_front)
POST /v1/verify/ver_.../upload  (slot=doc_back)
POST /v1/verify/ver_.../upload  (slot=selfie)
```

Backend saves files to `C:/kyc-uploads/ver_.../` and records the storage key on the verification row.

---

## 5. Pipeline Trigger (Browser → API → Celery)

```
POST /v1/verify/ver_.../submit
→ 202  { status: "processing" }
```

Backend sets `status=processing`, pushes a task to the **Redis** queue, and returns immediately.

---

## 6. ML Pipeline (Celery worker — async, ~8–15s warm / ~60s cold first run)

Worker picks up the task and runs 5 steps in order. Each step writes its result to the `checks` JSONB column and commits. If a step fails, it writes `{ error, skipped: true }` and continues.

| Step | What it does | Output |
|------|-------------|--------|
| **doc_auth** | OpenCV edge/color/EXIF checks | `authentic`, `confidence`, `flags` |
| **ocr** | EasyOCR extracts text; passporteye reads MRZ | `extracted_fields`, `mrz_valid` |
| **face_match** | DeepFace ArcFace cosine distance: ID photo vs selfie | `match`, `distance`, `confidence` |
| **liveness** | MediaPipe face mesh: z-variance + EAR + texture | `live`, `confidence` |
| **scoring** | Weighted 0–100 score → decision | `score`, `decision` |

### Scoring weights

| Check | Weight |
|-------|--------|
| doc_auth | 30 |
| mrz_valid | 20 |
| face_match | 25 |
| liveness | 15 |
| ocr_confidence | 10 |

### Decision thresholds

| Score | Decision |
|-------|----------|
| ≥ 75 | `approved` |
| ≤ 35 | `rejected` |
| between | `review` (manual queue) |

---

## 7. Status Polling (Browser → API, every 2s)

```
GET /v1/verify/ver_.../status  (repeated until terminal status)
```

Frontend polls until `status` leaves `processing`. An SSE stream (`/stream`) also pushes step-completion events in real time so the UI can light up each step as it finishes.

---

## 8. Result (Browser)

Final status response contains `score`, `decision`, and `extracted_fields` → frontend renders the result screen.

| Status | Screen |
|--------|--------|
| `approved` | Green — extracted name shown |
| `review` | Amber — "we'll be in touch" |
| `rejected` | Red — generic rejection reason |
| `error` | Neutral — retry option |

---

## Performance note

First run is slow (~60s) because ML models load cold from disk:

- EasyOCR: ~1 GB models
- DeepFace ArcFace: TensorFlow weights

Pre-warm once to avoid this on every restart:

```bash
cd backend
python scripts/download_models.py
```

Subsequent verifications complete in **8–15 seconds**.
