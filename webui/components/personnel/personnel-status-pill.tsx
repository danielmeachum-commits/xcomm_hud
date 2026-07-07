"use client"

import { useRef, useState } from "react"

import { PersonnelCheckInDialog } from "@/components/personnel/personnel-checkin-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import {
  describeLocation,
  PERSONNEL_STATUS_LABELS,
  type PersonnelStatus,
} from "@/lib/personnel-data"
import { formatLocal, formatZulu, timeAgo } from "@/lib/time"
import type { Personnel, PersonnelLocationEvent, Site } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  person: Personnel
  sites: Site[]
  /** Operators/admins get an "Update location" action in the details dialog. */
  canEdit: boolean
  size?: "sm" | "md"
  /** "dot" renders just the animated status indicator — hover popover and
   *  click-for-details behavior are identical. Used in compact spots like
   *  the personnel graph canvas. */
  variant?: "pill" | "dot"
}

/** StatusIndicator state driving the pulse: live/transitioning statuses
 *  animate, everything else sits still. Color itself comes from
 *  describeLocation() via the `color` override. */
function dotState(
  status: PersonnelStatus,
  overdue: boolean,
): "active" | "setup" | "down" | "idle" {
  if (overdue) return "down"
  if (status === "on_site") return "active"
  if (status === "traveling") return "setup"
  return "idle"
}

/**
 * Interactive personnel status pill mirroring the service status cell:
 * hover (after a short delay) shows a location-details popover; click opens a
 * details dialog with recent sign-in history and, for operators, an action to
 * update the location. The label is derived (assigned vs temporary, expected
 * duration, overdue) via describeLocation().
 */
export function PersonnelStatusPill({
  person,
  sites,
  canEdit,
  size = "sm",
  variant = "pill",
}: Props) {
  const [hoverOpen, setHoverOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [checkinOpen, setCheckinOpen] = useState(false)
  const [history, setHistory] = useState<PersonnelLocationEvent[] | null>(null)
  const [loading, setLoading] = useState(false)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const siteById = new Map(sites.map((s) => [s.id, s.name]))
  const desc = describeLocation(
    {
      status: person.current_status,
      currentSiteId: person.current_site_id,
      assignedSiteId: person.assigned_site_id,
      since: person.current_status_since,
      expectedReturnAt: person.expected_return_at,
    },
    (id) => (id != null ? siteById.get(id) : undefined),
  )

  async function fetchHistory() {
    if (history || loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/be/personnel/${person.id}/history?limit=8`)
      if (res.ok) setHistory((await res.json()) as PersonnelLocationEvent[])
    } catch {
      // non-fatal — dialog still shows current status
    } finally {
      setLoading(false)
    }
  }

  function handleMouseEnter() {
    hoverTimeoutRef.current = setTimeout(() => setHoverOpen(true), 700)
  }
  function handleMouseLeave() {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setHoverOpen(false)
  }
  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDialogOpen(true)
    void fetchHistory()
  }

  const badge = variant === "dot" ? (
    <StatusIndicator
      state={dotState(person.current_status, desc.overdue)}
      color={desc.color}
      size="sm"
    />
  ) : (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background text-muted-foreground",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
      )}
      style={{ borderColor: desc.color }}
    >
      <span
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: desc.color }}
        aria-hidden
      />
      <span className="text-foreground">{desc.text}</span>
      {desc.durationText ? (
        <span className="opacity-70">· {desc.durationText}</span>
      ) : null}
      {desc.overdue ? (
        <span className="font-semibold" style={{ color: desc.color }}>
          · overdue
        </span>
      ) : null}
    </span>
  )

  return (
    <>
      <Popover open={hoverOpen} onOpenChange={setHoverOpen}>
        <PopoverTrigger
          nativeButton={false}
          render={
            <div
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onClick={handleClick}
              className="inline-flex cursor-pointer"
              aria-label={`Location details for ${person.last_name}, ${person.first_name}`}
            />
          }
        >
          {badge}
        </PopoverTrigger>
        <PopoverContent
          className="w-64 text-sm"
          side="top"
          align="start"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <LocationDetails person={person} label={desc.text} overdue={desc.overdue} />
        </PopoverContent>
      </Popover>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Location — {person.last_name}, {person.first_name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <LocationDetails
              person={person}
              label={desc.text}
              overdue={desc.overdue}
            />

            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Recent history
              </div>
              {loading && !history ? (
                <p className="mt-1 text-xs text-muted-foreground">Loading…</p>
              ) : history && history.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {history.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span>
                        <span className="font-medium">
                          {PERSONNEL_STATUS_LABELS[h.status]}
                        </span>
                        {h.site_id ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {siteById.get(h.site_id) ?? "—"}
                          </span>
                        ) : null}
                        {h.note ? (
                          <span className="text-muted-foreground">
                            {" "}
                            — {h.note}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {timeAgo(h.changed_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  No history yet.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="mr-auto"
                onClick={() => {
                  setDialogOpen(false)
                  setCheckinOpen(true)
                }}
              >
                Update location
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDialogOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PersonnelCheckInDialog
        person={person}
        sites={sites}
        open={checkinOpen}
        onOpenChange={setCheckinOpen}
      />
    </>
  )
}

function LocationDetails({
  person,
  label,
  overdue,
}: {
  person: Personnel
  label: string
  overdue: boolean
}) {
  const known = person.current_status !== "unknown"
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Status
        </div>
        <div className="mt-1 text-sm font-semibold">{label}</div>
      </div>

      {known && person.current_status_since && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Since
          </div>
          <div className="mt-1 space-y-0.5 font-mono text-xs">
            <div>
              <span className="text-muted-foreground">Local: </span>
              {formatLocal(person.current_status_since)}
            </div>
            <div>
              <span className="text-muted-foreground">Zulu: </span>
              {formatZulu(person.current_status_since)}
            </div>
            <div className="font-sans text-muted-foreground">
              {timeAgo(person.current_status_since)}
            </div>
          </div>
        </div>
      )}

      {person.expected_return_at && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Expected back
          </div>
          <div className="mt-1 space-y-0.5 font-mono text-xs">
            <div>
              <span className="text-muted-foreground">Local: </span>
              {formatLocal(person.expected_return_at)}
            </div>
            <div>
              <span className="text-muted-foreground">Zulu: </span>
              {formatZulu(person.expected_return_at)}
            </div>
            {overdue && (
              <div className="font-sans font-semibold text-destructive">
                Overdue
              </div>
            )}
          </div>
        </div>
      )}

      {person.current_status_note && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Note
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {person.current_status_note}
          </div>
        </div>
      )}
    </div>
  )
}
