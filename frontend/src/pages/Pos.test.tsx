import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as products from "@/services/product.service"
import * as transactions from "@/services/transaction.service"
import * as customers from "@/services/customer.service"
import { formatMoney } from "@/lib/format"
import Pos from "./Pos"

const auth = vi.hoisted(() => ({ activeBusinessId: "business-a", user: { role: "SUPERADMIN", businesses: [{ id: "business-a", role: "SUPERADMIN" }] } }))
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }))
vi.mock("@/hooks/useActiveBusiness", () => ({ useActiveBusiness: () => ({ currency: "USD" }), useActiveBusinessRole: () => auth.user.role }))
vi.mock("@/services/product.service")
vi.mock("@/services/transaction.service")
vi.mock("@/services/customer.service")
vi.mock("@/components/customers/CustomerFormDialog", () => ({ CustomerFormDialog: () => null }))
vi.mock("@/components/transactions/TransactionDetailSheet", () => ({ TransactionDetailSheet: ({ transactionId }: { transactionId: string | null }) => transactionId ? <div>Receipt {transactionId}</div> : null }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
const product = { id: "product-a", businessId: "business-a", name: "Test soap", shortCode: "SP01", unit: "pcs", price: 10, units: [], primaryStock: { quantity: 25 }, stock: [], totalQuantity: 25 } as unknown as products.Product
const completed = { id: "sale-a", totalAmount: 10, changeGiven: null } as transactions.Transaction
beforeEach(() => {
  vi.resetAllMocks()
  auth.activeBusinessId = "business-a"
  vi.mocked(products.getProducts).mockResolvedValue([product])
  vi.mocked(transactions.createTransaction).mockResolvedValue(completed)
  vi.mocked(transactions.getTransactions).mockResolvedValue({ transactions: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })
  vi.mocked(customers.getCustomers).mockResolvedValue([{ id: "customer-a", name: "Ama Mensah", phone: "+233241234567" }] as customers.Customer[])
})
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><Pos /></QueryClientProvider>)
  return { ...view, client }
}
async function add(quantity = "1", pack = "pcs") {
  fireEvent.click(await screen.findByRole("button", { name: "Add Test soap" }))
  fireEvent.change(screen.getByRole("combobox", { name: "Pack size" }), { target: { value: pack } })
  fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: quantity } })
  fireEvent.click(screen.getByRole("button", { name: "Add to basket" }))
}
async function payment() { fireEvent.click(screen.getByRole("button", { name: "Continue to payment" })) }
const charge = (amount: number) => screen.getByRole("button", { name: `Charge ${formatMoney(amount, "USD")}` })

test("checks stock across all packs when adding, editing and increasing quantities", async () => {
  setup()
  await add("2")
  await add("1", "dozen")
  const increments = screen.getAllByRole("button", { name: "Increase quantity of Test soap" })
  expect(increments[0]).toBeEnabled()
  expect(increments[1]).toBeDisabled()
  fireEvent.click(screen.getAllByRole("button", { name: "Edit Test soap" })[1])
  fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "2" } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  await add("11")
  expect(screen.getByRole("button", { name: "Add Test soap" })).toBeDisabled()
  screen.getAllByRole("button", { name: "Increase quantity of Test soap" }).forEach((button) => expect(button).toBeDisabled())
  expect(within(screen.getByRole("region", { name: "Your basket" })).getByText(formatMoney(250, "USD"), { selector: "strong" })).toBeInTheDocument()
}, 10000)

test("records the agreed discounted pack price in base units and opens its receipt", async () => {
  setup()
  await add("1", "dozen")
  fireEvent.click(screen.getByRole("button", { name: "Edit Test soap" }))
  fireEvent.change(screen.getByRole("spinbutton", { name: "Discount (%)" }), { target: { value: "10" } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await payment()
  vi.mocked(transactions.createTransaction).mockResolvedValue({ ...completed, totalAmount: 108, changeGiven: 12 })
  fireEvent.change(screen.getByRole("spinbutton", { name: "Cash received · optional" }), { target: { value: "120" } })
  expect(screen.getByText(formatMoney(12, "USD"))).toBeInTheDocument()
  fireEvent.click(charge(108))
  await screen.findByText("Sale complete")
  expect(transactions.createTransaction).toHaveBeenCalledWith("business-a", expect.objectContaining({ paymentMethod: "CASH", amountTendered: 120, items: [{ productId: product.id, quantitySold: 12, unitPrice: 9, discountPercent: 10, unitLabel: "dozen", unitQuantity: 1 }] }))
  fireEvent.click(screen.getByRole("button", { name: "Print receipt" }))
  expect(screen.getByText("Receipt sale-a")).toBeInTheDocument()
})

test("requires selecting a saved customer for credit and clears the selection across payment methods", async () => {
  setup()
  await add()
  await payment()
  fireEvent.click(screen.getByRole("button", { name: "Credit" }))
  const input = screen.getByPlaceholderText("Search for an existing customer")
  fireEvent.change(input, { target: { value: "Ama" } })
  fireEvent.focus(input)
  fireEvent.click(charge(10))
  expect(await screen.findByText("Select an existing customer for credit sales")).toBeInTheDocument()
  expect(transactions.createTransaction).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole("button", { name: /Ama Mensah/ }))
  fireEvent.click(screen.getByRole("button", { name: "Transfer" }))
  expect(screen.getByPlaceholderText("Customer name (optional)")).toHaveValue("")
  fireEvent.click(screen.getByRole("button", { name: "Credit" }))
  expect(screen.getByPlaceholderText("Search for an existing customer")).toHaveValue("")
  fireEvent.click(charge(10))
  expect(transactions.createTransaction).not.toHaveBeenCalled()
  fireEvent.change(screen.getByPlaceholderText("Search for an existing customer"), { target: { value: "Ama" } })
  fireEvent.focus(screen.getByPlaceholderText("Search for an existing customer"))
  fireEvent.click(await screen.findByRole("button", { name: /Ama Mensah/ }))
  fireEvent.click(charge(10))
  await screen.findByText("Sale complete")
  expect(transactions.createTransaction).toHaveBeenCalledWith("business-a", expect.objectContaining({ paymentMethod: "CREDIT", customerId: "customer-a", amountTendered: undefined }))
})

test("rejects insufficient cash and permits only one submission while payment is pending", async () => {
  setup()
  await add()
  await payment()
  fireEvent.change(screen.getByRole("spinbutton", { name: "Cash received · optional" }), { target: { value: "5" } })
  fireEvent.click(charge(10))
  expect(screen.getByRole("alert")).toHaveTextContent("Amount received can't be less than the total")
  expect(transactions.createTransaction).not.toHaveBeenCalled()
  let resolve!: (value: transactions.Transaction) => void
  vi.mocked(transactions.createTransaction).mockImplementation(() => new Promise((done) => { resolve = done }))
  fireEvent.change(screen.getByRole("spinbutton", { name: "Cash received · optional" }), { target: { value: "20" } })
  const button = charge(10)
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => expect(transactions.createTransaction).toHaveBeenCalledTimes(1))
  expect(screen.getByRole("button", { name: "Recording sale…" })).toBeDisabled()
  await act(async () => resolve(completed))
  expect(await screen.findByText("Sale complete")).toBeInTheDocument()
})

test("keeps the basket and transfer details after a failed sale so it can be retried", async () => {
  setup()
  const user = userEvent.setup()
  await add()
  await payment()
  fireEvent.click(screen.getByRole("button", { name: "Transfer" }))
  await user.type(screen.getByRole("textbox", { name: "Transfer reference · optional" }), "REF-123")
  vi.mocked(transactions.createTransaction).mockRejectedValueOnce(new Error("Temporary failure"))
  fireEvent.click(charge(10))
  await waitFor(() => expect(transactions.createTransaction).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(charge(10)).toBeEnabled())
  expect(screen.getByRole("textbox", { name: "Transfer reference · optional" })).toHaveValue("REF-123")
  fireEvent.click(screen.getByRole("button", { name: "Back to basket" }))
  expect(screen.getByRole("button", { name: "Edit Test soap" })).toBeInTheDocument()
  await payment()
  fireEvent.click(charge(10))
  await screen.findByText("Sale complete")
  expect(transactions.createTransaction).toHaveBeenLastCalledWith("business-a", expect.objectContaining({ paymentMethod: "TRANSFER", notes: "REF-123", amountTendered: undefined }))
})

test("changes businesses with a fresh ticket and keeps recent sales separate from the current basket", async () => {
  const { rerender, client } = setup()
  await add()
  fireEvent.click(screen.getByRole("button", { name: "Recent sales" }))
  const history = await screen.findByRole("dialog", { name: "Recent sales" })
  expect(await within(history).findByText("No sales yet")).toBeInTheDocument()
  fireEvent.click(within(history).getByRole("button", { name: "Close" }))
  expect(screen.getByRole("button", { name: "Edit Test soap" })).toBeInTheDocument()
  auth.activeBusinessId = "business-b"
  rerender(<QueryClientProvider client={client}><Pos /></QueryClientProvider>)
  expect(screen.getByRole("button", { name: "Continue to payment" })).toBeDisabled()
})


test("Enter opens the pack dialog before a second Enter adds the chosen quantity", async () => {
  setup()
  const user = userEvent.setup()
  const search = await screen.findByRole("textbox", { name: "Search products by name or short code" })
  await user.type(search, "SP01")
  await user.keyboard("{Enter}")
  const dialog = await screen.findByRole("dialog", { name: "Test soap" })
  const quantity = within(dialog).getByRole("spinbutton", { name: "Quantity" })
  await user.clear(quantity)
  await user.type(quantity, "2")
  await user.keyboard("{Enter}")
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(within(screen.getByRole("region", { name: "Your basket" })).getByText(formatMoney(20, "USD"), { selector: ".pocket-total strong" })).toBeInTheDocument()
})


test("treats exact cash as zero change when decimal quantities introduce floating-point noise", async () => {
  vi.mocked(products.getProducts).mockResolvedValue([{ ...product, price: 0.1 }])
  vi.mocked(transactions.createTransaction).mockResolvedValue({ ...completed, totalAmount: 0.3, changeGiven: 0 })
  setup()
  await add("3")
  await payment()
  fireEvent.change(screen.getByRole("spinbutton", { name: "Cash received · optional" }), { target: { value: "0.3" } })
  expect(screen.getByText(formatMoney(0, "USD"), { selector: ".pocket-change strong" })).toBeInTheDocument()
  fireEvent.click(charge(0.3))
  await screen.findByText("Sale complete")
  expect(transactions.createTransaction).toHaveBeenCalledWith("business-a", expect.objectContaining({ amountTendered: 0.3 }))
})
