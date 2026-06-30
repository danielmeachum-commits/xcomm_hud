"use client"

import Link from "next/link"
import { useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import TransportBadge from "@/components/8starlabs-ui/transport-badge"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { GatewayForm } from "@/components/sites/gateway-form"
import { GatewayStatusPill } from "@/components/services/gateway-status-pill"
import { ServiceForm } from "@/components/services/service-form"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { SiteCanvas } from "@/components/sites/site-canvas"
import { SiteForm } from "@/components/sites/site-form"
import { LocalTime } from "@/components/time-display"
import { Button } from "@/components/ui/button"
import {
  categoryAccentClass,
  categoryLabel,
  gatewayIcon,
  gatewayKindLabel,
  paceClasses,
  paceShort,
  reachLabel,
  serviceIcon,
} from "@/lib/service-meta"
import { statusLabel, statusToIndicatorState } from "@/lib/status"
import { formatZulu } from "@/lib/time"
import type {
  Gateway,
  Service,
  ServiceCategory,
  ServiceTemplate,
  Site,
} from "@/lib/types"

interface Props {
  site: Site
  services: Service[]
  gateways: Gateway[]
  sites: Site[]
  templates: ServiceTemplate[]
}

const CATEGORY_ORDER: ServiceCategory[] = [
  "core_critical_local",
  "sustainment",
  "other",
]

export function SiteDetailClient({
  site,
  services,
  gateways,
  sites,
  templates,
}: Props) {
  const [view, setView] = useState<"canvas" | "list">("canvas")

  const byCategory = new Map<ServiceCategory, Service[]>()
  for (const s of services) {
    const list = byCategory.get(s.category) ?? []
    list.push(s)
    byCategory.set(s.category, list)
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: "Sites", href: "/sites" },
          { label: site.name },
        ]}
      />
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">{site.name}</h1>
          <p className="text-xs text-muted-foreground">
            {site.location_label ?? "—"}
          </p>
          <TransportBadge
            fpcon={site.show_fpcon ? site.fpcon : undefined}
            emcon={site.show_emcon ? site.emcon : undefined}
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider">
            <StatusIndicator
              state={statusToIndicatorState(site.status)}
              size="md"
            />
            <span>{statusLabel(site.status)}</span>
          </div>
          <div className="flex gap-2">
            <SiteForm site={site} />
            <GatewayForm siteId={site.id} />
            <ServiceForm
              sites={sites}
              templates={templates}
              defaultSiteId={site.id}
            />
          </div>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={view === "canvas" ? "default" : "outline"}
          onClick={() => setView("canvas")}
        >
          Canvas
        </Button>
        <Button
          size="sm"
          variant={view === "list" ? "default" : "outline"}
          onClick={() => setView("list")}
        >
          List
        </Button>
      </div>

      {view === "canvas" ? (
        <SiteCanvas services={services} gateways={gateways} />
      ) : (
        <div className="flex flex-col gap-6">
          {gateways.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Gateways
              </h2>
              <ul className="flex flex-col gap-2">
                {gateways.map((g) => {
                  const Icon = gatewayIcon(g.kind)
                  const pace = paceClasses(g.pace)
                  return (
                    <li
                      key={g.id}
                      className="flex items-center justify-between gap-3 rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Icon className="size-5 shrink-0 text-amber-700 dark:text-amber-400" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${pace.bg} ${pace.text}`}
                              title={`PACE: ${g.pace}`}
                            >
                              {paceShort(g.pace)}
                            </span>
                            <span className="font-medium">{g.name}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {gatewayKindLabel(g.kind)}
                            {g.provider ? ` · ${g.provider}` : ""}
                          </div>
                          {g.validated_at && (
                            <div className="text-[10px] font-mono text-muted-foreground">
                              <LocalTime iso={g.validated_at} /> ·{" "}
                              {formatZulu(g.validated_at)}
                              {g.validated_by_username ? ` · ${g.validated_by_username}` : ""}
                            </div>
                          )}
                        </div>
                      </div>
                      <GatewayStatusPill
                        gatewayId={g.id}
                        gatewayName={g.name}
                        status={g.status}
                        lastValidatedAt={g.validated_at}
                        lastValidatedBy={g.validated_by_username}
                      />
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {CATEGORY_ORDER.map((cat) => {
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
                              {s.kind} · {reachLabel(s.reach)}
                            </div>
                            {s.validated_at && (
                              <div className="text-[10px] font-mono text-muted-foreground">
                                <LocalTime iso={s.validated_at} /> ·{" "}
                                {formatZulu(s.validated_at)}
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

          {services.length === 0 && gateways.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
              No services or gateways yet. Add a gateway (your ISP/modem
              uplink) and your standard services from the template catalog.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
