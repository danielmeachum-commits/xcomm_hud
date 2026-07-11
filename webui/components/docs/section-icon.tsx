import {
  Bell,
  BookOpen,
  FileText,
  Flag,
  Folder,
  GraduationCap,
  Info,
  LifeBuoy,
  Map as MapIcon,
  Network,
  Radio,
  Rocket,
  Server,
  Settings,
  Shield,
  Terminal,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react"

/** Curated Lucide set offered as section icons. Keys are stored verbatim in
 * `doc_section.icon`; the section switcher and the section-manager picker both
 * render from this map, so adding an option here makes it available in both. */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  BookOpen,
  Folder,
  FileText,
  Rocket,
  Settings,
  Wrench,
  Shield,
  Radio,
  Server,
  Network,
  Map: MapIcon,
  Users,
  Flag,
  Info,
  Zap,
  Terminal,
  LifeBuoy,
  GraduationCap,
  Bell,
}

export const SECTION_ICON_NAMES = Object.keys(SECTION_ICONS)

/** Render a section's icon by stored name, falling back to a folder. */
export function SectionIcon({
  name,
  className,
  fallback = Folder,
}: {
  name?: string | null
  className?: string
  fallback?: LucideIcon
}) {
  const Icon = (name && SECTION_ICONS[name]) || fallback
  return <Icon className={className} />
}
