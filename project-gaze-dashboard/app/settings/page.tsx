"use client";

import { useVideoFeed } from "@/lib/VideoFeedContext";

export default function SettingsPage() {
  const { enabled, ready, saved, setEnabled } = useVideoFeed();
  return (
    <main className="page settings-page">
      <div>
        <h1>Settings</h1>
        <p className="muted">Preferences for this browser.</p>
      </div>
      <section
        className="card settings-card"
        aria-labelledby="video-settings-title"
      >
        <div className="settings-row">
          <div>
            <h2 id="video-settings-title">Video feed</h2>
            <p id="video-setting-description">
              Show video playback when selecting an occupancy segment.
            </p>
          </div>
          <label className="feed-toggle">
            <input
              type="checkbox"
              role="switch"
              aria-label="Show video feed"
              aria-describedby="video-setting-description"
              checked={enabled}
              disabled={!ready}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span aria-hidden="true" className="feed-toggle-track" />
          </label>
        </div>
        <p className="settings-status" role="status">
          {!ready
            ? "Loading preference…"
            : enabled
              ? "Video feed is enabled."
              : "Zero-Day retention enabled - video feed isn't available"}
        </p>
        <p className="muted">
          Saved locally in this browser. This controls playback visibility; it
          does not change server storage or retention.
        </p>
        {!saved && (
          <p role="alert">
            Your browser could not save this preference. It will apply for this
            visit only.
          </p>
        )}
      </section>
    </main>
  );
}
