from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import json
import os

from config import SUPABASE_SERVICE_ROLE_KEY, HOST, PORT
from database import init_db, save_reading, get_all_courts, get_court_history, get_usage_stats, get_daylight_predictions
from models import StatusUpdate

# ---------- In-memory state ----------
court_state: dict[str, dict] = {}
ws_clients: list[WebSocket] = []


# ---------- Lifespan ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Load current state from DB
    courts = await get_all_courts()
    for c in courts:
        court_state[c["court_id"]] = c
    yield


app = FastAPI(title="Project Gaze", lifespan=lifespan)


# ---------- Auth helper ----------
# For sensor POST: accepts the Supabase service_role key as the API key.
# This keeps backward compat with the Pi sensor code that sends X-Api-Key.
def verify_api_key(x_api_key: str = Header(...)):
    if x_api_key != SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


# ---------- Routes ----------
@app.post("/api/status")
async def post_status(update: StatusUpdate, x_api_key: str = Header(...)):
    verify_api_key(x_api_key)

    if update.status not in ("occupied", "available"):
        raise HTTPException(status_code=400, detail="status must be 'occupied' or 'available'")

    # Persist to Supabase
    await save_reading(update.court_id, update.status, update.sensor_data, update.timestamp)

    # Update in-memory
    existing = court_state.get(update.court_id, {})
    court_state[update.court_id] = {
        "court_id": update.court_id,
        "name": existing.get("name", update.court_id),
        "status": update.status,
        "last_updated": update.timestamp,
    }

    # Broadcast to WebSocket clients
    message = json.dumps({
        "type": "status_update",
        "data": court_state[update.court_id],
    })
    disconnected = []
    for ws in ws_clients:
        try:
            await ws.send_text(message)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        ws_clients.remove(ws)

    return {"ok": True}


@app.get("/api/courts")
async def get_courts():
    # Refresh from DB if in-memory is empty (e.g., serverless cold start)
    if not court_state:
        courts = await get_all_courts()
        for c in courts:
            court_state[c["court_id"]] = c
    return list(court_state.values())


@app.get("/api/courts/{court_id}/history")
async def get_history(court_id: str):
    history = await get_court_history(court_id)
    return history


@app.get("/api/courts/{court_id}/predictions")
async def get_predictions(court_id: str, days: int = 28):
    stats = await get_usage_stats(court_id, days)
    if stats is None:
        return {"error": "No data available", "court_id": court_id}
    return {"court_id": court_id, **stats}


@app.get("/api/courts/{court_id}/daylight")
async def get_daylight(court_id: str, days: int = 28, start: int = 6, end: int = 20):
    """Daylight-only predictions + session analysis + opening estimate."""
    stats = await get_daylight_predictions(court_id, days, start, end)
    if stats is None:
        return {"error": "No data available", "court_id": court_id}
    return {"court_id": court_id, **stats}


# ---------- WebSocket ----------
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    ws_clients.append(ws)
    try:
        await ws.send_text(json.dumps({
            "type": "init",
            "data": list(court_state.values()),
        }))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if ws in ws_clients:
            ws_clients.remove(ws)


# ---------- Static files (legacy web dashboard — deprecated) ----------
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/")
    async def root():
        return FileResponse(os.path.join(static_dir, "index.html"))


# ---------- Dev entry point ----------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
