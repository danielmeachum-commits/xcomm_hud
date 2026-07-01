"use client"

import { useEffect, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Event } from "@/lib/types"

interface Props {
  event: Event | null
  onClose: () => void
  onSaved: (updated: Event) => void
}

export function EventEditNoteDialog({ event, onClose, onSaved }: Props) {
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNote(event?.note ?? "")
    setError(null)
  }, [event])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!event) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Save failed (${res.status})`)
      }
      const updated = (await res.json()) as Event
      onSaved(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={event !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-24"
            />
            <p className="text-[10px] text-muted-foreground">
              Editing marks the event as amended; the original event
              timestamp is preserved.
            </p>
          </div>
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
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
