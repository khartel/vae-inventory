import { useState, type ReactNode } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as businessService from "@/services/business.service"
import { countryNameToIso, countrySearchTerms } from "@/lib/countries"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PhoneInput, isValidPhoneNumber } from "@/components/ui/phone-input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { CountryPicker } from "@/components/ui/country-picker"

// Validation for the new-business form. Email is optional (empty string allowed).
const schema = z.object({
  name: z.string().trim().min(1, "Business name is required"),
  phone: z.string().refine(isValidPhoneNumber, "Enter a valid phone number"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  country: z.string().min(1, "Country is required"),
  location: z.string().trim().min(1, "Location is required"),
})

type FormValues = z.infer<typeof schema>

/**
 * Dialog + form for creating a new business. Renders its own trigger button
 * (or a custom `trigger` node) that opens the dialog.
 *
 * Props:
 * - onCreated: called with the new business id after a successful create.
 * - trigger: optional custom element to open the dialog instead of the default "New business" button.
 *
 * Behavior:
 * - The country dropdown is populated from `businessService.getCountries`, which is only
 *   fetched while the dialog is `open` (query is `enabled: open`) and cached indefinitely.
 * - On success, invalidates the businesses list and the current-user ("auth/me") query
 *   (since creating a business can affect the user's business memberships), closes the
 *   dialog, and resets the form.
 */
export function CreateBusinessDialog({
  onCreated,
  trigger,
}: {
  onCreated?: (businessId: string) => void
  trigger?: ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const countriesQuery = useQuery({
    queryKey: ["countries"],
    queryFn: businessService.getCountries,
    enabled: open,
    staleTime: Infinity,
  })

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", phone: "", email: "", country: "", location: "" },
  })

  const createMutation = useMutation({
    mutationFn: businessService.createBusiness,
    onSuccess: (business) => {
      queryClient.invalidateQueries({ queryKey: ["businesses"] })
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] })
      toast.success(t('"{{name}}" created', { name: business.name }))
      setOpen(false)
      reset()
      onCreated?.(business.id)
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("Could not create business"))
    },
  })

  const onSubmit = (values: FormValues) => createMutation.mutate(values)

  // Unlike the other phone fields in the app, country here is picked in
  // this same form rather than coming from an already-active business - so
  // the phone input's default country needs to react to it. `defaultCountry`
  // only applies on mount, so a `key` forces a remount when the picked
  // country changes (this does mean a half-typed number resets if the
  // country field is changed after the fact - an accepted minor rough edge).
  const countryIso = countryNameToIso(watch("country"))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            {t("New business")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Create a business")}</DialogTitle>
          <DialogDescription>{t("Set up a new business to track its own inventory and sales.")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="biz-name">{t("Business name")}</Label>
            <Input id="biz-name" {...register("name")} />
            {errors.name?.message && <p className="text-xs text-destructive">{t(errors.name.message)}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="biz-phone">{t("Phone number")}</Label>
            <Controller
              name="phone"
              control={control}
              render={({ field }) => (
                <PhoneInput
                  key={countryIso}
                  id="biz-phone"
                  value={field.value}
                  onChange={field.onChange}
                  defaultCountry={countryIso}
                  aria-invalid={!!errors.phone}
                />
              )}
            />
            {errors.phone?.message && <p className="text-xs text-destructive">{t(errors.phone.message)}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="biz-email">{t("Email (optional)")}</Label>
            <Input id="biz-email" type="email" {...register("email")} />
            {errors.email?.message && <p className="text-xs text-destructive">{t(errors.email.message)}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="biz-country">{t("Country")}</Label>
            <CountryPicker
              id="biz-country"
              label={t("Country")}
              value={watch("country")}
              disabled={countriesQuery.isLoading}
              placeholder={countriesQuery.isLoading ? t("Loading countries...") : t("Select a country")}
              options={(countriesQuery.data ?? []).map((option) => ({
                value: option.country,
                label: option.country,
                detail: option.currency.code,
                iso: countryNameToIso(option.country),
                search: `${countrySearchTerms(countryNameToIso(option.country))} ${option.currency.name}`,
              }))}
              onChange={(value) => setValue("country", value, { shouldValidate: true })}
            />
            {countriesQuery.isError && <Button type="button" variant="ghost" onClick={() => countriesQuery.refetch()}>{t("Could not load countries. Retry")}</Button>}
            {errors.country?.message && <p className="text-xs text-destructive">{t(errors.country.message)}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="biz-location">{t("Location")}</Label>
            <Input id="biz-location" placeholder={t("City, area")} {...register("location")} />
            {errors.location?.message && <p className="text-xs text-destructive">{t(errors.location.message)}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {t("Create business")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
