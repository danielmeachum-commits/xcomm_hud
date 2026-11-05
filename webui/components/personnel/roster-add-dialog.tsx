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
import type { Person, Unit } from "@/lib/types"

interface Props {
  /** The whole global roster; people already here are filtered out. */
  roster: Person[]
  /** person_ids already in this workspace. */
  present: Set<number>
  units: Unit[]
}

/**
 * Bring people already on the global roster into this workspace. Who they
 * are comes along as-is; their assignment here starts blank and is filled in
 * from their detail page.
 */
export function RosterAddDialog({ roster, present, units }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unitName = useMemo(
    () => new Map(units.map((u) => [u.id, u.name])),
    [units],
  )
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return roster.filter(
      (p) =>
        !present.has(p.id) &&
        (!q ||
          `${p.rank ?? ""} ${p.last_name} ${p.first_name}`
            .toLowerCase()
            .includes(q)),
    )
  }, [roster, present, query])

  function toggle(id: number, checked: boolean) {
    setPicked((s) => {
      const next = new Set(s)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function submit() {
    setPending(true)
    setError(null)
    const failed: string[] = []
    for (const id of picked) {
      const res = await fetch("/api/be/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: id }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        failed.push(detail.detail ?? `Couldn't add person ${id}`)
      }
    }
    setPending(false)
    router.refresh()
    if (failed.length > 0) {
      setError(failed.join(" "))
      return
    }
    setOpen(false)
    setPicked(new Set())
    setQuery("")
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setPicked(new Set())
          setQuery("")
          setError(null)
        }
        setOpen(v)
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm">
            Add from roster
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add from roster</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Everyone on the unit roster who isn&apos;t in this workspace yet.
            Their name, rank, unit and contact details come along; shop, site
            and teams here start blank.
          </p>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or rank…"
            disabled={pending}
            autoFocus
          />
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-input p-2">
            {candidates.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                {roster.some((p) => !present.has(p.id))
                  ? "No one matches."
                  : "Everyone on the roster is already here."}
              </p>
            ) : (
              candidates.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(p.id)}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                    disabled={pending}
                  />
                  <span>
                    {p.rank ? `${p.rank} ` : ""}
                    {p.last_name}, {p.first_name}
                  </span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {[
                      p.unit_id ? unitName.get(p.unit_id) : null,
                      p.workspaces.map((w) => w.name).join(", ") ||
                        "No workspace",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </label>
              ))
            )}
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || picked.size === 0}>
            {pending
              ? "Adding…"
              : picked.size === 0
                ? "Add"
                : `Add ${picked.size} ${picked.size === 1 ? "person" : "people"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
