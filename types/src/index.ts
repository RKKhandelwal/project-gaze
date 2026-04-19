// Core domain contracts shared across server and mobile clients.

export type CourtStatus = "unknown" | "available" | "occupied";
export type SensorStatus = "available" | "occupied";
export type EventName = "court_occupied" | "court_unoccupied";

export interface Court {
  // External/public court identifier
  court_id: string;
  name: string;
  status: CourtStatus;
  last_updated: string | null;
}

export interface Location {
  // External/public location identifier
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface LocationWithCourts extends Location {
  courts: Court[];
}

export interface CourtHistoryEvent {
  id: string;
  court_id: string;
  status: Extract<CourtStatus, "available" | "occupied">;
  sensor_data: Record<string, unknown> | null;
  timestamp: string;
}

export interface HourlyOccupancyPoint {
  hour: number;
  occupancy_pct: number;
}

export interface DaylightRange {
  start: number;
  end: number;
}

export interface CurrentSession {
  started_at: string;
  duration_min: number;
  est_remaining_min: number;
  based_on_median_min: number;
}

export interface CourtPredictionsResponse {
  court_id: string;
  heatmap: Array<Array<number | null>>;
  peak_hours: HourlyOccupancyPoint[];
  best_times: HourlyOccupancyPoint[];
  current_prediction: number | null;
  next_hours: Array<{ hour: number; occupancy_pct: number | null }>;
  data_days: number;
  total_readings: number;
}

export interface CourtDaylightResponse {
  court_id: string;
  daylight_heatmap: Array<Array<number | null>>;
  daylight_hours: number[];
  peak_daylight_hours: HourlyOccupancyPoint[];
  best_daylight_times: HourlyOccupancyPoint[];
  avg_session_min: number | null;
  median_session_min: number | null;
  session_count: number;
  current_session: CurrentSession | null;
  daylight_range: DaylightRange;
  data_days: number;
  total_daylight_readings: number;
}

export interface ApiErrorResponse {
  error?: string;
  detail?: string;
  court_id?: string;
  location_id?: string;
  sensor_id?: string;
}

// Status ingestion contracts

export interface StatusPostRequest {
  // External/public sensor identifier
  sensor_id: string;
  status: SensorStatus;
  sensor_data?: Record<string, unknown>;
  timestamp: string; // ISO-8601
}

export interface StatusPostResponse {
  ok: boolean;
  skipped?: "sensor_not_found" | "sensor_unassigned";
}

export type StatusPostErrorResponse = {
  detail: string;
};

// Auth/token contracts

export interface AuthTokenRequest {
  device_id?: string;
}

export interface AuthTokenResponse {
  token_type: "Bearer";
  access_token: string;
  expires_in: number;
}

// Stream/SSE contracts

export type StreamSource = "status_api" | "db_write" | "manual";

export type CourtStatusUpdateEvent = {
  type: "court_status_update";
  court_id: string;
  status: CourtStatus;
  timestamp: string;
  source?: StreamSource;
};

export type StreamConnectedEvent = {
  type: "connected";
  transport: "sse";
  timestamp: string;
};

export type StreamPingEvent = {
  type: "ping";
  timestamp: string;
  listeners: number;
};

export type StreamMessage =
  | CourtStatusUpdateEvent
  | StreamConnectedEvent
  | StreamPingEvent;

// Admin registration endpoint payloads

export interface CreateLocationRequest {
  public_id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface CreateLocationResponse {
  id: number; // internal integer ID
  public_id: string;
  name: string;
  latitude: number;
  longitude: number;
  created_at: string;
}

export interface CreateCourtRequest {
  public_id?: string;
  location_id: string; // location public_id
  name: string;
  number: number;
}

export interface CreateCourtResponse {
  id: number; // internal integer ID
  public_id: string;
  location_id: string; // location public_id
  name: string;
  number: number;
  created_at: string;
}

export interface RegisterSensorRequest {
  public_id: string;
  court_id?: string; // court public_id
}

export interface RegisterSensorResponse {
  id: number; // internal integer ID
  public_id: string;
  court_id: string | null; // court public_id if linked
  registered_at: string;
  last_seen_at: string | null;
}

export interface AssignSensorCourtRequest {
  court_id: string; // court public_id
}

export interface AssignSensorCourtResponse {
  ok: boolean;
  sensor: {
    id: string; // sensor public_id
    court_id: string; // court public_id
  };
}

// Convenience unions

export type CourtPredictionsOrError = CourtPredictionsResponse | ApiErrorResponse;
export type CourtDaylightOrError = CourtDaylightResponse | ApiErrorResponse;
