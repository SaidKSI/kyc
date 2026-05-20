"""
Document authenticity checks using OpenCV + Pillow.
Returns: {"authentic": bool, "confidence": float, "flags": [str]}
"""
import io

import cv2
import numpy as np
from PIL import Image


def check_doc_auth(image_bytes: bytes) -> dict:
    flags: list[str] = []

    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return {"authentic": False, "confidence": 0.0, "flags": ["decode_failed"]}

    h, w = img.shape[:2]

    # Resolution
    if min(h, w) < 640:
        flags.append("low_resolution")

    # EXIF GPS check
    try:
        pil_img = Image.open(io.BytesIO(image_bytes))
        exif_data = pil_img._getexif() or {}
        if 34853 in exif_data:  # GPSInfo tag
            flags.append("gps_data_present")
    except Exception:
        pass

    # Edge integrity — Canny
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.sum(edges > 0)) / (h * w)
    if edge_density > 0.30:
        flags.append("high_edge_density")

    # Color histogram — screenshot/oversaturation detection
    for ch in range(3):
        hist = cv2.calcHist([img], [ch], None, [256], [0, 256])
        extreme = float(hist[0][0] + hist[255][0]) / (h * w)
        if extreme > 0.20:
            flags.append("color_saturation_anomaly")
            break

    # Confidence deductions per flag
    _deductions = {
        "low_resolution":          0.40,
        "high_edge_density":       0.20,
        "color_saturation_anomaly": 0.20,
        "gps_data_present":        0.10,
    }
    confidence = 1.0
    for flag in flags:
        confidence -= _deductions.get(flag, 0.10)
    confidence = round(max(0.0, confidence), 3)

    return {
        "authentic": confidence >= 0.60,
        "confidence": confidence,
        "flags": flags,
    }
