/** Bundled country/currency options; no network lookup is needed at runtime. */
const { countries } = require("../data/countries.json");

const countryCurrencyMap = Object.fromEntries(countries.map(({ country, currency }) => [country, currency]));
const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const lookup = new Map();
for (const { iso, country, currency } of countries) {
  lookup.set(normalize(country), currency);
  lookup.set(normalize(iso), currency);
}
const aliases = {
  "United Arab Emirates": "AE",
  "Côte d'Ivoire": "CI",
  "Cote d'Ivoire": "CI",
  "Republic of the Congo": "CG",
  "Democratic Republic of the Congo": "CD",
  "Czechia": "CZ",
  "Türkiye": "TR",
  "Cabo Verde": "CV",
  "Eswatini": "SZ",
  "Timor-Leste": "TL",
  "United States of America": "US",
};
for (const [name, iso] of Object.entries(aliases)) lookup.set(normalize(name), lookup.get(normalize(iso)));

/** Preserve the existing USD fallback for unrecognized legacy/API values. */
const getCurrencyForCountry = (country) => lookup.get(normalize(country)) || { code: "USD", name: "US Dollar", symbol: "$" };
const getAllCountries = () => countries.map(({ country }) => country);

module.exports = { countryCurrencyMap, getCurrencyForCountry, getAllCountries };
