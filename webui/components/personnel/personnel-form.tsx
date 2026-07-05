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
import {
  BRANCHES,
  BRANCH_LABELS,
  DEFAULT_BRANCH,
  groupedRanks,
  rankOptionLabel,
} from "@/lib/personnel-data"
import type {
  Branch,
  Personnel,
  PersonnelType,
  Site,
  Team,
  Unit,
  WorkCenter,
} from "@/lib/types"

interface Draft {
  personnel_type: PersonnelType
  branch: Branch | ""
  rank: string
  last_name: string
  first_name: string
  cellphone: string
  dsn: string
  sipr_number: string
  email: string
  notes: string
  work_center_id: string
  unit_id: string
  supervisor_id: string
  assigned_site_id: string
  room_number: string
  team_ids: Set<number>
}

function makeDraft(person?: Personnel | null): Draft {
  return {
    personnel_type: person?.personnel_type ?? "military",
    branch: (person?.branch ?? DEFAULT_BRANCH) as Branch | "",
    rank: person?.rank ?? "",
    last_name: person?.last_name ?? "",
    first_name: person?.first_name ?? "",
    cellphone: person?.cellphone ?? "",
    dsn: person?.dsn ?? "",
    sipr_number: person?.sipr_number ?? "",
    email: person?.email ?? "",
    notes: person?.notes ?? "",
    work_center_id: person?.work_center_id?.toString() ?? "",
    unit_id: person?.unit_id?.toString() ?? "",
    supervisor_id: person?.supervisor_id?.toString() ?? "",
    assigned_site_id: person?.assigned_site_id?.toString() ?? "",
    room_number: person?.room_number ?? "",
    team_ids: new Set(person?.team_ids ?? []),
  }
}

interface Props {
  /** Present = edit mode, absent = create mode. */
  person?: Personnel
  workCenters: WorkCenter[]
  units: Unit[]
  teams: Team[]
  sites: Site[]
  supervisors: Personnel[]
  triggerLabel?: string
  triggerVariant?: "default" | "outline"
}

export function PersonnelForm({
  person,
  workCenters,
  units,
  teams,
  sites,
  supervisors,
  triggerLabel,
  triggerVariant,
}: Props) {
  const router = useRouter()
  const editing = !!person
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(makeDraft(person))

  const rankGroups = useMemo(
    () => groupedRanks(draft.personnel_type, draft.branch || null),
    [draft.personnel_type, draft.branch],
  )
  // Preserve an existing rank value (e.g. from CSV import) that isn't in the
  // catalog so switching branches / editing doesn't silently drop it.
  const knownRank = useMemo(
    () => rankGroups.some((g) => g.ranks.some((r) => r.short === draft.rank)),
    [rankGroups, draft.rank],
  )

  function reset() {
    setDraft(makeDraft(person))
    setError(null)
  }

  function toggleTeam(id: number, checked: boolean) {
    const next = new Set(draft.team_ids)
    if (checked) next.add(id)
    else next.delete(id)
    setDraft({ ...draft, team_ids: next })
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        personnel_type: draft.personnel_type,
        branch:
          draft.personnel_type === "civilian"
            ? draft.branch || null
            : draft.branch || DEFAULT_BRANCH,
        rank: draft.rank || null,
        last_name: draft.last_name.trim(),
        first_name: draft.first_name.trim(),
        cellphone: draft.cellphone || null,
        dsn: draft.dsn || null,
        sipr_number: draft.sipr_number || null,
        email: draft.email || null,
        notes: draft.notes || null,
        work_center_id: draft.work_center_id
          ? Number(draft.work_center_id)
          : null,
        unit_id: draft.unit_id ? Number(draft.unit_id) : null,
        supervisor_id: draft.supervisor_id
          ? Number(draft.supervisor_id)
          : null,
        assigned_site_id: draft.assigned_site_id
          ? Number(draft.assigned_site_id)
          : null,
        room_number: draft.room_number || null,
        team_ids: Array.from(draft.team_ids),
      }
      const url = editing
        ? `/api/be/personnel/${person!.id}`
        : "/api/be/personnel"
      const method = editing ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to save personnel")
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
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        setOpen(v)
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant={triggerVariant ?? (editing ? "outline" : "default")}
          >
            {triggerLabel ?? (editing ? "Edit" : "Add personnel")}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit ${person!.last_name}, ${person!.first_name}`
              : "Add personnel"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="personnel_type">Type</Label>
              <select
                id="personnel_type"
                value={draft.personnel_type}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    personnel_type: e.target.value as PersonnelType,
                  })
                }
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="military">Military</option>
                <option value="civilian">Civilian</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branch">Branch</Label>
              <select
                id="branch"
                value={draft.branch}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    branch: e.target.value as Branch | "",
                  })
                }
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {draft.personnel_type === "civilian" && (
                  <option value="">— None —</option>
                )}
                {BRANCHES.map((b) => (
                  <option key={b} value={b}>
                    {BRANCH_LABELS[b]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Last name</Label>
              <Input
                id="last_name"
                value={draft.last_name}
                onChange={(e) =>
                  setDraft({ ...draft, last_name: e.target.value })
                }
                required
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="first_name">First name</Label>
              <Input
                id="first_name"
                value={draft.first_name}
                onChange={(e) =>
                  setDraft({ ...draft, first_name: e.target.value })
                }
                required
                disabled={pending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rank">Rank</Label>
            <select
              id="rank"
              value={draft.rank}
              onChange={(e) => setDraft({ ...draft, rank: e.target.value })}
              disabled={pending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— None —</option>
              {/* Keep an out-of-catalog value (e.g. from CSV import) selectable. */}
              {draft.rank && !knownRank && (
                <option value={draft.rank}>{draft.rank}</option>
              )}
              {rankGroups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.ranks.map((r) => (
                    <option key={`${r.grade}-${r.short}`} value={r.short}>
                      {rankOptionLabel(r)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cellphone">Cellphone</Label>
              <Input
                id="cellphone"
                value={draft.cellphone}
                onChange={(e) =>
                  setDraft({ ...draft, cellphone: e.target.value })
                }
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dsn">DSN</Label>
              <Input
                id="dsn"
                value={draft.dsn}
                onChange={(e) => setDraft({ ...draft, dsn: e.target.value })}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sipr_number">SIPR number</Label>
              <Input
                id="sipr_number"
                value={draft.sipr_number}
                onChange={(e) =>
                  setDraft({ ...draft, sipr_number: e.target.value })
                }
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={draft.email}
                onChange={(e) =>
                  setDraft({ ...draft, email: e.target.value })
                }
                disabled={pending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="work_center_id">Work center</Label>
              <select
                id="work_center_id"
                value={draft.work_center_id}
                onChange={(e) =>
                  setDraft({ ...draft, work_center_id: e.target.value })
                }
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— None —</option>
                {workCenters.map((wc) => (
                  <option key={wc.id} value={wc.id}>
                    {wc.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit_id">Unit</Label>
              <select
                id="unit_id"
                value={draft.unit_id}
                onChange={(e) =>
                  setDraft({ ...draft, unit_id: e.target.value })
                }
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— None —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supervisor_id">Supervisor</Label>
              <select
                id="supervisor_id"
                value={draft.supervisor_id}
                onChange={(e) =>
                  setDraft({ ...draft, supervisor_id: e.target.value })
                }
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— None —</option>
                {supervisors
                  .filter((s) => !editing || s.id !== person!.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.rank ? `${s.rank} ` : ""}
                      {s.last_name}, {s.first_name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assigned_site_id">Assigned site</Label>
              <select
                id="assigned_site_id"
                value={draft.assigned_site_id}
                onChange={(e) =>
                  setDraft({ ...draft, assigned_site_id: e.target.value })
                }
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— None —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="room_number">Room number</Label>
            <Input
              id="room_number"
              value={draft.room_number}
              onChange={(e) =>
                setDraft({ ...draft, room_number: e.target.value })
              }
              disabled={pending}
            />
          </div>

          {teams.length > 0 && (
            <div className="space-y-1.5">
              <Label>Teams</Label>
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-md border border-input p-2">
                {teams.map((t) => (
                  <label
                    key={t.id}
                    className="inline-flex items-center gap-1.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={draft.team_ids.has(t.id)}
                      onChange={(e) => toggleTeam(t.id, e.target.checked)}
                      disabled={pending}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}

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
