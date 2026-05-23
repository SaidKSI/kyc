"""
OCR and field extraction using EasyOCR + passporteye.
Returns: {"extracted_fields": {...}, "mrz_valid": bool|None, "ocr_confidence": float}
"""
import io
import re

import cv2
import numpy as np
from PIL import Image

# CIN regex: 1-2 letters + 5-6 digits  e.g. AB123456
_CIN_RE = re.compile(r"^[A-Z]{1,2}\d{5,6}$")

# Singleton — EasyOCR is expensive to initialise (~1 GB models on first load)
_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(["ar", "en"], gpu=False)
    return _reader


def _decode(image_bytes: bytes):
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image")
    return img


def _run_easyocr(img) -> tuple[list[str], float]:
    results = _get_reader().readtext(img)
    texts = [text for _, text, _ in results]
    confs = [conf for _, _, conf in results]
    avg_conf = sum(confs) / len(confs) if confs else 0.0
    return texts, avg_conf


def _extract_mrz(image_bytes: bytes) -> tuple[dict, bool]:
    try:
        from passporteye import read_mrz
        pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        buf.seek(0)
        mrz = read_mrz(buf)
        if not mrz:
            return {}, False
        data = mrz.to_dict()
        fields = {
            "surname":       data.get("surname"),
            "given_names":   data.get("names"),
            "doc_number":    data.get("number"),
            "nationality":   data.get("nationality"),
            "date_of_birth": data.get("date_of_birth"),
            "expiry_date":   data.get("expiration_date"),
            "sex":           data.get("sex"),
        }
        return fields, bool(mrz.valid)
    except Exception:
        return {}, False


def run_ocr(image_bytes: bytes, document_type: str, locale: str = "en") -> dict:
    img = _decode(image_bytes)
    texts, avg_conf = _run_easyocr(img)
    upper_texts = [t.strip().upper().replace(" ", "") for t in texts]

    mrz_valid = None
    extracted: dict = {}

    if document_type == "passport":
        extracted, mrz_valid = _extract_mrz(image_bytes)

    elif document_type == "national_id":
        cin = next((t for t in upper_texts if _CIN_RE.match(t)), None)
        long_texts = [t for t in texts if len(t) > 4]
        extracted = {
            "cin_number":      cin,
            "full_name_latin": long_texts[0] if long_texts else None,
            "full_name_arabic": long_texts[1] if len(long_texts) > 1 else None,
        }

    elif document_type == "residence_permit":
        extracted, mrz_valid = _extract_mrz(image_bytes)
        if not extracted:
            long_texts = [t for t in texts if len(t) > 4]
            extracted = {"full_name": long_texts[0] if long_texts else None}

    elif document_type == "drivers_license":
        long_texts = [t for t in texts if len(t) > 4]
        extracted = {
            "full_name":     long_texts[0] if long_texts else None,
            "license_number": None,
        }

    return {
        "extracted_fields": extracted,
        "mrz_valid": mrz_valid,
        "ocr_confidence": round(avg_conf, 3),
    }
