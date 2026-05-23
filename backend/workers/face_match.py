"""
Face matching using DeepFace (ArcFace backend + RetinaFace detector).
When distance is borderline (0.40–0.55), GPT-4o Vision gives a second opinion.

Returns:
  {
    "match": bool,
    "distance": float,
    "confidence": "high" | "low" | "none",
    "llm_opinion": {...} | None,   # populated only for borderline cases
  }

Thresholds (cosine distance):
  < 0.40         → match      (high confidence)
  0.40–0.55      → borderline → escalate to LLM second opinion
  > 0.55         → no match   (none)
"""
import base64
import json
import logging
import os
import tempfile

from deepface import DeepFace

logger = logging.getLogger(__name__)


def _llm_face_opinion(id_bytes: bytes, selfie_bytes: bytes) -> dict:
    """
    GPT-4o Vision second opinion for borderline face match (distance 0.40–0.55).
    Sends both images and asks: same person?
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key == "sk-your-key-here":
        logger.warning("[FACE] OPENAI_API_KEY not set — skipping LLM face opinion")
        return {"skipped": True}

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)

        id_b64      = base64.b64encode(id_bytes).decode()
        selfie_b64  = base64.b64encode(selfie_bytes).decode()

        prompt = """You are a KYC identity verification expert.
Compare the face in image 1 (ID document photo) with the face in image 2 (live selfie).
Consider age differences, photo quality, lighting, and angle variations.

Return ONLY valid JSON — no markdown:
{
  "same_person": true | false,
  "confidence": <float 0.0–1.0>,
  "reasoning": "<one sentence explaining your decision>",
  "concerns": ["<list any concerns, empty array if none>"]
}"""

        response = client.chat.completions.create(
            model="gpt-4o",           # vision required — do not downgrade to mini
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{id_b64}",
                            "detail": "high",
                        },
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{selfie_b64}",
                            "detail": "high",
                        },
                    },
                ],
            }],
            temperature=0,
            max_tokens=200,
            response_format={"type": "json_object"},
        )

        result = json.loads(response.choices[0].message.content)
        logger.info(f"[FACE] LLM second opinion: {result}")
        return result

    except Exception as exc:
        logger.error(f"[FACE] LLM opinion failed: {exc}", exc_info=True)
        return {"skipped": True, "error": str(exc)}


def match_faces(id_image_bytes: bytes, selfie_bytes: bytes) -> dict:
    id_path = selfie_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            f.write(id_image_bytes)
            id_path = f.name

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            f.write(selfie_bytes)
            selfie_path = f.name

        result = DeepFace.verify(
            img1_path=id_path,
            img2_path=selfie_path,
            model_name="ArcFace",
            detector_backend="retinaface",
            distance_metric="cosine",
            enforce_detection=True,
        )

        distance = float(result["distance"])

        if distance < 0.40:
            # High confidence match — no LLM needed
            return {
                "match": True,
                "distance": round(distance, 4),
                "confidence": "high",
                "llm_opinion": None,
            }

        elif distance < 0.55:
            # Borderline — escalate to GPT-4o Vision for second opinion
            logger.info(f"[FACE] Borderline distance {distance:.4f} — requesting LLM second opinion")
            llm = _llm_face_opinion(id_image_bytes, selfie_bytes)

            # Resolve final verdict: LLM overrides DeepFace for borderline
            if not llm.get("skipped"):
                llm_match    = llm.get("same_person", False)
                llm_conf_val = llm.get("confidence", 0.5)
                # Upgrade to match if LLM is confident (≥ 0.70)
                final_match = llm_match and llm_conf_val >= 0.70
                confidence  = "low"  # still low — human review recommended
            else:
                final_match = False
                confidence  = "low"

            return {
                "match": final_match,
                "distance": round(distance, 4),
                "confidence": confidence,
                "llm_opinion": llm,
            }

        else:
            # Clear no-match
            return {
                "match": False,
                "distance": round(distance, 4),
                "confidence": "none",
                "llm_opinion": None,
            }

    except Exception as exc:
        msg = str(exc)
        if "Face could not be detected" in msg or "No face" in msg:
            return {
                "match": False,
                "distance": 1.0,
                "confidence": "none",
                "llm_opinion": None,
                "flags": ["no_face_detected"],
            }
        raise
    finally:
        for path in (id_path, selfie_path):
            if path and os.path.exists(path):
                os.unlink(path)
