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
import { SummaryStat } from "@/components/reports/SummaryStat"
import { DownloadMenu } from "@/components/reports/DownloadMenu"
import { TransactionDetailSheet } from "@/components/transactions/TransactionDetailSheet"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
    enabled: !!activeBusinessId,
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
    <div className="flex flex-wrap items-center gap-2">
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
      <DownloadMenu
        className="ml-auto"
        disabled={!query.data}
        groups={[
          { label: "Items sold", items: [{ label: "CSV", onClick: downloadItemsCsv }, { label: "PDF", onClick: downloadItemsPdf }] },
          { label: "Full report", items: [{ label: "CSV", onClick: downloadFullCsv }, { label: "PDF", onClick: downloadFullPdf }] },
        ]}
      />
    </div>
  )

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        {dateControls}
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        {dateControls}
        <ErrorState onRetry={() => query.refetch()} />
      </div>
    )
  }
  const report = query.data
  if (!report) return null

  if (report.summary.totalTransactions === 0) {
    return (
      <div className="space-y-4">
        {dateControls}
        <EmptyState icon={<CalendarDays className="size-6" />} title="No sales that day" description={report.date} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {dateControls}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <SummaryStat label="Total sales" value={formatMoney(report.summary.totalAmount, currency)} />
        <SummaryStat label="Transactions" value={report.summary.totalTransactions} />
        <SummaryStat label="Cash" value={formatMoney(report.summary.cashTotal, currency)} />
        <SummaryStat label="Transfer" value={formatMoney(report.summary.transferTotal, currency)} />
        <SummaryStat label="Profit" value={formatMoney(report.summary.totalProfit, currency)} />
      </div>
      {report.summary.hasIncompleteCostData && (
        <p className="text-xs text-muted-foreground">
          {t("Profit is based on products with a recorded cost price — some sales today involved products with no cost price set, so this figure is incomplete.")}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("By employee")}</h3>
          <ul className="space-y-2 text-sm">
            {report.byEmployee.map((row) => (
              <li key={row.employee.id} className="flex justify-between">
                <span>{row.employee.fullName}</span>
                <span className="font-medium">{formatMoney(row.totalAmount, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("By product")}</h3>
          <ul className="space-y-2 text-sm">
            {report.byProduct.map((row) => (
              <li key={row.product.id} className="flex justify-between">
                <span>
                  {row.product.name} × {row.totalQuantity} {row.product.unit}
                </span>
                <span className="text-right">
                  <span className="block font-medium">{formatMoney(row.totalRevenue, currency)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("Profit")}: {formatMoney(row.totalProfit, currency)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Time")}</TableHead>
              <TableHead>{t("Served by")}</TableHead>
              <TableHead>{t("Payment")}</TableHead>
              <TableHead className="text-right">{t("Total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.transactions.map((tx) => (
              <TableRow
                key={tx.id}
                className="cursor-pointer"
                onClick={() => setSelectedTransactionId(tx.id)}
              >
                <TableCell className="text-muted-foreground">{formatTime(tx.createdAt)}</TableCell>
                <TableCell>{tx.performedBy.fullName}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{tx.paymentMethod}</Badge>
                </TableCell>
                <TableCell className="text-right font-medium">{formatMoney(tx.totalAmount, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {activeBusinessId && (
        <TransactionDetailSheet
          businessId={activeBusinessId}
          transactionId={selectedTransactionId}
          onOpenChange={(open) => !open && setSelectedTransactionId(null)}
        />
      )}
    </div>
  )
}
