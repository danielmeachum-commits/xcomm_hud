"use client"

import Link from "next/link"
import { useState } from "react"

import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { GatewayForm } from "@/components/sites/gateway-form"
import { GatewayStatusPill } from "@/components/services/gateway-status-pill"
import { ServiceForm } from "@/components/services/service-form"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { SiteCanvas } from "@/components/sites/site-canvas"
import { SiteForm } from "@/components/sites/site-form"
import { SiteStatusPill } from "@/components/sites/site-status-pill"
import { SiteThreatPill } from "@/components/sites/site-threat-pill"
import { LocalTime } from "@/components/time-display"
import { ViewTabs } from "@/components/ui/view-tabs"
import {
  ClipboardList,
  Info,
  LayoutGrid,
  Network,
  Package,
  Users,
  Waypoints,
} from "lucide-react"
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

type Tab = "services" | "personnel" | "equipment" | "details" | "events"

const CATEGORY_ORDER: ServiceCategory[] = ["critical", "sustainment", "other"]

export function SiteDetailClient({
  site,
  services,
  gateways,
  sites,
  templates,
}: Props) {
  const [tab, setTab] = useState<Tab>("services")

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[{ label: "Sites", href: "/sites" }, { label: site.name }]}
      />
      <header className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {site.name}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {site.location_label ?? "—"}
          </p>
          <SiteStatusPill
            siteId={site.id}
            siteName={site.name}
            status={site.status}
          />
          <div className="inline-flex items-center gap-1">
            {site.show_fpcon && (
              <SiteThreatPill
                siteId={site.id}
                siteName={site.name}
                kind="fpcon"
                level={site.fpcon}
              />
            )}
            {site.show_emcon && (
              <SiteThreatPill
                siteId={site.id}
                siteName={site.name}
                kind="emcon"
                level={site.emcon}
              />
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SiteForm site={site} />
          {tab === "services" && (
            <>
              <GatewayForm siteId={site.id} />
              <ServiceForm
                sites={sites}
                templates={templates}
                defaultSiteId={site.id}
              />
            </>
          )}
        </div>
      </header>

      <ViewTabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "services", label: "Services", icon: Waypoints },
          { value: "personnel", label: "Personnel", icon: Users },
          { value: "equipment", label: "Equipment", icon: Package },
          { value: "details", label: "Details", icon: Info },
          { value: "events", label: "Events", icon: ClipboardList },
        ]}
      />

      {tab === "services" ? (
        <ServicesTab
          services={services}
          gateways={gateways}
        />
      ) : tab === "personnel" ? (
        <PlaceholderTab title="Personnel" description="Assigned personnel and roles will live here." />
      ) : tab === "equipment" ? (
        <PlaceholderTab title="Equipment" description="Site equipment inventory will live here." />
      ) : tab === "details" ? (
        <PlaceholderTab title="Details" description="Additional site properties will live here." />
      ) : (
        <PlaceholderTab title="Events" description="A site-scoped event log with select and CRUD will live here." />
      )}
    </div>
  )
}

function ServicesTab({
  services,
  gateways,
}: {
  services: Service[]
  gateways: Gateway[]
}) {
  const [view, setView] = useState<"list" | "graph">("graph")

  const byCategory = new Map<ServiceCategory, Service[]>()
  for (const s of services) {
    const list = byCategory.get(s.category) ?? []
    list.push(s)
    byCategory.set(s.category, list)
  }

  return (
    <div className="flex flex-col gap-4">
      <ViewTabs<"list" | "graph">
        value={view}
        onChange={setView}
        options={[
          { value: "list", label: "List", icon: LayoutGrid },
          { value: "graph", label: "Graph", icon: Network },
        ]}
      />

      {view === "graph" ? (
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

function PlaceholderTab({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}
