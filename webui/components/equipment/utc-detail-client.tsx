"use client"

import { ChevronRight, Plus, Trash2, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { EnclaveChip } from "@/components/enclaves/enclaves-client"
import { EquipmentStatusPill } from "@/components/equipment/equipment-status-pill"
import { UtcCompletenessPanel } from "@/components/equipment/utc-completeness-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CAPABILITY_LABELS, equipmentIcon } from "@/lib/equipment-meta"
import { statusBadgeClass } from "@/lib/status"
import { useWorkspace } from "@/lib/workspace"
import { cn } from "@/lib/utils"
import type {
  Enclave,
  Equipment,
  EquipmentCapability,
  EquipmentHolding,
  EquipmentType,
  Gateway,
  Service,
  UtcInstance,
} from "@/lib/types"

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-sm"

interface Props {
  utc: UtcInstance
  equipment: Equipment[]
  holdings: EquipmentHolding[]
  types: EquipmentType[]
  enclaves: Enclave[]
  services: Service[]
  gateways: Gateway[]
}

/** Everything about one UTC that's already in the field.
 *
 *  The deploy wizard is a one-shot: it collects serials, enclaves and wiring
 *  in a single transaction and then closes. Reality moves after that — a radio
 *  gets borrowed, a serial was typed wrong, a kit moves to the other enclave,
 *  a binding was never made. Without this view the only way to fix any of it
 *  was piece-by-piece through the flat equipment list, which loses the UTC as
 *  the organizing unit entirely.
 *
 *  Serialized gear groups by enclave for the same reason the bill of materials
 *  does: that's how the stack is described out loud. */
export function UtcDetailClient({
  utc,
  equipment,
  holdings,
  types,
  enclaves,
  services,
  gateways,
}: Props) {
  const { w } = useWorkspace()
  const enclaveById = useMemo(
    () => new Map(enclaves.map((e) => [e.id, e])),
    [enclaves],
  )
  // Every site this UTC reaches, not just its home. A UTC that shoots to a
  // second location backs the services at the far end too — that's the whole
  // point of the extension — and the API stopped rejecting those binds.
  const reached = new Set(utc.site_ids.length ? utc.site_ids : [utc.site_id])
  const siteServices = services.filter((s) => reached.has(s.site_id))
  const siteGateways = gateways.filter((g) => reached.has(g.site_id))
  const spread = reached.size > 1

  /** Sections in catalog order, untagged last. Mirrors the bill of materials
   *  so the deployed thing reads like the doctrine it came from. */
  const sections = useMemo(() => {
    const out: { enclave: Enclave | null; items: Equipment[] }[] = []
    for (const en of enclaves) {
      const items = equipment.filter((e) => e.enclave_id === en.id)
      if (items.length > 0) out.push({ enclave: en, items })
    }
    const untagged = equipment.filter(
      (e) => e.enclave_id === null || !enclaveById.has(e.enclave_id),
    )
    if (untagged.length > 0) out.push({ enclave: null, items: untagged })
    return out
  }, [equipment, enclaves, enclaveById])

  const roleDisagrees =
    utc.derived_role !== null && utc.derived_role !== utc.role

  /** Names for the sites this UTC reaches beyond its home, read off the gear
   *  that's actually sitting there. */
  const awaySites = useMemo(() => {
    const names = new Map<number, string>()
    for (const e of equipment) {
      if (e.site_id !== utc.site_id) {
        names.set(e.site_id, e.site_name ?? `Site ${e.site_id}`)
      }
    }
    return Array.from(names.entries()).map(([id, name]) => ({ id, name }))
  }, [equipment, utc.site_id])

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            {utc.name}
            {utc.utc_def_code && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal">
                {utc.utc_def_code}
              </span>
            )}
          </h1>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <Link
              href={w(`/sites/${utc.site_id}`)}
              className="hover:underline"
            >
              {utc.site_name ?? `Site ${utc.site_id}`}
            </Link>
            {utc.package_name && (
              <>
                <ChevronRight className="size-3" />
                <span>{utc.package_name}</span>
              </>
            )}
            <ChevronRight className="size-3" />
            <span>{utc.role}</span>
          </p>
          {spread && awaySites.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              {/* A UTC with gear at another site IS the extension. Saying so
                  here is what makes standing up a second UTC to represent it
                  unnecessary. */}
              <span>Also reaches</span>
              {awaySites.map((s) => (
                <Link
                  key={s.id}
                  href={w(`/sites/${s.id}`)}
                  className="rounded-full border border-sky-500/50 bg-sky-500/10 px-1.5 py-0.5 text-sky-700 hover:underline dark:text-sky-400"
                >
                  {s.name}
                </Link>
              ))}
            </p>
          )}
          {roleDisagrees && (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
              <TriangleAlert className="size-3" />
              Declared {utc.role}, but the link graph says{" "}
              {utc.derived_role}.
            </p>
          )}
        </div>
        <DeleteUtc utc={utc} equipmentCount={equipment.length} />
      </header>

      <UtcCompletenessPanel utc={utc} enclaves={enclaves} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Serialized equipment
          </h2>
          <AddEquipment utc={utc} types={types} enclaves={enclaves} />
        </div>

        {equipment.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Nothing serialized on this UTC yet.
          </p>
        ) : (
          sections.map(({ enclave, items }) => (
            <div
              key={enclave?.id ?? "untagged"}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                {enclave ? (
                  <>
                    <EnclaveChip enclave={enclave} />
                    <span className="text-[11px] text-muted-foreground">
                      {enclave.name}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    No enclave assigned
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  · {items.length}
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {items.map((e) => (
                  <EquipmentRow
                    key={e.id}
                    equipment={e}
                    enclaves={enclaves}
                    types={types}
                    services={siteServices}
                    gateways={siteGateways}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {holdings.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Bulk holdings
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Counted, not tracked per item — a box of cables serves every
            enclave, so these carry no enclave of their own.
          </p>
          <ul className="flex flex-col gap-1.5">
            {holdings.map((h) => (
              <HoldingRow key={h.id} holding={h} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** Delete this deployment.
 *
 *  The server deliberately does NOT take the gear with it — `utc_instance_id`
 *  is SET NULL, because a radio outlives the UTC it arrived in. That is right
 *  for a redeployment and wrong for "this deploy was a mistake, start over",
 *  which leaves phantom equipment nobody can account for. So the choice is put
 *  in front of the operator instead of being decided for them, and the gear is
 *  deleted first — after the UTC is gone there's nothing left to find it by. */
function DeleteUtc({
  utc,
  equipmentCount,
}: {
  utc: UtcInstance
  equipmentCount: number
}) {
  const router = useRouter()
  const { w } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [withGear, setWithGear] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setPending(true)
    setError(null)
    try {
      if (withGear && equipmentCount > 0) {
        const list: Equipment[] = await fetch(
          `/api/be/equipment?utc_instance_id=${utc.id}`,
        ).then((r) => (r.ok ? r.json() : []))
        for (const e of list) {
          const res = await fetch(`/api/be/equipment/${e.id}`, {
            method: "DELETE",
          })
          if (!res.ok) throw new Error(`${e.equipment_code} (${res.status})`)
        }
      }
      const res = await fetch(`/api/be/utcs/${utc.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(`the UTC itself (${res.status})`)
      router.push(w("/equipment?view=utcs"))
      router.refresh()
    } catch (e) {
      setError(
        `Could not delete ${e instanceof Error ? e.message : "it"} — anything already deleted stays deleted.`,
      )
      setPending(false)
      router.refresh()
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
        Delete UTC
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
      <p className="text-xs">
        Delete <span className="font-medium">{utc.name}</span>? Its bulk
        holdings and expected contents go with it.
      </p>
      {equipmentCount > 0 && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={withGear}
            disabled={pending}
            onChange={(e) => setWithGear(e.target.checked)}
          />
          Also delete its {equipmentCount} serialized{" "}
          {equipmentCount === 1 ? "item" : "items"}
          <span className="text-muted-foreground">
            — unchecked, they stay registered with no UTC
          </span>
        </label>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={run}
        >
          {pending ? "Deleting…" : "Delete"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

function EquipmentRow({
  equipment,
  enclaves,
  types,
  services,
  gateways,
}: {
  equipment: Equipment
  enclaves: Enclave[]
  types: EquipmentType[]
  services: Service[]
  gateways: Gateway[]
}) {
  const router = useRouter()
  const { w } = useWorkspace()
  const [pending, setPending] = useState(false)
  const [serial, setSerial] = useState(equipment.serial_number ?? "")
  const [open, setOpen] = useState(false)
  const Icon = equipmentIcon(equipment.type_category)

  const type = types.find((t) => t.id === equipment.equipment_type_id)
  // Empty declaration means unrestricted, so fall back to everything.
  const offered =
    type && type.enclave_ids.length > 0
      ? enclaves.filter((e) => type.enclave_ids.includes(e.id))
      : enclaves
  const current = enclaves.find((e) => e.id === equipment.enclave_id)
  const options =
    current && !offered.some((e) => e.id === current.id)
      ? [...offered, current]
      : offered

  async function patch(body: Record<string, unknown>) {
    setPending(true)
    try {
      const res = await fetch(`/api/be/equipment/${equipment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) router.refresh()
      return res.ok
    } finally {
      setPending(false)
    }
  }

  async function destroy() {
    setPending(true)
    try {
      const res = await fetch(`/api/be/equipment/${equipment.id}`, {
        method: "DELETE",
      })
      if (res.ok) router.refresh()
      else alert(`Could not delete ${equipment.equipment_code} (${res.status}).`)
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <Link
          href={w(`/equipment/${equipment.id}`)}
          className="font-mono text-sm font-medium hover:underline"
        >
          {equipment.equipment_code}
        </Link>
        <span className="text-sm text-muted-foreground">
          {equipment.type_short_name ?? equipment.type_title}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <EquipmentStatusPill
            target="equipment"
            id={equipment.id}
            label={equipment.equipment_code}
            status={equipment.status}
            lastValidatedAt={equipment.validated_at}
            lastValidatedBy={equipment.validated_by_username}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "Edit"}
          </Button>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Serial
              </span>
              <span className="flex items-center gap-1.5">
                <Input
                  className="h-8 w-48 font-mono"
                  value={serial}
                  disabled={pending}
                  onChange={(ev) => setSerial(ev.target.value)}
                />
                {serial !== (equipment.serial_number ?? "") && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    disabled={pending}
                    onClick={() =>
                      patch({ serial_number: serial.trim() || null })
                    }
                  >
                    Save
                  </Button>
                )}
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Enclave
              </span>
              <select
                className={SELECT_CLASS}
                value={equipment.enclave_id ?? ""}
                disabled={pending}
                onChange={(ev) =>
                  patch({
                    enclave_id: ev.target.value
                      ? Number(ev.target.value)
                      : null,
                  })
                }
              >
                <option value="">None</option>
                {options.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.name}
                    {current?.id === en.id &&
                    !offered.some((o) => o.id === en.id)
                      ? " (not declared for this type)"
                      : ""}
                  </option>
                ))}
              </select>
            </label>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              disabled={pending}
              title="Leaves the gear registered, just no longer part of this UTC"
              onClick={() => {
                if (
                  confirm(
                    `Remove ${equipment.equipment_code} from this UTC? The gear stays registered — this is how a borrowed radio is recorded.`,
                  )
                )
                  patch({ utc_instance_id: null })
              }}
            >
              <Trash2 className="size-3.5" />
              Remove from UTC
            </Button>

            {/* Detaching and deleting are different acts and were not
                distinguishable before: a serial typed wrong during a deploy has
                to be *unregistered*, not handed back to the pool as a phantom
                radio nobody owns. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={pending}
              title="Unregisters this gear entirely"
              onClick={() => {
                if (
                  confirm(
                    `Delete ${equipment.equipment_code} permanently? ` +
                      `It stops existing in the workspace, along with its capabilities and bindings. This cannot be undone.`,
                  )
                )
                  destroy()
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>

          <CapabilityBindings
            equipment={equipment}
            services={services}
            gateways={gateways}
          />
        </div>
      )}
    </li>
  )
}

function CapabilityBindings({
  equipment,
  services,
  gateways,
}: {
  equipment: Equipment
  services: Service[]
  gateways: Gateway[]
}) {
  if (equipment.capabilities.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No capabilities materialized on this unit.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Capabilities and what they back
      </span>
      {equipment.capabilities.map((c) => (
        <BindingRow
          key={c.id}
          equipment={equipment}
          capability={c}
          services={services}
          gateways={gateways}
        />
      ))}
    </div>
  )
}

function BindingRow({
  equipment,
  capability,
  services,
  gateways,
}: {
  equipment: Equipment
  capability: EquipmentCapability
  services: Service[]
  gateways: Gateway[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  /** Same endpoints the equipment detail page uses — PUT to bind, DELETE to
   *  unbind, both keyed by capability. */
  async function toggle(
    kind: "services" | "gateways",
    id: number,
    on: boolean,
  ) {
    setPending(true)
    try {
      await fetch(`/api/be/capabilities/${capability.id}/${kind}/${id}`, {
        method: on ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
      })
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-md border p-2",
        statusBadgeClass(capability.status),
      )}
    >
      <EquipmentStatusPill
        target="capability"
        id={capability.id}
        label={`${equipment.equipment_code} — ${capability.label}`}
        status={capability.status}
        lastValidatedAt={capability.validated_at}
        lastValidatedBy={capability.validated_by_username}
        displayText={CAPABILITY_LABELS[capability.kind]}
        className="gap-1"
      />
      <span className="text-xs">{capability.label}</span>
      <span className="ml-auto flex flex-wrap items-center gap-1">
        {services.length === 0 && gateways.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">
            Nothing at this site to bind to yet
          </span>
        ) : (
          <>
            {services.map((s) => {
              const on = capability.bindings.service_ids.includes(s.id)
              return (
                <Button
                  key={`s-${s.id}`}
                  type="button"
                  size="sm"
                  variant={on ? "secondary" : "outline"}
                  disabled={pending}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => toggle("services", s.id, on)}
                >
                  {s.name}
                </Button>
              )
            })}
            {gateways.map((g) => {
              const on = capability.bindings.gateway_ids.includes(g.id)
              return (
                <Button
                  key={`g-${g.id}`}
                  type="button"
                  size="sm"
                  variant={on ? "secondary" : "outline"}
                  disabled={pending}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => toggle("gateways", g.id, on)}
                >
                  {g.name}
                </Button>
              )
            })}
          </>
        )}
      </span>
    </div>
  )
}

function HoldingRow({ holding }: { holding: EquipmentHolding }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [auth, setAuth] = useState(holding.authorized_qty)
  const [onHand, setOnHand] = useState(holding.on_hand_qty)
  const dirty =
    auth !== holding.authorized_qty || onHand !== holding.on_hand_qty

  async function save() {
    setPending(true)
    try {
      const res = await fetch(`/api/be/holdings/${holding.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorized_qty: auth, on_hand_qty: onHand }),
      })
      if (res.ok) router.refresh()
    } finally {
      setPending(false)
    }
  }

  const short = holding.on_hand_qty < holding.authorized_qty

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2.5">
      <span className="text-sm">
        {holding.type_short_name ?? holding.type_title}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          Auth
          <Input
            type="number"
            min={0}
            className="h-7 w-16"
            value={auth}
            disabled={pending}
            onChange={(e) => setAuth(Number(e.target.value) || 0)}
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          On hand
          <Input
            type="number"
            min={0}
            className={cn("h-7 w-16", short && "border-amber-500/60")}
            value={onHand}
            disabled={pending}
            onChange={(e) => setOnHand(Number(e.target.value) || 0)}
          />
        </label>
        {dirty && (
          <Button
            type="button"
            size="sm"
            className="h-7"
            disabled={pending}
            onClick={save}
          >
            Save
          </Button>
        )}
      </span>
    </li>
  )
}

/** Register a piece of gear straight onto this UTC. The deploy wizard is a
 *  one-shot; this is the "we forgot the spare radio" path. */
function AddEquipment({
  utc,
  types,
  enclaves,
}: {
  utc: UtcInstance
  types: EquipmentType[]
  enclaves: Enclave[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typeId, setTypeId] = useState<number | "">("")
  const [serial, setSerial] = useState("")
  const [enclaveId, setEnclaveId] = useState<number | "">("")

  const type = typeId ? types.find((t) => t.id === typeId) : undefined
  const offered =
    type && type.enclave_ids.length > 0
      ? enclaves.filter((e) => type.enclave_ids.includes(e.id))
      : enclaves

  async function submit() {
    setPending(true)
    setError(null)
    const res = await fetch("/api/be/equipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        equipment_type_id: Number(typeId),
        site_id: utc.site_id,
        utc_instance_id: utc.id,
        serial_number: serial.trim() || null,
        enclave_id: enclaveId === "" ? null : Number(enclaveId),
      }),
    })
    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const detail = body?.detail
      // The server refuses to silently rename a colliding equipment ID and
      // hands back a suggestion; surface both. Same shape as the wizard.
      if (detail && typeof detail === "object" && detail.message) {
        setError(
          detail.suggestion
            ? `${detail.message} Try ${detail.suggestion}.`
            : detail.message,
        )
      } else {
        setError(
          typeof detail === "string" ? detail : `Failed (${res.status})`,
        )
      }
      return
    }
    setOpen(false)
    setTypeId("")
    setSerial("")
    setEnclaveId("")
    router.refresh()
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" />
        Add equipment
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
      <select
        aria-label="Equipment type"
        className={SELECT_CLASS}
        value={typeId}
        disabled={pending}
        onChange={(e) => {
          setTypeId(e.target.value ? Number(e.target.value) : "")
          setEnclaveId("")
        }}
      >
        <option value="">Type…</option>
        {types
          .filter((t) => t.serialized)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.short_name ?? t.title}
            </option>
          ))}
      </select>
      <Input
        className="h-8 w-40 font-mono"
        placeholder="Serial"
        value={serial}
        disabled={pending}
        onChange={(e) => setSerial(e.target.value)}
      />
      {enclaves.length > 0 && (
        <select
          aria-label="Enclave"
          className={SELECT_CLASS}
          value={enclaveId}
          disabled={pending}
          onChange={(e) =>
            setEnclaveId(e.target.value ? Number(e.target.value) : "")
          }
        >
          <option value="">No enclave</option>
          {offered.map((en) => (
            <option key={en.id} value={en.id}>
              {en.name}
            </option>
          ))}
        </select>
      )}
      <Button
        type="button"
        size="sm"
        className="h-8"
        disabled={pending || typeId === ""}
        onClick={submit}
      >
        {pending ? "Adding…" : "Add"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8"
        disabled={pending}
        onClick={() => {
          setOpen(false)
          setError(null)
        }}
      >
        Cancel
      </Button>
      {error && (
        <p className="w-full text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}
