import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useForm, useFieldArray, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftRight, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import * as stockService from "@/services/stock.service"
import * as warehouseService from "@/services/warehouse.service"
import * as productService from "@/services/product.service"
import { useAuth } from "@/context/AuthContext"
import { ApiError } from "@/lib/api-client"
import { invalidateStockQueries } from "@/lib/stock-movements"
import { getUnitChoices } from "@/lib/units"
import { ErrorState } from "@/components/ErrorState"
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

const schema = z.object({
  fromWarehouseId: z.string().min(1, "Select a source warehouse"),
  toWarehouseId: z.string().min(1, "Select a destination warehouse"),
  items: z.array(z.object({
    productId: z.string().min(1, "Select a product"),
    quantity: z.coerce.number().positive("Quantity must be greater than 0"),
    unit: z.string(),
  })).min(1, "Add at least one product").max(500),
  notes: z.string().trim().optional(),
}).refine((data) => data.fromWarehouseId !== data.toWarehouseId, {
  message: "Source and destination must be different", path: ["toWarehouseId"],
}).refine((data) => new Set(data.items.map((item) => item.productId)).size === data.items.length, {
  message: "Each product can only be added once", path: ["items"],
});

type FormValues = z.input<typeof schema>
type ParsedValues = z.output<typeof schema>
const emptyValues: FormValues = {
  fromWarehouseId: "", toWarehouseId: "", items: [{ productId: "", quantity: "", unit: "" }], notes: "",
}

/** A single route, multiple product lines, and one atomic transfer submission. */
export function MoveStockDialog() {
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

  const { register, control, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(schema), defaultValues: emptyValues,
  })
  const { fields, append, remove } = useFieldArray({ control, name: "items" })
  const items = watch("items")
  const sourceId = watch("fromWarehouseId")
  const destinationId = watch("toWarehouseId")
  const products = productsQuery.data ?? []

  const mutation = useMutation({
    mutationFn: (values: ParsedValues) => stockService.moveStockBatch(activeBusinessId!, {
      fromWarehouseId: values.fromWarehouseId, toWarehouseId: values.toWarehouseId, notes: values.notes,
      items: values.items.map((item) => {
        const product = products.find((entry) => entry.id === item.productId)!
        const choice = getUnitChoices(product).find((unit) => unit.label === item.unit) ?? { label: product.unit, factor: 1 }
        return {
          productId: item.productId, quantity: item.quantity * choice.factor,
          ...(choice.factor !== 1 && { unitLabel: choice.label, unitQuantity: item.quantity }),
        }
      }),
    }),
    onSuccess: () => {
      invalidateStockQueries(queryClient, activeBusinessId)
      toast.success(t("Stock moved"))
      setOpen(false)
      reset(emptyValues)
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("Could not move stock"))
    },
  })

  const loading = warehousesQuery.isLoading || productsQuery.isLoading
  const failed = warehousesQuery.isError || productsQuery.isError

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.isPending) { setOpen(next); if (!next) reset(emptyValues) } }}>
      <DialogTrigger asChild>
        <Button><ArrowLeftRight className="size-4" aria-hidden="true" />{t("Move stock")}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Move stock")}</DialogTitle>
          <DialogDescription>{t("Choose a route, then add all the products to move together.")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="flex min-h-0 flex-1 flex-col gap-4">
          <fieldset disabled={mutation.isPending || loading} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-1">
            {failed && <ErrorState onRetry={() => { warehousesQuery.refetch(); productsQuery.refetch() }} />}
            <div className="grid gap-4 sm:grid-cols-2">
              {(["fromWarehouseId", "toWarehouseId"] as const).map((name) => (
                <div key={name} className="space-y-1.5">
                  <Label htmlFor={`move-${name}`}>{t(name === "fromWarehouseId" ? "From warehouse" : "To warehouse")}</Label>
                  <Controller control={control} name={name} render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={`move-${name}`} className="w-full"><SelectValue placeholder={t(name === "fromWarehouseId" ? "Source" : "Destination")} /></SelectTrigger>
                      <SelectContent>
                        {(warehousesQuery.data ?? []).filter((warehouse) => warehouse.id !== (name === "fromWarehouseId" ? destinationId : sourceId)).map((warehouse) => (
                          <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                  {errors[name]?.message && <p className="text-xs text-destructive">{t(errors[name].message)}</p>}
                </div>
              ))}
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">{t("Products to move")}</p>
              {fields.map((field, index) => {
                const selected = products.find((product) => product.id === items[index]?.productId)
                const available = selected?.stock.find((entry) => entry.warehouse.id === sourceId)?.quantity ?? 0
                const chosenIds = items.filter((_, i) => i !== index).map((item) => item.productId)
                const activeChoice = selected
                  ? getUnitChoices(selected).find((unit) => unit.label === items[index]?.unit) ?? { label: selected.unit, factor: 1 }
                  : null
                const enteredQuantity = Number(items[index]?.quantity)
                const requestedBase =
                  activeChoice && Number.isFinite(enteredQuantity) && enteredQuantity > 0
                    ? enteredQuantity * activeChoice.factor
                    : null
                const exceedsAvailable = Boolean(sourceId && requestedBase !== null && requestedBase > available)
                return (
                  <div key={field.id} className="rounded-lg border border-border p-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`move-product-${index}`}>{t("Product")} {index + 1}</Label>
                        <Controller control={control} name={`items.${index}.productId`} render={({ field: productField }) => (
                          <Select value={productField.value} onValueChange={(value) => { productField.onChange(value); setValue(`items.${index}.unit`, "") }}>
                            <SelectTrigger id={`move-product-${index}`} className="w-full"><SelectValue placeholder={t("Select a product")} /></SelectTrigger>
                            <SelectContent>
                              {products.filter((product) => !chosenIds.includes(product.id)).map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )} />
                        {errors.items?.[index]?.productId?.message && <p className="text-xs text-destructive">{t(errors.items[index].productId.message)}</p>}
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={t("Remove product {{number}}", { number: index + 1 })} disabled={fields.length === 1} onClick={() => remove(index)}><Trash2 className="size-4" /></Button>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`move-quantity-${index}`}>{t("Quantity")}</Label>
                        <Input id={`move-quantity-${index}`} type="number" step="any" min="0" {...register(`items.${index}.quantity`)} />
                        {errors.items?.[index]?.quantity?.message && <p className="text-xs text-destructive">{t(errors.items[index].quantity.message)}</p>}
                      </div>
                      {selected && <div className="space-y-1.5">
                        <Label htmlFor={`move-unit-${index}`}>{t("Unit")}</Label>
                        <Controller control={control} name={`items.${index}.unit`} render={({ field: unitField }) => (
                          <Select value={unitField.value || selected.unit} onValueChange={unitField.onChange}>
                            <SelectTrigger id={`move-unit-${index}`} className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>{getUnitChoices(selected).map((unit) => <SelectItem key={unit.label} value={unit.label}>{unit.label}</SelectItem>)}</SelectContent>
                          </Select>
                        )} />
                      </div>}
                    </div>
                    {selected && sourceId && (
                      <p className={`mt-2 text-xs ${exceedsAvailable ? "text-destructive" : "text-muted-foreground"}`}>
                        {t("Available: {{quantity}} {{unit}}", { quantity: available, unit: selected.unit })}
                        {requestedBase !== null && activeChoice && (activeChoice.factor !== 1 || exceedsAvailable) && (
                          <> · {t("Requested: {{quantity}} {{unit}}", { quantity: requestedBase, unit: selected.unit })}</>
                        )}
                        {exceedsAvailable && <> · {t("Exceeds available stock")}</>}
                      </p>
                    )}
                  </div>
                )
              })}
              {(errors.items?.root?.message || errors.items?.message) && <p className="text-xs text-destructive">{t(errors.items.root?.message ?? errors.items.message ?? "")}</p>}
              <Button type="button" variant="outline" size="sm" disabled={fields.length >= 500} onClick={() => append({ productId: "", quantity: "", unit: "" })}><Plus className="size-4" />{t("Add another product")}</Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="move-notes">{t("Notes (optional)")}</Label>
              <Textarea id="move-notes" rows={2} {...register("notes")} />
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || loading || failed}>
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("Move stock")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
