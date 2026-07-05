"use client"

import { useEffect, useState, type ReactElement } from "react"
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
import {
  PERSONNEL_STATUSES,
  PERSONNEL_STATUS_LABELS,
  SITE_BEARING_STATUSES,
  type PersonnelStatus,
} from "@/lib/personnel-data"
import type { Personnel, Site } from "@/lib/types"
import { formatZulu } from "@/lib/time"

interface Props {
  person: Personnel
  sites: Site[]
  /** Custom trigger. Defaults to an outline "Check in / out" button. */
  trigger?: ReactElement
  /** Externally controlled open state (used when opening from a status pill). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Serialize a Date as the value shape a native datetime-local input expects. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Best-guess default site: current > assigned > first available. */
function defaultSiteId(person: Personnel, sites: Site[]): string {
  if (person.current_site_id) return String(person.current_site_id)
  if (person.assigned_site_id) return String(person.assigned_site_id)
  if (sites.length > 0) return String(sites[0].id)
  return ""
}

export function PersonnelCheckInDialog({
  person,
  sites,
  trigger,
  open: openProp,
  onOpenChange,
}: Props) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v)
    onOpenChange?.(v)
  }

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<PersonnelStatus>(
    person.current_status === "unknown" ? "on_site" : person.current_status,
  )
  const [siteId, setSiteId] = useState<string>(defaultSiteId(person, sites))
  const [note, setNote] = useState("")
  const [whenLocal, setWhenLocal] = useState<string>(
    toLocalInputValue(new Date()),
  )
  const [expectedLocal, setExpectedLocal] = useState<string>("")

  // Refresh defaults when the dialog opens (in case current state changed).
  useEffect(() => {
    if (open) {
      setStatus(
        person.current_status === "unknown" ? "on_site" : person.current_status,
      )
      setSiteId(defaultSiteId(person, sites))
      setNote("")
      setWhenLocal(toLocalInputValue(new Date()))
      setExpectedLocal(
        person.expected_return_at
          ? toLocalInputValue(new Date(person.expected_return_at))
          : "",
      )
      setError(null)
    }
  }, [open, person, sites])

  const whenIso = new Date(whenLocal).toISOString()
  const takesSite = SITE_BEARING_STATUSES.includes(status)
  const selectedIsAssigned =
    !!siteId &&
    person.assigned_site_id != null &&
    Number(siteId) === person.assigned_site_id
  // "Expected back" is meaningless when you're already home; hide it there and
  // for the unknown status.
  const showExpected =
    status !== "unknown" && !(status === "on_site" && selectedIsAssigned)

  async function submit(overrides?: {
    status?: PersonnelStatus
    siteId?: string
    whenIsoOverride?: string
  }) {
    setPending(true)
    setError(null)
    try {
      const effStatus = overrides?.status ?? status
      const effSite = overrides?.siteId ?? siteId
      const effWhen = overrides?.whenIsoOverride ?? whenIso
      const body: Record<string, unknown> = {
        status: effStatus,
        note: note || null,
        changed_at: effWhen,
      }
      if (SITE_BEARING_STATUSES.includes(effStatus)) {
        if (!effSite) {
          throw new Error(
            effStatus === "traveling"
              ? "Pick a destination site"
              : "Pick a site when checking in on-site",
          )
        }
        body.site_id = Number(effSite)
      }
      // Expected-back only applies when away / not at your assigned post.
      const effSelAssigned =
        !!effSite &&
        person.assigned_site_id != null &&
        Number(effSite) === person.assigned_site_id
      const wantExpected =
        effStatus !== "unknown" &&
        !(effStatus === "on_site" && effSelAssigned)
      body.expected_return_at =
        wantExpected && expectedLocal
          ? new Date(expectedLocal).toISOString()
          : null
      const res = await fetch(`/api/be/personnel/${person.id}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to update status")
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  function nowOnSite() {
    const now = new Date().toISOString()
    setStatus("on_site")
    const target = person.assigned_site_id
      ? String(person.assigned_site_id)
      : siteId
    setSiteId(target)
    setWhenLocal(toLocalInputValue(new Date()))
    void submit({ status: "on_site", siteId: target, whenIsoOverride: now })
  }

  const defaultTrigger = (
    <Button size="sm" variant="outline">
      Check in / out
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger render={trigger ?? defaultTrigger} />
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Update location — {person.last_name}, {person.first_name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {status !== "on_site" && person.assigned_site_id && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={nowOnSite}
              disabled={pending}
            >
              Check in now — on-site at assigned site
            </Button>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as PersonnelStatus)}
              disabled={pending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {PERSONNEL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PERSONNEL_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          {takesSite && (
            <div className="space-y-1.5">
              <Label htmlFor="site_id">
                {status === "traveling" ? "Destination" : "Site"}
              </Label>
              <select
                id="site_id"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— Pick a site —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.id === person.assigned_site_id ? " (assigned)" : ""}
                  </option>
                ))}
              </select>
              {status === "on_site" && (
                <p className="text-[11px] text-muted-foreground">
                  {selectedIsAssigned
                    ? "At assigned site — shows green as “On station”."
                    : "Not the assigned site — shows as “Temporarily”."}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="changed_at">When</Label>
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline"
                onClick={() => setWhenLocal(toLocalInputValue(new Date()))}
                disabled={pending}
              >
                Reset to now
              </button>
            </div>
            <Input
              id="changed_at"
              type="datetime-local"
              value={whenLocal}
              onChange={(e) => setWhenLocal(e.target.value)}
              disabled={pending}
            />
            <p className="text-[11px] text-muted-foreground">
              Zulu: {formatZulu(whenIso)}
            </p>
          </div>

          {showExpected && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="expected_return">
                  Expected back (optional)
                </Label>
                {expectedLocal && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground underline"
                    onClick={() => setExpectedLocal("")}
                    disabled={pending}
                  >
                    Clear
                  </button>
                )}
              </div>
              <Input
                id="expected_return"
                type="datetime-local"
                value={expectedLocal}
                onChange={(e) => setExpectedLocal(e.target.value)}
                disabled={pending}
              />
              <p className="text-[11px] text-muted-foreground">
                {expectedLocal
                  ? `Zulu: ${formatZulu(new Date(expectedLocal).toISOString())} · flags overdue once passed`
                  : "For accountability — leave blank if open-ended."}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea
              id="note"
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
          <Button onClick={() => submit()} disabled={pending}>
            {pending ? "Saving…" : "Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
