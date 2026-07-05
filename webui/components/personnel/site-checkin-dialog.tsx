"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

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
import { PERSONNEL_STATUS_LABELS } from "@/lib/personnel-data"
import type { Personnel, Site } from "@/lib/types"

interface Props {
  site: Site
  /** Everyone in the workspace — the picker excludes people already on-site here. */
  personnel: Personnel[]
}

/**
 * Check any workspace member in as on-site at this site. Used from the site
 * personnel tab to log a visitor (or an assigned member arriving). Reuses the
 * per-person check-in endpoint.
 */
export function SiteCheckInDialog({ site, personnel }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [personId, setPersonId] = useState("")
  const [note, setNote] = useState("")

  // Anyone not already signed in on-site here is a candidate.
  const candidates = useMemo(
    () =>
      personnel
        .filter(
          (p) =>
            !(p.current_status === "on_site" && p.current_site_id === site.id),
        )
        .sort((a, b) =>
          `${a.last_name} ${a.first_name}`.localeCompare(
            `${b.last_name} ${b.first_name}`,
          ),
        ),
    [personnel, site.id],
  )

  async function submit() {
    if (!personId) {
      setError("Pick a person to check in")
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/personnel/${personId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "on_site",
          site_id: site.id,
          note: note || null,
          changed_at: new Date().toISOString(),
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to check in")
      }
      setPersonId("")
      setNote("")
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setError(null)
          setPersonId("")
          setNote("")
        }
        setOpen(v)
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            Check someone in
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check in at {site.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="checkin-person">Person</Label>
            <select
              id="checkin-person"
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
              disabled={pending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Select a person —</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.rank ? `${p.rank} ` : ""}
                  {p.last_name}, {p.first_name}
                  {p.current_status !== "unknown"
                    ? ` · ${PERSONNEL_STATUS_LABELS[p.current_status]}`
                    : ""}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Sets their status to On site at {site.name} as of now.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="checkin-note">Note (optional)</Label>
            <Textarea
              id="checkin-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
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
          <Button onClick={submit} disabled={pending || !personId}>
            {pending ? "Checking in…" : "Check in"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
