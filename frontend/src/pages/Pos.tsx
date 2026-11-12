import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ChevronLeft, ChevronRight, Printer, Store } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as productService from "@/services/product.service"
import * as transactionService from "@/services/transaction.service"
import type { PaymentMethod } from "@/services/transaction.service"
import { useAuth } from "@/context/AuthContext"
import { useActiveBusiness } from "@/hooks/useActiveBusiness"
import { ApiError } from "@/lib/api-client"
import { formatDateTime, formatMoney } from "@/lib/format"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { ProductSearch } from "@/components/pos/ProductSearch"
import { CartItemsPanel, type CartLine } from "@/components/pos/CartItemsPanel"
import { SaleSummaryPanel } from "@/components/pos/SaleSummaryPanel"
import type { SelectedCreditCustomer } from "@/components/pos/CreditCustomerPicker"
import { TransactionDetailSheet } from "@/components/transactions/TransactionDetailSheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
 * RegisterTab — the point-of-sale "ring up a sale" screen: search/add
 * products to a cart, adjust quantities/prices/discounts, pick a payment
 * method, and complete the sale.
 *
 * Local state (the cart/ticket "state machine"):
 * - `cart: CartLine[]` — one line per product in the current sale, each
 *   tracking `quantity`, `catalogPrice` (original price), `unitPrice`
 *   (possibly discounted), `discountPercent`, and `availableStock` (used to
 *   prevent overselling).
 * - `paymentMethod` / `customerName` / `selectedCreditCustomer` /
 *   `transferNote` / `amountTendered` — fields of the sale being built.
 *   `customerName` is free text, used only for CASH/TRANSFER (a receipt
 *   snapshot, optionally linked server-side if it matches an existing
 *   customer). `selectedCreditCustomer` is a real `{id, name}` pick from the
 *   directory, required only when `paymentMethod` is "CREDIT" (see
 *   `customerMissing` below) — credit can't be extended to an untracked
 *   name. Switching payment method clears whichever of the two isn't
 *   relevant, so stale state from one mode can't leak into the submission.
 *   `amountTendered` is CASH-only and always optional, but if given must
 *   cover the total (see `amountTenderedInsufficient`) — the backend derives
 *   and stores `changeGiven` from it.
 * - `submitAttempted` — flips true once the user tries to complete a sale
 *   that's missing the required customer name (or has an insufficient cash
 *   amount received), so the error message only appears after a real
 *   attempt (not while the field is merely empty).
 * - `completedSale` — set after a successful sale, drives the "Sale
 *   complete" confirmation dialog (with options to print a receipt or
 *   start a new sale).
 * - `printTransactionId` — when set, opens `TransactionDetailSheet` in
 *   receipt/print mode for that transaction.
 *
 * Data: `["products", businessId]` via `productService.getProducts` feeds
 * the product search/picker. Completing a sale calls
 * `transactionService.createTransaction`, then invalidates the
 * transactions, products, and business queries (stock counts and business
 * totals change as a result of the sale).
 */
function RegisterTab({ businessId, currency }: { businessId: string; currency: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [cart, setCart] = useState<CartLine[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH")
  const [customerName, setCustomerName] = useState("")
  const [selectedCreditCustomer, setSelectedCreditCustomer] = useState<SelectedCreditCustomer | null>(null)
  const [transferNote, setTransferNote] = useState("")
  const [amountTendered, setAmountTendered] = useState("")
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [completedSale, setCompletedSale] = useState<{ id: string; total: number; changeGiven: number | null } | null>(
    null
  )
  const [printTransactionId, setPrintTransactionId] = useState<string | null>(null)

  const productsQuery = useQuery({
    queryKey: ["products", businessId],
    queryFn: () => productService.getProducts(businessId),
  })

  const products = productsQuery.data ?? []

  // Clears the ticket back to a blank state after a sale completes.
  const resetTicket = () => {
    setCart([])
    setPaymentMethod("CASH")
    setCustomerName("")
    setSelectedCreditCustomer(null)
    setTransferNote("")
    setAmountTendered("")
    setSubmitAttempted(false)
  }

  // Switching payment method clears whichever customer field isn't relevant
  // to the new method, so a stale free-text name or a stale credit
  // selection can never leak into a submission under the wrong method.
  const handlePaymentMethodChange = (method: PaymentMethod) => {
    setPaymentMethod(method)
    if (method === "CREDIT") {
      setCustomerName("")
    } else {
      setSelectedCreditCustomer(null)
    }
  }

  // Adds `quantity` of `product`, sold in the given pack size `unit`, to
  // the cart. Merges into an existing line only if the same product *and*
  // the same unit are already present - picking a different pack size for
  // a product already in the cart becomes a separate line instead, since
  // "2 dozen" and "3 pcs" of the same product can't share one quantity.
  // Refuses (with a toast) to exceed the product's available stock (always
  // in base-unit terms) at its primary warehouse.
  const addToCart = (
    product: productService.Product,
    quantity: number,
    unit: { label: string; factor: number }
  ) => {
    const availableStock = product.primaryStock?.quantity ?? 0
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === product.id && line.unit === unit.label)
      const nextQty = (existing?.quantity ?? 0) + quantity
      if (nextQty * unit.factor > availableStock) {
        toast.error(
          t("Only {{count}} {{unit}} of {{name}} in stock", {
            count: availableStock,
            unit: product.unit,
            name: product.name,
          })
        )
        return prev
      }
      if (existing) {
        return prev.map((line) =>
          line.productId === product.id && line.unit === unit.label ? { ...line, quantity: nextQty } : line
        )
      }
      const price = product.price * unit.factor
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          unit: unit.label,
          unitFactor: unit.factor,
          quantity,
          catalogPrice: price,
          unitPrice: price,
          availableStock,
        },
      ]
    })
  }

  // Credit sales must be tied to a real, already-known customer (for the
  // receivables/credit tracking on the Customers page, and so credit is
  // never extended to an untraceable name); other payment methods don't
  // require a customer at all.
  const customerMissing = paymentMethod === "CREDIT" && !selectedCreditCustomer

  // "Amount received" is optional (cashiers who don't care can leave it
  // blank), but if entered for a CASH sale it must cover the total - can't
  // give negative change.
  const total = cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  const tenderedNum = amountTendered.trim() === "" ? null : Number(amountTendered)
  const amountTenderedInsufficient =
    paymentMethod === "CASH" && tenderedNum != null && !Number.isNaN(tenderedNum) && tenderedNum < total

  const saleMutation = useMutation({
    mutationFn: () =>
      transactionService.createTransaction(businessId, {
        paymentMethod,
        ...(paymentMethod === "CREDIT"
          ? { customerId: selectedCreditCustomer!.id }
          : { customerName: customerName || undefined }),
        notes: paymentMethod === "TRANSFER" ? transferNote || undefined : undefined,
        amountTendered:
          paymentMethod === "CASH" && tenderedNum != null && !Number.isNaN(tenderedNum) ? tenderedNum : undefined,
        items: cart.map((line) => ({
          productId: line.productId,
          // The backend always deals in base-unit quantities/prices, so a
          // line sold "2 dozen at $100/dozen" becomes "24 pcs at
          // $8.3333/pcs" here - subtotal (quantity * price) is unchanged
          // either way. unitLabel/unitQuantity are stored purely so the
          // receipt can still say "2 dozen" instead of "24 pcs".
          quantitySold: line.quantity * line.unitFactor,
          unitPrice: Math.round((line.unitPrice / line.unitFactor) * 10000) / 10000,
          discountPercent: line.discountPercent,
          ...(line.unitFactor !== 1 && { unitLabel: line.unit, unitQuantity: line.quantity }),
        })),
      }),
    onSuccess: (transaction) => {
      queryClient.invalidateQueries({ queryKey: ["transactions", businessId] })
      queryClient.invalidateQueries({ queryKey: ["products", businessId] })
      queryClient.invalidateQueries({ queryKey: ["business", businessId] })
      setCompletedSale({ id: transaction.id, total: transaction.totalAmount, changeGiven: transaction.changeGiven })
      resetTicket()
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("Could not record sale"))
    },
  })

  // Guards the "Complete sale" action: if a credit sale is missing a
  // selected customer, or a cash amount received is less than the total,
  // flag the field as invalid instead of submitting.
  const handleComplete = () => {
    if (customerMissing || amountTenderedInsufficient) {
      setSubmitAttempted(true)
      return
    }
    saleMutation.mutate()
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:h-[calc(100svh-8.5rem)] lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4 lg:min-h-0">
        <div className="shrink-0">
          {productsQuery.isLoading ? (
            <Skeleton className="h-14 rounded-2xl" />
          ) : productsQuery.isError ? (
            <ErrorState onRetry={() => productsQuery.refetch()} />
          ) : products.length === 0 ? (
            <EmptyState
              icon={<Store className="size-6" />}
              title="No products yet"
              description="Add products from the Products page to start selling."
            />
          ) : (
            <ProductSearch products={products} currency={currency} onAdd={addToCart} />
          )}
        </div>

        <div className="flex-1 lg:min-h-0">
          {/*
            Cart line editing handlers, all operating on `cart` by
            (productId, unit) - a product can have two separate lines (e.g.
            "dozen" and "pcs") in the same sale, so both fields are needed
            to target the right one:
            - onIncrement/onDecrement: adjust quantity by 1, clamped to
              available stock in base-unit terms (increment) or removed
              once it hits 0 (decrement).
            - onPriceChange: sets a custom unit price and derives the
              equivalent discountPercent off the catalog price for display.
            - onDiscountChange: sets a discount percent and derives the
              resulting unit price (or clears both when discount is removed).
            - onRemove: drops the line entirely.
          */}
          <CartItemsPanel
            cart={cart}
            currency={currency}
            onIncrement={(productId, unit) =>
              setCart((prev) =>
                prev.map((line) => {
                  if (line.productId !== productId || line.unit !== unit) return line
                  if ((line.quantity + 1) * line.unitFactor > line.availableStock) {
                    toast.error(
                      t("Only {{count}} {{unit}} in stock", {
                        count: line.availableStock,
                        unit: line.unit,
                      })
                    )
                    return line
                  }
                  return { ...line, quantity: line.quantity + 1 }
                })
              )
            }
            onDecrement={(productId, unit) =>
              setCart((prev) =>
                prev
                  .map((line) =>
                    line.productId === productId && line.unit === unit
                      ? { ...line, quantity: line.quantity - 1 }
                      : line
                  )
                  .filter((line) => line.quantity > 0)
              )
            }
            onPriceChange={(productId, unit, price) =>
              setCart((prev) =>
                prev.map((line) => {
                  if (line.productId !== productId || line.unit !== unit) return line
                  const discountPercent =
                    line.catalogPrice > 0 && price < line.catalogPrice
                      ? Math.round((1 - price / line.catalogPrice) * 1000) / 10
                      : undefined
                  return { ...line, unitPrice: price, discountPercent }
                })
              )
            }
            onDiscountChange={(productId, unit, percent) =>
              setCart((prev) =>
                prev.map((line) => {
                  if (line.productId !== productId || line.unit !== unit) return line
                  if (percent === null) {
                    return { ...line, unitPrice: line.catalogPrice, discountPercent: undefined }
                  }
                  return {
                    ...line,
                    discountPercent: percent,
                    unitPrice: Math.round(line.catalogPrice * (1 - percent / 100) * 100) / 100,
                  }
                })
              )
            }
            onRemove={(productId, unit) =>
              setCart((prev) => prev.filter((line) => !(line.productId === productId && line.unit === unit)))
            }
          />
        </div>
      </div>

      <div className="lg:min-h-0">
        <SaleSummaryPanel
          businessId={businessId}
          cart={cart}
          currency={currency}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={handlePaymentMethodChange}
          customerName={customerName}
          onCustomerNameChange={setCustomerName}
          creditCustomer={selectedCreditCustomer}
          onCreditCustomerChange={setSelectedCreditCustomer}
          customerFieldError={
            submitAttempted && customerMissing
              ? t("Select an existing customer for credit sales")
              : undefined
          }
          transferNote={transferNote}
          onTransferNoteChange={setTransferNote}
          amountTendered={amountTendered}
          onAmountTenderedChange={setAmountTendered}
          amountTenderedError={
            submitAttempted && amountTenderedInsufficient
              ? t("Amount received can't be less than the total")
              : undefined
          }
          onComplete={handleComplete}
          isSubmitting={saleMutation.isPending}
        />
      </div>

      <Dialog open={!!completedSale} onOpenChange={(open) => !open && setCompletedSale(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-xs">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-success text-primary-foreground shadow-[0_0_24px_var(--glow-primary)]">
            <CheckCircle2 className="size-7" />
          </div>
          <DialogHeader>
            <DialogTitle className="text-center text-lg">{t("Sale complete")}</DialogTitle>
            <DialogDescription className="text-center">
              {t("{{amount}} recorded successfully.", {
                amount: completedSale ? formatMoney(completedSale.total, currency) : "",
              })}
            </DialogDescription>
          </DialogHeader>
          {completedSale?.changeGiven != null && completedSale.changeGiven > 0 && (
            <p className="-mt-2 text-center text-sm font-medium text-success">
              {t("Change due: {{amount}}", { amount: formatMoney(completedSale.changeGiven, currency) })}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button
              className="w-full rounded-xl bg-gradient-to-r from-primary to-success text-primary-foreground shadow-[0_0_16px_var(--glow-primary)] hover:opacity-90"
              onClick={() => {
                setPrintTransactionId(completedSale!.id)
                setCompletedSale(null)
              }}
            >
              <Printer className="size-4" />
              {t("Print receipt")}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setCompletedSale(null)}>
              {t("New sale")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <TransactionDetailSheet
        businessId={businessId}
        transactionId={printTransactionId}
        onOpenChange={(open) => !open && setPrintTransactionId(null)}
      />
    </div>
  )
}

/**
 * HistoryTab — paginated list of past sales for the business. Clicking a
 * row opens `TransactionDetailSheet` for that transaction (view/print).
 *
 * Data: `["transactions", businessId, page]` via
 * `transactionService.getTransactions` (20 per page); pagination state
 * (`page`) is local and drives both the query key and the prev/next controls.
 */
function HistoryTab({ businessId, currency }: { businessId: string; currency: string }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const transactionsQuery = useQuery({
    queryKey: ["transactions", businessId, page],
    queryFn: () => transactionService.getTransactions(businessId, { page, limit: 20 }),
  })

  const data = transactionsQuery.data
  const transactions = data?.transactions ?? []

  return (
    <div className="space-y-4">
      {transactionsQuery.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : transactionsQuery.isError ? (
        <ErrorState onRetry={() => transactionsQuery.refetch()} />
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={<Store className="size-6" />}
          title="No sales yet"
          description="Sales you record will show up here."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xl dark:bg-card/40">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Date")}</TableHead>
                  <TableHead>{t("Customer")}</TableHead>
                  <TableHead>{t("Items")}</TableHead>
                  <TableHead>{t("Payment")}</TableHead>
                  <TableHead>{t("Served by")}</TableHead>
                  <TableHead className="text-right">{t("Total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id} className="cursor-pointer" onClick={() => setSelectedId(tx.id)}>
                    <TableCell className="text-muted-foreground">{formatDateTime(tx.createdAt)}</TableCell>
                    <TableCell className="font-medium">{tx.customerName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {tx.items.length} {tx.items.length === 1 ? t("item") : t("items")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tx.paymentMethod}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{tx.performedBy.fullName}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(tx.totalAmount, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {data && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {t("Page {{page}} of {{totalPages}} · {{total}} sales", {
                  page: data.pagination.page,
                  totalPages: data.pagination.totalPages,
                  total: data.pagination.total,
                })}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="size-4" />
                  {t("Previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("Next")}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <TransactionDetailSheet
        businessId={businessId}
        transactionId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  )
}

/**
 * Pos page — the point-of-sale screen, split into two tabs: "Register"
 * (ring up a new sale, see `RegisterTab`) and "History" (browse past sales,
 * see `HistoryTab`). Requires an active business; shows an `EmptyState` if
 * none is selected. Currency for money formatting comes from
 * `useActiveBusiness()`.
 */
export default function Pos() {
  const { t } = useTranslation()
  const { activeBusinessId } = useAuth()
  const activeBusiness = useActiveBusiness()
  const currency = activeBusiness?.currency ?? "USD"

  if (!activeBusinessId) {
    return (
      <EmptyState
        icon={<Store className="size-6" />}
        title="No business selected"
        description="Select or create a business to start recording sales."
      />
    )
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">{t("Register")}</TabsTrigger>
          <TabsTrigger value="history">{t("History")}</TabsTrigger>
        </TabsList>
        <TabsContent value="register">
          <RegisterTab businessId={activeBusinessId} currency={currency} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab businessId={activeBusinessId} currency={currency} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
