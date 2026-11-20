import { beforeEach, expect, test, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as reports from "@/services/report.service"
import { downloadCsv } from "@/lib/csv"
import { downloadPdfReport } from "@/lib/pdf"
import { formatMoney } from "@/lib/format"
import Reports from "./Reports"

const scope = vi.hoisted(() => ({ id: "business-a", role: "ADMIN", globalRole: "SUPERADMIN" }))
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ activeBusinessId: scope.id, user: { role: scope.globalRole } }) }))
vi.mock("@/hooks/useActiveBusiness", () => ({ useActiveBusiness: () => ({ id: scope.id, name: "Test store", currency: "GHS", roleInBusiness: scope.role }) }))
vi.mock("@/services/report.service")
vi.mock("@/lib/csv")
vi.mock("@/lib/pdf")
vi.mock("@/components/transactions/TransactionDetailSheet", () => ({
  TransactionDetailSheet: ({ transactionId, businessId }: { transactionId: string | null; businessId: string }) => transactionId ? <div role="dialog" aria-label="Receipt">{businessId} {transactionId}</div> : null,
}))

const profit = { totalCost: 400, totalProfit: 100, hasIncompleteCostData: true }
const summary = { ...profit, totalAmount: 700, totalTransactions: 3, cashTotal: 400, transferTotal: 200 }
const employee = { id: "staff-a", fullName: "Ama Mensah", username: "ama" }
const product = { id: "rice", name: "Rice", unit: "bag" }
const productRow = { ...profit, product, totalQuantity: 3, totalRevenue: 700 }
const employeeRow = { ...profit, employee, totalAmount: 700, transactionCount: 3, cashAmount: 400, transferAmount: 200 }
const transactions = [
  { id: "cash-sale-123", totalAmount: 400, paymentMethod: "CASH" as const },
  { id: "transfer-sale-123", totalAmount: 200, paymentMethod: "TRANSFER" as const },
  { id: "credit-sale-123", totalAmount: 100, paymentMethod: "CREDIT" as const },
].map((transaction) => ({ ...transaction, createdAt: "2026-11-13T10:15:00Z", performedBy: employee, customerName: "Customer" }))
const daily = { date: "2026-11-13", summary: { ...summary, cashTransactions: 1, transferTransactions: 1 }, transactions, byEmployee: [employeeRow], byProduct: [productRow] }
const days = [200, 0, 100, 100, 100, 100, 100].map((totalAmount, index) => ({ ...profit, date: "2026-11-" + String(index + 9), dayName: "Day " + index, totalAmount, transactionCount: totalAmount ? 1 : 0 }))

beforeEach(() => {
  vi.clearAllMocks()
  scope.id = "business-a"; scope.role = "ADMIN"; scope.globalRole = "SUPERADMIN"
  vi.mocked(reports.getDailyReport).mockResolvedValue(daily)
  vi.mocked(reports.getWeeklyReport).mockResolvedValue({ weekStart: "2026-11-09", weekEnd: "2026-11-15", summary, dailyBreakdown: days, byEmployee: [employeeRow], byProduct: [productRow] })
  vi.mocked(reports.getMonthlyReport).mockResolvedValue({ month: "November 2026", monthStart: "2026-11-01", monthEnd: "2026-11-30", summary: { ...summary, avgDailySales: 700 / 30 }, dailyBreakdown: days, byEmployee: [employeeRow], byProduct: [productRow] })
  vi.mocked(reports.getEmployeeReport).mockResolvedValue({ startDate: "2026-11-01", endDate: "2026-11-13", employees: [{ employee, businessRole: "EMPLOYEE", summary: { ...profit, totalAmount: 700, transactionCount: 3, cashTotal: 400, transferTotal: 200 }, topProducts: [productRow], transactions }] })
  vi.mocked(reports.getProductReport).mockResolvedValue({ startDate: "2026-11-01", endDate: "2026-11-13", totalProducts: 1, bestSelling: [{ ...productRow, avgUnitPrice: 700 / 3, currentStock: { total: 14, byWarehouse: [] } }], mostQuantitySold: [{ ...productRow, avgUnitPrice: 700 / 3, currentStock: { total: 14, byWarehouse: [] } }] })
  vi.mocked(reports.getStockAlertReport).mockResolvedValue({ summary: { totalItems: 0, outOfStockCount: 0, lowStockCount: 0, healthyCount: 0 }, outOfStock: [], lowStock: [], healthyStock: [] })
})

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><Reports /></QueryClientProvider>)
}

test("daily report preserves actual totals, credit sale value, date filters, receipt buttons and full CSV export", async () => {
  const user = userEvent.setup()
  show()
  await screen.findByRole("heading", { name: "Sales activity" })
  expect(screen.getByText("Profit is incomplete because some sold products have no recorded cost price.")).toBeInTheDocument()
  const credit = screen.getByText("Credit sales").closest("div")!
  expect(credit).toHaveTextContent(formatMoney(100, "GHS"))
  fireEvent.change(screen.getByLabelText("Report date"), { target: { value: "2026-11-10" } })
  await waitFor(() => expect(reports.getDailyReport).toHaveBeenCalledWith("business-a", "2026-11-10"))
  await user.click(await screen.findByRole("button", { name: "Open receipt CASH-SAL" }))
  expect(screen.getByRole("dialog", { name: "Receipt" })).toHaveTextContent("business-a cash-sale-123")
  await user.click(screen.getByRole("button", { name: "Download" }))
  await user.click(screen.getAllByRole("menuitem", { name: "CSV" })[1])
  expect(downloadCsv).toHaveBeenCalledWith("daily-report-2026-11-13.csv", expect.arrayContaining([["Currency", "GHS"], ["Total sales", 700]]))
})

test("weekly calendar-day average agrees with the export and chart data includes zero-sale days", async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole("tab", { name: "Weekly" }))
  const metric = (await screen.findByText("Avg / day")).closest(".report-metric")!
  expect(metric).toHaveTextContent(formatMoney(100, "GHS"))
  await user.click(screen.getByText("View chart data"))
  const table = screen.getByRole("table", { name: "Daily breakdown" })
  expect(within(table).getAllByRole("row")).toHaveLength(8)
  expect(within(table).getAllByRole("row")[2]).toHaveTextContent(formatMoney(0, "GHS"))
  await user.click(screen.getByRole("button", { name: "Download" }))
  await user.click(screen.getAllByRole("menuitem", { name: "CSV" })[1])
  expect(downloadCsv).toHaveBeenCalledWith(expect.stringContaining("weekly-report-"), expect.arrayContaining([["Avg / day", 100]]))
})

test("monthly filtering and full PDF export retain all daily data and product units", async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole("tab", { name: "Monthly" }))
  await screen.findByText("Avg / day")
  fireEvent.change(screen.getByLabelText("Report month"), { target: { value: "2026-10" } })
  await waitFor(() => expect(reports.getMonthlyReport).toHaveBeenCalledWith("business-a", 2026, 10))
  await user.click(await screen.findByRole("button", { name: "Download" }))
  await user.click(screen.getAllByRole("menuitem", { name: "PDF" })[1])
  expect(downloadPdfReport).toHaveBeenCalledWith(expect.stringContaining("monthly-report-"), expect.objectContaining({ businessName: "Test store", sections: expect.arrayContaining([expect.objectContaining({ heading: "By product", body: expect.arrayContaining([expect.arrayContaining(["Rice", "3 bag"])]) })]) }))
})

test("product date ranges reject reversed dates without fetching or exporting stale data", async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole("tab", { name: "Products" }))
  await screen.findByText("Best selling (by revenue)")
  expect(screen.getByText("3 bag")).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "1999-11-13" } })
  expect(screen.getByRole("status")).toHaveTextContent("Select a valid date range.")
  expect(screen.getByRole("button", { name: "Download" })).toBeDisabled()
  expect(reports.getProductReport).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "1999-11-01" } })
  await waitFor(() => expect(reports.getProductReport).toHaveBeenCalledWith("business-a", "1999-11-01", "1999-11-13"))
})

test("employee receipt drill-down works and business changes reset the selected receipt and report", async () => {
  const user = userEvent.setup()
  const view = show()
  await user.click(screen.getByRole("tab", { name: "Employees" }))
  await user.click(await screen.findByRole("button", { name: "View transactions" }))
  await user.click(screen.getByRole("button", { name: "Open receipt CASH-SAL" }))
  expect(screen.getByRole("dialog", { name: "Receipt" })).toHaveTextContent("business-a cash-sale-123")
  scope.id = "business-b"
  view.rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Reports /></QueryClientProvider>)
  await waitFor(() => expect(reports.getDailyReport).toHaveBeenCalledWith("business-b", expect.any(String)))
  expect(screen.queryByRole("dialog", { name: "Receipt" })).not.toBeInTheDocument()
  expect(screen.getByRole("tab", { name: "Daily" })).toHaveAttribute("aria-selected", "true")
})

test("empty sales and empty stock are honest empty states rather than invented charts or healthy stock", async () => {
  vi.mocked(reports.getDailyReport).mockResolvedValue({ ...daily, summary: { ...daily.summary, totalTransactions: 0, totalAmount: 0 }, transactions: [], byEmployee: [], byProduct: [] })
  const user = userEvent.setup()
  show()
  expect(await screen.findByText("No sales that day")).toBeInTheDocument()
  expect(screen.queryByText("Payment breakdown")).not.toBeInTheDocument()
  await user.click(screen.getByRole("tab", { name: "Stock alerts" }))
  expect(await screen.findByText("No stock entries yet")).toBeInTheDocument()
  expect(screen.queryByText("All stock is healthy")).not.toBeInTheDocument()
})

test("a global owner who is an employee in the active business cannot request reports", () => {
  scope.role = "EMPLOYEE"
  show()
  expect(screen.getByText("Reports are only visible to owners and admins.")).toBeInTheDocument()
  expect(reports.getDailyReport).not.toHaveBeenCalled()
  expect(screen.queryByRole("tab")).not.toBeInTheDocument()
})
