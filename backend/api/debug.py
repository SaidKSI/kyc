"""
Debug endpoints — only registered when ENVIRONMENT=development.
"""
import asyncio

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from workers.ocr import _decode, _run_easyocr, _extract_fields_with_llm

router = APIRouter(prefix="/v1/debug", tags=["debug"])

_ALLOWED_DOC_TYPES = {"national_id", "passport", "residence_permit", "drivers_license"}


def _preprocess(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    denoised = cv2.fastNlMeansDenoising(enhanced, h=10)
    return denoised


def _run(image_bytes: bytes, document_type: str, back_bytes: bytes | None = None) -> dict:
    from core.config import settings

    img = _decode(image_bytes)
    processed = _preprocess(img)
    results, avg_conf = _run_easyocr(processed)

    blocks = [
        {"text": text, "confidence": round(conf, 4)}
        for _, text, conf in results
        if text.strip()
    ]
    raw_text = "\n".join(b["text"] for b in blocks)

    # OCR back side if provided — appended to raw_text for LLM, also returned
    back_blocks = []
    if back_bytes:
        back_img = _decode(back_bytes)
        back_processed = _preprocess(back_img)
        back_results, _ = _run_easyocr(back_processed)
        back_blocks = [
            {"text": text, "confidence": round(conf, 4)}
            for _, text, conf in back_results
            if text.strip()
        ]
        raw_text += "\n--- BACK SIDE ---\n" + "\n".join(b["text"] for b in back_blocks)

    # Check API key before attempting LLM call
    api_key = settings.openai_api_key
    if not api_key or api_key == "sk-your-key-here":
        llm_error = "OPENAI_API_KEY not set — add it to backend/.env"
        extracted_fields = {}
    else:
        try:
            extracted_fields = _extract_fields_with_llm(raw_text, document_type)
            llm_error = None
        except Exception as exc:
            extracted_fields = {}
            llm_error = str(exc)

    return {
        "raw_text": raw_text,
        "blocks": blocks,
        "back_blocks": back_blocks,
        "avg_confidence": round(avg_conf, 4),
        "block_count": len(blocks),
        "extracted_fields": extracted_fields,
        "llm_error": llm_error,
    }


@router.post("/face-match")
async def debug_face_match(
    id_photo: UploadFile = File(...),
    selfie: UploadFile = File(...),
):
    """Run ArcFace face matching between ID photo and selfie. Dev only."""
    from workers.face_match import match_faces
    id_bytes      = await id_photo.read()
    selfie_bytes  = await selfie.read()
    try:
        result = await asyncio.to_thread(match_faces, id_bytes, selfie_bytes)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Face match failed: {exc}")
    return result


@router.post("/extract")
async def debug_extract(
    file: UploadFile = File(...),
    document_type: str = Form(...),
    back_file: UploadFile | None = File(None),
):
    """EasyOCR raw text + LLM structured fields. Dev only.
    For national_id pass back_file — CNIE MRZ is on the back side."""
    if document_type not in _ALLOWED_DOC_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown document_type '{document_type}'")
    image_bytes = await file.read()
    back_bytes  = await back_file.read() if back_file else None
    try:
        result = await asyncio.to_thread(_run, image_bytes, document_type, back_bytes)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"OCR failed: {exc}")
    return result
