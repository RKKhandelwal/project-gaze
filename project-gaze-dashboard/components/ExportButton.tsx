"use client";

import { useEffect, useRef, useState } from "react";
import type { OccupancyPoint } from "@/lib/types";
import { exportOccupancy, type ExportFormat } from "@/lib/exportOccupancy";

interface Props {
  /** Points for the currently selected day. */
  dayPoints: OccupancyPoint[];
  /** Every point in the loaded index. */
  allPoints: OccupancyPoint[];
  selectedDay: string | null;
  tz: string;
}

export default function ExportButton({
  dayPoints,
  allPoints,
  selectedDay,
  tz,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (scope: "day" | "all", format: ExportFormat) => {
    const points = scope === "day" ? dayPoints : allPoints;
    const label = scope === "day" ? selectedDay ?? "day" : "all-days";
    exportOccupancy(points, tz, format, label);
    setOpen(false);
  };

  const disabled = allPoints.length === 0;

  return (
    <div className="export-wrap" ref={wrapRef}>
      <button
        type="button"
        className="export-btn"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden>↓</span> Export
      </button>

      {open && (
        <div className="export-menu" role="menu">
          {selectedDay && (
            <>
              <div className="export-menu-label">
                {selectedDay} · {dayPoints.length} rows
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => run("day", "xlsx")}
                disabled={dayPoints.length === 0}
              >
                Excel (.xls)
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => run("day", "csv")}
                disabled={dayPoints.length === 0}
              >
                CSV
              </button>
              <div className="export-menu-sep" />
            </>
          )}

          <div className="export-menu-label">
            All days · {allPoints.length} rows
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => run("all", "xlsx")}
          >
            Excel (.xls)
          </button>
          <button type="button" role="menuitem" onClick={() => run("all", "csv")}>
            CSV
          </button>

          <div className="export-menu-note">
            Downloads in your browser. Import the file into Google Sheets via
            File → Import.
          </div>
        </div>
      )}
    </div>
  );
}
