import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Minus, Percent, Plus, ShoppingCart, Trash2, X } from "lucide-react"
import { formatMoney } from "@/lib/format"
import { Input } from "@/components/ui/input"

// A single line item in the POS cart. `catalogPrice` is the product's
// original list price *for the selected pack size* (i.e. product.price *
// unitFactor), while `unitPrice` is the (possibly discounted) price
// actually charged for that same pack size; `discountPercent`, when set,
// is what produced that discount and is shown/editable via
// `DiscountControl`. `unit`/`unitFactor` describe which pack size this
// line is in (factor 1 for the product's base unit) - `quantity` is a
// count of that unit, and `availableStock` is always in base-unit terms,
// so callers must compare `quantity * unitFactor` against it.
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

// Cart lines are keyed by productId + unit (not just productId), since the
// same product can appear as two separate lines when sold in two different
// pack sizes in the same sale - every mutation handler below identifies
// the target line by both.
interface CartItemsPanelProps {
  cart: CartLine[]
  currency: string
  onIncrement: (productId: string, unit: string) => void
  onDecrement: (productId: string, unit: string) => void
  onPriceChange: (productId: string, unit: string, price: number) => void
  onDiscountChange: (productId: string, unit: string, percent: number | null) => void
  onRemove: (productId: string, unit: string) => void
}

/**
 * Per-cart-line discount widget with three visual states:
 * 1. A discount is already applied — shows the struck-through catalog price,
 *    the discount badge, and a button to remove it.
 * 2. `editing` — shows a small numeric input (0-100) to type a new percent,
 *    confirmed with Enter/the check button or cancelled with Escape/the X.
 *    An out-of-range value (<=0 or >100) is silently ignored rather than
 *    surfaced as a validation error.
 * 3. Default — a plain "Add discount" link that opens the editing state.
 */
function DiscountControl({
  line,
  currency,
  onDiscountChange,
}: {
  line: CartLine
  currency: string
  onDiscountChange: (percent: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(line.discountPercent?.toString() ?? "")
  const { t } = useTranslation()

  if (line.discountPercent) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground line-through">
          {formatMoney(line.catalogPrice, currency)}
        </span>
        <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
          -{line.discountPercent}%
        </span>
        <button
          type="button"
          onClick={() => onDiscountChange(null)}
          aria-label={t("Remove discount")}
          className="rounded text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" />
        </button>
      </div>
    )
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min="0"
          max="100"
          step="any"
          autoFocus
          placeholder="%"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const pct = parseFloat(draft)
              if (pct > 0 && pct <= 100) onDiscountChange(pct)
              setEditing(false)
            }
            if (e.key === "Escape") setEditing(false)
          }}
          className="h-6 w-14 text-xs"
        />
        <button
          type="button"
          onClick={() => {
            const pct = parseFloat(draft)
            if (pct > 0 && pct <= 100) onDiscountChange(pct)
            setEditing(false)
          }}
          aria-label={t("Apply discount")}
          className="rounded text-success transition-colors hover:text-success/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          aria-label={t("Cancel discount")}
          className="rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft("")
        setEditing(true)
      }}
      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Percent className="size-3" />
      {t("Add discount")}
    </button>
  )
}

/**
 * Scrollable list of the current POS sale's line items. Each line shows the
 * product name, a quantity stepper (increment disabled once `quantity`
 * reaches `availableStock`), an editable unit price, the computed line
 * total, and a `DiscountControl` for applying/removing a percent discount.
 * All mutations (`onIncrement`, `onDecrement`, `onPriceChange`,
 * `onDiscountChange`, `onRemove`) are delegated to the parent — this
 * component holds no cart state of its own beyond the per-line discount
 * editor's local draft.
 */
export function CartItemsPanel({
  cart,
  currency,
  onIncrement,
  onDecrement,
  onPriceChange,
  onDiscountChange,
  onRemove,
}: CartItemsPanelProps) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full flex-col rounded-3xl border border-border/60 bg-card/60 shadow-lg backdrop-blur-2xl dark:bg-card/40">
      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
        <ShoppingCart className="size-4.5 text-success" />
        <h2 className="font-heading text-base font-semibold">{t("Current sale")}</h2>
        {cart.length > 0 && (
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {cart.length === 1 ? t("{{count}} item", { count: cart.length }) : t("{{count}} items", { count: cart.length })}
          </span>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
            <ShoppingCart className="size-8 opacity-40" />
            <p className="text-sm">{t("Search a product to add it to the sale")}</p>
          </div>
        ) : (
          cart.map((line) => (
            <div key={`${line.productId}-${line.unit}`} className="rounded-xl border border-border/60 bg-background/40 p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug">{line.name}</p>
                  {line.unitFactor !== 1 && (
                    <p className="text-xs text-muted-foreground">{t("Sold by the {{unit}}", { unit: line.unit })}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(line.productId, line.unit)}
                  aria-label={t("Remove {{name}}", { name: line.name })}
                  className="shrink-0 rounded text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 rounded-full border border-border/60 bg-card/60 p-0.5">
                  <button
                    type="button"
                    onClick={() => onDecrement(line.productId, line.unit)}
                    className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t("Decrease quantity")}
                  >
                    <Minus className="size-3" />
                  </button>
                  <span className="w-8 text-center text-sm font-medium tabular-nums">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onIncrement(line.productId, line.unit)}
                    disabled={(line.quantity + 1) * line.unitFactor > line.availableStock}
                    className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                    aria-label={t("Increase quantity")}
                  >
                    <Plus className="size-3" />
                  </button>
                </div>

                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={line.unitPrice}
                  onChange={(e) => onPriceChange(line.productId, line.unit, parseFloat(e.target.value) || 0)}
                  className="h-7 w-20 text-right text-xs"
                />

                <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {formatMoney(line.quantity * line.unitPrice, currency)}
                </span>
              </div>
              <div className="mt-2">
                <DiscountControl
                  line={line}
                  currency={currency}
                  onDiscountChange={(percent) => onDiscountChange(line.productId, line.unit, percent)}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
