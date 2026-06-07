# src/main.py — FastAPI server for Vertex AI
import os
import sys
import base64
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

from app import is_model_ready, get_image_from_bytes, run_inference

# Vertex AI environment
AIP_HTTP_PORT = int(os.getenv("AIP_HTTP_PORT", "8080"))
AIP_HEALTH_ROUTE = os.getenv("AIP_HEALTH_ROUTE", "/health")
AIP_PREDICT_ROUTE = os.getenv("AIP_PREDICT_ROUTE", "/predict")

app = FastAPI(title="YOLO26x Pickleball Tracker")


class PredictionRequest(BaseModel):
    instances: list
    parameters: Optional[Dict[str, Any]] = None


class PredictionResponse(BaseModel):
    predictions: list


@app.get(AIP_HEALTH_ROUTE, status_code=status.HTTP_200_OK)
def health_check():
    if not is_model_ready():
        raise HTTPException(status_code=503, detail="Model not ready")
    return {"status": "healthy"}


@app.post(AIP_PREDICT_ROUTE, response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    try:
        predictions = []
        parameters = request.parameters or {}
        confidence = parameters.get("confidence", 0.3)

        for instance in request.instances:
            if not isinstance(instance, dict) or "image" not in instance:
                raise HTTPException(
                    status_code=400, detail="Instance must contain 'image' field"
                )

            image_data = base64.b64decode(instance["image"])
            input_image = get_image_from_bytes(image_data)
            result = run_inference(input_image, confidence_threshold=confidence)

            predictions.append({
                "detections": result["detections"],
                "detection_count": len(result["detections"]),
            })

        return PredictionResponse(predictions=predictions)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")


if __name__ == "__main__":
    import uvicorn

    print(f"Starting YOLO26x server on port {AIP_HTTP_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=AIP_HTTP_PORT)
