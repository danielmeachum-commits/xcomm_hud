"use client"

import { useMemo, useRef, useState } from "react"
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
  defaultSkillLevel,
  groupedRanks,
  rankOptionLabel,
  SKILL_LEVELS,
  SKILL_LEVEL_LABELS,
  skillLevelApplies,
  skillLevelLabel,
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
import { cn } from "@/lib/utils"
import { Check, CheckCircle2, Plus } from "lucide-react"

interface Draft {
  personnel_type: PersonnelType
  branch: Branch | ""
  rank: string
  skill_level: string
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

function makeDraft(person?: Personnel | null, defaultUnit?: Unit | null): Draft {
  // The workspace's default unit only seeds brand-new people — editing never
  // rewrites an existing (possibly deliberately blank) unit or branch.
  const seedUnit = person ? null : defaultUnit
  return {
    personnel_type: person?.personnel_type ?? "military",
    branch: (person?.branch ?? seedUnit?.branch ?? DEFAULT_BRANCH) as
      | Branch
      | "",
    rank: person?.rank ?? "",
    skill_level: person?.skill_level?.toString() ?? "",
    last_name: person?.last_name ?? "",
    first_name: person?.first_name ?? "",
    cellphone: person?.cellphone ?? "",
    dsn: person?.dsn ?? "",
    sipr_number: person?.sipr_number ?? "",
    email: person?.email ?? "",
    notes: person?.notes ?? "",
    work_center_id: person?.work_center_id?.toString() ?? "",
    unit_id: person?.unit_id?.toString() ?? seedUnit?.id.toString() ?? "",
    supervisor_id: person?.supervisor_id?.toString() ?? "",
    assigned_site_id: person?.assigned_site_id?.toString() ?? "",
    room_number: person?.room_number?.toString() ?? "",
    team_ids: new Set(person?.team_ids ?? []),
  }
}

const STEPS = [
  { key: "person", label: "Person" },
  { key: "organization", label: "Organization" },
  { key: "contact", label: "Contact" },
  { key: "assignment", label: "Assignment" },
  { key: "review", label: "Review" },
] as const

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

/**
 * Collapsed "+ New …" affordance that expands into a name input and creates
 * the record inline (work center / unit / team) so the wizard never has to be
 * abandoned for an admin page. On success the created record is handed back
 * so the caller can merge + select it.
 */
function InlineCreator<T extends { id: number; name: string }>({
  noun,
  endpoint,
  disabled,
  onCreated,
}: {
  noun: string
  endpoint: string
  disabled?: boolean
  onCreated: (created: T) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `Failed to create ${noun}`)
      }
      onCreated((await res.json()) as T)
      setName("")
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        disabled={disabled}
        onClick={() => setEditing(true)}
      >
        <Plus className="size-3" />
        New {noun}
      </Button>
    )
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void create()
            }
            if (e.key === "Escape") setEditing(false)
          }}
          placeholder={`New ${noun} name`}
          className="h-8 text-sm"
          disabled={busy}
        />
        <Button
          type="button"
          size="sm"
          className="h-8"
          onClick={create}
          disabled={busy || !name.trim()}
        >
          {busy ? "Adding…" : "Add"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={() => {
            setEditing(false)
            setError(null)
          }}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** One row of the review summary. */
function ReviewRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm", !value && "text-muted-foreground")}>
        {value || "—"}
      </dd>
    </div>
  )
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
  const defaultUnit = units.find((u) => u.is_default) ?? null
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(makeDraft(person, defaultUnit))
  const [step, setStep] = useState(0)
  const [maxVisited, setMaxVisited] = useState(0)
  // After a successful create: show the confirmation panel with "Add another".
  const [createdName, setCreatedName] = useState<string | null>(null)
  // Skill level follows the rank's typical default until the user picks one.
  const skillTouched = useRef(false)

  // Records created inline during this dialog session, merged with the
  // server-provided lists (props only refresh after router.refresh()).
  const [extraWCs, setExtraWCs] = useState<WorkCenter[]>([])
  const [extraUnits, setExtraUnits] = useState<Unit[]>([])
  const [extraTeams, setExtraTeams] = useState<Team[]>([])
  const createdRef = useRef(false)

  const allWCs = useMemo(
    () =>
      [...workCenters, ...extraWCs.filter((x) => !workCenters.some((w) => w.id === x.id))].sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    [workCenters, extraWCs],
  )
  const allUnits = useMemo(
    () =>
      [...units, ...extraUnits.filter((x) => !units.some((u) => u.id === x.id))].sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    [units, extraUnits],
  )
  const allTeams = useMemo(
    () =>
      [...teams, ...extraTeams.filter((x) => !teams.some((t) => t.id === x.id))].sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    [teams, extraTeams],
  )

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
  const showSkillLevel = skillLevelApplies(
    draft.personnel_type,
    draft.branch || null,
    draft.rank || null,
  )

  /** Apply an identity change and re-derive the suggested skill level. */
  function setIdentity(patch: Partial<Draft>) {
    setDraft((d) => {
      const next = { ...d, ...patch }
      const suggested = defaultSkillLevel(
        next.personnel_type,
        next.branch || null,
        next.rank || null,
      )
      if (!skillTouched.current || suggested == null) {
        next.skill_level = suggested?.toString() ?? ""
        if (suggested == null) skillTouched.current = false
      }
      return next
    })
  }

  function reset() {
    setDraft(makeDraft(person, defaultUnit))
    setError(null)
    setStep(0)
    setMaxVisited(0)
    setCreatedName(null)
    skillTouched.current = false
  }

  function close() {
    setOpen(false)
    reset()
    // Inline-created records exist server-side even if the person was never
    // saved — refresh so the page's lists pick them up.
    if (createdRef.current) {
      createdRef.current = false
      router.refresh()
    }
  }

  function goTo(next: number) {
    setStep(next)
    setMaxVisited((m) => Math.max(m, next))
    setError(null)
  }

  const stepValid =
    step !== 0 || (draft.last_name.trim() !== "" && draft.first_name.trim() !== "")

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
        skill_level:
          showSkillLevel && draft.skill_level ? Number(draft.skill_level) : null,
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
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to save personnel")
      }
      router.refresh()
      createdRef.current = false
      if (editing) {
        setOpen(false)
        reset()
      } else {
        setCreatedName(
          `${draft.rank ? `${draft.rank} ` : ""}${draft.last_name.trim()}, ${draft.first_name.trim()}`,
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  function addAnother() {
    setDraft(makeDraft(null))
    setCreatedName(null)
    setError(null)
    setStep(0)
    setMaxVisited(0)
    skillTouched.current = false
  }

  // --- Review helpers -------------------------------------------------------
  const wcName = draft.work_center_id
    ? allWCs.find((w) => w.id === Number(draft.work_center_id))?.name ?? null
    : null
  const unitName = draft.unit_id
    ? allUnits.find((u) => u.id === Number(draft.unit_id))?.name ?? null
    : null
  const siteName = draft.assigned_site_id
    ? sites.find((s) => s.id === Number(draft.assigned_site_id))?.name ?? null
    : null
  const supervisorName = (() => {
    if (!draft.supervisor_id) return null
    const s = supervisors.find((x) => x.id === Number(draft.supervisor_id))
    return s ? `${s.rank ? `${s.rank} ` : ""}${s.last_name}, ${s.first_name}` : null
  })()
  const teamNames = allTeams
    .filter((t) => draft.team_ids.has(t.id))
    .map((t) => t.name)

  const reviewSections: {
    step: number
    title: string
    rows: { label: string; value: string | null }[]
  }[] = [
    {
      step: 0,
      title: "Person",
      rows: [
        {
          label: "Name",
          value: `${draft.rank ? `${draft.rank} ` : ""}${draft.last_name.trim()}, ${draft.first_name.trim()}`,
        },
        { label: "Unit", value: unitName },
        {
          label: "Type",
          value:
            draft.personnel_type === "civilian"
              ? `Civilian${draft.branch ? ` · ${BRANCH_LABELS[draft.branch]}` : ""}`
              : draft.branch
                ? BRANCH_LABELS[draft.branch]
                : "Military",
        },
        ...(showSkillLevel
          ? [
              {
                label: "Skill level",
                value: draft.skill_level
                  ? skillLevelLabel(Number(draft.skill_level))
                  : null,
              },
            ]
          : []),
      ],
    },
    {
      step: 1,
      title: "Organization",
      rows: [
        { label: "Work center", value: wcName },
        { label: "Supervisor", value: supervisorName },
        {
          label: "Teams",
          value: teamNames.length > 0 ? teamNames.join(", ") : null,
        },
      ],
    },
    {
      step: 2,
      title: "Contact",
      rows: [
        { label: "Email", value: draft.email || null },
        { label: "Cellphone", value: draft.cellphone || null },
        { label: "DSN", value: draft.dsn || null },
        { label: "SIPR number", value: draft.sipr_number || null },
      ],
    },
    {
      step: 3,
      title: "Assignment",
      rows: [
        { label: "Assigned site", value: siteName },
        { label: "Room", value: draft.room_number || null },
        { label: "Notes", value: draft.notes || null },
      ],
    },
  ]

  const onLastStep = step === STEPS.length - 1

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close()
        else setOpen(true)
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

        {createdName ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="size-10 text-emerald-500" />
            <div>
              <p className="text-sm font-semibold">{createdName} added.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add another person, or close to get back to the roster.
              </p>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button onClick={addAnother}>Add another</Button>
              <Button variant="outline" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Step indicator — visited steps are clickable. */}
            <div className="flex flex-wrap items-center gap-1">
              {STEPS.map((s, i) => {
                const reachable = editing || i <= maxVisited
                const done = i < step
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => reachable && goTo(i)}
                    disabled={!reachable || pending}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2 py-1 text-xs",
                      i === step
                        ? "bg-primary/10 font-semibold text-primary"
                        : reachable
                          ? "text-muted-foreground hover:bg-muted"
                          : "text-muted-foreground/50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4.5 items-center justify-center rounded-full border text-[10px]",
                        i === step
                          ? "border-primary bg-primary text-primary-foreground"
                          : done
                            ? "border-primary/50 text-primary"
                            : "border-muted-foreground/40",
                      )}
                    >
                      {done ? <Check className="size-3" /> : i + 1}
                    </span>
                    {s.label}
                  </button>
                )
              })}
            </div>

            <div className="min-h-[300px] space-y-4">
              {step === 0 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="last_name">Last name</Label>
                      <Input
                        id="last_name"
                        value={draft.last_name}
                        onChange={(e) =>
                          setDraft({ ...draft, last_name: e.target.value })
                        }
                        autoFocus={!editing}
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

                  {/* Unit ahead of branch — picking a unit with a branch
                      prefills the branch (still editable below). */}
                  <div className="space-y-1.5">
                    <Label htmlFor="unit_id">Unit</Label>
                    <select
                      id="unit_id"
                      value={draft.unit_id}
                      onChange={(e) => {
                        const u = allUnits.find(
                          (x) => x.id === Number(e.target.value),
                        )
                        setIdentity({
                          unit_id: e.target.value,
                          ...(u?.branch ? { branch: u.branch } : {}),
                        })
                      }}
                      disabled={pending}
                      className={selectClass}
                    >
                      <option value="">— None —</option>
                      {allUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <InlineCreator<Unit>
                      noun="unit"
                      endpoint="/api/be/units"
                      disabled={pending}
                      onCreated={(u) => {
                        createdRef.current = true
                        setExtraUnits((xs) => [...xs, u])
                        setDraft((d) => ({ ...d, unit_id: u.id.toString() }))
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="personnel_type">Type</Label>
                      <select
                        id="personnel_type"
                        value={draft.personnel_type}
                        onChange={(e) =>
                          setIdentity({
                            personnel_type: e.target.value as PersonnelType,
                          })
                        }
                        disabled={pending}
                        className={selectClass}
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
                          setIdentity({ branch: e.target.value as Branch | "" })
                        }
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

                  <div
                    className={cn(
                      "grid gap-3",
                      showSkillLevel ? "grid-cols-2" : "grid-cols-1",
                    )}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="rank">Rank</Label>
                      <select
                        id="rank"
                        value={draft.rank}
                        onChange={(e) => setIdentity({ rank: e.target.value })}
                        disabled={pending}
                        className={selectClass}
                      >
                        <option value="">— None —</option>
                        {/* Keep an out-of-catalog value (e.g. from CSV import) selectable. */}
                        {draft.rank && !knownRank && (
                          <option value={draft.rank}>{draft.rank}</option>
                        )}
                        {rankGroups.map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.ranks.map((r) => (
                              <option
                                key={`${r.grade}-${r.short}`}
                                value={r.short}
                              >
                                {rankOptionLabel(r)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    {showSkillLevel && (
                      <div className="space-y-1.5">
                        <Label htmlFor="skill_level">Skill level</Label>
                        <select
                          id="skill_level"
                          value={draft.skill_level}
                          onChange={(e) => {
                            skillTouched.current = true
                            setDraft({ ...draft, skill_level: e.target.value })
                          }}
                          disabled={pending}
                          className={selectClass}
                        >
                          <option value="">— None —</option>
                          {SKILL_LEVELS.map((l) => (
                            <option key={l} value={l}>
                              {l} — {SKILL_LEVEL_LABELS[l]}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] text-muted-foreground">
                          Suggested from rank — adjust for members still in
                          upgrade training.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="work_center_id">Work center</Label>
                    <select
                      id="work_center_id"
                      value={draft.work_center_id}
                      onChange={(e) =>
                        setDraft({ ...draft, work_center_id: e.target.value })
                      }
                      disabled={pending}
                      className={selectClass}
                    >
                      <option value="">— None —</option>
                      {allWCs.map((wc) => (
                        <option key={wc.id} value={wc.id}>
                          {wc.name}
                        </option>
                      ))}
                    </select>
                    <InlineCreator<WorkCenter>
                      noun="work center"
                      endpoint="/api/be/work-centers"
                      disabled={pending}
                      onCreated={(wc) => {
                        createdRef.current = true
                        setExtraWCs((xs) => [...xs, wc])
                        setDraft((d) => ({
                          ...d,
                          work_center_id: wc.id.toString(),
                        }))
                      }}
                    />
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
                      className={selectClass}
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
                    <Label>Teams</Label>
                    {allTeams.length > 0 ? (
                      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-md border border-input p-2">
                        {allTeams.map((t) => (
                          <label
                            key={t.id}
                            className="inline-flex items-center gap-1.5 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={draft.team_ids.has(t.id)}
                              onChange={(e) =>
                                toggleTeam(t.id, e.target.checked)
                              }
                              disabled={pending}
                            />
                            {t.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No teams yet.
                      </p>
                    )}
                    <InlineCreator<Team>
                      noun="team"
                      endpoint="/api/be/teams"
                      disabled={pending}
                      onCreated={(t) => {
                        createdRef.current = true
                        setExtraTeams((xs) => [...xs, t])
                        setDraft((d) => {
                          const next = new Set(d.team_ids)
                          next.add(t.id)
                          return { ...d, team_ids: next }
                        })
                      }}
                    />
                  </div>
                </>
              )}

              {step === 2 && (
                <div className="grid grid-cols-2 gap-3">
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
                      onChange={(e) =>
                        setDraft({ ...draft, dsn: e.target.value })
                      }
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
                </div>
              )}

              {step === 3 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="assigned_site_id">Assigned site</Label>
                      <select
                        id="assigned_site_id"
                        value={draft.assigned_site_id}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            assigned_site_id: e.target.value,
                          })
                        }
                        disabled={pending}
                        className={selectClass}
                      >
                        <option value="">— None —</option>
                        {sites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
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
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      value={draft.notes}
                      onChange={(e) =>
                        setDraft({ ...draft, notes: e.target.value })
                      }
                      disabled={pending}
                      rows={3}
                    />
                  </div>
                </>
              )}

              {step === 4 && (
                <div className="space-y-3">
                  {reviewSections.map((section) => (
                    <section
                      key={section.title}
                      className="rounded-md border border-input p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {section.title}
                        </h3>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => goTo(section.step)}
                          disabled={pending}
                        >
                          Edit
                        </Button>
                      </div>
                      <dl className="grid grid-cols-2 gap-2">
                        {section.rows.map((row) => (
                          <ReviewRow
                            key={row.label}
                            label={row.label}
                            value={row.value}
                          />
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
              )}

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>

            <DialogFooter>
              {step > 0 && (
                <Button
                  variant="outline"
                  onClick={() => goTo(step - 1)}
                  disabled={pending}
                >
                  Back
                </Button>
              )}
              {onLastStep ? (
                <Button onClick={submit} disabled={pending}>
                  {pending ? "Saving…" : editing ? "Save" : "Create"}
                </Button>
              ) : (
                <Button onClick={() => goTo(step + 1)} disabled={!stepValid || pending}>
                  Next
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
