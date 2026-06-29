"use client"

import Link from "next/link"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { statusLabel, statusToIndicatorState } from "@/lib/status"
import type { Service, Site } from "@/lib/types"

interface Props {
  site: Site
  services: Service[]
}

export function SiteDetailClient({ site, services }: Props) {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{site.name}</h1>
          <p className="text-xs text-muted-foreground">
            {site.location_label ?? "—"} · Classification {site.classification}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider">
          <StatusIndicator state={statusToIndicatorState(site.status)} size="md" />
          <span>{statusLabel(site.status)}</span>
        </div>
      </header>

      <section>
        <header className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Services</h2>
          <Link
            href="/services"
            className="text-xs text-muted-foreground hover:underline"
          >
            Manage all services →
          </Link>
        </header>
        {services.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-xs text-muted-foreground">
            No services attached to this site yet. Add one from the Services page
            with this site selected.
          </p>
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
                  </div>
                </Link>
                <ServiceStatusPill serviceId={s.id} status={s.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
