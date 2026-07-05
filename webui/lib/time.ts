/** Time formatting helpers — local and Zulu. */

export function formatLocal(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Compact local timestamp for inline badges: "Jul 4, 13:45" (no year, 24h). */
export function formatShort(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

/** Zulu format: DDHHMMZ MMM YYYY (standard DTG with full year so the
 *  year can't be confused with the day-of-month). */
export function formatZulu(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, "0")
  const day = pad(d.getUTCDate())
  const hh = pad(d.getUTCHours())
  const mm = pad(d.getUTCMinutes())
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
  const mon = months[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  return `${day}${hh}${mm}Z ${mon} ${year}`
}

/** Compact span between two instants, e.g. "45min", "1hr", "3hrs", "2days".
 *  Used for expected-duration labels like "Temporarily - 3hrs". */
export function formatDurationShort(
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
): string | null {
  if (!fromIso || !toIso) return null
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min}min`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}hr${hr === 1 ? "" : "s"}`
  const day = Math.round(hr / 24)
  return `${day}day${day === 1 ? "" : "s"}`
}

/** Short relative-ago, e.g. "3m ago", "2h ago", "yesterday". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never"
  const d = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - d)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day === 1) return "yesterday"
  return `${day}d ago`
}
