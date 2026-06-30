"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { STATUS_VALUES, statusLabel, statusToIndicatorState } from "@/lib/status"
import { formatLocal, formatZulu } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { StatusValue } from "@/lib/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "service" | "gateway" — sets the endpoint path. */
  kind: "service" | "gateway"
  subjectId: number
  subjectName: string
  currentStatus: StatusValue
  lastValidatedAt: string | null
  lastValidatedBy: string | null
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
}: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<StatusValue>(currentStatus)
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = new Date().toISOString()

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const endpoint =
        kind === "service"
          ? `/api/be/services/${subjectId}/validate`
          : `/api/be/gateways/${subjectId}/validate`
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: note || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Validation failed")
      }
      onOpenChange(false)
      setNote("")
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
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="text-muted-foreground">Recording validation at</div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Local</div>
                <div className="font-mono">{formatLocal(now)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Zulu</div>
                <div className="font-mono">{formatZulu(now)}</div>
              </div>
            </div>
            {lastValidatedAt && (
              <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
                Last validation: {formatZulu(lastValidatedAt)}{" "}
                {lastValidatedBy ? `by ${lastValidatedBy}` : ""}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STATUS_VALUES.map((s) => (
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
                  <StatusIndicator state={statusToIndicatorState(s)} size="sm" />
                  {statusLabel(s)}
                </button>
              ))}
            </div>
          </div>

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
