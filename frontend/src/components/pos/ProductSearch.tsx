import { useMemo, useRef, useState, type FormEvent } from "react"
import { Package, Plus, Search, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { Product } from "@/services/product.service"
import { formatMoney } from "@/lib/format"
import { getUnitChoices, type UnitChoice } from "@/lib/units"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { CartLine } from "./CartItemsPanel"

interface ProductSearchProps {
  products: Product[]
  cart: CartLine[]
  currency: string
  onAdd: (product: Product, quantity: number, unit: UnitChoice) => boolean
}

/** The catalog has no image field; use a quiet, recognizable name mark. */
export function ProductMark({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()
  return <span className="pocket-product-mark" aria-hidden="true"><Package /><span>{initials}</span></span>
}

function AddProductDialog({ product, available, currency, onAdd, onClose }: {
  product: Product
  available: number
  currency: string
  onAdd: ProductSearchProps["onAdd"]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const quantityRef = useRef<HTMLInputElement>(null)
  const choices = getUnitChoices(product)
  const [unitLabel, setUnitLabel] = useState(product.unit)
  const [quantity, setQuantity] = useState("1")
  const unit = choices.find((choice) => choice.label === unitLabel) ?? choices[0]
  const qty = Number(quantity)
  const canAdd = Number.isFinite(qty) && qty > 0 && qty * unit.factor <= available
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canAdd && onAdd(product, qty, unit)) onClose()
  }
  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="pocket-dialog" onOpenAutoFocus={(event) => {
      event.preventDefault()
      quantityRef.current?.focus()
      quantityRef.current?.select()
    }}>
      <DialogHeader><p className="pocket-eyebrow">{t("Add to sale")}</p><DialogTitle>{product.name}</DialogTitle><DialogDescription>{t("{{count}} {{unit}} available", { count: available, unit: product.unit })}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="pocket-dialog-form">
        <div className="pocket-form-grid">
          <label className="pocket-field">{t("Pack size")}<select className="pocket-input" value={unitLabel} onChange={(event) => setUnitLabel(event.target.value)}>{choices.map((choice) => <option key={choice.label} value={choice.label}>{choice.label}</option>)}</select></label>
          <label className="pocket-field">{t("Quantity")}<Input ref={quantityRef} type="number" inputMode="decimal" min="0" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} className="pocket-input" /></label>
        </div>
        {qty > 0 && qty * unit.factor > available && <p role="alert" className="pocket-error">{t("Only {{count}} {{unit}} available for this sale", { count: available, unit: product.unit })}</p>}
        <div className="pocket-add-total"><span>{formatMoney(product.price * unit.factor, currency)} / {unit.label}</span><strong>{formatMoney(Number.isFinite(qty) && qty > 0 ? qty * product.price * unit.factor : 0, currency)}</strong></div>
        <Button type="submit" className="pocket-button pocket-primary pocket-wide" disabled={!canAdd}><Plus className="size-4" />{t("Add to basket")}</Button>
      </form>
    </DialogContent>
  </Dialog>
}

/** Search remains local to the loaded catalog, with Enter for a unique match. */
export function ProductSearch({ products, cart, currency, onAdd }: ProductSearchProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Product | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const reserved = useMemo(() => {
    const quantities = new Map<string, number>()
    cart.forEach((line) => quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity * line.unitFactor))
    return quantities
  }, [cart])
  const remaining = (product: Product) => Math.max(0, (product.primaryStock?.quantity ?? 0) - (reserved.get(product.id) ?? 0))
  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return products.filter((product) => !q || product.name.toLocaleLowerCase().includes(q) || product.shortCode?.toLocaleLowerCase().includes(q))
  }, [products, query])
  return <div className="pocket-catalog">
    <div className="pocket-search"><Search className="size-5" aria-hidden="true" />
      <Input ref={searchRef} aria-label={t("Search products by name or short code")} placeholder={t("Search name or short code…")} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && results.length === 1 && remaining(results[0]) > 0) { event.preventDefault(); setSelected(results[0]) } }} />
      {query && <Button variant="ghost" size="icon" onClick={() => { setQuery(""); searchRef.current?.focus() }} aria-label={t("Clear search")}><X className="size-4" /></Button>}
    </div>
    <div className="pocket-catalog-label"><span>{query ? t("Search results") : t("All products")}</span><span>{t(results.length === 1 ? "{{count}} product" : "{{count}} products", { count: results.length })}</span></div>
    <div className="pocket-product-list" aria-label={t("Products")}>
      {results.length === 0 ? <div className="pocket-empty"><Search className="size-7" /><p>{t('No products match "{{query}}"', { query })}</p></div> : results.map((product) => {
        const stock = remaining(product)
        const inBasket = reserved.get(product.id) ?? 0
        return <button key={product.id} type="button" className="pocket-product" disabled={stock <= 0} aria-label={t("Add {{name}}", { name: product.name })} onClick={() => setSelected(product)}>
          <ProductMark name={product.name} />
          <span className="pocket-product-info"><strong>{product.name}</strong><small>{product.shortCode && <><span className="pocket-short-code">{product.shortCode}</span><span aria-hidden="true"> · </span></>}{stock <= 0 ? (inBasket > 0 ? t("All available stock in basket") : t("Out of stock")) : t("{{count}} {{unit}} available", { count: stock, unit: product.unit })}</small></span>
          <span className="pocket-product-price"><strong>{formatMoney(product.price, currency)}</strong><span className="pocket-product-plus"><Plus className="size-4" /></span></span>
        </button>
      })}
    </div>
    {selected && <AddProductDialog product={selected} available={remaining(selected)} currency={currency} onAdd={onAdd} onClose={() => { setSelected(null); setQuery(""); searchRef.current?.focus() }} />}
  </div>
}
