import { getCountries, type Country } from "react-phone-number-input"
import en from "react-phone-number-input/locale/en.json"
import fr from "react-phone-number-input/locale/fr.json"

export function normalizeCountrySearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ").trim()
}

const aliases: Record<string, Country> = {
  UAE: "AE",
  "Ivory Coast": "CI",
  "Côte d’Ivoire": "CI",
  "Congo": "CG",
  "Republic of the Congo": "CG",
  "Democratic Republic of the Congo": "CD",
  Czechia: "CZ",
  Türkiye: "TR",
  "Cabo Verde": "CV",
  Eswatini: "SZ",
  "Timor-Leste": "TL",
  "United States of America": "US",
}
const countryNames = new Map<string, Country>()
const searchNames = new Map<Country, string[]>()
const displayNames = typeof Intl.DisplayNames === "function" ? [new Intl.DisplayNames(["en"], { type: "region" }), new Intl.DisplayNames(["fr"], { type: "region" })] : []
for (const iso of getCountries()) {
  const names = [iso, en[iso], fr[iso], ...displayNames.map((display) => display.of(iso))].filter((name): name is string => !!name)
  searchNames.set(iso, names)
  names.forEach((name) => countryNames.set(normalizeCountrySearch(name), iso))
}
for (const [name, iso] of Object.entries(aliases)) {
  countryNames.set(normalizeCountrySearch(name), iso)
  searchNames.get(iso)?.push(name)
}

/** Resolve stored names, English/French labels, common aliases or ISO codes. */
export function countryNameToIso(name: string | undefined): Country | undefined {
  return name ? countryNames.get(normalizeCountrySearch(name)) : undefined
}

export function countrySearchTerms(iso: Country | undefined): string {
  return iso ? (searchNames.get(iso) ?? [iso]).join(" ") : ""
}
