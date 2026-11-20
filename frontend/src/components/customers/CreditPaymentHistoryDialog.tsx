import { useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as transactionService from "@/services/transaction.service"
import { useActiveBusinessRole } from "@/hooks/useActiveBusiness"
import { canManage } from "@/lib/permissions"
import { ApiError } from "@/lib/api-client"
import { formatDateTime, formatMoney } from "@/lib/format"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/**
 * Dialog that lists every individual payment recorded against a CREDIT
 * transaction — the direct view the Credit tab didn't have before (until
 * now the only way to see one was to open the full printable receipt via
 * `TransactionDetailSheet`). Admins/SuperAdmins can also undo a mistaken
 * entry here: undoing deletes the payment and, if it had settled the sale,
 * re-opens the outstanding balance (see `undoCreditPayment` on the backend
 * — this is a correction, not a customer refund, so there's no separate
 * "voided" record kept beyond the audit-log entry).
 */
export function CreditPaymentHistoryDialog({
  businessId,
  transactionId,
  customerName,
  currency,
  trigger,
}: {
  businessId: string
  transactionId: string
  customerName: string
  currency: string
  trigger: ReactNode
}) {
  const { t } = useTranslation()
  const activeRole = useActiveBusinessRole()
  const canUndo = canManage(activeRole)
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ["transaction", businessId, transactionId],
    queryFn: () => transactionService.getTransactionById(businessId, transactionId),
    enabled: open,
  })

  const undoMutation = useMutation({
    mutationFn: (paymentId: string) => transactionService.undoPayment(businessId, transactionId, paymentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", businessId] })
      queryClient.invalidateQueries({ queryKey: ["customers", businessId] })
      queryClient.invalidateQueries({ queryKey: ["customer", businessId] })
      queryClient.invalidateQueries({ queryKey: ["transaction", businessId, transactionId] })
      toast.success(t("Payment undone"))
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : t("Could not undo payment")),
  })

  const payments = query.data?.payments ?? []

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Payment history")}</DialogTitle>
          <DialogDescription>{t("Payments recorded for {{customerName}}'s sale.", { customerName })}</DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("No payments recorded yet.")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{formatMoney(payment.amount, currency)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(payment.createdAt)} · {payment.recordedBy.fullName}
                  </p>
                </div>
                {canUndo && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="icon-sm" aria-label={t("Undo payment")}>
                        {undoMutation.isPending && undoMutation.variables === payment.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Undo2 className="size-3.5" />
                        )}
                      </Button>
                    }
                    title="Undo this payment?"
                    description={`This removes the ${formatMoney(payment.amount, currency)} payment recorded on ${formatDateTime(payment.createdAt)}. If it had settled the sale, the balance becomes outstanding again.`}
                    confirmLabel="Undo"
                    isLoading={undoMutation.isPending && undoMutation.variables === payment.id}
                    onConfirm={() => undoMutation.mutate(payment.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
