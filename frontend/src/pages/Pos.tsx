import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, History, Printer, ShoppingBag, Store } from "lucide-react"
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
import { CartItemsPanel, type CartLine, type CartLineUpdate } from "@/components/pos/CartItemsPanel"
import { SaleSummaryPanel } from "@/components/pos/SaleSummaryPanel"
import type { SelectedCreditCustomer } from "@/components/pos/CreditCustomerPicker"
import { TransactionDetailSheet } from "@/components/transactions/TransactionDetailSheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import "@/components/pos/pocket-register.css"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/** Pocket Register: one ticket, a browsable catalog, and three responsive steps. */
function RegisterTab({ businessId, currency }: { businessId: string; currency: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<"products" | "basket" | "payment">("products")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH")
  const [customerName, setCustomerName] = useState("")
  const [selectedCreditCustomer, setSelectedCreditCustomer] = useState<SelectedCreditCustomer | null>(null)
  const [transferNote, setTransferNote] = useState("")
  const [amountTendered, setAmountTendered] = useState("")
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [completedSale, setCompletedSale] = useState<{ id: string; total: number; changeGiven: number | null } | null>(null)
  const [printTransactionId, setPrintTransactionId] = useState<string | null>(null)
  const submitLock = useRef(false)
  const productsQuery = useQuery({ queryKey: ["products", businessId], queryFn: () => productService.getProducts(businessId) })
  const products = productsQuery.data ?? []
  const total = Math.round(cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100

  const resetTicket = () => {
    setCart([])
    setStep("products")
    setPaymentMethod("CASH")
    setCustomerName("")
    setSelectedCreditCustomer(null)
    setTransferNote("")
    setAmountTendered("")
    setSubmitAttempted(false)
  }
  const handlePaymentMethodChange = (method: PaymentMethod) => {
    if (method === paymentMethod) return
    setPaymentMethod(method)
    setSubmitAttempted(false)
    if (method === "CREDIT") setCustomerName("")
    else setSelectedCreditCustomer(null)
  }

  // Count every pack of a product in base units, not only the matching line.
  const addToCart = (product: productService.Product, quantity: number, unit: { label: string; factor: number }) => {
    const availableStock = product.primaryStock?.quantity ?? 0
    const reserved = cart.reduce((sum, line) => sum + (line.productId === product.id ? line.quantity * line.unitFactor : 0), 0)
    if (!Number.isFinite(quantity) || quantity <= 0 || reserved + quantity * unit.factor > availableStock) {
      toast.error(t("Only {{count}} {{unit}} of {{name}} in stock", { count: availableStock, unit: product.unit, name: product.name }))
      return false
    }
    setCart((previous) => {
      const existing = previous.find((line) => line.productId === product.id && line.unit === unit.label)
      if (existing) return previous.map((line) => line === existing ? { ...line, quantity: line.quantity + quantity, availableStock } : line)
      const price = product.price * unit.factor
      return [...previous, { productId: product.id, name: product.name, unit: unit.label, unitFactor: unit.factor, quantity, catalogPrice: price, unitPrice: price, availableStock }]
    })
    return true
  }
  const removeLine = (line: CartLine) => setCart((previous) => previous.filter((item) => item.productId !== line.productId || item.unit !== line.unit))
  const updateLine = (line: CartLine, changes: CartLineUpdate) => {
    const availableStock = products.find((product) => product.id === line.productId)?.primaryStock?.quantity ?? line.availableStock
    const otherQuantity = cart.reduce((sum, other) => sum + (other.productId === line.productId && other.unit !== line.unit ? other.quantity * other.unitFactor : 0), 0)
    if (!Number.isFinite(changes.quantity) || changes.quantity <= 0 || !Number.isFinite(changes.unitPrice) || changes.unitPrice <= 0) return false
    if (otherQuantity + changes.quantity * line.unitFactor > availableStock) {
      toast.error(t("Only {{count}} {{unit}} available for this sale", { count: Math.max(0, availableStock - otherQuantity), unit: products.find((product) => product.id === line.productId)?.unit ?? line.unit }))
      return false
    }
    setCart((previous) => previous.map((item) => item.productId === line.productId && item.unit === line.unit ? { ...item, ...changes, availableStock } : item))
    return true
  }

  const customerMissing = paymentMethod === "CREDIT" && !selectedCreditCustomer
  const tenderedNum = amountTendered.trim() === "" ? null : Number(amountTendered)
  const invalidCash = paymentMethod === "CASH" && tenderedNum != null && (!Number.isFinite(tenderedNum) || tenderedNum < total)
  const saleMutation = useMutation({
    mutationFn: () => transactionService.createTransaction(businessId, {
      paymentMethod,
      ...(paymentMethod === "CREDIT" ? { customerId: selectedCreditCustomer!.id } : { customerName: customerName || undefined }),
      notes: paymentMethod === "TRANSFER" ? transferNote || undefined : undefined,
      amountTendered: paymentMethod === "CASH" && tenderedNum != null ? tenderedNum : undefined,
      items: cart.map((line) => ({
        productId: line.productId,
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
      queryClient.invalidateQueries({ queryKey: ["dashboard-sales", businessId] })
      queryClient.invalidateQueries({ queryKey: ["report-stock-alerts", businessId] })
      queryClient.invalidateQueries({ queryKey: ["warehouses", businessId] })
      queryClient.invalidateQueries({ queryKey: ["stock", businessId] })
      queryClient.invalidateQueries({ queryKey: ["customers", businessId] })
      setCompletedSale({ id: transaction.id, total: transaction.totalAmount, changeGiven: transaction.changeGiven })
      resetTicket()
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("Could not record sale")),
    onSettled: () => { submitLock.current = false },
  })
  const handleComplete = () => {
    if (submitLock.current || !cart.length) return
    if (customerMissing || invalidCash) { setSubmitAttempted(true); return }
    if (cart.some((line) => !Number.isFinite(line.unitPrice) || line.unitPrice <= 0)) {
      toast.error(t("Every item needs a positive selling price. Edit the item in your basket."))
      return
    }
    submitLock.current = true
    saleMutation.mutate()
  }

  return <section className="pocket-register" aria-label={t("Pocket Register")}>
    <header className="pocket-heading">
      <div><p className="pocket-eyebrow">{t("Pocket Register")}</p><h1>{t("Let’s ring it up.")}</h1></div>
      <nav className="pocket-steps" aria-label={t("Sale steps")}>
        {([{ value: "products", label: t("Products") }, { value: "basket", label: t("Basket") }, { value: "payment", label: t("Payment") }] as const).map((item, index) => <Button key={item.value} type="button" variant="ghost" className="pocket-step" aria-pressed={step === item.value} aria-current={step === item.value ? "step" : undefined} disabled={saleMutation.isPending || (item.value === "payment" && !cart.length)} onClick={() => setStep(item.value)}><span>{index + 1}</span>{item.label}</Button>)}
      </nav>
      <Button type="button" variant="outline" className="pocket-button pocket-history-button" aria-label={t("Recent sales")} disabled={saleMutation.isPending} onClick={() => setHistoryOpen(true)}><History className="size-4" /><span>{t("Recent sales")}</span></Button>
    </header>
    <fieldset className="pocket-body" data-step={step} disabled={saleMutation.isPending}>
      <legend className="sr-only">{t("New sale")}</legend>
      <div className="pocket-products-pane">
        {productsQuery.isLoading ? <Skeleton className="h-full min-h-40 rounded-2xl" /> : productsQuery.isError ? <ErrorState onRetry={() => productsQuery.refetch()} /> : products.length === 0 ? <EmptyState icon={<Store className="size-6" />} title="No products yet" description="Add products from the Products page to start selling." /> : <ProductSearch products={products} cart={cart} currency={currency} onAdd={addToCart} />}
      </div>
      <div className="pocket-checkout-pane">
        {step === "payment" ? <SaleSummaryPanel businessId={businessId} cart={cart} currency={currency} paymentMethod={paymentMethod} onPaymentMethodChange={handlePaymentMethodChange} customerName={customerName} onCustomerNameChange={setCustomerName} creditCustomer={selectedCreditCustomer} onCreditCustomerChange={setSelectedCreditCustomer} customerFieldError={submitAttempted && customerMissing ? t("Select an existing customer for credit sales") : undefined} transferNote={transferNote} onTransferNoteChange={setTransferNote} amountTendered={amountTendered} onAmountTenderedChange={setAmountTendered} amountTenderedError={submitAttempted && invalidCash ? t("Amount received can't be less than the total") : undefined} onComplete={handleComplete} onBack={() => setStep("basket")} isSubmitting={saleMutation.isPending} /> : <CartItemsPanel cart={cart} currency={currency} onUpdate={updateLine} onRemove={removeLine} onQuantityChange={(line, quantity) => { if (quantity <= 0) { removeLine(line); return true }; return updateLine(line, { quantity, unitPrice: line.unitPrice, discountPercent: line.discountPercent }) }} onContinue={() => setStep("payment")} />}
      </div>
      <Button type="button" className="pocket-mobile-dock pocket-primary" disabled={!cart.length} onClick={() => setStep("basket")}><ShoppingBag className="size-5" /><span>{t(cart.length === 1 ? "{{count}} item · Review sale" : "{{count}} items · Review sale", { count: cart.length })}</span><strong>{formatMoney(total, currency)}</strong><ArrowRight className="size-4" /></Button>
    </fieldset>
    <span className="sr-only" role="status">{t(cart.length === 1 ? "{{count}} item in basket. Total {{amount}}." : "{{count}} items in basket. Total {{amount}}.", { count: cart.length, amount: formatMoney(total, currency) })}</span>
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="pocket-dialog pocket-history-dialog"><DialogHeader><DialogTitle>{t("Recent sales")}</DialogTitle><DialogDescription>{t("View past sales and print a receipt.")}</DialogDescription></DialogHeader><div className="pocket-history-content"><HistoryTab businessId={businessId} currency={currency} /></div></DialogContent></Dialog>
    <Dialog open={!!completedSale} onOpenChange={(open) => !open && setCompletedSale(null)}>
      <DialogContent showCloseButton={false} className="pocket-dialog pocket-success-dialog">
        <div className="pocket-success-icon"><CheckCircle2 className="size-7" /></div>
        <DialogHeader><DialogTitle className="text-center">{t("Sale complete")}</DialogTitle><DialogDescription className="text-center">{t("{{amount}} recorded successfully.", { amount: completedSale ? formatMoney(completedSale.total, currency) : "" })}</DialogDescription></DialogHeader>
        {completedSale?.changeGiven != null && completedSale.changeGiven > 0 && <p className="pocket-success-change">{t("Change due: {{amount}}", { amount: formatMoney(completedSale.changeGiven, currency) })}</p>}
        <Button className="pocket-button pocket-primary pocket-wide" onClick={() => { setPrintTransactionId(completedSale!.id); setCompletedSale(null) }}><Printer className="size-4" />{t("Print receipt")}</Button>
        <Button variant="outline" className="pocket-button pocket-wide" onClick={() => setCompletedSale(null)}>{t("New sale")}</Button>
      </DialogContent>
    </Dialog>
    <TransactionDetailSheet businessId={businessId} transactionId={printTransactionId} onOpenChange={(open) => !open && setPrintTransactionId(null)} />
  </section>
}

/**
 * HistoryTab — paginated recent-sales dialog for the active business. Clicking a
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

/** Changing businesses always starts a fresh ticket. */
export default function Pos() {
  const { activeBusinessId } = useAuth()
  const activeBusiness = useActiveBusiness()
  if (!activeBusinessId) return <EmptyState icon={<Store className="size-6" />} title="No business selected" description="Select or create a business to start recording sales." />
  return <RegisterTab key={activeBusinessId} businessId={activeBusinessId} currency={activeBusiness?.currency ?? "USD"} />
}
