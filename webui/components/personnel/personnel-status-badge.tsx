import {
  PERSONNEL_STATUS_COLORS,
  PERSONNEL_STATUS_LABELS,
  type PersonnelStatus,
} from "@/lib/personnel-data"
import { timeAgo } from "@/lib/time"
import { cn } from "@/lib/utils"

interface Props {
  status: PersonnelStatus
  siteName?: string | null
  /** When set and status is known, appends the elapsed duration (e.g. "3h ago"). */
  since?: string | null
  size?: "sm" | "md"
  className?: string
}

/** Small dot + label capsule showing where a person is right now. */
export function PersonnelStatusBadge({
  status,
  siteName,
  since,
  size = "sm",
  className,
}: Props) {
  const color = PERSONNEL_STATUS_COLORS[status]
  const label = PERSONNEL_STATUS_LABELS[status]
  const showDuration = status !== "unknown" && !!since
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background text-muted-foreground",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        className,
      )}
      style={{ borderColor: color }}
    >
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="text-foreground">{label}</span>
      {status === "on_site" && siteName ? (
        <span className="opacity-70">· {siteName}</span>
      ) : null}
      {showDuration ? (
        <span className="opacity-70">· {timeAgo(since)}</span>
      ) : null}
    </span>
  )
}
