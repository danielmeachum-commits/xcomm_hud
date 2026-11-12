/**
 * DoD ID (EDIPI) from whatever a CAC scanner or a person types. Mirrors
 * api/cac.py, which stays the authority — this only lets a form show the
 * 10 digits as soon as a card is scanned into it.
 *
 * Front PDF417 (88/89 chars, version "1"/"N") and back Code 39 (18 chars,
 * version "1") carry the EDIPI as 7 base-32 chars at offset 8; PDF417
 * version "M" (99 chars, current cards) at offset 1.
 */
export function extractEdipi(raw: string): string | null {
  let data = raw.replace(/^[\r\n\t]+|[\r\n\t]+$/g, "")
  data = data.replace(/^\][A-Za-z][0-9]/, "")
  if (data.length >= 2 && data.startsWith("*") && data.endsWith("*")) {
    data = data.slice(1, -1)
  }
  const digits = data.trim().replace(/[\s-]/g, "")
  if (/^\d{10}$/.test(digits)) return digits

  const isM = data.length === 99 && data[0] === "M"
  const isPdf = (data.length === 88 || data.length === 89) && /^[1N]/.test(data)
  const isC39 = data.length === 18 && data[0] === "1"
  if (!isM && !isPdf && !isC39) return null
  // Version M (current cards, 99 chars) puts the EDIPI first.
  const chunk = isM ? data.slice(1, 8) : data.slice(8, 15)
  if (!/^[0-9A-Va-v]{7}$/.test(chunk)) return null
  const value = parseInt(chunk, 32)
  if (!(value > 0 && value < 1e10)) return null
  return value.toString().padStart(10, "0")
}
