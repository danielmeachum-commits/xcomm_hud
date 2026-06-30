import Link from "next/link"

import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { ServiceForm } from "@/components/services/service-form"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { LocalTime } from "@/components/time-display"
import {
  categoryAccentClass,
  categoryLabel,
  reachLabel,
  serviceIcon,
} from "@/lib/service-meta"
import { formatZulu } from "@/lib/time"
import type { Service, ServiceTemplate, Site } from "@/lib/types"

export default async function ServicesPage() {
  await requireSession()

  const [services, sites, templates] = await Promise.all([
    apiGet<Service[]>("/services").catch(() => [] as Service[]),
    apiGet<Site[]>("/sites").catch(() => [] as Site[]),
    apiGet<ServiceTemplate[]>("/service-templates").catch(
      () => [] as ServiceTemplate[],
    ),
  ])

  const siteName = new Map(sites.map((s) => [s.id, s.name]))

  const byCategory = new Map<string, Service[]>()
  for (const s of services) {
    const list = byCategory.get(s.category) ?? []
    list.push(s)
    byCategory.set(s.category, list)
  }
  const categoryOrder = ["critical", "sustainment", "other"] as const

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageBreadcrumbs items={[{ label: "Services" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Services</h1>
          <p className="text-xs text-muted-foreground">
            Tap a status pill to record a validation.
          </p>
        </div>
        <ServiceForm sites={sites} templates={templates} />
      </div>

      {services.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
          No services yet — add your first service.
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {categoryOrder.map((cat) => {
            const items = byCategory.get(cat) ?? []
            if (items.length === 0) return null
            return (
              <section key={cat}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {categoryLabel(cat)}
                </h2>
                <ul className="flex flex-col gap-2">
                  {items.map((s) => {
                    const Icon = serviceIcon(s.icon, s.kind)
                    return (
                      <li
                        key={s.id}
                        className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${categoryAccentClass(s.category)}`}
                      >
                        <Link
                          href={`/services/${s.id}`}
                          className="flex min-w-0 flex-1 items-center gap-3 hover:underline"
                        >
                          <Icon className="size-5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="font-medium">{s.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {s.kind} · {reachLabel(s.reach)} ·{" "}
                              {siteName.get(s.site_id) ?? `site ${s.site_id}`}
                            </div>
                            {s.validated_at && (
                              <div className="text-[10px] font-mono text-muted-foreground">
                                Validated <LocalTime iso={s.validated_at} /> /{" "}
                                {formatZulu(s.validated_at)}
                                {s.validated_by_username ? ` · ${s.validated_by_username}` : ""}
                              </div>
                            )}
                          </div>
                        </Link>
                        <ServiceStatusPill
                          serviceId={s.id}
                          serviceName={s.name}
                          status={s.status}
                          effectiveStatus={s.effective_status}
                          lastValidatedAt={s.validated_at}
                          lastValidatedBy={s.validated_by_username}
                          allowedStatuses={s.allowed_statuses}
                        />
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
