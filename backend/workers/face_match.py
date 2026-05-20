"""
Face matching using DeepFace (ArcFace backend + RetinaFace detector).
Returns: {"match": bool, "distance": float, "confidence": "high"|"low"|"none"}

Thresholds (cosine distance):
  < 0.40  → match      (high confidence)
  0.40–0.55 → no match (low confidence — manual review)
  > 0.55  → no match   (none)
"""
import os
import tempfile

from deepface import DeepFace


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
            return {"match": True,  "distance": round(distance, 4), "confidence": "high"}
        elif distance < 0.55:
            return {"match": False, "distance": round(distance, 4), "confidence": "low"}
        else:
            return {"match": False, "distance": round(distance, 4), "confidence": "none"}

    except Exception as exc:
        msg = str(exc)
        if "Face could not be detected" in msg or "No face" in msg:
            return {
                "match": False,
                "distance": 1.0,
                "confidence": "none",
                "flags": ["no_face_detected"],
            }
        raise
    finally:
        for path in (id_path, selfie_path):
            if path and os.path.exists(path):
                os.unlink(path)
