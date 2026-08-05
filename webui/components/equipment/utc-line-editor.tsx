"use client"

import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { enclaveChipClass, enclaveChipStyle } from "@/lib/enclave-meta"
import type { Enclave, EquipmentType } from "@/lib/types"
import { cn } from "@/lib/utils"

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

/** One bill-of-materials line being authored. `enclave_id` is part of the
 *  line's identity, not a property of it — a UTC may carry the same type once
 *  per enclave. */
export interface LineDraft {
  equipment_type_id: number | ""
  quantity: number
  enclave_id: number | null
}

/** Enclave-first bill of materials.
 *
 *  The earlier shape — one flat list with an enclave dropdown per row — read as
 *  a single group no matter what the dropdowns said, and gave nowhere to add a
 *  line "to SIPR". Here the enclaves come first and the contents hang under
 *  them, which is how the UTC is actually described out loud: what are we
 *  supporting, and what does each one need.
 *
 *  Which enclaves a UTC covers is DERIVED from its lines rather than stored, so
 *  the two can't drift. The checkboxes seed empty sections to author into; a
 *  section left empty simply doesn't persist, because an enclave with no gear
 *  says nothing.
 */
export function UtcLineEditor({
  lines,
  onChange,
  types,
  enclaves,
  active,
  onActiveChange,
  disabled = false,
}: {
  lines: LineDraft[]
  onChange: (next: LineDraft[]) => void
  types: EquipmentType[]
  enclaves: Enclave[]
  /** Enclave ids with a visible section. Seeded from `lines`, then owned by
   *  the checkboxes so an empty section can exist while being filled in. */
  active: number[]
  onActiveChange: (next: number[]) => void
  disabled?: boolean
}) {
  const typeById = new Map(types.map((t) => [t.id, t]))

  function update(index: number, patch: Partial<LineDraft>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function toggleEnclave(id: number) {
    if (active.includes(id)) {
      // Dropping a section drops its contents — they only exist as part of
      // that enclave's stack. Local state until save, so it's undoable by
      // cancelling.
      onActiveChange(active.filter((x) => x !== id))
      onChange(lines.filter((l) => l.enclave_id !== id))
    } else {
      onActiveChange([...active, id])
    }
  }

  /** Sections in catalog order, with common gear last — it's the tail of the
   *  packing list, not the headline. */
  const sections: { enclave: Enclave | null; rows: LineDraft[] }[] = [
    ...enclaves
      .filter((e) => active.includes(e.id))
      .map((e) => ({
        enclave: e,
        rows: lines.filter((l) => l.enclave_id === e.id),
      })),
    { enclave: null, rows: lines.filter((l) => l.enclave_id === null) },
  ]

  /** Types this enclave can host, per the catalog's declared capability.
   *  A type declaring nothing is unrestricted, so it stays offered. */
  function typesFor(enclave: Enclave | null): EquipmentType[] {
    if (!enclave) return types
    return types.filter(
      (t) => t.enclave_ids.length === 0 || t.enclave_ids.includes(enclave.id),
    )
  }

  function addRow(enclaveId: number | null) {
    onChange([
      ...lines,
      { equipment_type_id: "", quantity: 1, enclave_id: enclaveId },
    ])
  }

  return (
    <div className="flex flex-col gap-3">
      {enclaves.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Enclaves this UTC supports
          </span>
          <div className="flex flex-wrap gap-1.5">
            {enclaves.map((en) => {
              const on = active.includes(en.id)
              const count = lines.filter((l) => l.enclave_id === en.id).length
              return (
                <label
                  key={en.id}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    on ? enclaveChipClass(en.color) : "border-dashed text-muted-foreground",
                  )}
                  style={on ? enclaveChipStyle(en.color) : undefined}
                  title={
                    on && count > 0
                      ? `Unchecking removes ${count} line${count === 1 ? "" : "s"}`
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    className="size-3"
                    checked={on}
                    disabled={disabled}
                    onChange={() => toggleEnclave(en.id)}
                  />
                  {en.short_name || en.name}
                  {on && count > 0 && (
                    <span className="font-mono opacity-70">{count}</span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {sections.map(({ enclave, rows }) => {
        // The common section is always shown — every UTC has power and cables.
        if (!enclave && rows.length === 0 && enclaves.length > 0) {
          return (
            <Section
              key="common"
              enclave={null}
              onAdd={() => addRow(null)}
              disabled={disabled}
            />
          )
        }
        return (
          <Section
            key={enclave?.id ?? "common"}
            enclave={enclave}
            onAdd={() => addRow(enclave?.id ?? null)}
            disabled={disabled}
          >
            {rows.map((row) => {
              const index = lines.indexOf(row)
              const offered = typesFor(enclave)
              const chosen = row.equipment_type_id
                ? typeById.get(Number(row.equipment_type_id))
                : undefined
              // A type already on the line but no longer offered still has to
              // appear, or changing an unrelated field would silently blank it.
              const options =
                chosen && !offered.some((t) => t.id === chosen.id)
                  ? [...offered, chosen]
                  : offered
              return (
                <div key={index} className="flex gap-1.5">
                  <select
                    aria-label="Equipment type"
                    className={cn(SELECT_CLASS, "h-8 flex-1")}
                    value={row.equipment_type_id}
                    disabled={disabled}
                    onChange={(e) =>
                      update(index, {
                        equipment_type_id: e.target.value
                          ? Number(e.target.value)
                          : "",
                      })
                    }
                  >
                    <option value="">Select a type…</option>
                    {options.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.short_name ?? t.title}
                        {!t.serialized ? " (bulk)" : ""}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={1}
                    aria-label="Quantity"
                    className="h-8 w-16"
                    value={row.quantity}
                    disabled={disabled}
                    onChange={(e) =>
                      update(index, {
                        quantity: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Remove line"
                    disabled={disabled}
                    onClick={() => onChange(lines.filter((_, i) => i !== index))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              )
            })}
          </Section>
        )
      })}
    </div>
  )
}

function Section({
  enclave,
  children,
  onAdd,
  disabled,
}: {
  enclave: Enclave | null
  children?: React.ReactNode
  onAdd: () => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
      <div className="flex items-center gap-2">
        {enclave ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
              enclaveChipClass(enclave.color),
            )}
            style={enclaveChipStyle(enclave.color)}
          >
            {enclave.short_name || enclave.name}
          </span>
        ) : (
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Common to every enclave
          </span>
        )}
        {enclave && (
          <span className="text-[11px] text-muted-foreground">
            {enclave.name}
          </span>
        )}
      </div>
      {children}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 self-start text-xs"
        disabled={disabled}
        onClick={onAdd}
      >
        <Plus className="size-3.5" />
        Add item
      </Button>
    </div>
  )
}

/** Enclave ids that already have lines — the starting set of visible sections. */
export function activeEnclavesFrom(lines: LineDraft[]): number[] {
  return [
    ...new Set(
      lines
        .map((l) => l.enclave_id)
        .filter((id): id is number => id !== null),
    ),
  ]
}
