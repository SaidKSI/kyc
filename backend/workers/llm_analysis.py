"""
LLM-based document fraud analysis using OpenAI GPT-4o vision.

Steps:
  1. Doc type auto-detection — verifies image matches claimed document type
  2. Vision fraud analysis   — tamper detection, layout check, security features
  3. Risk narrative          — plain-English summary for human reviewer

Returns:
  {
    "doc_type_detected":    str | None,    # what GPT thinks the doc type is
    "doc_type_confirmed":   bool | None,   # matches claimed type?
    "authentic_assessment": "likely_genuine" | "suspicious" | "likely_fake",
    "confidence":           float,
    "flags":                [str],
    "field_cross_check":    {str: bool},
    "risk_narrative":       str,
    "skipped":              bool,
  }
"""
import base64
import json
import logging
import os

logger = logging.getLogger(__name__)

_DOC_TYPE_LABELS = {
    "national_id":       "Moroccan National ID (CIN/CNIE)",
    "passport":          "International Passport",
    "residence_permit":  "Residence Permit (Carte de Séjour)",
    "drivers_license":   "Driver's License",
}


def _get_openai():
    from openai import OpenAI
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key or api_key == "sk-your-key-here":
        raise ValueError("OPENAI_API_KEY not set")
    return OpenAI(api_key=api_key)


def _image_to_b64(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("utf-8")


def run_llm_analysis(
    front_bytes: bytes,
    document_type: str,
    extracted_fields: dict | None,
    checks: dict | None,
) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key == "sk-your-key-here":
        logger.warning("[LLM] OPENAI_API_KEY not set — skipping LLM analysis")
        return {"skipped": True, "reason": "OPENAI_API_KEY not configured"}

    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    claimed_label = _DOC_TYPE_LABELS.get(document_type, document_type)
    b64 = _image_to_b64(front_bytes)

    # ── Step 1: Doc type auto-detection ──────────────────────────────────────
    doc_type_detected   = None
    doc_type_confirmed  = None
    try:
        detect_prompt = """Look at this identity document image and identify what type it is.
Choose the single best match from:
  - "national_id"       (Moroccan CIN/CNIE — has Arabic text, CIN number, Moroccan flag)
  - "passport"          (any country — booklet or card with MRZ)
  - "residence_permit"  (carte de séjour / residence card)
  - "drivers_license"   (driving license)
  - "unknown"           (cannot determine)

Return ONLY valid JSON:
{"doc_type": "<type>", "confidence": <float 0.0-1.0>, "reason": "<one sentence>"}"""

        client = _get_openai()
        detect_resp = client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": detect_prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"}},
                ],
            }],
            temperature=0,
            max_tokens=120,
            response_format={"type": "json_object"},
        )
        detect_data      = json.loads(detect_resp.choices[0].message.content)
        doc_type_detected = detect_data.get("doc_type")
        doc_type_confirmed = (
            doc_type_detected == document_type
            if doc_type_detected and doc_type_detected != "unknown"
            else None
        )
        logger.info(f"[LLM] Doc type detected={doc_type_detected}, claimed={document_type}, confirmed={doc_type_confirmed}")

        if doc_type_confirmed is False:
            logger.warning(f"[LLM] Doc type MISMATCH: user claimed '{document_type}', image looks like '{doc_type_detected}'")

    except Exception as exc:
        logger.error(f"[LLM] Doc type detection failed: {exc}", exc_info=True)

    # ── Step 2: Fraud analysis + risk narrative ───────────────────────────────
    check_summary = ""
    if checks:
        doc_auth = checks.get("doc_auth", {})
        ocr      = checks.get("ocr", {})
        face     = checks.get("face_match", {})
        liveness = checks.get("liveness", {})
        val_flags = ocr.get("validation_flags", [])
        mismatches = [k for k, v in ocr.get("viz_mrz_cross_check", {}).items() if v == "mismatch"]
        arabic_check = ocr.get("arabic_latin_name_check", {})

        check_summary = f"""
Pipeline results so far:
- Doc auth: authentic={doc_auth.get('authentic')}, confidence={doc_auth.get('confidence')}, flags={doc_auth.get('flags', [])}
- OCR: confidence={ocr.get('ocr_confidence')}, mrz_valid={ocr.get('mrz_valid')}, mrz_source={ocr.get('mrz_source')}
- VIZ↔MRZ mismatches: {mismatches}
- Validation flags: {val_flags}
- Arabic↔Latin name consistent: {arabic_check.get('consistent')}
- Face match: match={face.get('match')}, distance={face.get('distance')}, llm_opinion={face.get('llm_opinion', {}).get('same_person') if face.get('llm_opinion') else 'N/A'}
- Liveness: live={liveness.get('live')}, confidence={liveness.get('confidence')}
- Doc type claimed: {document_type}, detected: {doc_type_detected}, confirmed: {doc_type_confirmed}
"""

    fields_summary = ""
    if extracted_fields:
        fields_summary = "Extracted fields:\n" + "\n".join(
            f"  {k}: {v}" for k, v in extracted_fields.items() if v is not None
        )

    fraud_prompt = f"""You are a KYC fraud detection expert reviewing a {claimed_label} document.

{fields_summary}
{check_summary}

Analyze the document image for authenticity and produce a complete assessment.
Return ONLY valid JSON:
{{
  "authentic_assessment": "likely_genuine" | "suspicious" | "likely_fake",
  "confidence": <float 0.0–1.0>,
  "flags": ["<issue1>", "<issue2>"],
  "field_cross_check": {{
    "<visible_field_name>": <true if looks correct | false if suspicious>
  }},
  "risk_narrative": "<2–3 sentence plain-English summary for a human reviewer, noting the most important findings>"
}}

Check for:
- Digital tampering (inconsistent fonts, pixel artifacts, cloning, edge splicing)
- Layout matches expected format for {claimed_label}
- Photo zone integrity (no paste-over, colour mismatch, raised edges)
- Security features visible (hologram, guilloche pattern, microprint)
- Consistency between all visible data fields
- Any field that looks suspicious given the document type"""

    try:
        fraud_resp = client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": fraud_prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}},
                ],
            }],
            temperature=0,
            max_tokens=600,
            response_format={"type": "json_object"},
        )

        result = json.loads(fraud_resp.choices[0].message.content)
        logger.info(f"[LLM] Fraud analysis: {result}")

        # Inject doc type mismatch as flag if detected
        if doc_type_confirmed is False:
            result.setdefault("flags", [])
            result["flags"].append(f"doc_type_mismatch:claimed_{document_type}_detected_{doc_type_detected}")

        return {
            "doc_type_detected":   doc_type_detected,
            "doc_type_confirmed":  doc_type_confirmed,
            **result,
        }

    except Exception as exc:
        logger.error(f"[LLM] Fraud analysis failed: {exc}", exc_info=True)
        return {
            "doc_type_detected":  doc_type_detected,
            "doc_type_confirmed": doc_type_confirmed,
            "error": str(exc),
            "skipped": True,
        }
