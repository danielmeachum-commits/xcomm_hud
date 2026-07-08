import {
  Bell,
  Calendar,
  CircleDot,
  ClipboardCheck,
  Flag,
  FlagOff,
  Megaphone,
  Pause,
  Play,
  Presentation,
  Radio,
  ShieldCheck,
  Siren,
  StickyNote,
  TriangleAlert,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react"

/** Icons available to event types — mirrors the seeded catalog icons plus
 *  a spread of useful extras for custom types. Keys are stored on
 *  EventTypeDef.icon; unknown/unset names fall back to a neutral dot. */
export const EVENT_ICON_MAP: Record<string, LucideIcon> = {
  flag: Flag,
  "flag-off": FlagOff,
  pause: Pause,
  play: Play,
  "shield-check": ShieldCheck,
  presentation: Presentation,
  "sticky-note": StickyNote,
  radio: Radio,
  megaphone: Megaphone,
  siren: Siren,
  "triangle-alert": TriangleAlert,
  wrench: Wrench,
  truck: Truck,
  users: Users,
  calendar: Calendar,
  "clipboard-check": ClipboardCheck,
  bell: Bell,
}

export const EVENT_ICON_NAMES = Object.keys(EVENT_ICON_MAP)

export function eventTypeIcon(iconName: string | null | undefined): LucideIcon {
  if (iconName && EVENT_ICON_MAP[iconName]) return EVENT_ICON_MAP[iconName]
  return CircleDot
}

/** Group a type list by category for pickers and the management page.
 *  Categories keep first-seen order; uncategorized types land in "Other". */
export function groupByCategory<T extends { category: string | null }>(
  types: T[],
): Array<{ category: string; types: T[] }> {
  const groups = new Map<string, T[]>()
  for (const t of types) {
    const key = t.category?.trim() || "Other"
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  const entries = Array.from(groups.entries()).map(([category, types]) => ({
    category,
    types,
  }))
  // "Other" always sorts last; the rest alphabetically.
  entries.sort((a, b) => {
    if (a.category === "Other") return 1
    if (b.category === "Other") return -1
    return a.category.localeCompare(b.category)
  })
  return entries
}
