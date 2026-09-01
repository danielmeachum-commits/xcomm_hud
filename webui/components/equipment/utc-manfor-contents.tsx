import { UserRound, X } from "lucide-react"

import { SkillLevelBadge } from "@/components/personnel/skill-level-badge"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { sortedManfor } from "@/lib/manfor-meta"
import { SKILL_LEVEL_LABELS, type SkillLevel } from "@/lib/personnel-data"
import type { UtcDef } from "@/lib/types"

/** A UTC definition's MANFOR, read-only — the people it deploys with, where
 *  `UtcDefContents` is the LOGDET it deploys with.
 *
 *  Shared by the definition page and the peek sheet on the package page, so
 *  the two can never describe the same UTC differently. Deliberately one plain
 *  list with no enclave dimension: gear divides by the network it serves, and
 *  people do not — a client systems technician sets up both stacks. */
export function UtcManforContents({
  def,
  className,
}: {
  def: UtcDef
  className?: string
}) {
  const positions = sortedManfor(def.manfor)

  if (positions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No positions — this UTC deploys with nobody.
      </p>
    )
  }

  return (
    <ItemGroup className={className}>
      {positions.map((p) => (
        <ManforPositionItem
          key={p.id}
          workCenter={p.work_center}
          skillLevel={p.skill_level}
          quantity={p.quantity}
        />
      ))}
    </ItemGroup>
  )
}

/**
 * One position, in the one shape it has anywhere.
 *
 * Takes primitives rather than a `UtcDefManforLine` so manage mode can render
 * its unsaved drafts through the identical component. A row that looked one
 * way at rest and another way while editing would be two designs to keep in
 * step, and the point of a set-on-add editor is that the two ARE the same
 * row — one of them just carries a remove button.
 */
export function ManforPositionItem({
  workCenter,
  skillLevel,
  quantity,
  onRemove,
  disabled = false,
}: {
  workCenter: string
  skillLevel: number | null
  quantity: number
  /** Manage mode only. Omitted, the row is purely read-only. */
  onRemove?: () => void
  disabled?: boolean
}) {
  const skillName =
    skillLevel == null ? null : SKILL_LEVEL_LABELS[skillLevel as SkillLevel]
  return (
    <Item variant="muted" size="sm">
      {/* The level takes the media slot the person glyph used to hold. Every
          row on this list is a person, so the glyph said the one thing that
          was never in question, while the level — the thing that decides who
          can fill the slot — was buried in the subtitle. A position with no
          level (an officer or civilian slot) keeps the glyph, so the slot is
          never empty. */}
      <ItemMedia>
        {skillLevel != null ? (
          <SkillLevelBadge level={skillLevel} />
        ) : (
          <UserRound className="size-4 text-muted-foreground" />
        )}
      </ItemMedia>
      {/* `min-w-0` because Item is flex-wrap and ItemContent is flex-1 with
          the default `min-width: auto` — without it a long shop name can't
          shrink below its min-content width and shoves the quantity onto its
          own line. */}
      <ItemContent className="min-w-0">
        {/* The shop leads: it names who owes you the body, which is the first
            thing anyone building a team wants off this row. Plain text and not
            a `CodeBadge` — that uppercases, which is right for an identifier
            and wrong for a shop's name. */}
        <ItemTitle>
          <span className="truncate font-medium">{workCenter}</span>
        </ItemTitle>
        {/* The badge carries the number, so the line beneath is just the name
            the level goes by — "5" and "Journeyman" said once each. */}
        {skillName && (
          <ItemDescription className="truncate">{skillName}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        {/* A quantity of one prints nothing at rest: it's the default, and
            "×1" is a number to decode rather than a fact to read. While
            managing it always prints — adding a position that already exists
            raises this count, and a number that only appears on the second add
            makes that look like nothing happened. */}
        {(quantity > 1 || onRemove) && (
          <span className="text-xs tabular-nums text-muted-foreground">
            ×{quantity}
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
            aria-label={`Remove ${workCenter}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </button>
        )}
      </ItemActions>
    </Item>
  )
}
