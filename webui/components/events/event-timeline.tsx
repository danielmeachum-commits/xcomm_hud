"use client"

import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"

import { LocalTime } from "@/components/time-display"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { REGISTRY_TYPE_LABELS } from "@/lib/event-type-labels"
import { eventTypeIcon } from "@/lib/event-type-meta"
import {
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  severityDotClass,
  severityPillClasses,
} from "@/lib/severity"
import { statusLabel } from "@/lib/status"
import { formatZulu } from "@/lib/time"
import { emconLabel, fpconLabel } from "@/lib/threat-level"
import { cn } from "@/lib/utils"
import type {
  Emcon,
  Event,
  EventTypeDef,
  Fpcon,
  Severity,
  SubjectKind,
} from "@/lib/types"

import {
  MultiSelectFilter,
  type MultiSelectOption,
} from "./multi-select-filter"

const SCOPE_LABELS: Partial<Record<SubjectKind, string>> = {
  workspace: "Workspace",
  site: "Site",
  site_status: "Site status",
  site_fpcon: "FPCON",
  site_emcon: "EMCON",
  team: "Team",
  unit: "Unit",
  work_center: "Work center",
  system: "System",
  mission: "Mission",
  exercise: "Exercise",
  service: "Service",
  gateway: "Gateway",
  service_gateway: "Cell",
  personnel_location: "Personnel",
}

const SEVERITY_OPTIONS: MultiSelectOption[] = SEVERITY_ORDER.map((s) => ({
  value: s,
  label: SEVERITY_LABELS[s],
}))

const FPCON_SET = new Set(["normal", "alpha", "bravo", "charlie", "delta"])
const EMCON_SET = new Set(["a", "b", "c", "d"])

function displayStatus(kind: SubjectKind, value: string): string {
  if (kind === "site_fpcon" && FPCON_SET.has(value)) {
    return `FPCON ${fpconLabel(value as Fpcon)}`
  }
  if (kind === "site_emcon" && EMCON_SET.has(value)) {
    return emconLabel(value as Emcon)
  }
  return statusLabel(value as Parameters<typeof statusLabel>[0])
}

/** Zulu day key + header label for group headers ("08 JUL 2026"). */
function zuluDay(iso: string): { key: string; label: string } {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, "0")
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
  const key = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const label = `${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  return { key, label }
}

interface Props {
  events: Event[]
  eventTypes: EventTypeDef[]
  /** Lock the timeline to one site (site detail tab) — hides the site filter. */
  siteId?: number
  pageSize?: number
  /** Where routine logs live relative to this timeline ("Audit" | "Table"). */
  logsView?: string
}

/** Vertical severity-coded timeline of `record_class === "event"` records
 *  with compound filters — the walkthrough view of how things unfolded. */
export function EventTimeline({
  events: initialEvents,
  eventTypes,
  siteId,
  pageSize = 100,
  logsView = "Audit",
}: Props) {
  // Older pages fetched on demand are kept separately so live refreshes of
  // the server-provided list don't drop them; merge dedupes by id.
  const [older, setOlder] = useState<Event[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set())
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set())
  const [siteFilter, setSiteFilter] = useState<Set<string>>(new Set())
  const [scopeFilter, setScopeFilter] = useState<Set<string>>(new Set())

  const typesBySlug = useMemo(() => {
    const m = new Map<string, EventTypeDef>()
    for (const t of eventTypes) m.set(t.slug, t)
    return m
  }, [eventTypes])

  const all = useMemo(() => {
    const seen = new Set<number>()
    const merged: Event[] = []
    for (const v of [...initialEvents, ...older]) {
      if (v.record_class !== "event" || v.hidden_at) continue
      if (siteId != null && v.site_id !== siteId) continue
      if (seen.has(v.id)) continue
      seen.add(v.id)
      merged.push(v)
    }
    merged.sort(
      (a, b) =>
        new Date(b.validated_at).getTime() - new Date(a.validated_at).getTime(),
    )
    return merged
  }, [initialEvents, older, siteId])

  const typeOptions: MultiSelectOption[] = useMemo(() => {
    const slugs = new Set<string>()
    for (const v of all) if (v.type_slug) slugs.add(v.type_slug)
    return Array.from(slugs)
      .map((slug) => ({
        value: slug,
        label: typesBySlug.get(slug)?.label ?? REGISTRY_TYPE_LABELS[slug] ?? slug,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [all, typesBySlug])

  const siteOptions: MultiSelectOption[] = useMemo(() => {
    const m = new Map<string, string>()
    for (const v of all) {
      if (v.site_id != null) m.set(String(v.site_id), v.site_name ?? `site ${v.site_id}`)
    }
    return Array.from(m.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }))
  }, [all])

  const scopeOptions: MultiSelectOption[] = useMemo(() => {
    const kinds = new Set<SubjectKind>()
    for (const v of all) kinds.add(v.subject_kind)
    return Array.from(kinds)
      .map((k) => ({ value: k, label: SCOPE_LABELS[k] ?? k }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [all])

  // How many routine (log-class) records the timeline is hiding — surfaced
  // in the count line so the event/log split stays discoverable.
  const logCount = useMemo(
    () =>
      initialEvents.filter(
        (v) =>
          v.record_class === "log" &&
          !v.hidden_at &&
          (siteId == null || v.site_id === siteId),
      ).length,
    [initialEvents, siteId],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter((v) => {
      if (typeFilter.size > 0 && (!v.type_slug || !typeFilter.has(v.type_slug)))
        return false
      if (severityFilter.size > 0 && !severityFilter.has(v.severity)) return false
      if (
        siteFilter.size > 0 &&
        (v.site_id == null || !siteFilter.has(String(v.site_id)))
      )
        return false
      if (scopeFilter.size > 0 && !scopeFilter.has(v.subject_kind)) return false
      if (q) {
        const hay = [v.subject_name, v.site_name, v.note, v.validated_by_username]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [all, search, typeFilter, severityFilter, siteFilter, scopeFilter])

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Event[] }[] = []
    for (const v of filtered) {
      const { key, label } = zuluDay(v.validated_at)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(v)
      else out.push({ key, label, items: [v] })
    }
    return out
  }, [filtered])

  // Reset pagination when the live list changes shape drastically (e.g.
  // workspace switch re-renders with a different site scope).
  useEffect(() => {
    setExhausted(false)
  }, [siteId])

  async function loadOlder() {
    if (loadingMore || all.length === 0) return
    setLoadingMore(true)
    setLoadError(null)
    try {
      const oldest = all[all.length - 1]
      const params = new URLSearchParams({
        record_class: "event",
        until: oldest.validated_at,
        limit: String(pageSize),
      })
      if (siteId != null) params.set("site_id", String(siteId))
      const res = await fetch(`/api/be/events?${params.toString()}`)
      if (!res.ok) throw new Error(`Load failed (${res.status})`)
      const rows = (await res.json()) as Event[]
      const known = new Set(all.map((v) => v.id))
      const fresh = rows.filter((v) => !known.has(v.id))
      if (fresh.length === 0) setExhausted(true)
      else setOlder((prev) => [...prev, ...fresh])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, site, note…"
            className="pl-7"
          />
        </div>
        <div className="w-36">
          <MultiSelectFilter
            label="Type"
            options={typeOptions}
            searchable
            selected={typeFilter}
            onChange={setTypeFilter}
          />
        </div>
        <div className="w-36">
          <MultiSelectFilter
            label="Severity"
            options={SEVERITY_OPTIONS}
            selected={severityFilter}
            onChange={setSeverityFilter}
          />
        </div>
        {siteId == null && (
          <div className="w-36">
            <MultiSelectFilter
              label="Sites"
              options={siteOptions}
              searchable
              selected={siteFilter}
              onChange={setSiteFilter}
            />
          </div>
        )}
        <div className="w-36">
          <MultiSelectFilter
            label="Scope"
            options={scopeOptions}
            selected={scopeFilter}
            onChange={setScopeFilter}
          />
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {filtered.length} of {all.length} events
        {logCount > 0 && (
          <> · {logCount} routine log{logCount === 1 ? "" : "s"} in the {logsView} view</>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border px-4 py-10 text-center text-xs text-muted-foreground">
          No events match the current filters. Significant occurrences —
          exercise phases, briefs, posture changes — appear here; routine
          audit records live in the Audit view.
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.key} className="flex flex-col gap-0.5">
              <h2 className="pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {g.label}
              </h2>
              <ol className="relative flex flex-col border-l border-border pl-0">
                {g.items.map((v) => (
                  <TimelineItem key={v.id} event={v} typesBySlug={typesBySlug} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      {!exhausted && all.length >= pageSize ? (
        <Button
          variant="outline"
          size="sm"
          onClick={loadOlder}
          disabled={loadingMore}
          className="self-center"
        >
          {loadingMore ? "Loading…" : "Load older events"}
        </Button>
      ) : (
        all.length > 0 && (
          <p className="self-center text-[11px] text-muted-foreground">
            Beginning of recorded events.
          </p>
        )
      )}
    </div>
  )
}

function TimelineItem({
  event: v,
  typesBySlug,
}: {
  event: Event
  typesBySlug: Map<string, EventTypeDef>
}) {
  const typeDef = v.type_slug ? typesBySlug.get(v.type_slug) : undefined
  const Icon = eventTypeIcon(typeDef?.icon)
  const severity = v.severity as Severity
  const hasTransition = v.status && v.prev_status && v.prev_status !== v.status

  return (
    <li className="relative flex gap-3 py-2.5 pl-5">
      {/* Rail dot — severity-coded, ringed with the surface so overlapping
          items stay distinct. */}
      <span
        className={cn(
          "absolute -left-[5px] top-4 size-2.5 rounded-full ring-2 ring-background",
          severityDotClass(severity),
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] text-muted-foreground">
            {formatZulu(v.validated_at)}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ring-inset",
              severityPillClasses(severity),
            )}
          >
            <Icon
              className="size-3"
              style={typeDef?.color ? { color: typeDef.color } : undefined}
            />
            {typeDef?.label ??
              (v.type_slug
                ? REGISTRY_TYPE_LABELS[v.type_slug] ?? v.type_slug
                : SEVERITY_LABELS[severity])}
          </span>
          <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {SCOPE_LABELS[v.subject_kind] ?? v.subject_kind}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">
            {v.subject_name ?? v.subject_label ?? "—"}
          </span>
          {v.site_name && v.subject_name !== v.site_name && (
            <span className="text-xs text-muted-foreground">{v.site_name}</span>
          )}
          {v.status && (
            <span className="text-xs text-muted-foreground">
              {hasTransition
                ? `${displayStatus(v.subject_kind, v.prev_status!)} → ${displayStatus(v.subject_kind, v.status)}`
                : displayStatus(v.subject_kind, v.status)}
            </span>
          )}
        </div>
        {v.note && (
          <p className="max-w-prose text-xs text-muted-foreground">{v.note}</p>
        )}
        <p className="text-[11px] text-muted-foreground/70">
          <LocalTime iso={v.validated_at} />
          {v.validated_by_username && <> · {v.validated_by_username}</>}
        </p>
      </div>
    </li>
  )
}
