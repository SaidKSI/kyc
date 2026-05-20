from core.config import settings

_WEIGHTS = {
    "doc_auth": 30,
    "mrz":      20,
    "face_match": 25,
    "liveness": 15,
    "ocr":      10,
}


def compute_score(checks: dict) -> dict:
    """
    Weighted 0-100 score from pipeline check results.
    Each check contributes weight × confidence (0.0–1.0).
    """
    raw = 0.0
    total_weight = 0.0
    breakdown: dict = {}

    # --- doc_auth (weight 30) ---
    doc = checks.get("doc_auth", {})
    if not doc.get("skipped"):
        w = _WEIGHTS["doc_auth"]
        conf = doc.get("confidence", 0.0) if doc.get("authentic") else 0.0
        raw += w * conf
        total_weight += w
        breakdown["doc_auth"] = {"weight": w, "contribution": round(w * conf, 1)}

    # --- ocr: confidence (weight 10) + mrz (weight 20 if applicable) ---
    ocr = checks.get("ocr", {})
    if not ocr.get("skipped"):
        w_ocr = _WEIGHTS["ocr"]
        ocr_conf = ocr.get("ocr_confidence", 0.0)
        raw += w_ocr * ocr_conf
        total_weight += w_ocr
        breakdown["ocr"] = {"weight": w_ocr, "contribution": round(w_ocr * ocr_conf, 1)}

        mrz_valid = ocr.get("mrz_valid")
        if mrz_valid is not None:
            w_mrz = _WEIGHTS["mrz"]
            mrz_conf = 1.0 if mrz_valid else 0.0
            raw += w_mrz * mrz_conf
            total_weight += w_mrz
            breakdown["mrz"] = {"weight": w_mrz, "contribution": round(w_mrz * mrz_conf, 1)}

    # --- face_match (weight 25) ---
    face = checks.get("face_match", {})
    if not face.get("skipped"):
        w = _WEIGHTS["face_match"]
        conf_map = {"high": 1.0, "low": 0.5, "none": 0.0}
        face_conf = conf_map.get(face.get("confidence", "none"), 0.0)
        raw += w * face_conf
        total_weight += w
        breakdown["face_match"] = {"weight": w, "contribution": round(w * face_conf, 1)}

    # --- liveness (weight 15) ---
    liveness = checks.get("liveness", {})
    if not liveness.get("skipped"):
        w = _WEIGHTS["liveness"]
        live_conf = liveness.get("confidence", 0.0) if liveness.get("live") else 0.0
        raw += w * live_conf
        total_weight += w
        breakdown["liveness"] = {"weight": w, "contribution": round(w * live_conf, 1)}

    score = int(round((raw / total_weight) * 100)) if total_weight > 0 else 0
    score = max(0, min(100, score))

    if score >= settings.score_approve_threshold:
        decision = "approved"
    elif score <= settings.score_reject_threshold:
        decision = "rejected"
    else:
        decision = "review"

    return {"score": score, "decision": decision, "breakdown": breakdown}
