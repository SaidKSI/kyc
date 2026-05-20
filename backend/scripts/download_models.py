"""
Pre-warm all ML models. Run once after pip install to avoid first-request delays.
  python scripts/download_models.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def download_easyocr():
    print("→ EasyOCR (ar + fr + en) ...")
    import easyocr
    easyocr.Reader(["ar", "fr", "en"], gpu=False)
    print("  EasyOCR OK")


def download_deepface():
    print("→ DeepFace ArcFace ...")
    from deepface import DeepFace
    DeepFace.build_model("ArcFace")
    print("  ArcFace OK")


def download_mediapipe():
    print("→ MediaPipe Face Mesh ...")
    import mediapipe as mp
    import numpy as np
    import cv2
    blank = np.zeros((480, 640, 3), dtype=np.uint8)
    rgb = cv2.cvtColor(blank, cv2.COLOR_BGR2RGB)
    with mp.solutions.face_mesh.FaceMesh(static_image_mode=True) as fm:
        fm.process(rgb)
    print("  MediaPipe OK")


if __name__ == "__main__":
    print("Downloading / warming ML models...\n")
    try:
        download_easyocr()
    except Exception as e:
        print(f"  EasyOCR WARN: {e}")

    try:
        download_deepface()
    except Exception as e:
        print(f"  DeepFace WARN: {e}")

    try:
        download_mediapipe()
    except Exception as e:
        print(f"  MediaPipe WARN: {e}")

    print("\nDone.")
