import Link from "next/link"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import TransportBadge from "@/components/8starlabs-ui/transport-badge"
import { SiteForm } from "@/components/sites/site-form"
import { statusBadgeClass, statusLabel, statusToIndicatorState } from "@/lib/status"
import type { Site } from "@/lib/types"

export default async function SitesPage() {
  await requireSession()

  let sites: Site[] = []
  try {
    sites = await apiGet<Site[]>("/sites")
  } catch {
    // API unavailable
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Sites</h1>
          <p className="text-xs text-muted-foreground">
            Physical locations. Status rolls up from the services at each site.
          </p>
        </div>
        <SiteForm />
      </div>

      {sites.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
          No sites yet — add your first site.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((s) => (
            <Link
              key={s.id}
              href={`/sites/${s.id}`}
              className={`flex flex-col gap-2 rounded-lg border p-4 transition-colors hover:bg-accent ${statusBadgeClass(s.status)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{s.name}</span>
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider">
                  <StatusIndicator
                    state={statusToIndicatorState(s.status)}
                    size="sm"
                  />
                  <span>{statusLabel(s.status)}</span>
                </div>
              </div>
              <TransportBadge fpcon={s.fpcon} emcon={s.emcon} size="sm" />
              {s.location_label && (
                <p className="text-xs text-muted-foreground">
                  {s.location_label}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
