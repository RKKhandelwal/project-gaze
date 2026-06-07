"use client";

import { useEffect, useState } from "react";
import type { IndexData } from "./types";

export type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string; status?: number }
  | { kind: "ready"; data: IndexData };

export function useIndexData(): LoadState {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/index")
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw Object.assign(new Error(body?.error || `HTTP ${r.status}`), {
            status: r.status,
          });
        }
        return r.json() as Promise<IndexData>;
      })
      .then((data) => {
        if (cancelled) return;
        setState({ kind: "ready", data });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err?.message || "Failed to load index",
          status: err?.status,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
