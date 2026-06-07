export interface IndexTotals {
  total_segments: number;
  total_frames: number;
  earliest_utc: string;
  latest_utc: string;
  peak_occupancy: number;
}

export interface DaySummary {
  max: number;
  total_frames: number;
  segments: number;
}

export interface Segment {
  fileID: string;
  start_utc: string;
  total_frames: number;
  fps: number;
  max_people: number;
  avg_people: number;
  overlay_key: string;
}

export type OccupancyPoint = [number, number];

export interface IndexData {
  generated_at: string;
  bucket: string;
  overlays_prefix: string;
  totals: IndexTotals;
  occupancy_minute: OccupancyPoint[];
  daily_summary: Record<string, DaySummary>;
  segments: Segment[];
}

export interface VideoUrlResponse {
  url: string;
  expiresAt: number;
}
