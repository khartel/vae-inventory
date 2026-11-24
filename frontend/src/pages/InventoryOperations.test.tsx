import { beforeEach, describe, expect, test, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { Role } from "@/types"
import type { StockMovement } from "@/services/stock.service"
import * as stockService from "@/services/stock.service"
import * as warehouseService from "@/services/warehouse.service"
import { downloadCsv } from "@/lib/csv"
import { downloadPdfReport } from "@/lib/pdf"
import Warehouses from "./Warehouses"
import StockMovements from "./StockMovements"

const authState = vi.hoisted(() => ({ role: "ADMIN" as Role }))

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    activeBusinessId: "business-1",
    user: { role: "SUPERADMIN", businesses: [{ id: "business-1", name: "Demo business", roleInBusiness: authState.role }] },
  }),
}))
vi.mock("@/services/warehouse.service")
vi.mock("@/services/stock.service")
vi.mock("@/lib/csv", () => ({ downloadCsv: vi.fn() }))
vi.mock("@/lib/pdf", () => ({ downloadPdfReport: vi.fn() }))

const warehouses = [
  { id: "main", businessId: "business-1", name: "Main warehouse", location: "Accra", isPrimary: true, createdAt: "2026-11-23", updatedAt: "2026-11-23", _count: { stock: 124, transactions: 0 } },
  { id: "depot", businessId: "business-1", name: "Kumasi depot", location: "Kumasi", isPrimary: false, createdAt: "2026-11-23", updatedAt: "2026-11-23", _count: { stock: 68, transactions: 0 } },
]
const baseMovement: StockMovement = {
  id: "restock", type: "RESTOCK", quantity: 40, unitLabel: null, unitQuantity: null,
  status: "COMPLETED", notes: "Supplier delivery", createdAt: "2026-11-23T10:42:00Z",
  fromWarehouse: null, toWarehouse: { id: "main", name: "Main warehouse" },
  product: { id: "rice", name: "Jasmine rice", unit: "bags" },
  movedBy: { id: "ama", fullName: "Ama Mensah", username: "ama" },
  adjustmentReason: null, previousQuantity: null, newQuantity: null,
}
const movements: StockMovement[] = [
  baseMovement,
  { ...baseMovement, id: "transfer", type: "TRANSFER", quantity: 144, unitLabel: "cartons", unitQuantity: 24, product: { id: "oil", name: "Sunflower oil", unit: "bottles" }, fromWarehouse: { id: "main", name: "Main warehouse" }, toWarehouse: { id: "depot", name: "Kumasi depot" } },
  { ...baseMovement, id: "adjustment", type: "ADJUSTMENT", quantity: 2, previousQuantity: 52, newQuantity: 50, adjustmentReason: "MISCOUNTED", product: { id: "sugar", name: "Granulated sugar", unit: "bags" }, notes: "Cycle count" },
  { ...baseMovement, id: "return", type: "RETURN", quantity: 2, product: { id: "return-rice", name: "Returned rice", unit: "bags" } },
]

function renderPage(page: "warehouses" | "movements") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{page === "warehouses" ? <Warehouses /> : <StockMovements />}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.role = "ADMIN"
  vi.mocked(warehouseService.getWarehouses).mockResolvedValue(warehouses)
  vi.mocked(warehouseService.getWarehouseById).mockImplementation(async (_businessId, id) => ({
    ...warehouses.find((warehouse) => warehouse.id === id)!,
    stock: [{ id: "stock-1", quantity: 40, lowStockThreshold: 5, product: { id: "rice", name: "Jasmine rice", unit: "bags" } }],
  }))
  vi.mocked(stockService.getStockMovements).mockResolvedValue(movements)
})

describe("Inventory operations", () => {
  test("expands timeline operations to show all movement types and quantity formats", async () => {
    renderPage("movements")
    const ledger = await screen.findByRole("region", { name: "Stock activity" })
    for (const summary of ledger.querySelectorAll("summary")) fireEvent.click(summary)
    expect(within(ledger).getByText("Jasmine rice")).toBeInTheDocument()
    expect(within(ledger).getByText("40 bags")).toBeInTheDocument()
    expect(within(ledger).getByText("24 cartons")).toBeInTheDocument()
    expect(within(ledger).getByText("52 → 50 bags")).toBeInTheDocument()
    expect(within(ledger).getByText("Miscounted")).toBeInTheDocument()
    expect(within(ledger).getByText("Returned rice")).toBeInTheDocument()
    expect(within(ledger).getByText("2 bags")).toBeInTheDocument()
    expect(within(ledger).getByText("Cycle count")).toBeInTheDocument()
    expect(within(ledger).getAllByText("Ama Mensah")).toHaveLength(4)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  test("one collapsed entry contains a whole batch and identical routes keep separate batches", async () => {
    const transfer = movements[1]
    vi.mocked(stockService.getStockMovements).mockResolvedValue([
      { ...transfer, batchId: "batch-1" },
      { ...transfer, id: "transfer-rice", batchId: "batch-1", product: baseMovement.product, quantity: 40, unitLabel: null, unitQuantity: null },
      { ...transfer, id: "another-transfer", batchId: "batch-2" },
    ])
    renderPage("movements")
    const activity = await screen.findByRole("region", { name: "Stock activity" })
    expect(activity.querySelectorAll("details")).toHaveLength(2)
    expect(screen.getByText("2 products")).toBeInTheDocument()
    expect(screen.getByText("Jasmine rice")).not.toBeVisible()
    fireEvent.click(activity.querySelector("summary")!)
    expect(screen.getByText("Jasmine rice")).toBeVisible()
    expect(screen.getByText("40 bags")).toBeVisible()
    expect(within(activity.querySelector("details")!).getByText("24 cartons")).toBeVisible()
    expect(screen.getAllByText("24 cartons")[1]).not.toBeVisible()
  })

  test("passes date filters to the API, exports the filtered records, and clears filters", async () => {
    const user = userEvent.setup()
    vi.mocked(stockService.getStockMovements).mockImplementation(async (_id, filters) => filters?.startDate ? [movements[1]] : movements)
    renderPage("movements")
    await screen.findByText("Jasmine rice")
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-11-23" } })
    await waitFor(() => expect(stockService.getStockMovements).toHaveBeenLastCalledWith("business-1", expect.objectContaining({ startDate: "2026-11-23" })))
    await waitFor(() => expect(screen.queryByText("Jasmine rice")).not.toBeInTheDocument())
    expect(screen.getByText("1 product")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Download" }))
    await user.click(screen.getByRole("menuitem", { name: "CSV" }))
    expect(downloadCsv).toHaveBeenCalledWith(expect.any(String), [expect.any(Array), expect.arrayContaining(["TRANSFER", "Sunflower oil", 144, "bottles"])])
    await user.click(screen.getByRole("button", { name: "Download" }))
    await user.click(screen.getByRole("menuitem", { name: "PDF" }))
    expect(downloadPdfReport).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ dateLine: "Filtered", sections: [expect.objectContaining({ body: [expect.arrayContaining(["Sunflower oil", "24 cartons"])] })] }))
    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(await screen.findByText("Jasmine rice")).toBeInTheDocument()
    expect(screen.getByLabelText("From date")).toHaveValue("")
  })

  test("warehouse names open the existing inventory detail dialog", async () => {
    const user = userEvent.setup()
    renderPage("warehouses")
    await user.click(await screen.findByRole("button", { name: "Kumasi depot" }))
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("Jasmine rice")).toBeInTheDocument()
    expect(warehouseService.getWarehouseById).toHaveBeenCalledWith("business-1", "depot")
    expect(screen.getByText("192")).toBeInTheDocument()
  })

  test("employees can inspect warehouses without management controls", async () => {
    authState.role = "EMPLOYEE"
    renderPage("warehouses")
    expect(await screen.findByRole("button", { name: "Main warehouse" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "New warehouse" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Delete warehouse" })).not.toBeInTheDocument()
  })

  test("employees can read the timeline without stock mutation controls", async () => {
    authState.role = "EMPLOYEE"
    renderPage("movements")
    expect(await screen.findByText("Jasmine rice")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Move stock" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Adjust stock" })).not.toBeInTheDocument()
  })

  test("an empty ledger shows the empty state and disables export", async () => {
    vi.mocked(stockService.getStockMovements).mockResolvedValue([])
    renderPage("movements")
    expect(await screen.findByText("No stock movements yet")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  test("CSV export includes adjustment counts, direction, reason, and accurate origin labels", async () => {
    const user = userEvent.setup()
    renderPage("movements")
    await screen.findByText("Granulated sugar")
    await user.click(screen.getByRole("button", { name: "Download" }))
    await user.click(screen.getByRole("menuitem", { name: "CSV" }))
    const [, rows] = vi.mocked(downloadCsv).mock.calls[0]
    expect(rows[0]).toEqual(expect.arrayContaining(["Previous quantity", "New quantity", "Delta", "Reason"]))
    const adjustmentRow = rows.find((row) => row.includes("ADJUSTMENT"))
    expect(adjustmentRow).toEqual(expect.arrayContaining(["—", "Main warehouse", 52, 50, -2, "Miscounted"]))
    const returnRow = rows.find((row) => row.includes("RETURN"))
    expect(returnRow).toEqual(expect.arrayContaining(["Customer return", "Main warehouse"]))
  })
})
