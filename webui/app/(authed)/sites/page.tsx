import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { SiteForm } from "@/components/sites/site-form"
import { SitesTabs } from "@/components/sites/sites-tabs"
import type { MapBundle, Site } from "@/lib/types"

export default async function SitesPage() {
  await requireSession()

  let sites: Site[] = []
  let bundle: MapBundle = {
    sites: [],
    positions: [],
    services: [],
    gateways: [],
    annotations: [],
  }
  try {
    ;[sites, bundle] = await Promise.all([
      apiGet<Site[]>("/sites"),
      apiGet<MapBundle>("/canvas/map"),
    ])
  } catch {
    // API unavailable — fall back to empty data
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Sites" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Sites</h1>
          <p className="text-xs text-muted-foreground">
            Physical locations. Status rolls up from the services at each site.
          </p>
        </div>
        <SiteForm />
      </div>

      <SitesTabs sites={sites} bundle={bundle} />
    </div>
  )
}
