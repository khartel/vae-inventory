import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Receipt } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useActiveBusiness } from "@/hooks/useActiveBusiness";
import { getTransactions, type PaymentMethod } from "@/services/transaction.service";
import { formatMoney, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { TransactionDetailSheet } from "@/components/transactions/TransactionDetailSheet";
export default function Sales() {
  const {
    t
  } = useTranslation();
  const {
    activeBusinessId
  } = useAuth();
  const active = useActiveBusiness();
  const [page, setPage] = useState(1),
    [method, setMethod] = useState<PaymentMethod | "">(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const invalidRange = !!start && !!end && start > end;
  const query = useQuery({
    queryKey: ["transactions", activeBusinessId, "sales", page, method, start, end],
    queryFn: () => getTransactions(activeBusinessId!, {
      page,
      limit: 20,
      paymentMethod: method || undefined,
      startDate: start || undefined,
      endDate: end || undefined
    }),
    enabled: !!activeBusinessId && !invalidRange
  });
  if (!activeBusinessId) return <EmptyState title="No business selected" />;
  return <div className="workspace-dashboard"><div className="workspace-heading"><div><p className="workspace-eyebrow">{t("EVERY SALE, IN ONE PLACE")}</p><h1>{t("Sales")}</h1><p>{t("Browse transactions, open receipts, and track customer payments.")}</p></div><Button asChild><Link to="/pos"><Plus size={16} />{t("New sale")}</Link></Button></div><section className="workspace-panel"><div className="panel-heading"><div className="flex flex-wrap items-end gap-3"><label className="text-xs">{t("From")}<Input type="date" value={start} onChange={e => {
              setStart(e.target.value);
              setPage(1);
            }} /></label><label className="text-xs">{t("To")}<Input type="date" value={end} onChange={e => {
              setEnd(e.target.value);
              setPage(1);
            }} /></label></div><select aria-label={t("Payment method")} className="workspace-select" value={method} onChange={e => {
          setMethod(e.target.value as PaymentMethod | "");
          setPage(1);
        }}><option value="">{t("All payment methods")}</option>{["CASH", "TRANSFER", "CREDIT"].map(m => <option key={m} value={m}>{t(m)}</option>)}</select></div>{invalidRange ? <p className="text-destructive">{t("End date must be after start date.")}</p> : query.isLoading ? <Skeleton className="h-48" /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> : <><div className="workspace-table-scroll"><table className="workspace-table"><thead><tr>{["Receipt", "Customer", "Date", "Payment", "Total", "Balance due", "Actions"].map(x => <th key={x}>{t(x)}</th>)}</tr></thead><tbody>{query.data?.transactions.map(tx => <tr key={tx.id}><td><button className="workspace-text-link" onClick={() => setSelected(tx.id)}>{tx.id.slice(0, 8).toUpperCase()}</button></td><td>{tx.customerName}</td><td>{formatDateTime(tx.createdAt)}</td><td><span className="status-pill">{t(tx.paymentMethod)}</span></td><td>{formatMoney(tx.totalAmount, active?.currency ?? "USD")}</td><td>{formatMoney(tx.paymentMethod === "CREDIT" ? tx.balanceDue : 0, active?.currency ?? "USD")}</td><td><Button size="sm" variant="ghost" onClick={() => setSelected(tx.id)}>{t("View receipt")}</Button></td></tr>)}{!query.data?.transactions.length && <tr><td colSpan={7} className="workspace-empty"><Receipt className="mx-auto mb-2" />{t("No sales found.")}</td></tr>}</tbody></table></div><div className="mt-5 flex justify-between text-xs text-muted-foreground"><span>{query.data?.pagination.total ?? 0} {t("sales")}</span><div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>{t("Previous")}</Button><span>{page} / {Math.max(1, query.data?.pagination.totalPages ?? 1)}</span><Button variant="outline" size="sm" disabled={page >= (query.data?.pagination.totalPages ?? 1)} onClick={() => setPage(p => p + 1)}>{t("Next")}</Button></div></div></>}</section><TransactionDetailSheet businessId={activeBusinessId} transactionId={selected} onOpenChange={open => {
      if (!open) setSelected(null);
    }} /></div>;
}
