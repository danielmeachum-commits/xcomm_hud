"use client"

import { Plus, RadioTower, SlidersHorizontal, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { ManageBar } from "@/components/equipment/manage-bar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { enclaveChipClass, enclaveChipStyle } from "@/lib/enclave-meta"
import { CAPABILITY_LABELS } from "@/lib/equipment-meta"
import { serviceIcon } from "@/lib/service-meta"
import type {
  CapabilityKind,
  Enclave,
  EquipmentType,
  ServiceTemplate,
  UtcDef,
  UtcDefServiceInput,
  UtcDefServiceWire,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const SELECT_CLASS =
  "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs"

type WireDraft = Omit<UtcDefServiceWire, "id">

interface ServiceDraft {
  service_template_id: number
  wires: WireDraft[]
}

function draftsOf(def: UtcDef): ServiceDraft[] {
  return [...def.services]
    .sort((a, b) => a.display_order - b.display_order)
    .map((s) => ({
      service_template_id: s.service_template_id,
      wires: s.wires.map((w) => ({
        equipment_type_id: w.equipment_type_id,
        enclave_id: w.enclave_id,
        capability_kind: w.capability_kind,
        role: w.role,
        required: w.required,
        group_key: w.group_key,
      })),
    }))
}

function wireKey(w: {
  equipment_type_id: number
  enclave_id: number | null
  capability_kind: string
}): string {
  return `${w.equipment_type_id}:${w.enclave_id ?? ""}:${w.capability_kind}`
}

/** Every field that reaches the API, in order. */
function signature(rows: ServiceDraft[]): string {
  return JSON.stringify(
    rows.map((r) => [
      r.service_template_id,
      r.wires.map((w) => [
        wireKey(w),
        w.required,
        w.required ? (w.group_key ?? "").trim() : "",
      ]),
    ]),
  )
}

/** One capability a LOGDET line can offer — what a wire can point at. */
interface BackingOption {
  key: string
  equipment_type_id: number
  enclave_id: number | null
  capability_kind: CapabilityKind
}

/**
 * The services a UTC brings up wherever it deploys, each pre-wired to the gear
 * on its LOGDET that backs it.
 *
 * What it does not hold is the PACE plan or the criticality: which tiers a
 * site can use depends on the gateways it actually has, and how critical a
 * service is depends on the mission, so the deploy wizard asks for both every
 * time. Saying so on the page is the point of the subtitle.
 *
 * Wires point at the SAVED LOGDET (`def.lines`), not the one being edited in
 * the section above — the two save independently, and the API checks wires
 * against what is stored.
 */
export function UtcServicesSection({
  def,
  types,
  enclaves,
  templates,
  editable,
}: {
  def: UtcDef
  types: EquipmentType[]
  enclaves: Enclave[]
  templates: ServiceTemplate[]
  editable: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<ServiceDraft[]>(() => draftsOf(def))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])
  const enclaveById = useMemo(
    () => new Map(enclaves.map((e) => [e.id, e])),
    [enclaves],
  )
  const templateById = useMemo(
    () => new Map(templates.map((t) => [t.id, t])),
    [templates],
  )

  /** Each saved line × each capability its type declares. A line appears once
   *  per (type, enclave), which is how the API names it. */
  const options = useMemo<BackingOption[]>(() => {
    const seen = new Set<string>()
    const out: BackingOption[] = []
    for (const line of [...def.lines].sort(
      (a, b) => a.display_order - b.display_order,
    )) {
      const t = typeById.get(line.equipment_type_id)
      if (!t) continue
      const kinds = [...new Set(t.capabilities.map((c) => c.kind))]
      for (const kind of kinds) {
        const opt = {
          equipment_type_id: line.equipment_type_id,
          enclave_id: line.enclave_id,
          capability_kind: kind,
        }
        const key = wireKey(opt)
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ ...opt, key })
      }
    }
    return out
  }, [def.lines, typeById])

  function backingLabel(w: {
    equipment_type_id: number
    enclave_id: number | null
    capability_kind: CapabilityKind
  }): string {
    const t = typeById.get(w.equipment_type_id)
    const name = t ? t.short_name || t.title : "Unknown equipment"
    const en = w.enclave_id !== null ? enclaveById.get(w.enclave_id) : null
    const where = en ? ` (${en.short_name || en.name})` : ""
    return `${name}${where} · ${CAPABILITY_LABELS[w.capability_kind] ?? w.capability_kind}`
  }

  const dirty = signature(rows) !== signature(draftsOf(def))
  const available = templates.filter(
    (t) => !rows.some((r) => r.service_template_id === t.id),
  )

  function startEditing() {
    setRows(draftsOf(def))
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setRows(draftsOf(def))
    setError(null)
    setEditing(false)
  }

  function patchRow(index: number, next: ServiceDraft) {
    setRows(rows.map((r, i) => (i === index ? next : r)))
  }

  async function save() {
    setPending(true)
    setError(null)
    const body: UtcDefServiceInput[] = rows.map((r) => ({
      service_template_id: r.service_template_id,
      wires: r.wires.map((w) => ({
        ...w,
        group_key: w.required ? (w.group_key ?? "").trim() || null : null,
      })),
    }))
    const res = await fetch(`/api/be/utc-defs/${def.id}/services`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setPending(false)
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      setError(
        typeof detail.detail === "string" ? detail.detail : "Failed to save",
      )
      return
    }
    setEditing(false)
    router.refresh()
  }

  const shown = editing ? rows : draftsOf(def)

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              <RadioTower className="size-4 text-muted-foreground" />
              Services
            </h2>
            {shown.length > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {shown.length}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            What this UTC brings up where it deploys. The PACE plan and
            criticality are set at each deployment.
          </p>
        </div>
        {editable && !editing && (
          <Button variant="ghost" size="sm" onClick={startEditing}>
            <SlidersHorizontal data-icon="inline-start" />
            Manage
          </Button>
        )}
      </div>

      {shown.length === 0 && !editing && (
        <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
          No services — deploying this UTC registers its gear but brings up
          nothing.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {shown.map((row, index) => {
          const tpl = templateById.get(row.service_template_id)
          const saved = def.services.find(
            (s) => s.service_template_id === row.service_template_id,
          )
          const name =
            tpl?.name ?? saved?.service_template_name ?? "Unknown service"
          const kind = tpl?.kind ?? saved?.kind ?? "other"
          const enclaveId = tpl?.enclave_id ?? saved?.enclave_id ?? null
          const enclave =
            enclaveId !== null ? enclaveById.get(enclaveId) : undefined
          const Icon = serviceIcon(tpl?.icon, kind)
          const wired = new Set(row.wires.map(wireKey))
          // Same-enclave gear first: it is almost always the answer, and the
          // rest stay on offer for a box shared across enclaves.
          const offer = options
            .filter((o) => !wired.has(o.key))
            .sort(
              (a, b) =>
                Number(b.enclave_id === enclaveId) -
                Number(a.enclave_id === enclaveId),
            )
          return (
            <div
              key={row.service_template_id}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2.5 text-sm"
            >
              <div className="flex items-center gap-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-medium">{name}</span>
                {enclave && (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px]",
                      enclaveChipClass(enclave.color),
                    )}
                    style={enclaveChipStyle(enclave.color)}
                  >
                    {enclave.short_name || enclave.name}
                  </span>
                )}
                {editing && (
                  <button
                    type="button"
                    className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                    aria-label={`Remove ${name}`}
                    disabled={pending}
                    onClick={() =>
                      setRows(rows.filter((_, i) => i !== index))
                    }
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {row.wires.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Not pre-wired — the deploy wizard will only suggest backing
                  gear.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {row.wires.map((w, wi) => (
                    <li
                      key={wireKey(w)}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {backingLabel(w)}
                      </span>
                      {editing ? (
                        <>
                          <label className="flex items-center gap-1.5">
                            <Checkbox
                              checked={w.required}
                              disabled={pending}
                              onCheckedChange={(checked) =>
                                patchRow(index, {
                                  ...row,
                                  wires: row.wires.map((x, xi) =>
                                    xi === wi
                                      ? { ...x, required: checked === true }
                                      : x,
                                  ),
                                })
                              }
                            />
                            Required
                          </label>
                          <Input
                            value={w.group_key ?? ""}
                            disabled={pending || !w.required}
                            maxLength={48}
                            placeholder="Redundancy group"
                            aria-label="Redundancy group"
                            title="Required capabilities in the same group back each other up: the service is down only when all of them are."
                            className="h-7 w-36 text-xs"
                            onChange={(e) =>
                              patchRow(index, {
                                ...row,
                                wires: row.wires.map((x, xi) =>
                                  xi === wi
                                    ? { ...x, group_key: e.target.value }
                                    : x,
                                ),
                              })
                            }
                          />
                          <button
                            type="button"
                            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                            aria-label={`Remove ${backingLabel(w)}`}
                            disabled={pending}
                            onClick={() =>
                              patchRow(index, {
                                ...row,
                                wires: row.wires.filter((_, xi) => xi !== wi),
                              })
                            }
                          >
                            <X className="size-3" />
                          </button>
                        </>
                      ) : (
                        <span className="shrink-0 text-muted-foreground">
                          {w.required
                            ? w.group_key
                              ? `Required · group ${w.group_key}`
                              : "Required"
                            : "Context"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {editing && (
                <AddBackingForm
                  options={offer}
                  labelOf={backingLabel}
                  disabled={pending}
                  onAdd={(o) =>
                    patchRow(index, {
                      ...row,
                      wires: [
                        ...row.wires,
                        {
                          equipment_type_id: o.equipment_type_id,
                          enclave_id: o.enclave_id,
                          capability_kind: o.capability_kind,
                          role: "endpoint",
                          required: false,
                          group_key: null,
                        },
                      ],
                    })
                  }
                />
              )}
            </div>
          )
        })}
      </div>

      {editing && (
        <>
          <AddServiceForm
            templates={available}
            enclaveById={enclaveById}
            disabled={pending}
            onAdd={(id) =>
              setRows([...rows, { service_template_id: id, wires: [] }])
            }
          />
          <ManageBar
            hint="Add a service, then choose the gear that backs it."
            error={error}
            dirty={dirty}
            pending={pending}
            onCancel={cancel}
            onSave={save}
          />
        </>
      )}
    </section>
  )
}

function AddServiceForm({
  templates,
  enclaveById,
  disabled,
  onAdd,
}: {
  templates: ServiceTemplate[]
  enclaveById: Map<number, Enclave>
  disabled: boolean
  onAdd: (templateId: number) => void
}) {
  const [choice, setChoice] = useState("")
  const value =
    choice && templates.some((t) => String(t.id) === choice)
      ? choice
      : String(templates[0]?.id ?? "")
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-border p-2">
      <select
        value={value}
        onChange={(e) => setChoice(e.target.value)}
        disabled={disabled || templates.length === 0}
        aria-label="Service"
        className={cn(SELECT_CLASS, "w-56")}
      >
        {templates.length === 0 && <option value="">Every service added</option>}
        {templates.map((t) => {
          const en = t.enclave_id !== null ? enclaveById.get(t.enclave_id) : null
          return (
            <option key={t.id} value={t.id}>
              {t.name}
              {en ? ` — ${en.short_name || en.name}` : ""}
            </option>
          )
        })}
      </select>
      <Button
        variant="outline"
        size="sm"
        className="h-8"
        disabled={disabled || value === ""}
        onClick={() => onAdd(Number(value))}
      >
        <Plus data-icon="inline-start" />
        Add service
      </Button>
    </div>
  )
}

function AddBackingForm({
  options,
  labelOf,
  disabled,
  onAdd,
}: {
  options: BackingOption[]
  labelOf: (option: BackingOption) => string
  disabled: boolean
  onAdd: (option: BackingOption) => void
}) {
  const [choice, setChoice] = useState("")
  const picked = options.find((o) => o.key === choice) ?? options[0]
  if (options.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Nothing else on the equipment list can back this service.
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={picked?.key ?? ""}
        onChange={(e) => setChoice(e.target.value)}
        disabled={disabled}
        aria-label="Backing capability"
        className={cn(SELECT_CLASS, "w-64")}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {labelOf(o)}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        className="h-8"
        disabled={disabled || !picked}
        onClick={() => picked && onAdd(picked)}
      >
        <Plus data-icon="inline-start" />
        Back with this
      </Button>
    </div>
  )
}
