"use client"

import { useEffect, useState } from "react"

import {
  EventTimeField,
  localInputToIso,
  toLocalInput,
} from "@/components/events/event-time-field"
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
import type { Event } from "@/lib/types"

interface Props {
  event: Event | null
  onClose: () => void
  onSaved: (updated: Event) => void
}

/**
 * Edit an event's note — and, for a custom (general) event, when it happened.
 *
 * The time is only editable on custom events. A status validation's time feeds
 * the subject's live status (the API moves it if that validation is the latest
 * one), so correcting it belongs in the validation flow, not a note editor.
 * Either edit is stamped `edited_at`, which the log shows as amended.
 */
export function EventEditNoteDialog({ event, onClose, onSaved }: Props) {
  const [note, setNote] = useState("")
  const [whenLocal, setWhenLocal] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timeEditable = event?.event_type === "general"
  const originalLocal = event ? toLocalInput(new Date(event.validated_at)) : ""

  useEffect(() => {
    setNote(event?.note ?? "")
    setWhenLocal(event ? toLocalInput(new Date(event.validated_at)) : "")
    setError(null)
  }, [event])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!event) return
    // The API replaces the note on every edit, so it is always sent — leaving
    // it out to change only the time would erase it.
    const body: Record<string, unknown> = { note: note.trim() || null }
    if (timeEditable && whenLocal !== originalLocal) {
      const iso = localInputToIso(whenLocal)
      if (!iso) {
        setError("Enter a valid date and time.")
        return
      }
      body.validated_at = iso
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `Save failed (${res.status})`)
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
          <DialogTitle>{timeEditable ? "Edit event" : "Edit note"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {timeEditable && (
            <EventTimeField
              id="edit-event-when"
              value={whenLocal}
              onChange={setWhenLocal}
              disabled={pending}
            />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-24"
            />
            <p className="text-[10px] text-muted-foreground">
              Editing marks the event as amended.
              {!timeEditable &&
                " A status validation keeps its original time; correct it from the validation itself."}
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
              {pending ? "Saving…" : timeEditable ? "Save event" : "Save note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
