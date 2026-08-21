import type { OccupancyPoint } from "@/lib/types";
import { dayKeyInTZ, formatHMInTZ } from "@/lib/tz";

export type ExportFormat = "csv" | "xlsx";

interface Row {
  /** "YYYY-MM-DDTHH:MM:SS" with no zone — a wall-clock time in the export tz. */
  isoLocal: string;
  /** "YYYY-MM-DD HH:MM" for CSV, which has no cell types to lean on. */
  display: string;
  count: number;
}

function toRows(points: OccupancyPoint[], tz: string): Row[] {
  return [...points]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, count]) => {
      const day = dayKeyInTZ(ms, tz);
      const hm = formatHMInTZ(ms, tz);
      return {
        // SpreadsheetML DateTime requires seconds and rejects a zone suffix.
        isoLocal: `${day}T${hm}:00`,
        display: `${day} ${hm}`,
        count,
      };
    });
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCSV(rows: Row[], tzLabel: string): string {
  const lines = [`Timestamp (${tzLabel}),Count`];
  for (const r of rows) {
    lines.push([r.display, r.count].map(csvCell).join(","));
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
 *
 * Timestamps are emitted as ss:Type="DateTime" with a display format, so they
 * land as real dates: right-aligned, chronologically sortable, and usable in
 * charts and pivot tables.
 */
function buildXLSX(rows: Row[], sheetName: string, tzLabel: string): string {
  const header =
    `<Row ss:AutoFitHeight="0" ss:Height="17">` +
    `<Cell ss:StyleID="hdr"><Data ss:Type="String">Timestamp (${xmlEscape(
      tzLabel,
    )})</Data></Cell>` +
    `<Cell ss:StyleID="hdr"><Data ss:Type="String">Count</Data></Cell>` +
    `</Row>`;

  const body = rows
    .map(
      (r) =>
        `<Row><Cell ss:StyleID="ts"><Data ss:Type="DateTime">${r.isoLocal}` +
        `</Data></Cell><Cell ss:StyleID="num"><Data ss:Type="Number">` +
        `${r.count}</Data></Cell></Row>`,
    )
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/></Style>
  <Style ss:ID="hdr">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="ts">
   <NumberFormat ss:Format="yyyy\\-mm\\-dd\\ hh:mm"/>
   <Alignment ss:Horizontal="Left"/>
  </Style>
  <Style ss:ID="num">
   <NumberFormat ss:Format="0"/>
   <Alignment ss:Horizontal="Right"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${xmlEscape(sheetName)}">
  <Table ss:DefaultRowHeight="15">
   <Column ss:Width="120"/>
   <Column ss:Width="60"/>
   ${header}${body}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/>
   <FrozenNoSplit/>
   <SplitHorizontal>1</SplitHorizontal>
   <TopRowBottomPane>1</TopRowBottomPane>
   <ActivePane>2</ActivePane>
  </WorksheetOptions>
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
  tzLabel: string,
): number {
  const rows = toRows(points, tz);
  if (rows.length === 0) return 0;

  const slug = scopeLabel.replace(/[^\w-]+/g, "-").toLowerCase();
  const base = `occupancy-${slug}`;

  if (format === "csv") {
    triggerDownload(buildCSV(rows, tzLabel), `${base}.csv`, "text/csv");
  } else {
    // Excel caps sheet names at 31 chars and forbids : \ / ? * [ ]
    const sheet = scopeLabel.replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
    triggerDownload(
      buildXLSX(rows, sheet, tzLabel),
      `${base}.xls`,
      "application/vnd.ms-excel",
    );
  }
  return rows.length;
}
