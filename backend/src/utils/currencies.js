/**
 * Static lookup table mapping country names to their currency (code, name,
 * symbol), used to auto-set a new business's currency from its country at
 * signup. Falls back to USD for any country not listed.
 */

// Country → Currency mapping
const countryCurrencyMap = {
  // Africa
  "Togo": { code: "XOF", name: "West African CFA Franc", symbol: "₣" },
  "Benin": { code: "XOF", name: "West African CFA Franc", symbol: "₣" },
  "Senegal": { code: "XOF", name: "West African CFA Franc", symbol: "₣" },
  "Mali": { code: "XOF", name: "West African CFA Franc", symbol: "₣" },
  "Burkina Faso": { code: "XOF", name: "West African CFA Franc", symbol: "₣" },
  "Niger": { code: "XOF", name: "West African CFA Franc", symbol: "₣" },
  "Guinea-Bissau": { code: "XOF", name: "West African CFA Franc", symbol: "₣" },
  "Ivory Coast": { code: "XOF", name: "West African CFA Franc", symbol: "₣" },
  "Cameroon": { code: "XAF", name: "Central African CFA Franc", symbol: "₣" },
  "Chad": { code: "XAF", name: "Central African CFA Franc", symbol: "₣" },
  "Gabon": { code: "XAF", name: "Central African CFA Franc", symbol: "₣" },
  "Congo": { code: "XAF", name: "Central African CFA Franc", symbol: "₣" },
  "Nigeria": { code: "NGN", name: "Nigerian Naira", symbol: "₦" },
  "Ghana": { code: "GHS", name: "Ghanaian Cedi", symbol: "₵" },
  "Kenya": { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
  "South Africa": { code: "ZAR", name: "South African Rand", symbol: "R" },
  "Ethiopia": { code: "ETB", name: "Ethiopian Birr", symbol: "Br" },
  "Tanzania": { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh" },
  "Uganda": { code: "UGX", name: "Ugandan Shilling", symbol: "USh" },
  "Rwanda": { code: "RWF", name: "Rwandan Franc", symbol: "Fr" },
  "Egypt": { code: "EGP", name: "Egyptian Pound", symbol: "£" },
  "Morocco": { code: "MAD", name: "Moroccan Dirham", symbol: "د.م." },
  "Algeria": { code: "DZD", name: "Algerian Dinar", symbol: "د.ج" },
  "Tunisia": { code: "TND", name: "Tunisian Dinar", symbol: "د.ت" },
  "Angola": { code: "AOA", name: "Angolan Kwanza", symbol: "Kz" },
  "Mozambique": { code: "MZN", name: "Mozambican Metical", symbol: "MT" },
  "Zambia": { code: "ZMW", name: "Zambian Kwacha", symbol: "ZK" },
  "Zimbabwe": { code: "ZWL", name: "Zimbabwean Dollar", symbol: "Z$" },

  // Europe
  "United Kingdom": { code: "GBP", name: "British Pound", symbol: "£" },
  "Germany": { code: "EUR", name: "Euro", symbol: "€" },
  "France": { code: "EUR", name: "Euro", symbol: "€" },
  "Italy": { code: "EUR", name: "Euro", symbol: "€" },
  "Spain": { code: "EUR", name: "Euro", symbol: "€" },
  "Portugal": { code: "EUR", name: "Euro", symbol: "€" },
  "Netherlands": { code: "EUR", name: "Euro", symbol: "€" },
  "Belgium": { code: "EUR", name: "Euro", symbol: "€" },
  "Switzerland": { code: "CHF", name: "Swiss Franc", symbol: "Fr" },
  "Sweden": { code: "SEK", name: "Swedish Krona", symbol: "kr" },
  "Norway": { code: "NOK", name: "Norwegian Krone", symbol: "kr" },
  "Denmark": { code: "DKK", name: "Danish Krone", symbol: "kr" },
  "Poland": { code: "PLN", name: "Polish Zloty", symbol: "zł" },
  "Russia": { code: "RUB", name: "Russian Ruble", symbol: "₽" },

  // Americas
  "United States": { code: "USD", name: "US Dollar", symbol: "$" },
  "Canada": { code: "CAD", name: "Canadian Dollar", symbol: "$" },
  "Brazil": { code: "BRL", name: "Brazilian Real", symbol: "R$" },
  "Mexico": { code: "MXN", name: "Mexican Peso", symbol: "$" },
  "Argentina": { code: "ARS", name: "Argentine Peso", symbol: "$" },
  "Colombia": { code: "COP", name: "Colombian Peso", symbol: "$" },
  "Chile": { code: "CLP", name: "Chilean Peso", symbol: "$" },
  "Peru": { code: "PEN", name: "Peruvian Sol", symbol: "S/" },

  // Asia
  "China": { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
  "Japan": { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  "India": { code: "INR", name: "Indian Rupee", symbol: "₹" },
  "South Korea": { code: "KRW", name: "South Korean Won", symbol: "₩" },
  "Singapore": { code: "SGD", name: "Singapore Dollar", symbol: "$" },
  "Malaysia": { code: "MYR", name: "Malaysian Ringgit", symbol: "RM" },
  "Indonesia": { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp" },
  "Thailand": { code: "THB", name: "Thai Baht", symbol: "฿" },
  "Vietnam": { code: "VND", name: "Vietnamese Dong", symbol: "₫" },
  "Philippines": { code: "PHP", name: "Philippine Peso", symbol: "₱" },
  "Pakistan": { code: "PKR", name: "Pakistani Rupee", symbol: "₨" },
  "Bangladesh": { code: "BDT", name: "Bangladeshi Taka", symbol: "৳" },
  "UAE": { code: "AED", name: "UAE Dirham", symbol: "د.إ" },
  "Saudi Arabia": { code: "SAR", name: "Saudi Riyal", symbol: "﷼" },
  "Qatar": { code: "QAR", name: "Qatari Riyal", symbol: "﷼" },
  "Kuwait": { code: "KWD", name: "Kuwaiti Dinar", symbol: "د.ك" },

  // Oceania
  "Australia": { code: "AUD", name: "Australian Dollar", symbol: "$" },
  "New Zealand": { code: "NZD", name: "New Zealand Dollar", symbol: "$" },
};

/**
 * Get currency for a country.
 * @param {string} country - Country name as used in countryCurrencyMap.
 * @returns {{code: string, name: string, symbol: string}} The matching currency, or USD if the country is unrecognized.
 */
const getCurrencyForCountry = (country) => {
  return countryCurrencyMap[country] || { code: "USD", name: "US Dollar", symbol: "$" };
};

/**
 * Get list of all countries supported by the country → currency lookup
 * (used to populate the country dropdown on business creation).
 */
const getAllCountries = () => {
  return Object.keys(countryCurrencyMap);
};

module.exports = {
  countryCurrencyMap,
  getCurrencyForCountry,
  getAllCountries,
};