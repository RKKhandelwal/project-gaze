# Dockerfile — YOLO26x with TensorRT on Vertex AI
# Uses the official Ultralytics CUDA image (includes PyTorch + TensorRT + CUDA)
FROM ultralytics/ultralytics:latest
 
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
 
# Install FastAPI server deps
RUN pip install --no-cache-dir fastapi[all] uvicorn[standard]
 
# Copy application code
WORKDIR /app
COPY src/ ./src/
 
# Pre-download the YOLO26x weights at build time (saves cold-start time)
RUN python -c "from ultralytics import YOLO; YOLO('yolo26x.pt')"
 
ENV PYTHONPATH=/app/src
EXPOSE 8080
 
ENTRYPOINT ["python", "src/main.py"]

