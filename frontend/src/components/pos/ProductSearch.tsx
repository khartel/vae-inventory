import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Plus, Search, ShoppingBasket, X } from "lucide-react"
import type { Product } from "@/services/product.service"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import { getUnitChoices } from "@/lib/units"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { UnitChoice } from "@/lib/units"

/**
 * POS product picker: a search box with a live filtered dropdown (matches
 * against product name or short code, client-side against the in-memory
 * `products` list — no network call), and, once a product is selected, a
 * unit selector (always shown - see `getUnitChoices`, which always offers
 * at least the base unit, plus configured alternates and the implicit
 * pcs/dozen pairing), a quantity input, and an "Add" button that calls
 * `onAdd(product, quantity, unit)` to push it into the cart. Enforces that
 * quantity (converted via the selected unit's factor) is within available
 * stock (`canAdd`) and disables adding out-of-stock products entirely.
 */
export function ProductSearch({
  products,
  currency,
  onAdd,
}: {
  products: Product[]
  currency: string
  onAdd: (product: Product, quantity: number, unit: UnitChoice) => void
}) {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState("1")
  const [unitLabel, setUnitLabel] = useState<string>("")
  const searchRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()

  // Client-side filter of `products` by name/short code, capped to 6
  // suggestions. Hidden once a product is selected (query then shows the
  // selected product's name instead of live-filtering).
  const results = useMemo(() => {
    if (selected || !query.trim()) return []
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.shortCode?.toLowerCase().includes(q))
      .slice(0, 6)
  }, [products, query, selected])

  // As soon as a product is selected, default the unit back to its base
  // unit and jump focus to the quantity field, selecting its text so the
  // cashier can immediately type a new quantity.
  useEffect(() => {
    if (selected) {
      setUnitLabel(selected.unit)
      qtyRef.current?.focus()
      qtyRef.current?.select()
    }
  }, [selected])

  // Pack-size choices for the selected product - see `getUnitChoices`.
  const unitChoices: UnitChoice[] = useMemo(() => {
    if (!selected) return []
    return getUnitChoices(selected)
  }, [selected])
  const selectedUnit = unitChoices.find((u) => u.label === unitLabel) ?? unitChoices[0]
  const unitFactor = selectedUnit?.factor ?? 1

  const stock = selected?.primaryStock?.quantity ?? 0
  const qtyNum = parseFloat(quantity) || 0
  const isOutOfStock = !!selected && stock <= 0
  const canAdd = !!selected && qtyNum > 0 && qtyNum * unitFactor <= stock

  // Resets the picker back to its empty state and refocuses the search box,
  // used both after adding to cart and when the user clears the search.
  const clear = () => {
    setSelected(null)
    setQuery("")
    setQuantity("1")
    setUnitLabel("")
    searchRef.current?.focus()
  }

  const handleAdd = () => {
    if (!selected || !canAdd || !selectedUnit) return
    onAdd(selected, qtyNum, selectedUnit)
    clear()
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          placeholder={t("Search products to add...")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (selected) setSelected(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results.length === 1) {
              setSelected(results[0])
              setQuery(results[0].name)
            }
          }}
          className="h-14 rounded-2xl pl-12 pr-10 text-base"
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label={t("Clear search")}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        )}

        {results.length > 0 && (
          <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-border/60 bg-popover/95 shadow-xl backdrop-blur-2xl dark:bg-popover/80">
            {results.map((product) => {
              const productStock = product.primaryStock?.quantity ?? 0
              const outOfStock = productStock <= 0
              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => {
                    setSelected(product)
                    setQuery(product.name)
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b border-border/40 px-4 py-3 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:bg-muted",
                    outOfStock ? "cursor-not-allowed opacity-40" : "hover:bg-muted"
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {product.name}
                      {product.shortCode && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {product.shortCode}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {outOfStock
                        ? t("Out of stock")
                        : t("{{count}} {{unit}} left", { count: productStock, unit: product.unit })}
                    </p>
                  </div>
                  <span className="shrink-0 font-heading text-sm font-semibold text-success">
                    {formatMoney(product.price, currency)}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {query && !selected && results.length === 0 && (
          <div className="absolute z-20 mt-2 w-full rounded-2xl border border-border/60 bg-popover/95 px-4 py-3 text-sm text-muted-foreground shadow-xl backdrop-blur-2xl dark:bg-popover/80">
            {t('No products match "{{query}}"', { query })}
          </div>
        )}
      </div>

      {selected ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl dark:bg-card/40">
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-base font-semibold">{selected.name}</p>
            <p className="text-sm text-muted-foreground">
              {formatMoney(selected.price * unitFactor, currency)} ·{" "}
              {isOutOfStock
                ? t("Out of stock")
                : t("{{count}} {{unit}} available", { count: stock, unit: selected.unit })}
            </p>
            {!isOutOfStock && qtyNum * unitFactor > stock && (
              <p className="mt-0.5 text-xs text-destructive">
                {t("Only {{count}} {{unit}} in stock", { count: stock, unit: selected.unit })}
              </p>
            )}
          </div>
          <Select value={unitLabel} onValueChange={setUnitLabel}>
            <SelectTrigger className="h-11 w-28 shrink-0 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {unitChoices.map((choice) => (
                <SelectItem key={choice.label} value={choice.label}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            ref={qtyRef}
            type="number"
            min="0"
            step="any"
            aria-label={t("Quantity")}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canAdd) handleAdd()
            }}
            disabled={isOutOfStock}
            className="h-11 w-20 rounded-xl text-center"
          />
          <Button
            onClick={handleAdd}
            disabled={!canAdd}
            className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-primary to-success text-primary-foreground shadow-[0_0_16px_var(--glow-primary)] hover:opacity-90"
          >
            <Plus className="size-4" />
            {t("Add")}
          </Button>
        </div>
      ) : (
        !query && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 py-10 text-center text-muted-foreground">
            <ShoppingBasket className="size-7 opacity-40" />
            <p className="text-sm">{t("Search a product above to start the sale")}</p>
          </div>
        )
      )}
    </div>
  )
}
