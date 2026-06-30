"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

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
import { Textarea } from "@/components/ui/textarea"
import {
  STATUS_CATEGORIES,
  statusLabel,
  statusToIndicatorState,
} from "@/lib/status"
import { formatZulu } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { StatusValue } from "@/lib/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "service" | "gateway"
  subjectId: number
  subjectName: string
  /** Stored status — this is what was last validated. */
  currentStatus: StatusValue
  lastValidatedAt: string | null
  lastValidatedBy: string | null
  /** Optional whitelist from the service template; if omitted, all are allowed. */
  allowedStatuses?: StatusValue[] | null
}

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
  currentStatus,
  lastValidatedAt,
  lastValidatedBy,
  allowedStatuses,
}: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<StatusValue>(currentStatus)
  const [note, setNote] = useState("")
  const [whenLocal, setWhenLocal] = useState<string>(() => toLocalInput(new Date()))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when the dialog opens so the previewed time is current and any
  // prior selection doesn't bleed across sessions.
  useEffect(() => {
    if (open) {
      setStatus(currentStatus)
      setNote("")
      setWhenLocal(toLocalInput(new Date()))
      setError(null)
    }
  }, [open, currentStatus])

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
      const endpoint =
        kind === "service"
          ? `/api/be/services/${subjectId}/validate`
          : `/api/be/gateways/${subjectId}/validate`
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Validate {subjectName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Last validation snapshot */}
          {lastValidatedAt ? (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Last validation
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <StatusIndicator
                  state={statusToIndicatorState(currentStatus)}
                  size="sm"
                />
                <span className="font-medium uppercase tracking-wider">
                  {statusLabel(currentStatus)}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Local</div>
                  <div className="font-mono"><LocalTime iso={lastValidatedAt} /></div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Zulu</div>
                  <div className="font-mono">{formatZulu(lastValidatedAt)}</div>
                </div>
              </div>
              {lastValidatedBy && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  by {lastValidatedBy}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              No prior validation on record.
            </div>
          )}

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
              {STATUS_CATEGORIES.map((cat) => {
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

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Recording…" : "Record validation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
