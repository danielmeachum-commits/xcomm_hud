"use client"

import Link from "next/link"

import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { serviceIcon } from "@/lib/service-meta"
import { formatZulu } from "@/lib/time"
import type { WidgetProps } from "@/lib/dashboard/registry"
import type { ServiceRollup } from "@/lib/types"

function groupByKind(services: ServiceRollup[]): Map<string, ServiceRollup[]> {
  const groups = new Map<string, ServiceRollup[]>()
  for (const svc of services) {
    if (!groups.has(svc.kind)) groups.set(svc.kind, [])
    groups.get(svc.kind)!.push(svc)
  }
  return groups
}

export function ServiceHealthRollupWidget({ data }: WidgetProps) {
  const services = data.services ?? []

  if (services.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-sm text-muted-foreground">
        No services yet — add one from the Services page.
      </div>
    )
  }

  const groups = groupByKind(services)

  return (
    <div className="h-full w-full overflow-auto p-4">
      <div className="flex flex-col gap-5">
        {Array.from(groups.entries()).map(([kind, items]) => (
          <section key={kind}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {kind}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {items.map((s) => {
                const Icon = serviceIcon(s.icon, s.kind)
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-md border bg-background/50 px-3 py-2 text-sm"
                  >
                    <Link
                      href={`/services/${s.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.site_name}
                          {s.validated_at ? ` · ${formatZulu(s.validated_at)}` : ""}
                        </div>
                      </div>
                    </Link>
                    <ServiceStatusPill
                      serviceId={s.id}
                      serviceName={s.name}
                      status={s.status}
                      effectiveStatus={s.effective_status}
                      lastValidatedAt={s.validated_at}
                      allowedStatuses={s.allowed_statuses}
                    />
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
