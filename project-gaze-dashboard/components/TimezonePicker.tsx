"use client";

import { TIMEZONES, tzAbbrev } from "@/lib/tz";

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export default function TimezonePicker({ value, onChange }: Props) {
  return (
    <label className="tz-picker">
      <span className="tz-picker-label">timezone</span>
      <select
        className="mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {TIMEZONES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label} · {tzAbbrev(t.id)}
          </option>
        ))}
      </select>
    </label>
  );
}
