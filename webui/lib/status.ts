import type {
  AnyStatus,
  GatewayStatus,
  ServiceStatus,
  SiteStatus,
  StatusValue,
} from "./types"

export const STATUS_VALUES: StatusValue[] = [
  "up",
  "degraded",
  "down",
  "unknown",
  "offline",
  "setup",
]

export const SERVICE_STATUS_VALUES: ServiceStatus[] = STATUS_VALUES

export const GATEWAY_STATUS_VALUES: GatewayStatus[] = [
  "active",
  "ready",
  "degraded",
  "down",
  "offline",
  "setup",
]

export const SITE_STATUS_VALUES: SiteStatus[] = [
  "operational",
  "limited",
  "degraded",
  "maintenance",
  "standby",
  "offline",
  "setup",
]

export type StatusCategory = "operational" | "issue" | "transitional" | "unknown"

/** Stroke color used on canvas edges keyed on a service's status. The three
 *  "lane" colors (green/orange/red) also match the handles on the gateway so a
 *  service edge naturally lands on the matching colored dock. */
export function statusEdgeStroke(s: AnyStatus): string {
  switch (s) {
    case "up":
    case "active":
    case "operational":
      return "rgb(34 197 94)" // green-500
    case "limited":
      return "rgb(132 204 22)" // lime-500
    case "degraded":
      return "rgb(245 158 11)" // amber-500
    case "maintenance":
      return "rgb(168 85 247)" // purple-500
    case "standby":
      return "rgb(100 116 139)" // slate-500
    case "down":
      return "rgb(239 68 68)" // red-500
    case "ready":
      return "rgb(14 165 233)" // sky-500
    case "setup":
      return "rgb(14 165 233)" // sky-500
    case "offline":
      return "rgb(71 85 105)" // slate-600
    case "unknown":
    default:
      return "rgb(148 163 184)" // slate-400
  }
}

/** Whether an edge should animate (data appears to flow) for this status. */
export function statusEdgeAnimates(s: AnyStatus): boolean {
  return s === "up" || s === "degraded" || s === "setup" || s === "active"
}

/** Which colored handle on a gateway a service edge should attach to,
 *  based on the *service's* effective status. Three handles per side mirror
 *  the operational/issue/issue split so the canvas reads at a glance. */
export type EdgeHandle = "ok" | "degraded" | "down"

export function statusEdgeHandle(s: AnyStatus): EdgeHandle {
  switch (s) {
    case "down":
    case "offline":
      return "down"
    case "degraded":
      return "degraded"
    default:
      return "ok"
  }
}

export const SERVICE_STATUS_CATEGORIES: {
  key: StatusCategory
  label: string
  values: ServiceStatus[]
}[] = [
  { key: "operational", label: "Operational", values: ["up"] },
  { key: "issue", label: "Issue", values: ["degraded", "down", "offline"] },
  { key: "transitional", label: "Transitional", values: ["setup"] },
  { key: "unknown", label: "Unknown", values: ["unknown"] },
]

export const GATEWAY_STATUS_CATEGORIES: {
  key: StatusCategory
  label: string
  values: GatewayStatus[]
}[] = [
  { key: "operational", label: "Operational", values: ["active", "ready"] },
  { key: "issue", label: "Issue", values: ["degraded", "down", "offline"] },
  { key: "transitional", label: "Transitional", values: ["setup"] },
]

/** Legacy alias — the validation dialog used `STATUS_CATEGORIES` before the
 *  gateway/service split. Defaults to service categories. */
export const STATUS_CATEGORIES = SERVICE_STATUS_CATEGORIES

export function statusLabel(s: AnyStatus): string {
  switch (s) {
    case "up":
      return "Up"
    case "active":
      return "Active"
    case "ready":
      return "Ready"
    case "operational":
      return "Operational"
    case "limited":
      return "Limited"
    case "maintenance":
      return "Maintenance"
    case "standby":
      return "Standby"
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

export function statusBadgeClass(s: AnyStatus): string {
  switch (s) {
    case "up":
    case "active":
    case "operational":
      return "border-emerald-500/40 bg-emerald-500/5"
    case "limited":
      return "border-lime-500/50 bg-lime-500/10"
    case "degraded":
      return "border-amber-500/50 bg-amber-500/10"
    case "maintenance":
      return "border-purple-500/50 bg-purple-500/10"
    case "standby":
      return "border-slate-500/50 bg-slate-500/10"
    case "down":
      return "border-red-500/60 bg-red-500/10"
    case "offline":
      return "border-slate-700/50 bg-slate-700/10"
    case "ready":
      return "border-sky-500/50 bg-sky-500/10"
    case "setup":
      return "border-sky-500/50 bg-sky-500/10"
    case "unknown":
    default:
      return "border-muted-foreground/30 bg-muted/30"
  }
}

export function statusToIndicatorState(
  s: AnyStatus,
): "active" | "down" | "fixing" | "idle" | "offline" | "setup" | "ready" {
  switch (s) {
    case "up":
    case "active":
    case "operational":
      return "active"
    case "down":
      return "down"
    case "degraded":
    case "limited":
    case "maintenance":
      return "fixing"
    case "offline":
      return "offline"
    case "setup":
      return "setup"
    case "ready":
    case "standby":
      return "ready"
    case "unknown":
    default:
      return "idle"
  }
}
