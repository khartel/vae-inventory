import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Truck, Pencil, Archive, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useActiveBusiness } from "@/hooks/useActiveBusiness";
import { canManage } from "@/lib/permissions";
import { countryNameToIso } from "@/lib/countries";
import type { PhoneInputCountry } from "@/components/ui/phone-input";
import * as purchase from "@/services/purchase.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { SupplierForm, usePurchaseRefresh } from "@/components/purchases/PurchaseForms";
function SuppliersView({ businessId, defaultCountry }: { businessId: string; defaultCountry?: PhoneInputCountry }) {
  const {
    t
  } = useTranslation();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [debouncedSearch, setDebouncedSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [edit, setEdit] = useState<purchase.Supplier | null | undefined>(undefined);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const refresh = usePurchaseRefresh(businessId);
  const query = useQuery({
    queryKey: ["suppliers", businessId, page, debouncedSearch, archived],
    queryFn: () => purchase.getSuppliers(businessId, {
      page,
      search: debouncedSearch,
      archived: String(archived)
    })
  });
  const mutation = useMutation({
    mutationFn: (s: purchase.Supplier) => purchase.archiveSupplier(businessId, s.id, !!s.archivedAt),
    onSuccess: () => {
      refresh();
      toast.success(t("Supplier updated"));
    },
    onError: e => toast.error(e.message)
  });
  return <div className="workspace-dashboard"><div className="workspace-heading"><div><p className="workspace-eyebrow">{t("YOUR SUPPLY NETWORK")}</p><h1>{t("Suppliers")}</h1><p>{t("The people who keep your business stocked.")}</p></div><Button onClick={() => setEdit(null)}><Plus size={16} />{t("Add supplier")}</Button></div><section className="workspace-panel"><div className="panel-heading"><div className="flex items-center gap-2"><Search size={16} /><Input value={search} onChange={e => {
            setSearch(e.target.value);
            setPage(1);
          }} placeholder={t("Search suppliers")} aria-label={t("Search suppliers")} /></div><Button variant="outline" onClick={() => {
          setArchived(!archived);
          setPage(1);
        }}>{t(archived ? "Show active" : "Show archived")}</Button></div>{query.isLoading ? <Skeleton className="h-48" /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> : <><div className="workspace-table-scroll"><table className="workspace-table"><thead><tr>{["Supplier", "Contact", "Address", "Orders", "Actions"].map(x => <th key={x}>{t(x)}</th>)}</tr></thead><tbody>{query.data?.rows.map(s => <tr key={s.id}><td><span className="product-table-name"><span className="product-avatar"><Truck size={18} /></span>{s.name}</span></td><td>{s.phone}<p className="muted">{s.email}</p></td><td>{s.address}</td><td>{s._count?.orders ?? 0}</td><td><div className="flex gap-2"><Button variant="ghost" size="icon" aria-label={t("Edit supplier")} onClick={() => setEdit(s)}><Pencil size={16} /></Button><Button variant="ghost" size="icon" aria-label={t(archived ? "Restore supplier" : "Archive supplier")} disabled={mutation.isPending} onClick={() => mutation.mutate(s)}>{archived ? <RotateCcw size={16} /> : <Archive size={16} />}</Button></div></td></tr>)}{!query.data?.rows.length && <tr><td colSpan={5} className="workspace-empty">{t("No suppliers found.")}</td></tr>}</tbody></table></div><div className="mt-5 flex items-center justify-between text-xs text-muted-foreground"><span>{query.data?.total ?? 0} {t("suppliers")}</span><div className="flex items-center gap-3"><Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>{t("Previous")}</Button><span>{page} / {Math.max(1, query.data?.totalPages ?? 1)}</span><Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= (query.data?.totalPages ?? 1)}>{t("Next")}</Button></div></div></>}</section>{edit !== undefined && <SupplierForm key={edit?.id ?? "new"} businessId={businessId} supplier={edit ?? undefined} defaultCountry={defaultCountry} onClose={() => setEdit(undefined)} />}</div>;
}
export default function Suppliers() {
  const {
    user,
    activeBusinessId
  } = useAuth();
  const active = useActiveBusiness();
  const allowed = canManage(active?.roleInBusiness ?? user?.role);
  if (!activeBusinessId) return <EmptyState title="No business selected" />;
  if (!allowed) return <EmptyState title="Not available" description="Supplier management is available to owners and admins." />;
  return <SuppliersView key={activeBusinessId} businessId={activeBusinessId} defaultCountry={countryNameToIso(active?.country)} />;
}
