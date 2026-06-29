"use client"

import Link from "next/link"

import type { WidgetProps } from "@/lib/dashboard/registry"
import { statusBadgeClass, statusLabel } from "@/lib/status"
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
              {items.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/services/${s.id}`}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent ${statusBadgeClass(s.status)}`}
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs uppercase tracking-wider">
                      {statusLabel(s.status)} · {s.hosting}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
