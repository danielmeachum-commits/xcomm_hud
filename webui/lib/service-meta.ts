import {
  Antenna,
  Boxes,
  Cloud,
  Database,
  Folder,
  Globe,
  KeyRound,
  Lock,
  MessageSquare,
  Network,
  Phone,
  PhoneCall,
  Printer,
  Radio,
  Router,
  Satellite,
  Shield,
  Video,
  type LucideIcon,
} from "lucide-react"

import type {
  GatewayKind,
  GatewayPace,
  ServiceCategory,
  ServiceKind,
  ServiceReach,
} from "./types"

export const ICON_MAP: Record<string, LucideIcon> = {
  globe: Globe,
  shield: Shield,
  phone: Phone,
  "phone-call": PhoneCall,
  "message-square": MessageSquare,
  lock: Lock,
  folder: Folder,
  printer: Printer,
  cloud: Cloud,
  router: Router,
  satellite: Satellite,
  antenna: Antenna,
  network: Network,
  radio: Radio,
  database: Database,
  video: Video,
  "key-round": KeyRound,
  boxes: Boxes,
}

export const ICON_NAMES = Object.keys(ICON_MAP)

const KIND_DEFAULT_ICON: Record<ServiceKind, LucideIcon> = {
  voice: Phone,
  data: Globe,
  other: Boxes,
}

export function serviceIcon(
  iconName: string | null | undefined,
  kind: ServiceKind,
): LucideIcon {
  if (iconName && ICON_MAP[iconName]) return ICON_MAP[iconName]
  return KIND_DEFAULT_ICON[kind] ?? Boxes
}

const GATEWAY_KIND_ICON: Record<GatewayKind, LucideIcon> = {
  milsat: Satellite,
  commercial: Cloud,
  other: Network,
}

export function gatewayIcon(kind: GatewayKind): LucideIcon {
  return GATEWAY_KIND_ICON[kind] ?? Network
}

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  "critical",
  "sustainment",
  "other",
]

export function categoryLabel(c: ServiceCategory): string {
  switch (c) {
    case "critical":
      return "Critical"
    case "sustainment":
      return "Sustainment"
    case "other":
    default:
      return "Other"
  }
}

export function categoryAccentClass(c: ServiceCategory): string {
  switch (c) {
    case "critical":
      return "border-sky-500/40 bg-sky-500/5"
    case "sustainment":
      return "border-violet-500/40 bg-violet-500/5"
    case "other":
    default:
      return "border-muted-foreground/30 bg-muted/30"
  }
}

export const SERVICE_REACH_VALUES: ServiceReach[] = ["local", "external"]

export function reachLabel(r: ServiceReach): string {
  switch (r) {
    case "local":
      return "Local"
    case "external":
      return "External"
  }
}

export function reachShort(r: ServiceReach): string {
  switch (r) {
    case "local":
      return "L"
    case "external":
      return "E"
  }
}

export const GATEWAY_KINDS: GatewayKind[] = ["milsat", "commercial", "other"]

export function gatewayKindLabel(k: GatewayKind): string {
  switch (k) {
    case "milsat":
      return "MILSAT"
    case "commercial":
      return "Commercial"
    case "other":
    default:
      return "Other"
  }
}

export const GATEWAY_PACE_VALUES: GatewayPace[] = [
  "primary",
  "alternate",
  "contingency",
  "emergency",
]

export function paceLabel(p: GatewayPace): string {
  switch (p) {
    case "primary":
      return "Primary"
    case "alternate":
      return "Alternate"
    case "contingency":
      return "Contingency"
    case "emergency":
      return "Emergency"
  }
}

/** Short PACE letter (P/A/C/E). */
export function paceShort(p: GatewayPace): string {
  return p[0].toUpperCase()
}

/** Color treatment for the PACE badge inside a gateway node. */
export function paceClasses(p: GatewayPace): { bg: string; text: string } {
  switch (p) {
    case "primary":
      return { bg: "bg-emerald-600", text: "text-white" }
    case "alternate":
      return { bg: "bg-sky-600", text: "text-white" }
    case "contingency":
      return { bg: "bg-amber-500", text: "text-black" }
    case "emergency":
      return { bg: "bg-red-700", text: "text-white" }
  }
}
