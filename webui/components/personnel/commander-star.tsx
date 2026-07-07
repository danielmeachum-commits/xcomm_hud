import { Star } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Gold star marking the workspace commander. Rendered beside the person's
 * name everywhere they appear (list, detail, canvas nodes, pills) so the
 * commander is always identifiable at a glance.
 */
export function CommanderStar({
  size = 13,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <span
      title="Commander"
      aria-label="Commander"
      className={cn("inline-flex shrink-0 items-center", className)}
    >
      <Star
        size={size}
        aria-hidden
        className="fill-amber-400 text-amber-500"
      />
    </span>
  )
}
