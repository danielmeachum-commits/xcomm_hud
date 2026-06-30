import type { StatusValue } from "./types"

export const STATUS_VALUES: StatusValue[] = [
  "up",
  "degraded",
  "down",
  "unknown",
  "offline",
  "setup",
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
