import type { DailyBreakdownEntry, PeriodSummary, ReportTransaction } from "@/services/report.service"

// Weekly responses omit avgDailySales; use the same full-calendar-period
// denominator as the monthly report, including days with no sales.
export function averageDailySales(summary: PeriodSummary, days: DailyBreakdownEntry[]) {
  return summary.avgDailySales ?? (days.length ? summary.totalAmount / days.length : 0)
}

export function hourlySales(transactions: ReportTransaction[]) {
  return Array.from({ length: 24 }, (_, hour) => {
    const sales = transactions.filter((transaction) => new Date(transaction.createdAt).getHours() === hour)
    return { key: String(hour), label: `${String(hour).padStart(2, "0")}:00`, amount: sales.reduce((total, sale) => total + sale.totalAmount, 0), count: sales.length }
  })
}
