"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
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
  SITE_STATUS_VALUES,
  statusBadgeClass,
  statusLabel,
  statusToIndicatorState,
} from "@/lib/status"
import { cn } from "@/lib/utils"
import type { SiteStatus } from "@/lib/types"

interface Props {
  siteId: number
  siteName: string
  status: SiteStatus
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

export function SiteStatusPill({ siteId, siteName, status }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SiteStatus>(status)
  const [note, setNote] = useState("")
  const [whenLocal, setWhenLocal] = useState(() => toLocalInput(new Date()))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(status)
      setNote("")
      setWhenLocal(toLocalInput(new Date()))
      setError(null)
    }
  }, [open, status])

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { status: draft, note: note || null }
      const entered = new Date(whenLocal).getTime()
      if (Math.abs(entered - Date.now()) > 60 * 1000) {
        body.validated_at = new Date(whenLocal).toISOString()
      }
      const res = await fetch(`/api/be/sites/${siteId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to update")
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Tap to change site status"
        className={cn(
          "inline-flex items-center gap-2 rounded-md border px-2 py-0.5 text-xs uppercase tracking-wider transition-colors hover:brightness-110",
          statusBadgeClass(status),
        )}
      >
        <StatusIndicator state={statusToIndicatorState(status)} size="sm" />
        <span>{statusLabel(status)}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change status — {siteName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="when">When (local time)</Label>
              <Input
                id="when"
                type="datetime-local"
                value={whenLocal}
                onChange={(e) => setWhenLocal(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label>New status</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {SITE_STATUS_VALUES.map((opt) => {
                  const selected = draft === opt
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDraft(opt)}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-2 py-2 text-xs transition-colors",
                        selected
                          ? "border-foreground bg-accent"
                          : "border-input hover:bg-accent/50",
                      )}
                      disabled={pending}
                    >
                      <StatusIndicator
                        state={statusToIndicatorState(opt)}
                        size="sm"
                      />
                      <span>{statusLabel(opt)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Notes</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reason for the change"
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
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || draft === status}>
              {pending ? "Recording…" : "Record change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
