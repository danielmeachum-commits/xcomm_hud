"use client"

import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { Event } from "@/lib/types"

interface Props {
  ids: number[] | null
  onClose: () => void
  onHidden: (updated: Event[]) => void
}

export function EventHideConfirmDialog({ ids, onClose, onHidden }: Props) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!ids || ids.length === 0) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/be/events/bulk-hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Hide failed (${res.status})`)
      }
      const updated = (await res.json()) as Event[]
      onHidden(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  const count = ids?.length ?? 0

  return (
    <Dialog open={ids !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hide {count} event{count === 1 ? "" : "s"}?</DialogTitle>
          <DialogDescription>
            Hidden events are excluded from the default feed but remain in the
            audit log. An admin can restore them from the API.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Hiding…" : "Hide events"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
