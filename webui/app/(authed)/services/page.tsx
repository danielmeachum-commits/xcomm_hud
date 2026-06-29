import Link from "next/link"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { ServiceForm } from "@/components/services/service-form"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import type { Service, Site } from "@/lib/types"

export default async function ServicesPage() {
  await requireSession()

  let services: Service[] = []
  let sites: Site[] = []
  try {
    services = await apiGet<Service[]>("/services")
  } catch {
    // ignore
  }
  try {
    sites = await apiGet<Site[]>("/sites")
  } catch {
    // ignore
  }

  const siteName = new Map(sites.map((s) => [s.id, s.name]))

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Services</h1>
          <p className="text-xs text-muted-foreground">
            Leadership-facing service health. Click the status pill to update.
          </p>
        </div>
        <ServiceForm sites={sites} />
      </div>

      {services.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
          No services yet — add your first service.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {services.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-background/50 p-3"
            >
              <Link
                href={`/services/${s.id}`}
                className="min-w-0 flex-1 hover:underline"
              >
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.kind} · {s.hosting}
                  {s.site_id
                    ? ` · ${siteName.get(s.site_id) ?? "site " + s.site_id}`
                    : " · cross-site"}
                </div>
              </Link>
              <ServiceStatusPill serviceId={s.id} status={s.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
