import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/** Code pill for a UTC or package. Mirrors the transport-badge shape so codes
 *  read as identifiers rather than prose.
 *
 *  Its own module rather than living in `catalog-detail-sheets`: the read-only
 *  Force Element Templates page wants the badge and nothing else, and
 *  importing it from there would drag every sheet, editor and write path along
 *  with it.
 *
 *  Vertical centering is set by measurement, not by eye. With `leading-none`
 *  the 13px line box is shorter than Inter's ascent+descent (13 + 3), so CSS
 *  half-leading is negative and the baseline lands 11.5px down a 13px content
 *  box. Caps rise 9px off that baseline and have no descender, which leaves
 *  6.5px of air above the ink and 5.5px below it — symmetric padding renders
 *  the text 1px LOW, not high.
 *
 *  Hence the half-pixel split: 3.5px top, 4.5px bottom, which measures dead
 *  even. The number is specific to this size and the Inter stack; re-measure
 *  if either changes, by comparing canvas `actualBoundingBoxAscent` against
 *  the computed baseline rather than adjusting until it looks right. */
const codeBadgeVariants = cva(
  "inline-flex items-center rounded-md px-2 pt-[3.5px] pb-[4.5px] text-[13px] font-semibold uppercase leading-none tracking-wide",
  {
    variants: {
      /** `strong` marks the object a card is *about* — a package. `muted` is
       *  everything the card contains, chiefly UTCs. One filled chip per card
       *  with quiet ones beneath it makes the containment visible at a glance;
       *  the two used to be identical and the hierarchy was invisible.
       *
       *  Neutral foreground/background rather than a hue: this codebase keeps
       *  color for status, and a definition has no status to report. */
      tone: {
        muted: "bg-muted text-foreground ring-1 ring-inset ring-border",
        strong: "bg-foreground text-background",
      },
    },
    defaultVariants: { tone: "muted" },
  },
)

export function CodeBadge({
  code,
  tone,
  className,
}: {
  code: string
  className?: string
} & VariantProps<typeof codeBadgeVariants>) {
  return <span className={cn(codeBadgeVariants({ tone }), className)}>{code}</span>
}
