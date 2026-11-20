import { useMemo, type FocusEventHandler } from "react"
import { useTranslation } from "react-i18next"
import RPNInput, { getCountryCallingCode, type Country } from "react-phone-number-input"
import flags from "react-phone-number-input/flags"
import en from "react-phone-number-input/locale/en.json"
import fr from "react-phone-number-input/locale/fr.json"
import "react-phone-number-input/style.css"
import { cn } from "@/lib/utils"
import { countrySearchTerms } from "@/lib/countries"
import { CountryPicker } from "./country-picker"

export type { Country as PhoneInputCountry }
export { isValidPhoneNumber } from "react-phone-number-input"

interface PhoneCountrySelectProps {
  value?: Country
  onChange: (country?: Country) => void
  options: Array<{ value?: Country; label: string; divider?: boolean }>
  disabled?: boolean
  readOnly?: boolean
  onFocus?: FocusEventHandler<HTMLButtonElement>
  onBlur?: FocusEventHandler<HTMLButtonElement>
  "aria-label"?: string
}

function PhoneCountrySelect({ value, onChange, options, disabled, readOnly, onFocus, onBlur, "aria-label": label }: PhoneCountrySelectProps) {
  const { t } = useTranslation()
  const choices = useMemo(() => options.filter((option) => !option.divider).map((option) => ({
    value: option.value ?? "",
    iso: option.value,
    label: option.label,
    detail: option.value ? `+${getCountryCallingCode(option.value)}` : undefined,
    search: `${countrySearchTerms(option.value)} ${option.value ? getCountryCallingCode(option.value) : ""}`,
  })), [options])
  return <CountryPicker compact options={choices} value={value ?? ""} label={label ?? t("Phone country")}
    disabled={disabled || readOnly} onFocus={onFocus} onBlur={onBlur} keepInputFocusOnSelect
    onChange={(country) => onChange(country ? country as Country : undefined)} />
}

/**
 * One searchable country selector for every phone field. The library still
 * handles formatting/validation and emits E.164 numbers. Flags and country
 * labels are bundled so the selector also works without public internet.
 */
export function PhoneInput({ className, value, onChange, defaultCountry, ...props }: {
  className?: string
  value: string | undefined
  onChange: (value: string) => void
  defaultCountry?: Country
  id?: string
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  "aria-invalid"?: boolean
  "aria-required"?: boolean
}) {
  const { t, i18n } = useTranslation()
  return <RPNInput international value={value} onChange={(next) => onChange(next ?? "")} defaultCountry={defaultCountry}
    labels={i18n.language.startsWith("fr") ? fr : en} locales={i18n.language} flags={flags}
    countrySelectComponent={PhoneCountrySelect} countrySelectProps={{ "aria-label": t("Phone country") }}
    className={cn("phone-input-field", className)} {...props} />
}
