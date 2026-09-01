import { SKILL_LEVEL_LABELS, type SkillLevel } from "@/lib/personnel-data"
import { cn } from "@/lib/utils"

/**
 * An AFSC skill level as a chip: the number set large with "lvl" riding small
 * beside it — "7 lvl".
 *
 * The number IS the fact, so it gets the weight; "lvl" is the unit, so it gets
 * the small type. Set as prose in a row of other prose a bare "7" reads as a
 * count of something, and there is already a count on these rows.
 *
 * An earlier pass drew this as a five-segment meter instead. It was prettier
 * and less useful: a level is a value people say out loud and compare exactly
 * ("we need a 7, a 5 won't sign it off"), and a shape you have to count the
 * lit segments of to read is a worse way to show a number than the number.
 */
export function SkillLevelBadge({
  level,
  className,
}: {
  level: number
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-baseline gap-0.5 rounded border border-border bg-muted/60 px-1.5 py-px",
        className,
      )}
      title={SKILL_LEVEL_LABELS[level as SkillLevel] ?? undefined}
    >
      <span className="text-[13px] font-semibold leading-none tabular-nums">
        {level}
      </span>
      <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        lvl
      </span>
    </span>
  )
}
