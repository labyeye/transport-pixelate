// Dial codes with the national-number lengths each country actually uses, so the form can reject a number
// before it reaches the server. `pattern` is an extra rule where the numbering plan is strict (India).
export const COUNTRIES = [
  { iso: "IN", name: "India", dial: "91", min: 10, max: 10, pattern: /^[6-9]\d{9}$/ },
  { iso: "AE", name: "United Arab Emirates", dial: "971", min: 9, max: 9, pattern: /^5\d{8}$/ },
  { iso: "SA", name: "Saudi Arabia", dial: "966", min: 9, max: 9, pattern: /^5\d{8}$/ },
  { iso: "QA", name: "Qatar", dial: "974", min: 8, max: 8 },
  { iso: "KW", name: "Kuwait", dial: "965", min: 8, max: 8 },
  { iso: "OM", name: "Oman", dial: "968", min: 8, max: 8 },
  { iso: "BH", name: "Bahrain", dial: "973", min: 8, max: 8 },
  { iso: "US", name: "United States", dial: "1", min: 10, max: 10, pattern: /^[2-9]\d{9}$/ },
  { iso: "CA", name: "Canada", dial: "1", min: 10, max: 10, pattern: /^[2-9]\d{9}$/ },
  { iso: "GB", name: "United Kingdom", dial: "44", min: 10, max: 10, pattern: /^7\d{9}$/ },
  { iso: "AU", name: "Australia", dial: "61", min: 9, max: 9, pattern: /^4\d{8}$/ },
  { iso: "NZ", name: "New Zealand", dial: "64", min: 8, max: 10 },
  { iso: "SG", name: "Singapore", dial: "65", min: 8, max: 8, pattern: /^[89]\d{7}$/ },
  { iso: "MY", name: "Malaysia", dial: "60", min: 9, max: 10 },
  { iso: "ID", name: "Indonesia", dial: "62", min: 9, max: 12 },
  { iso: "PH", name: "Philippines", dial: "63", min: 10, max: 10 },
  { iso: "TH", name: "Thailand", dial: "66", min: 9, max: 9 },
  { iso: "LK", name: "Sri Lanka", dial: "94", min: 9, max: 9 },
  { iso: "NP", name: "Nepal", dial: "977", min: 10, max: 10 },
  { iso: "BD", name: "Bangladesh", dial: "880", min: 10, max: 10 },
  { iso: "PK", name: "Pakistan", dial: "92", min: 10, max: 10, pattern: /^3\d{9}$/ },
  { iso: "ZA", name: "South Africa", dial: "27", min: 9, max: 9 },
  { iso: "KE", name: "Kenya", dial: "254", min: 9, max: 9 },
  { iso: "NG", name: "Nigeria", dial: "234", min: 10, max: 10 },
];

export const DEFAULT_COUNTRY = "IN";
export const countryByIso = (iso) => COUNTRIES.find((c) => c.iso === iso) ?? COUNTRIES[0];

/** Returns an error message, or "" when `number` is a valid national number for the country. */
export function phoneError(iso, number) {
  const c = countryByIso(iso);
  const n = number.replace(/\D/g, "");
  if (!n) return "Mobile number is required";
  if (n.length < c.min || n.length > c.max)
    return c.min === c.max
      ? `Enter a ${c.min}-digit ${c.name} mobile number`
      : `Enter ${c.min}–${c.max} digits for ${c.name}`;
  if (c.pattern && !c.pattern.test(n)) return `Not a valid ${c.name} mobile number`;
  return "";
}

/** E.164, e.g. +919876543210 — what the API stores. */
export const toE164 = (iso, number) => `+${countryByIso(iso).dial}${number.replace(/\D/g, "")}`;
