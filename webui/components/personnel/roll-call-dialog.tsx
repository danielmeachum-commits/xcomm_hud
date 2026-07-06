"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ClipboardCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  PERSONNEL_STATUSES,
  PERSONNEL_STATUS_LABELS,
  type PersonnelStatus,
} from "@/lib/personnel-data"
import type { Personnel, Site } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  site: Site
  personnel: Personnel[]
}

interface Row {
  /** Verified/accounted-for this muster. */
  verified: boolean
  /** The status the operator affirms — defaults to the current status. */
  status: PersonnelStatus
}

// Traveling needs a destination, which a site muster can't sensibly pick, so
// it's left out of the roll-call options.
const ROLL_CALL_STATUSES = PERSONNEL_STATUSES.filter((s) => s !== "traveling")

/**
 * Accountability muster: validate each person's current status. Confirm it's
 * accurate (check the box) or correct it (pick the right status). Confirming
 * re-affirms the current status with a fresh timestamp; a correction applies
 * the new one. On-site keeps wherever the person already is, or this site when
 * newly set on-site. Untouched rows are left alone.
 */
export function RollCallDialog({ site, personnel }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<number, Row>>({})

  const isOnSiteHere = (p: Personnel) =>
    p.current_status === "on_site" && p.current_site_id === site.id

  const muster = useMemo(() => {
    const list = personnel.filter(
      (p) => p.assigned_site_id === site.id || isOnSiteHere(p),
    )
    return list.sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(
        `${b.last_name} ${b.first_name}`,
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personnel, site.id])

  // Seed each row from the person's current status when the drawer opens.
  useEffect(() => {
    if (!open) return
    const seed: Record<number, Row> = {}
    for (const p of muster) {
      seed[p.id] = { verified: false, status: p.current_status }
    }
    setRows(seed)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const verifiedCount = muster.filter((p) => rows[p.id]?.verified).length

  function toggleVerified(id: number) {
    setRows((r) => ({ ...r, [id]: { ...r[id], verified: !r[id].verified } }))
  }

  function setStatus(id: number, status: PersonnelStatus) {
    // Picking a status is itself an act of accounting, so mark it verified.
    setRows((r) => ({ ...r, [id]: { status, verified: true } }))
  }

  function confirmAll() {
    setRows((r) => {
      const next = { ...r }
      for (const p of muster) {
        next[p.id] = { verified: true, status: p.current_status }
      }
      return next
    })
  }

  function clearAll() {
    setRows((r) => {
      const next = { ...r }
      for (const p of muster) {
        next[p.id] = { verified: false, status: p.current_status }
      }
      return next
    })
  }

  async function bulk(personIds: number[], status: string, siteId: number | null) {
    if (personIds.length === 0) return
    const res = await fetch(`/api/be/personnel/checkin-bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_ids: personIds,
        status,
        site_id: siteId,
        note: "Roll call",
        changed_at: new Date().toISOString(),
      }),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? "Roll call failed")
    }
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      // Group verified people by (status, site) so each combination is one
      // request. On-site keeps their existing site, or this site when newly set.
      const groups = new Map<string, number[]>()
      for (const p of muster) {
        const row = rows[p.id]
        if (!row?.verified) continue
        let siteId: number | null = null
        if (row.status === "on_site") {
          siteId =
            p.current_status === "on_site" && p.current_site_id != null
              ? p.current_site_id
              : site.id
        }
        const key = `${row.status}|${siteId ?? ""}`
        const list = groups.get(key) ?? []
        list.push(p.id)
        groups.set(key, list)
      }

      if (groups.size === 0) {
        setError("Confirm or correct at least one person")
        setPending(false)
        return
      }

      for (const [key, ids] of groups) {
        const [status, siteStr] = key.split("|")
        await bulk(ids, status, siteStr ? Number(siteStr) : null)
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
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) setError(null)
        setOpen(v)
      }}
    >
      <SheetTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5">
            <ClipboardCheck className="size-3.5" />
            Roll call
          </Button>
        }
      />
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Roll call — {site.name}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 pb-4">
          {muster.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No one is assigned or on-site here to muster.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {verifiedCount} / {muster.length} accounted for
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="underline disabled:opacity-50"
                    onClick={confirmAll}
                    disabled={pending}
                  >
                    Confirm all
                  </button>
                  <button
                    type="button"
                    className="underline disabled:opacity-50"
                    onClick={clearAll}
                    disabled={pending}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Check the box if a person’s status is accurate, or pick the
                right status to correct it.
              </p>
              <ul className="space-y-1">
                {muster.map((p) => {
                  const row = rows[p.id]
                  if (!row) return null
                  const corrected = row.status !== p.current_status
                  return (
                    <li
                      key={p.id}
                      className={cn(
                        "flex items-center gap-3 rounded-md border px-3 py-2",
                        row.verified && !corrected && "border-emerald-500/40 bg-emerald-500/5",
                        row.verified && corrected && "border-amber-500/40 bg-amber-500/5",
                        !row.verified && "border-border",
                      )}
                    >
                      <Checkbox
                        checked={row.verified}
                        onCheckedChange={() => toggleVerified(p.id)}
                        disabled={pending}
                        aria-label={`Accurate — ${p.last_name}, ${p.first_name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 truncate text-sm">
                          <span className="truncate">
                            {p.rank ? `${p.rank} ` : ""}
                            {p.last_name}, {p.first_name}
                          </span>
                          {p.is_guest && (
                            <Badge
                              variant="secondary"
                              className="px-1.5 py-0 text-[10px] uppercase"
                            >
                              Guest
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Current: {PERSONNEL_STATUS_LABELS[p.current_status]}
                          {isOnSiteHere(p) ? " (here)" : ""}
                        </div>
                      </div>
                      <select
                        value={row.status}
                        onChange={(e) =>
                          setStatus(p.id, e.target.value as PersonnelStatus)
                        }
                        disabled={pending}
                        className={cn(
                          "h-8 shrink-0 rounded-md border border-input bg-background px-2 text-xs",
                          corrected && "border-amber-500/60 font-medium",
                        )}
                      >
                        {ROLL_CALL_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {PERSONNEL_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <SheetFooter>
          <Button
            onClick={submit}
            disabled={pending || muster.length === 0 || verifiedCount === 0}
          >
            {pending
              ? "Recording…"
              : `Record roll call${verifiedCount > 0 ? ` (${verifiedCount})` : ""}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
