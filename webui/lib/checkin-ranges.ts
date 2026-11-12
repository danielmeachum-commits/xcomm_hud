/** Time windows for the Check-in log. Plain module (not "use client") so
 *  the server page and the client table share the actual values. */
export const RANGES = {
  "24h": { label: "Last 24 hours", hours: 24 },
  "7d": { label: "Last 7 days", hours: 24 * 7 },
  "30d": { label: "Last 30 days", hours: 24 * 30 },
} as const
export type RangeKey = keyof typeof RANGES
