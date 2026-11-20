import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Package, Warehouse, Receipt, AlertTriangle, ArrowUpRight, Plus, ShoppingBag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useActiveBusiness } from "@/hooks/useActiveBusiness";
import { getBusinessById } from "@/services/business.service";
import { getProducts } from "@/services/product.service";
import { getWarehouses } from "@/services/warehouse.service";
import { getTransactions } from "@/services/transaction.service";
import { getMonthlyReport, getStockAlertReport } from "@/services/report.service";
import { canManage } from "@/lib/permissions";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
function localMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function parseIsoDay(isoDay: string) {
  return new Date(`${isoDay}T12:00:00`);
}
export default function Dashboard() {
  const {
    t
  } = useTranslation();
  const {
    user,
    activeBusinessId
  } = useAuth();
  const active = useActiveBusiness();
  const manager = canManage(active?.roleInBusiness ?? user?.role);
  const [month, setMonth] = useState(localMonth);
  const [year, monthNumber] = month.split("-").map(Number);
  const businessQuery = useQuery({
    queryKey: ["business", activeBusinessId],
    queryFn: () => getBusinessById(activeBusinessId!),
    enabled: !!activeBusinessId
  });
  const productsQuery = useQuery({
    queryKey: ["products", activeBusinessId],
    queryFn: () => getProducts(activeBusinessId!),
    enabled: !!activeBusinessId
  });
  const warehousesQuery = useQuery({ queryKey: ["warehouses", activeBusinessId], queryFn: () => getWarehouses(activeBusinessId!), enabled: !!activeBusinessId });
  const recentQuery = useQuery({
    queryKey: ["transactions", activeBusinessId, "dashboard"],
    queryFn: () => getTransactions(activeBusinessId!, {
      page: 1,
      limit: 5
    }),
    enabled: !!activeBusinessId
  });
  const stockQuery = useQuery({
    queryKey: ["report-stock-alerts", activeBusinessId],
    queryFn: () => getStockAlertReport(activeBusinessId!),
    enabled: !!activeBusinessId && manager
  });
  const reportQuery = useQuery({
    queryKey: ["dashboard-sales", activeBusinessId, month],
    queryFn: () => getMonthlyReport(activeBusinessId!, year, monthNumber),
    enabled: !!activeBusinessId && manager && !!month
  });
  if (!activeBusinessId) return <EmptyState title="No business selected" description="Select a business to see your dashboard." />;
  if (businessQuery.isError) return <ErrorState onRetry={() => businessQuery.refetch()} />;
  const business = businessQuery.data;
  const money = (n: number) => formatMoney(n, business?.currency ?? active?.currency ?? "USD");
  const stock = stockQuery.data?.summary;
  const counts = [stock?.healthyCount ?? 0, stock?.lowStockCount ?? 0, stock?.outOfStockCount ?? 0];
  const total = stock?.totalItems ?? 0;
  const healthy = total ? counts[0] / total * 100 : 0;
  const low = total ? counts[1] / total * 100 : 0;
  const days = reportQuery.data?.dailyBreakdown ?? [];
  const max = Math.max(1, ...days.map(d => d.totalAmount));
  const catalog = productsQuery.data ?? [];
  const alerts = [...(stockQuery.data?.outOfStock ?? []), ...(stockQuery.data?.lowStock ?? [])];
  const stats = [{
    label: t("Total products"),
    value: productsQuery.data ? productsQuery.data.length.toLocaleString() : "—",
    caption: t("In your catalog"),
    icon: Package,
    tone: "mint"
  }, {
    label: t("Low stock alerts"),
    value: stockQuery.isError ? "—" : stock ? (stock.lowStockCount + stock.outOfStockCount).toLocaleString() : "—",
    caption: t("Warehouse stock positions"),
    icon: AlertTriangle,
    tone: "amber"
  }, {
    label: t("Warehouses"),
    value: warehousesQuery.data ? warehousesQuery.data.length.toLocaleString() : "—",
    caption: t("Stock locations"),
    icon: Warehouse,
    tone: "mint"
  }, {
    label: manager ? t("Monthly sales") : t("Total Sales"),
    value: manager ? reportQuery.data ? money(reportQuery.data.summary.totalAmount) : "—" : business ? business._count.transactions.toLocaleString() : "—",
    caption: manager ? t("Gross sales before returns") : t("Recorded transactions"),
    icon: Receipt,
    tone: "blue"
  }];
  return <div className="workspace-dashboard">
    <div className="workspace-heading"><div><p className="workspace-eyebrow">{t("BUSINESS OVERVIEW")}</p><h1>{t("Dashboard")}</h1><p>{t("Here's what's happening with your business today.")}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to="/products"><Package size={16} />{t("View inventory")}</Link></Button><Button asChild><Link to="/pos"><Plus size={16} />{t("New sale")}</Link></Button></div></div>
    <section className="dashboard-welcome"><div><span className="workspace-eyebrow">{business?.name ?? active?.name}</span><h2>{t("A clearer view. A better business day.")}</h2><p>{t("Keep your shelves stocked and your business moving.")}</p><Link to={manager ? "/purchases" : "/products"}>{manager ? t("Manage purchases") : t("Explore inventory")}<ArrowUpRight size={16} /></Link></div><div className="dashboard-welcome-art" aria-hidden="true" /></section>
    <div className="dashboard-metrics">{stats.map(({
        label,
        value,
        caption,
        icon: Icon,
        tone
      }) => <section className="workspace-panel metric" key={label}><div><p>{label}</p>{businessQuery.isLoading ? <Skeleton className="h-8 w-24" /> : <strong>{value}</strong>}<small>{!manager && tone === "amber" ? t("Available to managers") : caption}</small></div><span className={`metric-icon ${tone}`}><Icon size={21} /></span></section>)}</div>
    {manager && <div className="dashboard-charts"><section className="workspace-panel"><div className="panel-heading"><div><h2>{t("Sales overview")}</h2><p>{t("Daily gross sales for the selected month")}</p></div><label className="sr-only" htmlFor="dashboard-month">{t("Reporting month")}</label><input id="dashboard-month" type="month" value={month} onChange={e => {
            if (e.target.value) setMonth(e.target.value);
          }} className="workspace-select" /></div>
      {reportQuery.isLoading ? <Skeleton className="h-52" /> : reportQuery.isError ? <ErrorState onRetry={() => reportQuery.refetch()} /> : days.length === 0 ? <p className="workspace-empty">{t("No sales recorded for this month.")}</p> : <><div className="sales-chart" role="img" aria-label={t("Daily sales chart")}><div className="sales-chart-grid" aria-hidden="true" />{days.map((d, i) => <div className="sales-chart-column" key={d.date}><div className="sales-chart-bar" style={{
                height: `${d.totalAmount / max * 100}%`,
                minHeight: d.totalAmount > 0 ? 3 : 0
              }}><span className="sales-chart-tooltip">{parseIsoDay(d.date).toLocaleDateString()}: {money(d.totalAmount)}</span></div><span className="sales-chart-day">{i % 5 === 0 ? parseIsoDay(d.date).getDate() : ""}</span></div>)}</div><p className="chart-caption">{t("Month total")}: <strong>{money(reportQuery.data?.summary.totalAmount ?? 0)}</strong> · {reportQuery.data?.summary.totalTransactions ?? 0} {t("sales")}</p><details className="chart-data"><summary>{t("View chart data")}</summary><div className="max-h-48 overflow-y-auto">{days.map(d => <p key={d.date}>{parseIsoDay(d.date).toLocaleDateString()} — {money(d.totalAmount)}</p>)}</div></details></>}
    </section><section className="workspace-panel"><div className="panel-heading"><div><h2>{t("Stock health")}</h2><p>{t("Across your warehouses")}</p></div><Package size={19} /></div>{stockQuery.isLoading ? <Skeleton className="h-52" /> : stockQuery.isError ? <ErrorState onRetry={() => stockQuery.refetch()} /> : <><div className="stock-donut" style={{
            background: total ? `conic-gradient(var(--dash-green) 0 ${healthy}%, #eab765 ${healthy}% ${healthy + low}%, #df7c77 ${healthy + low}% 100%)` : "var(--border)"
          }} role="img" aria-label={t("Stock health distribution")}><div><strong>{total.toLocaleString()}</strong><span>{t("stock positions")}</span></div></div><div className="stock-legend">{[t("Healthy stock"), t("Low stock"), t("Out of stock")].map((label, i) => <div key={label}><span><i style={{
                  background: ["var(--dash-green)", "#eab765", "#df7c77"][i]
                }} />{label}</span><strong>{counts[i]} <small>({total ? Math.round(counts[i] / total * 100) : 0}%)</small></strong></div>)}</div></>}</section></div>}
    <section className="workspace-panel inventory-preview"><div className="panel-heading"><div><h2>{t("Inventory at a glance")}</h2><p>{t("Current products and stock levels")}</p></div><Link to="/products" className="workspace-text-link">{t("View all items")}<ArrowUpRight size={16} /></Link></div>{productsQuery.isLoading ? <Skeleton className="h-40" /> : productsQuery.isError ? <ErrorState onRetry={() => productsQuery.refetch()} /> : <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr>{["Product", "SKU", "Unit", "Price", "Stock", "Status"].map(x => <th key={x}>{t(x)}</th>)}</tr></thead><tbody>{catalog.slice(0, 5).map(p => {
              const out = p.totalQuantity <= 0;
              const lowStock = p.stock.some(s => s.quantity <= s.lowStockThreshold);
              return <tr key={p.id}><td><Link className="product-table-name" to="/products"><span className="product-avatar"><Package size={19} /></span>{p.name}</Link></td><td className="muted">{p.shortCode ?? "—"}</td><td className="muted">{p.unit}</td><td>{money(p.price)}</td><td className="stock-quantity">{p.totalQuantity.toLocaleString()}</td><td><span className={`status-pill ${out ? "danger" : lowStock ? "warning" : "good"}`}>{t(out ? "Out of stock" : lowStock ? "Low stock" : "In stock")}</span></td></tr>;
            })}{catalog.length === 0 && <tr><td colSpan={6} className="workspace-empty">{t("No products yet. Add your first product to get started.")}</td></tr>}</tbody></table></div>}</section>
    <div className="dashboard-bottom"><section className="workspace-panel"><div className="panel-heading"><h2>{t("Recent sales")}</h2><Link to="/sales" className="workspace-text-link">{t("View all")}<ArrowUpRight size={16} /></Link></div>{recentQuery.isLoading ? <Skeleton className="h-24" /> : recentQuery.isError ? <ErrorState onRetry={() => recentQuery.refetch()} /> : recentQuery.data?.transactions.length ? <ul className="dashboard-list">{recentQuery.data.transactions.map(tx => <li key={tx.id}><span className="list-icon"><ShoppingBag size={17} /></span><div><strong>{tx.customerName}</strong><small>{formatDateTime(tx.createdAt)}</small></div><b>{money(tx.totalAmount)}</b></li>)}</ul> : <p className="workspace-empty">{t("No sales recorded yet.")}</p>}</section><section className="workspace-panel"><div className="panel-heading"><h2>{manager ? t("Needs attention") : t("Warehouses")}</h2><Link to={manager ? "/reports" : "/warehouses"} className="workspace-text-link">{t("View all")}<ArrowUpRight size={16} /></Link></div>{manager ? stockQuery.isError ? <ErrorState onRetry={() => stockQuery.refetch()} /> : stockQuery.isLoading ? <Skeleton className="h-24" /> : alerts.length ? <ul className="dashboard-list">{alerts.slice(0, 4).map(i => <li key={i.id}><span className="list-icon warning"><AlertTriangle size={17} /></span><div><strong>{i.product.name}</strong><small>{i.warehouse.name}</small></div><span className="status-pill warning">{i.quantity} {i.product.unit}</span></li>)}</ul> : <div className="workspace-empty"><Package className="mx-auto mb-2" /><p>{t("All stock is healthy")}</p></div> : <ul className="dashboard-list">{warehousesQuery.data?.map(w => <li key={w.id}><Warehouse size={18} /><strong>{w.name}</strong><small>{w.isPrimary ? t("Primary") : w.location}</small></li>)}</ul>}</section></div>
  </div>;
}
