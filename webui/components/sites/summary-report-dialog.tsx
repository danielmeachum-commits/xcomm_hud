"use client"

import { FileDown } from "lucide-react"
import { useState } from "react"

import { localInputToIso, toLocalInput } from "@/components/events/event-time-field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SEVERITY_LABELS, SEVERITY_ORDER } from "@/lib/severity"
import { statusLabel } from "@/lib/status"
import type { AnyStatus, EventType, EventTypeDef, Severity, Site, SubjectKind } from "@/lib/types"
import { cn } from "@/lib/utils"

const EVENT_KINDS: { value: EventType; label: string }[] = [
  { value: "validation", label: "Validations" },
  { value: "general", label: "Logged events" },
  { value: "personnel", label: "Personnel" },
]

// Subject kinds grouped the way people think of them; one chip each.
const SUBJECT_GROUPS: { label: string; kinds: SubjectKind[] }[] = [
  { label: "Sites", kinds: ["site", "site_status", "site_fpcon", "site_emcon"] },
  { label: "Services", kinds: ["service"] },
  { label: "Gateways", kinds: ["gateway"] },
  { label: "Cells", kinds: ["service_gateway"] },
  { label: "Equipment", kinds: ["equipment", "equipment_capability", "equipment_link"] },
  { label: "Personnel", kinds: ["personnel_location"] },
  { label: "UTCs", kinds: ["utc_instance", "package_instance"] },
]

const STATUSES: AnyStatus[] = [
  "up", "degraded", "down", "offline", "active", "ready", "setup", "unvalidated",
]

const PRESETS: { label: string; hours: number | null }[] = [
  { label: "Last 24 h", hours: 24 },
  { label: "Last 72 h", hours: 72 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "All time", hours: null },
]

function toggled<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

/** A row of on/off chips; none selected means "any". */
function ChipGroup<T extends string | number>({
  label,
  options,
  selected,
  onToggle,
  disabled,
}: {
  label: string
  options: { value: T; label: string }[]
  selected: T[]
  onToggle: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">
        {label} {selected.length === 0 && <span className="font-normal">(any)</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const on = selected.includes(o.value)
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(o.value)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-accent",
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Filename from `Content-Disposition: attachment; filename="…"`. */
function filenameFrom(disposition: string | null): string {
  const m = disposition?.match(/filename="([^"]+)"/)
  return m ? m[1] : "xcomm-summary.pdf"
}

/**
 * The status summary as a PDF: every site's posture, services and gateways,
 * with remarks typed here. The remarks go into the PDF only — nothing is
 * saved, so writing a SITREP remark never changes anything in the app.
 */
export function SummaryReportDialog({
  sites,
  eventTypes = [],
}: {
  sites: Site[]
  eventTypes?: EventTypeDef[]
}) {
  const [open, setOpen] = useState(false)
  const [remark, setRemark] = useState("")
  const [siteRemarks, setSiteRemarks] = useState<Record<number, string>>({})
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [withLog, setWithLog] = useState(false)
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [logSites, setLogSites] = useState<number[]>([])
  const [kinds, setKinds] = useState<EventType[]>([])
  const [subjects, setSubjects] = useState<string[]>([])
  const [statuses, setStatuses] = useState<AnyStatus[]>([])
  const [severities, setSeverities] = useState<Severity[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [eventsOnly, setEventsOnly] = useState(false)
  const [pending, setPending] = useState(false)
  // The catalog types people log by hand (STARTEX, ...), not system actions.
  const pickableTypes = eventTypes.filter((t) => !t.retired_at && !t.is_system)


  function eventsLogBody() {
    const none = <T,>(l: T[]) => (l.length ? l : null)
    return {
      since: since ? localInputToIso(since) : null,
      until: until ? localInputToIso(until) : null,
      site_ids: none(logSites),
      event_types: none(kinds),
      subject_kinds: none(
        SUBJECT_GROUPS.filter((g) => subjects.includes(g.label)).flatMap((g) => g.kinds),
      ),
      statuses: none(statuses),
      severities: none(severities),
      type_slugs: none(types),
      events_only: eventsOnly,
    }
  }
  const [error, setError] = useState<string | null>(null)

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function download() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/be/reports/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remark,
          site_remarks: Object.fromEntries(
            Object.entries(siteRemarks).filter(([, v]) => v.trim() !== ""),
          ),
          events_log: withLog ? eventsLogBody() : null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(typeof body.detail === "string" ? body.detail : "Couldn't build the report")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filenameFrom(res.headers.get("Content-Disposition"))
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build the report")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5">
            <FileDown className="size-3.5" />
            Summary report
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Summary report</DialogTitle>
          <DialogDescription>
            A PDF of every site&apos;s status, services and gateways as they
            stand now. Remarks go into the PDF only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="report-remark">Remarks</Label>
          <Textarea
            id="report-remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="Overall situation, issues, next update…"
            className="min-h-24"
            maxLength={4000}
            disabled={pending}
          />
        </div>

        {sites.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium">
              Site remarks <span className="font-normal text-muted-foreground">(optional)</span>
            </div>
            <ul className="divide-y rounded-md border">
              {sites.map((s) => {
                const has = (siteRemarks[s.id] ?? "").trim() !== ""
                return (
                  <li key={s.id} className="px-3 py-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left text-sm"
                      onClick={() => toggle(s.id)}
                      aria-expanded={expanded.has(s.id)}
                    >
                      <span>{s.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {has ? "remark added" : expanded.has(s.id) ? "hide" : "add remark"}
                      </span>
                    </button>
                    {expanded.has(s.id) && (
                      <Textarea
                        aria-label={`Remark for ${s.name}`}
                        value={siteRemarks[s.id] ?? ""}
                        onChange={(e) =>
                          setSiteRemarks((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        className="mt-2 min-h-16"
                        disabled={pending}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="space-y-2 rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4"
              checked={withLog}
              onChange={(e) => setWithLog(e.target.checked)}
              disabled={pending}
            />
            Add an events log
            <span className="text-xs font-normal text-muted-foreground">(from page 2)</span>
          </label>
          {withLog && (
            <div className="space-y-3 pt-1">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">Time</div>
                <div className="flex flex-wrap gap-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setUntil("")
                        setSince(
                          p.hours === null
                            ? ""
                            : toLocalInput(new Date(Date.now() - p.hours * 3600_000)),
                        )
                      }}
                      className="rounded-full border bg-background px-2 py-0.5 text-[11px] hover:bg-accent"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="log-since" className="text-[11px] text-muted-foreground">From</Label>
                    <Input
                      id="log-since"
                      type="datetime-local"
                      value={since}
                      onChange={(e) => setSince(e.target.value)}
                      disabled={pending}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label htmlFor="log-until" className="text-[11px] text-muted-foreground">To</Label>
                    <Input
                      id="log-until"
                      type="datetime-local"
                      value={until}
                      onChange={(e) => setUntil(e.target.value)}
                      disabled={pending}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Your local time; the PDF shows Zulu. Blank = from the start / up to now.
                </p>
              </div>
              {sites.length > 1 && (
                <ChipGroup
                  label="Sites"
                  options={sites.map((s) => ({ value: s.id, label: s.name }))}
                  selected={logSites}
                  onToggle={(v) => setLogSites((l) => toggled(l, v))}
                  disabled={pending}
                />
              )}
              <ChipGroup
                label="Kind"
                options={EVENT_KINDS}
                selected={kinds}
                onToggle={(v) => setKinds((l) => toggled(l, v))}
                disabled={pending}
              />
              <ChipGroup
                label="About"
                options={SUBJECT_GROUPS.map((g) => ({ value: g.label, label: g.label }))}
                selected={subjects}
                onToggle={(v) => setSubjects((l) => toggled(l, v))}
                disabled={pending}
              />
              {pickableTypes.length > 0 && (
                <ChipGroup
                  label="Event type"
                  options={pickableTypes.map((t) => ({ value: t.slug, label: t.label }))}
                  selected={types}
                  onToggle={(v) => setTypes((l) => toggled(l, v))}
                  disabled={pending}
                />
              )}
              <ChipGroup
                label="Status (changed to)"
                options={STATUSES.map((v) => ({ value: v, label: statusLabel(v) }))}
                selected={statuses}
                onToggle={(v) => setStatuses((l) => toggled(l, v))}
                disabled={pending}
              />
              <ChipGroup
                label="Severity"
                options={SEVERITY_ORDER.map((v) => ({ value: v, label: SEVERITY_LABELS[v] }))}
                selected={severities}
                onToggle={(v) => setSeverities((l) => toggled(l, v))}
                disabled={pending}
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5"
                  checked={eventsOnly}
                  onChange={(e) => setEventsOnly(e.target.checked)}
                  disabled={pending}
                />
                Significant events only (leave out routine log lines)
              </label>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={download} disabled={pending} className="gap-1.5">
            <FileDown className="size-3.5" />
            {pending ? "Building…" : "Download PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
