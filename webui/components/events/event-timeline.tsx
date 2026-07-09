"use client"

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { EyeOff, MapPin, MoreHorizontal, Search } from "lucide-react"

import { LocalClock } from "@/components/time-display"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  REGISTRY_TYPE_LABELS,
  SUBJECT_KIND_LABELS,
} from "@/lib/event-type-labels"
import { eventTypeIcon } from "@/lib/event-type-meta"
import {
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  severityDotClass,
  severityTimelineCardClasses,
} from "@/lib/severity"
import { statusLabel } from "@/lib/status"
import { formatZuluTime, zuluDayGroup } from "@/lib/time"
import { emconLabel, fpconLabel } from "@/lib/threat-level"
import { cn } from "@/lib/utils"
import type {
  Emcon,
  Event,
  EventTypeDef,
  Fpcon,
  Me,
  Severity,
  SubjectKind,
} from "@/lib/types"

import { EventEditNoteDialog } from "./event-edit-note-dialog"
import { EventHideConfirmDialog } from "./event-hide-confirm-dialog"
import {
  FilterBar,
  FilterChips,
  type FilterBankItem,
  type MultiSelectOption,
} from "@/components/multi-select-filter"

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

/** Shared 3-column track for the vertical timeline: time gutter · rail · card. */
const TIMELINE_COLS = "grid grid-cols-[4.75rem_2.25rem_minmax(0,1fr)]"

/** Distance below the scroll container's top edge where a day/hour counts as
 *  "current" — jumps land here and the scrub nav highlights against it. */
const SCROLL_SPY_OFFSET = 16

/** Where the scrub nav pins itself in the viewport once scrolled. Positioned
 *  in JS (not CSS `sticky`) because the layout's non-scrolling overflow pane
 *  would otherwise trap sticky and let the nav scroll away. */
const NAV_PIN_TOP = 16

/** Nearest ancestor that actually scrolls; null when the window is the
 *  scroller (the layout's overflow pane grows to fit, so the window scrolls). */
function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null
  while (p) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1)
      return p
    p = p.parentElement
  }
  return null
}

/** Viewport-relative top edge of a scroller (0 for the window). */
function scrollerTop(scroller: HTMLElement | null): number {
  return scroller ? scroller.getBoundingClientRect().top : 0
}

interface Props {
  me: Me
  events: Event[]
  eventTypes: EventTypeDef[]
  /** Lock the timeline to one site (site detail tab) — hides the site filter. */
  siteId?: number
  pageSize?: number
  /** Include soft-hidden records (dimmed) instead of filtering them out. */
  showHidden?: boolean
  /** Where routine logs live relative to this timeline. */
  logsView?: string
}

/** Vertical severity-coded timeline of `record_class === "event"` records
 *  with compound filters — the walkthrough view of how things unfolded. */
export function EventTimeline({
  me,
  events: initialEvents,
  eventTypes,
  siteId,
  pageSize = 100,
  showHidden = false,
  logsView = "Log Table",
}: Props) {
  // Local copy so edits/hides update in place; reseeded when the server list
  // changes (e.g. after a router.refresh() following a create).
  const [events, setEvents] = useState(initialEvents)
  useEffect(() => setEvents(initialEvents), [initialEvents])

  // Older pages fetched on demand are kept separately so live refreshes of
  // the server-provided list don't drop them; merge dedupes by id.
  const [older, setOlder] = useState<Event[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [confirmHideIds, setConfirmHideIds] = useState<number[] | null>(null)

  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set())
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set())
  const [siteFilter, setSiteFilter] = useState<Set<string>>(new Set())
  const [scopeFilter, setScopeFilter] = useState<Set<string>>(new Set())

  // Timeline scrub nav — which day/hour is currently at the top of the view.
  const timelineRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const [activeDay, setActiveDay] = useState<string | null>(null)
  const [activeHour, setActiveHour] = useState<string | null>(null)

  const typesBySlug = useMemo(() => {
    const m = new Map<string, EventTypeDef>()
    for (const t of eventTypes) m.set(t.slug, t)
    return m
  }, [eventTypes])

  const all = useMemo(() => {
    const seen = new Set<number>()
    const merged: Event[] = []
    for (const v of [...events, ...older]) {
      if (v.record_class !== "event") continue
      if (v.hidden_at && !showHidden) continue
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
  }, [events, older, siteId, showHidden])

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
      .map((k) => ({ value: k, label: SUBJECT_KIND_LABELS[k] ?? k }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [all])

  // Filter dimensions for the funnel bar + chips. Sites is dropped when the
  // timeline is already locked to one site.
  const filterBank: FilterBankItem[] = [
    { key: "type", label: "Type", options: typeOptions, searchable: true, selected: typeFilter, onChange: setTypeFilter },
    { key: "severity", label: "Severity", options: SEVERITY_OPTIONS, selected: severityFilter, onChange: setSeverityFilter },
    ...(siteId == null
      ? [{ key: "site", label: "Sites", options: siteOptions, searchable: true, selected: siteFilter, onChange: setSiteFilter } as FilterBankItem]
      : []),
    { key: "scope", label: "Scope", options: scopeOptions, selected: scopeFilter, onChange: setScopeFilter },
  ]

  // How many routine (log-class) records the timeline is hiding — surfaced
  // in the count line so the event/log split stays discoverable.
  const logCount = useMemo(
    () =>
      events.filter(
        (v) =>
          v.record_class === "log" &&
          !v.hidden_at &&
          (siteId == null || v.site_id === siteId),
      ).length,
    [events, siteId],
  )

  // Apply a server-confirmed edit/hide/unhide to whichever local list holds it.
  const patchLocal = useCallback((updated: Event[]) => {
    const map = new Map(updated.map((u) => [u.id, u]))
    const apply = (v: Event) => map.get(v.id) ?? v
    setEvents((prev) => prev.map(apply))
    setOlder((prev) => prev.map(apply))
  }, [])

  const handleUnhide = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`/api/be/events/${id}/unhide`, {
          method: "POST",
        })
        if (!res.ok) throw new Error(`Unhide failed (${res.status})`)
        patchLocal([(await res.json()) as Event])
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Unknown error")
      }
    },
    [patchLocal],
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
      const { key, label } = zuluDayGroup(v.validated_at)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(v)
      else out.push({ key, label, items: [v] })
    }
    return out
  }, [filtered])

  // Scrub-nav model: each day, with its distinct Zulu hours (descending) and
  // a count so the aside reads like a table of contents into the timeline.
  const navDays = useMemo(
    () =>
      groups.map((g) => {
        const hours: { hourKey: string; label: string; count: number }[] = []
        for (const v of g.items) {
          const h = new Date(v.validated_at).getUTCHours()
          const hourKey = `${g.key}:${h}`
          const last = hours[hours.length - 1]
          if (last && last.hourKey === hourKey) last.count++
          else
            hours.push({
              hourKey,
              label: `${h.toString().padStart(2, "0")}Z`,
              count: 1,
            })
        }
        return {
          key: g.key,
          // "08 JUL 2026" → "08 JUL" for the narrow rail.
          label: g.label.replace(/ \d{4}$/, ""),
          count: g.items.length,
          hours,
        }
      }),
    [groups],
  )

  // Jump the scroller so the target anchor lands SCROLL_SPY_OFFSET below the
  // scroller's top edge — computed against the true scroller (the window, since
  // the layout pane grows to fit) so the landing is exact.
  const jumpTo = useCallback((selector: string) => {
    const root = timelineRef.current
    const el = root?.querySelector<HTMLElement>(selector)
    if (!el) return
    const scroller = getScrollParent(root)
    const anchorTop = el.getBoundingClientRect().top
    if (scroller) {
      const top =
        anchorTop -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        SCROLL_SPY_OFFSET
      scroller.scrollTo({ top, behavior: "smooth" })
    } else {
      window.scrollTo({ top: anchorTop + window.scrollY - SCROLL_SPY_OFFSET, behavior: "smooth" })
    }
  }, [])

  // Scroll-spy: the active day/hour is the last anchor whose top has crossed the
  // offset line, measured against the scroller's own top so it stays right even
  // as the page above scrolls away.
  useEffect(() => {
    const root = timelineRef.current
    if (!root) return
    const scroller = getScrollParent(root)
    const target: HTMLElement | Window = scroller ?? window

    let raf = 0
    const compute = () => {
      raf = 0
      const top = scrollerTop(scroller)
      const line = top + SCROLL_SPY_OFFSET + 4
      const anchors = root.querySelectorAll<HTMLElement>("[data-spy-day]")
      let best: HTMLElement | null = null
      // Anchors are in DOM (top→bottom) order, so tops increase monotonically.
      for (const el of anchors) {
        if (el.getBoundingClientRect().top <= line) best = el
        else break
      }
      best ??= anchors[0] ?? null
      if (best) {
        setActiveDay(best.dataset.spyDay ?? null)
        setActiveHour(best.dataset.spyHour ?? null)
      }

      // Pin the nav: shift it down so it holds NAV_PIN_TOP below the scroller's
      // top edge once its row has scrolled past, clamped to stay in the row.
      const aside = asideRef.current
      const rowEl = rowRef.current
      if (aside && rowEl) {
        const rowTop = rowEl.getBoundingClientRect().top
        const maxShift = rowEl.clientHeight - aside.offsetHeight
        const shift = Math.max(0, Math.min(top + NAV_PIN_TOP - rowTop, maxShift))
        aside.style.transform = shift > 0 ? `translateY(${shift}px)` : ""
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute)
    }
    compute()
    target.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      target.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [groups])

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
        <FilterBar bank={filterBank} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span>
          {filtered.length} of {all.length} events
          {logCount > 0 && (
            <> · {logCount} routine log{logCount === 1 ? "" : "s"} in the {logsView} view</>
          )}
        </span>
        <FilterChips bank={filterBank} />
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border px-4 py-10 text-center text-xs text-muted-foreground">
          No events match the current filters. Significant occurrences —
          exercise phases, briefs, posture changes — appear here; routine
          audit records live in the Log Table.
        </div>
      ) : (
        // Vertical timeline: a continuous rail with the event-type bubble as
        // each station, the Zulu/local time in the left gutter, and the card
        // elevation encoding severity so critical events lift off the page. A
        // sticky rail nav on the right scrubs by day and hour.
        <div ref={rowRef} className="flex items-start gap-6">
          <div ref={timelineRef} className="relative min-w-0 flex-1">
            {groups.map((g) => {
              let prevHour = -1
              return (
                <Fragment key={g.key}>
                  {/* Date band — the rail's empty gutter cells leave a natural
                      gap in the line before each new day. Also a spy/jump
                      anchor for the day. */}
                  <div
                    data-spy-day={g.key}
                    className={cn(
                      TIMELINE_COLS,
                      "scroll-mt-4 items-center pb-3 pt-5 first:pt-0",
                    )}
                  >
                    <div aria-hidden />
                    <div aria-hidden />
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {g.label}
                      </span>
                      <span className="h-px flex-1 bg-border/60" aria-hidden />
                    </div>
                  </div>
                  {g.items.map((v) => {
                    const h = new Date(v.validated_at).getUTCHours()
                    const spyHour = h !== prevHour ? `${g.key}:${h}` : undefined
                    prevHour = h
                    return (
                      <TimelineRow
                        key={v.id}
                        me={me}
                        event={v}
                        typesBySlug={typesBySlug}
                        spyDay={g.key}
                        spyHour={spyHour}
                        onEdit={() => setEditingEvent(v)}
                        onHide={() => setConfirmHideIds([v.id])}
                        onUnhide={() => handleUnhide(v.id)}
                      />
                    )
                  })}
                </Fragment>
              )
            })}
          </div>
          {navDays.length > 0 && (
            <aside
              ref={asideRef}
              className="hidden h-fit max-h-[calc(100dvh-2rem)] w-36 shrink-0 self-start overflow-y-auto pb-2 will-change-transform lg:block"
            >
              <nav className="flex flex-col gap-0.5 text-[11px]">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                  Jump to
                </div>
                {navDays.map((d) => {
                  const dayActive = d.key === activeDay
                  return (
                    <div key={d.key}>
                      <button
                        type="button"
                        onClick={() =>
                          jumpTo(`[data-spy-day="${d.key}"]:not([data-spy-hour])`)
                        }
                        className={cn(
                          "flex w-full items-center justify-between rounded px-2 py-1 text-left font-medium transition-colors hover:bg-muted",
                          dayActive
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <span>{d.label}</span>
                        <span className="tabular-nums text-[10px] text-muted-foreground/60">
                          {d.count}
                        </span>
                      </button>
                      {dayActive && d.hours.length > 1 && (
                        <div className="mb-1 ml-3 mt-0.5 flex flex-col gap-px border-l pl-2">
                          {d.hours.map((h) => (
                            <button
                              key={h.hourKey}
                              type="button"
                              onClick={() =>
                                jumpTo(`[data-spy-hour="${h.hourKey}"]`)
                              }
                              className={cn(
                                "flex items-center justify-between rounded px-1.5 py-0.5 font-mono transition-colors hover:bg-muted",
                                h.hourKey === activeHour
                                  ? "text-foreground"
                                  : "text-muted-foreground/70",
                              )}
                            >
                              <span>{h.label}</span>
                              <span className="tabular-nums text-[10px] text-muted-foreground/50">
                                {h.count}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </nav>
            </aside>
          )}
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

      <EventEditNoteDialog
        event={editingEvent}
        onClose={() => setEditingEvent(null)}
        onSaved={(updated) => patchLocal([updated])}
      />
      <EventHideConfirmDialog
        ids={confirmHideIds}
        onClose={() => setConfirmHideIds(null)}
        onHidden={(updated) => patchLocal(updated)}
      />
    </div>
  )
}

/** One event as a row on the vertical timeline: time gutter · rail bubble ·
 *  card. The bubble carries the event type (its icon + colour); the card's
 *  elevation carries the severity so critical events stand out. */
function TimelineRow({
  me,
  event: v,
  typesBySlug,
  spyDay,
  spyHour,
  onEdit,
  onHide,
  onUnhide,
}: {
  me: Me
  event: Event
  typesBySlug: Map<string, EventTypeDef>
  /** Set on the first row of each hour so it can anchor the scrub nav. */
  spyDay?: string
  spyHour?: string
  onEdit: () => void
  onHide: () => void
  onUnhide: () => void
}) {
  const typeDef = v.type_slug ? typesBySlug.get(v.type_slug) : undefined
  const Icon = eventTypeIcon(typeDef?.icon)
  const severity = v.severity as Severity
  const hasTransition = v.status && v.prev_status && v.prev_status !== v.status
  const isHidden = v.hidden_at != null

  const isAdmin = me.role === "admin"
  const isAuthor =
    v.validated_by_user_id != null && v.validated_by_user_id === me.user_id
  const canEdit = isAdmin || (me.role === "operator" && isAuthor)
  const showMenu = canEdit || isAdmin

  return (
    <div
      data-spy-day={spyHour ? spyDay : undefined}
      data-spy-hour={spyHour}
      className={cn(TIMELINE_COLS, "scroll-mt-4 items-stretch")}
    >
      {/* Time — Zulu over local, right-aligned into the line. */}
      <div className="flex flex-col items-end gap-0.5 pr-2 pt-2 text-right font-mono text-[11px] leading-none text-muted-foreground">
        <span>{formatZuluTime(v.validated_at)}</span>
        <LocalClock iso={v.validated_at} className="text-muted-foreground/60" />
      </div>
      {/* Rail — a continuous hairline with the type bubble as the station.
          The ring-background halo punches the line out around the bubble. */}
      <div className="relative flex justify-center">
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border"
        />
        <span
          className={cn(
            "relative z-10 mt-1 flex size-7 items-center justify-center rounded-full text-white ring-4 ring-background",
            !typeDef?.color && severityDotClass(severity),
          )}
          style={
            typeDef?.color ? { backgroundColor: typeDef.color } : undefined
          }
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      {/* Card — elevation encodes severity; critical fills a tinted card. */}
      <div
        className={cn(
          "group/card relative mb-3 ml-1 min-w-0 rounded-lg px-3 py-2",
          showMenu && "pr-8",
          severityTimelineCardClasses(severity),
          isHidden && "opacity-60",
        )}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold">
            {v.subject_name ?? v.subject_label ?? "—"}
          </span>
          {v.status && (
            <span className="text-xs text-muted-foreground">
              {hasTransition
                ? `${displayStatus(v.subject_kind, v.prev_status!)} → ${displayStatus(v.subject_kind, v.status)}`
                : displayStatus(v.subject_kind, v.status)}
            </span>
          )}
          {isHidden && (
            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              <EyeOff className="size-2.5" aria-hidden />
              Hidden
            </span>
          )}
        </div>
        {v.note && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {v.note}
          </p>
        )}
        {v.site_name && (
          <div className="mt-1 flex items-center gap-0.5 text-[11px] text-muted-foreground/80">
            <MapPin className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{v.site_name}</span>
          </div>
        )}
        {showMenu && (
          <div className="absolute right-1 top-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100 data-[state=open]:opacity-100"
                    aria-label="Row actions"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                }
              />
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem onClick={onEdit}>
                    Edit note
                  </DropdownMenuItem>
                )}
                {isAdmin &&
                  (isHidden ? (
                    <DropdownMenuItem onClick={onUnhide}>
                      Unhide event
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={onHide}
                      className="text-destructive"
                    >
                      Hide event
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}
