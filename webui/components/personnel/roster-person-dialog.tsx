"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { CommanderStar } from "@/components/personnel/commander-star"
import { PersonnelPicker } from "@/components/personnel/personnel-picker"
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
import {
  DodIdInput,
  cacPayload,
  type CacChange,
} from "@/components/personnel/dod-id-input"
import { Label } from "@/components/ui/label"
import {
  BRANCH_LABELS,
  BRANCHES,
  DEFAULT_BRANCH,
  defaultSkillLevel,
  groupedRanks,
  isOfficerGrade,
  personName,
  rankOptionLabel,
  SKILL_LEVEL_LABELS,
  SKILL_LEVELS,
  skillLevelApplies,
} from "@/lib/personnel-data"
import type { Branch, Person, PersonnelType, Unit } from "@/lib/types"

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

interface Draft {
  personnel_type: PersonnelType
  branch: Branch | ""
  rank: string
  skill_level: string
  last_name: string
  first_name: string
  unit_id: string
  supervisor_id: string
  is_commander: boolean
  cellphone: string
  dsn: string
  sipr_number: string
  email: string
  edipi: CacChange
}

function makeDraft(p: Person | undefined, defaultUnit: Unit | null): Draft {
  return {
    personnel_type: p?.personnel_type ?? "military",
    branch: p ? (p.branch ?? "") : (defaultUnit?.branch ?? DEFAULT_BRANCH),
    rank: p?.rank ?? "",
    skill_level: p?.skill_level?.toString() ?? "",
    last_name: p?.last_name ?? "",
    first_name: p?.first_name ?? "",
    unit_id: (p ? p.unit_id : defaultUnit?.id)?.toString() ?? "",
    supervisor_id: p?.supervisor_id?.toString() ?? "",
    is_commander: p?.is_commander ?? false,
    cellphone: p?.cellphone ?? "",
    dsn: p?.dsn ?? "",
    sipr_number: p?.sipr_number ?? "",
    email: p?.email ?? "",
    edipi: "",
  }
}

interface Props {
  /** Present = edit, absent = add. */
  person?: Person
  roster: Person[]
  units: Unit[]
}

/**
 * Add or edit someone on the global roster — who they are, in no workspace.
 * Their part in each picture (shop, site, teams) is set where they're added.
 * A single page rather than the personnel wizard: there are only identity
 * and contact fields here.
 */
export function RosterPersonDialog({ person, roster, units }: Props) {
  const router = useRouter()
  const editing = !!person
  const defaultUnit = units.find((u) => u.is_default) ?? null
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(makeDraft(person, defaultUnit))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dupAck, setDupAck] = useState(false)

  function set(patch: Partial<Draft>) {
    setDraft((d) => {
      const next = { ...d, ...patch }
      if (next.personnel_type !== "civilian" && !next.branch) {
        next.branch = DEFAULT_BRANCH
      }
      // Rank or branch moved: follow the rank's usual skill level.
      if ("rank" in patch || "branch" in patch || "personnel_type" in patch) {
        next.skill_level =
          defaultSkillLevel(
            next.personnel_type,
            next.branch || null,
            next.rank || null,
          )?.toString() ?? ""
      }
      return next
    })
  }

  const rankGroups = useMemo(
    () => groupedRanks(draft.personnel_type, draft.branch || null),
    [draft.personnel_type, draft.branch],
  )
  const knownRank = rankGroups.some((g) =>
    g.ranks.some((r) => r.short === draft.rank),
  )
  const showSkillLevel = skillLevelApplies(
    draft.personnel_type,
    draft.branch || null,
    draft.rank || null,
  )
  const officer = isOfficerGrade(
    draft.personnel_type,
    draft.branch || null,
    draft.rank || null,
  )
  const existingCommander = draft.unit_id
    ? roster.find(
        (p) =>
          p.is_commander &&
          p.unit_id === Number(draft.unit_id) &&
          p.id !== person?.id,
      ) ?? null
    : null
  const commanderEligible = officer && !!draft.unit_id && !existingCommander

  // Same name and rank as someone already on the roster — almost always a
  // second copy of them, which is the thing the roster exists to prevent.
  const duplicate = editing
    ? null
    : roster.find(
        (p) =>
          p.last_name.trim().toLowerCase() ===
            draft.last_name.trim().toLowerCase() &&
          p.first_name.trim().toLowerCase() ===
            draft.first_name.trim().toLowerCase() &&
          (p.rank ?? "") === draft.rank,
      ) ?? null

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const body = {
        personnel_type: draft.personnel_type,
        branch:
          draft.personnel_type === "civilian"
            ? draft.branch || null
            : draft.branch || DEFAULT_BRANCH,
        rank: draft.rank || null,
        skill_level:
          showSkillLevel && draft.skill_level ? Number(draft.skill_level) : null,
        last_name: draft.last_name.trim(),
        first_name: draft.first_name.trim(),
        unit_id: draft.unit_id ? Number(draft.unit_id) : null,
        supervisor_id: draft.supervisor_id ? Number(draft.supervisor_id) : null,
        is_commander: commanderEligible && draft.is_commander,
        cellphone: draft.cellphone || null,
        dsn: draft.dsn || null,
        sipr_number: draft.sipr_number || null,
        email: draft.email || null,
        ...cacPayload(draft.edipi),
      }
      const res = await fetch(
        editing ? `/api/be/people/${person!.id}` : "/api/be/people",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to save")
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  const canSave =
    draft.last_name.trim() !== "" &&
    (!duplicate || dupAck)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) {
          setDraft(makeDraft(person, defaultUnit))
          setError(null)
          setDupAck(false)
        }
        setOpen(v)
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant={editing ? "outline" : "default"}>
            {editing ? "Edit" : "Add person"}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit ${personName(person!)}`
              : "Add to roster"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {editing && person!.workspaces.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Changes show in every workspace they&apos;re in:{" "}
              {person!.workspaces.map((w) => w.name).join(", ")}.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-last">Last name</Label>
              <Input
                id="r-last"
                value={draft.last_name}
                onChange={(e) => set({ last_name: e.target.value })}
                disabled={pending}
                autoFocus={!editing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-first">
                First name{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="r-first"
                value={draft.first_name}
                onChange={(e) => set({ first_name: e.target.value })}
                disabled={pending}
              />
            </div>
          </div>

          {duplicate && (
            <div
              className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
              role="alert"
            >
              <p className="font-medium">
                {duplicate.rank ? `${duplicate.rank} ` : ""}
                {personName(duplicate)} is already on the
                roster.
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={dupAck}
                  onChange={(e) => setDupAck(e.target.checked)}
                  disabled={pending}
                />
                This is a different person — add them anyway
              </label>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="r-unit">Unit</Label>
            <select
              id="r-unit"
              value={draft.unit_id}
              onChange={(e) => {
                const u = units.find((x) => x.id === Number(e.target.value))
                set({
                  unit_id: e.target.value,
                  ...(u?.branch ? { branch: u.branch } : {}),
                })
              }}
              disabled={pending}
              className={selectClass}
            >
              <option value="">— None —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-type">Type</Label>
              <select
                id="r-type"
                value={draft.personnel_type}
                onChange={(e) =>
                  set({ personnel_type: e.target.value as PersonnelType })
                }
                disabled={pending}
                className={selectClass}
              >
                <option value="military">Military</option>
                <option value="civilian">Civilian</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-branch">Branch</Label>
              <select
                id="r-branch"
                value={draft.branch}
                onChange={(e) => set({ branch: e.target.value as Branch | "" })}
                disabled={pending}
                className={selectClass}
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

          <div className={showSkillLevel ? "grid grid-cols-2 gap-3" : ""}>
            <div className="space-y-1.5">
              <Label htmlFor="r-rank">Rank</Label>
              <select
                id="r-rank"
                value={draft.rank}
                onChange={(e) => set({ rank: e.target.value })}
                disabled={pending}
                className={selectClass}
              >
                <option value="">— None —</option>
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
            {showSkillLevel && (
              <div className="space-y-1.5">
                <Label htmlFor="r-skill">Skill level</Label>
                <select
                  id="r-skill"
                  value={draft.skill_level}
                  onChange={(e) =>
                    setDraft({ ...draft, skill_level: e.target.value })
                  }
                  disabled={pending}
                  className={selectClass}
                >
                  <option value="">— None —</option>
                  {SKILL_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l} lvl — {SKILL_LEVEL_LABELS[l]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="r-supervisor">Supervisor</Label>
            <PersonnelPicker
              id="r-supervisor"
              value={draft.supervisor_id}
              onChange={(v) => setDraft({ ...draft, supervisor_id: v })}
              personnel={roster.filter((p) => p.id !== person?.id)}
              disabled={pending}
              placeholder="Search the roster…"
            />
          </div>

          {commanderEligible && (
            <label className="flex items-center gap-2 rounded-md border border-input px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={draft.is_commander}
                onChange={(e) =>
                  setDraft({ ...draft, is_commander: e.target.checked })
                }
                disabled={pending}
              />
              <CommanderStar size={14} />
              <span className="font-medium">Commander</span>
            </label>
          )}
          {officer && existingCommander && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CommanderStar size={12} />
              {existingCommander.rank ? `${existingCommander.rank} ` : ""}
              {personName(existingCommander)}{" "}
              commands this unit.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="r-edipi">DoD ID (CAC)</Label>
              <DodIdInput
                id="r-edipi"
                enrolled={!!person?.has_cac}
                value={draft.edipi}
                onChange={(v) => setDraft((d) => ({ ...d, edipi: v }))}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-email">Email</Label>
              <Input
                id="r-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-cell">Cellphone</Label>
              <Input
                id="r-cell"
                value={draft.cellphone}
                onChange={(e) =>
                  setDraft({ ...draft, cellphone: e.target.value })
                }
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-dsn">DSN</Label>
              <Input
                id="r-dsn"
                value={draft.dsn}
                onChange={(e) => setDraft({ ...draft, dsn: e.target.value })}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-sipr">SIPR number</Label>
              <Input
                id="r-sipr"
                value={draft.sipr_number}
                onChange={(e) =>
                  setDraft({ ...draft, sipr_number: e.target.value })
                }
                disabled={pending}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !canSave}>
            {pending ? "Saving…" : editing ? "Save" : "Add to roster"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
