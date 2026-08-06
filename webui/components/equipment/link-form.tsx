"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  CAPABILITY_LABELS,
  EQUIPMENT_LINK_DIRECTIONS,
  EQUIPMENT_LINK_KINDS,
  EQUIPMENT_STATUS_VALUES,
  LINK_KIND_LABELS,
} from "@/lib/equipment-meta"
import { statusLabel } from "@/lib/status"
import type {
  Equipment,
  EquipmentLink,
  EquipmentLinkDirection,
  EquipmentLinkKind,
  EquipmentStatus,
} from "@/lib/types"

interface Props {
  /** Every piece of gear in the workspace — both ends are picked from here,
   *  deliberately unfiltered by site. A cross-site shot is the whole reason
   *  this table exists. */
  equipment: Equipment[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the form edits this link instead of creating one. */
  link?: EquipmentLink | null
  /** Pre-selected ends, e.g. from dragging between two nodes on the canvas. */
  defaultA?: number | null
  defaultB?: number | null
}

/* Callers re-point one mounted instance at a different link (or a different
 * dragged-together pair) each time they open it. Rather than re-seeding the
 * draft from an effect, give this component a `key` that changes per open —
 * the state then starts fresh at mount, which is what a reset actually is. */

interface Draft {
  aId: number | null
  bId: number | null
  aCapId: number | null
  bCapId: number | null
  kind: EquipmentLinkKind
  direction: EquipmentLinkDirection
  status: EquipmentStatus
  label: string
  notes: string
}

function draftFrom(
  link: EquipmentLink | null | undefined,
  defaultA: number | null | undefined,
  defaultB: number | null | undefined,
): Draft {
  return {
    aId: link?.a_equipment_id ?? defaultA ?? null,
    bId: link?.b_equipment_id ?? defaultB ?? null,
    aCapId: link?.a_capability_id ?? null,
    bCapId: link?.b_capability_id ?? null,
    kind: link?.kind ?? "cable",
    direction: link?.direction ?? "bidirectional",
    status: link?.status ?? "unvalidated",
    label: link?.label ?? "",
    notes: link?.notes ?? "",
  }
}

export function LinkForm({
  equipment,
  open,
  onOpenChange,
  link = null,
  defaultA = null,
  defaultB = null,
}: Props) {
  const router = useRouter()
  const editing = !!link
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(link, defaultA, defaultB),
  )

  const byId = useMemo(
    () => new Map(equipment.map((e) => [e.id, e])),
    [equipment],
  )

  /** Gear grouped by site for the pickers. Sorting by site name keeps the far
   *  end of a cross-site shot findable without knowing its equipment ID. */
  const grouped = useMemo(() => {
    const groups = new Map<string, Equipment[]>()
    for (const e of equipment) {
      const key = e.site_name ?? "Unassigned"
      const list = groups.get(key) ?? []
      list.push(e)
      groups.set(key, list)
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([site, items]) => ({
        site,
        items: items.sort((a, b) =>
          a.equipment_code.localeCompare(b.equipment_code),
        ),
      }))
  }, [equipment])

  const a = draft.aId != null ? byId.get(draft.aId) : undefined
  const b = draft.bId != null ? byId.get(draft.bId) : undefined
  const crossSite = !!a && !!b && a.site_id !== b.site_id
  const sameEnds = draft.aId != null && draft.aId === draft.bId

  async function submit() {
    if (draft.aId == null || draft.bId == null) {
      setError("Pick gear for both ends.")
      return
    }
    if (sameEnds) {
      setError("A link needs two different pieces of gear.")
      return
    }
    setPending(true)
    setError(null)
    try {
      // The PATCH schema deliberately can't move a link's ends — they are its
      // identity. Edit sends only the mutable fields.
      const body: Record<string, unknown> = {
        a_capability_id: draft.aCapId,
        b_capability_id: draft.bCapId,
        kind: draft.kind,
        direction: draft.direction,
        status: draft.status,
        label: draft.label.trim() || null,
        notes: draft.notes.trim() || null,
      }
      if (!editing) {
        body.a_equipment_id = draft.aId
        body.b_equipment_id = draft.bId
      }
      const res = await fetch(
        editing
          ? `/api/be/topology/links/${link!.id}`
          : "/api/be/topology/links",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to save the link")
      }
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (!link) return
    const ends = `${link.a_equipment_code ?? "?"} ↔ ${link.b_equipment_code ?? "?"}`
    if (!confirm(`Delete the ${LINK_KIND_LABELS[link.kind]} link ${ends}?`)) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/topology/links/${link.id}`, {
        method: "DELETE",
      })
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to delete the link")
      }
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit connection" : "Add connection"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <EndPicker
              side="A"
              equipmentId={draft.aId}
              capabilityId={draft.aCapId}
              selected={a}
              grouped={grouped}
              locked={editing}
              disabled={pending}
              onEquipmentChange={(id) =>
                // Changing the end invalidates the port picked on it.
                setDraft({ ...draft, aId: id, aCapId: null })
              }
              onCapabilityChange={(id) => setDraft({ ...draft, aCapId: id })}
            />
            <EndPicker
              side="B"
              equipmentId={draft.bId}
              capabilityId={draft.bCapId}
              selected={b}
              grouped={grouped}
              locked={editing}
              disabled={pending}
              onEquipmentChange={(id) =>
                setDraft({ ...draft, bId: id, bCapId: null })
              }
              onCapabilityChange={(id) => setDraft({ ...draft, bCapId: id })}
            />
          </div>

          {editing && (
            <p className="text-xs text-muted-foreground">
              A link&apos;s two ends are its identity and can&apos;t be moved.
              Delete it and add a new one to re-route.
            </p>
          )}
          {crossSite && (
            <p className="text-xs text-sky-600 dark:text-sky-400">
              Cross-site link — this is what makes {b?.site_name} an extension
              of {a?.site_name}.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="link-kind">Kind</Label>
              <select
                id="link-kind"
                value={draft.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kind: e.target.value as EquipmentLinkKind,
                  })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                {EQUIPMENT_LINK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LINK_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-status">Status</Label>
              <select
                id="link-status"
                value={draft.status}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    status: e.target.value as EquipmentStatus,
                  })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                {EQUIPMENT_STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="link-direction">Direction</Label>
            <select
              id="link-direction"
              value={draft.direction}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  direction: e.target.value as EquipmentLinkDirection,
                })
              }
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={pending}
            >
              {EQUIPMENT_LINK_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {d === "bidirectional"
                    ? "Peer — traffic both ways"
                    : `Feeds — ${a?.equipment_code ?? "A"} → ${b?.equipment_code ?? "B"}`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="link-label">Label</Label>
            <Input
              id="link-label"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder={`Optional — defaults to “${LINK_KIND_LABELS[draft.kind]}” on the canvas`}
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="link-notes">Notes</Label>
            <Textarea
              id="link-notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
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
        <DialogFooter className="sm:justify-between">
          {editing ? (
            <Button variant="outline" onClick={remove} disabled={pending}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={submit} disabled={pending || sameEnds}>
            {pending ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EndPicker({
  side,
  equipmentId,
  capabilityId,
  selected,
  grouped,
  locked,
  disabled,
  onEquipmentChange,
  onCapabilityChange,
}: {
  side: "A" | "B"
  equipmentId: number | null
  capabilityId: number | null
  selected: Equipment | undefined
  grouped: { site: string; items: Equipment[] }[]
  locked: boolean
  disabled: boolean
  onEquipmentChange: (id: number | null) => void
  onCapabilityChange: (id: number | null) => void
}) {
  const caps = selected?.capabilities ?? []
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`link-end-${side}`}>End {side}</Label>
      {locked ? (
        <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 font-mono text-sm">
          {selected?.equipment_code ?? "—"}
        </div>
      ) : (
        <select
          id={`link-end-${side}`}
          value={equipmentId ?? ""}
          onChange={(e) =>
            onEquipmentChange(e.target.value ? Number(e.target.value) : null)
          }
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          disabled={disabled}
        >
          <option value="">Select gear…</option>
          {grouped.map((g) => (
            <optgroup key={g.site} label={g.site}>
              {g.items.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.equipment_code} — {e.type_short_name ?? e.type_title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      <select
        aria-label={`Port on end ${side}`}
        value={capabilityId ?? ""}
        onChange={(e) =>
          onCapabilityChange(e.target.value ? Number(e.target.value) : null)
        }
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        disabled={disabled || !selected || caps.length === 0}
      >
        {/* Which port carried it — "the shot leaves the los_rf, not the
            satcom_rf". Most links won't bother, so this stays optional. */}
        <option value="">
          {!selected
            ? "Select gear first"
            : caps.length === 0
              ? "No capabilities"
              : "Any port"}
        </option>
        {caps.map((c) => (
          <option key={c.id} value={c.id}>
            {CAPABILITY_LABELS[c.kind]} — {c.label}
          </option>
        ))}
      </select>
    </div>
  )
}
