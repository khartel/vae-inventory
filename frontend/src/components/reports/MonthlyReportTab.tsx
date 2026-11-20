import { ReportToolbar, ReportDateField, ReportMetrics, ReportProfitNote, ReportBreakdowns } from "./ReportLayout"
import { ReportSalesChart, ReportPaymentMix } from "./ReportCharts"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import * as reportService from "@/services/report.service"
import type { MonthlyReport } from "@/services/report.service"
import { useAuth } from "@/context/AuthContext"
import { useActiveBusiness } from "@/hooks/useActiveBusiness"
import { formatMoney } from "@/lib/format"
import { downloadCsv } from "@/lib/csv"
import { downloadPdfReport } from "@/lib/pdf"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { DownloadMenu } from "@/components/reports/DownloadMenu"
import { Skeleton } from "@/components/ui/skeleton"
import { CalendarDays } from "lucide-react"
import { useTranslation } from "react-i18next"

// Current month as YYYY-MM, the default value for the month picker.
function currentMonthIso() {
  return new Date().toISOString().slice(0, 7)
}

// Builds CSV rows for the "Items sold" export: per-product quantity/revenue plus a total row.
function itemsSoldCsvRows(report: MonthlyReport, currency: string) {
  return [
    ["Items sold", report.month],
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
function fullReportCsvRows(report: MonthlyReport, currency: string) {
  return [
    ["Monthly report", report.month],
    ["Currency", currency],
    [],
    ["Total sales", report.summary.totalAmount],
    ["Transactions", report.summary.totalTransactions],
    ["Avg / day", report.summary.avgDailySales ?? 0],
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
 * Reports tab showing sales for a selected calendar month: total sales, transaction
 * count, average per day, best day, a daily bar chart, and breakdowns by employee and
 * by product. Includes "Items sold" and "Full report" exports (CSV/PDF).
 */
export function MonthlyReportTab() {
  const { t } = useTranslation()
  const { activeBusinessId } = useAuth()
  const activeBusiness = useActiveBusiness()
  const currency = activeBusiness?.currency ?? "USD"
  const [month, setMonth] = useState(currentMonthIso)
  // The <input type="month"> value ("YYYY-MM") is split into numeric year/month for the query.
  const [year, monthNum] = month.split("-").map(Number)

  const query = useQuery({
    queryKey: ["report-monthly", activeBusinessId, year, monthNum],
    queryFn: () => reportService.getMonthlyReport(activeBusinessId!, year, monthNum),
    enabled: !!activeBusinessId && !!month,
  })

  // Shared header fields for every PDF export below.
  const pdfHeader = () => ({
    businessName: activeBusiness?.name ?? "",
    businessLocation: activeBusiness?.location,
    title: "MONTHLY REPORT",
    dateLine: query.data!.month,
  })

  const downloadItemsCsv = () => {
    if (!query.data) return
    downloadCsv(`monthly-items-sold-${query.data.monthStart.slice(0, 7)}.csv`, itemsSoldCsvRows(query.data, currency))
  }
  const downloadItemsPdf = () => {
    if (!query.data) return
    const report = query.data
    downloadPdfReport(`monthly-items-sold-${report.monthStart.slice(0, 7)}.pdf`, {
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
    downloadCsv(`monthly-report-${query.data.monthStart.slice(0, 7)}.csv`, fullReportCsvRows(query.data, currency))
  }
  const downloadFullPdf = () => {
    if (!query.data) return
    const report = query.data
    downloadPdfReport(`monthly-report-${report.monthStart.slice(0, 7)}.pdf`, {
      ...pdfHeader(),
      sections: [
        {
          heading: "Summary",
          head: ["Metric", "Value"],
          body: [
            ["Total sales", formatMoney(report.summary.totalAmount, currency)],
            ["Transactions", report.summary.totalTransactions],
            ["Avg / day", formatMoney(report.summary.avgDailySales ?? 0, currency)],
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
    <ReportToolbar title="Monthly overview" period={query.data ? query.data.month : undefined} actions={
      <DownloadMenu disabled={!query.data || !month} groups={[
        { label: "Items sold", items: [{ label: "CSV", onClick: downloadItemsCsv }, { label: "PDF", onClick: downloadItemsPdf }] },
        { label: "Full report", items: [{ label: "CSV", onClick: downloadFullCsv }, { label: "PDF", onClick: downloadFullPdf }] },
      ]} />
    }><ReportDateField label="Report month" month value={month} onChange={setMonth} /><Button variant="ghost" size="sm" onClick={() => setMonth(currentMonthIso())}>{t("This month")}</Button></ReportToolbar>
  )
  if (!month) return <div className="report-view">{dateControls}<p className="report-date-error">{t("Select a date to view this report.")}</p></div>
  if (query.isLoading) return <div className="report-view">{dateControls}<Skeleton className="h-64 rounded-xl" /></div>
  if (query.isError) return <div className="report-view">{dateControls}<ErrorState onRetry={() => query.refetch()} /></div>
  const report = query.data
  if (!report) return null
  if (report.summary.totalTransactions === 0) return <div className="report-view">{dateControls}<EmptyState icon={<CalendarDays className="size-6" />} title="No sales this month" description={report.month} /></div>
  return <div className="report-view">
    {dateControls}
    <ReportMetrics summary={report.summary} currency={currency} days={report.dailyBreakdown} />
    <ReportProfitNote incomplete={report.summary.hasIncompleteCostData} />
    <div className="report-overview"><ReportSalesChart description="Gross sales across the calendar month" currency={currency} points={report.dailyBreakdown.map((day) => ({ key: day.date, label: String(Number(day.date.slice(-2))), amount: day.totalAmount, count: day.transactionCount }))} /><ReportPaymentMix summary={report.summary} currency={currency} /></div>
    <ReportBreakdowns employees={report.byEmployee} products={report.byProduct} currency={currency} />
  </div>
}
