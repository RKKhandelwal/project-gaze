"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import TimezonePicker from "./TimezonePicker";
import { useTimezone } from "@/lib/TimezoneContext";

export default function TopNav() {
  const path = usePathname();
  const { tz, setTz } = useTimezone();

  return (
    <header className="topnav">
      <div className="topnav-brand">
        <Link href="/" className="brand-title">
          McKenzie Park Courts
        </Link>
        <span className="brand-subtitle">
          Los Altos · Pickleball Occupancy Tracker
        </span>
      </div>

      <nav className="topnav-tabs" aria-label="Sections">
        <Link href="/" className={`nav-tab ${path === "/" ? "active" : ""}`}>
          Dashboard
        </Link>
        <Link
          href="/insights"
          className={`nav-tab ${path === "/insights" ? "active" : ""}`}
        >
          Insights
        </Link>
        <Link
          href="/settings"
          className={`nav-tab ${path === "/settings" ? "active" : ""}`}
        >
          Settings
        </Link>
      </nav>

      <div className="topnav-right">
        <TimezonePicker value={tz} onChange={setTz} />
      </div>
    </header>
  );
}
