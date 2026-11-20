import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Contact, History, Merge, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as customerService from "@/services/customer.service"
import * as transactionService from "@/services/transaction.service"
import { useAuth } from "@/context/AuthContext"
import { useActiveBusiness, useActiveBusinessRole } from "@/hooks/useActiveBusiness"
import { canManage } from "@/lib/permissions"
import { ApiError } from "@/lib/api-client"
import { formatDateTime, formatMoney } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog"
import { CustomerDetailSheet } from "@/components/customers/CustomerDetailSheet"
import { MergeCustomerDialog } from "@/components/customers/MergeCustomerDialog"
import { RecordPaymentDialog } from "@/components/customers/RecordPaymentDialog"
import { CreditPaymentHistoryDialog } from "@/components/customers/CreditPaymentHistoryDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * CustomersTab — lists customers for the active business with a name
 * search filter, and lets managers create/edit/delete customers or open a
 * detail sheet for a selected customer.
 *
 * Data: `["customers", businessId]` via `customerService.getCustomers`.
 * Delete goes through `deleteMutation`, invalidating the same query key.
 * Editing/deleting is gated by `canManage(user?.role)`.
 */
function CustomersTab({ businessId, currency }: { businessId: string; currency: string }) {
  const { t } = useTranslation()
  const activeRole = useActiveBusinessRole()
  const queryClient = useQueryClient()
  const canEdit = canManage(activeRole)
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const customersQuery = useQuery({
    queryKey: ["customers", businessId],
    queryFn: () => customerService.getCustomers(businessId),
  })

  const deleteMutation = useMutation({
    mutationFn: (customerId: string) => customerService.deleteCustomer(businessId, customerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", businessId] })
      toast.success(t("Customer deleted"))
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : t("Could not delete customer")),
  })

  const customers = customersQuery.data ?? []
  // Client-side name filter over the already-fetched customer list.
  const filtered = useMemo(
    () => customers.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())),
    [customers, search]
  )

  if (customersQuery.isLoading) return <Skeleton className="h-64 rounded-xl" />
  if (customersQuery.isError) return <ErrorState onRetry={() => customersQuery.refetch()} />

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("Search customers...")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Contact className="size-6" />}
          title={customers.length === 0 ? "No customers yet" : "No matches"}
          description={
            customers.length === 0
              ? "Customers are added automatically the first time you type their name at the register, or you can add one here."
              : "Try a different search term."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Name")}</TableHead>
                <TableHead>{t("Phone")}</TableHead>
                <TableHead>{t("Visits")}</TableHead>
                <TableHead>{t("Total spent")}</TableHead>
                <TableHead>{t("Owes")}</TableHead>
                <TableHead className="text-right">{t("Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((customer) => (
                <TableRow
                  key={customer.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(customer.id)}
                >
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell className="text-muted-foreground">{customer.phone || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{customer.transactionCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatMoney(customer.totalSpent, currency)}
                  </TableCell>
                  <TableCell>
                    {customer.outstandingCredit > 0 ? (
                      <Badge variant="destructive">{formatMoney(customer.outstandingCredit, currency)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <div className="flex justify-end gap-2">
                        <CustomerFormDialog customer={customer} />
                        <MergeCustomerDialog
                          businessId={businessId}
                          customer={customer}
                          trigger={
                            <Button variant="outline" size="icon-sm" aria-label={t("Merge into another customer")}>
                              <Merge className="size-3.5" />
                            </Button>
                          }
                        />
                        <ConfirmDialog
                          trigger={
                            <Button variant="outline" size="icon-sm" aria-label={t("Delete customer")}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          }
                          title="Delete customer?"
                          description={`This will remove "${customer.name}" from your customer list. Their past sales stay on record.`}
                          confirmLabel="Delete"
                          isLoading={deleteMutation.isPending}
                          onConfirm={() => deleteMutation.mutate(customer.id)}
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CustomerDetailSheet
        businessId={businessId}
        customerId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  )
}

/**
 * CreditTab — shows all unpaid CREDIT-payment transactions for the business
 * (customers who bought on credit and still owe money), with a running
 * total owed and a way to record a payment against each transaction.
 *
 * Data: `["transactions", businessId, "credit-outstanding"]` via
 * `transactionService.getTransactions` filtered to
 * `paymentMethod: "CREDIT", paid: false` (capped at 100 rows).
 */
function CreditTab({ businessId, currency }: { businessId: string; currency: string }) {
  const { t } = useTranslation()
  const creditQuery = useQuery({
    queryKey: ["transactions", businessId, "credit-outstanding"],
    queryFn: () =>
      transactionService.getTransactions(businessId, {
        paymentMethod: "CREDIT",
        paid: false,
        limit: 100,
      }),
  })

  if (creditQuery.isLoading) return <Skeleton className="h-64 rounded-xl" />
  if (creditQuery.isError) return <ErrorState onRetry={() => creditQuery.refetch()} />

  const outstanding = creditQuery.data?.transactions ?? []
  const totalOwed = outstanding.reduce((sum, tx) => sum + tx.balanceDue, 0)

  if (outstanding.length === 0) {
    return (
      <EmptyState
        icon={<Contact className="size-6" />}
        title="Nothing outstanding"
        description="Every credit sale has been settled."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl bg-muted/60 px-4 py-3">
        <span className="text-sm font-medium text-muted-foreground">{t("Total owed")}</span>
        <span className="font-heading text-2xl font-bold tabular-nums text-destructive">
          {formatMoney(totalOwed, currency)}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Date")}</TableHead>
              <TableHead>{t("Customer")}</TableHead>
              <TableHead>{t("Served by")}</TableHead>
              <TableHead className="text-right">{t("Paid")}</TableHead>
              <TableHead className="text-right">{t("Balance")}</TableHead>
              <TableHead className="text-right">{t("Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {outstanding.map((tx) => (
              <TableRow key={tx.id}>
                <TableCell className="text-muted-foreground">{formatDateTime(tx.createdAt)}</TableCell>
                <TableCell className="font-medium">{tx.customerName}</TableCell>
                <TableCell className="text-muted-foreground">{tx.performedBy.fullName}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {tx.amountPaid > 0 ? formatMoney(tx.amountPaid, currency) : "—"}
                  <span className="text-xs"> / {formatMoney(tx.totalAmount, currency)}</span>
                </TableCell>
                <TableCell className="text-right font-medium text-destructive">
                  {formatMoney(tx.balanceDue, currency)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <CreditPaymentHistoryDialog
                      businessId={businessId}
                      transactionId={tx.id}
                      customerName={tx.customerName}
                      currency={currency}
                      trigger={
                        <Button variant="outline" size="icon-sm" aria-label={t("Payment history")}>
                          <History className="size-3.5" />
                        </Button>
                      }
                    />
                    <RecordPaymentDialog
                      businessId={businessId}
                      transactionId={tx.id}
                      customerName={tx.customerName}
                      balanceDue={tx.balanceDue}
                      currency={currency}
                      trigger={
                        <Button variant="outline" size="sm">
                          {t("Record payment")}
                        </Button>
                      }
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/**
 * Customers page — top-level page for customer relationship management,
 * split into two tabs: "Customers" (directory + CRUD, see `CustomersTab`)
 * and "Credit" (outstanding credit-sale balances, see `CreditTab`).
 *
 * Requires an active business (`activeBusinessId` from AuthContext); shows
 * an `EmptyState` if none is selected. Currency for money formatting comes
 * from `useActiveBusiness()`. Create/edit actions are gated by
 * `canManage(user?.role)`.
 */
export default function Customers() {
  const { t } = useTranslation()
  const { activeBusinessId } = useAuth()
  const activeBusiness = useActiveBusiness()
  const activeRole = useActiveBusinessRole()
  const canEdit = canManage(activeRole)
  const currency = activeBusiness?.currency ?? "USD"

  if (!activeBusinessId) {
    return (
      <EmptyState
        icon={<Contact className="size-6" />}
        title="No business selected"
        description="Select or create a business to manage customers."
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader action={canEdit && <CustomerFormDialog />} />

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">{t("Customers")}</TabsTrigger>
          <TabsTrigger value="credit">{t("Credit")}</TabsTrigger>
        </TabsList>
        <TabsContent value="customers">
          <CustomersTab businessId={activeBusinessId} currency={currency} />
        </TabsContent>
        <TabsContent value="credit">
          <CreditTab businessId={activeBusinessId} currency={currency} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
