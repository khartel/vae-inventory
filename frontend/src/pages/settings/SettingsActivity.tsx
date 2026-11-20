import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { History } from "lucide-react"
import * as auditLogService from "@/services/auditLog.service"
import type { AuditLogEntry } from "@/services/auditLog.service"
import { useAuth } from "@/context/AuthContext"
import { formatDateTime } from "@/lib/format"
import { SettingsSectionHeader } from "@/pages/settings/SettingsSectionHeader"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Human-readable label + one-line detail for each action string an
// AuditLog entry can carry. Falls back to the raw action string for
// anything unrecognized, so a new action added later doesn't render blank.
function describe(entry: AuditLogEntry): { label: string; detail: string } {
  const m = entry.metadata ?? {}
  switch (entry.action) {
    case "product.deleted":
      return { label: "Deleted product", detail: String(m.name ?? "") }
    case "customer.deleted":
      return { label: "Deleted customer", detail: String(m.name ?? "") }
    case "warehouse.deleted":
      return { label: "Deleted warehouse", detail: String(m.name ?? "") }
    case "product.restored":
      return { label: "Restored product", detail: String(m.name ?? "") }
    case "customer.restored":
      return { label: "Restored customer", detail: String(m.name ?? "") }
    case "warehouse.restored":
      return { label: "Restored warehouse", detail: String(m.name ?? "") }
    case "customer.merged":
      return { label: "Merged customers", detail: `${m.mergedName ?? ""} → ${m.intoName ?? ""}` }
    case "credit_payment.undone":
      return { label: "Undid a credit payment", detail: String(m.customerName ?? "") }
    case "team.member_added":
      return { label: "Added team member", detail: `${m.username ?? ""} (${m.role ?? ""})` }
    case "team.member_removed":
      return { label: "Removed team member", detail: String(m.username ?? "") }
    case "team.role_changed":
      return { label: "Changed role", detail: `${m.username ?? ""}: ${m.fromRole ?? ""} → ${m.toRole ?? ""}` }
    case "team.password_reset":
      return { label: "Reset team member password", detail: String(m.username ?? "") }
    case "business.created":
      return { label: "Created business", detail: String(m.name ?? "") }
    case "business.deleted":
      return { label: "Deleted business", detail: String(m.name ?? "") }
    case "transaction.returned":
      return {
        label: "Processed return",
        detail: m.refundMethod ? `${String(m.refundMethod)} (${String(m.itemCount ?? 0)})` : "",
      }
    case "stock.adjusted":
      return {
        label: "Adjusted stock",
        detail: `${m.productName ?? ""}${m.warehouseName ? ` · ${m.warehouseName}` : ""}: ${m.previousQuantity ?? ""} → ${m.newQuantity ?? ""}`,
      }
    case "SUPPLIER_CREATED":
      return { label: "Added supplier", detail: String(m.name ?? "") }
    case "SUPPLIER_UPDATED":
      return { label: "Updated supplier", detail: String(m.name ?? "") }
    case "SUPPLIER_ARCHIVED":
      return { label: "Archived supplier", detail: String(m.name ?? entry.entityId?.slice(0, 8) ?? "") }
    case "SUPPLIER_RESTORED":
      return { label: "Restored supplier", detail: String(m.name ?? entry.entityId?.slice(0, 8) ?? "") }
    case "PURCHASE_DRAFT_SAVED":
      return { label: "Saved purchase draft", detail: entry.entityId ? `PO-${entry.entityId.slice(0, 8).toUpperCase()}` : "" }
    case "PURCHASE_ORDERED":
      return { label: "Marked purchase ordered", detail: entry.entityId ? `PO-${entry.entityId.slice(0, 8).toUpperCase()}` : "" }
    case "PURCHASE_CANCELLED":
      return { label: "Cancelled purchase order", detail: entry.entityId ? `PO-${entry.entityId.slice(0, 8).toUpperCase()}` : "" }
    case "PURCHASE_RECEIVED":
      return { label: "Received purchase stock", detail: entry.entityId ? `PO-${entry.entityId.slice(0, 8).toUpperCase()}` : "" }
    default:
      return { label: entry.action, detail: "" }
  }
}

/**
 * Settings > Activity Log — a read-only history of administrative/
 * destructive actions taken in the active business (product/customer/
 * warehouse deletions, team membership changes, business creation). Not
 * routine sales/stock activity, which already has its own history views
 * (Transactions, Stock Movements). Backend-gated to SuperAdmin/Admin.
 */
export default function SettingsActivity() {
  const { t } = useTranslation()
  const { activeBusinessId } = useAuth()

  const query = useQuery({
    queryKey: ["audit-log", activeBusinessId],
    queryFn: () => auditLogService.getAuditLog(activeBusinessId!),
    enabled: !!activeBusinessId,
  })

  const entries = query.data ?? []

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsSectionHeader
        title="Activity log"
        description="Who deleted, added, or changed what in this business."
      />

      {query.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<History className="size-6" />}
          title="No activity yet"
          description="Administrative actions like deletions and team changes will show up here."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("When")}</TableHead>
                <TableHead>{t("Who")}</TableHead>
                <TableHead>{t("Action")}</TableHead>
                <TableHead>{t("Detail")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const { label, detail } = describe(entry)
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>{entry.actorName ?? t("Unknown")}</TableCell>
                    <TableCell className="font-medium">{t(label)}</TableCell>
                    <TableCell className="text-muted-foreground">{detail}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
