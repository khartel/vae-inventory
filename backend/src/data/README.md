# Country reference data

`countries.json` is a bundled snapshot, generated on 2026-11-13. It covers the
245 countries and territories supported by the installed phone-number metadata.
The existing business-country names are preserved for compatibility.

Currency mappings and English currency names/symbols come from Unicode CLDR
49.0.0 (Unicode-3.0 license, included as `UNICODE-LICENSE.txt`):

- https://github.com/unicode-org/cldr-json/blob/49.0.0/cldr-json/cldr-core/supplemental/currencyData.json
- https://github.com/unicode-org/cldr-json/blob/49.0.0/cldr-json/cldr-numbers-full/main/en/currencies.json

For each region, use the first legal-tender entry whose date range includes the
snapshot date. CLDR ordering establishes the primary currency when several are
current. Non-tender instruments and historical/future-only entries are excluded.
Country labels/codes follow the installed `react-phone-number-input` locale and
country metadata; the original application's business-country names take
precedence where they differ (for example UAE and Ivory Coast).

This data is loaded locally. Opening forms does not contact a third-party service.
Existing businesses retain the currency already stored on their record; this
snapshot determines currency defaults for newly created businesses only.
