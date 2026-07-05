import Link from "next/link"

import { RankInsignia } from "@/components/personnel/rank-insignia"
import { branchColor } from "@/lib/personnel-data"
import type { Personnel } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  person: Pick<
    Personnel,
    "id" | "personnel_type" | "branch" | "rank" | "last_name" | "first_name"
  >
  /** When set, wrap the pill in a link to the workspace-relative detail page. */
  href?: string
  size?: "sm" | "md"
  showFirstName?: boolean
  className?: string
}

/**
 * Compact reference to a person — rank insignia + rank + last name in an
 * outlined pill accented with the branch color. Outline (not a solid fill) so
 * the colored rank insignia and text stay legible in both light and dark
 * themes. Used as an inline mention in lists, tables, and the site tab.
 */
export function PersonnelPill({
  person,
  href,
  size = "md",
  showFirstName = false,
  className,
}: Props) {
  const accent = branchColor(person.branch, person.personnel_type)
  const rankLabel = person.rank || (person.personnel_type === "civilian" ? "Civ" : "")
  const name = showFirstName
    ? `${person.last_name}, ${person.first_name}`
    : person.last_name
  const insigniaSize = size === "sm" ? 14 : 16

  const inner = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background font-medium text-foreground",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        className,
      )}
      // Branch color rides on the border and a faint tint only, so the pill
      // reads on any background without washing out the rank.
      style={{ borderColor: accent, backgroundColor: `${accent}14` }}
      title={`${rankLabel} ${person.last_name}, ${person.first_name}`.trim()}
    >
      <RankInsignia
        branch={person.branch}
        personnelType={person.personnel_type}
        rank={person.rank}
        size={insigniaSize}
        className="shrink-0"
      />
      {rankLabel && (
        <span className="text-muted-foreground">{rankLabel}</span>
      )}
      <span className="truncate">{name}</span>
    </span>
  )

  if (href) {
    return (
      <Link href={href} className="inline-block hover:opacity-90">
        {inner}
      </Link>
    )
  }
  return inner
}
