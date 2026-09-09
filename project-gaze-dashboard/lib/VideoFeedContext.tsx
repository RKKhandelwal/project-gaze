"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export const VIDEO_FEED_STORAGE_KEY = "gaze.videoFeedEnabled";

interface VideoFeedPreference {
  enabled: boolean;
  ready: boolean;
  saved: boolean;
  setEnabled: (enabled: boolean) => void;
}

const VideoFeedContext = createContext<VideoFeedPreference | null>(null);

export function VideoFeedProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(true);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    let browserStorage: Storage | null = null;
    try {
      browserStorage = localStorage;
      setEnabledState(
        browserStorage.getItem(VIDEO_FEED_STORAGE_KEY) !== "false",
      );
    } catch {
      setSaved(false);
    }
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (
        browserStorage &&
        event.storageArea === browserStorage &&
        (event.key === VIDEO_FEED_STORAGE_KEY || event.key === null)
      ) {
        setEnabledState(event.newValue !== "false");
        setSaved(true);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try {
      localStorage.setItem(VIDEO_FEED_STORAGE_KEY, String(value));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, []);

  return (
    <VideoFeedContext.Provider value={{ enabled, ready, saved, setEnabled }}>
      {children}
    </VideoFeedContext.Provider>
  );
}

export function useVideoFeed() {
  const context = useContext(VideoFeedContext);
  if (!context) throw new Error("useVideoFeed requires VideoFeedProvider");
  return context;
}
