"""
OCR and field extraction using EasyOCR + OpenAI GPT.

Flow:
  1. EasyOCR      → dumps ALL raw text from document (Arabic + English)
  2. GPT-4o-mini  → parses raw text into structured fields per document type
  3. passporteye  → MRZ checksum validation
                    - passport / residence_permit: front image
                    - national_id (CNIE): back image (MRZ on back side)
  3b. MRZ fallback→ if passporteye fails, GPT-4o Vision reads MRZ directly from image
  4. VIZ↔MRZ      → cross-checks visual fields vs MRZ fields, flags mismatches
  5. Validation   → CIN regex, age ≥ 16, expiry > today
  6. Name check   → GPT verifies Arabic name ↔ Latin name are valid transliterations

Returns:
  {
    "extracted_fields": {...},
    "raw_text": str,
    "mrz_valid": bool | None,
    "mrz_source": "passporteye" | "llm_vision" | None,
    "mrz_fields": {...} | None,
    "viz_mrz_cross_check": {...},
    "arabic_latin_name_check": {...},
    "validation_flags": [str],
    "ocr_confidence": float,
  }
"""
import base64
import io
import json
import logging
import os
import re
from datetime import date, datetime

import cv2
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# CIN: 1–2 letters + 5–6 digits  e.g. AB123456
_CIN_RE = re.compile(r"^[A-Z]{1,2}\d{5,6}$")

# EasyOCR singleton — ~1 GB models on first load
_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(["ar", "en"], gpu=False)
    return _reader


def _get_openai():
    from openai import OpenAI
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key or api_key == "sk-your-key-here":
        raise ValueError("OPENAI_API_KEY not set")
    return OpenAI(api_key=api_key)


def _decode(image_bytes: bytes):
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image")
    return img


def _run_easyocr(img) -> tuple[list[tuple], float]:
    results = _get_reader().readtext(img)
    confs = [conf for _, _, conf in results]
    avg_conf = sum(confs) / len(confs) if confs else 0.0
    return results, avg_conf


def _extract_mrz(image_bytes: bytes) -> tuple[dict, bool]:
    """Parse MRZ via passporteye. Returns (fields_dict, checksums_valid)."""
    try:
        # passporteye uses np.asfarray removed in NumPy 2.0 — patch it back
        import numpy as _np
        if not hasattr(_np, "asfarray"):
            _np.asfarray = lambda a, dtype=float: _np.asarray(a, dtype=dtype)

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
            "date_of_birth": _normalise_mrz_date(data.get("date_of_birth")),
            "expiry_date":   _normalise_mrz_date(data.get("expiration_date")),
            "sex":           data.get("sex"),
        }
        return fields, bool(mrz.valid)
    except Exception as exc:
        logger.warning(f"[OCR] MRZ extraction failed: {exc}")
        return {}, False


def _extract_mrz_with_vision(image_bytes: bytes) -> tuple[dict, None]:
    """
    GPT-4o Vision fallback when passporteye fails.
    Returns (fields_dict, None) — None because GPT can't compute checksums.
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key == "sk-your-key-here":
        return {}, None

    try:
        client = _get_openai()
        b64 = base64.b64encode(image_bytes).decode("utf-8")

        prompt = """This is an identity document image. Find the MRZ (Machine Readable Zone) —
typically 2–3 lines of monospace text at the bottom containing letters, digits, and < characters.

Extract and parse the MRZ fields. Return ONLY valid JSON:
{
  "mrz_detected": true | false,
  "doc_number":    "<document/card number or null>",
  "date_of_birth": "<YYYY-MM-DD or null>",
  "expiry_date":   "<YYYY-MM-DD or null>",
  "surname":       "<surname from MRZ or null>",
  "given_names":   "<given names from MRZ or null>",
  "nationality":   "<3-letter ISO code or null>",
  "sex":           "<M or F or null>"
}

If no MRZ is visible, return {"mrz_detected": false} with all other fields null.
Convert YYMMDD dates to YYYY-MM-DD (years >30 → 19xx, ≤30 → 20xx)."""

        response = client.chat.completions.create(
            model="gpt-4o",          # vision required — do not downgrade
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{b64}",
                            "detail": "high",
                        },
                    },
                ],
            }],
            temperature=0,
            max_tokens=300,
            response_format={"type": "json_object"},
        )

        data = json.loads(response.choices[0].message.content)
        if not data.get("mrz_detected"):
            logger.warning("[OCR] MRZ vision fallback: no MRZ detected in image")
            return {}, None

        fields = {k: data.get(k) for k in (
            "doc_number", "date_of_birth", "expiry_date",
            "surname", "given_names", "nationality", "sex",
        )}
        logger.info(f"[OCR] MRZ vision fallback fields: {fields}")
        return {k: v for k, v in fields.items() if v is not None}, None

    except Exception as exc:
        logger.error(f"[OCR] MRZ vision fallback failed: {exc}", exc_info=True)
        return {}, None


def _check_arabic_latin_names(arabic: str | None, latin: str | None) -> dict:
    """
    GPT-4o-mini checks if Arabic and Latin names on a Moroccan ID
    are valid transliterations of each other.
    """
    if not arabic or not latin:
        return {"consistent": None, "skipped": True, "reason": "missing_name"}

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key == "sk-your-key-here":
        return {"consistent": None, "skipped": True, "reason": "no_api_key"}

    try:
        client = _get_openai()
        prompt = f"""On a Moroccan national ID card (CNIE), the holder's name appears in both Arabic and Latin script.
Verify whether these two names are valid transliterations of each other:

Arabic name : {arabic}
Latin name  : {latin}

Consider standard Moroccan Arabic-to-French transliteration conventions.
Return ONLY valid JSON:
{{
  "consistent": true | false,
  "confidence": <float 0.0–1.0>,
  "note": "<one sentence explanation>"
}}"""

        response = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=120,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content)
        logger.info(f"[OCR] Arabic↔Latin name check: {result}")
        return result

    except Exception as exc:
        logger.error(f"[OCR] Arabic↔Latin name check failed: {exc}", exc_info=True)
        return {"consistent": None, "skipped": True, "error": str(exc)}


def _normalise_mrz_date(value) -> str | None:
    """Convert passporteye date (YYMMDD str or datetime) to YYYY-MM-DD."""
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.strftime("%Y-%m-%d")
    s = str(value).strip()
    if len(s) == 6 and s.isdigit():
        yy, mm, dd = int(s[:2]), int(s[2:4]), int(s[4:6])
        # passporteye century heuristic: >30 → 19xx, ≤30 → 20xx
        yyyy = 1900 + yy if yy > 30 else 2000 + yy
        try:
            return date(yyyy, mm, dd).strftime("%Y-%m-%d")
        except ValueError:
            return None
    return s  # already normalised or unknown format


# ── VIZ ↔ MRZ cross-check ────────────────────────────────────────────────────

def _normalise_name(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"[^A-Z]", "", s.upper())


def _cross_check_viz_mrz(viz: dict, mrz: dict, document_type: str) -> dict:
    """
    Compare VIZ (GPT-extracted) fields against MRZ fields.
    Returns dict: field → "match" | "mismatch" | "not_checked"
    """
    results: dict[str, str] = {}

    def _check(viz_key: str, mrz_key: str, normalise=None):
        v = viz.get(viz_key)
        m = mrz.get(mrz_key)
        if v is None or m is None:
            results[viz_key] = "not_checked"
            return
        v_n = normalise(v) if normalise else str(v).strip().upper()
        m_n = normalise(m) if normalise else str(m).strip().upper()
        results[viz_key] = "match" if v_n == m_n else "mismatch"

    if document_type == "national_id":
        _check("cin_number",    "doc_number",    normalise=lambda x: x.strip().upper().replace(" ", ""))
        _check("date_of_birth", "date_of_birth")
        _check("expiry_date",   "expiry_date")
        # Name: compare Latin name to MRZ surname+given_names
        viz_name = _normalise_name(viz.get("full_name_latin"))
        mrz_name = _normalise_name((mrz.get("surname") or "") + (mrz.get("given_names") or ""))
        if viz_name and mrz_name:
            results["full_name_latin"] = "match" if viz_name == mrz_name else "mismatch"
        else:
            results["full_name_latin"] = "not_checked"

    elif document_type in ("passport", "residence_permit"):
        _check("date_of_birth", "date_of_birth")
        _check("expiry_date",   "expiry_date")
        _check("doc_number",    "doc_number")
        viz_name = _normalise_name(
            (viz.get("surname") or "") + (viz.get("given_names") or "")
        )
        mrz_name = _normalise_name(
            (mrz.get("surname") or "") + (mrz.get("given_names") or "")
        )
        if viz_name and mrz_name:
            results["full_name"] = "match" if viz_name == mrz_name else "mismatch"
        else:
            results["full_name"] = "not_checked"

    mismatches = [k for k, v in results.items() if v == "mismatch"]
    if mismatches:
        logger.warning(f"[OCR] VIZ↔MRZ mismatches: {mismatches}")

    return results


# ── Post-extraction field validation ─────────────────────────────────────────

def _validate_fields(extracted: dict, document_type: str) -> list[str]:
    """Rule-based validation after extraction. Returns list of flag strings."""
    flags: list[str] = []
    today = date.today()

    # CIN format (national_id only)
    if document_type == "national_id":
        cin = extracted.get("cin_number")
        if cin:
            cleaned = str(cin).strip().upper().replace(" ", "")
            if not _CIN_RE.match(cleaned):
                flags.append("invalid_cin_format")
        else:
            flags.append("cin_number_missing")

    # Date of birth — age 16–110
    dob_str = extracted.get("date_of_birth")
    if dob_str:
        try:
            dob = datetime.strptime(str(dob_str)[:10], "%Y-%m-%d").date()
            age_days = (today - dob).days
            if age_days < 16 * 365:
                flags.append("holder_under_16")
            elif age_days > 110 * 365:
                flags.append("dob_implausible")
        except ValueError:
            flags.append("invalid_dob_format")
    else:
        flags.append("dob_missing")

    # Expiry date — must be in future
    expiry_str = extracted.get("expiry_date")
    if expiry_str:
        try:
            expiry = datetime.strptime(str(expiry_str)[:10], "%Y-%m-%d").date()
            if expiry < today:
                flags.append("document_expired")
        except ValueError:
            flags.append("invalid_expiry_format")
    else:
        flags.append("expiry_date_missing")

    if flags:
        logger.warning(f"[OCR] Validation flags: {flags}")

    return flags


# ── LLM field extraction schema ───────────────────────────────────────────────

_FIELD_SCHEMAS = {
    "national_id": {
        "description": "Moroccan National ID (CIN / CNIE)",
        "fields": {
            "cin_number":       "CIN number (1-2 letters + 5-6 digits, e.g. AB123456)",
            "full_name_latin":  "Full name in Latin script",
            "full_name_arabic": "Full name in Arabic script",
            "date_of_birth":    "Date of birth (YYYY-MM-DD)",
            "place_of_birth":   "Place of birth",
            "address":          "Address on document",
            "expiry_date":      "Document expiry date (YYYY-MM-DD)",
            "civil_status":     "Civil status (single/married/etc.)",
        },
    },
    "passport": {
        "description": "International Passport",
        "fields": {
            "surname":          "Surname / family name",
            "given_names":      "Given names",
            "doc_number":       "Passport number",
            "nationality":      "Nationality (3-letter ISO code)",
            "date_of_birth":    "Date of birth (YYYY-MM-DD)",
            "expiry_date":      "Expiry date (YYYY-MM-DD)",
            "sex":              "Sex (M/F)",
            "place_of_birth":   "Place of birth (if visible)",
            "issuing_country":  "Issuing country",
        },
    },
    "residence_permit": {
        "description": "Residence Permit (Carte de Séjour)",
        "fields": {
            "full_name":        "Full name",
            "permit_number":    "Permit number",
            "date_of_birth":    "Date of birth (YYYY-MM-DD)",
            "expiry_date":      "Expiry date (YYYY-MM-DD)",
            "nationality":      "Nationality",
            "address":          "Address on document",
        },
    },
    "drivers_license": {
        "description": "Driver's License",
        "fields": {
            "full_name":        "Full name",
            "license_number":   "License number",
            "date_of_birth":    "Date of birth (YYYY-MM-DD)",
            "expiry_date":      "Expiry date (YYYY-MM-DD)",
            "categories":       "License categories (e.g. B, C, D)",
            "issuing_city":     "Issuing city/authority",
        },
    },
}


def _extract_fields_with_llm(raw_text: str, document_type: str) -> dict:
    schema = _FIELD_SCHEMAS.get(document_type)
    if not schema:
        logger.warning(f"[OCR] No LLM schema for doc type: {document_type}")
        return {}

    fields_desc = "\n".join(
        f'  "{k}": "{v}"' for k, v in schema["fields"].items()
    )

    prompt = f"""You are a KYC document parser. Extract structured fields from raw OCR text of a {schema['description']}.

Raw OCR text (may contain Arabic, French, and English mixed):
---
{raw_text}
---

Extract the following fields and return ONLY valid JSON (no markdown, no explanation):
{{
{fields_desc}
}}

Rules:
- Use null for any field not found in the text
- Dates must be YYYY-MM-DD format, convert if needed (e.g. "01/05/1990" → "1990-05-01")
- Clean up OCR noise (e.g. "AB l23456" → "AB123456" for CIN numbers)
- For Arabic names, preserve original Arabic script
- Do not invent data — only extract what is visible in the text"""

    try:
        client = _get_openai()
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=500,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        parsed  = json.loads(content)

        # ── DEBUG: pretty-printed LLM structured output ──
        logger.info(
            "[OCR] ━━━ LLM EXTRACTED FIELDS (%s) ━━━\n%s\n%s",
            document_type,
            json.dumps(parsed, ensure_ascii=False, indent=2),
            "━" * 60,
        )
        return parsed
    except Exception as exc:
        logger.error(f"[OCR] LLM field extraction failed: {exc}", exc_info=True)
        return {}


# ── Main entry point ──────────────────────────────────────────────────────────

def run_ocr(
    image_bytes: bytes,
    document_type: str,
    locale: str = "en",
    back_bytes: bytes | None = None,
) -> dict:
    """
    Args:
        image_bytes:   Front document image
        document_type: national_id | passport | residence_permit | drivers_license
        locale:        OCR language hint
        back_bytes:    Back document image (required for national_id MRZ)
    """
    img = _decode(image_bytes)

    # Step 1 — EasyOCR: dump ALL text from front
    ocr_results, avg_conf = _run_easyocr(img)
    all_texts = [text for _, text, _ in ocr_results]
    raw_text = "\n".join(all_texts)

    # ── DEBUG: full block-by-block front side dump ──
    logger.info(
        "[OCR] ━━━ FRONT SIDE RAW TEXT (%d blocks, avg_conf=%.3f) ━━━\n%s\n%s",
        len(all_texts),
        avg_conf,
        "\n".join(
            f"  [{i+1:02d}] conf={conf:.3f}  │  {text!r}"
            for i, (_, text, conf) in enumerate(ocr_results)
        ),
        "━" * 60,
    )

    # Also OCR the back if provided (extra raw text for LLM)
    if back_bytes:
        back_img = _decode(back_bytes)
        back_results, back_conf = _run_easyocr(back_img)
        back_texts = [text for _, text, _ in back_results]
        raw_text += "\n--- BACK SIDE ---\n" + "\n".join(back_texts)

        # ── DEBUG: full block-by-block back side dump ──
        logger.info(
            "[OCR] ━━━ BACK SIDE RAW TEXT (%d blocks, avg_conf=%.3f) ━━━\n%s\n%s",
            len(back_texts),
            back_conf,
            "\n".join(
                f"  [{i+1:02d}] conf={conf:.3f}  │  {text!r}"
                for i, (_, text, conf) in enumerate(back_results)
            ),
            "━" * 60,
        )

    mrz_valid  = None
    mrz_fields: dict = {}
    mrz_source_label: str | None = None

    # Step 2 — MRZ extraction (passporteye first, vision fallback if it fails)
    def _extract_mrz_with_fallback(src_bytes: bytes) -> tuple[dict, bool | None, str]:
        fields, valid = _extract_mrz(src_bytes)
        if fields:
            return fields, valid, "passporteye"
        # passporteye found nothing — try GPT-4o Vision
        logger.info("[OCR] passporteye found no MRZ — trying vision fallback")
        fields, valid = _extract_mrz_with_vision(src_bytes)
        return fields, valid, "llm_vision" if fields else None

    if document_type == "national_id":
        mrz_src = back_bytes or image_bytes
        mrz_fields, mrz_valid, mrz_source_label = _extract_mrz_with_fallback(mrz_src)
        if mrz_fields:
            logger.info(f"[OCR] CNIE MRZ ({mrz_source_label}): {mrz_fields}, valid={mrz_valid}")
        else:
            logger.warning("[OCR] CNIE MRZ not detected even with vision fallback")

    elif document_type in ("passport", "residence_permit"):
        mrz_fields, mrz_valid, mrz_source_label = _extract_mrz_with_fallback(image_bytes)
        if mrz_fields:
            logger.info(f"[OCR] MRZ ({mrz_source_label}): {mrz_fields}, valid={mrz_valid}")

    # Step 3 — GPT extracts structured VIZ fields from raw text
    viz_fields = _extract_fields_with_llm(raw_text, document_type)

    # Step 4 — Merge: MRZ takes precedence for clean numeric fields;
    #           VIZ (GPT) fills in fields not in MRZ (address, place_of_birth, etc.)
    _mrz_to_schema = {
        "doc_number":    "cin_number" if document_type == "national_id" else "doc_number",
        "surname":       "surname",
        "given_names":   "given_names",
        "nationality":   "nationality",
        "date_of_birth": "date_of_birth",
        "expiry_date":   "expiry_date",
        "sex":           "sex",
    }
    extracted = dict(viz_fields)
    if mrz_fields:
        for k, v in mrz_fields.items():
            if v is not None:
                schema_key = _mrz_to_schema.get(k, k)
                extracted[schema_key] = v

    # Step 5 — VIZ ↔ MRZ cross-check
    viz_mrz_cross_check: dict = {}
    if mrz_fields:
        viz_mrz_cross_check = _cross_check_viz_mrz(viz_fields, mrz_fields, document_type)

    # Step 6 — Field validation (CIN regex, age, expiry)
    validation_flags = _validate_fields(extracted, document_type)

    # Step 7 — Arabic ↔ Latin name consistency (national_id only)
    arabic_latin_check: dict = {}
    if document_type == "national_id":
        arabic_latin_check = _check_arabic_latin_names(
            extracted.get("full_name_arabic"),
            extracted.get("full_name_latin"),
        )
        if arabic_latin_check.get("consistent") is False:
            validation_flags.append("arabic_latin_name_mismatch")
            logger.warning(f"[OCR] Arabic↔Latin name mismatch: {arabic_latin_check}")

    return {
        "extracted_fields":       extracted,
        "raw_text":               raw_text,
        "mrz_valid":              mrz_valid,
        "mrz_source":             mrz_source_label,
        "mrz_fields":             mrz_fields if mrz_fields else None,
        "viz_mrz_cross_check":    viz_mrz_cross_check,
        "arabic_latin_name_check": arabic_latin_check,
        "validation_flags":       validation_flags,
        "ocr_confidence":         round(float(avg_conf), 3),
    }
