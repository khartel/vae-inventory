import { useState } from "react"
import { useForm, useFieldArray, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, PackagePlus, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as stockService from "@/services/stock.service"
import * as warehouseService from "@/services/warehouse.service"
import * as productService from "@/services/product.service"
import { getUnitChoices } from "@/lib/units"
import { useAuth } from "@/context/AuthContext"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ProductPicker } from "@/components/products/ProductPicker"
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

// Validation for the receive-stock form: a warehouse, one or more (product, quantity)
// line items, and an optional note. The `.refine` guards against selecting the same
// product twice across items.
const schema = z
  .object({
    warehouseId: z.string().min(1, "Select a warehouse"),
    items: z
      .array(
        z.object({
          productId: z.string().min(1, "Select a product"),
          quantity: z.coerce.number().positive("Quantity must be greater than 0"),
          // Which pack size `quantity` is counted in - empty string means
          // the product's base unit. Converted to a base-unit quantity at
          // submit time, so this never reaches the backend as-is.
          unit: z.string().optional(),
        })
      )
      .min(1, "Add at least one product"),
    notes: z.string().trim().optional(),
  })
  .refine(
    (data) => {
      const ids = data.items.map((i) => i.productId).filter(Boolean)
      return new Set(ids).size === ids.length
    },
    { message: "Each product can only be added once", path: ["items"] }
  )

type FormValues = z.input<typeof schema>
type ParsedValues = z.output<typeof schema>

const emptyValues: FormValues = {
  warehouseId: "",
  items: [{ productId: "", quantity: 0, unit: "" }],
  notes: "",
}

/**
 * Dialog for recording incoming stock: pick a warehouse, then add one or more
 * (product, quantity) line items in a single submission.
 *
 * Behavior:
 * - Warehouses and products are only fetched while the dialog is `open`.
 * - Uses `useFieldArray` to manage the dynamic list of line items (add/remove rows).
 * - Each row's `ProductPicker` excludes products already chosen in other rows
 *   (`excludeIds`, derived from `watchedItems`) to prevent duplicate entries.
 * - On success, invalidates products, warehouses, stock movements, and stock queries
 *   since receiving stock affects all of them, then resets the form back to one
 *   empty line item.
 */
export function ReceiveStockDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { activeBusinessId } = useAuth()
  const queryClient = useQueryClient()

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
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues,
  })

  const { fields, append, remove } = useFieldArray({ control, name: "items" })
  const watchedItems = watch("items")

  // Resolves a row's chosen pack size to its conversion factor (1 for the
  // base unit or when no unit was picked) via `getUnitChoices`, so the
  // implicit pcs/dozen pairing is honored here too, not just configured
  // alternate units.
  const getUnitFactor = (productId: string, unitLabel: string | undefined) => {
    if (!unitLabel) return 1
    const product = productsQuery.data?.find((p) => p.id === productId)
    if (!product) return 1
    return getUnitChoices(product).find((u) => u.label === unitLabel)?.factor ?? 1
  }

  const mutation = useMutation({
    mutationFn: (values: ParsedValues) =>
      stockService.receiveStock(activeBusinessId!, {
        warehouseId: values.warehouseId,
        notes: values.notes,
        // The backend always expects a base-unit quantity; a row entered
        // as "3 cartons" becomes "72 pcs" here. unitLabel/unitQuantity are
        // passed through purely so stock-movement history can still say
        // "3 cartons" instead of "72 pcs".
        items: values.items.map((item) => {
          const factor = getUnitFactor(item.productId, item.unit)
          return {
            productId: item.productId,
            quantity: item.quantity * factor,
            ...(item.unit && factor !== 1 && { unitLabel: item.unit, unitQuantity: item.quantity }),
          }
        }),
      }),
    onSuccess: (_, values) => {
      queryClient.invalidateQueries({ queryKey: ["products", activeBusinessId] })
      queryClient.invalidateQueries({ queryKey: ["warehouses", activeBusinessId] })
      queryClient.invalidateQueries({ queryKey: ["stock-movements", activeBusinessId] })
      queryClient.invalidateQueries({ queryKey: ["stock", activeBusinessId] })
      toast.success(
        values.items.length === 1
          ? t("Stock added")
          : t("Stock added for {{count}} products", { count: values.items.length })
      )
      setOpen(false)
      reset(emptyValues)
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("Could not add stock"))
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset(emptyValues)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <PackagePlus className="size-4" />
          {t("Add stock")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Add stock")}</DialogTitle>
          <DialogDescription>
            {t("Receive incoming stock into a warehouse — add one or more products at once.")}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="space-y-1.5">
              <Label htmlFor="receive-warehouse">{t("Warehouse")}</Label>
              <Controller
                control={control}
                name="warehouseId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="receive-warehouse" className="w-full">
                      <SelectValue placeholder={t("Select a warehouse")} />
                    </SelectTrigger>
                    <SelectContent>
                      {warehousesQuery.data?.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name} {w.isPrimary && t("(Primary)")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.warehouseId?.message && <p className="text-xs text-destructive">{t(errors.warehouseId.message)}</p>}
            </div>

            <div className="space-y-3">
              <Label>{t("Products")}</Label>
              {fields.map((field, index) => {
                const rowProduct = productsQuery.data?.find((p) => p.id === watchedItems?.[index]?.productId)
                const rowProductIdError = errors.items?.[index]?.productId?.message
                return (
                <div key={field.id} className="flex items-start gap-2">
                  <div className="flex-1">
                    <Controller
                      control={control}
                      name={`items.${index}.productId`}
                      render={({ field: pickerField }) => (
                        <ProductPicker
                          products={productsQuery.data ?? []}
                          value={pickerField.value}
                          onChange={pickerField.onChange}
                          excludeIds={(watchedItems ?? [])
                            .map((item, i) => (i === index ? "" : item?.productId))
                            .filter((id): id is string => !!id)}
                        />
                      )}
                    />
                    {rowProductIdError && (
                      <p className="mt-1 text-xs text-destructive">
                        {t(rowProductIdError)}
                      </p>
                    )}
                  </div>
                  {rowProduct && (
                    <Controller
                      control={control}
                      name={`items.${index}.unit`}
                      render={({ field: unitField }) => (
                        <Select value={unitField.value || rowProduct.unit} onValueChange={unitField.onChange}>
                          <SelectTrigger className="w-28 shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {getUnitChoices(rowProduct).map((u) => (
                              <SelectItem key={u.label} value={u.label}>
                                {u.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  )}
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder={t("Qty")}
                    className="w-24"
                    {...register(`items.${index}.quantity`)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("Remove product")}
                    disabled={fields.length === 1}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                )
              })}
              {errors.items?.root?.message && (
                <p className="text-xs text-destructive">{t(errors.items.root.message)}</p>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ productId: "", quantity: 0, unit: "" })}
              >
                <Plus className="size-3.5" />
                {t("Add another product")}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="receive-notes">{t("Notes (optional)")}</Label>
              <Textarea
                id="receive-notes"
                rows={2}
                placeholder={t("e.g. supplier, delivery reference")}
                {...register("notes")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {t("Add stock")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
