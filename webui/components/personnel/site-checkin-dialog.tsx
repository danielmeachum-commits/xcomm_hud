"use client"

import { useMemo, useState, type ReactElement } from "react"
import { useRouter } from "next/navigation"
import { LogIn, LogOut, Plus, UserPlus, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EscortCombobox } from "@/components/personnel/escort-combobox"
import {
  PERSONNEL_STATUSES,
  PERSONNEL_STATUS_LABELS,
  type PersonnelStatus,
} from "@/lib/personnel-data"
import type { Personnel, Site } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  site: Site
  /** Everyone in the workspace — candidates are derived per mode. */
  personnel: Personnel[]
  /** Which tab the drawer opens on. Defaults to check-in. */
  initialMode?: Mode
  /** Custom trigger; defaults to a mode-colored Check in / Check out button. */
  trigger?: ReactElement
}

type Mode = "in" | "out"

/** A visitor being signed in who isn't on the roster yet. Created on submit. */
interface PendingGuest {
  /** Local key for list rendering — not a DB id. */
  key: number
  first_name: string
  last_name: string
  affiliation: string
  escort: string
}

const EMPTY_GUEST = { first_name: "", last_name: "", affiliation: "", escort: "" }

// Check-out applies a site-less away status, so the destination-bearing
// on_site / traveling statuses aren't offered here.
const CHECKOUT_STATUSES = PERSONNEL_STATUSES.filter(
  (s) => s !== "on_site" && s !== "traveling",
)

/**
 * Check people in or out at this site. Tap names to select multiple roster
 * members; check-in also lets you add ad-hoc guests/visitors. Selections are
 * applied in a single bulk request.
 */
export function SiteCheckInDialog({
  site,
  personnel,
  initialMode = "in",
  trigger,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [note, setNote] = useState("")
  const [outStatus, setOutStatus] = useState<PersonnelStatus>("off_site")

  // Guest sub-form (check-in only): a running list plus the draft row.
  const [guests, setGuests] = useState<PendingGuest[]>([])
  const [guestKey, setGuestKey] = useState(1)
  const [showGuestForm, setShowGuestForm] = useState(false)
  const [guestDraft, setGuestDraft] = useState(EMPTY_GUEST)

  // Check-in candidates = real members not already on-site here.
  // Check-out candidates = whoever is currently signed in on-site here.
  const candidates = useMemo(() => {
    const list =
      mode === "in"
        ? personnel.filter(
            (p) =>
              !p.is_guest &&
              !(
                p.current_status === "on_site" && p.current_site_id === site.id
              ),
          )
        : personnel.filter(
            (p) =>
              p.current_status === "on_site" && p.current_site_id === site.id,
          )
    return list.sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(
        `${b.last_name} ${b.first_name}`,
      ),
    )
  }, [personnel, site.id, mode])

  // Roster to pick a guest's escort from — real members, not other guests.
  const escortRoster = useMemo(
    () => personnel.filter((p) => !p.is_guest),
    [personnel],
  )

  const totalCount = selected.size + (mode === "in" ? guests.length : 0)

  function reset() {
    setError(null)
    setSelected(new Set())
    setNote("")
    setGuests([])
    setShowGuestForm(false)
    setGuestDraft(EMPTY_GUEST)
    setOutStatus("off_site")
  }

  function switchMode(next: Mode) {
    if (next === mode) return
    setMode(next)
    // Candidate sets differ between modes, so a carried-over selection would be
    // meaningless — clear it.
    setSelected(new Set())
    setError(null)
    setShowGuestForm(false)
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(candidates.map((p) => p.id)))
  }

  function addGuest() {
    const first = guestDraft.first_name.trim()
    const last = guestDraft.last_name.trim()
    if (!first || !last) {
      setError("Guest needs a first and last name")
      return
    }
    setError(null)
    setGuests((prev) => [
      ...prev,
      {
        key: guestKey,
        first_name: first,
        last_name: last,
        affiliation: guestDraft.affiliation.trim(),
        escort: guestDraft.escort.trim(),
      },
    ])
    setGuestKey((k) => k + 1)
    setGuestDraft(EMPTY_GUEST)
    setShowGuestForm(false)
  }

  function removeGuest(key: number) {
    setGuests((prev) => prev.filter((g) => g.key !== key))
  }

  async function createGuest(guest: PendingGuest): Promise<number> {
    const res = await fetch(`/api/be/personnel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personnel_type: "civilian",
        is_guest: true,
        branch: null,
        first_name: guest.first_name,
        last_name: guest.last_name,
        affiliation: guest.affiliation || null,
        escort: guest.escort || null,
      }),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? "Failed to add guest")
    }
    const created = (await res.json()) as Personnel
    return created.id
  }

  async function submit() {
    let guestIds: number[] = []
    if (mode === "in") {
      // Fold a filled-but-not-yet-added guest draft into the batch.
      const draftFirst = guestDraft.first_name.trim()
      const draftLast = guestDraft.last_name.trim()
      const pendingGuests = [...guests]
      if (draftFirst && draftLast) {
        pendingGuests.push({
          key: guestKey,
          first_name: draftFirst,
          last_name: draftLast,
          affiliation: guestDraft.affiliation.trim(),
          escort: guestDraft.escort.trim(),
        })
      }
      if (selected.size === 0 && pendingGuests.length === 0) {
        setError("Select at least one person or add a guest")
        return
      }
      setPending(true)
      setError(null)
      try {
        guestIds = await Promise.all(pendingGuests.map(createGuest))
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
        setPending(false)
        return
      }
    } else {
      if (selected.size === 0) {
        setError("Select at least one person to check out")
        return
      }
      setPending(true)
      setError(null)
    }

    try {
      const ids = [...selected, ...guestIds]
      const siteBearing = mode === "in"
      const res = await fetch(`/api/be/personnel/checkin-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_ids: ids,
          status: mode === "in" ? "on_site" : outStatus,
          site_id: siteBearing ? site.id : null,
          note: note || null,
          changed_at: new Date().toISOString(),
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to update statuses")
      }
      reset()
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  const verb = mode === "in" ? "Check in" : "Check out"

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (v) setMode(initialMode)
        else reset()
        setOpen(v)
      }}
    >
      <SheetTrigger
        render={
          trigger ??
          (initialMode === "out" ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
            >
              <LogOut className="size-3.5" />
              Check out
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <LogIn className="size-3.5" />
              Check in
            </Button>
          ))
        }
      />
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {mode === "in" ? `Check in at ${site.name}` : `Check out from ${site.name}`}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-4">
          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            {(["in", "out"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                disabled={pending}
                className={cn(
                  "rounded px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === m
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "in" ? "Check in" : "Check out"}
              </button>
            ))}
          </div>

          {mode === "out" && (
            <div className="space-y-1.5">
              <Label htmlFor="out-status">New status</Label>
              <select
                id="out-status"
                value={outStatus}
                onChange={(e) => setOutStatus(e.target.value as PersonnelStatus)}
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {CHECKOUT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PERSONNEL_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>People</Label>
              <div className="flex items-center gap-2 text-[11px]">
                {totalCount > 0 && (
                  <span className="text-muted-foreground">
                    {totalCount} selected
                  </span>
                )}
                {candidates.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="text-muted-foreground underline disabled:opacity-50"
                      onClick={selectAll}
                      disabled={pending}
                    >
                      Select all
                    </button>
                    {selected.size > 0 && (
                      <button
                        type="button"
                        className="text-muted-foreground underline disabled:opacity-50"
                        onClick={() => setSelected(new Set())}
                        disabled={pending}
                      >
                        Clear
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <Command className="rounded-md border border-input bg-transparent p-2">
              <CommandInput placeholder="Search…" disabled={pending} />
              <CommandList className="max-h-64 space-y-0.5 p-2">
                <CommandEmpty>
                  {mode === "in"
                    ? "No one to check in."
                    : "No one is on-site here."}
                </CommandEmpty>
                {candidates.map((p) => {
                  const isSel = selected.has(p.id)
                  return (
                    <CommandItem
                      key={p.id}
                      value={`${p.last_name} ${p.first_name} ${p.rank ?? ""} ${p.id}`}
                      data-checked={isSel}
                      onSelect={() => toggle(p.id)}
                      disabled={pending}
                      className={cn(
                        "border border-transparent",
                        isSel &&
                          "border-primary/30 bg-primary/10 font-medium text-foreground",
                      )}
                    >
                      <span>
                        {p.rank ? `${p.rank} ` : ""}
                        {p.last_name}, {p.first_name}
                      </span>
                      {p.is_guest && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          Guest
                        </Badge>
                      )}
                      {mode === "in" && p.current_status !== "unknown" && (
                        <span className="text-[11px] text-muted-foreground">
                          · {PERSONNEL_STATUS_LABELS[p.current_status]}
                        </span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandList>
            </Command>
            <p className="text-[11px] text-muted-foreground">
              Tap names to select.{" "}
              {mode === "in"
                ? `Everyone chosen is set to On site at ${site.name}.`
                : `Everyone chosen is set to ${PERSONNEL_STATUS_LABELS[outStatus]}.`}
            </p>
          </div>

          {/* Guests / visitors — check-in only */}
          {mode === "in" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Guests / visitors</Label>
                {!showGuestForm && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs"
                    onClick={() => {
                      setError(null)
                      setShowGuestForm(true)
                    }}
                    disabled={pending}
                  >
                    <UserPlus className="size-3.5" />
                    Add guest
                  </Button>
                )}
              </div>

              {guests.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {guests.map((g) => (
                    <Badge key={g.key} variant="secondary" className="gap-1 pr-1">
                      <span>
                        {g.last_name}, {g.first_name}
                        {g.affiliation ? ` · ${g.affiliation}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeGuest(g.key)}
                        disabled={pending}
                        aria-label={`Remove ${g.first_name} ${g.last_name}`}
                        className="rounded-full p-0.5 hover:bg-background/60"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              {showGuestForm && (
                <div className="space-y-2 rounded-md border border-input p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="guest-first" className="text-xs">
                        First name
                      </Label>
                      <Input
                        id="guest-first"
                        value={guestDraft.first_name}
                        onChange={(e) =>
                          setGuestDraft((g) => ({ ...g, first_name: e.target.value }))
                        }
                        disabled={pending}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="guest-last" className="text-xs">
                        Last name
                      </Label>
                      <Input
                        id="guest-last"
                        value={guestDraft.last_name}
                        onChange={(e) =>
                          setGuestDraft((g) => ({ ...g, last_name: e.target.value }))
                        }
                        disabled={pending}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="guest-affiliation" className="text-xs">
                        Affiliation / org
                      </Label>
                      <Input
                        id="guest-affiliation"
                        value={guestDraft.affiliation}
                        onChange={(e) =>
                          setGuestDraft((g) => ({ ...g, affiliation: e.target.value }))
                        }
                        disabled={pending}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Escort / POC</Label>
                      <EscortCombobox
                        value={guestDraft.escort}
                        onChange={(v) =>
                          setGuestDraft((g) => ({ ...g, escort: v }))
                        }
                        personnel={escortRoster}
                        disabled={pending}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setGuestDraft(EMPTY_GUEST)
                        setShowGuestForm(false)
                      }}
                      disabled={pending}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={addGuest}
                      disabled={pending}
                    >
                      <Plus className="size-3.5" />
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="checkin-note">Note (optional)</Label>
            <Textarea
              id="checkin-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              disabled={pending}
            />
            <p className="text-[11px] text-muted-foreground">
              Applied to every person in this batch.
            </p>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <SheetFooter>
          <Button onClick={submit} disabled={pending || totalCount === 0}>
            {pending
              ? "Saving…"
              : `${verb}${totalCount > 0 ? ` ${totalCount}` : ""}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
