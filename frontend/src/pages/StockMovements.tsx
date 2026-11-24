import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeftRight, Boxes, Package, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import * as stockService from "@/services/stock.service"
import type { StockMovement } from "@/services/stock.service"
import { ADJUSTMENT_REASON_LABELS, formatMovementQuantity, getMovementOriginLabel, groupMovementBatches } from "@/lib/stock-movements"
import * as warehouseService from "@/services/warehouse.service"
import { useAuth } from "@/context/AuthContext"
import { useActiveBusiness, useActiveBusinessRole } from "@/hooks/useActiveBusiness"
import { canManage } from "@/lib/permissions"
import { formatDate } from "@/lib/format"
import { downloadCsv } from "@/lib/csv"
import { downloadPdfReport } from "@/lib/pdf"
import { PageHeader } from "@/components/PageHeader"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { StockMovementTimeline } from "@/components/stock/StockMovementTimeline"
import { MoveStockDialog } from "@/components/stock/MoveStockDialog"
import { AdjustStockDialog } from "@/components/stock/AdjustStockDialog"
import { DownloadMenu } from "@/components/reports/DownloadMenu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
// Sentinel value for the "no filter selected" option in the warehouse/type
// Select dropdowns (native <select> can't use an empty-string value cleanly).
const ANY = "__any__"

// Formats the local time shown alongside each movement date.
function formatTime(date: string, locale?: string) {
  return new Date(date).toLocaleTimeString(locale || undefined, { hour: "numeric", minute: "2-digit" })
}

/** Activity timeline: one expandable entry per saved stock operation. */
export default function StockMovements() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || undefined
  const { activeBusinessId } = useAuth()
  const activeBusiness = useActiveBusiness()
  const activeRole = useActiveBusinessRole()
  const canEdit = canManage(activeRole)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [fromWarehouseId, setFromWarehouseId] = useState(ANY)
  const [toWarehouseId, setToWarehouseId] = useState(ANY)
  const [type, setType] = useState(ANY)

  const warehousesQuery = useQuery({
    queryKey: ["warehouses", activeBusinessId],
    queryFn: () => warehouseService.getWarehouses(activeBusinessId!),
    enabled: !!activeBusinessId,
  })
  const warehouses = warehousesQuery.data ?? []

  const filters = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    fromWarehouseId: fromWarehouseId === ANY ? undefined : fromWarehouseId,
    toWarehouseId: toWarehouseId === ANY ? undefined : toWarehouseId,
    type: type === ANY ? undefined : (type as StockMovement["type"]),
  }
  const hasActiveFilters = Object.values(filters).some((v) => v !== undefined)

  // Resets all filter controls back to "no filter" / empty.
  const clearFilters = () => {
    setStartDate("")
    setEndDate("")
    setFromWarehouseId(ANY)
    setToWarehouseId(ANY)
    setType(ANY)
  }

  const movementsQuery = useQuery({
    queryKey: ["stock-movements", activeBusinessId, filters],
    queryFn: () => stockService.getStockMovements(activeBusinessId!, filters),
    enabled: !!activeBusinessId,
  })

  const movements = useMemo(() => movementsQuery.data ?? [], [movementsQuery.data])
  const batches = useMemo(() => groupMovementBatches(movements), [movements])

  // Exports the currently filtered movements as a CSV file.
  const downloadAsCsv = () => {
    downloadCsv(`stock-movements-${new Date().toISOString().slice(0, 10)}.csv`, [
      [
        t("Batch reference"),
        t("Date"),
        t("Time"),
        t("Type"),
        t("Product"),
        t("From"),
        t("To"),
        t("Quantity"),
        t("Unit"),
        t("Previous quantity"),
        t("New quantity"),
        t("Delta"),
        t("Reason"),
        t("Moved by"),
        t("Notes"),
      ],
      ...movements.map((m) => {
        const delta =
          m.type === "ADJUSTMENT" && m.previousQuantity != null && m.newQuantity != null
            ? m.newQuantity - m.previousQuantity
            : ""
        const reason = m.adjustmentReason ? t(ADJUSTMENT_REASON_LABELS[m.adjustmentReason]) : ""
        const origin = m.fromWarehouse?.name ?? (m.type === "ADJUSTMENT" ? "—" : t(getMovementOriginLabel(m)))
        return [
          m.batchId ?? m.returnId ?? m.id,
          formatDate(m.createdAt, locale),
          formatTime(m.createdAt, locale),
          m.type,
          m.product.name,
          origin,
          m.toWarehouse.name,
          m.quantity,
          m.product.unit,
          m.previousQuantity ?? "",
          m.newQuantity ?? "",
          delta,
          reason,
          m.movedBy.fullName,
          m.notes ?? "",
        ]
      }),
    ])
  }

  // Exports the currently filtered movements as a branded PDF report.
  const downloadAsPdf = () => {
    downloadPdfReport(`stock-movements-${new Date().toISOString().slice(0, 10)}.pdf`, {
      businessName: activeBusiness?.name ?? "",
      businessLocation: activeBusiness?.location,
      title: t("STOCK MOVEMENTS"),
      dateLine: hasActiveFilters ? t("Filtered") : t("All movements"),
      sections: [
        {
          head: [t("Batch"), t("Date"), t("Time"), t("Type"), t("Product"), t("From"), t("To"), t("Qty"), t("By")],
          body: movements.map((m) => {
            const origin = m.fromWarehouse?.name ?? (m.type === "ADJUSTMENT" ? "—" : t(getMovementOriginLabel(m)))
            const productLabel = m.adjustmentReason
              ? `${m.product.name} (${t(ADJUSTMENT_REASON_LABELS[m.adjustmentReason])})`
              : m.product.name
            return [
              (m.batchId ?? m.returnId ?? m.id).slice(0, 8),
              formatDate(m.createdAt, locale),
              formatTime(m.createdAt, locale),
              m.type,
              productLabel,
              origin,
              m.toWarehouse.name,
              formatMovementQuantity(m),
              m.movedBy.fullName,
            ]
          }),
        },
      ],
      footerNote: t("Generated by VAE Inventory"),
    })
  }

  if (!activeBusinessId) {
    return (
      <EmptyState
        icon={<ArrowLeftRight className="size-6" />}
        title="No business selected"
        description="Select or create a business to view stock movements."
      />
    )
  }

  const summaryUnavailable = movementsQuery.isError

  return (
    <div className="operations-page">
      <header>
        <p className="operations-eyebrow">{t("Inventory management")}</p>
        <PageHeader
          title="Stock Movements"
          description="Follow your stock activity. Open a movement to see everything inside."
          action={canEdit && (
            <div className="flex flex-wrap gap-2">
              <AdjustStockDialog />
              <MoveStockDialog />
            </div>
          )}
        />
      </header>

      <div className="stock-activity-overview" aria-busy={movementsQuery.isLoading}>
        <span><Boxes aria-hidden="true" /><strong>{movementsQuery.isLoading || summaryUnavailable ? "—" : batches.length.toLocaleString()}</strong>{t("Movement batches")}</span>
        <span><Package aria-hidden="true" /><strong>{movementsQuery.isLoading || summaryUnavailable ? "—" : movements.length.toLocaleString()}</strong>{t("Product lines")}</span>
        <span><ArrowLeftRight aria-hidden="true" /><strong>{movementsQuery.isLoading || summaryUnavailable ? "—" : batches.filter((batch) => batch.movement.type === "TRANSFER").length.toLocaleString()}</strong>{t("Transfers")}</span>
        <small>{t(hasActiveFilters ? "Matching current filters" : "All recorded movements")}</small>
      </div>

      <section className="operations-filters" aria-label={t("Movement filters")}>
        <div className="operations-filter">
          <label htmlFor="movement-start-date">{t("From date")}</label>
          <Input
            id="movement-start-date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        <div className="operations-filter">
          <label htmlFor="movement-end-date">{t("To date")}</label>
          <Input
            id="movement-end-date"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
        <div className="operations-filter">
          <label htmlFor="movement-source">{t("From warehouse")}</label>
          <Select value={fromWarehouseId} onValueChange={setFromWarehouseId}>
            <SelectTrigger id="movement-source" aria-label={t("From warehouse")}>
              <SelectValue placeholder={t("From warehouse")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("Any source")}</SelectItem>
              {warehouses.map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="operations-filter">
          <label htmlFor="movement-destination">{t("To warehouse")}</label>
          <Select value={toWarehouseId} onValueChange={setToWarehouseId}>
            <SelectTrigger id="movement-destination" aria-label={t("To warehouse")}>
              <SelectValue placeholder={t("To warehouse")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("Any destination")}</SelectItem>
              {warehouses.map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="operations-filter">
          <label htmlFor="movement-type">{t("Movement type")}</label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="movement-type" aria-label={t("Movement type")}>
              <SelectValue placeholder={t("Type")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("Any type")}</SelectItem>
              <SelectItem value="RESTOCK">{t("Restock")}</SelectItem>
              <SelectItem value="TRANSFER">{t("Transfer")}</SelectItem>
              <SelectItem value="RETURN">{t("Return")}</SelectItem>
              <SelectItem value="ADJUSTMENT">{t("Adjustment")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="operations-filter-actions">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-3.5" aria-hidden="true" />
              {t("Clear filters")}
            </Button>
          )}
          <DownloadMenu
            disabled={movementsQuery.isLoading || movementsQuery.isError || movements.length === 0}
            groups={[{ items: [{ label: t("CSV"), onClick: downloadAsCsv }, { label: t("PDF"), onClick: downloadAsPdf }] }]}
          />
        </div>
      </section>

      {movementsQuery.isLoading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : movementsQuery.isError ? (
        <ErrorState onRetry={() => movementsQuery.refetch()} />
      ) : movements.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight className="size-6" />}
          title={hasActiveFilters ? "No movements match your filters" : "No stock movements yet"}
          description={hasActiveFilters
            ? "Try widening the date range or clearing a filter."
            : "Restocks and transfers between warehouses will show up here."
          }
        />
      ) : (
        <StockMovementTimeline batches={batches} />
      )}
    </div>
  )
}
