import { beforeEach, expect, test, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as stockService from "@/services/stock.service"
import * as productService from "@/services/product.service"
import * as warehouseService from "@/services/warehouse.service"
import { MoveStockDialog } from "./MoveStockDialog"

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ activeBusinessId: "business-1" }) }))
vi.mock("@/services/stock.service")
vi.mock("@/services/product.service")
vi.mock("@/services/warehouse.service")

beforeEach(() => {
  vi.clearAllMocks()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  vi.mocked(warehouseService.getWarehouses).mockResolvedValue([
    { id: "source", name: "Warehouse 1" }, { id: "main", name: "Main warehouse" },
  ] as Awaited<ReturnType<typeof warehouseService.getWarehouses>>)
  vi.mocked(productService.getProducts).mockResolvedValue([
    { id: "rice", name: "Rice", unit: "bags", units: [], stock: [{ warehouse: { id: "source" }, quantity: 100 }] },
    { id: "oil", name: "Oil", unit: "pcs", units: [{ label: "carton", factor: 6 }], stock: [{ warehouse: { id: "source" }, quantity: 144 }] },
  ] as Awaited<ReturnType<typeof productService.getProducts>>)
  vi.mocked(stockService.moveStockBatch).mockResolvedValue({ batchId: "batch-1", movements: [] })
})

function renderForm() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MoveStockDialog /></QueryClientProvider>)
}

async function choose(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" })
  fireEvent.click(await screen.findByRole("option", { name: option }))
}

test("submits multiple products on one route with pack conversions in one request", async () => {
  const user = userEvent.setup()
  renderForm()
  await user.click(screen.getByRole("button", { name: "Move stock" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Add another product" })).toBeEnabled())
  await choose("From warehouse", "Warehouse 1")
  await choose("To warehouse", "Main warehouse")
  await choose("Product 1", "Rice")
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "40" } })
  await user.click(screen.getByRole("button", { name: "Add another product" }))
  await choose("Product 2", "Oil")
  const quantities = screen.getAllByLabelText("Quantity")
  fireEvent.change(quantities[1], { target: { value: "2" } })
  const units = screen.getAllByRole("combobox", { name: "Unit" })
  fireEvent.keyDown(units[1], { key: "Enter" })
  fireEvent.click(await screen.findByRole("option", { name: "carton" }))
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move stock" }))
  await waitFor(() => expect(stockService.moveStockBatch).toHaveBeenCalledWith("business-1", {
    fromWarehouseId: "source", toWarehouseId: "main", notes: "",
    items: [{ productId: "rice", quantity: 40 }, { productId: "oil", quantity: 12, unitLabel: "carton", unitQuantity: 2 }],
  }))
  expect(stockService.moveStock).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

test("validation blocks an empty transfer without calling the API", async () => {
  const user = userEvent.setup()
  renderForm()
  await user.click(screen.getByRole("button", { name: "Move stock" }))
  const dialog = await screen.findByRole("dialog")
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Move stock" })).toBeEnabled())
  await user.click(within(dialog).getByRole("button", { name: "Move stock" }))
  expect(await screen.findByText("Select a source warehouse")).toBeInTheDocument()
  expect(stockService.moveStockBatch).not.toHaveBeenCalled()
})
