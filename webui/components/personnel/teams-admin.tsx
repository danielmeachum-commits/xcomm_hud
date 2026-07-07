"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { TEAM_COLOR_PRESETS, personLabel } from "@/lib/personnel-data"
import type { Personnel, Team, WorkCenter } from "@/lib/types"

interface Props {
  teams: Team[]
  workCenters: WorkCenter[]
  personnel: Personnel[]
  canEdit: boolean
  canDelete: boolean
}

interface LeadRow {
  workCenterId: string
  personnelId: string
}

function ColorSwatch({ color }: { color: string | null }) {
  return (
    <span
      className="inline-block size-3.5 shrink-0 rounded-full border border-border"
      style={color ? { backgroundColor: color, borderColor: color } : {}}
      aria-hidden
    />
  )
}

function colorLabel(color: string | null): string {
  if (!color) return "None"
  return (
    TEAM_COLOR_PRESETS.find(
      (c) => c.value.toLowerCase() === color.toLowerCase(),
    )?.label ?? `Custom (${color})`
  )
}

export function TeamsAdmin({
  teams,
  workCenters,
  personnel,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState<Team | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [desc, setDesc] = useState("")
  const [color, setColor] = useState<string | null>(null)
  const [ncoicId, setNcoicId] = useState("")
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const people = useMemo(
    () =>
      [...personnel].sort((a, b) =>
        personLabel(a).localeCompare(personLabel(b)),
      ),
    [personnel],
  )
  const personById = useMemo(
    () => new Map(personnel.map((p) => [p.id, p])),
    [personnel],
  )
  // NCOIC and leads are picked from the team's members. A brand-new team has
  // none yet — people join via their personnel record.
  const members = useMemo(
    () => (editing ? people.filter((p) => p.team_ids.includes(editing.id)) : []),
    [people, editing],
  )
  const wcById = useMemo(
    () => new Map(workCenters.map((wc) => [wc.id, wc])),
    [workCenters],
  )

  function reset() {
    setName("")
    setSlug("")
    setDesc("")
    setColor(null)
    setNcoicId("")
    setLeads([])
    setError(null)
  }
  function startCreate() {
    setEditing(null)
    reset()
    setCreating(true)
  }
  function startEdit(t: Team) {
    setCreating(false)
    setEditing(t)
    setName(t.name)
    setSlug(t.slug ?? "")
    setDesc(t.description ?? "")
    setColor(t.color)
    setNcoicId(t.ncoic_id?.toString() ?? "")
    setLeads(
      t.leads.map((l) => ({
        workCenterId: l.work_center_id.toString(),
        personnelId: l.personnel_id.toString(),
      })),
    )
    setError(null)
  }
  function cancel() {
    setEditing(null)
    setCreating(false)
    setError(null)
  }

  async function save() {
    setPending(true)
    setError(null)
    try {
      const body = {
        name: name.trim(),
        slug: slug.trim() || null,
        description: desc || null,
        color,
        ncoic_id: ncoicId ? Number(ncoicId) : null,
        leads: leads
          .filter((l) => l.workCenterId && l.personnelId)
          .map((l) => ({
            work_center_id: Number(l.workCenterId),
            personnel_id: Number(l.personnelId),
          })),
      }
      const res = await fetch(
        editing ? `/api/be/teams/${editing.id}` : "/api/be/teams",
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
      cancel()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  async function del(t: Team) {
    if (!confirm(`Delete "${t.name}"?`)) return
    const res = await fetch(`/api/be/teams/${t.id}`, { method: "DELETE" })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      alert(detail.detail ?? "Failed to delete")
      return
    }
    router.refresh()
  }

  // A work center can only carry one lead — hide already-picked ones from
  // the other rows' dropdowns.
  const usedWcIds = new Set(leads.map((l) => l.workCenterId).filter(Boolean))
  const canAddLead = leads.length < workCenters.length

  function personSelect(
    id: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
  ) {
    // Keep a previously saved pick visible even if that person has since
    // left the team, so the select doesn't silently blank out.
    const selected = value ? personById.get(Number(value)) : null
    const options =
      selected && !members.some((p) => p.id === selected.id)
        ? [...members, selected].sort((a, b) =>
            personLabel(a).localeCompare(personLabel(b)),
          )
        : members
    return (
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">{placeholder}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {personLabel(p)}
          </option>
        ))}
      </select>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Teams</h1>
          <p className="text-xs text-muted-foreground">
            Ad-hoc groupings that span work centers. A person can be on
            multiple teams.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={startCreate}>
            Add
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <div className="rounded-md border border-input p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Name</Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-slug">Slug</Label>
              <Input
                id="team-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toUpperCase())}
                placeholder="FCP1"
                maxLength={16}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      className="h-9 w-full justify-between font-normal"
                      disabled={pending}
                    >
                      <span className="flex items-center gap-2">
                        <ColorSwatch color={color} />
                        {colorLabel(color)}
                      </span>
                      <ChevronDown className="size-4 opacity-50" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuItem onClick={() => setColor(null)}>
                    <ColorSwatch color={null} />
                    None
                  </DropdownMenuItem>
                  {TEAM_COLOR_PRESETS.map((c) => (
                    <DropdownMenuItem
                      key={c.value}
                      onClick={() => setColor(c.value)}
                    >
                      <ColorSwatch color={c.value} />
                      {c.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-ncoic">NCOIC</Label>
              {personSelect("team-ncoic", ncoicId, setNcoicId, "— None —")}
              {members.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  NCOIC and leads are picked from team members — people join a
                  team from their personnel record.
                </p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="team-desc">Description</Label>
              <Textarea
                id="team-desc"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={2}
                disabled={pending}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <div>
                <Label>Work center leads</Label>
                <p className="text-xs text-muted-foreground">
                  This team&apos;s designated lead within each work center it
                  draws from.
                </p>
              </div>
              {leads.map((lead, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    aria-label="Work center"
                    value={lead.workCenterId}
                    onChange={(e) =>
                      setLeads(
                        leads.map((l, j) =>
                          j === i ? { ...l, workCenterId: e.target.value } : l,
                        ),
                      )
                    }
                    disabled={pending}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— Work center —</option>
                    {workCenters
                      .filter(
                        (wc) =>
                          !usedWcIds.has(wc.id.toString()) ||
                          wc.id.toString() === lead.workCenterId,
                      )
                      .map((wc) => (
                        <option key={wc.id} value={wc.id}>
                          {wc.name}
                        </option>
                      ))}
                  </select>
                  {personSelect(
                    `team-lead-${i}`,
                    lead.personnelId,
                    (v) =>
                      setLeads(
                        leads.map((l, j) =>
                          j === i ? { ...l, personnelId: v } : l,
                        ),
                      ),
                    "— Lead —",
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove lead"
                    onClick={() => setLeads(leads.filter((_, j) => j !== i))}
                    disabled={pending}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setLeads([...leads, { workCenterId: "", personnelId: "" }])
                }
                disabled={pending || !canAddLead}
              >
                Add lead
              </Button>
            </div>
          </div>
          {error && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={save} disabled={pending || !name.trim()}>
              {pending ? "Saving…" : editing ? "Save" : "Create"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={cancel}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">NCOIC</th>
              <th className="px-3 py-2">Leads</th>
              <th className="px-3 py-2">Description</th>
              <th className="w-1 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {teams.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  Nothing here yet.
                </td>
              </tr>
            )}
            {teams.map((t) => {
              const ncoic = t.ncoic_id ? personById.get(t.ncoic_id) : null
              return (
                <tr key={t.id} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">
                    <span className="flex items-center gap-2">
                      <ColorSwatch color={t.color} />
                      {t.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t.slug ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ncoic ? personLabel(ncoic) : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t.leads.length > 0
                      ? t.leads
                          .map((l) => {
                            const wc = wcById.get(l.work_center_id)
                            const p = personById.get(l.personnel_id)
                            return wc && p
                              ? `${wc.name}: ${p.last_name}`
                              : null
                          })
                          .filter(Boolean)
                          .join(" · ")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t.description ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(t)}
                      >
                        Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2"
                        onClick={() => del(t)}
                      >
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
