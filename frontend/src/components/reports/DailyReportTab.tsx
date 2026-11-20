import { ReportToolbar, ReportDateField, ReportMetrics, ReportProfitNote, ReportBreakdowns, ReportPanel } from "./ReportLayout"
import { ReportSalesChart, ReportPaymentMix } from "./ReportCharts"
import { Button } from "@/components/ui/button"
import { hourlySales } from "./report-data"
import { ReceiptText } from "lucide-react"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import * as reportService from "@/services/report.service"
import type { DailyReport } from "@/services/report.service"
import { useAuth } from "@/context/AuthContext"
import { useActiveBusiness } from "@/hooks/useActiveBusiness"
import { formatDate, formatMoney } from "@/lib/format"
import { downloadCsv } from "@/lib/csv"
import { downloadPdfReport } from "@/lib/pdf"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { DownloadMenu } from "@/components/reports/DownloadMenu"
import { TransactionDetailSheet } from "@/components/transactions/TransactionDetailSheet"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CalendarDays } from "lucide-react"
import { useTranslation } from "react-i18next"

// Today's date as YYYY-MM-DD, used as the default value for the date picker.
function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// Time-only (e.g. "2:45 PM"), for the transaction list rows below — the
// date itself is already the tab's own context, so repeating it per row
// would be redundant.
function formatTime(date: string) {
  return new Date(date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

// Builds CSV rows for the "Items sold" export: just the per-product quantity/revenue
// breakdown plus a total row.
function itemsSoldCsvRows(report: DailyReport, currency: string) {
  return [
    ["Items sold", report.date],
    ["Currency", currency],
    [],
    ["Product", "Quantity", "Revenue", "Profit"],
    ...report.byProduct.map((row) => [
      row.product.name,
      `${row.totalQuantity} ${row.product.unit}`,
      row.totalRevenue,
      row.hasIncompleteCostData ? `${row.totalProfit} (incomplete cost data)` : row.totalProfit,
    ]),
    [],
    ["Total", "", report.summary.totalAmount, report.summary.totalProfit],
  ]
}

// Builds CSV rows for the "Full report" export: summary totals plus breakdowns by
// employee and by product.
function fullReportCsvRows(report: DailyReport, currency: string) {
  return [
    ["Daily report", report.date],
    ["Currency", currency],
    [],
    ["Total sales", report.summary.totalAmount],
    ["Transactions", report.summary.totalTransactions],
    ["Cash", report.summary.cashTotal],
    ["Transfer", report.summary.transferTotal],
    ["Profit", report.summary.hasIncompleteCostData ? `${report.summary.totalProfit} (incomplete cost data)` : report.summary.totalProfit],
    [],
    ["By employee"],
    ["Employee", "Total", "Cash", "Transfer", "Profit"],
    ...report.byEmployee.map((row) => [row.employee.fullName, row.totalAmount, row.cashAmount, row.transferAmount, row.totalProfit]),
    [],
    ["By product"],
    ["Product", "Quantity", "Revenue", "Profit"],
    ...report.byProduct.map((row) => [row.product.name, `${row.totalQuantity} ${row.product.unit}`, row.totalRevenue, row.totalProfit]),
  ]
}

/**
 * Reports tab showing sales for a single selected day: total sales, transaction count,
 * cash vs transfer totals, breakdowns by employee and by product, and the actual list
 * of that day's transactions (each opening the real receipt via
 * `TransactionDetailSheet` — the same drill-down component Register's History tab and
 * the Customers page already use). Includes a date picker (defaults to today) and a
 * Download menu offering "Items sold" and "Full report" exports, each as CSV or PDF.
 */
export function DailyReportTab() {
  const { t } = useTranslation()
  const { activeBusinessId } = useAuth()
  const activeBusiness = useActiveBusiness()
  const currency = activeBusiness?.currency ?? "USD"
  const [date, setDate] = useState(todayIso)
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ["report-daily", activeBusinessId, date],
    queryFn: () => reportService.getDailyReport(activeBusinessId!, date),
    enabled: !!activeBusinessId && !!date,
  })

  // Shared header fields (business name/location, report title, date line) passed to
  // every PDF export below.
  const pdfHeader = () => ({
    businessName: activeBusiness?.name ?? "",
    businessLocation: activeBusiness?.location,
    title: "DAILY REPORT",
    dateLine: formatDate(query.data!.date),
  })

  const downloadItemsCsv = () => {
    if (!query.data) return
    downloadCsv(`daily-items-sold-${query.data.date}.csv`, itemsSoldCsvRows(query.data, currency))
  }
  const downloadItemsPdf = () => {
    if (!query.data) return
    const report = query.data
    downloadPdfReport(`daily-items-sold-${report.date}.pdf`, {
      ...pdfHeader(),
      sections: [
        {
          head: ["Product", "Quantity", "Revenue", "Profit"],
          body: report.byProduct.map((row) => [row.product.name, `${row.totalQuantity} ${row.product.unit}`, formatMoney(row.totalRevenue, currency), formatMoney(row.totalProfit, currency)]),
          foot: ["Total", "", formatMoney(report.summary.totalAmount, currency), formatMoney(report.summary.totalProfit, currency)],
        },
      ],
      footerNote: "Generated by VAE Inventory",
    })
  }
  const downloadFullCsv = () => {
    if (!query.data) return
    downloadCsv(`daily-report-${query.data.date}.csv`, fullReportCsvRows(query.data, currency))
  }
  const downloadFullPdf = () => {
    if (!query.data) return
    const report = query.data
    downloadPdfReport(`daily-report-${report.date}.pdf`, {
      ...pdfHeader(),
      sections: [
        {
          heading: "Summary",
          head: ["Metric", "Value"],
          body: [
            ["Total sales", formatMoney(report.summary.totalAmount, currency)],
            ["Transactions", report.summary.totalTransactions],
            ["Cash", formatMoney(report.summary.cashTotal, currency)],
            ["Transfer", formatMoney(report.summary.transferTotal, currency)],
            ["Profit", formatMoney(report.summary.totalProfit, currency) + (report.summary.hasIncompleteCostData ? " *" : "")],
          ],
        },
        {
          heading: "By employee",
          head: ["Employee", "Total", "Cash", "Transfer", "Profit"],
          body: report.byEmployee.map((row) => [
            row.employee.fullName,
            formatMoney(row.totalAmount, currency),
            formatMoney(row.cashAmount, currency),
            formatMoney(row.transferAmount, currency),
            formatMoney(row.totalProfit, currency),
          ]),
        },
        {
          heading: "By product",
          head: ["Product", "Quantity", "Revenue", "Profit"],
          body: report.byProduct.map((row) => [row.product.name, `${row.totalQuantity} ${row.product.unit}`, formatMoney(row.totalRevenue, currency), formatMoney(row.totalProfit, currency)]),
          foot: ["Total", "", formatMoney(report.summary.totalAmount, currency), formatMoney(report.summary.totalProfit, currency)],
        },
      ],
      footerNote: "Generated by VAE Inventory",
    })
  }

  const dateControls = (
    <ReportToolbar title="Daily overview" period={date ? formatDate(date + "T12:00:00") : undefined} actions={
      <DownloadMenu disabled={!query.data || !date} groups={[
        { label: "Items sold", items: [{ label: "CSV", onClick: downloadItemsCsv }, { label: "PDF", onClick: downloadItemsPdf }] },
        { label: "Full report", items: [{ label: "CSV", onClick: downloadFullCsv }, { label: "PDF", onClick: downloadFullPdf }] },
      ]} />
    }><ReportDateField label="Report date" value={date} onChange={setDate} /><Button variant="ghost" size="sm" onClick={() => setDate(todayIso())}>{t("Today")}</Button></ReportToolbar>
  )
  if (!date) return <div className="report-view">{dateControls}<p className="report-date-error">{t("Select a date to view this report.")}</p></div>
  if (query.isLoading) return <div className="report-view">{dateControls}<Skeleton className="h-64 rounded-xl" /></div>
  if (query.isError) return <div className="report-view">{dateControls}<ErrorState onRetry={() => query.refetch()} /></div>
  const report = query.data
  if (!report) return null
  if (report.summary.totalTransactions === 0) return <div className="report-view">{dateControls}<EmptyState icon={<CalendarDays className="size-6" />} title="No sales that day" description={report.date} /></div>

  return <div className="report-view">
    {dateControls}
    <ReportMetrics summary={report.summary} currency={currency} />
    <ReportProfitNote incomplete={report.summary.hasIncompleteCostData} />
    <div className="report-overview"><ReportSalesChart title="Sales activity" description="Sales by hour · local time" points={hourlySales(report.transactions)} currency={currency} /><ReportPaymentMix summary={report.summary} currency={currency} /></div>
    <ReportBreakdowns employees={report.byEmployee} products={report.byProduct} currency={currency} />
    <ReportPanel title="Transactions" description="Open a receipt to see the full sale." icon={ReceiptText} className="report-table-panel">
      <Table><TableHeader><TableRow><TableHead>{t("Receipt #")}</TableHead><TableHead>{t("Time")}</TableHead><TableHead>{t("Served by")}</TableHead><TableHead>{t("Payment")}</TableHead><TableHead className="text-right">{t("Total")}</TableHead></TableRow></TableHeader><TableBody>
        {report.transactions.map((tx) => <TableRow key={tx.id} className="cursor-pointer" onClick={() => setSelectedTransactionId(tx.id)}>
          <TableCell><button type="button" className="report-receipt-link" onClick={() => setSelectedTransactionId(tx.id)} aria-label={t("Open receipt {{id}}", { id: tx.id.slice(0, 8).toUpperCase() })}>{tx.id.slice(0, 8).toUpperCase()}</button></TableCell>
          <TableCell className="text-muted-foreground">{formatTime(tx.createdAt)}</TableCell><TableCell>{tx.performedBy.fullName}</TableCell><TableCell><Badge variant="secondary">{t(tx.paymentMethod)}</Badge></TableCell><TableCell className="text-right font-medium">{formatMoney(tx.totalAmount, currency)}</TableCell>
        </TableRow>)}
      </TableBody></Table>
    </ReportPanel>
    {activeBusinessId && <TransactionDetailSheet businessId={activeBusinessId} transactionId={selectedTransactionId} onOpenChange={(open) => !open && setSelectedTransactionId(null)} />}
  </div>
}
