import type { OccupancyPoint } from "@/lib/types";
import { dayKeyInTZ, formatHMInTZ, tzOffsetMinutesAt } from "@/lib/tz";

export type ExportFormat = "csv" | "xlsx";

interface Row {
  timestamp: string;
  day: string;
  time: string;
  count: number;
}

/** ±HH:MM offset suffix for an ISO-8601 local timestamp. */
function offsetSuffix(ms: number, tz: string): string {
  const off = tzOffsetMinutesAt(ms, tz);
  if (off === 0) return "Z";
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * ISO-8601 timestamp in the given tz, offset included — e.g.
 * "2026-05-17T13:30-07:00". Spreadsheets parse this as a real datetime, and
 * the offset keeps it unambiguous across DST boundaries.
 */
function localISO(ms: number, tz: string): string {
  return `${dayKeyInTZ(ms, tz)}T${formatHMInTZ(ms, tz)}${offsetSuffix(ms, tz)}`;
}

function toRows(points: OccupancyPoint[], tz: string): Row[] {
  return [...points]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, count]) => ({
      timestamp: localISO(ms, tz),
      day: dayKeyInTZ(ms, tz),
      time: formatHMInTZ(ms, tz),
      count,
    }));
}

const HEADERS = ["Timestamp", "Day", "Time", "Count"] as const;

function csvCell(v: string | number): string {
  const s = String(v);
  // Leading-zero times ("08:30") and dates must survive as text, and anything
  // with a comma or quote needs escaping regardless.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCSV(rows: Row[]): string {
  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [r.timestamp, r.day, r.time, r.count].map(csvCell).join(","),
    );
  }
  // BOM so Excel detects UTF-8; CRLF per RFC 4180.
  return `﻿${lines.join("\r\n")}\r\n`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * SpreadsheetML 2003 — a single-file XML workbook that Excel, Numbers and
 * Google Sheets all open natively. Chosen over real OOXML .xlsx because that
 * needs a ZIP writer (and a dependency); this needs nothing.
 */
function buildXLSX(rows: Row[], sheetName: string): string {
  const cell = (v: string | number, type: "String" | "Number") =>
    `<Cell><Data ss:Type="${type}">${xmlEscape(String(v))}</Data></Cell>`;

  const header = `<Row>${HEADERS.map((h) =>
    `<Cell ss:StyleID="hdr"><Data ss:Type="String">${h}</Data></Cell>`,
  ).join("")}</Row>`;

  const body = rows
    .map(
      (r) =>
        `<Row>${cell(r.timestamp, "String")}${cell(r.day, "String")}` +
        `${cell(r.time, "String")}${cell(r.count, "Number")}</Row>`,
    )
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="hdr"><Font ss:Bold="1"/></Style>
 </Styles>
 <Worksheet ss:Name="${xmlEscape(sheetName)}">
  <Table>
   <Column ss:Width="140"/><Column ss:Width="80"/>
   <Column ss:Width="60"/><Column ss:Width="55"/>
   ${header}${body}
  </Table>
 </Worksheet>
</Workbook>`;
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — Safari needs the URL alive through the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Serialize occupancy points and hand the file to the user. Runs entirely in
 * the browser: no upload, no server round-trip, no credentials.
 */
export function exportOccupancy(
  points: OccupancyPoint[],
  tz: string,
  format: ExportFormat,
  scopeLabel: string,
): number {
  const rows = toRows(points, tz);
  if (rows.length === 0) return 0;

  const slug = scopeLabel.replace(/[^\w-]+/g, "-").toLowerCase();
  const base = `occupancy-${slug}`;

  if (format === "csv") {
    triggerDownload(buildCSV(rows), `${base}.csv`, "text/csv");
  } else {
    triggerDownload(
      buildXLSX(rows, scopeLabel.slice(0, 31)),
      `${base}.xls`,
      "application/vnd.ms-excel",
    );
  }
  return rows.length;
}
