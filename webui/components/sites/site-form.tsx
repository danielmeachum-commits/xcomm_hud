"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import TransportBadge from "@/components/8starlabs-ui/transport-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  EMCON_LEVELS,
  FPCON_LEVELS,
  emconLabel,
  fpconLabel,
} from "@/lib/threat-level"
import type { Emcon, Fpcon, Site } from "@/lib/types"

interface Props {
  /** When provided, the form edits this site instead of creating a new one. */
  site?: Site
  triggerLabel?: string
}

export function SiteForm({ site, triggerLabel }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = !!site

  const [draft, setDraft] = useState({
    name: site?.name ?? "",
    location_label: site?.location_label ?? "",
    fpcon: (site?.fpcon ?? "normal") as Fpcon,
    emcon: (site?.emcon ?? "a") as Emcon,
    show_fpcon: site?.show_fpcon ?? true,
    show_emcon: site?.show_emcon ?? true,
    lat: site?.lat?.toString() ?? "",
    lon: site?.lon?.toString() ?? "",
    notes: site?.notes ?? "",
  })

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const body = {
        name: draft.name,
        location_label: draft.location_label || null,
        fpcon: draft.fpcon,
        emcon: draft.emcon,
        show_fpcon: draft.show_fpcon,
        show_emcon: draft.show_emcon,
        lat: draft.lat ? Number(draft.lat) : null,
        lon: draft.lon ? Number(draft.lon) : null,
        notes: draft.notes || null,
      }
      const url = editing ? `/api/be/sites/${site!.id}` : "/api/be/sites"
      const method = editing ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to save site")
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant={editing ? "outline" : "default"}>
            {triggerLabel ?? (editing ? "Edit site" : "Add site")}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${site!.name}` : "Add site"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location_label">Location label</Label>
            <Input
              id="location_label"
              value={draft.location_label}
              onChange={(e) =>
                setDraft({ ...draft, location_label: e.target.value })
              }
              disabled={pending}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fpcon">FPCON</Label>
              <select
                id="fpcon"
                value={draft.fpcon}
                onChange={(e) =>
                  setDraft({ ...draft, fpcon: e.target.value as Fpcon })
                }
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {FPCON_LEVELS.map((f) => (
                  <option key={f} value={f}>
                    {fpconLabel(f)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emcon">EMCON</Label>
              <select
                id="emcon"
                value={draft.emcon}
                onChange={(e) =>
                  setDraft({ ...draft, emcon: e.target.value as Emcon })
                }
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {EMCON_LEVELS.map((e) => (
                  <option key={e} value={e}>
                    {emconLabel(e)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <TransportBadge
              fpcon={draft.show_fpcon ? draft.fpcon : undefined}
              emcon={draft.show_emcon ? draft.emcon : undefined}
            />
            <label className="inline-flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={draft.show_fpcon}
                onChange={(e) =>
                  setDraft({ ...draft, show_fpcon: e.target.checked })
                }
                disabled={pending}
              />
              Show FPCON
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={draft.show_emcon}
                onChange={(e) =>
                  setDraft({ ...draft, show_emcon: e.target.checked })
                }
                disabled={pending}
              />
              Show EMCON
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lat">Latitude</Label>
              <Input
                id="lat"
                value={draft.lat}
                onChange={(e) => setDraft({ ...draft, lat: e.target.value })}
                inputMode="decimal"
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lon">Longitude</Label>
              <Input
                id="lon"
                value={draft.lon}
                onChange={(e) => setDraft({ ...draft, lon: e.target.value })}
                inputMode="decimal"
                disabled={pending}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              disabled={pending}
              rows={3}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
