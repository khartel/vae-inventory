import { ArrowLeftRight, ArrowRight, ChevronDown, ClipboardEdit, PackagePlus, Undo2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/format"
import { ADJUSTMENT_REASON_LABELS, formatMovementQuantity } from "@/lib/stock-movements"
import type { MovementBatch } from "@/lib/stock-movements"
import "./stock-timeline.css"

const movementIcons = { RESTOCK: PackagePlus, TRANSFER: ArrowLeftRight, RETURN: Undo2, ADJUSTMENT: ClipboardEdit }
const movementLabels = { RESTOCK: "Restock", TRANSFER: "Transfer", RETURN: "Return", ADJUSTMENT: "Adjustment" }

export function StockMovementTimeline({ batches }: { batches: MovementBatch[] }) {
  const { t, i18n } = useTranslation()
  const days = new Map<string, MovementBatch[]>()
  for (const batch of batches) {
    const day = new Date(batch.movement.createdAt).toDateString()
    const existing = days.get(day)
    if (existing) existing.push(batch)
    else days.set(day, [batch])
  }
  const today = new Date().toDateString()
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = yesterdayDate.toDateString()

  return (
    <section className="operations-panel stock-timeline" aria-labelledby="stock-activity-heading">
      <div className="operations-panel-header">
        <h2 id="stock-activity-heading">{t("Stock activity")}</h2>
        <span>{t("Latest first")}</span>
      </div>
      <div className="stock-timeline-days">
        {[...days.entries()].map(([day, dayBatches]) => {
          const dayLabel = formatDate(dayBatches[0].movement.createdAt, i18n.language || undefined)
          return (
          <section key={day} className="stock-timeline-day" aria-label={dayLabel}>
            <h3 className="stock-timeline-date">
              {day === today ? `${t("Today")} · ` : day === yesterday ? `${t("Yesterday")} · ` : ""}
              {dayLabel}
            </h3>
            {dayBatches.map((batch) => {
              const movement = batch.movement
              const Icon = movementIcons[movement.type]
              const origin = movement.fromWarehouse?.name ?? t(movement.type === "RETURN" ? "Customer return" : "External")
              const commonNote = batch.items.every((item) => item.notes === movement.notes) ? movement.notes : null
              return (
                <details key={batch.key} className={`stock-timeline-batch stock-timeline-${movement.type.toLowerCase()}`}>
                  <summary className="stock-timeline-summary">
                    <time className="stock-timeline-time" dateTime={movement.createdAt}>
                      {new Date(movement.createdAt).toLocaleTimeString(i18n.language || undefined, { hour: "numeric", minute: "2-digit" })}
                    </time>
                    <span className="stock-timeline-marker"><Icon className="size-4" aria-hidden="true" /></span>
                    <div className="stock-timeline-copy">
                      <div className="stock-timeline-route">
                        {movement.type === "ADJUSTMENT" ? (
                          <span>{movement.toWarehouse.name}</span>
                        ) : (
                          <><span>{origin}</span><ArrowRight className="size-3.5" aria-label={t("To")} /><span>{movement.toWarehouse.name}</span></>
                        )}
                      </div>
                      <div className="stock-timeline-meta">
                        <Badge className="stock-timeline-type">{t(movementLabels[movement.type])}</Badge>
                        <span>{movement.movedBy.fullName}</span>
                        {movement.status !== "COMPLETED" && <span>{t(movement.status === "PENDING" ? "Pending" : "Cancelled")}</span>}
                      </div>
                    </div>
                    <div className="stock-timeline-count">
                      <span>{t(batch.productCount === 1 ? "{{count}} product" : "{{count}} products", { count: batch.productCount })}</span>
                      <ChevronDown className="size-4 stock-timeline-chevron" aria-hidden="true" />
                    </div>
                  </summary>
                  <div className="stock-timeline-contents">
                    <Table className="operations-table">
                      <TableHeader><TableRow><TableHead>{t("Product")}</TableHead><TableHead className="text-right">{t("Quantity")}</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {batch.items.map((item) => {
                          const reasonLabel = item.adjustmentReason ? t(ADJUSTMENT_REASON_LABELS[item.adjustmentReason]) : null
                          return (
                            <TableRow key={item.id}>
                              <TableCell className="operations-name">
                                {item.product.name}
                                {reasonLabel && <span className="operations-subtext">{reasonLabel}</span>}
                                {!commonNote && item.notes && <span className="operations-subtext operations-note">{item.notes}</span>}
                              </TableCell>
                              <TableCell className="operations-number">
                                {formatMovementQuantity(item)}
                                {item.unitLabel && item.unitQuantity != null && <span className="operations-subtext">{item.quantity} {item.product.unit}</span>}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    {commonNote && <p className="stock-timeline-note">{commonNote}</p>}
                  </div>
                </details>
              )
            })}
          </section>
          )
        })}
      </div>
      <p className="operations-panel-footer">{t("Open a movement to see every product moved together.")}</p>
    </section>
  )
}
