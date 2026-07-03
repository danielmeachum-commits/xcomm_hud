"use client"

import { Fragment, useMemo, useState } from "react"
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Plus,
  Settings2,
} from "lucide-react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { GatewayStatusPill } from "@/components/services/gateway-status-pill"
import { MatrixCellPill } from "@/components/services/matrix-cell-pill"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { GatewayForm } from "@/components/sites/gateway-form"
import { TimeAgo } from "@/components/time-display"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  categoryLabel,
  GATEWAY_PACE_VALUES,
  gatewayIcon,
  paceLabel,
  paceShort,
  serviceIcon,
} from "@/lib/service-meta"
import { statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type {
  AnyStatus,
  Gateway,
  GatewayPace,
  Service,
  ServiceGatewayStatus,
  ServiceStatus,
} from "@/lib/types"
import { useWorkspace } from "@/lib/workspace"

type Density = "full" | "min"

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "full", label: "Full details" },
  { value: "min", label: "Minimum details" },
]

const CELL_DASH = "—"

const CELL_PILL_CLASS = "!px-2 !py-0.5 !text-[10px]"
/** In minimum mode the pill collapses to its indicator dot only — no text,
 *  no cascade tag. Combined with `indicatorSize="xl"` the dot is 24px so
 *  the tile reads at a glance. */
const MIN_PILL_CLASS =
  "!inline-flex !justify-center !p-1 !gap-0 !bg-transparent !border-transparent [&_span]:hidden"

/** Ambient tile background matching effective status. Bumped to ~15% so
 *  tinted tiles read clearly against the muted card wrapper; neutral/idle
 *  statuses fall back to `bg-background` so those tiles still visually
 *  separate from the darker card. */
function tileTintSoft(status: AnyStatus): string {
  switch (status) {
    case "up":
    case "active":
    case "operational":
      return "bg-emerald-500/15"
    case "degraded":
    case "limited":
      return "bg-amber-500/15"
    case "down":
      return "bg-red-500/15"
    default:
      return "bg-background"
  }
}

/** Stronger status wash used in minimum-density mode — the tile itself
 *  carries the status signal instead of a pill. */
function tileTintStrong(status: AnyStatus): string {
  switch (status) {
    case "up":
    case "active":
    case "operational":
      return "bg-emerald-500/20"
    case "degraded":
    case "limited":
      return "bg-amber-500/25"
    case "down":
      return "bg-red-500/25"
    case "offline":
      return "bg-slate-500/20"
    case "ready":
    case "setup":
      return "bg-sky-500/15"
    default:
      return "bg-muted/40"
  }
}

function paceSoftBg(p: GatewayPace): string {
  switch (p) {
    case "primary":
      return "bg-emerald-500/10"
    case "alternate":
      return "bg-sky-500/10"
    case "contingency":
      return "bg-amber-500/15"
    case "emergency":
      return "bg-red-500/10"
  }
}

function paceLetterColor(p: GatewayPace): string {
  switch (p) {
    case "primary":
      return "text-emerald-700 dark:text-emerald-300"
    case "alternate":
      return "text-sky-700 dark:text-sky-300"
    case "contingency":
      return "text-amber-800 dark:text-amber-300"
    case "emergency":
      return "text-red-700 dark:text-red-300"
  }
}

interface Props {
  services: Service[]
  gateways: Gateway[]
}

function isTierOverridden(gws: Gateway[]): boolean {
  if (gws.length === 0) return false
  return gws.every((g) => g.status === "offline" || g.status === "down")
}

function isLocalOverridden(service: Service): boolean {
  return service.status === "down" || service.status === "offline"
}

/** Operational-quality rank used to pick the "best" cell for a tier. Lower
 *  = better. `unknown` sits at 100 so any ranked value beats it. */
const CELL_RANK: Record<string, number> = {
  up: 1,
  ready: 2,
  degraded: 3,
  setup: 4,
  down: 5,
  offline: 6,
  unknown: 100,
}

/** Given all gateways on a tier and the service's per-gateway cells, pick
 *  the cell whose effective status is best. Multiple gateways per tier is
 *  a rarer configuration; picking the best one makes the tile a "path
 *  available?" summary. Returns null when the service has no cells for
 *  gateways on this tier. */
function bestCellForTier(
  service: Service,
  tierGateways: Gateway[],
): { cell: ServiceGatewayStatus; gateway: Gateway } | null {
  const cells = service.gateway_statuses ?? []
  if (cells.length === 0 || tierGateways.length === 0) return null
  const tierGwById = new Map(tierGateways.map((g) => [g.id, g]))
  let best: { cell: ServiceGatewayStatus; gateway: Gateway } | null = null
  for (const cell of cells) {
    const gw = tierGwById.get(cell.gateway_id)
    if (!gw) continue
    const rank = CELL_RANK[cell.effective_status] ?? 100
    const bestRank = best ? CELL_RANK[best.cell.effective_status] ?? 100 : 999
    if (best === null || rank < bestRank) {
      best = { cell, gateway: gw }
    }
  }
  return best
}

export function SiteMatrix({ services, gateways }: Props) {
  const [density, setDensity] = useState<Density>("full")

  const { corePace, coreLocal, sustainment, gwByPace, columnOverride, siteId } =
    useMemo(() => {
      const gwByPace: Record<GatewayPace, Gateway[]> = {
        primary: [],
        alternate: [],
        contingency: [],
        emergency: [],
      }
      for (const gw of gateways) gwByPace[gw.pace].push(gw)

      const columnOverride: Record<GatewayPace, boolean> = {
        primary: isTierOverridden(gwByPace.primary),
        alternate: isTierOverridden(gwByPace.alternate),
        contingency: isTierOverridden(gwByPace.contingency),
        emergency: isTierOverridden(gwByPace.emergency),
      }

      const hasPace = (s: Service) => (s.enabled_pace ?? []).length > 0
      const byOrder = (a: Service, b: Service) =>
        a.display_order - b.display_order || a.name.localeCompare(b.name)

      const corePace = services
        .filter((s) => s.category === "critical" && hasPace(s))
        .sort(byOrder)
      const coreLocal = services
        .filter((s) => s.category === "critical" && !hasPace(s))
        .sort(byOrder)
      const sustainment = services
        .filter((s) => s.category !== "critical")
        .sort(byOrder)

      const siteId = services[0]?.site_id ?? gateways[0]?.site_id ?? 0

      return {
        corePace,
        coreLocal,
        sustainment,
        gwByPace,
        columnOverride,
        siteId,
      }
    }, [services, gateways])

  const totalCount = corePace.length + coreLocal.length + sustainment.length

  return (
    <div className="flex flex-col gap-6">
      {corePace.length > 0 && (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="h-8 gap-1.5">
                  <Settings2 className="size-3.5" />
                  Density
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Cell detail</DropdownMenuLabel>
                {DENSITY_OPTIONS.map((o) => (
                  <DropdownMenuCheckboxItem
                    key={o.value}
                    checked={density === o.value}
                    onCheckedChange={(v) => v && setDensity(o.value)}
                  >
                    {o.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {corePace.length > 0 && (
        <MatrixGridSection
          title="Core Services"
          services={corePace}
          gwByPace={gwByPace}
          columnOverride={columnOverride}
          density={density}
          siteId={siteId}
        />
      )}
      {coreLocal.length > 0 && (
        <CompactServiceGrid
          services={coreLocal}
          label="Local-Only Services"
          note={
            corePace.length > 0 ? "not routed through a PACE tier" : undefined
          }
        />
      )}
      {sustainment.length > 0 && (
        <CompactServiceGrid services={sustainment} label="Sustainment" />
      )}
      {totalCount === 0 && (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          No services on this site yet.
        </div>
      )}
    </div>
  )
}

interface SectionProps {
  title: string
  services: Service[]
  gwByPace: Record<GatewayPace, Gateway[]>
  columnOverride: Record<GatewayPace, boolean>
  density: Density
  siteId: number
}

/** CSS-grid layout replaces the old `<table>` — each cell renders as its own
 *  tile with borders, tints and padding, so the matrix reads as a collection
 *  of "views" rather than a beige spreadsheet. Column tracks are defined at
 *  the section level so tiles align vertically across services. */
function MatrixGridSection({
  title,
  services,
  gwByPace,
  columnOverride,
  density,
  siteId,
}: SectionProps) {
  const [hover, setHover] = useState<{
    col: number | null
    row: number | null
  }>({ col: null, row: null })

  const handleMouseOver = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest("[data-col]")
    if (!target) return
    const col = Number(target.getAttribute("data-col") ?? "")
    const row = Number(target.getAttribute("data-row") ?? "")
    setHover({
      col: Number.isFinite(col) ? col : null,
      row: Number.isFinite(row) ? row : null,
    })
  }

  // Column tracks: Service | Local | 4× PACE (empty tiers collapse to 92px).
  const gridTemplateColumns = useMemo(() => {
    const paceTracks = GATEWAY_PACE_VALUES.map((p) =>
      gwByPace[p].length === 0 ? "92px" : "minmax(180px, 1fr)",
    ).join(" ")
    return `200px 110px ${paceTracks}`
  }, [gwByPace])

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      <div className="rounded-lg border border-border bg-muted/50">
        <div className="overflow-x-auto">
          <div
            onMouseOver={handleMouseOver}
            onMouseLeave={() => setHover({ col: null, row: null })}
            className="grid gap-1.5 p-3"
            style={{ gridTemplateColumns }}
          >
            {/* Header row */}
            <ColumnHeaderLabel
              label="Service"
              col={0}
              hoveredCol={hover.col}
            />
            <ColumnHeaderLabel
              label="Available Locally"
              col={1}
              hoveredCol={hover.col}
            />
            {GATEWAY_PACE_VALUES.map((p, i) => (
              <PaceColumnHeader
                key={p}
                pace={p}
                gateways={gwByPace[p]}
                overridden={columnOverride[p]}
                siteId={siteId}
                col={i + 2}
                hoveredCol={hover.col}
              />
            ))}

            {/* Service rows — 6 tiles per service, plain siblings under the
             *  grid so column tracks stay aligned across rows. */}
            {services.map((svc, rowIdx) => (
              <Fragment key={svc.id}>
                <IdentityTile
                  service={svc}
                  row={rowIdx}
                  col={0}
                  hover={hover}
                />
                <LocalTile
                  service={svc}
                  density={density}
                  row={rowIdx}
                  col={1}
                  hover={hover}
                />
                {GATEWAY_PACE_VALUES.map((p, i) => (
                  <PaceTile
                    key={p}
                    service={svc}
                    pace={p}
                    tierGateways={gwByPace[p]}
                    tierOverride={columnOverride[p]}
                    density={density}
                    row={rowIdx}
                    col={i + 2}
                    hover={hover}
                  />
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------------- Header tiles ---------------- */

function ColumnHeaderLabel({
  label,
  col,
  hoveredCol,
}: {
  label: string
  col: number
  hoveredCol: number | null
}) {
  return (
    <div
      data-col={col}
      className={cn(
        "flex items-end px-2 pb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground",
        hoveredCol === col && "text-foreground",
      )}
    >
      {label}
    </div>
  )
}

interface PaceHeaderProps {
  pace: GatewayPace
  gateways: Gateway[]
  overridden: boolean
  siteId: number
  col: number
  hoveredCol: number | null
}

function PaceColumnHeader({
  pace,
  gateways,
  overridden,
  siteId,
  col,
  hoveredCol,
}: PaceHeaderProps) {
  const empty = gateways.length === 0
  const softBg = paceSoftBg(pace)
  const letterFg = paceLetterColor(pace)
  return (
    <div
      data-col={col}
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-border bg-background",
        overridden && "border-red-500/40",
        hoveredCol === col && "ring-2 ring-inset ring-sky-500/40",
      )}
    >
      <div
        className={cn(
          "flex h-8 items-center gap-2 border-b border-border px-3",
          softBg,
        )}
      >
        <span
          className={cn("text-lg font-bold leading-none", letterFg)}
          title={paceLabel(pace)}
        >
          {paceShort(pace)}
        </span>
        {overridden && (
          <span className="ml-auto rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-red-700 dark:text-red-300">
            Tier offline
          </span>
        )}
      </div>
      {empty && (
        <div className="flex items-center justify-center px-3 py-3">
          <GatewayForm
            siteId={siteId}
            defaultPace={pace}
            renderTrigger={
              <button
                type="button"
                title={`Add a ${paceLabel(pace)} gateway`}
                className="inline-flex items-center gap-1 rounded border border-dashed border-border bg-background px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground hover:border-foreground/40 hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-3" />
                Add
              </button>
            }
          />
        </div>
      )}
      {!empty && (
        <ul className="flex flex-col divide-y divide-border/60">
          {gateways.map((gw) => {
            const Icon = gatewayIcon(gw.kind)
            return (
              <li
                key={gw.id}
                className="flex flex-col gap-1 px-3 py-2"
              >
                <GatewayForm
                  siteId={siteId}
                  gateway={gw}
                  renderTrigger={
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left text-foreground hover:bg-accent"
                      title={`Edit ${gw.name}`}
                    >
                      <Icon className="size-5 shrink-0 text-amber-700 dark:text-amber-400" />
                      <span className="truncate text-sm font-medium">
                        {gw.name}
                      </span>
                    </button>
                  }
                />
                <div className="pl-1">
                  <GatewayStatusPill
                    gatewayId={gw.id}
                    gatewayName={gw.name}
                    status={gw.status}
                    lastValidatedAt={gw.validated_at}
                    lastValidatedBy={gw.validated_by_username}
                    className={CELL_PILL_CLASS}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ---------------- Row tiles ---------------- */

type Hover = { col: number | null; row: number | null }

const BASE_TILE_CLASS = "rounded-md border border-border transition-colors"

/** Tile with real data. Row-or-column hover swaps the tile's border to
 *  sky-blue so the crosshair reads across the section without washing out
 *  the status tint. At the intersection the border tightens and the tile's
 *  own status color is EMPHASIZED via a strong tint — the focus reads as
 *  "this cell", coloured by its state. */
function activeTileClass(
  row: number,
  col: number,
  hover: Hover,
  softTint: string,
  emphasisTint: string,
) {
  const inRow = hover.row === row
  const inCol = hover.col === col
  const intersect = inRow && inCol
  let bg = softTint
  let border = "border-border"
  if (intersect) {
    bg = emphasisTint
    border = "border-sky-500"
  } else if (inRow || inCol) {
    border = "border-sky-500/50"
  }
  return cn("rounded-md border transition-colors", bg, border)
}

function IdentityTile({
  service,
  row,
  col,
  hover,
}: {
  service: Service
  row: number
  col: number
  hover: Hover
}) {
  const Icon = serviceIcon(service.icon, service.kind)
  const { w } = useWorkspace()
  const reachInfo = reachTypeFor(service)
  const localOverride = isLocalOverridden(service)
  return (
    <div
      data-col={col}
      data-row={row}
      className={cn(
        activeTileClass(row, col, hover, "", ""),
        "flex items-center gap-2 px-3 py-2",
        localOverride && "bg-red-500/5",
      )}
    >
      <a
        href={w(`/services/${service.id}`)}
        className="flex min-w-0 items-center gap-2 hover:underline"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{service.name}</span>
      </a>
      {reachInfo && (
        <span
          title={`${reachInfo.label} — ${reachInfo.tooltip}`}
          aria-label={reachInfo.label}
          className={cn(
            "ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded border",
            reachInfo.className,
          )}
        >
          <reachInfo.Icon className="size-2.5" />
        </span>
      )}
    </div>
  )
}

function reachTypeFor(service: Service) {
  const hasPace = (service.enabled_pace ?? []).length > 0
  if (service.reach === "external") {
    return {
      label: "Remote",
      tooltip: "Externally provided — this service lives off-site.",
      Icon: ArrowDownToLine,
      className:
        "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    }
  }
  if (service.reach === "local" && hasPace) {
    return {
      label: "Extends",
      tooltip: "Local service extended outward through a gateway.",
      Icon: ArrowUpFromLine,
      className:
        "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    }
  }
  return null
}

function LocalTile({
  service,
  density,
  row,
  col,
  hover,
}: {
  service: Service
  density: Density
  row: number
  col: number
  hover: Hover
}) {
  const softTint =
    density === "min"
      ? tileTintStrong(service.status)
      : tileTintSoft(service.status)
  const emphasisTint = tileTintStrong(service.status)
  return (
    <div
      data-col={col}
      data-row={row}
      className={cn(
        activeTileClass(row, col, hover, softTint, emphasisTint),
        "px-2 py-2",
      )}
    >
      {density === "min" ? (
        <div className="flex justify-center">
          <ServiceStatusPill
            serviceId={service.id}
            serviceName={service.name}
            status={service.status}
            lastValidatedAt={service.validated_at}
            lastValidatedBy={service.validated_by_username}
            allowedStatuses={service.allowed_statuses}
            className={MIN_PILL_CLASS}
            indicatorSize="xl"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <ServiceStatusPill
            serviceId={service.id}
            serviceName={service.name}
            status={service.status}
            lastValidatedAt={service.validated_at}
            lastValidatedBy={service.validated_by_username}
            allowedStatuses={service.allowed_statuses}
            className={CELL_PILL_CLASS}
          />
          <span className="text-[10px] text-muted-foreground">
            {service.validated_at ? (
              <>
                validated <TimeAgo iso={service.validated_at} />
              </>
            ) : (
              <span className="italic">never validated</span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

function PaceTile({
  service,
  pace,
  tierGateways,
  tierOverride,
  density,
  row,
  col,
  hover,
}: {
  service: Service
  pace: GatewayPace
  tierGateways: Gateway[]
  tierOverride: boolean
  density: Density
  row: number
  col: number
  hover: Hover
}) {
  const enabled = (service.enabled_pace ?? []).includes(pace)
  const localOverride = isLocalOverridden(service)
  const tierHasGateway = tierGateways.length > 0

  // Not enabled OR no gateway on the tier → no cell chrome at all. Just a
  // centered dash sitting on the card's muted background. Hovering still
  // updates the section's hover state so nearby live tiles react, but this
  // cell has no border, tint, or hover response of its own.
  if (!enabled || !tierHasGateway) {
    return (
      <div
        data-col={col}
        data-row={row}
        className="flex items-center justify-center text-muted-foreground/40"
      >
        {CELL_DASH}
      </div>
    )
  }

  // Overridden (tier down or local down) → red "Unavailable" state.
  if (tierOverride || localOverride) {
    const softDown = tierOverride ? "bg-red-500/5" : ""
    if (density === "min") {
      return (
        <div
          data-col={col}
          data-row={row}
          className={cn(
            activeTileClass(
              row,
              col,
              hover,
              tileTintStrong("down"),
              tileTintStrong("down"),
            ),
            "flex items-center justify-center px-2 py-2",
          )}
          title={
            localOverride
              ? "Service down — no path via this tier"
              : "Tier offline"
          }
        >
          <span className="inline-flex size-8 items-center justify-center rounded-full border border-red-500/50">
            <StatusIndicator state="down" size="xl" />
          </span>
        </div>
      )
    }
    return (
      <div
        data-col={col}
        data-row={row}
        className={cn(
          activeTileClass(row, col, hover, softDown, tileTintStrong("down")),
          "flex flex-col gap-0.5 px-2 py-2",
        )}
      >
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-red-700 dark:text-red-300">
          <StatusIndicator state="down" size="sm" />
          Unavailable
        </span>
        <span className="text-[10px] text-muted-foreground">
          {localOverride ? "service down" : "tier offline"}
        </span>
      </div>
    )
  }

  // Per-(service × gateway) cell state — the tile shows the best cell for
  // this tier (there can be more than one gateway per PACE). Effective
  // status already reflects R10/R11 from the backend, so we can render it
  // directly.
  const best = bestCellForTier(service, tierGateways)
  const cellStored: ServiceStatus = best ? best.cell.status : "unknown"
  const cellEffective: ServiceStatus = best
    ? best.cell.effective_status
    : "unknown"
  const softTint =
    density === "min"
      ? tileTintStrong(cellEffective)
      : tileTintSoft(cellEffective)
  const emphasisTint = tileTintStrong(cellEffective)

  return (
    <div
      data-col={col}
      data-row={row}
      className={cn(
        activeTileClass(row, col, hover, softTint, emphasisTint),
        "px-2 py-2",
      )}
    >
      {best === null ? (
        // Backwards-compat: cell not yet materialized on the server.
        // Fall back to a plain dash so the tile still fits the grid.
        <div className="flex items-center justify-center text-muted-foreground/40">
          {CELL_DASH}
        </div>
      ) : density === "min" ? (
        <div className="flex justify-center">
          <MatrixCellPill
            serviceId={service.id}
            serviceName={service.name}
            gatewayId={best.gateway.id}
            gatewayName={best.gateway.name}
            status={cellStored}
            effectiveStatus={cellEffective}
            lastValidatedAt={best.cell.validated_at}
            lastValidatedBy={best.cell.validated_by_username}
            allowedStatuses={service.allowed_statuses}
            className={MIN_PILL_CLASS}
            indicatorSize="xl"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <MatrixCellPill
            serviceId={service.id}
            serviceName={service.name}
            gatewayId={best.gateway.id}
            gatewayName={best.gateway.name}
            status={cellStored}
            effectiveStatus={cellEffective}
            lastValidatedAt={best.cell.validated_at}
            lastValidatedBy={best.cell.validated_by_username}
            allowedStatuses={service.allowed_statuses}
            className={CELL_PILL_CLASS}
          />
          <span className="text-[10px] text-muted-foreground">
            {best.cell.validated_at ? (
              <>
                validated <TimeAgo iso={best.cell.validated_at} />
              </>
            ) : (
              <span className="italic">never validated</span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

/* ---------------- Bottom sections ---------------- */

function CompactServiceGrid({
  services,
  label,
  note,
}: {
  services: Service[]
  label: string
  note?: string
}) {
  const { w } = useWorkspace()
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </h2>
        {note && (
          <span className="text-[10px] normal-case text-muted-foreground/70">
            {note}
          </span>
        )}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => {
          const Icon = serviceIcon(s.icon, s.kind)
          return (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-3 py-2"
            >
              <StatusIndicator
                state={statusToIndicatorState(s.status)}
                size="sm"
              />
              <a
                href={w(`/services/${s.id}`)}
                className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">{s.name}</span>
              </a>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {categoryLabel(s.category)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
