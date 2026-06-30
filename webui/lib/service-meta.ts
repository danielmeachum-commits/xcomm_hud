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
  ServiceCategory,
  ServiceKind,
  ServiceReach,
} from "./types"

const ICON_MAP: Record<string, LucideIcon> = {
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

const KIND_DEFAULT_ICON: Record<ServiceKind, LucideIcon> = {
  voip: Phone,
  data: Globe,
  video: Video,
  crypto: KeyRound,
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
  isp: Cloud,
  modem: Router,
  satellite: Satellite,
  other: Network,
}

export function gatewayIcon(kind: GatewayKind): LucideIcon {
  return GATEWAY_KIND_ICON[kind] ?? Network
}

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  "core_critical_local",
  "sustainment",
  "other",
]

export function categoryLabel(c: ServiceCategory): string {
  switch (c) {
    case "core_critical_local":
      return "Core Critical Local"
    case "sustainment":
      return "Sustainment"
    case "other":
    default:
      return "Other"
  }
}

export function categoryAccentClass(c: ServiceCategory): string {
  switch (c) {
    case "core_critical_local":
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

export const GATEWAY_KINDS: GatewayKind[] = ["isp", "modem", "satellite", "other"]

export function gatewayKindLabel(k: GatewayKind): string {
  switch (k) {
    case "isp":
      return "ISP"
    case "modem":
      return "Modem"
    case "satellite":
      return "Satellite"
    case "other":
    default:
      return "Other"
  }
}
