import { useId, useMemo, useRef, useState, type FocusEventHandler, type KeyboardEvent } from "react"
import { Popover } from "radix-ui"
import { Check, ChevronsUpDown, Globe2, Search } from "lucide-react"
import { useTranslation } from "react-i18next"
import flags from "react-phone-number-input/flags"
import type { Country } from "react-phone-number-input"
import { Button } from "./button"
import { Input } from "./input"
import { cn } from "@/lib/utils"
import { normalizeCountrySearch } from "@/lib/countries"
import "./country-picker.css"

export interface CountryPickerOption {
  value: string
  label: string
  detail?: string
  search?: string
  iso?: Country
}

interface CountryPickerProps {
  options: CountryPickerOption[]
  value?: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  id?: string
  disabled?: boolean
  compact?: boolean
  onFocus?: FocusEventHandler<HTMLButtonElement>
  onBlur?: FocusEventHandler<HTMLButtonElement>
  keepInputFocusOnSelect?: boolean
}

function CountryFlag({ iso }: { iso?: Country }) {
  const Flag = iso ? flags[iso] : undefined
  return <span className="country-picker-flag" aria-hidden="true">{Flag ? <Flag title={iso ?? ""} /> : <Globe2 size={18} />}</span>
}

/** Shared, keyboard-accessible search for phone and business country choices. */
export function CountryPicker({ options, value, onChange, label, placeholder, id, disabled, compact, onFocus, onBlur, keepInputFocusOnSelect }: CountryPickerProps) {
  const { t } = useTranslation()
  const popupId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const picked = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const results = useMemo(() => {
    const terms = normalizeCountrySearch(query).split(" ").filter(Boolean)
    const normalizedQuery = normalizeCountrySearch(query)
    const exactMatch = (option: CountryPickerOption) => [option.label, option.value, option.detail ?? ""].some((part) => normalizeCountrySearch(part) === normalizedQuery)
    return options.filter((option) => {
      const text = normalizeCountrySearch(`${option.label} ${option.detail ?? ""} ${option.search ?? ""}`)
      return terms.every((term) => text.includes(term))
    }).sort((a, b) => Number(exactMatch(b)) - Number(exactMatch(a)))
  }, [options, query])
  const select = (option: CountryPickerOption) => {
    picked.current = true
    onChange(option.value)
    setOpen(false)
  }
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    if (!buttons.length) return
    const index = buttons.indexOf(event.target as HTMLButtonElement)
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault()
    buttons[next].focus()
  }
  return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); setQuery(""); picked.current = false }}>
    <Popover.Trigger asChild>
      <Button type="button" variant="outline" id={id} role="combobox" aria-haspopup="dialog" aria-controls={popupId} aria-expanded={open}
        aria-label={selected ? `${label}: ${selected.label}` : label} disabled={disabled} onFocus={onFocus} onBlur={onBlur}
        className={cn("country-picker-trigger", compact && "country-picker-compact")}>
        <CountryFlag iso={selected?.iso} />
        {compact ? <span>{selected?.detail ?? ""}</span> : <span className={cn("country-picker-value", !selected && "country-picker-placeholder")}>{selected?.label ?? placeholder ?? t("Select a country")}{selected?.detail && <small>{selected.detail}</small>}</span>}
        <ChevronsUpDown className="size-3.5" />
      </Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content id={popupId} role="dialog" aria-label={t("Choose a country")} align="start" sideOffset={6} collisionPadding={12}
        className="country-picker-popover" onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus() }}
        onCloseAutoFocus={(event) => { if (picked.current && keepInputFocusOnSelect) event.preventDefault() }}>
        <div className="country-picker-search"><Search size={17} aria-hidden="true" /><Input ref={inputRef} type="search" aria-label={t("Search countries")} placeholder={t("Search country, code or calling code…")} autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "ArrowDown" && results.length) { event.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>("button")?.focus() }
          if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (results.length) select(results[0]) }
        }} /></div>
        <div className="country-picker-options" ref={listRef} onKeyDown={navigate}>
          {results.length ? results.map((option) => <button type="button" key={option.value} className="country-picker-option" onClick={() => select(option)} aria-label={`${option.label}${option.detail ? ` ${option.detail}` : ""}`}>
            <CountryFlag iso={option.iso} /><span>{option.label}</span>{option.detail && <small>{option.detail}</small>}{option.value === value && <Check size={16} aria-hidden="true" />}
          </button>) : <p className="country-picker-empty" role="status">{t("No countries found")}</p>}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
