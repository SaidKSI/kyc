# KYC Frontend

Next.js 15 app — public-facing document capture flow and operator review dashboard.

## Stack

- Next.js 15 App Router, TypeScript
- shadcn/ui + Tailwind CSS
- TanStack Query v5 — server state
- react-webcam — camera capture
- SSE — real-time pipeline progress

## Structure

```
app/
  verify/        Public capture flow (document + selfie upload)
  dashboard/     Operator review dashboard
components/
  capture/       Camera, upload, review step components
  ui/            shadcn/ui base components
lib/
  api.ts         Typed fetch wrappers for backend
  verification.ts  Shared types (VerificationStatus, DocumentType, etc.)
```

## Capture flow

```
Step 1  Document type selection
Step 2  Document front capture (blur check before accept)
Step 3  Document back capture (skipped for passports)
Step 4  Selfie capture (passive liveness cue)
Step 5  Review thumbnails — retake any image
Step 6  Processing — SSE progress: Doc → OCR → Face → Decision
Step 7  Result screen (approved / review / rejected / error)
```

## Setup

```bash
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL
npm run dev                  # http://localhost:3000
```

## Environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | FastAPI backend URL (e.g. `http://localhost:8000`) |
| `NEXT_PUBLIC_ALLOWED_DEV_ORIGINS` | Extra origins for `next.config.ts` dev allowlist (e.g. ngrok tunnel) |

## Build

```bash
npm run build    # outputs standalone bundle (next.config.ts: output: "standalone")
npm run start
```
