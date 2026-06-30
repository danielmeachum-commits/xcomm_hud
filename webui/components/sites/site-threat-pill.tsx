"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

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
  EMCON_LEVELS,
  FPCON_LEVELS,
  emconClasses,
  emconLabel,
  fpconClasses,
  fpconLabel,
} from "@/lib/threat-level"
import { cn } from "@/lib/utils"
import type { Emcon, Fpcon } from "@/lib/types"

type Kind = "fpcon" | "emcon"
type Level = Fpcon | Emcon

interface Props {
  siteId: number
  siteName: string
  kind: Kind
  level: Level
  size?: "sm" | "md"
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

function pillClasses(kind: Kind, level: Level): { bg: string; text: string; ring: string } {
  if (kind === "fpcon") {
    const c = fpconClasses(level as Fpcon)
    return { bg: c.bg, text: c.text, ring: c.ring }
  }
  const c = emconClasses(level as Emcon)
  return { bg: c.bg, text: c.text, ring: "ring-transparent" }
}

function pillLabel(kind: Kind, level: Level): string {
  return kind === "fpcon"
    ? `FPCON ${fpconLabel(level as Fpcon)}`
    : emconLabel(level as Emcon)
}

export function SiteThreatPill({ siteId, siteName, kind, level, size = "md" }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Level>(level)
  const [note, setNote] = useState("")
  const [whenLocal, setWhenLocal] = useState(() => toLocalInput(new Date()))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(level)
      setNote("")
      setWhenLocal(toLocalInput(new Date()))
      setError(null)
    }
  }, [open, level])

  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"
  const classes = pillClasses(kind, level)
  const options: Level[] = kind === "fpcon" ? (FPCON_LEVELS as Level[]) : (EMCON_LEVELS as Level[])

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { level: draft, note: note || null }
      const entered = new Date(whenLocal).getTime()
      if (Math.abs(entered - Date.now()) > 60 * 1000) {
        body.validated_at = new Date(whenLocal).toISOString()
      }
      const res = await fetch(`/api/be/sites/${siteId}/${kind}`, {
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
        title={`Tap to change ${kind.toUpperCase()}`}
        className={cn(
          "rounded-md font-bold uppercase tracking-wider ring-1 ring-inset transition-colors hover:brightness-110",
          padding,
          classes.bg,
          classes.text,
          classes.ring,
        )}
      >
        {pillLabel(kind, level)}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Change {kind.toUpperCase()} — {siteName}
            </DialogTitle>
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
              <Label>New level</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {options.map((opt) => {
                  const c = pillClasses(kind, opt)
                  const selected = draft === opt
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDraft(opt)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors",
                        selected
                          ? "border-foreground bg-accent"
                          : "border-input hover:bg-accent/50",
                      )}
                      disabled={pending}
                    >
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset",
                          c.bg,
                          c.text,
                          c.ring,
                        )}
                      >
                        {pillLabel(kind, opt)}
                      </span>
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
            <Button onClick={submit} disabled={pending || draft === level}>
              {pending ? "Recording…" : "Record change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
