import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Plus, ShoppingCart, Truck, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useActiveBusiness } from "@/hooks/useActiveBusiness";
import { canManage } from "@/lib/permissions";
import * as purchase from "@/services/purchase.service";
import { formatMoney, formatDate, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { PurchaseOrderForm, ReceivePurchaseForm, usePurchaseRefresh } from "@/components/purchases/PurchaseForms";
export const purchaseLabels: Record<purchase.PurchaseStatus, string> = {
  DRAFT: "Draft",
  ORDERED: "Ordered",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled"
};
function PurchasesView({ businessId, currency }: { businessId: string; currency: string }) {
  const {
    t
  } = useTranslation();
  const money = (v: number) => formatMoney(v, currency);
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [debouncedSearch, setDebouncedSearch] = useState(""),
    [status, setStatus] = useState<purchase.PurchaseStatus | "">("");
  const [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<purchase.PurchaseOrder | null | undefined>(undefined),
    [receiving, setReceiving] = useState(false),
    [cancelConfirm, setCancelConfirm] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const refresh = usePurchaseRefresh(businessId);
  const query = useQuery({
    queryKey: ["purchases", businessId, page, debouncedSearch, status],
    queryFn: () => purchase.getPurchaseOrders(businessId, {
      page,
      search: debouncedSearch,
      status: status || undefined
    })
  });
  const detail = useQuery({
    queryKey: ["purchase", businessId, selected],
    queryFn: () => purchase.getPurchaseOrder(businessId, selected!),
    enabled: !!selected
  });
  const o = detail.data;
  const transition = useMutation({
    mutationFn: (action: "ORDER" | "CANCEL") => purchase.transitionPurchase(businessId, o!, action),
    onSuccess: () => {
      refresh();
      setCancelConfirm(false);
      toast.success(t("Purchase updated"));
    },
    onError: e => {
      toast.error(e.message);
      refresh();
    }
  });
  return <div className="workspace-dashboard"><div className="workspace-heading"><div><p className="workspace-eyebrow">{t("FROM ORDER TO SHELF")}</p><h1>{t("Purchases")}</h1><p>{t("Plan orders, track deliveries, and receive stock with confidence.")}</p></div><div className="flex gap-2"><Button variant="outline" asChild><Link to="/suppliers"><Truck size={16} />{t("Suppliers")}</Link></Button><Button onClick={() => setEditing(null)}><Plus size={16} />{t("New purchase order")}</Button></div></div>
 <section className="workspace-panel"><div className="panel-heading"><Input className="max-w-xs" value={search} onChange={e => {
          setSearch(e.target.value);
          setPage(1);
        }} placeholder={t("Search by supplier")} aria-label={t("Search by supplier")} /><select className="workspace-select" value={status} onChange={e => {
          setStatus(e.target.value as purchase.PurchaseStatus | "");
          setPage(1);
        }} aria-label={t("Purchase status")}><option value="">{t("All statuses")}</option>{Object.entries(purchaseLabels).map(([v, label]) => <option key={v} value={v}>{t(label)}</option>)}</select></div>{query.isLoading ? <Skeleton className="h-48" /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> : <><div className="workspace-table-scroll"><table className="workspace-table"><thead><tr>{["Order", "Supplier", "Warehouse", "Created", "Total", "Status", "Actions"].map(x => <th key={x}>{t(x)}</th>)}</tr></thead><tbody>{query.data?.rows.map(order => <tr key={order.id}><td><button className="workspace-text-link" onClick={() => setSelected(order.id)}>PO-{order.id.slice(0, 8).toUpperCase()}</button></td><td>{order.supplierName}</td><td>{order.warehouse.name}</td><td>{formatDate(order.createdAt)}</td><td>{money(order.totalAmount)}</td><td><span className={`status-pill ${order.status === "RECEIVED" ? "good" : order.status === "CANCELLED" ? "danger" : "warning"}`}>{t(purchaseLabels[order.status])}</span></td><td><Button variant="ghost" size="sm" onClick={() => setSelected(order.id)}>{t("View order")}</Button></td></tr>)}{!query.data?.rows.length && <tr><td colSpan={7} className="workspace-empty"><ShoppingCart className="mx-auto mb-3" />{t("No purchase orders yet.")}</td></tr>}</tbody></table></div><div className="mt-5 flex justify-between gap-3 text-xs text-muted-foreground"><span>{query.data?.total ?? 0} {t("orders")}</span><div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>{t("Previous")}</Button><span>{page} / {Math.max(1, query.data?.totalPages ?? 1)}</span><Button variant="outline" size="sm" disabled={page >= (query.data?.totalPages ?? 1)} onClick={() => setPage(p => p + 1)}>{t("Next")}</Button></div></div></>}</section>
 <Dialog open={!!selected && !receiving && editing === undefined} onOpenChange={open => {
      if (!open) {
        setSelected(null);
        setCancelConfirm(false);
      }
    }}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>{t("Purchase order")} {o ? `PO-${o.id.slice(0, 8).toUpperCase()}` : ""}</DialogTitle><DialogDescription>{t("Order details and delivery history")}</DialogDescription></DialogHeader><div className="min-h-0 space-y-5 overflow-y-auto">{detail.isError ? <ErrorState onRetry={() => detail.refetch()} /> : !o ? <Skeleton className="h-48" /> : <><div className="purchase-summary"><span>{t("Supplier")}<strong>{o.supplierName}</strong><span>{o.supplier.phone}</span></span><span>{t("Warehouse")}<strong>{o.warehouse.name}</strong></span><span>{t("Status")}<strong>{t(purchaseLabels[o.status])}</strong></span><span>{t("Order total")}<strong>{money(o.totalAmount)}</strong></span><span>{t("Received value")}<strong>{money(o.receivedAmount)}</strong></span>{o.expectedAt && <span>{t("Expected delivery")}<strong>{formatDate(o.expectedAt)}</strong></span>}{o.leadTimeDays !== null && <span>{t("Delivery lead time")}<strong>{o.leadTimeDays.toFixed(1)} {t("days")}</strong></span>}</div><div className="workspace-table-scroll"><table className="workspace-table"><thead><tr>{["Product", "Ordered", "Received", "Unit cost", "Total"].map(x => <th key={x}>{t(x)}</th>)}</tr></thead><tbody>{o.items.map(i => <tr key={i.id}><td>{i.productName}<small className="block muted">{i.unit}</small></td><td>{i.quantity}</td><td>{i.receivedQuantity}</td><td>{money(i.unitCost)}</td><td>{money(i.quantity * i.unitCost)}</td></tr>)}</tbody></table></div>{o.notes && <p className="text-sm">{o.notes}</p>}<div className="flex flex-wrap gap-2">{o.status === "DRAFT" && <><Button variant="outline" onClick={() => setEditing(o)}>{t("Edit draft")}</Button><Button disabled={transition.isPending} onClick={() => transition.mutate("ORDER")}>{t("Mark as ordered")}</Button></>}{["ORDERED", "PARTIALLY_RECEIVED"].includes(o.status) && <Button onClick={() => setReceiving(true)}><PackageCheck size={16} />{t("Receive stock")}</Button>}{!["RECEIVED", "CANCELLED"].includes(o.status) && <Button variant="outline" disabled={transition.isPending} onClick={() => setCancelConfirm(true)}>{t("Cancel order")}</Button>}</div>{cancelConfirm && <div className="rounded-lg border border-destructive/30 p-4"><p className="mb-3 text-sm">{t("Cancel the unreceived remainder? Stock already received will be kept.")}</p><div className="flex gap-2"><Button variant="destructive" disabled={transition.isPending} onClick={() => transition.mutate("CANCEL")}>{t("Confirm cancellation")}</Button><Button variant="ghost" onClick={() => setCancelConfirm(false)}>{t("Keep order")}</Button></div></div>}<section><h3 className="mb-3 font-semibold">{t("Receipt history")}</h3>{o.receipts.length ? o.receipts.map(r => <div className="mb-3 rounded-lg border p-3 text-xs" key={r.id}><p className="font-medium">{formatDateTime(r.createdAt)} · {r.actorName}</p>{r.items.map(i => <p key={i.orderItemId} className="mt-1 text-muted-foreground">{o.items.find(x => x.id === i.orderItemId)?.productName} — {i.quantity} {o.items.find(x => x.id === i.orderItemId)?.unit}</p>)}</div>) : <p className="text-xs text-muted-foreground">{t("No deliveries received yet.")}</p>}</section></>}</div></DialogContent></Dialog>
 {editing !== undefined && <PurchaseOrderForm key={editing?.id ?? "new"} businessId={businessId} order={editing ?? undefined} currency={currency} onClose={() => setEditing(undefined)} onSaved={saved => setSelected(saved.id)} />}
 {receiving && o && <ReceivePurchaseForm key={o.id + o.version} businessId={businessId} order={o} onClose={() => setReceiving(false)} onSaved={() => detail.refetch()} />}
 </div>;
}
export default function Purchases() {
  const {
    user,
    activeBusinessId
  } = useAuth();
  const active = useActiveBusiness();
  const allowed = canManage(active?.roleInBusiness ?? user?.role);
  if (!activeBusinessId) return <EmptyState title="No business selected" />;
  if (!allowed) return <EmptyState title="Not available" description="Purchasing is available to owners and admins." />;
  return <PurchasesView key={activeBusinessId} businessId={activeBusinessId} currency={active?.currency ?? "USD"} />;
}
