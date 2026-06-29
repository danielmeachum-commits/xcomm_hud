import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { LayoutView } from "@/components/dashboard/layout-view"
import { EditToggle } from "@/components/dashboard/edit-toggle"
import type { StatusRollup } from "@/lib/types"

export default async function OverviewPage() {
  await requireSession()

  let rollup: StatusRollup = { sites: [], services: [] }
  try {
    rollup = await apiGet<StatusRollup>("/status/rollup")
  } catch {
    // API unavailable — widgets show empty states
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
          <p className="text-xs text-muted-foreground">
            Drag handles to resize, edit to add or rearrange widgets.
          </p>
        </div>
        <EditToggle />
      </div>
      <div className="flex-1 min-h-0 p-3 sm:p-4">
        <div className="h-full w-full rounded-xl border border-border bg-muted/40 p-4">
          <LayoutView data={{ sites: rollup.sites, services: rollup.services }} />
        </div>
      </div>
    </div>
  )
}
