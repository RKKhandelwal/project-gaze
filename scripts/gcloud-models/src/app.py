# src/app.py — YOLO26x inference logic for Vertex AI

import io
import base64
from typing import Any, Dict

from PIL import Image
from ultralytics import YOLO

model_yolo = None
_model_ready = False


def _initialize_model():
    """Load YOLO26x and export to TensorRT (runs once at container start)."""
    global model_yolo, _model_ready
    try:
        # Load the PyTorch model, then export to TensorRT for GPU speed
        # This takes ~2-5 min on first boot but gives ~15ms/frame inference
        pt_model = YOLO("yolo26x.pt")
        pt_model.export(format="engine", imgsz=640, half=True, device=0)
        # Load the exported TensorRT engine
        model_yolo = YOLO("yolo26x.engine")
        _model_ready = True
        print("YOLO26x TensorRT engine loaded successfully")
    except Exception as e:
        print(f"TensorRT export failed, falling back to PyTorch: {e}")
        try:
            model_yolo = YOLO("yolo26x.pt")
            _model_ready = True
        except Exception as e2:
            print(f"Error initializing YOLO model: {e2}")
            _model_ready = False
            model_yolo = None


_initialize_model()


def is_model_ready() -> bool:
    return _model_ready and model_yolo is not None


def get_image_from_bytes(binary_image: bytes) -> Image.Image:
    return Image.open(io.BytesIO(binary_image)).convert("RGB")


def run_inference(
    input_image: Image.Image, confidence_threshold: float = 0.3
) -> Dict[str, Any]:
    """Run detection. Returns list of dicts with box coords + metadata."""
    global model_yolo
    if not is_model_ready():
        return {"detections": []}

    results = model_yolo.predict(
        source=input_image,
        imgsz=640,
        conf=confidence_threshold,
        classes=[0],  # person only
        save=False,
        verbose=False,
    )

    detections = []
    if results and len(results) > 0:
        result = results[0]
        if result.boxes is not None and len(result.boxes.xyxy) > 0:
            xyxy = result.boxes.xyxy.cpu().numpy()
            conf = result.boxes.conf.cpu().numpy()
            cls = result.boxes.cls.cpu().numpy().astype(int)
            xywh = result.boxes.xywh.cpu().numpy()

            for i in range(len(xyxy)):
                detections.append({
                    "x1": float(xyxy[i][0]),
                    "y1": float(xyxy[i][1]),
                    "x2": float(xyxy[i][2]),
                    "y2": float(xyxy[i][3]),
                    "cx": float(xywh[i][0]),
                    "cy": float(xywh[i][1]),
                    "w": float(xywh[i][2]),
                    "h": float(xywh[i][3]),
                    "confidence": float(conf[i]),
                    "class": int(cls[i]),
                    "name": "person",
                })

    return {"detections": detections}
