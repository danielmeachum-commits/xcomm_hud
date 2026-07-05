"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { LocalTime } from "@/components/time-display"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import {
  SERVICE_STATUS_CATEGORIES,
  statusLabel,
  statusToIndicatorState,
} from "@/lib/status"
import { formatZulu } from "@/lib/time"
import type { AnyStatus, Event } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ValidationDetailsPopoverProps {
  validatedAt: string
  status: string
  prevStatus?: string | null
  validatedBy?: string | null
  note?: string | null
  children: React.ReactNode
  subjectKind?: "service" | "service_gateway"
  subjectId?: number
  secondSubjectId?: number
  isOperator?: boolean
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ValidationContent({
  validatedAt,
  status,
  displayPrevStatus,
  validatedBy,
  displayNote,
}: {
  validatedAt: string
  status: string
  displayPrevStatus: string | null | undefined
  validatedBy: string | null | undefined
  displayNote: string | null | undefined
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Time
        </div>
        <div className="mt-1 space-y-1 font-mono text-xs">
          <div>
            <span className="text-muted-foreground">Local: </span>
            <LocalTime iso={validatedAt} />
          </div>
          <div>
            <span className="text-muted-foreground">Zulu: </span>
            {formatZulu(validatedAt)}
          </div>
        </div>
      </div>

      {(displayPrevStatus || status) && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Status
          </div>
          <div className="mt-1 text-xs">
            {displayPrevStatus ? (
              <div>
                <span className="font-semibold capitalize">{displayPrevStatus}</span>
                <span className="mx-1 text-muted-foreground">→</span>
                <span className="font-semibold capitalize">{status}</span>
              </div>
            ) : (
              <span className="font-semibold capitalize">{status}</span>
            )}
          </div>
        </div>
      )}

      {validatedBy && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Validated By
          </div>
          <div className="mt-1 text-xs">{validatedBy}</div>
        </div>
      )}

      {displayNote && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Notes
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{displayNote}</div>
        </div>
      )}
    </div>
  )
}

export function ValidationDetailsPopover({
  validatedAt,
  status,
  prevStatus,
  validatedBy,
  note,
  children,
  subjectKind,
  subjectId,
  secondSubjectId,
  isOperator,
}: ValidationDetailsPopoverProps) {
  const router = useRouter()
  const [hoverOpen, setHoverOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [event, setEvent] = useState<Event | null>(null)
  const [loading, setLoading] = useState(false)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [editStatus, setEditStatus] = useState<AnyStatus>(status as AnyStatus)
  const [editNote, setEditNote] = useState("")
  const [editWhenLocal, setEditWhenLocal] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Revert confirmation state
  const [revertOpen, setRevertOpen] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState<string | null>(null)

  const canEdit = !!(subjectKind && subjectId && isOperator)

  const fetchEvent = async () => {
    if (!event && subjectKind && subjectId && !loading) {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          subject_kind: subjectKind,
          subject_id: subjectId.toString(),
          limit: "1",
        })
        if (secondSubjectId) {
          params.append("second_subject_id", secondSubjectId.toString())
        }
        const res = await fetch(`/api/be/events?${params.toString()}`)
        if (res.ok) {
          const events = (await res.json()) as Event[]
          if (events.length > 0) {
            setEvent(events[0])
          }
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false)
      }
    }
  }

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoverOpen(true)
      fetchEvent()
    }, 1000)
  }

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setHoverOpen(false)
  }

  const handleClick = () => {
    setDialogOpen(true)
    fetchEvent()
  }

  function startEditing() {
    const src = event
    setEditStatus(((src?.status ?? status) as AnyStatus) || "unknown")
    setEditNote(src?.note ?? note ?? "")
    setEditWhenLocal(toLocalInput(new Date(src?.validated_at ?? validatedAt)))
    setSaveError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setSaveError(null)
  }

  async function saveEdit() {
    if (!event) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/be/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: editNote || null,
          status: editStatus,
          validated_at: new Date(editWhenLocal).toISOString(),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to save")
      }
      const updated = (await res.json()) as Event
      setEvent(updated)
      setEditing(false)
      router.refresh()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setSaving(false)
    }
  }

  async function doRevert() {
    if (!event) return
    setReverting(true)
    setRevertError(null)
    try {
      const res = await fetch(`/api/be/events/${event.id}/revert`, {
        method: "POST",
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Revert failed")
      }
      setRevertOpen(false)
      setDialogOpen(false)
      router.refresh()
    } catch (err) {
      setRevertError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setReverting(false)
    }
  }

  const displayPrevStatus = event?.prev_status ?? prevStatus
  const displayNote = event?.note ?? note
  const displayStatus = event?.status ?? status
  const displayValidatedAt = event?.validated_at ?? validatedAt

  const editWhenIso = (() => {
    try {
      return new Date(editWhenLocal).toISOString()
    } catch {
      return new Date().toISOString()
    }
  })()

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
              className="cursor-pointer hover:underline"
            />
          }
        >
          {children}
        </PopoverTrigger>
        <PopoverContent
          className="w-64 text-sm"
          side="right"
          align="start"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <ValidationContent
            validatedAt={validatedAt}
            status={status}
            displayPrevStatus={displayPrevStatus}
            validatedBy={validatedBy}
            displayNote={displayNote}
          />
        </PopoverContent>
      </Popover>

      {/* Main details dialog */}
      <Dialog
        open={dialogOpen && !revertOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false)
            setEditing(false)
            setSaveError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Validation" : "Validation Details"}</DialogTitle>
          </DialogHeader>

          {editing ? (
            <div className="space-y-4">
              {/* Timestamp */}
              <div className="space-y-1.5">
                <Label htmlFor="edit-when">When (local time)</Label>
                <Input
                  id="edit-when"
                  type="datetime-local"
                  value={editWhenLocal}
                  onChange={(e) => setEditWhenLocal(e.target.value)}
                  disabled={saving}
                />
                <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-2 text-[11px]">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Local</div>
                    <div className="font-mono">
                      <LocalTime iso={editWhenIso} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Zulu</div>
                    <div className="font-mono">{formatZulu(editWhenIso)}</div>
                  </div>
                </div>
              </div>

              {/* Status picker */}
              <div className="space-y-1.5">
                <Label>Status</Label>
                <div className="flex flex-col gap-3">
                  {SERVICE_STATUS_CATEGORIES.map((cat) => (
                    <div key={cat.key} className="flex flex-col gap-1.5">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {cat.label}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {cat.values.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setEditStatus(s)}
                            className={cn(
                              "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                              editStatus === s
                                ? "border-foreground bg-accent"
                                : "border-input hover:bg-accent/50",
                            )}
                            disabled={saving}
                          >
                            <StatusIndicator
                              state={statusToIndicatorState(s)}
                              size="sm"
                            />
                            {statusLabel(s)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="edit-note">Notes</Label>
                <Textarea
                  id="edit-note"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="What did you verify? Any issues?"
                  rows={3}
                  disabled={saving}
                />
              </div>

              {saveError && (
                <p className="text-sm text-destructive" role="alert">
                  {saveError}
                </p>
              )}
            </div>
          ) : (
            <ValidationContent
              validatedAt={displayValidatedAt}
              status={displayStatus}
              displayPrevStatus={displayPrevStatus}
              validatedBy={validatedBy}
              displayNote={displayNote}
            />
          )}

          <DialogFooter>
            {editing ? (
              <>
                <Button variant="ghost" onClick={cancelEditing} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={saveEdit} disabled={saving || !event}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <>
                {canEdit && event && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRevertOpen(true)}
                    className="text-destructive hover:text-destructive mr-auto"
                  >
                    Revert
                  </Button>
                )}
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={startEditing}
                    disabled={!event || loading}
                  >
                    Edit
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
                  Close
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revert confirmation dialog */}
      <Dialog open={revertOpen} onOpenChange={setRevertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revert Validation</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              This will remove the validation event and restore the status back to{" "}
              <span className="font-semibold capitalize">
                {event?.prev_status ?? "unknown"}
              </span>
              .
            </p>
            <p className="text-muted-foreground">This action cannot be undone.</p>
          </div>
          {revertError && (
            <p className="text-sm text-destructive" role="alert">
              {revertError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRevertOpen(false)
                setRevertError(null)
              }}
              disabled={reverting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={doRevert} disabled={reverting}>
              {reverting ? "Reverting…" : "Revert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
