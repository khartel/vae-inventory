import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as business from "@/services/business.service";
import * as warehouses from "@/services/warehouse.service";
import * as products from "@/services/product.service";
import * as transactions from "@/services/transaction.service";
import * as reports from "@/services/report.service";
import { formatMoney } from "@/lib/format";
import Dashboard from "./Dashboard";
const scope = vi.hoisted(() => ({
  role: "ADMIN"
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      role: "SUPERADMIN"
    },
    activeBusinessId: "business-a"
  })
}));
vi.mock("@/hooks/useActiveBusiness", () => ({
  useActiveBusiness: () => ({
    id: "business-a",
    name: "Test store",
    currency: "USD",
    roleInBusiness: scope.role
  })
}));
vi.mock("@/services/business.service");
vi.mock("@/services/product.service");
vi.mock("@/services/warehouse.service");
vi.mock("@/services/transaction.service");
vi.mock("@/services/report.service");
function show() {
  return render(<QueryClientProvider client={new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  })}><MemoryRouter><Dashboard /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  scope.role = "ADMIN";
  vi.mocked(business.getBusinessById).mockResolvedValue({
    id: "business-a",
    name: "Test store",
    phone: "",
    email: null,
    country: "Ghana",
    location: "Accra",
    currency: "USD",
    createdAt: "2026-11-12",
    warehouses: [],
    businessUsers: [],
    _count: {
      products: 0,
      warehouses: 0,
      businessUsers: 0,
      transactions: 2
    }
  });
  vi.mocked(warehouses.getWarehouses).mockResolvedValue([]);
  vi.mocked(products.getProducts).mockResolvedValue([]);
  vi.mocked(transactions.getTransactions).mockResolvedValue({
    transactions: [],
    pagination: {
      total: 0,
      page: 1,
      limit: 5,
      totalPages: 0
    }
  });
  vi.mocked(reports.getStockAlertReport).mockResolvedValue({
    summary: {
      totalItems: 0,
      healthyCount: 0,
      lowStockCount: 0,
      outOfStockCount: 0
    },
    healthyStock: [],
    lowStock: [],
    outOfStock: []
  });
  vi.mocked(reports.getMonthlyReport).mockResolvedValue({
    month: "2026-11",
    monthStart: "2026-11-01",
    monthEnd: "2026-11-30",
    summary: {
      totalAmount: 250,
      totalTransactions: 2,
      cashTotal: 250,
      transferTotal: 0,
      totalCost: 100,
      totalProfit: 150,
      hasIncompleteCostData: false
    },
    dailyBreakdown: [],
    byEmployee: [],
    byProduct: []
  });
});
describe("Dashboard", () => {
  test("shows actual report totals and honest empty inventory instead of illustrative metrics", async () => {
    show();
    expect((await screen.findAllByText(formatMoney(250, "USD"))).length).toBeGreaterThan(0);
    expect(await screen.findByText("No products yet. Add your first product to get started.")).toBeInTheDocument();
    expect(screen.queryByText("98.2%")).not.toBeInTheDocument();
    expect(screen.getByRole("link", {
      name: "Manage purchases"
    })).toHaveAttribute("href", "/purchases");
    expect(reports.getMonthlyReport).toHaveBeenCalledWith("business-a", expect.any(Number), expect.any(Number));
  });
  test("uses the active-business role and never requests privileged reports for an employee", async () => {
    scope.role = "EMPLOYEE";
    show();
    expect(await screen.findByText("No products yet. Add your first product to get started.")).toBeInTheDocument();
    expect(screen.queryByText("Sales overview")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", {
      name: "Manage purchases"
    })).not.toBeInTheDocument();
    expect(reports.getMonthlyReport).not.toHaveBeenCalled();
    expect(reports.getStockAlertReport).not.toHaveBeenCalled();
  });
});
