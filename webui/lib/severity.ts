/** Severity labels + palette for event records.
 *
 * Severity is a reserved status palette (never reused for series colors):
 * info = neutral, notice = blue, warning = amber, critical = red. Always
 * rendered with a label beside the color, never color alone.
 */

import type { Severity } from "./types"

export const SEVERITY_ORDER: readonly Severity[] = [
  "critical",
  "warning",
  "notice",
  "info",
]

export const SEVERITY_LABELS: Record<Severity, string> = {
  info: "Info",
  notice: "Notice",
  warning: "Warning",
  critical: "Critical",
}

/** Rank for sorting — lower is more severe. */
export function severityRank(s: Severity | string): number {
  const idx = SEVERITY_ORDER.indexOf(s as Severity)
  return idx === -1 ? SEVERITY_ORDER.length : idx
}

/** Solid dot color for timeline rails and compact badges. */
export function severityDotClass(s: Severity): string {
  switch (s) {
    case "info":
      return "bg-slate-400 dark:bg-slate-500"
    case "notice":
      return "bg-sky-500"
    case "warning":
      return "bg-amber-500"
    case "critical":
      return "bg-red-500"
  }
}

/** Left-spine border color for severity-accented cards. */
export function severityBorderClass(s: Severity): string {
  switch (s) {
    case "info":
      return "border-l-slate-400/60 dark:border-l-slate-500/60"
    case "notice":
      return "border-l-sky-500"
    case "warning":
      return "border-l-amber-500"
    case "critical":
      return "border-l-red-500"
  }
}

/** Card treatment for the vertical timeline, where elevation encodes
 *  importance: routine (info) rows sit flat on the page, notable events lift
 *  onto an elevated card, and critical fills a tinted card so it stands out
 *  the way the important white cards do against the gray rows in the ref. */
export function severityTimelineCardClasses(s: Severity): string {
  switch (s) {
    case "info":
      return "bg-muted/30 dark:bg-muted/20"
    case "notice":
      return "bg-card shadow-sm"
    case "warning":
      return "bg-card shadow-sm ring-1 ring-inset ring-amber-500/25"
    case "critical":
      return "bg-red-500/10 shadow-sm ring-1 ring-inset ring-red-500/40 dark:bg-red-500/15"
  }
}

/** Subtle pill classes (bg/text/ring) for severity badges. */
export function severityPillClasses(s: Severity): string {
  switch (s) {
    case "info":
      return "bg-slate-500/10 text-slate-600 ring-slate-500/30 dark:text-slate-400"
    case "notice":
      return "bg-sky-500/10 text-sky-600 ring-sky-500/30 dark:text-sky-400"
    case "warning":
      return "bg-amber-500/10 text-amber-600 ring-amber-500/30 dark:text-amber-400"
    case "critical":
      return "bg-red-500/10 text-red-600 ring-red-500/30 dark:text-red-400"
  }
}
