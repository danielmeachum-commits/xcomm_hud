import type { StatusValue } from "./types"

export const STATUS_VALUES: StatusValue[] = [
  "up",
  "degraded",
  "down",
  "unknown",
  "offline",
  "setup",
]

export type StatusCategory = "operational" | "issue" | "transitional" | "unknown"

export const STATUS_CATEGORIES: { key: StatusCategory; label: string; values: StatusValue[] }[] = [
  { key: "operational", label: "Operational", values: ["up"] },
  { key: "issue", label: "Issue", values: ["degraded", "down", "offline"] },
  { key: "transitional", label: "Transitional", values: ["setup"] },
  { key: "unknown", label: "Unknown", values: ["unknown"] },
]

export function statusLabel(s: StatusValue): string {
  switch (s) {
    case "up":
      return "Up"
    case "degraded":
      return "Degraded"
    case "down":
      return "Down"
    case "offline":
      return "Offline"
    case "setup":
      return "Setup"
    case "unknown":
    default:
      return "Unknown"
  }
}

export function statusBadgeClass(s: StatusValue): string {
  switch (s) {
    case "up":
      return "border-emerald-500/40 bg-emerald-500/5"
    case "degraded":
      return "border-amber-500/50 bg-amber-500/10"
    case "down":
      return "border-red-500/60 bg-red-500/10"
    case "offline":
      return "border-slate-700/50 bg-slate-700/10"
    case "setup":
      return "border-sky-500/50 bg-sky-500/10"
    case "unknown":
    default:
      return "border-muted-foreground/30 bg-muted/30"
  }
}

export function statusToIndicatorState(
  s: StatusValue,
): "active" | "down" | "fixing" | "idle" | "offline" | "setup" {
  switch (s) {
    case "up":
      return "active"
    case "down":
      return "down"
    case "degraded":
      return "fixing"
    case "offline":
      return "offline"
    case "setup":
      return "setup"
    case "unknown":
    default:
      return "idle"
  }
}
