/**
 * Parses a date input into a local `Date` without the UTC-midnight shift
 * that `new Date("YYYY-MM-DD")` causes on non-UTC servers. Full ISO
 * timestamps and `Date` instances are passed through unchanged.
 *
 * @param {string|Date} [value]
 * @returns {Date}
 */
const parseCalendarDate = (value) => {
  if (!value) return new Date();
  if (value instanceof Date) return value;

  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }

  return new Date(value);
};

module.exports = { parseCalendarDate };
