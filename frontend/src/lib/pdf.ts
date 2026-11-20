// Builds and downloads a styled, tabular PDF report (used for exporting
// sales/product/employee reports) using jsPDF + jspdf-autotable.
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { downloadBlob } from "./download-blob"

// Shared color palette for the generated PDF, matching the app's slate
// theme so exports look consistent with the on-screen receipt/report UI.
const HEADER_FILL: [number, number, number] = [30, 41, 59] // slate-800, matches the receipt's table header
const HEADER_TEXT: [number, number, number] = [255, 255, 255]
const MUTED_TEXT: [number, number, number] = [100, 116, 139] // slate-500
const BODY_TEXT: [number, number, number] = [15, 23, 42] // slate-900
const FOOT_FILL: [number, number, number] = [241, 245, 249] // slate-100

// One table within the report. `heading` is an optional label printed above
// the table; `head`/`body`/`foot` map directly to jspdf-autotable's
// header row, data rows, and optional summary/total footer row.
export interface PdfSection {
  heading?: string
  head: string[]
  body: (string | number)[][]
  foot?: (string | number)[]
}

// Full input for `downloadPdfReport`: page-level header info (business
// name/location, report title, a date/period line) plus one or more table
// sections rendered in order, and an optional footer note at the bottom.
export interface PdfReportOptions {
  businessName: string
  businessLocation?: string | null
  title: string
  dateLine: string
  sections: PdfSection[]
  footerNote?: string
}

// Reads the Y position where the last autoTable finished drawing, so the
// next section (or the footer note) can be placed below it. Falls back to
// 30 if no table has been drawn yet (shouldn't normally happen).
function getFinalY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30
}

/**
 * Generates a multi-section PDF report from `options` and immediately
 * triggers a browser download as `filename`. Renders a header (business
 * name/location on the left, report title/date on the right), then each
 * `PdfSection` as a styled table stacked vertically, then an optional
 * italic footer note centered at the bottom.
 */
export function downloadPdfReport(filename: string, options: PdfReportOptions) {
  const doc = new jsPDF()
  const marginX = 14
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFont("helvetica", "bold")
  doc.setFontSize(13)
  doc.setTextColor(...BODY_TEXT)
  doc.text(options.businessName, marginX, 18)

  doc.setFontSize(15)
  doc.text(options.title, pageWidth - marginX, 18, { align: "right" })

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(...MUTED_TEXT)
  let leftY = 24
  if (options.businessLocation) {
    doc.text(options.businessLocation, marginX, leftY)
    leftY += 5
  }
  doc.text(options.dateLine, pageWidth - marginX, 24, { align: "right" })

  let cursorY = Math.max(leftY, 28) + 4

  for (const section of options.sections) {
    if (section.heading) {
      doc.setFont("helvetica", "bold")
      doc.setFontSize(10)
      doc.setTextColor(...BODY_TEXT)
      doc.text(section.heading, marginX, cursorY)
      cursorY += 5
    }
    autoTable(doc, {
      startY: cursorY,
      head: [section.head],
      body: section.body,
      foot: section.foot ? [section.foot] : undefined,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 9, textColor: BODY_TEXT, cellPadding: 3 },
      headStyles: { fillColor: HEADER_FILL, textColor: HEADER_TEXT, fontStyle: "bold" },
      footStyles: { fillColor: FOOT_FILL, textColor: BODY_TEXT, fontStyle: "bold" },
      theme: "grid",
    })
    cursorY = getFinalY(doc) + 10
  }

  if (options.footerNote) {
    doc.setFont("helvetica", "italic")
    doc.setFontSize(8)
    doc.setTextColor(...MUTED_TEXT)
    doc.text(options.footerNote, pageWidth / 2, cursorY, { align: "center" })
  }

  // Keep CSV and PDF on the same browser download/URL-cleanup path.
  downloadBlob(filename, doc.output("blob"))
}
