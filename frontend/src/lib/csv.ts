// Small helper for building and downloading CSV files client-side (used by
// report/export features so users can save data as a spreadsheet).
import { downloadBlob } from "./download-blob"

// Escapes a single CSV cell value: wraps it in double quotes (and doubles
// any internal quotes) if it contains a comma, quote, or newline that would
// otherwise break the CSV format.
function escapeCsvCell(value: string | number): string {
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

/**
 * Converts a 2D array of cells into a CSV string. The first row is expected
 * to be the header row by convention (not enforced here), each subsequent
 * row a data row. Cells are escaped individually via `escapeCsvCell`.
 */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")
}

/**
 * Builds a CSV file from `rows` (see `toCsv`) and triggers a browser
 * download of it as `filename`, using a temporary object URL and an
 * invisible anchor click — no server round-trip involved.
 */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" })
  downloadBlob(filename, blob)
}
