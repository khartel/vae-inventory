import { useTranslation } from "react-i18next"
import { formatMoney } from "@/lib/format"
import type { CartLine } from "./CartItemsPanel"

export function SaleTotals({ cart, currency }: { cart: CartLine[]; currency: string }) {
  const { t } = useTranslation()
  const total = cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  // A price override above catalog is already the agreed selling price.
  const subtotal = cart.reduce((sum, line) => sum + line.quantity * Math.max(line.catalogPrice, line.unitPrice), 0)
  return <div className="pocket-sale-totals">
    <div><span>{t("Subtotal")}</span><span>{formatMoney(subtotal, currency)}</span></div>
    {subtotal - total > 0.005 && <div><span>{t("Item discounts")}</span><span>− {formatMoney(subtotal - total, currency)}</span></div>}
    <div className="pocket-total"><span>{t("Total")}</span><strong>{formatMoney(total, currency)}</strong></div>
  </div>
}
