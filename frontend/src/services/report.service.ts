// Wrappers around the /businesses/:businessId/reports endpoints — read-only
// analytics views (daily/weekly/monthly sales, employee performance, product
// performance, and stock health) used by the Reports page and exports.
import { apiClient, apiRequest } from "@/lib/api-client"

// Minimal employee reference embedded in report breakdowns.
interface Employee {
  id: string
  fullName: string
  username: string
  role?: string
}

// Minimal product reference embedded in report breakdowns.
interface ProductRef {
  id: string
  name: string
  unit: string
  description?: string | null
}

// Cost/profit figures alongside a revenue total (Phase G, 2026-08-16).
// SuperAdmin/Admin only - Reports as a whole are already gated to those
// roles server-side, so this never reaches an Employee. `totalCost`/
// `totalProfit` only ever reflect items with a recorded cost price -
// `hasIncompleteCostData` flags when some of the underlying sales involved
// a product with no cost price, so the UI can show a caveat instead of a
// misleadingly precise (and understated-cost) number.
export interface CostProfit {
  totalCost: number
  totalProfit: number
  hasIncompleteCostData: boolean
}

// Aggregate sales totals for a reporting period, split by payment method.
// `bestDay`/`avgDailySales` only appear on multi-day reports (weekly/monthly).
export interface PeriodSummary extends CostProfit {
  totalAmount: number
  totalTransactions: number
  cashTotal: number
  transferTotal: number
  avgDailySales?: number
  bestDay?: { date: string; dayName: string; totalAmount: number; transactionCount: number }
}

// Sales performance for a single product within a reporting period.
export interface ProductBreakdown extends CostProfit {
  product: ProductRef
  totalQuantity: number
  totalRevenue: number
  timesSold?: number
}

// Sales performance for a single employee within a reporting period.
export interface EmployeeBreakdown extends CostProfit {
  employee: Employee
  totalAmount: number
  transactionCount: number
}

// A transaction as embedded in a report's raw transaction list — just
// enough to render a compact drill-down row. Opening one for the full
// receipt (payments, line items, etc.) goes through
// `TransactionDetailSheet`, which re-fetches the complete record by id
// via `transaction.service.ts`'s `getTransactionById` — this lighter
// shape is deliberately not the full `Transaction` type from there.
export interface ReportTransaction {
  id: string
  createdAt: string
  totalAmount: number
  paymentMethod: "CASH" | "TRANSFER" | "CREDIT"
  customerName: string
  performedBy: { id: string; fullName: string; username: string }
}

// Full report for a single calendar day.
export interface DailyReport {
  date: string
  summary: PeriodSummary & { cashTransactions: number; transferTransactions: number }
  transactions: ReportTransaction[]
  byEmployee: Array<EmployeeBreakdown & { cashAmount: number; transferAmount: number }>
  byProduct: ProductBreakdown[]
}

// One day's totals within a multi-day breakdown list.
export interface DailyBreakdownEntry extends CostProfit {
  date: string
  dayName: string
  totalAmount: number
  transactionCount: number
  cashTotal?: number
  transferTotal?: number
}

// Full report for a calendar week (Mon–Sun, per `weekStart`/`weekEnd`).
export interface WeeklyReport {
  weekStart: string
  weekEnd: string
  summary: PeriodSummary
  dailyBreakdown: DailyBreakdownEntry[]
  byEmployee: EmployeeBreakdown[]
  byProduct: ProductBreakdown[]
}

// Full report for a calendar month.
export interface MonthlyReport {
  month: string
  monthStart: string
  monthEnd: string
  summary: PeriodSummary
  dailyBreakdown: DailyBreakdownEntry[]
  byEmployee: EmployeeBreakdown[]
  byProduct: ProductBreakdown[]
}

// Per-employee performance report over a date range, including each
// employee's `businessRole` and their top-selling products.
export interface EmployeeReport {
  startDate: string
  endDate: string
  employees: Array<{
    employee: Employee
    businessRole: string
    summary: CostProfit & { totalAmount: number; transactionCount: number; cashTotal: number; transferTotal: number }
    topProducts: ProductBreakdown[]
    transactions: ReportTransaction[]
  }>
}

// A product's sales breakdown enriched with pricing and live stock levels.
export interface ProductReportItem extends ProductBreakdown {
  avgUnitPrice: number
  currentStock: {
    total: number
    byWarehouse: Array<{ warehouse: { id: string; name: string; isPrimary: boolean }; quantity: number }>
  }
}

// Product performance report over a date range: top sellers by revenue
// (`bestSelling`) and by units moved (`mostQuantitySold`).
export interface ProductReport {
  startDate: string
  endDate: string
  totalProducts: number
  bestSelling: ProductReportItem[]
  mostQuantitySold: ProductReportItem[]
}

// A single stock item flagged in the stock-health report.
export interface StockAlertItem {
  id: string
  quantity: number
  lowStockThreshold: number
  product: ProductRef
  warehouse: { id: string; name: string; isPrimary: boolean }
}

// Current stock-health snapshot, bucketing every stock entry into
// out-of-stock / low-stock / healthy.
export interface StockAlertReport {
  summary: { totalItems: number; outOfStockCount: number; lowStockCount: number; healthyCount: number }
  outOfStock: StockAlertItem[]
  lowStock: StockAlertItem[]
  healthyStock: StockAlertItem[]
}

/** Fetches the sales report for a single day (defaults to today if `date` omitted). */
export const getDailyReport = (businessId: string, date?: string) =>
  apiRequest<DailyReport>(apiClient.get(`/businesses/${businessId}/reports/daily`, { params: { date } }))

/** Fetches the sales report for the calendar week containing `date` (defaults to the current week). */
export const getWeeklyReport = (businessId: string, date?: string) =>
  apiRequest<WeeklyReport>(apiClient.get(`/businesses/${businessId}/reports/weekly`, { params: { date } }))

/** Fetches the sales report for a given month/year (defaults to the current month). */
export const getMonthlyReport = (businessId: string, year?: number, month?: number) =>
  apiRequest<MonthlyReport>(apiClient.get(`/businesses/${businessId}/reports/monthly`, { params: { year, month } }))

/** Fetches per-employee performance over an optional date range (defaults set server-side). */
export const getEmployeeReport = (businessId: string, startDate?: string, endDate?: string) =>
  apiRequest<EmployeeReport>(
    apiClient.get(`/businesses/${businessId}/reports/employees`, { params: { startDate, endDate } })
  )

/** Fetches per-product performance over an optional date range (defaults set server-side). */
export const getProductReport = (businessId: string, startDate?: string, endDate?: string) =>
  apiRequest<ProductReport>(
    apiClient.get(`/businesses/${businessId}/reports/products`, { params: { startDate, endDate } })
  )

/** Fetches the current stock-health snapshot (out-of-stock/low-stock/healthy counts and items). */
export const getStockAlertReport = (businessId: string) =>
  apiRequest<StockAlertReport>(apiClient.get(`/businesses/${businessId}/reports/stock`))
