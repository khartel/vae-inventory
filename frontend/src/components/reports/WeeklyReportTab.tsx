import { ReportToolbar, ReportDateField, ReportMetrics, ReportProfitNote, ReportBreakdowns } from "./ReportLayout"
import { ReportSalesChart, ReportPaymentMix } from "./ReportCharts"
import { Button } from "@/components/ui/button"
import { averageDailySales } from "./report-data"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import * as reportService from "@/services/report.service"
import type { WeeklyReport } from "@/services/report.service"
import { useAuth } from "@/context/AuthContext"
import { useActiveBusiness } from "@/hooks/useActiveBusiness"
import { formatDate, formatMoney } from "@/lib/format"
import { downloadCsv } from "@/lib/csv"
import { downloadPdfReport } from "@/lib/pdf"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { DownloadMenu } from "@/components/reports/DownloadMenu"
import { Skeleton } from "@/components/ui/skeleton"
import { CalendarRange } from "lucide-react"
import { useTranslation } from "react-i18next"

// Today's date as YYYY-MM-DD, used as the default value for the date picker (any day
// within the desired week can be picked; the backend resolves the containing week).
function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// Builds CSV rows for the "Items sold" export: per-product quantity/revenue plus a total row.
function itemsSoldCsvRows(report: WeeklyReport, currency: string) {
  return [
    ["Items sold", `${report.weekStart} to ${report.weekEnd}`],
    ["Currency", currency],
    [],
    ["Product", "Quantity", "Revenue", "Profit"],
    ...report.byProduct.map((row) => [row.product.name, `${row.totalQuantity} ${row.product.unit}`, row.totalRevenue, row.totalProfit]),
    [],
    ["Total", "", report.summary.totalAmount, report.summary.totalProfit],
  ]
}

// Builds CSV rows for the "Full report" export: summary totals, a daily breakdown,
// and breakdowns by employee and by product.
function fullReportCsvRows(report: WeeklyReport, currency: string) {
  return [
    ["Weekly report", `${report.weekStart} to ${report.weekEnd}`],
    ["Currency", currency],
    [],
    ["Total sales", report.summary.totalAmount],
    ["Transactions", report.summary.totalTransactions],
    ["Avg / day", averageDailySales(report.summary, report.dailyBreakdown)],
    ["Best day", report.summary.bestDay?.dayName ?? ""],
    ["Profit", report.summary.hasIncompleteCostData ? `${report.summary.totalProfit} (incomplete cost data)` : report.summary.totalProfit],
    [],
    ["Daily breakdown"],
    ["Date", "Day", "Total", "Transactions", "Profit"],
    ...report.dailyBreakdown.map((d) => [d.date, d.dayName, d.totalAmount, d.transactionCount, d.totalProfit]),
    [],
    ["By employee"],
    ["Employee", "Total", "Transactions", "Profit"],
    ...report.byEmployee.map((row) => [row.employee.fullName, row.totalAmount, row.transactionCount, row.totalProfit]),
    [],
    ["By product"],
    ["Product", "Quantity", "Revenue", "Profit"],
    ...report.byProduct.map((row) => [row.product.name, `${row.totalQuantity} ${row.product.unit}`, row.totalRevenue, row.totalProfit]),
  ]
}

/**
 * Reports tab showing sales for the calendar week containing the selected date:
 * total sales, transaction count, average per day, best day, a per-day bar chart
 * (built from simple `<li>` bars sized by relative amount), and breakdowns by
 * employee and by product. Includes "Items sold" and "Full report" exports (CSV/PDF).
 */
export function WeeklyReportTab() {
  const { t } = useTranslation()
  const { activeBusinessId } = useAuth()
  const activeBusiness = useActiveBusiness()
  const currency = activeBusiness?.currency ?? "USD"
  const [date, setDate] = useState(todayIso)

  const query = useQuery({
    queryKey: ["report-weekly", activeBusinessId, date],
    queryFn: () => reportService.getWeeklyReport(activeBusinessId!, date),
    enabled: !!activeBusinessId && !!date,
  })

  // Shared header fields for every PDF export below.
  const pdfHeader = () => ({
    businessName: activeBusiness?.name ?? "",
    businessLocation: activeBusiness?.location,
    title: "WEEKLY REPORT",
    dateLine: `${formatDate(query.data!.weekStart)} – ${formatDate(query.data!.weekEnd)}`,
  })

  const downloadItemsCsv = () => {
    if (!query.data) return
    downloadCsv(`weekly-items-sold-${query.data.weekStart}-to-${query.data.weekEnd}.csv`, itemsSoldCsvRows(query.data, currency))
  }
  const downloadItemsPdf = () => {
    if (!query.data) return
    const report = query.data
    downloadPdfReport(`weekly-items-sold-${report.weekStart}-to-${report.weekEnd}.pdf`, {
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
    downloadCsv(`weekly-report-${query.data.weekStart}-to-${query.data.weekEnd}.csv`, fullReportCsvRows(query.data, currency))
  }
  const downloadFullPdf = () => {
    if (!query.data) return
    const report = query.data
    downloadPdfReport(`weekly-report-${report.weekStart}-to-${report.weekEnd}.pdf`, {
      ...pdfHeader(),
      sections: [
        {
          heading: "Summary",
          head: ["Metric", "Value"],
          body: [
            ["Total sales", formatMoney(report.summary.totalAmount, currency)],
            ["Transactions", report.summary.totalTransactions],
            ["Avg / day", formatMoney(averageDailySales(report.summary, report.dailyBreakdown), currency)],
            ["Best day", report.summary.bestDay?.dayName ?? ""],
            ["Profit", formatMoney(report.summary.totalProfit, currency) + (report.summary.hasIncompleteCostData ? " *" : "")],
          ],
        },
        {
          heading: "Daily breakdown",
          head: ["Date", "Day", "Total", "Transactions", "Profit"],
          body: report.dailyBreakdown.map((d) => [d.date, d.dayName, formatMoney(d.totalAmount, currency), d.transactionCount, formatMoney(d.totalProfit, currency)]),
        },
        {
          heading: "By employee",
          head: ["Employee", "Total", "Transactions", "Profit"],
          body: report.byEmployee.map((row) => [row.employee.fullName, formatMoney(row.totalAmount, currency), row.transactionCount, formatMoney(row.totalProfit, currency)]),
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
    <ReportToolbar title="Weekly overview" period={query.data ? formatDate(query.data.weekStart + "T12:00:00") + " – " + formatDate(query.data.weekEnd + "T12:00:00") : undefined} actions={
      <DownloadMenu disabled={!query.data || !date} groups={[
        { label: "Items sold", items: [{ label: "CSV", onClick: downloadItemsCsv }, { label: "PDF", onClick: downloadItemsPdf }] },
        { label: "Full report", items: [{ label: "CSV", onClick: downloadFullCsv }, { label: "PDF", onClick: downloadFullPdf }] },
      ]} />
    }><ReportDateField label="Week containing" value={date} onChange={setDate} /><Button variant="ghost" size="sm" onClick={() => setDate(todayIso())}>{t("This week")}</Button></ReportToolbar>
  )
  if (!date) return <div className="report-view">{dateControls}<p className="report-date-error">{t("Select a date to view this report.")}</p></div>
  if (query.isLoading) return <div className="report-view">{dateControls}<Skeleton className="h-64 rounded-xl" /></div>
  if (query.isError) return <div className="report-view">{dateControls}<ErrorState onRetry={() => query.refetch()} /></div>
  const report = query.data
  if (!report) return null
  if (report.summary.totalTransactions === 0) return <div className="report-view">{dateControls}<EmptyState icon={<CalendarRange className="size-6" />} title="No sales this week" description={formatDate(report.weekStart) + " – " + formatDate(report.weekEnd)} /></div>
  return <div className="report-view">
    {dateControls}
    <ReportMetrics summary={report.summary} currency={currency} days={report.dailyBreakdown} />
    <ReportProfitNote incomplete={report.summary.hasIncompleteCostData} />
    <div className="report-overview"><ReportSalesChart description="Gross sales across the calendar week" currency={currency} points={report.dailyBreakdown.map((day) => ({ key: day.date, label: new Date(day.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" }), amount: day.totalAmount, count: day.transactionCount }))} /><ReportPaymentMix summary={report.summary} currency={currency} /></div>
    <ReportBreakdowns employees={report.byEmployee} products={report.byProduct} currency={currency} />
  </div>
}
