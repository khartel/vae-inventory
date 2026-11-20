import { useState, type FormEvent } from "react"
import { ArrowRight, Minus, Pencil, Plus, ShoppingBag, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { formatMoney } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SaleTotals } from "./SaleTotals"

// A product can be sold in several packs on one ticket. Prices/quantities
// are in this line's selected unit; availableStock is always in base units.
export interface CartLine {
  productId: string
  name: string
  unit: string
  unitFactor: number
  quantity: number
  catalogPrice: number
  unitPrice: number
  discountPercent?: number
  availableStock: number
}
export type CartLineUpdate = Pick<CartLine, "quantity" | "unitPrice" | "discountPercent">
interface CartItemsPanelProps {
  cart: CartLine[]
  currency: string
  onQuantityChange: (line: CartLine, quantity: number) => boolean
  onUpdate: (line: CartLine, changes: CartLineUpdate) => boolean
  onRemove: (line: CartLine) => void
  onContinue: () => void
}

function CartLineEditor({ line, currency, onSave, onRemove, onClose }: {
  line: CartLine
  currency: string
  onSave: (changes: CartLineUpdate) => boolean
  onRemove: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [quantity, setQuantity] = useState(String(line.quantity))
  const [price, setPrice] = useState(String(line.unitPrice))
  const [discount, setDiscount] = useState(String(line.discountPercent ?? 0))
  const valid = Number.isFinite(Number(quantity)) && Number(quantity) > 0 && Number.isFinite(Number(price)) && Number(price) > 0 && Number.isFinite(Number(discount)) && Number(discount) >= 0 && Number(discount) < 100
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (valid && onSave({ quantity: Number(quantity), unitPrice: Number(price), discountPercent: Number(discount) > 0 ? Number(discount) : undefined })) onClose()
  }
  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="pocket-dialog">
      <DialogHeader><p className="pocket-eyebrow">{t("Edit item")}</p><DialogTitle>{line.name}</DialogTitle><DialogDescription>{t("Sold by the {{unit}}", { unit: line.unit })}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="pocket-dialog-form">
        <div className="pocket-form-grid">
          <label className="pocket-field">{t("Quantity")}<Input className="pocket-input" type="number" inputMode="decimal" min="0" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
          <label className="pocket-field">{t("Unit price")}<Input className="pocket-input" type="number" inputMode="decimal" min="0.0001" step="any" required value={price} onChange={(event) => {
            const next = event.target.value
            setPrice(next)
            setDiscount(line.catalogPrice > 0 && Number(next) < line.catalogPrice ? String(Math.min(99.99, Math.round((1 - Number(next) / line.catalogPrice) * 10000) / 100)) : "0")
          }} /></label>
          <label className="pocket-field pocket-field-full">{t("Discount (%)")}<Input className="pocket-input" type="number" inputMode="decimal" min="0" max="99.99" step="any" required value={discount} onChange={(event) => {
            const next = event.target.value
            setDiscount(next)
            if (Number(next) >= 0 && Number(next) < 100) setPrice(String(Math.round(line.catalogPrice * (1 - Number(next) / 100) * 100) / 100))
          }} /></label>
        </div>
        {!valid && <p className="pocket-error" role="alert">{t("Enter a positive quantity and price, with a discount below 100%.")}</p>}
        <div className="pocket-add-total"><span>{t("Line total")}</span><strong>{formatMoney(valid ? Number(quantity) * Number(price) : 0, currency)}</strong></div>
        <div className="pocket-editor-actions"><Button type="button" variant="outline" className="pocket-button" onClick={onRemove}><Trash2 className="size-4" />{t("Remove product")}</Button><Button type="submit" className="pocket-button pocket-primary" disabled={!valid}>{t("Save changes")}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}

/** Compact receipt with deliberate item editing rather than tiny inline fields. */
export function CartItemsPanel({ cart, currency, onQuantityChange, onUpdate, onRemove, onContinue }: CartItemsPanelProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<CartLine | null>(null)
  const selected = editing && cart.find((line) => line.productId === editing.productId && line.unit === editing.unit)
  return <section className="pocket-basket" aria-label={t("Your basket")}>
    <div className="pocket-panel-heading"><div><p className="pocket-eyebrow">{t("Review sale")}</p><h2>{t("Your basket")}</h2></div><span className="pocket-count">{t(cart.length === 1 ? "{{count}} item" : "{{count}} items", { count: cart.length })}</span></div>
    <div className="pocket-cart-lines">
      {cart.length === 0 ? <div className="pocket-empty"><ShoppingBag className="size-8" /><h3>{t("Your basket is ready")}</h3><p>{t("Add a product to start the sale.")}</p></div> : cart.map((line) => {
        const otherQuantity = cart.reduce((sum, other) => sum + (other.productId === line.productId && other.unit !== line.unit ? other.quantity * other.unitFactor : 0), 0)
        return <article className="pocket-cart-line" key={`${line.productId}-${line.unit}`}>
          <div className="pocket-line-top"><button type="button" className="pocket-line-edit" onClick={() => setEditing(line)} aria-label={t("Edit {{name}}", { name: line.name })}>{line.name}<Pencil className="size-3" /></button><strong className="pocket-line-total">{formatMoney(line.quantity * line.unitPrice, currency)}</strong></div>
          <p className="pocket-line-meta">{line.unit} · {formatMoney(line.unitPrice, currency)} / {line.unit}</p>
          <div className="pocket-line-bottom"><div className="pocket-quantity"><Button type="button" variant="ghost" size="icon" aria-label={t("Decrease quantity of {{name}}", { name: line.name })} onClick={() => onQuantityChange(line, line.quantity - 1)}><Minus className="size-3.5" /></Button><span>{line.quantity}</span><Button type="button" variant="ghost" size="icon" aria-label={t("Increase quantity of {{name}}", { name: line.name })} disabled={otherQuantity + (line.quantity + 1) * line.unitFactor > line.availableStock} onClick={() => onQuantityChange(line, line.quantity + 1)}><Plus className="size-3.5" /></Button></div>
            {line.discountPercent != null && line.discountPercent > 0 && <span className="pocket-discount">−{line.discountPercent}%</span>}
            <Button type="button" variant="ghost" size="icon" className="pocket-remove" aria-label={t("Remove {{name}}", { name: line.name })} onClick={() => onRemove(line)}><Trash2 className="size-3.5" /></Button>
          </div>
        </article>
      })}
    </div>
    <div className="pocket-panel-footer"><SaleTotals cart={cart} currency={currency} /><Button type="button" className="pocket-button pocket-primary pocket-charge" disabled={!cart.length} onClick={onContinue}>{t("Continue to payment")}<ArrowRight className="size-4" /></Button></div>
    {selected && <CartLineEditor key={`${selected.productId}-${selected.unit}`} line={selected} currency={currency} onSave={(changes) => onUpdate(selected, changes)} onRemove={() => { onRemove(selected); setEditing(null) }} onClose={() => setEditing(null)} />}
  </section>
}
