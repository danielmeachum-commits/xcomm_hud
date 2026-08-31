import { Globe } from "lucide-react"

/** Marks a row as belonging to the shared, admin-managed catalog rather than
 *  to this workspace. Only admins can edit those. */
export function GlobalBadge() {
  return (
    <span
      title="Global catalog — shared across workspaces, admin-managed"
      className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
    >
      <Globe className="size-3" />
      Global
    </span>
  )
}
