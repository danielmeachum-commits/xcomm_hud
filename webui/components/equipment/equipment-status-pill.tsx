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
import { EQUIPMENT_STATUS_VALUES } from "@/lib/equipment-meta"
import { statusBadgeClass, statusLabel, statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type { EquipmentStatus } from "@/lib/types"

interface Props {
  /** "equipment" posts to /equipment/{id}/status; "capability" posts to
   *  /capabilities/{id}/status. Same dialog either way. */
  target: "equipment" | "capability"
  id: number
  label: string
  status: EquipmentStatus
  lastValidatedAt?: string | null
  lastValidatedBy?: string | null
  className?: string
  /** Hide the text, leaving just the dot — used in dense canvas nodes. */
  compact?: boolean
  /** Override the pill text. Where several capabilities sit side by side,
   *  naming the capability is far more useful than repeating the status,
   *  which the dot already carries. */
  displayText?: string
}

export function EquipmentStatusPill({
  target,
  id,
  label,
  status,
  lastValidatedAt = null,
  lastValidatedBy = null,
  className,
  compact = false,
  displayText,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState("")

  async function submit(next: EquipmentStatus) {
    setPending(true)
    setError(null)
    try {
      const path =
        target === "equipment"
          ? `/api/be/equipment/${id}/status`
          : `/api/be/capabilities/${id}/status`
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, note: note.trim() || null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail ?? `Request failed (${res.status})`)
      }
      setOpen(false)
      setNote("")
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        onPointerDownCapture={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(true)
        }}
        title="Tap to set status"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors hover:brightness-110",
          statusBadgeClass(status),
          className,
        )}
      >
        <StatusIndicator state={statusToIndicatorState(status)} />
        {!compact && <span>{displayText ?? statusLabel(status)}</span>}
      </button>

      <Dialog open={open} onOpenChange={setOpen} disablePointerDismissal>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>

          {/* The reassurance that matters: this is the one place in the app
              where someone might expect a status change to ripple outward. */}
          <p className="text-xs text-muted-foreground">
            Equipment status is advisory — setting this does not change any
            service or gateway status. Where it disagrees with what&apos;s
            reported, the site will show the difference for an operator to act
            on.
          </p>

          <div className="grid grid-cols-3 gap-2 pt-1">
            {EQUIPMENT_STATUS_VALUES.map((s) => (
              <Button
                key={s}
                type="button"
                variant={s === status ? "secondary" : "outline"}
                size="sm"
                disabled={pending}
                onClick={() => submit(s)}
                className={cn("justify-start gap-2", statusBadgeClass(s))}
              >
                <StatusIndicator state={statusToIndicatorState(s)} />
                <span className="truncate text-xs">{statusLabel(s)}</span>
              </Button>
            ))}
          </div>

          <div className="pt-1">
            <label className="mb-1 block text-xs font-medium">
              Note <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. data port inop, JCN pending"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          {lastValidatedAt && (
            <p className="text-[10px] font-mono text-muted-foreground">
              Last set {new Date(lastValidatedAt).toLocaleString()}
              {lastValidatedBy ? ` · ${lastValidatedBy}` : ""}
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
