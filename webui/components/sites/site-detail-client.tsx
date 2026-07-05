"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useState } from "react"

import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { GatewayForm } from "@/components/sites/gateway-form"
import { GatewayStatusPill } from "@/components/services/gateway-status-pill"
import { ServiceForm } from "@/components/services/service-form"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { SiteCanvas } from "@/components/sites/site-canvas"
import { SiteDetailsTab } from "@/components/sites/site-details-tab"
import { SiteForm } from "@/components/sites/site-form"
import { SiteMatrix } from "@/components/sites/site-matrix"
import { SiteStatusPill } from "@/components/sites/site-status-pill"
import { SiteThreatPill } from "@/components/sites/site-threat-pill"
import { LocalTime } from "@/components/time-display"
import { ViewTabs } from "@/components/ui/view-tabs"
import { useWorkspace } from "@/lib/workspace"
import {
  ClipboardList,
  Info,
  LayoutGrid,
  Network,
  Package,
  Table as TableIcon,
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
import { PersonnelTable } from "@/components/personnel/personnel-table"
import { QuickCheckInButton } from "@/components/personnel/quick-checkin-button"
import { SiteCheckInDialog } from "@/components/personnel/site-checkin-dialog"
import type {
  Gateway,
  Personnel,
  Role,
  Service,
  ServiceCategory,
  ServiceTemplate,
  Site,
  SiteProperty,
  SitePropertyTemplate,
  Unit,
  WorkCenter,
} from "@/lib/types"

interface Props {
  site: Site
  services: Service[]
  gateways: Gateway[]
  sites: Site[]
  templates: ServiceTemplate[]
  properties: SiteProperty[]
  propertyTemplates: SitePropertyTemplate[]
  personnel: Personnel[]
  workCenters: WorkCenter[]
  units: Unit[]
  userRole?: Role
}

type Tab = "services" | "personnel" | "equipment" | "details" | "events"

const TABS: readonly Tab[] = [
  "services",
  "personnel",
  "equipment",
  "details",
  "events",
]

const CATEGORY_ORDER: ServiceCategory[] = ["critical", "sustainment", "other"]

export function SiteDetailClient({
  site,
  services,
  gateways,
  sites,
  templates,
  properties,
  propertyTemplates,
  personnel,
  workCenters,
  units,
  userRole,
}: Props) {
  const { w } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Tab lives in the URL (?tab=) so returning to this page — e.g. via the
  // browser back button after opening a person — restores the active tab.
  const tabParam = searchParams.get("tab") as Tab | null
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "services"
  const setTab = useCallback(
    (next: Tab) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === "services") params.delete("tab")
      else params.set("tab", next)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[{ label: "Sites", href: w("/sites") }, { label: site.name }]}
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
        </div>
      </header>

      <ViewTabs<Tab>
        value={tab}
        onChange={setTab}
        variant="line"
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
          site={site}
          sites={sites}
          services={services}
          gateways={gateways}
          templates={templates}
          userRole={userRole}
        />
      ) : tab === "personnel" ? (
        <SitePersonnelTab
          site={site}
          personnel={personnel}
          sites={sites}
          workCenters={workCenters}
          units={units}
          canEdit={userRole !== "viewer"}
        />
      ) : tab === "equipment" ? (
        <PlaceholderTab title="Equipment" description="Site equipment inventory will live here." />
      ) : tab === "details" ? (
        <SiteDetailsTab
          siteId={site.id}
          properties={properties}
          templates={propertyTemplates}
          userRole={userRole}
        />
      ) : (
        <PlaceholderTab title="Events" description="A site-scoped event log with select and CRUD will live here." />
      )}
    </div>
  )
}

function ServicesTab({
  site,
  sites,
  services,
  gateways,
  templates,
  userRole,
}: {
  site: Site
  sites: Site[]
  services: Service[]
  gateways: Gateway[]
  templates: ServiceTemplate[]
  userRole?: Role
}) {
  const [view, setView] = useState<"list" | "graph" | "matrix">("matrix")
  const { w } = useWorkspace()

  const byCategory = new Map<ServiceCategory, Service[]>()
  for (const s of services) {
    const list = byCategory.get(s.category) ?? []
    list.push(s)
    byCategory.set(s.category, list)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewTabs<"list" | "graph" | "matrix">
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "List", icon: LayoutGrid },
            { value: "graph", label: "Graph", icon: Network },
            { value: "matrix", label: "Matrix", icon: TableIcon },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <GatewayForm siteId={site.id} />
          <ServiceForm
            sites={sites}
            templates={templates}
            defaultSiteId={site.id}
          />
        </div>
      </div>

      {view === "matrix" ? (
        <SiteMatrix services={services} gateways={gateways} userRole={userRole} />
      ) : view === "graph" ? (
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
                          href={w(`/services/${s.id}`)}
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

function SitePersonnelTab({
  site,
  personnel,
  sites,
  workCenters,
  units,
  canEdit,
}: {
  site: Site
  personnel: Personnel[]
  sites: Site[]
  workCenters: WorkCenter[]
  units: Unit[]
  canEdit: boolean
}) {
  const { w } = useWorkspace()
  const assigned = personnel.filter((p) => p.assigned_site_id === site.id)
  // People signed in on-site right now — regardless of assignment. Useful for
  // seeing who is physically present including TDY visitors.
  const currentlyOnSite = personnel.filter(
    (p) => p.current_status === "on_site" && p.current_site_id === site.id,
  )
  const assignedIds = new Set(assigned.map((p) => p.id))
  const visitors = currentlyOnSite.filter((p) => !assignedIds.has(p.id))

  // Return link so opening a person from here breadcrumbs back to this tab.
  const linkFrom = { path: `${w(`/sites/${site.id}`)}?tab=personnel`, label: site.name }

  const empty = assigned.length === 0 && visitors.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Personnel assigned to {site.name}, plus anyone currently signed in
          on-site.
        </p>
        {canEdit && <SiteCheckInDialog site={site} personnel={personnel} />}
      </div>

      {empty ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm font-medium">No personnel here yet</p>
          <p className="text-xs text-muted-foreground">
            Use <span className="font-medium">Check someone in</span> above to
            log a visitor, assign someone to this site from their detail page,
            or add a new person from{" "}
            <Link href={w("/personnel")} className="underline">
              Personnel
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assigned ({assigned.length})
            </h2>
            <PersonnelTable
              personnel={assigned}
              workCenters={workCenters}
              units={units}
              sites={sites}
              canEdit={canEdit}
              linkFrom={linkFrom}
              emptyMessage="No one is assigned to this site."
              rowAction={
                canEdit
                  ? (p) =>
                      p.current_status === "on_site" &&
                      p.current_site_id === site.id ? (
                        <span className="text-xs text-muted-foreground">
                          On station
                        </span>
                      ) : (
                        <QuickCheckInButton personId={p.id} siteId={site.id} />
                      )
                  : undefined
              }
            />
          </section>
          {visitors.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                On-site now ({visitors.length})
              </h2>
              <PersonnelTable
                personnel={visitors}
                workCenters={workCenters}
                units={units}
                sites={sites}
                canEdit={canEdit}
                linkFrom={linkFrom}
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}
