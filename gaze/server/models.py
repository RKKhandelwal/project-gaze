from pydantic import BaseModel
from typing import Optional


class StatusUpdate(BaseModel):
    court_id: str
    status: str  # "occupied" or "available"
    sensor_data: dict = {}
    timestamp: str  # ISO 8601


class CourtStatus(BaseModel):
    court_id: str
    name: str
    status: str
    last_updated: Optional[str] = None


class HistoryEntry(BaseModel):
    id: int
    court_id: str
    status: str
    sensor_data: dict
    timestamp: str
