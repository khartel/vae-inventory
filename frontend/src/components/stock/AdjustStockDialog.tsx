import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardEdit, Loader2 } from "lucide-react"
import { toast } from "sonner"
import * as stockService from "@/services/stock.service"
import * as warehouseService from "@/services/warehouse.service"
import * as productService from "@/services/product.service"
import { useAuth } from "@/context/AuthContext"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Validation schema for the adjust-stock form. `actualQuantity` uses
// z.coerce since the underlying <Input type="number"> yields a string.
const schema = z.object({
  productId: z.string().min(1, "Select a product"),
  warehouseId: z.string().min(1, "Select a warehouse"),
  actualQuantity: z.coerce.number().nonnegative("Actual quantity can't be negative"),
  reason: z.enum(["DAMAGED", "MISCOUNTED", "THEFT", "OTHER"], {
    message: "Select a reason",
  }),
  notes: z.string().trim().optional(),
})

// FormValues is the raw (pre-coercion) shape react-hook-form works with;
// ParsedValues is what comes out after zod resolves/coerces it (e.g.
// `actualQuantity` as a number) — used as the mutation's input type.
type FormValues = z.input<typeof schema>
type ParsedValues = z.output<typeof schema>

const REASONS: Array<{ value: ParsedValues["reason"]; label: string }> = [
  { value: "MISCOUNTED", label: "Miscounted" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "THEFT", label: "Theft / shrinkage" },
  { value: "OTHER", label: "Other" },
]

/**
 * Dialog + trigger button for reconciling a warehouse's system-recorded
 * count for one product to a physical (shelf) count — a cycle-count
 * correction, distinct from a restock or transfer, with a required reason.
 * Warehouse and product lists are fetched lazily (`enabled: open && ...`)
 * only once the dialog is opened. The current system count for the chosen
 * product/warehouse pair is read off the already-loaded product list (each
 * product carries its own per-warehouse `stock`, see product.service.ts) —
 * no separate stock query needed. On successful submit, invalidates the
 * stock-movements and products queries so affected views refresh, then
 * closes the dialog and resets the form.
 */
export function AdjustStockDialog() {
  const [open, setOpen] = useState(false)
  const { activeBusinessId } = useAuth()
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  const warehousesQuery = useQuery({
    queryKey: ["warehouses", activeBusinessId],
    queryFn: () => warehouseService.getWarehouses(activeBusinessId!),
    enabled: open && !!activeBusinessId,
  })
  const productsQuery = useQuery({
    queryKey: ["products", activeBusinessId],
    queryFn: () => productService.getProducts(activeBusinessId!),
    enabled: open && !!activeBusinessId,
  })

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(schema),
    defaultValues: { productId: "", warehouseId: "", actualQuantity: 0, reason: undefined, notes: "" },
  })

  const productId = watch("productId")
  const warehouseId = watch("warehouseId")
  const actualQuantity = watch("actualQuantity")

  const selectedProduct = productsQuery.data?.find((p) => p.id === productId)
  const systemQuantity = selectedProduct?.stock.find((s) => s.warehouse.id === warehouseId)?.quantity ?? 0
  const delta = productId && warehouseId ? Number(actualQuantity || 0) - systemQuantity : 0

  const mutation = useMutation({
    mutationFn: (values: ParsedValues) => stockService.adjustStock(activeBusinessId!, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-movements", activeBusinessId] })
      queryClient.invalidateQueries({ queryKey: ["products", activeBusinessId] })
      toast.success(t("Stock adjusted"))
      setOpen(false)
      reset()
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("Could not adjust stock"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ClipboardEdit className="size-4" />
          {t("Adjust stock")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Adjust stock")}</DialogTitle>
          <DialogDescription>{t("Reconcile the system count against a physical count.")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="adjust-product">{t("Product")}</Label>
            <Controller
              control={control}
              name="productId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="adjust-product" className="w-full">
                    <SelectValue placeholder={t("Select a product")} />
                  </SelectTrigger>
                  <SelectContent>
                    {productsQuery.data?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.productId && <p className="text-xs text-destructive">{t(errors.productId.message ?? "")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adjust-warehouse">{t("Warehouse")}</Label>
            <Controller
              control={control}
              name="warehouseId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="adjust-warehouse" className="w-full">
                    <SelectValue placeholder={t("Select a warehouse")} />
                  </SelectTrigger>
                  <SelectContent>
                    {warehousesQuery.data?.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.warehouseId && <p className="text-xs text-destructive">{t(errors.warehouseId.message ?? "")}</p>}
          </div>

          {productId && warehouseId && (
            <p className="text-xs text-muted-foreground">
              {t("System count: {{count}} {{unit}}", { count: systemQuantity, unit: selectedProduct?.unit ?? "" })}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="adjust-qty">{t("Actual (counted) quantity")}</Label>
            <Input id="adjust-qty" type="number" step="any" min="0" {...register("actualQuantity")} />
            {errors.actualQuantity && (
              <p className="text-xs text-destructive">{t(errors.actualQuantity.message ?? "")}</p>
            )}
            {productId && warehouseId && delta !== 0 && (
              <p className={delta > 0 ? "text-xs text-success" : "text-xs text-destructive"}>
                {delta > 0
                  ? t("→ +{{count}} found", { count: delta })
                  : t("→ {{count}} missing", { count: delta })}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adjust-reason">{t("Reason")}</Label>
            <Controller
              control={control}
              name="reason"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="adjust-reason" className="w-full">
                    <SelectValue placeholder={t("Select a reason")} />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {t(r.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.reason && <p className="text-xs text-destructive">{t(errors.reason.message ?? "")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adjust-notes">{t("Notes (optional)")}</Label>
            <Textarea id="adjust-notes" rows={2} {...register("notes")} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {t("Adjust stock")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
