// Convert Western digits (0-9) to Arabic-Indic (٠-٩) when rendering in Arabic.
// Leaves everything else (separators, letters) untouched.
const AR = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

export function arDigits(value, lang) {
  if (lang !== 'ar' || value == null) return value
  return String(value).replace(/[0-9]/g, (d) => AR[+d])
}
