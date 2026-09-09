"use client";

import { useVideoFeed } from "@/lib/VideoFeedContext";

export default function VideoFeedGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { enabled, ready } = useVideoFeed();
  // Do not mount the player (or request a signed URL) before storage is read.
  if (!ready || !enabled) {
    return (
      <section className="card video-placeholder" aria-label="Video feed">
        <div className="card-label">Video</div>
        <div className="placeholder-body" role="status">
          <p>
            {ready
              ? "Zero-Day retention enabled - video feed isn't available"
              : "Loading video preference…"}
          </p>
        </div>
      </section>
    );
  }
  return <>{children}</>;
}
