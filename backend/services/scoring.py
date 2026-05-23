from core.config import settings

_WEIGHTS = {
    "doc_auth":    30,
    "mrz":         20,
    "face_match":  25,
    "liveness":    15,
    "ocr":         10,
    "llm_analysis": 15,  # bonus weight when available; total re-normalised
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

    # --- ocr: confidence (weight 10) + mrz (weight 20) + cross-check penalty ---
    ocr = checks.get("ocr", {})
    if not ocr.get("skipped"):
        w_ocr = _WEIGHTS["ocr"]
        ocr_conf = ocr.get("ocr_confidence", 0.0)

        # Penalise validation flags (expired doc, under-16, invalid CIN, etc.)
        val_flags = ocr.get("validation_flags", [])
        critical_flags = {"document_expired", "holder_under_16", "invalid_cin_format"}
        penalty = sum(0.30 if f in critical_flags else 0.10 for f in val_flags)
        ocr_conf = max(0.0, ocr_conf - penalty)

        # Penalise VIZ↔MRZ mismatches
        cross_check = ocr.get("viz_mrz_cross_check", {})
        mismatch_count = sum(1 for v in cross_check.values() if v == "mismatch")
        ocr_conf = max(0.0, ocr_conf - mismatch_count * 0.25)

        raw += w_ocr * ocr_conf
        total_weight += w_ocr
        breakdown["ocr"] = {
            "weight": w_ocr,
            "contribution": round(w_ocr * ocr_conf, 1),
            "validation_flags": val_flags,
            "viz_mrz_mismatches": mismatch_count,
        }

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

    # --- llm_analysis (weight 15, optional) ---
    llm = checks.get("llm_analysis", {})
    if not llm.get("skipped") and not llm.get("error"):
        w = _WEIGHTS["llm_analysis"]
        assessment = llm.get("authentic_assessment", "suspicious")
        llm_conf = llm.get("confidence", 0.5)
        conf_map = {"likely_genuine": llm_conf, "suspicious": llm_conf * 0.3, "likely_fake": 0.0}
        llm_score_conf = conf_map.get(assessment, 0.3)

        # Hard penalty: doc type mismatch (user submitted wrong doc)
        if llm.get("doc_type_confirmed") is False:
            llm_score_conf = min(llm_score_conf, 0.2)

        raw += w * llm_score_conf
        total_weight += w
        breakdown["llm_analysis"] = {
            "weight": w,
            "contribution": round(w * llm_score_conf, 1),
            "assessment": assessment,
            "doc_type_confirmed": llm.get("doc_type_confirmed"),
        }

    # --- arabic↔latin name mismatch bonus penalty (no weight, direct deduction) ---
    ocr_for_name = checks.get("ocr", {})
    arabic_check = ocr_for_name.get("arabic_latin_name_check", {})
    if arabic_check.get("consistent") is False and not arabic_check.get("skipped"):
        # Deduct directly from raw score — name inconsistency is a strong fraud signal
        raw = max(0.0, raw - total_weight * 0.15)
        breakdown["arabic_latin_name_mismatch"] = {"penalty": "15% of weighted score"}

    score = int(round((raw / total_weight) * 100)) if total_weight > 0 else 0
    score = max(0, min(100, score))

    if score >= settings.score_approve_threshold:
        decision = "approved"
    elif score <= settings.score_reject_threshold:
        decision = "rejected"
    else:
        decision = "review"

    return {"score": score, "decision": decision, "breakdown": breakdown}
