import {
  Antenna,
  Battery,
  Boxes,
  Cable,
  CircleDashed,
  CircleDot,
  CornerDownRight,
  KeyRound,
  LifeBuoy,
  Merge,
  Network,
  Package,
  Phone,
  Radio,
  Router,
  Satellite,
  Server,
  Video,
  Waypoints,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react"

import type {
  CapabilityKind,
  Equipment,
  EquipmentCategory,
  EquipmentLinkDirection,
  EquipmentLinkKind,
  EquipmentStatus,
  UtcRole,
  UtcRoleHint,
} from "./types"

export const EQUIPMENT_STATUS_VALUES: EquipmentStatus[] = [
  "up",
  "degraded",
  "maintenance",
  "down",
  "offline",
  "unvalidated",
]

/** Worst-of ordering, mirroring EQUIPMENT_STATUS_RANK in
 *  api/equipment_status.py. Higher = worse; `unknown` is exempt (it means
 *  "no information", not "worst case"). */
const STATUS_RANK: Record<string, number> = {
  up: 1,
  degraded: 2,
  maintenance: 3,
  down: 4,
  offline: 5,
}

export function worstEquipmentStatus(
  statuses: EquipmentStatus[],
): EquipmentStatus | null {
  let worst: EquipmentStatus | null = null
  for (const s of statuses) {
    if (!STATUS_RANK[s]) continue
    if (worst === null || STATUS_RANK[s] > STATUS_RANK[worst]) worst = s
  }
  return worst
}

export const EQUIPMENT_CATEGORY_ICONS: Record<EquipmentCategory, LucideIcon> = {
  radio: Radio,
  satcom: Satellite,
  crypto: KeyRound,
  network: Network,
  compute: Server,
  power: Battery,
  antenna: Antenna,
  cable: Cable,
  other: Package,
}

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  radio: "Radio",
  satcom: "SATCOM",
  crypto: "Crypto",
  network: "Network",
  compute: "Compute",
  power: "Power",
  antenna: "Antenna",
  cable: "Cable",
  other: "Other",
}

export const CAPABILITY_ICONS: Record<CapabilityKind, LucideIcon> = {
  voice: Phone,
  data: Waypoints,
  video: Video,
  satcom_rf: Satellite,
  los_rf: Wifi,
  routing: Router,
  switching: Merge,
  crypto: KeyRound,
  power: Zap,
  other: Boxes,
}

export const CAPABILITY_LABELS: Record<CapabilityKind, string> = {
  voice: "Voice",
  data: "Data",
  video: "Video",
  satcom_rf: "SATCOM RF",
  los_rf: "Line of sight",
  routing: "Routing",
  switching: "Switching",
  crypto: "Crypto",
  power: "Power",
  other: "Other",
}

export const LINK_KIND_LABELS: Record<EquipmentLinkKind, string> = {
  los: "Line of sight",
  satcom: "SATCOM",
  fiber: "Fiber",
  cable: "Cable",
  wireless: "Wireless",
  other: "Other",
}

/** Picker order for the link editor. Explicit rather than
 *  `Object.keys(LINK_KIND_LABELS)` so the ordering is a decision, not a
 *  side effect of how the label record happens to be written — same
 *  precedent as EQUIPMENT_STATUS_VALUES above. */
export const EQUIPMENT_LINK_KINDS: EquipmentLinkKind[] = [
  "los",
  "satcom",
  "fiber",
  "cable",
  "wireless",
  "other",
]

export const EQUIPMENT_LINK_DIRECTIONS: EquipmentLinkDirection[] = [
  "bidirectional",
  "a_to_b",
]

/** Dash pattern per link kind, so the canvas distinguishes an RF shot from a
 *  physical run without relying on color (which already carries status). */
export const LINK_KIND_DASH: Record<EquipmentLinkKind, string | undefined> = {
  los: "6 4",
  satcom: "2 4",
  wireless: "1 5",
  fiber: undefined,
  cable: undefined,
  other: "4 4",
}

/** What a package says a UTC is *for*, as opposed to `UtcRole`, which is what a
 *  deployed UTC turned out to be. Shared by the force-element list and the
 *  package detail page so the two never drift apart. */
export const UTC_ROLE_HINT_LABELS: Record<UtcRoleHint, string> = {
  primary: "Primary",
  alternate: "Alternate",
  extension: "Extension",
  support: "Support",
  either: "Any role",
}

/** Every role-hint select offers these, in this order: primary and the standby
 *  that would take its place, then the spur, then support, then the shrug. Shared so a new hint cannot be added to
 *  one form and missed by the other three. */
export const UTC_ROLE_HINT_VALUES: UtcRoleHint[] = [
  "primary",
  "alternate",
  "extension",
  "support",
  "either",
]

/** The set reads as a topology, because that is what the roles are: a primary
 *  is a node, an extension is something hanging off one — "takes signal off the
 *  primary UTC over an RF shot", in the seed data's own words. CircleDot is the
 *  node; CornerDownRight is the spur descending from it.
 *
 *  An alternate is the same node held in reserve, so it is the same circle
 *  drawn dashed. Support sits off the topology entirely — HVAC and power keep
 *  the node running without ever carrying its traffic — so LifeBuoy rather
 *  than another node-and-edge glyph. `either` keeps the generic Boxes: the API's default
 *  role_hint genuinely means "no particular position". */
export const UTC_ROLE_HINT_ICONS: Record<UtcRoleHint, LucideIcon> = {
  primary: CircleDot,
  alternate: CircleDashed,
  extension: CornerDownRight,
  support: LifeBuoy,
  either: Boxes,
}

export const UTC_ROLE_LABELS: Record<UtcRole, string> = {
  primary: "Primary",
  extension: "Extension",
  independent: "Independent",
}

export function equipmentIcon(category: EquipmentCategory | null): LucideIcon {
  return category ? EQUIPMENT_CATEGORY_ICONS[category] ?? Package : Package
}

/** What to call a piece of gear in a list. Nobody says "AN/PRC-117G", so the
 *  short name leads and the full title is the subtitle. */
export function equipmentTypeLabel(eq: Equipment): string {
  return eq.type_short_name || eq.type_title || "Unknown type"
}

/** Roll a piece of equipment's capabilities up to one status.
 *  Falls back to the equipment's own status when it has no capabilities. */
export function equipmentRollup(eq: Equipment): EquipmentStatus {
  const fromCaps = worstEquipmentStatus(eq.capabilities.map((c) => c.status))
  return fromCaps ?? eq.status
}
