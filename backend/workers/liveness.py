"""
Passive liveness detection using MediaPipe Face Mesh.
Returns: {"live": bool, "confidence": float, "method": "passive"}
"""
import cv2
import numpy as np

_mp_face_mesh = None

# Left eye: 33 160 158 133 153 144
# Right eye: 362 385 387 263 373 380
_LEFT_EYE  = [33, 160, 158, 133, 153, 144]
_RIGHT_EYE = [362, 385, 387, 263, 373, 380]


_MEDIAPIPE_AVAILABLE = None

def _get_face_mesh():
    global _mp_face_mesh, _MEDIAPIPE_AVAILABLE
    if _MEDIAPIPE_AVAILABLE is False:
        return None
    if _mp_face_mesh is None:
        try:
            from mediapipe.python.solutions import face_mesh as _fm
            _mp_face_mesh = _fm
            _MEDIAPIPE_AVAILABLE = True
        except (ImportError, AttributeError):
            try:
                import mediapipe as mp
                _mp_face_mesh = mp.solutions.face_mesh
                _MEDIAPIPE_AVAILABLE = True
            except (ImportError, AttributeError):
                import logging
                logging.getLogger(__name__).warning(
                    "[LIVENESS] mediapipe not available on this Python version — liveness check disabled"
                )
                _MEDIAPIPE_AVAILABLE = False
                return None
    return _mp_face_mesh


def _ear(landmarks, indices: list[int]) -> float:
    pts = [(landmarks[i].x, landmarks[i].y) for i in indices]
    p1, p2, p3, p4, p5, p6 = pts
    a = np.linalg.norm(np.subtract(p2, p6))
    b = np.linalg.norm(np.subtract(p3, p5))
    c = np.linalg.norm(np.subtract(p1, p4))
    return float((a + b) / (2.0 * c)) if c > 0 else 0.0


def check_liveness(image_bytes: bytes) -> dict:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return {"live": False, "confidence": 0.0, "method": "passive", "flags": ["decode_failed"]}

    mp_face_mesh = _get_face_mesh()
    if mp_face_mesh is None:
        # mediapipe unavailable — return neutral result so pipeline continues
        return {"live": True, "confidence": 0.5, "method": "passive", "flags": ["mediapipe_unavailable"]}

    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    with mp_face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
    ) as mesh:
        results = mesh.process(rgb)

    if not results.multi_face_landmarks:
        return {"live": False, "confidence": 0.0, "method": "passive", "flags": ["no_face_detected"]}

    lm = results.multi_face_landmarks[0].landmark

    # 1. Depth variance — flat printed photo has near-zero z variance
    z_vals = [l.z for l in lm]
    z_var = float(np.var(z_vals))
    z_score = min(1.0, z_var / 0.0008)

    # 2. Eye aspect ratio — natural open eye: 0.15–0.45
    avg_ear = (_ear(lm, _LEFT_EYE) + _ear(lm, _RIGHT_EYE)) / 2.0
    ear_score = 1.0 if 0.15 < avg_ear < 0.45 else 0.3

    # 3. Skin texture variance — printed photos are smoother
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    face_patch = gray[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
    texture_score = min(1.0, float(np.var(face_patch)) / 500.0)

    confidence = round(z_score * 0.40 + ear_score * 0.30 + texture_score * 0.30, 3)
    live = confidence > 0.50

    return {
        "live": live,
        "confidence": confidence,
        "method": "passive",
        "flags": [] if live else ["low_liveness_confidence"],
    }
