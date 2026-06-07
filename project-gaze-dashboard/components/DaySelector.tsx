import type { DaySummary } from "@/lib/types";
import { shortDateForDayKey, weekdayForDayKey } from "@/lib/tz";

export interface DayEntry {
  key: string;
  summary: DaySummary | null;
}

interface Props {
  days: DayEntry[];
  selected: string | null;
  onSelect: (day: string) => void;
  tz: string;
}

export default function DaySelector({ days, selected, onSelect, tz }: Props) {
  return (
    <div className="day-pills">
      {days.map(({ key, summary }) => {
        const active = key === selected;
        const empty = summary == null;
        return (
          <button
            key={key}
            className={`day-pill ${active ? "active" : ""} ${
              empty ? "empty" : ""
            }`}
            onClick={() => onSelect(key)}
            aria-disabled={empty}
            title={empty ? "No data captured this day" : undefined}
          >
            <div className="day-pill-top">
              <span className="day-pill-name">
                {weekdayForDayKey(key, tz)}
              </span>
              <span className="day-pill-date mono">
                {shortDateForDayKey(key)}
              </span>
            </div>
            <div className="day-pill-stats mono">
              {empty ? (
                <span className="muted">no data</span>
              ) : (
                <>
                  <span className="peak">peak {summary!.max}</span>
                  <span className="muted">{summary!.segments} seg</span>
                </>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
