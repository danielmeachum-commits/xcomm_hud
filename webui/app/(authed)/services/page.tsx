import Link from "next/link"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { ServiceForm } from "@/components/services/service-form"
import { statusBadgeClass, statusLabel } from "@/lib/status"
import type { Equipment, Service, Site } from "@/lib/types"

export default async function ServicesPage() {
  await requireSession()

  let services: Service[] = []
  let sites: Site[] = []
  let equipment: Equipment[] = []
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
  try {
    equipment = await apiGet<Equipment[]>("/equipment")
  } catch {
    // ignore
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Services</h1>
          <p className="text-xs text-muted-foreground">
            Logical services with worst-of status rolled up from components.
          </p>
        </div>
        <ServiceForm sites={sites} equipment={equipment} />
      </div>

      {services.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
          No services yet — add your first service.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {services.map((s) => (
            <li key={s.id}>
              <Link
                href={`/services/${s.id}`}
                className={`flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent ${statusBadgeClass(s.status)}`}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.kind} · {s.hosting}
                    {s.manual_status_override ? " · manual override" : ""}
                  </span>
                </div>
                <span className="text-xs uppercase tracking-wider">
                  {statusLabel(s.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
