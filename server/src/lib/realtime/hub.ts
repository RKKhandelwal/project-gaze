import type { CourtStatusUpdateEvent } from "@gaze/types";

type Listener = (payload: CourtStatusUpdateEvent) => void;

class RealtimeHub {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(payload: CourtStatusUpdateEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch {
        // Ignore listener errors so one bad subscriber doesn't break others.
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

export const realtimeHub = new RealtimeHub();

export function publishCourtStatusUpdate(event: CourtStatusUpdateEvent): void {
  realtimeHub.publish(event);
}
