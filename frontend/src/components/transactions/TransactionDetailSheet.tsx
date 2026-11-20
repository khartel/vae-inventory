import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Printer, Undo2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import * as transactionService from "@/services/transaction.service"
import { useActiveBusiness, useActiveBusinessRole } from "@/hooks/useActiveBusiness"
import { canManage } from "@/lib/permissions"
import { formatDate, formatDateTime, formatMoney } from "@/lib/format"
import { ReturnDialog } from "@/components/transactions/ReturnDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Centered dialog that renders a single transaction as a printable sales receipt,
 * plus a "Print receipt" button (uses the browser's native `window.print()`; the
 * `.receipt-print-area` / `print:hidden` classes control what's included when printing).
 *
 * Props:
 * - transactionId: when null the sheet is closed; setting it triggers the detail
 *   fetch (query is `enabled: !!transactionId`).
 * - onOpenChange: called when the sheet is dismissed.
 *
 * Branding data source: the receipt's title, footer note, and whether to show the
 * signature line are NOT hardcoded — they come from the active business's own
 * settings (`activeBusiness.receiptTitle`, `receiptFooterNote`, `receiptShowSignature`,
 * set on the Settings page) via `useActiveBusiness()`, each with a sensible fallback
 * ("RECEIPT", "Thank you for your business!", and `true` respectively) so receipts
 * still render correctly for businesses that haven't customized them.
 *
 * Also shows CREDIT-specific details when relevant: remaining balance due (or "Fully
 * paid"), and a log of payments already recorded against the transaction.
 */
export function TransactionDetailSheet({
  businessId,
  transactionId,
  onOpenChange,
}: {
  businessId: string
  transactionId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const activeBusiness = useActiveBusiness()
  const activeRole = useActiveBusinessRole()
  const currency = activeBusiness?.currency ?? "USD"
  const [returnDialogOpen, setReturnDialogOpen] = useState(false)

  const transactionQuery = useQuery({
    queryKey: ["transaction", businessId, transactionId],
    queryFn: () => transactionService.getTransactionById(businessId, transactionId!),
    enabled: !!transactionId,
  })

  const transaction = transactionQuery.data
  // The backend defaults every anonymous walk-in sale's customerName to the
  // literal string "Casual Customer" - treat that as "no name on file" and
  // omit the Billed To block entirely, rather than printing a placeholder.
  const hasCustomerName = !!transaction?.customerName && transaction.customerName !== "Casual Customer"

  // Whether any item on this sale still has quantity left to return - same
  // computation ReturnDialog does per-row, just collapsed to a single flag
  // to decide whether "Process return" should even be offered.
  const hasReturnableItems =
    !!transaction &&
    transaction.items.some((item) => {
      const alreadyReturned = transaction.returns
        .flatMap((r) => r.items)
        .filter((ri) => ri.transactionItemId === item.id)
        .reduce((sum, ri) => sum + ri.quantityReturned, 0)
      return item.quantitySold - alreadyReturned > 0.0001
    })

  return (
    <>
    <Dialog open={!!transactionId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="print:hidden">
          <DialogTitle>{t("Sale receipt")}</DialogTitle>
          <DialogDescription>
            {transaction ? formatDateTime(transaction.createdAt) : t("Loading...")}
          </DialogDescription>
          <p className="text-xs text-muted-foreground">
            {t('If a web address or print time appears, turn off "Headers and footers" in your browser’s print settings.')}
          </p>
        </DialogHeader>

        {transaction && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-11 print:hidden"
            aria-label={t("Print receipt")}
            onClick={() => window.print()}
          >
            <Printer className="size-4" />
          </Button>
        )}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {transactionQuery.isLoading || !transaction ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : (
            <div className="space-y-3">
              <div className="receipt-print-area rounded-xl border border-slate-200 bg-white p-6 text-slate-900">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-heading text-base font-bold">{activeBusiness?.name}</p>
                    {activeBusiness?.location && (
                      <p className="text-sm text-slate-500">{activeBusiness.location}</p>
                    )}
                  </div>
                  <p className="text-2xl font-bold tracking-[0.2em] text-slate-800">
                    {activeBusiness?.receiptTitle ?? "RECEIPT"}
                  </p>
                </div>

                <div className={`mt-6 flex items-start gap-4 text-sm ${hasCustomerName ? "justify-between" : "justify-end"}`}>
                  {hasCustomerName && (
                    <div>
                      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{t("Billed To")}</p>
                      <p className="font-medium">{transaction.customerName}</p>
                    </div>
                  )}
                  <div className="text-right">
                    <p>
                      <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                        {t("Receipt #")}{" "}
                      </span>
                      <span className="font-medium">{transaction.id.slice(0, 8).toUpperCase()}</span>
                    </p>
                    <p>
                      <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                        {t("Receipt date")}{" "}
                      </span>
                      <span className="font-medium">{formatDate(transaction.createdAt)}</span>
                    </p>
                  </div>
                </div>

                <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-none hover:bg-transparent">
                        <TableHead className="bg-slate-800 text-white">{t("Qty")}</TableHead>
                        <TableHead className="bg-slate-800 text-white">{t("Description")}</TableHead>
                        <TableHead className="bg-slate-800 text-right text-white">{t("Unit price")}</TableHead>
                        <TableHead className="bg-slate-800 text-right text-white">{t("Amount")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transaction.items.map((item) => {
                        // unitQuantity/unitLabel are only set when the sale
                        // was rung up in a pack size other than the
                        // product's base unit (e.g. "2 dozen") - the
                        // per-unit price shown is derived from the actual
                        // subtotal so it's always consistent with it, with
                        // no separate stored price to go stale.
                        const soldInAltUnit = item.unitQuantity != null && item.unitLabel
                        const displayQty = soldInAltUnit ? item.unitQuantity : item.quantitySold
                        const displayUnit = soldInAltUnit ? item.unitLabel : item.product.unit
                        const displayUnitPrice = soldInAltUnit
                          ? item.subtotal / item.unitQuantity!
                          : item.unitPrice
                        return (
                          <TableRow key={item.id} className="border-slate-200 hover:bg-transparent">
                            <TableCell>
                              {displayQty} {displayUnit}
                            </TableCell>
                            <TableCell className="font-medium">
                              {item.product.name}
                              {!!item.discountPercent && (
                                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                  -{item.discountPercent}%
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">{formatMoney(displayUnitPrice, currency)}</TableCell>
                            <TableCell className="text-right">{formatMoney(item.subtotal, currency)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="mt-4 flex justify-end">
                  <div className="w-full max-w-56 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-bold">
                      <span>{t("Total ({{currency}})", { currency })}</span>
                      <span>{formatMoney(transaction.totalAmount, currency)}</span>
                    </div>
                    {transaction.paymentMethod === "CREDIT" && (
                      <div className="flex items-center justify-between text-slate-600">
                        <span>{transaction.balanceDue > 0 ? t("Balance due") : t("Fully paid")}</span>
                        {transaction.balanceDue > 0 && (
                          <span className="font-medium">{formatMoney(transaction.balanceDue, currency)}</span>
                        )}
                      </div>
                    )}
                    {transaction.amountTendered != null && (
                      <div className="flex items-center justify-between text-slate-600">
                        <span>{t("Amount received")}</span>
                        <span className="font-medium">{formatMoney(transaction.amountTendered, currency)}</span>
                      </div>
                    )}
                    {transaction.changeGiven != null && transaction.changeGiven > 0 && (
                      <div className="flex items-center justify-between text-slate-600">
                        <span>{t("Change")}</span>
                        <span className="font-medium">{formatMoney(transaction.changeGiven, currency)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>{t("Payment method:")}</span>
                  <Badge variant="secondary" className="border-slate-200 bg-slate-100 text-slate-700">
                    {transaction.paymentMethod}
                  </Badge>
                  <span className="ml-auto">{t("Served by {{name}}", { name: transaction.performedBy.fullName })}</span>
                </div>

                {transaction.paymentMethod === "CREDIT" && transaction.payments.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      {t("Payments recorded")}
                    </p>
                    <ul className="space-y-1 text-sm">
                      {transaction.payments.map((payment) => (
                        <li key={payment.id} className="flex justify-between text-slate-500">
                          <span>
                            {formatDateTime(payment.createdAt)} · {payment.recordedBy.fullName}
                          </span>
                          <span className="font-medium text-slate-900">
                            {formatMoney(payment.amount, currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {transaction.returns.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      {t("Returns")}
                    </p>
                    <ul className="space-y-1.5 text-sm">
                      {transaction.returns.map((ret) => (
                        <li key={ret.id} className="flex items-start justify-between gap-2 text-slate-500">
                          <span>
                            {formatDateTime(ret.createdAt)} · {ret.processedBy.fullName}
                            {ret.reason && <span className="block text-xs">{ret.reason}</span>}
                          </span>
                          <span className="shrink-0 text-right font-medium text-slate-900">
                            {formatMoney(ret.refundAmount, currency)}
                            <span className="block text-xs font-normal text-slate-500">
                              {ret.refundMethod === "CASH" ? t("Cash refund") : t("Credit balance reduced")}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {transaction.notes && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{t("Notes")}</p>
                    <p className="text-sm">{transaction.notes}</p>
                  </div>
                )}

                {(activeBusiness?.receiptShowSignature ?? true) && (
                  <div className="mt-10 flex justify-end text-sm">
                    <div className="w-full max-w-56">
                      <div className="h-8 border-b border-slate-400" />
                      <p className="mt-1.5 text-xs text-slate-500">{t("Received by")}</p>
                    </div>
                  </div>
                )}

                <p className="mt-8 text-center text-xs text-slate-400">
                  {activeBusiness?.receiptFooterNote ?? "Thank you for your business!"}
                </p>
              </div>
            </div>
          )}
        </div>

        {transaction && (
          <DialogFooter className="print:hidden">
            {canManage(activeRole) && hasReturnableItems && (
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setReturnDialogOpen(true)}
              >
                <Undo2 className="size-4" />
                {t("Process return")}
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => window.print()}
            >
              <Printer className="size-4" />
              {t("Print receipt")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>

    {transaction && (
      <ReturnDialog
        businessId={businessId}
        transaction={transaction}
        open={returnDialogOpen}
        onOpenChange={setReturnDialogOpen}
        currency={currency}
      />
    )}
    </>
  )
}
