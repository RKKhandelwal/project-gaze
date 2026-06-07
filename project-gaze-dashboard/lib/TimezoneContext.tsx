"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { DEFAULT_TIMEZONE } from "./tz";

interface Ctx {
  tz: string;
  setTz: (id: string) => void;
}

const TimezoneContext = createContext<Ctx>({
  tz: DEFAULT_TIMEZONE,
  setTz: () => {},
});

const TZ_STORAGE_KEY = "gaze.timezone";

export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const [tz, setTzState] = useState<string>(DEFAULT_TIMEZONE);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TZ_STORAGE_KEY);
      if (saved) setTzState(saved);
    } catch {}
  }, []);

  const setTz = useCallback((id: string) => {
    setTzState(id);
    try {
      window.localStorage.setItem(TZ_STORAGE_KEY, id);
    } catch {}
  }, []);

  return (
    <TimezoneContext.Provider value={{ tz, setTz }}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone(): Ctx {
  return useContext(TimezoneContext);
}
