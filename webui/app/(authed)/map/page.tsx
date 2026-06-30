import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { MapCanvas } from "@/components/map/map-canvas"
import type { MapBundle } from "@/lib/types"

export default async function MapPage() {
  await requireSession()

  let bundle: MapBundle = {
    sites: [],
    positions: [],
    services: [],
    gateways: [],
    annotations: [],
  }
  try {
    bundle = await apiGet<MapBundle>("/canvas/map")
  } catch {
    // canvas endpoint unavailable — empty map
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Map</h1>
        <p className="text-xs text-muted-foreground">
          Drag sites to arrange them geographically. Double-click a label to edit.
          Click the open icon on a site to drill into its canvas.
        </p>
      </div>
      {bundle.sites.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
          No sites yet — add one from the Sites page.
        </div>
      ) : (
        <MapCanvas bundle={bundle} />
      )}
    </div>
  )
}
