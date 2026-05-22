from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from api.admin import router as admin_router
from api.auth import router as auth_router
from api.session import router as session_router
from api.verifications import router as verifications_router
from core.config import settings
from middleware.rate_limit import RateLimitMiddleware
from models.database import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.connect():
        pass
    yield
    await engine.dispose()


app = FastAPI(
    title="KYC Verification API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS — frontend origin only, never *
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RateLimitMiddleware)

# Routers
app.include_router(verifications_router)
app.include_router(session_router)
app.include_router(auth_router)
app.include_router(admin_router)

# Local dev — serve uploaded documents at /uploads
if settings.storage_backend == "local":
    upload_path = Path(settings.upload_dir)
    upload_path.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(upload_path)), name="uploads")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "type": "https://kyc.example/errors/internal",
            "title": "Internal Server Error",
            "status": 500,
            "detail": "An unexpected error occurred.",
            "instance": str(request.url),
        },
    )


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "version": "0.1.0"}
