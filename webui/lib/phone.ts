/**
 * Display formatting for phone numbers. Numbers are stored as free text, so
 * anything that isn't a recognizable NANP number (extensions, DSN, overseas
 * numbers) is returned untouched rather than mangled.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return ""
  const digits = value.replace(/\D/g, "")
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`
  }
  return value
}
