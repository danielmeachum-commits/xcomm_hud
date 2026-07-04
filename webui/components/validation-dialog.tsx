"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { ValidationHistory } from "@/components/services/validation-history"
import { LocalTime } from "@/components/time-display"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ViewTabs } from "@/components/ui/view-tabs"
import {
  GATEWAY_STATUS_CATEGORIES,
  SERVICE_STATUS_CATEGORIES,
  statusLabel,
  statusToIndicatorState,
} from "@/lib/status"
import { formatZulu } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { AnyStatus, Event, GatewayStatus } from "@/lib/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "service" | "gateway" | "service_gateway"
  subjectId: number
  subjectName: string
  /** Second subject id used only for `service_gateway` (matrix cell)
   *  validations — the gateway id for the (service, gateway) pair. */
  secondSubjectId?: number
  /** Human-readable name for the secondary subject (gateway) — rendered
   *  next to the primary subject in the cell dialog header. */
  secondSubjectName?: string
  /** Live status of the secondary subject (gateway) — drives a second
   *  indicator so the operator can see the gateway's current shape. */
  secondSubjectStatus?: GatewayStatus
  /** Stored status — this is what was last validated. */
  currentStatus: AnyStatus
  lastValidatedAt: string | null
  lastValidatedBy: string | null
  /** Optional whitelist from the service template; if omitted, all are allowed. */
  allowedStatuses?: AnyStatus[] | null
}

type TabKey = "record" | "history"

/** "YYYY-MM-DDTHH:mm" — value format for <input type="datetime-local">. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

export function ValidationDialog({
  open,
  onOpenChange,
  kind,
  subjectId,
  subjectName,
  secondSubjectId,
  secondSubjectName,
  secondSubjectStatus,
  currentStatus,
  lastValidatedAt,
  lastValidatedBy,
  allowedStatuses,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>("record")
  const [status, setStatus] = useState<AnyStatus>(currentStatus)
  const [note, setNote] = useState("")
  const categories =
    kind === "gateway" ? GATEWAY_STATUS_CATEGORIES : SERVICE_STATUS_CATEGORIES
  const [whenLocal, setWhenLocal] = useState<string>(() => toLocalInput(new Date()))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Cascade behaviour only applies to gateway + local-service validation
  // (drives R8/R9/R10 for gateways, R10/R11 for services). Cell validations
  // never cascade, so the checkbox is hidden and the state stays true.
  const supportsCascade = kind === "service" || kind === "gateway"
  const [cascade, setCascade] = useState(true)
  const [history, setHistory] = useState<Event[] | null>(null)
  const [historyPending, setHistoryPending] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // Reset when the dialog opens so the previewed time is current and any
  // prior selection doesn't bleed across sessions.
  useEffect(() => {
    if (open) {
      setTab("record")
      setStatus(currentStatus)
      setNote("")
      setWhenLocal(toLocalInput(new Date()))
      setError(null)
      setCascade(true)
      setHistory(null)
      setHistoryError(null)
    }
  }, [open, currentStatus])

  // Lazy-fetch history the first time the user opens the History tab in a
  // given session — keeps the common "just record it" path free of an extra
  // round trip.
  useEffect(() => {
    if (!open || tab !== "history" || history !== null || historyPending) return
    let cancelled = false
    setHistoryPending(true)
    setHistoryError(null)
    const params = new URLSearchParams({
      subject_kind: kind,
      subject_id: String(subjectId),
      limit: "100",
    })
    // For cells, narrow to this specific (service, gateway) pair — the
    // events endpoint accepts second_subject_id starting migration 0016.
    if (kind === "service_gateway" && secondSubjectId !== undefined) {
      params.set("second_subject_id", String(secondSubjectId))
    }
    fetch(`/api/be/events?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load history")
        return (await res.json()) as Event[]
      })
      .then((rows) => {
        if (!cancelled) setHistory(rows)
      })
      .catch((e) => {
        if (!cancelled) {
          setHistoryError(e instanceof Error ? e.message : "Unknown error")
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tab, kind, subjectId, secondSubjectId, history, historyPending])

  // For the live preview boxes — show what the user is about to record.
  const whenIso = (() => {
    try {
      return new Date(whenLocal).toISOString()
    } catch {
      return new Date().toISOString()
    }
  })()

  async function submit() {
    setPending(true)
    setError(null)
    try {
      let endpoint: string
      if (kind === "service") {
        endpoint = `/api/be/services/${subjectId}/validate`
      } else if (kind === "gateway") {
        endpoint = `/api/be/gateways/${subjectId}/validate`
      } else {
        // service_gateway — matrix cell for (service, gateway).
        endpoint = `/api/be/services/${subjectId}/gateways/${secondSubjectId}/validate`
      }
      const body: Record<string, unknown> = {
        status,
        note: note || null,
      }
      // Send the override only if it actually differs from "now" by more
      // than a minute, so the typical case doesn't pin to an old timestamp.
      const enteredMs = new Date(whenLocal).getTime()
      const nowMs = Date.now()
      if (Math.abs(enteredMs - nowMs) > 60 * 1000) {
        body.validated_at = new Date(whenLocal).toISOString()
      }
      // Include cascade only when the backend endpoint understands it —
      // the cell validation endpoint doesn't take it.
      if (supportsCascade) {
        body.cascade = cascade
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Validation failed")
      }
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>
            Validate {subjectName}
            {kind === "service_gateway" && secondSubjectName && (
              <>
                {" "}
                <span className="text-muted-foreground">via</span>{" "}
                {secondSubjectName}
              </>
            )}
          </DialogTitle>
          {/* Live status pills — primary is what we're about to validate;
           *  secondary shows the gateway's current shape for cell dialogs. */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <StatusIndicator
                state={statusToIndicatorState(currentStatus)}
                size="sm"
              />
              <span className="uppercase tracking-wider">
                {statusLabel(currentStatus)}
              </span>
            </span>
            {kind === "service_gateway" && secondSubjectStatus && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider">
                    {secondSubjectName ?? "gateway"}
                  </span>
                  <StatusIndicator
                    state={statusToIndicatorState(secondSubjectStatus)}
                    size="sm"
                  />
                  <span className="uppercase tracking-wider">
                    {statusLabel(secondSubjectStatus)}
                  </span>
                </span>
              </>
            )}
            {lastValidatedAt && (
              <>
                <span>·</span>
                <LocalTime iso={lastValidatedAt} />
                {lastValidatedBy && <span>by {lastValidatedBy}</span>}
              </>
            )}
          </div>
        </DialogHeader>

        <ViewTabs<TabKey>
          value={tab}
          onChange={setTab}
          variant="line"
          options={[
            { value: "record", label: "Record" },
            { value: "history", label: "History" },
          ]}
        />

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
          {tab === "record" ? (
            <div className="space-y-4">
              {/* When did this happen */}
              <div className="space-y-1.5">
                <Label htmlFor="when">When (local time)</Label>
                <Input
                  id="when"
                  type="datetime-local"
                  value={whenLocal}
                  onChange={(e) => setWhenLocal(e.target.value)}
                  disabled={pending}
                />
                <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-2 text-[11px]">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Local</div>
                    <div className="font-mono"><LocalTime iso={whenIso} /></div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Zulu</div>
                    <div className="font-mono">{formatZulu(whenIso)}</div>
                  </div>
                </div>
              </div>

              {/* Status picker — grouped by category, optionally restricted by template. */}
              <div className="space-y-1.5">
                <Label>Status</Label>
                <div className="flex flex-col gap-3">
                  {categories.map((cat) => {
                    const options = cat.values.filter(
                      (s) => !allowedStatuses || allowedStatuses.includes(s),
                    )
                    if (options.length === 0) return null
                    return (
                      <div key={cat.key} className="flex flex-col gap-1.5">
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {cat.label}
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {options.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setStatus(s)}
                              className={cn(
                                "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                                status === s
                                  ? "border-foreground bg-accent"
                                  : "border-input hover:bg-accent/50",
                              )}
                              disabled={pending}
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
                    )
                  })}
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="note">Notes</Label>
                <Textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What did you verify? Any issues?"
                  rows={3}
                  disabled={pending}
                />
              </div>

              {/* Cascade to service cells — only relevant for gateway or
               *  local-service validation. Uncheck to record the row status
               *  without touching individual matrix cells. */}
              {supportsCascade && (
                <label className="flex items-start gap-2 rounded-md border bg-muted/20 p-3 text-xs cursor-pointer">
                  <Checkbox
                    checked={cascade}
                    onCheckedChange={(v) => setCascade(Boolean(v))}
                    disabled={pending}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      Cascade to service cells
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {kind === "gateway"
                        ? "Reset every matrix cell for this gateway per R8/R9/R10 (active/degraded → unknown; ready → ready; down/offline → matching)."
                        : "Clamp matrix cells that exceed this new local status (R11); force cells to match if this is down/offline (R10)."}
                    </span>
                  </div>
                </label>
              )}

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {historyPending && (
                <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                  Loading history…
                </div>
              )}
              {historyError && (
                <p className="text-sm text-destructive" role="alert">
                  {historyError}
                </p>
              )}
              {!historyPending && !historyError && (
                <ValidationHistory validations={history ?? []} />
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={pending || tab !== "record"}
            title={tab === "record" ? undefined : "Switch to Record to submit"}
          >
            {pending ? "Recording…" : "Record validation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
