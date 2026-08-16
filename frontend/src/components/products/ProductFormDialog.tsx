import { useEffect, useState } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as productService from "@/services/product.service"
import type { Product } from "@/services/product.service"
import { PRESET_UNITS } from "@/lib/units"
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

// Preset unit choices offered in the "Unit" dropdown; selecting "Other (custom)" (OTHER_UNIT)
// switches the field into free-text entry mode instead.
const UNIT_OPTIONS = PRESET_UNITS
const OTHER_UNIT = "__other__"

// Units whose relationship to a base unit is fixed by definition, so we can
// fill in (and lock) the factor instead of asking the shop owner to type it.
// Everything else ("carton", "box", "pack", ...) genuinely varies by product/
// supplier, so those stay manually entered.
const FIXED_UNIT_FACTORS: Record<string, number> = {
  dozen: 12,
}

// Units whose size genuinely varies by product/supplier - a carton of one
// item isn't the same count as a carton of another. Rather than a raw
// "Factor" box, these get a friendlier "how many pcs are in one X?"
// question instead (see the base-unit `pcsPerContainer` field and the
// alt-unit-row placeholder swap below).
const CONTAINER_UNITS = ["carton", "box", "pack", "bag"]

// Alternate units aren't always bigger packs of the base unit ("dozen" = 12
// pcs) - they can also be a subdivision of it (e.g. base unit is "dozen",
// but customers sometimes want to buy 3 individual "pcs" = 3/12 of a
// dozen). Rather than making shop owners type an awkward decimal like
// "0.0833", the factor field accepts simple fraction syntax ("1/12") too.
function parseUnitFactor(raw: string): number {
  const trimmed = raw.trim()
  const fraction = trimmed.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (fraction) {
    const denominator = Number(fraction[2])
    return denominator === 0 ? NaN : Number(fraction[1]) / denominator
  }
  return Number(trimmed)
}

const unitFactorSchema = z
  .string()
  .trim()
  .min(1, "Factor is required")
  .transform((val, ctx) => {
    const parsed = parseUnitFactor(val)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      ctx.addIssue({ code: "custom", message: "Must be a positive number, e.g. 12 or 1/12" })
      return z.NEVER
    }
    return parsed
  })

const schema = z
  .object({
    name: z.string().trim().min(1, "Product name is required"),
    unit: z.string().trim().min(1, "Unit is required (e.g. pcs, kg, box)"),
    price: z.coerce.number().min(0, "Price cannot be negative"),
    // Optional and SuperAdmin/Admin-only (this whole dialog only ever opens
    // for those roles - see Products.tsx's canManage gate). What the
    // business pays for this product, distinct from the selling `price`.
    // Same blank-means-unset string->number transform as pcsPerContainer below.
    costPrice: z
      .string()
      .trim()
      .optional()
      .transform((val, ctx) => {
        if (!val) return undefined
        const parsed = Number(val)
        if (!Number.isFinite(parsed) || parsed < 0) {
          ctx.addIssue({ code: "custom", message: "Cost price cannot be negative" })
          return z.NEVER
        }
        return parsed
      }),
    description: z.string().trim().optional(),
    shortCode: z.string().trim().max(20, "Keep it to 20 characters or fewer").optional(),
    // Alternate pack sizes - bigger (e.g. "dozen" = 12 base units, factor
    // 12) or smaller (e.g. base unit is "dozen" but "pcs" = 1/12 of one,
    // factor 0.0833...). Price for each is always product.price * factor -
    // no separate price field here.
    units: z
      .array(
        z.object({
          label: z.string().trim().min(1, "Unit label is required"),
          factor: unitFactorSchema,
        })
      )
      .optional(),
    // Only used when `unit` is a container unit (see CONTAINER_UNITS) - how
    // many pcs are in one of them. Optional; blank means this product only
    // ever sells by the whole container. Composited into `units` as a
    // derived "pcs" entry (factor = 1 / count) before submission, not sent
    // to the backend as its own field.
    pcsPerContainer: z
      .string()
      .trim()
      .optional()
      .transform((val, ctx) => {
        if (!val) return undefined
        const parsed = parseUnitFactor(val)
        if (!Number.isFinite(parsed) || parsed <= 0) {
          ctx.addIssue({ code: "custom", message: "Must be a positive number" })
          return z.NEVER
        }
        return parsed
      }),
  })
  .superRefine((data, ctx) => {
    if (!data.units || data.units.length === 0) return
    const seen = new Set([data.unit.trim().toLowerCase()])
    data.units.forEach((u, index) => {
      const key = u.label.trim().toLowerCase()
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Must differ from the base unit and other alternate units",
          path: ["units", index, "label"],
        })
      }
      seen.add(key)
    })
    if (data.pcsPerContainer !== undefined) {
      const pcsRowIndex = data.units.findIndex((u) => u.label.trim().toLowerCase() === "pcs")
      if (pcsRowIndex !== -1) {
        ctx.addIssue({
          code: "custom",
          message: "Already covered by \"How many pcs...\" above - remove this row",
          path: ["units", pcsRowIndex, "label"],
        })
      }
    }
  })

type FormValues = z.input<typeof schema>
type ParsedValues = z.output<typeof schema>

/**
 * Dialog for creating or editing a product. Dual-purpose based on whether a
 * `product` is passed in:
 * - No `product`: "New product" button trigger, creates a new catalog entry.
 * - `product` provided: pencil icon-button trigger (isEdit = true), updates it;
 *   form fields are pre-filled via RHF's `values` option.
 *
 * Non-obvious behavior:
 * - The unit field supports arbitrary custom units. `customUnitMode` tracks whether
 *   the Select should show "Other (custom)" and reveal a free-text Input instead of
 *   one of the `UNIT_OPTIONS`. It's initialized from whether the product's existing
 *   unit is already in the preset list, and re-synced via useEffect whenever
 *   `product` changes (e.g. dialog reused for a different product).
 *
 * On success, invalidates the products list and the active business (whose summary
 * may include product counts).
 */
export function ProductFormDialog({ product }: { product?: Product }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { activeBusinessId } = useAuth()
  const queryClient = useQueryClient()
  const isEdit = !!product

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(schema),
    values: {
      name: product?.name ?? "",
      unit: product?.unit ?? "",
      price: product?.price ?? 0,
      costPrice: product?.costPrice != null ? String(product.costPrice) : "",
      description: product?.description ?? "",
      shortCode: product?.shortCode ?? "",
      // When the base unit is a container, a "pcs" entry (if present) is
      // pulled out of the list and shown as `pcsPerContainer` instead - see
      // the render section below. It's re-derived as `count = 1/factor`.
      units: (product?.units ?? [])
        .filter(
          (u) =>
            !(CONTAINER_UNITS.includes((product?.unit ?? "").trim().toLowerCase()) && u.label.trim().toLowerCase() === "pcs")
        )
        .map(({ label, factor }) => ({ label, factor: String(factor) })),
      pcsPerContainer: (() => {
        if (!product || !CONTAINER_UNITS.includes(product.unit.trim().toLowerCase())) return ""
        const pcsUnit = product.units.find((u) => u.label.trim().toLowerCase() === "pcs")
        return pcsUnit ? String(Math.round(1 / pcsUnit.factor)) : ""
      })(),
    },
  })

  const { fields: unitFields, append: appendUnit, remove: removeUnit } = useFieldArray({
    control,
    name: "units",
  })

  const unitValue = watch("unit") ?? ""
  const isContainerUnit = CONTAINER_UNITS.includes(unitValue.trim().toLowerCase())
  const [customUnitMode, setCustomUnitMode] = useState(
    () => unitValue !== "" && !UNIT_OPTIONS.includes(unitValue)
  )

  useEffect(() => {
    const initial = product?.unit ?? ""
    setCustomUnitMode(initial !== "" && !UNIT_OPTIONS.includes(initial))
  }, [product?.unit])

  // Same custom-vs-preset toggle as the base unit field, but one per
  // alternate-unit row (indexed the same as `unitFields`/`units`). Synced
  // whenever `product` changes (dialog reused for a different product);
  // `handleAppendUnit`/`handleRemoveUnit` keep it aligned with row
  // insertions/removals so indices never drift out of sync.
  const [customUnitRows, setCustomUnitRows] = useState<boolean[]>(() =>
    (product?.units ?? []).map((u) => !UNIT_OPTIONS.includes(u.label))
  )

  useEffect(() => {
    setCustomUnitRows((product?.units ?? []).map((u) => !UNIT_OPTIONS.includes(u.label)))
  }, [product?.units])

  const watchedUnits = watch("units")

  const handleAppendUnit = () => {
    appendUnit({ label: "", factor: "1" })
    setCustomUnitRows((prev) => [...prev, false])
  }

  const handleRemoveUnit = (index: number) => {
    removeUnit(index)
    setCustomUnitRows((prev) => prev.filter((_, i) => i !== index))
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["products", activeBusinessId] })
    queryClient.invalidateQueries({ queryKey: ["business", activeBusinessId] })
  }

  // `pcsPerContainer` is a form-only convenience, not a real product field -
  // fold it into `units` as a derived "pcs" entry (factor = 1/count) before
  // sending, and drop it from the payload the backend doesn't know about.
  const buildPayload = (values: ParsedValues) => {
    const { pcsPerContainer, ...rest } = values
    const units = [...(rest.units ?? [])]
    if (pcsPerContainer !== undefined && CONTAINER_UNITS.includes(rest.unit.trim().toLowerCase())) {
      units.push({ label: "pcs", factor: 1 / pcsPerContainer })
    }
    return { ...rest, units }
  }

  const mutation = useMutation({
    mutationFn: (values: ParsedValues) =>
      isEdit
        ? productService.updateProduct(activeBusinessId!, product.id, buildPayload(values))
        : productService.createProduct(activeBusinessId!, buildPayload(values)),
    onSuccess: () => {
      invalidate()
      toast.success(isEdit ? t("Product updated") : t("Product created"))
      setOpen(false)
      if (!isEdit) reset()
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("Something went wrong"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="outline" size="icon-sm" aria-label={t("Edit product")}>
            <Pencil className="size-3.5" />
          </Button>
        ) : (
          <Button>
            <Plus className="size-4" />
            {t("New product")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("Edit product") : t("Create a product")}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? t("Update {{name}}'s details.", { name: product.name })
              : t("Add a new product to this business's catalog.")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prod-name">{t("Name")}</Label>
            <Input id="prod-name" autoFocus {...register("name")} />
            {errors.name?.message && <p className="text-xs text-destructive">{t(errors.name.message)}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="prod-unit">{t("Unit")}</Label>
              <Select
                value={customUnitMode ? OTHER_UNIT : unitValue}
                onValueChange={(value) => {
                  if (value === OTHER_UNIT) {
                    setCustomUnitMode(true)
                    setValue("unit", "", { shouldValidate: false })
                    setValue("pcsPerContainer", "")
                  } else {
                    setCustomUnitMode(false)
                    setValue("unit", value, { shouldValidate: true })
                    if (!CONTAINER_UNITS.includes(value)) setValue("pcsPerContainer", "")
                  }
                }}
              >
                <SelectTrigger id="prod-unit" className="w-full">
                  <SelectValue placeholder={t("Select a unit")} />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_UNIT}>{t("Other (custom)")}</SelectItem>
                </SelectContent>
              </Select>
              {customUnitMode && (
                <Input
                  autoFocus
                  placeholder={t("Type a custom unit")}
                  value={unitValue}
                  onChange={(e) => setValue("unit", e.target.value, { shouldValidate: true })}
                />
              )}
              {errors.unit?.message && <p className="text-xs text-destructive">{t(errors.unit.message)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prod-price">{t("Price")}</Label>
              <Input id="prod-price" type="number" step="0.01" min="0" {...register("price")} />
              {errors.price?.message && <p className="text-xs text-destructive">{t(errors.price.message)}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prod-cost-price">{t("Cost price (optional)")}</Label>
            <Input id="prod-cost-price" type="number" step="0.01" min="0" {...register("costPrice")} />
            <p className="text-xs text-muted-foreground">
              {t("What this costs you. Only visible to you and other managers - never shown to Employees or on receipts.")}
            </p>
            {errors.costPrice?.message && <p className="text-xs text-destructive">{t(errors.costPrice.message)}</p>}
          </div>
          {isContainerUnit && (
            <div className="space-y-1.5">
              <Label htmlFor="prod-pcs-per-container">
                {t("How many pcs are in one {{unit}}? (optional)", { unit: unitValue })}
              </Label>
              <Input
                id="prod-pcs-per-container"
                type="number"
                step="any"
                min="0"
                placeholder={t("e.g. 24")}
                {...register("pcsPerContainer")}
              />
              <p className="text-xs text-muted-foreground">
                {t("Optional. Skip this if you only sell whole {{unit}}s.", { unit: unitValue })}
              </p>
              {errors.pcsPerContainer?.message && (
                <p className="text-xs text-destructive">{t(errors.pcsPerContainer.message)}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>{t("Alternate units (optional)")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("Other pack sizes this product can be sold in, like dozen or pcs.")}
            </p>
            {unitFields.map((field, index) => {
              const isCustomRow = customUnitRows[index] ?? false
              const rowLabel = watchedUnits?.[index]?.label ?? ""
              // Options already in use (the base unit, or another row's
              // choice) are hidden from this row's list so the same unit
              // can't be picked twice from the dropdown itself.
              const usedLabels = new Set(
                [unitValue, ...(watchedUnits ?? []).map((u, i) => (i === index ? "" : u?.label ?? ""))]
                  .map((l) => l.trim().toLowerCase())
                  .filter(Boolean)
              )
              // When the base unit is itself a container, "pcs" is
              // configured via the "How many pcs..." field above instead,
              // so it's hidden here to avoid two controls for one thing.
              const rowOptions = UNIT_OPTIONS.filter(
                (option) => !usedLabels.has(option.toLowerCase()) && !(isContainerUnit && option === "pcs")
              )
              const fixedFactor = FIXED_UNIT_FACTORS[rowLabel.trim().toLowerCase()]
              // Base unit is "pcs" and this row is a container (carton/box/
              // pack/bag): ask "how many pcs?" directly instead of a raw
              // factor, since factor === that count when the base is pcs.
              const showPcsPrompt =
                unitValue.trim().toLowerCase() === "pcs" && CONTAINER_UNITS.includes(rowLabel.trim().toLowerCase())
              const rowLabelError = errors.units?.[index]?.label?.message
              const rowFactorError = errors.units?.[index]?.factor?.message

              return (
                <div key={field.id} className="flex items-start gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Select
                      value={isCustomRow ? OTHER_UNIT : rowLabel}
                      onValueChange={(value) => {
                        if (value === OTHER_UNIT) {
                          setCustomUnitRows((prev) => prev.map((v, i) => (i === index ? true : v)))
                          setValue(`units.${index}.label`, "", { shouldValidate: false })
                        } else {
                          setCustomUnitRows((prev) => prev.map((v, i) => (i === index ? false : v)))
                          setValue(`units.${index}.label`, value, { shouldValidate: true })
                          const fixed = FIXED_UNIT_FACTORS[value.toLowerCase()]
                          if (fixed !== undefined) {
                            setValue(`units.${index}.factor`, String(fixed), { shouldValidate: true })
                          }
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("Select a unit")} />
                      </SelectTrigger>
                      <SelectContent>
                        {rowOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                        <SelectItem value={OTHER_UNIT}>{t("Other (custom)")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {isCustomRow && (
                      <Input
                        autoFocus
                        placeholder={t("Type a custom unit")}
                        value={rowLabel}
                        onChange={(e) => setValue(`units.${index}.label`, e.target.value, { shouldValidate: true })}
                      />
                    )}
                    {rowLabelError && (
                      <p className="mt-1 text-xs text-destructive">{t(rowLabelError)}</p>
                    )}
                  </div>
                  <div className={showPcsPrompt ? "w-44" : "w-28"}>
                    <Input
                      placeholder={
                        showPcsPrompt
                          ? t("How many pcs in one {{unit}}?", { unit: rowLabel })
                          : t("Factor, e.g. 12 or 1/12")
                      }
                      disabled={fixedFactor !== undefined}
                      {...register(`units.${index}.factor`)}
                    />
                    {fixedFactor !== undefined ? (
                      <p className="mt-1 text-xs text-muted-foreground">{t("Always {{factor}}", { factor: fixedFactor })}</p>
                    ) : (
                      rowFactorError && (
                        <p className="mt-1 text-xs text-destructive">{t(rowFactorError)}</p>
                      )
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("Remove unit")}
                    onClick={() => handleRemoveUnit(index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )
            })}
            <Button type="button" variant="outline" size="sm" onClick={handleAppendUnit}>
              <Plus className="size-3.5" />
              {t("Add alternate unit")}
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prod-shortcode">{t("Short code (optional)")}</Label>
            <Input id="prod-shortcode" placeholder={t("e.g. fn14")} {...register("shortCode")} />
            <p className="text-xs text-muted-foreground">{t("For quick lookup at the register.")}</p>
            {errors.shortCode?.message && <p className="text-xs text-destructive">{t(errors.shortCode.message)}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prod-description">{t("Description (optional)")}</Label>
            <Textarea id="prod-description" rows={3} {...register("description")} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? t("Save changes") : t("Create product")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
