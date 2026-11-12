import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as transactionService from "@/services/transaction.service"
import type { RefundMethod, Transaction } from "@/services/transaction.service"
import { ApiError } from "@/lib/api-client"
import { formatMoney } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Dialog for reversing some or all of a sale's items — restocks the
 * returned quantity and records how the customer was made whole. Each
 * item's returnable quantity is `quantitySold` minus whatever's already
 * been returned against it (computed from `transaction.returns`, the same
 * way the backend caps it — see transaction.service.js's createReturn), so
 * a product already fully returned on a prior visit doesn't show a row at
 * all, and a partially-returned one is capped at what's left.
 *
 * Quantities are plain local state rather than react-hook-form, since the
 * set of rows is derived per-transaction (not a fixed schema) — same
 * reasoning as the POS register's own cart state in Pos.tsx.
 */
export function ReturnDialog({
  businessId,
  transaction,
  open,
  onOpenChange,
  currency,
}: {
  businessId: string
  transaction: Transaction
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const returnable = transaction.items
    .map((item) => {
      const alreadyReturned = transaction.returns
        .flatMap((r) => r.items)
        .filter((ri) => ri.transactionItemId === item.id)
        .reduce((sum, ri) => sum + ri.quantityReturned, 0)
      return { item, remaining: item.quantitySold - alreadyReturned }
    })
    .filter(({ remaining }) => remaining > 0.0001)

  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("CASH")
  const [reason, setReason] = useState("")
  const [submitAttempted, setSubmitAttempted] = useState(false)

  // Reset the form whenever the dialog is (re)opened for a transaction.
  useEffect(() => {
    if (open) {
      setQuantities({})
      setRefundMethod("CASH")
      setReason("")
      setSubmitAttempted(false)
    }
  }, [open, transaction.id])

  const creditBalanceAllowed = transaction.paymentMethod === "CREDIT" && transaction.balanceDue > 0

  const selectedItems = returnable
    .map(({ item, remaining }) => {
      const raw = quantities[item.id]
      const quantityReturned = raw ? Number(raw) : 0
      return { item, remaining, quantityReturned }
    })
    .filter(({ quantityReturned }) => quantityReturned > 0)

  const hasSelection = selectedItems.length > 0
  const refundTotal =
    Math.round(
      selectedItems.reduce(
        (sum, { item, quantityReturned }) => sum + quantityReturned * (item.subtotal / item.quantitySold),
        0
      ) * 100
    ) / 100

  const mutation = useMutation({
    mutationFn: () =>
      transactionService.createReturn(businessId, transaction.id, {
        items: selectedItems.map(({ item, quantityReturned }) => ({
          transactionItemId: item.id,
          quantityReturned,
        })),
        refundMethod,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction", businessId, transaction.id] })
      queryClient.invalidateQueries({ queryKey: ["transactions", businessId] })
      queryClient.invalidateQueries({ queryKey: ["stock-movements", businessId] })
      queryClient.invalidateQueries({ queryKey: ["products", businessId] })
      toast.success(t("Return recorded"))
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("Could not record return"))
    },
  })

  const handleSubmit = () => {
    if (!hasSelection) {
      setSubmitAttempted(true)
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Process return")}</DialogTitle>
          <DialogDescription>{t("Choose which items are being returned and how the customer is made whole.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            {returnable.map(({ item, remaining }) => (
              <div key={item.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("Up to {{count}} {{unit}} returnable", { count: remaining, unit: item.product.unit })}
                  </p>
                </div>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  max={remaining}
                  className="w-24"
                  value={quantities[item.id] ?? ""}
                  onChange={(e) => {
                    const value = e.target.value
                    const clamped =
                      value === "" ? "" : String(Math.min(Math.max(Number(value), 0), remaining))
                    setQuantities((prev) => ({ ...prev, [item.id]: clamped }))
                  }}
                  aria-label={t("Quantity to return for {{name}}", { name: item.product.name })}
                />
              </div>
            ))}
          </div>
          {submitAttempted && !hasSelection && (
            <p className="text-xs text-destructive">{t("Select at least one item to return")}</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="return-refund-method">{t("Refund method")}</Label>
            <Select value={refundMethod} onValueChange={(value) => setRefundMethod(value as RefundMethod)}>
              <SelectTrigger id="return-refund-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">{t("Cash / transfer refund")}</SelectItem>
                {creditBalanceAllowed && (
                  <SelectItem value="CREDIT_BALANCE">{t("Reduce credit balance")}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="return-reason">{t("Reason (optional)")}</Label>
            <Textarea
              id="return-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {hasSelection && (
            <p className="text-sm font-medium">
              {t("Refund total: {{amount}}", { amount: formatMoney(refundTotal, currency) })}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            {t("Record return")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
