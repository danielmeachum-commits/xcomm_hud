"use client"

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  MapPin,
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
  gatewayKindLabel,
  paceLabel,
  paceShort,
  serviceIcon,
} from "@/lib/service-meta"
import { statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type {
  AnyStatus,
  CellStatus,
  Gateway,
  GatewayPace,
  GatewayStatus,
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
/** In minimum / collapsed mode the pill renders as a fixed 32px circular
 *  button so every status has a visible click target (not just Unavailable,
 *  which had its own manual circle). Direct-child spans are hidden so the
 *  label + cascade tag drop out, but StatusIndicator's own dot span
 *  (a grandchild) stays visible — the earlier `[&_span]:hidden` (descendant
 *  combinator) was killing the dot itself. Combined with `indicatorSize="xl"`
 *  the dot is 24px, filling the circle. */
const MIN_PILL_CLASS =
  "!inline-flex !size-8 !items-center !justify-center !gap-0 !rounded-full !border !border-border/60 !bg-background/60 !p-0 [&>span]:hidden"

/** Ambient tile background matching effective status. Bumped to ~15% so
 *  tinted tiles read clearly against the muted card wrapper; unknown falls
 *  back to `bg-background` so those tiles still visually separate from the
 *  darker card. Must handle the same status set as tileTintStrong — R9
 *  cascade can flip cells to `ready` and R11 can push them to `setup` or
 *  `offline`, and those tiles need to reflect the change even in full
 *  density mode, not just in the collapsed dot-only view. */
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
    case "offline":
      return "bg-slate-500/15"
    case "ready":
    case "setup":
      return "bg-sky-500/10"
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

/** Muted PACE header background — the previous /10–/15 opacities were
 *  visually rhyming with status tints in the tile bodies below (emerald =
 *  "up", amber = "degraded", red = "down"). Pushed down to /5 so the tier
 *  is still color-hinted but no longer competes with cell status. */
function paceSoftBg(p: GatewayPace): string {
  switch (p) {
    case "primary":
      return "bg-emerald-500/5"
    case "alternate":
      return "bg-sky-500/5"
    case "contingency":
      return "bg-amber-500/5"
    case "emergency":
      return "bg-red-500/5"
  }
}

/** Letter color for the PACE header — desaturated from the prior 700/300
 *  pair so it reads as "tinted" rather than "loud status color". Keeps the
 *  convention (emerald=primary, red=emergency) recognizable at a glance
 *  without hijacking the status-tint vocabulary. */
function paceLetterColor(p: GatewayPace): string {
  switch (p) {
    case "primary":
      return "text-emerald-800/70 dark:text-emerald-300/75"
    case "alternate":
      return "text-sky-800/70 dark:text-sky-300/75"
    case "contingency":
      return "text-amber-800/70 dark:text-amber-300/75"
    case "emergency":
      return "text-red-800/70 dark:text-red-300/75"
  }
}

/** Style for the gateway → PACE connection line. Operational states with
 *  active data flow (`active`, `degraded`) use marching-ants dashes that
 *  animate toward the gateway end of the line — visualizing "data flowing
 *  out from the service". Non-flowing states are static: solid for ready,
 *  dashed for setup/down, dotted for offline. */
function gatewayLineStyle(status: GatewayStatus): {
  stroke: string
  strokeWidth: number
  strokeDasharray?: string
  className?: string
} {
  switch (status) {
    case "active":
      return {
        stroke: "rgb(16 185 129)",
        strokeWidth: 2.5,
        strokeDasharray: "8 6",
        className: "gateway-line-flow",
      }
    case "degraded":
      return {
        stroke: "rgb(245 158 11)",
        strokeWidth: 2.5,
        strokeDasharray: "8 6",
        className: "gateway-line-flow-slow",
      }
    case "ready":
      return { stroke: "rgb(14 165 233)", strokeWidth: 2 }
    case "setup":
      return {
        stroke: "rgb(14 165 233)",
        strokeWidth: 2,
        strokeDasharray: "4 3",
      }
    case "down":
      return {
        stroke: "rgb(239 68 68)",
        strokeWidth: 2,
        strokeDasharray: "6 3",
      }
    case "offline":
      return {
        stroke: "rgb(100 116 139)",
        strokeWidth: 1.5,
        strokeDasharray: "2 3",
      }
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

/** A tier is on "standby" when it has at least one `ready` gateway and no
 *  gateways in an active-serving state (`active`, `degraded`, `setup`).
 *  The path is available in principle but not currently primary — cells
 *  should not read as "up" for that tier. Down/offline gateways don't
 *  block this classification; they just don't contribute. If the tier is
 *  entirely down/offline, `isTierOverridden` fires first and takes
 *  precedence. */
function isTierStandby(gws: Gateway[]): boolean {
  if (gws.length === 0) return false
  const anyServing = gws.some(
    (g) =>
      g.status === "active" || g.status === "degraded" || g.status === "setup",
  )
  const anyReady = gws.some((g) => g.status === "ready")
  return !anyServing && anyReady
}

/** Pick the tier's headline gateway status — best-of-many, prioritised for
 *  "what's the operational reality right now?". `null` when the tier has
 *  no gateway at all. Used to seed the status dot inside the PACE port at
 *  the top of each services-card column. */
function tierAggregateStatus(gws: Gateway[]): GatewayStatus | null {
  if (gws.length === 0) return null
  const priority: GatewayStatus[] = [
    "active",
    "degraded",
    "ready",
    "setup",
    "down",
    "offline",
  ]
  for (const s of priority) {
    if (gws.some((g) => g.status === s)) return s
  }
  return gws[0].status
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

  const {
    corePace,
    coreLocal,
    sustainment,
    gwByPace,
    columnOverride,
    columnStandby,
    siteId,
  } = useMemo(() => {
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
    const columnStandby: Record<GatewayPace, boolean> = {
      primary: isTierStandby(gwByPace.primary),
      alternate: isTierStandby(gwByPace.alternate),
      contingency: isTierStandby(gwByPace.contingency),
      emergency: isTierStandby(gwByPace.emergency),
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
      columnStandby,
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
          title="Gateways"
          services={corePace}
          gwByPace={gwByPace}
          columnOverride={columnOverride}
          columnStandby={columnStandby}
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
  columnStandby: Record<GatewayPace, boolean>
  density: Density
  siteId: number
}

interface GatewayLine {
  gatewayId: number
  x1: number
  y1: number
  x2: number
  y2: number
  status: GatewayStatus
}

/** Two-card layout: a gateway band up top, then the services grid below, with
 *  an SVG overlay drawing static lines from each gateway card down to its
 *  PACE column header. Both cards use the same gridTemplateColumns so PACE
 *  columns align without any manual positioning. */
type ColumnKey = "local" | GatewayPace

const ALL_COLUMN_KEYS: ColumnKey[] = ["local", ...GATEWAY_PACE_VALUES]

const COLLAPSED_TRACK = "72px"
const LOCAL_TRACK = "110px"
const PACE_TRACK = "minmax(180px, 1fr)"
const COLUMN_TRANSITION_MS = 220

const DEFAULT_COLLAPSED: Record<ColumnKey, boolean> = Object.fromEntries(
  ALL_COLUMN_KEYS.map((k) => [k, false]),
) as Record<ColumnKey, boolean>

/** localStorage key for a site's per-column collapsed state. The layout
 *  preference travels with the site, not the user's session — each site
 *  can have its own "which columns matter" layout persisted. */
function collapsedStorageKey(siteId: number): string {
  return `xcomm.matrix.collapsed.site.${siteId}`
}

function MatrixGridSection({
  title,
  services,
  gwByPace,
  columnOverride,
  columnStandby,
  density,
  siteId,
}: SectionProps) {
  const [hover, setHover] = useState<{
    col: number | null
    row: number | null
  }>({ col: null, row: null })

  const [collapsed, setCollapsed] =
    useState<Record<ColumnKey, boolean>>(DEFAULT_COLLAPSED)

  // Latest snapshot of tier state so the mount effect can auto-collapse
  // dead/empty tiers without depending on gwByPace/columnOverride (which
  // would re-fire and clobber user intent every time a gateway status
  // changes). Refs are updated on every render.
  const gwByPaceRef = useRef(gwByPace)
  gwByPaceRef.current = gwByPace
  const columnOverrideRef = useRef(columnOverride)
  columnOverrideRef.current = columnOverride

  // Set to true only after a user-initiated toggle. Keeps the save effect
  // from persisting the auto-computed default — that way, if the operator
  // never touches the columns and their tier situation changes across
  // sessions (offline gateway comes back online), auto-collapse can
  // re-evaluate at the next mount instead of freezing yesterday's guess.
  const hasUserModifiedRef = useRef(false)

  // Load persisted state on mount. Kept out of useState initializer so
  // server- and client-side initial renders agree (avoids hydration
  // mismatch). The brief default-then-loaded transition also gets absorbed
  // by the grid's CSS transition, so it reads as an intentional reveal.
  const storageKey = collapsedStorageKey(siteId)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<ColumnKey, boolean>>
        setCollapsed({ ...DEFAULT_COLLAPSED, ...parsed })
        return
      }
    } catch {
      /* corrupt entry — fall through to auto-collapse */
    }
    // No saved preference — auto-collapse empty tiers and tiers whose
    // gateways are all offline/down. Local column stays expanded (it's
    // the operator's primary anchor). Standby tiers stay expanded too —
    // they're a real state operators want to see, not dead weight.
    const gws = gwByPaceRef.current
    const overrides = columnOverrideRef.current
    const auto: Record<ColumnKey, boolean> = { ...DEFAULT_COLLAPSED }
    for (const p of GATEWAY_PACE_VALUES) {
      if (gws[p].length === 0 || overrides[p]) {
        auto[p] = true
      }
    }
    setCollapsed(auto)
  }, [storageKey])

  useEffect(() => {
    if (!hasUserModifiedRef.current) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(collapsed))
    } catch {
      /* quota / disabled storage — nothing to do */
    }
  }, [collapsed, storageKey])

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

  // Column tracks: Service | Local | (gutter) | 4× PACE. Collapsed columns
  // shrink to a fixed narrow track so the tile shows just its status dot;
  // the gutter track always sits between Local and the PACE group so the
  // two read as distinct reachability columns.
  const gridTemplateColumns = useMemo(() => {
    const localTrack = collapsed.local ? COLLAPSED_TRACK : LOCAL_TRACK
    const paceTracks = GATEWAY_PACE_VALUES.map((p) =>
      collapsed[p] ? COLLAPSED_TRACK : PACE_TRACK,
    ).join(" ")
    return `200px ${localTrack} 16px ${paceTracks}`
  }, [collapsed])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const gatewayRefs = useRef(new Map<number, HTMLDivElement | null>())
  const paceHeaderRefs = useRef(new Map<GatewayPace, HTMLElement | null>())
  const [lines, setLines] = useState<GatewayLine[]>([])
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 })

  const registerGateway = useCallback(
    (id: number, el: HTMLDivElement | null) => {
      if (el) gatewayRefs.current.set(id, el)
      else gatewayRefs.current.delete(id)
    },
    [],
  )
  const registerPaceHeader = useCallback(
    (pace: GatewayPace, el: HTMLElement | null) => {
      if (el) paceHeaderRefs.current.set(pace, el)
      else paceHeaderRefs.current.delete(pace)
    },
    [],
  )

  const recomputeLines = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    setOverlaySize({
      width: container.scrollWidth,
      height: container.scrollHeight,
    })

    const next: GatewayLine[] = []
    for (const pace of GATEWAY_PACE_VALUES) {
      const headerEl = paceHeaderRefs.current.get(pace)
      if (!headerEl) continue
      const headerRect = headerEl.getBoundingClientRect()
      const x2 = headerRect.left + headerRect.width / 2 - containerRect.left
      const y2 = headerRect.top - containerRect.top

      for (const gw of gwByPace[pace]) {
        const gwEl = gatewayRefs.current.get(gw.id)
        if (!gwEl) continue
        const gwRect = gwEl.getBoundingClientRect()
        const x1 = gwRect.left + gwRect.width / 2 - containerRect.left
        const y1 = gwRect.bottom - containerRect.top
        next.push({ gatewayId: gw.id, x1, y1, x2, y2, status: gw.status })
      }
    }
    setLines(next)
  }, [gwByPace])

  useLayoutEffect(() => {
    recomputeLines()
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => recomputeLines())
    ro.observe(container)
    return () => ro.disconnect()
  }, [recomputeLines])

  useEffect(() => {
    const onResize = () => recomputeLines()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [recomputeLines])

  // rAF loop that follows a CSS grid-template-columns transition. Container
  // size doesn't change during a track-width transition, so ResizeObserver
  // on the container alone doesn't fire — we drive line updates manually
  // for the transition's duration so the connectors track the collapsing
  // header smoothly instead of snapping at the end.
  const trackTransition = useCallback(
    (durationMs: number) => {
      const startTime = performance.now()
      const tick = (now: number) => {
        recomputeLines()
        if (now - startTime < durationMs + 40) {
          requestAnimationFrame(tick)
        }
      }
      requestAnimationFrame(tick)
    },
    [recomputeLines],
  )

  const toggleColumn = useCallback(
    (key: ColumnKey) => {
      hasUserModifiedRef.current = true
      setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
      trackTransition(COLUMN_TRANSITION_MS)
    },
    [trackTransition],
  )

  const anyExpanded = ALL_COLUMN_KEYS.some((k) => !collapsed[k])
  const toggleAll = useCallback(() => {
    hasUserModifiedRef.current = true
    setCollapsed(
      Object.fromEntries(
        ALL_COLUMN_KEYS.map((k) => [k, anyExpanded]),
      ) as Record<ColumnKey, boolean>,
    )
    trackTransition(COLUMN_TRANSITION_MS)
  }, [anyExpanded, trackTransition])

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={toggleAll}
        >
          {anyExpanded ? "Collapse all" : "Expand all"}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <div
          ref={containerRef}
          className="relative flex min-w-fit flex-col gap-2"
        >
          {/* --- PACE header row (no card wrapper — reads as a floating
           *  organizational label above the gateway card). Horizontal
           *  padding matches the p-3 on the gateway / services cards so
           *  each PACE pill lines up exactly over the gateway card and
           *  the services port + tiles in the same column below. */}
          <div
            className="grid gap-1.5 px-3 transition-[grid-template-columns] duration-200 ease-out"
            style={{ gridTemplateColumns }}
          >
            <div />
            <div />
            <div />
            {GATEWAY_PACE_VALUES.map((p, i) => (
              <PaceHeaderLabel
                key={p}
                pace={p}
                overridden={columnOverride[p]}
                standby={columnStandby[p]}
                col={i + 3}
                hoveredCol={hover.col}
                collapsed={collapsed[p]}
                onToggle={() => toggleColumn(p)}
              />
            ))}
          </div>

          {/* --- Gateways card (label sits directly above like Core Services) --- */}
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {title}
          </h3>
          <div className="rounded-lg border border-border bg-muted/50 p-3">
            <div
              className="grid gap-1.5 transition-[grid-template-columns] duration-200 ease-out"
              style={{ gridTemplateColumns }}
            >
              <div />
              <div />
              <div />
              {GATEWAY_PACE_VALUES.map((p) => (
                <GatewayColumnStack
                  key={p}
                  pace={p}
                  gateways={gwByPace[p]}
                  overridden={columnOverride[p]}
                  siteId={siteId}
                  registerRef={registerGateway}
                  collapsed={collapsed[p]}
                />
              ))}
            </div>
          </div>

          {/* --- SVG overlay: gateway → PACE-header connectors --- */}
          <svg
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-10"
            width={overlaySize.width}
            height={overlaySize.height}
          >
            {lines.map((line) => {
              const style = gatewayLineStyle(line.status)
              return (
                <line
                  key={line.gatewayId}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={style.stroke}
                  strokeWidth={style.strokeWidth}
                  strokeDasharray={style.strokeDasharray}
                  strokeLinecap="round"
                  className={style.className}
                />
              )
            })}
          </svg>

          {/* --- Services card --- */}
          <h3 className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Core Services
          </h3>
          <div className="rounded-lg border border-border bg-muted/50">
            <div
              onMouseOver={handleMouseOver}
              onMouseLeave={() => setHover({ col: null, row: null })}
              className="grid gap-1.5 p-3 transition-[grid-template-columns] duration-200 ease-out"
              style={{ gridTemplateColumns }}
            >
              {/* Header row */}
              <ColumnHeaderLabel
                label="Service"
                col={0}
                hoveredCol={hover.col}
              />
              <LocalHeaderPill
                col={1}
                hoveredCol={hover.col}
                collapsed={collapsed.local}
                onToggle={() => toggleColumn("local")}
              />
              <div />
              {GATEWAY_PACE_VALUES.map((p, i) => (
                <PaceColumnSentinel
                  key={p}
                  pace={p}
                  col={i + 3}
                  status={tierAggregateStatus(gwByPace[p])}
                  registerRef={registerPaceHeader}
                />
              ))}

              {/* Service rows */}
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
                    dotOnly={collapsed.local || density === "min"}
                    density={density}
                    row={rowIdx}
                    col={1}
                    hover={hover}
                  />
                  <div />
                  {GATEWAY_PACE_VALUES.map((p, i) => (
                    <PaceTile
                      key={p}
                      service={svc}
                      pace={p}
                      tierGateways={gwByPace[p]}
                      tierOverride={columnOverride[p]}
                      tierStandby={columnStandby[p]}
                      dotOnly={collapsed[p] || density === "min"}
                      density={density}
                      row={rowIdx}
                      col={i + 3}
                      hover={hover}
                    />
                  ))}
                </Fragment>
              ))}
            </div>
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
  // The col=0 "Service" header is sticky-pinned so it stays visible when the
  // matrix is scrolled horizontally. The solid bg-background hides scrolled
  // PACE-tile content sliding under it; the border-r signals the boundary.
  const isServiceCol = col === 0
  return (
    <div
      data-col={col}
      className={cn(
        "flex items-end px-2 pb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground",
        hoveredCol === col && "text-foreground",
        isServiceCol && "sticky left-0 z-20 bg-background border-r border-border/60",
      )}
    >
      {label}
    </div>
  )
}

/** Header pill for the local-availability column. Visually parallels
 *  PaceHeaderLabel (same bordered-pill footprint so the header row reads
 *  as a row of labeled reachability columns) but uses a neutral slate
 *  palette and a MapPin icon to signal "this question is about the site
 *  itself, not a PACE tier". */
function LocalHeaderPill({
  col,
  hoveredCol,
  collapsed,
  onToggle,
}: {
  col: number
  hoveredCol: number | null
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      data-col={col}
      onClick={onToggle}
      title={`${collapsed ? "Expand" : "Collapse"} On Site column`}
      className={cn(
        "flex h-9 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-md border border-border bg-slate-500/10 transition-colors hover:bg-slate-500/20",
        hoveredCol === col && "ring-2 ring-inset ring-sky-500/40",
      )}
    >
      <MapPin className="size-3.5 shrink-0 text-slate-700 dark:text-slate-300" />
      {!collapsed && (
        <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-700 dark:text-slate-300">
          On Site
        </span>
      )}
    </button>
  )
}

/** Compact PACE column header — just the letter, label, and tier-offline
 *  badge. Gateway details live in the band above, connected by the SVG
 *  overlay. `registerRef` lets the section measure the header center so the
 *  overlay can aim its lines here. */
/** Colored "port" landing pad for the SVG connector lines at the top of
 *  each PACE column in the services card. The labeled PaceHeaderLabel now
 *  lives above the gateway band, so lines terminate here instead. The port
 *  is a small pill the same muted tier color as the header pill above, so
 *  it reads as a natural transition from line → column below. Also
 *  registers the ref for line-terminal measurement and provides data-col
 *  so the crosshair still lights up. */
/** Landing pad for the SVG connector lines at the top of each PACE column
 *  in the services card. Styled to match LocalHeaderPill (bordered pill,
 *  muted tier bg) but instead of an icon/label it carries a status dot
 *  summarising the tier's aggregate state (best of active > degraded >
 *  ready > setup > down > offline). Same visual weight as the On Site pill
 *  so the services-card header row reads as a consistent set of column
 *  anchors. Registers a ref so the SVG geometry can measure the port's
 *  top-center for the line terminal. */
function PaceColumnSentinel({
  pace,
  col,
  status,
  registerRef,
}: {
  pace: GatewayPace
  col: number
  status: GatewayStatus | null
  registerRef: (pace: GatewayPace, el: HTMLElement | null) => void
}) {
  return (
    <div
      ref={(el) => registerRef(pace, el)}
      data-col={col}
      className="flex h-9 items-center justify-center"
      title={paceLabel(pace)}
      aria-hidden
    >
      {status && (
        <StatusIndicator
          state={statusToIndicatorState(status)}
          size="md"
        />
      )}
    </div>
  )
}

function PaceHeaderLabel({
  pace,
  overridden,
  standby,
  col,
  hoveredCol,
  collapsed,
  onToggle,
}: {
  pace: GatewayPace
  overridden: boolean
  standby: boolean
  col: number
  hoveredCol: number | null
  collapsed: boolean
  onToggle: () => void
}) {
  const softBg = paceSoftBg(pace)
  const letterFg = paceLetterColor(pace)
  return (
    <button
      type="button"
      data-col={col}
      onClick={onToggle}
      title={`${collapsed ? "Expand" : "Collapse"} ${paceLabel(pace)} column`}
      className={cn(
        "flex h-9 min-w-0 items-center justify-center gap-2 overflow-hidden rounded-md border border-border transition-colors hover:brightness-110",
        softBg,
        overridden && "border-red-500/50",
        !overridden && standby && "border-sky-500/50",
        hoveredCol === col && "ring-2 ring-inset ring-sky-500/40",
      )}
    >
      <span
        className={cn(
          "text-base font-bold leading-none shrink-0",
          letterFg,
        )}
        title={paceLabel(pace)}
      >
        {paceShort(pace)}
      </span>
      {!collapsed && (
        <span
          className={cn(
            "truncate text-[10px] font-semibold uppercase tracking-widest",
            letterFg,
          )}
        >
          {paceLabel(pace)}
        </span>
      )}
      {!collapsed && overridden && (
        <span className="ml-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-red-700 dark:text-red-300">
          Tier offline
        </span>
      )}
      {!collapsed && !overridden && standby && (
        <span className="ml-1 rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-sky-700 dark:text-sky-300">
          Standby
        </span>
      )}
    </button>
  )
}

/** Vertical stack of gateway cards inside a single PACE column of the
 *  gateway band. Empty tiers show an "Add gateway" placeholder in the same
 *  footprint so the column stays visually anchored. */
function GatewayColumnStack({
  pace,
  gateways,
  overridden,
  siteId,
  registerRef,
  collapsed,
}: {
  pace: GatewayPace
  gateways: Gateway[]
  overridden: boolean
  siteId: number
  registerRef: (id: number, el: HTMLDivElement | null) => void
  collapsed: boolean
}) {
  if (gateways.length === 0) {
    return (
      <div className="flex flex-col">
        <GatewayForm
          siteId={siteId}
          defaultPace={pace}
          renderTrigger={
            <button
              type="button"
              title={`Add a ${paceLabel(pace)} gateway`}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-background/40 text-[10px] font-medium uppercase tracking-widest text-muted-foreground hover:border-foreground/40 hover:bg-accent hover:text-foreground",
                collapsed ? "px-1 py-3" : "px-3 py-6",
              )}
            >
              <Plus className="size-4" />
              {!collapsed && "Add gateway"}
            </button>
          }
        />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {gateways.map((gw) => (
        <GatewayCard
          key={gw.id}
          gateway={gw}
          siteId={siteId}
          overridden={overridden}
          registerRef={registerRef}
          collapsed={collapsed}
        />
      ))}
    </div>
  )
}

function GatewayCard({
  gateway,
  siteId,
  overridden,
  registerRef,
  collapsed,
}: {
  gateway: Gateway
  siteId: number
  overridden: boolean
  registerRef: (id: number, el: HTMLDivElement | null) => void
  collapsed: boolean
}) {
  const Icon = gatewayIcon(gateway.kind)
  return (
    <div
      ref={(el) => registerRef(gateway.id, el)}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background shadow-sm",
        overridden && "border-red-500/50",
      )}
    >
      {/* Kind label sits at the top of the card as a subtle subheading; the
       *  PACE letter used to live here too but the tier is now labeled by
       *  the PACE header card above the gateway band. In collapsed mode
       *  the strip goes away entirely so the card compacts to icon+dot. */}
      {!collapsed && (
        <div className="border-b border-border/60 px-2 py-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
          {gatewayKindLabel(gateway.kind)}
        </div>
      )}
      <GatewayForm
        siteId={siteId}
        gateway={gateway}
        renderTrigger={
          <button
            type="button"
            className={cn(
              "flex min-w-0 items-center gap-2 text-left hover:bg-accent",
              collapsed ? "justify-center px-1 pt-2" : "px-2 pt-2",
            )}
            title={`Edit ${gateway.name}`}
          >
            <Icon className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
            {!collapsed && (
              <span className="truncate text-sm font-medium">
                {gateway.name}
              </span>
            )}
          </button>
        }
      />
      <div
        className={cn(
          "pb-2 pt-1",
          collapsed ? "flex justify-center px-1" : "px-2",
        )}
      >
        <GatewayStatusPill
          gatewayId={gateway.id}
          gatewayName={gateway.name}
          status={gateway.status}
          lastValidatedAt={gateway.validated_at}
          lastValidatedBy={gateway.validated_by_username}
          className={collapsed ? MIN_PILL_CLASS : CELL_PILL_CLASS}
          indicatorSize={collapsed ? "xl" : "sm"}
        />
      </div>
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
        // Sticky column: pinned to the scroll container's left edge so the
        // service identity always stays visible. Solid bg-background hides
        // PACE tiles that scroll under it; the right border marks the
        // boundary between the pinned column and the scrolling area. When
        // the service is locally overridden we signal it with a red left
        // border instead of a tint (transparent tints would let the
        // scrolled content bleed through the sticky bg).
        "sticky left-0 z-20 bg-background border-r border-border/60",
        localOverride && "border-l-2 border-l-red-500/60",
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
  dotOnly,
  row,
  col,
  hover,
}: {
  service: Service
  /** True when this column is collapsed OR density is min — collapses the
   *  tile to just the centered status dot regardless of the global density
   *  setting. */
  dotOnly: boolean
  density: Density
  row: number
  col: number
  hover: Hover
}) {
  const softTint = dotOnly
    ? tileTintStrong(service.status)
    : tileTintSoft(service.status)
  const emphasisTint = tileTintStrong(service.status)
  return (
    <div
      data-col={col}
      data-row={row}
      className={cn(
        activeTileClass(row, col, hover, softTint, emphasisTint),
        "min-w-0 px-2 py-2",
      )}
    >
      {dotOnly ? (
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
  tierStandby,
  dotOnly,
  row,
  col,
  hover,
}: {
  service: Service
  pace: GatewayPace
  tierGateways: Gateway[]
  tierOverride: boolean
  tierStandby: boolean
  /** True when this column is collapsed OR density is min — collapses the
   *  tile to just the centered status dot regardless of the global density
   *  setting. */
  dotOnly: boolean
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
        className="flex min-w-0 items-center justify-center text-muted-foreground/40"
      >
        {CELL_DASH}
      </div>
    )
  }

  // Tier is entirely standby — no gateway is actively serving, but at
  // least one is ready. The path exists but isn't currently eligible.
  // Precedence: tierOverride > tierStandby, so we render standby only when
  // the tier isn't overridden. Local override still takes precedence to
  // stay honest about a down local service.
  if (tierStandby && !tierOverride && !localOverride) {
    if (dotOnly) {
      return (
        <div
          data-col={col}
          data-row={row}
          className={cn(
            activeTileClass(
              row,
              col,
              hover,
              tileTintSoft("ready"),
              tileTintStrong("ready"),
            ),
            "flex min-w-0 items-center justify-center px-2 py-2",
          )}
          title="Tier on standby — gateway is ready but not active"
        >
          <StatusIndicator state="ready" size="xl" />
        </div>
      )
    }
    return (
      <div
        data-col={col}
        data-row={row}
        className={cn(
          activeTileClass(
            row,
            col,
            hover,
            tileTintSoft("ready"),
            tileTintStrong("ready"),
          ),
          "flex min-w-0 flex-col gap-0.5 px-2 py-2",
        )}
      >
        <span className="inline-flex w-fit items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-sky-700 dark:text-sky-300">
          <StatusIndicator state="ready" size="sm" />
          Standby
        </span>
        <span className="text-[10px] text-muted-foreground">
          gateway on standby
        </span>
      </div>
    )
  }

  // Overridden (tier down or local down) → red "Unavailable" state.
  if (tierOverride || localOverride) {
    const softDown = tierOverride ? "bg-red-500/5" : ""
    if (dotOnly) {
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
            "flex min-w-0 items-center justify-center px-2 py-2",
          )}
          title={
            localOverride
              ? "Service down — no path via this tier"
              : "Tier offline"
          }
        >
          <StatusIndicator state="down" size="xl" />
        </div>
      )
    }
    return (
      <div
        data-col={col}
        data-row={row}
        className={cn(
          activeTileClass(row, col, hover, softDown, tileTintStrong("down")),
          "flex min-w-0 flex-col gap-0.5 px-2 py-2",
        )}
      >
        <span className="inline-flex w-fit items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-red-700 dark:text-red-300">
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
  const cellStored: CellStatus = best ? best.cell.status : "unknown"
  const cellEffective: CellStatus = best
    ? best.cell.effective_status
    : "unknown"
  const softTint = dotOnly
    ? tileTintStrong(cellEffective)
    : tileTintSoft(cellEffective)
  const emphasisTint = tileTintStrong(cellEffective)

  return (
    <div
      data-col={col}
      data-row={row}
      className={cn(
        activeTileClass(row, col, hover, softTint, emphasisTint),
        "min-w-0 px-2 py-2",
      )}
    >
      {best === null ? (
        // Backwards-compat: cell not yet materialized on the server.
        // Fall back to a plain dash so the tile still fits the grid.
        <div className="flex items-center justify-center text-muted-foreground/40">
          {CELL_DASH}
        </div>
      ) : dotOnly ? (
        <div className="flex justify-center">
          <MatrixCellPill
            serviceId={service.id}
            serviceName={service.name}
            gatewayId={best.gateway.id}
            gatewayName={best.gateway.name}
            gatewayStatus={best.gateway.status}
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
            gatewayStatus={best.gateway.status}
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
