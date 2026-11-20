import { useTranslation } from "react-i18next"
import { ArrowLeft, ArrowRight, Banknote, HandCoins, Landmark, Loader2, ShoppingBag } from "lucide-react"
import { formatMoney } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CustomerNameField } from "./CustomerNameField"
import { CreditCustomerPicker, type SelectedCreditCustomer } from "./CreditCustomerPicker"
import type { CartLine } from "./CartItemsPanel"
import type { PaymentMethod } from "@/services/transaction.service"

interface SaleSummaryPanelProps {
  businessId: string
  cart: CartLine[]
  currency: string
  paymentMethod: PaymentMethod
  onPaymentMethodChange: (method: PaymentMethod) => void
  customerName: string
  onCustomerNameChange: (value: string) => void
  creditCustomer: SelectedCreditCustomer | null
  onCreditCustomerChange: (value: SelectedCreditCustomer | null) => void
  customerFieldError?: string
  transferNote: string
  onTransferNoteChange: (value: string) => void
  amountTendered: string
  onAmountTenderedChange: (value: string) => void
  amountTenderedError?: string
  onComplete: () => void
  onBack: () => void
  isSubmitting: boolean
}

/** Payment is a separate step; all sale data still belongs to RegisterTab. */
export function SaleSummaryPanel({ businessId, cart, currency, paymentMethod, onPaymentMethodChange,
  customerName, onCustomerNameChange, creditCustomer, onCreditCustomerChange, customerFieldError,
  transferNote, onTransferNoteChange, amountTendered, onAmountTenderedChange, amountTenderedError,
  onComplete, onBack, isSubmitting }: SaleSummaryPanelProps) {
  const { t } = useTranslation()
  const total = Math.round(cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100
  const tendered = amountTendered.trim() === "" ? null : Number(amountTendered)
  const change = tendered != null && Number.isFinite(tendered) && tendered >= total ? tendered - total : null
  const methods = [{ value: "CASH", label: t("Cash"), Icon: Banknote }, { value: "TRANSFER", label: t("Transfer"), Icon: Landmark }, { value: "CREDIT", label: t("Credit"), Icon: HandCoins }] as const
  return <section className="pocket-payment" aria-label={t("Take payment")}>
    <div className="pocket-payment-scroll">
      <div className="pocket-payment-heading"><h2>{t("Take payment")}</h2><Button type="button" variant="ghost" size="icon" aria-label={t("Back to basket")} onClick={onBack} disabled={isSubmitting}><ArrowLeft className="size-4" /></Button></div>
      <div className="pocket-payment-total"><span>{t("Total to collect")}</span><strong>{formatMoney(total, currency)}</strong></div>
      <div className="pocket-methods" aria-label={t("Payment method")}>{methods.map(({ value, label, Icon }) => <Button key={value} type="button" variant="outline" className="pocket-method" aria-pressed={paymentMethod === value} onClick={() => onPaymentMethodChange(value)} disabled={isSubmitting}><Icon className="size-4" />{label}</Button>)}</div>
      <div className="pocket-field"><p>{paymentMethod === "CREDIT" ? t("Credit customer · required") : t("Customer · optional")}</p>
        {paymentMethod === "CREDIT" ? <CreditCustomerPicker businessId={businessId} value={creditCustomer} onChange={onCreditCustomerChange} error={customerFieldError} /> : <CustomerNameField businessId={businessId} value={customerName} onChange={onCustomerNameChange} placeholder={t("Customer name (optional)")} />}
      </div>
      {paymentMethod === "CASH" && <>
        <label className="pocket-field">{t("Cash received · optional")}<Input type="number" inputMode="decimal" min="0" step="any" className="pocket-input" value={amountTendered} onChange={(event) => onAmountTenderedChange(event.target.value)} placeholder={formatMoney(0, currency)} aria-invalid={!!amountTenderedError} /></label>
        {amountTenderedError && <p className="pocket-error" role="alert">{amountTenderedError}</p>}
        <div className="pocket-change" aria-live="polite"><span>{t("Change to return")}</span><strong>{change == null ? "—" : formatMoney(change, currency)}</strong></div>
      </>}
      {paymentMethod === "TRANSFER" && <label className="pocket-field">{t("Transfer reference · optional")}<Input className="pocket-input" placeholder={t("Reference or sender name")} value={transferNote} onChange={(event) => onTransferNoteChange(event.target.value)} /></label>}
      {paymentMethod === "CREDIT" && <p className="pocket-credit-note">{t("This sale will be added to the selected customer’s credit balance.")}</p>}
      <div className="pocket-review-strip"><ShoppingBag className="size-4" /><span>{t(cart.length === 1 ? "{{count}} product line" : "{{count}} product lines", { count: cart.length })}</span></div>
    </div>
    <div className="pocket-panel-footer"><Button type="button" className="pocket-button pocket-primary pocket-charge" disabled={!cart.length || isSubmitting} onClick={onComplete}>{isSubmitting ? <><Loader2 className="size-4 animate-spin" />{t("Recording sale…")}</> : <><span>{t("Charge {{amount}}", { amount: formatMoney(total, currency) })}</span><ArrowRight className="size-4" /></>}</Button></div>
  </section>
}
