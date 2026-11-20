import { beforeEach, describe, expect, test, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as productService from "@/services/product.service"
import type { Role } from "@/types"
import Products from "./Products"

const authState = vi.hoisted(() => ({
  globalRole: "EMPLOYEE" as Role,
  businessRole: "ADMIN" as Role,
}))

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      role: authState.globalRole,
      businesses: [
        {
          id: "biz-1",
          name: "Branch A",
          currency: "USD",
          country: "Ghana",
          location: "Accra",
          receiptTitle: "RECEIPT",
          receiptFooterNote: "Thanks",
          receiptShowSignature: true,
          defaultLowStockThreshold: 10,
          lowStockThresholdsByUnit: {},
          roleInBusiness: authState.businessRole,
        },
      ],
    },
    activeBusinessId: "biz-1",
  }),
}))

vi.mock("@/services/product.service")
vi.mock("@/services/warehouse.service", () => ({
  getWarehouses: vi.fn().mockResolvedValue([]),
}))

function renderProducts() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(productService.getProducts).mockResolvedValue([
    {
      id: "prod-1",
      businessId: "biz-1",
      name: "Rice",
      unit: "pcs",
      price: 100,
      costPrice: 60,
      description: null,
      shortCode: "R1",
      createdAt: "2026-11-12T00:00:00Z",
      updatedAt: "2026-11-12T00:00:00Z",
      stock: [],
      totalQuantity: 10,
      primaryStock: null,
      units: [],
    },
  ])
})

describe("Products per-business role gating", () => {
  test("shows management controls and Margin column when global EMPLOYEE is promoted to business ADMIN", async () => {
    authState.globalRole = "EMPLOYEE"
    authState.businessRole = "ADMIN"

    renderProducts()

    expect(await screen.findByText("Rice")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /New product/i })).toBeInTheDocument()
    expect(screen.getByText("Margin")).toBeInTheDocument()
    expect(screen.getByText("40%")).toBeInTheDocument()
  })

  test("hides management controls and Margin column when global ADMIN is an EMPLOYEE in the active business", async () => {
    authState.globalRole = "ADMIN"
    authState.businessRole = "EMPLOYEE"

    renderProducts()

    expect(await screen.findByText("Rice")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /New product/i })).not.toBeInTheDocument()
    expect(screen.queryByText("Margin")).not.toBeInTheDocument()
  })
})
