"use client"

import { Check, Plus, Wrench } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { EquipmentStatusPill } from "@/components/equipment/equipment-status-pill"
import { LinkForm } from "@/components/equipment/link-form"
import { Button } from "@/components/ui/button"
import {
  CAPABILITY_LABELS,
  EQUIPMENT_CATEGORY_LABELS,
  LINK_KIND_LABELS,
  equipmentIcon,
} from "@/lib/equipment-meta"
import { statusBadgeClass, statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type {
  Enclave,
  Equipment,
  EquipmentType,
  EquipmentCapability,
  EquipmentLink,
  Event,
  Gateway,
  Service,
  Site,
  UtcInstance,
} from "@/lib/types"

interface Props {
  equipment: Equipment
  enclaves?: Enclave[]
  /** The catalog row, for its declared capable-enclave set. */
  equipmentType?: EquipmentType | null
  services: Service[]
  gateways: Gateway[]
  links: EquipmentLink[]
  /** Every piece of gear in the workspace, for the link editor's other end. */
  allEquipment?: Equipment[]
  /** Workspace sites, so this gear can be placed at one of them. */
  sites?: Site[]
  /** The UTC this gear came in on, if any — for the away-from-home note. */
  utc?: UtcInstance | null
  events: Event[]
}

export function EquipmentDetailClient({
  equipment,
  enclaves = [],
  equipmentType = null,
  services,
  gateways,
  links,
  allEquipment = [],
  sites = [],
  utc = null,
  events,
}: Props) {
  const Icon = equipmentIcon(equipment.type_category)

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon className="size-7 text-muted-foreground" />
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-tight">
              {equipment.equipment_code}
            </h1>
            <p className="text-xs text-muted-foreground">
              {equipment.type_title}
              {equipment.type_short_name ? ` · ${equipment.type_short_name}` : ""}
            </p>
          </div>
        </div>
        <EquipmentStatusPill
          target="equipment"
          id={equipment.id}
          label={`${equipment.equipment_code} — whole unit`}
          status={equipment.status}
          lastValidatedAt={equipment.validated_at}
          lastValidatedBy={equipment.validated_by_username}
        />
      </div>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Identity
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Field label="Equipment ID" value={equipment.equipment_code} mono />
          <Field label="Serial" value={equipment.serial_number ?? "—"} mono />
          <Field label="NSN" value={equipment.nsn ?? "—"} mono />
          <Field
            label="Category"
            value={
              equipment.type_category
                ? EQUIPMENT_CATEGORY_LABELS[equipment.type_category]
                : "—"
            }
          />
          <SiteField equipment={equipment} sites={sites} utc={utc} />
          <Field label="UTC" value={equipment.utc_name ?? "Not in a UTC"} />
          <EnclaveField
            equipment={equipment}
            enclaves={enclaves}
            capableIds={equipmentType?.enclave_ids ?? []}
          />
        </dl>
        {equipment.notes && (
          <p className="mt-3 text-sm text-muted-foreground">{equipment.notes}</p>
        )}
      </section>

      <CapabilitiesSection
        equipment={equipment}
        services={services}
        gateways={gateways}
      />

      <ConnectionsSection
        equipment={equipment}
        links={links}
        allEquipment={allEquipment}
      />

      {/* Phase 2 lands here. Stubbed rather than omitted so the shape of the
          page doesn't shift when maintenance tracking arrives. */}
      <section className="rounded-lg border border-dashed border-border p-4">
        <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Wrench className="size-3.5" />
          Maintenance
        </h2>
        <p className="text-sm text-muted-foreground">
          JCN tracking is planned for a later phase. For now, record
          discrepancies as a note on the affected capability&apos;s status.
        </p>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Recent activity
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  {e.note || e.type_slug || "Event"}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {new Date(e.validated_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/** Enclave is editable inline here because it's the only place to fix it after
 *  deploy — the wizard sets it from the UTC line, and gear registered by hand
 *  arrives with none. Saves on change; there is no form to submit. */
function EnclaveField({
  equipment,
  enclaves,
  capableIds,
}: {
  equipment: Equipment
  enclaves: Enclave[]
  /** What this model of gear is declared capable of. Empty = unrestricted. */
  capableIds: number[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const offered =
    capableIds.length > 0
      ? enclaves.filter((e) => capableIds.includes(e.id))
      : enclaves
  // A value the type no longer declares still has to render — narrowing the
  // catalog doesn't rewrite gear already recorded, so the select must not
  // silently show the wrong thing.
  const current = enclaves.find((e) => e.id === equipment.enclave_id)
  const options =
    current && !offered.some((e) => e.id === current.id)
      ? [...offered, current]
      : offered

  async function set(value: number | null) {
    setPending(true)
    const res = await fetch(`/api/be/equipment/${equipment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enclave_id: value }),
    })
    setPending(false)
    if (res.ok) router.refresh()
  }

  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Enclave
      </dt>
      <dd>
        {enclaves.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <select
            aria-label="Enclave"
            className="h-7 w-full rounded-md border border-input bg-background px-1.5 text-sm"
            value={equipment.enclave_id ?? ""}
            disabled={pending}
            onChange={(e) =>
              set(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">None</option>
            {options.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
                {current?.id === en.id && !offered.some((o) => o.id === en.id)
                  ? " (not declared for this type)"
                  : ""}
              </option>
            ))}
          </select>
        )}
      </dd>
    </div>
  )
}

/** Where this piece of gear physically sits. Editable because a UTC that
 *  shoots to a second location has gear at both ends, and the far end is what
 *  makes that location an extension — see UtcInstance.site_id, which is the
 *  UTC's home rather than the authority on where its kit is. Saves on change,
 *  matching EnclaveField above. */
function SiteField({
  equipment,
  sites,
  utc,
}: {
  equipment: Equipment
  sites: Site[]
  /** The UTC this gear came in on, for the away-from-home note. */
  utc: UtcInstance | null
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const awayFromHome = !!utc && utc.site_id !== equipment.site_id

  async function set(value: number) {
    setPending(true)
    const res = await fetch(`/api/be/equipment/${equipment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site_id: value }),
    })
    setPending(false)
    if (res.ok) router.refresh()
  }

  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Site
      </dt>
      <dd>
        {sites.length === 0 ? (
          <span className="text-muted-foreground">
            {equipment.site_name ?? "—"}
          </span>
        ) : (
          <select
            aria-label="Site"
            className="h-7 w-full rounded-md border border-input bg-background px-1.5 text-sm"
            value={equipment.site_id}
            disabled={pending}
            onChange={(e) => set(Number(e.target.value))}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {awayFromHome && (
          <span className="mt-0.5 block text-[10px] text-sky-600 dark:text-sky-400">
            Away from {utc!.name} ({utc!.site_name})
          </span>
        )}
      </dd>
    </div>
  )
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "font-mono" : undefined}>{value}</dd>
    </div>
  )
}

function ConnectionsSection({
  equipment,
  links,
  allEquipment,
}: {
  equipment: Equipment
  links: EquipmentLink[]
  allEquipment: Equipment[]
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<EquipmentLink | null>(null)
  // See the note on LinkForm — resetting the draft is a remount, not an effect.
  const [openSeq, setOpenSeq] = useState(0)

  function openLink(link: EquipmentLink | null) {
    setEditing(link)
    setOpenSeq((n) => n + 1)
    setOpen(true)
  }

  return (
    <section className="rounded-lg border border-border p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Connections
        </h2>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => openLink(null)}
        >
          <Plus className="size-3.5" />
          Add connection
        </Button>
      </div>
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Not linked to anything yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {links.map((l) => {
            const outbound = l.a_equipment_id === equipment.id
            const other = outbound ? l.b_equipment_code : l.a_equipment_code
            const crossSite =
              l.a_site_id != null &&
              l.b_site_id != null &&
              l.a_site_id !== l.b_site_id
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => openLink(l)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:brightness-110",
                    statusBadgeClass(l.status),
                  )}
                >
                  <span className="flex items-center gap-2">
                    <StatusIndicator state={statusToIndicatorState(l.status)} />
                    <span className="text-muted-foreground">
                      {l.direction === "a_to_b"
                        ? outbound
                          ? "feeds"
                          : "fed by"
                        : "peer"}
                    </span>
                    <span className="font-mono">{other}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {LINK_KIND_LABELS[l.kind]}
                    {crossSite ? " · cross-site" : ""}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <LinkForm
        key={`${editing?.id ?? "new"}-${openSeq}`}
        equipment={allEquipment}
        open={open}
        onOpenChange={setOpen}
        link={editing}
        // New links from this page start with this piece of gear on end A.
        defaultA={equipment.id}
      />
    </section>
  )
}

function CapabilitiesSection({
  equipment,
  services,
  gateways,
}: {
  equipment: Equipment
  services: Service[]
  gateways: Gateway[]
}) {
  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Capabilities
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Each capability carries its own status, so a dead data port doesn&apos;t
        have to mean a dead radio. Setting one here never changes a service or
        gateway — it surfaces the disagreement for an operator instead.
      </p>
      {equipment.capabilities.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No capabilities recorded for this unit.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {equipment.capabilities.map((c) => (
            <CapabilityRow
              key={c.id}
              equipment={equipment}
              capability={c}
              services={services}
              gateways={gateways}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/** Bound-vs-not for a capability's binding chips. Mirrors the deploy wizard's
 *  wiring step, so "what does this back" looks the same wherever it's set. */
function bindingChipClass(on: boolean): string {
  return cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50",
    on
      ? "border-primary/50 bg-primary/10 font-medium text-primary"
      : "border-border text-muted-foreground hover:bg-muted",
  )
}

function CapabilityRow({
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

  const boundServices = services.filter((s) =>
    capability.bindings.service_ids.includes(s.id),
  )
  const boundGateways = gateways.filter((g) =>
    capability.bindings.gateway_ids.includes(g.id),
  )

  async function toggle(kind: "services" | "gateways", id: number, on: boolean) {
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

  /** Flip whether this capability GATES the service, re-PUTting the binding.
   *  Separate from binding at all, because "this is related" and "this must be
   *  up" are different claims and only the second should move a status. */
  async function toggleRequired(serviceId: number, nowRequired: boolean) {
    setPending(true)
    try {
      const group = capability.bindings.group_keys?.[serviceId]
      const params = new URLSearchParams({ required: String(nowRequired) })
      if (group) params.set("group_key", group)
      await fetch(
        `/api/be/capabilities/${capability.id}/services/${serviceId}?${params}`,
        { method: "PUT", headers: { "Content-Type": "application/json" } },
      )
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <li className={cn("rounded-lg border p-3", statusBadgeClass(capability.status))}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{capability.label}</div>
          <div className="text-xs text-muted-foreground">
            {CAPABILITY_LABELS[capability.kind]}
            {capability.source === "custom" ? " · added by hand" : ""}
            {capability.notes ? ` · ${capability.notes}` : ""}
          </div>
        </div>
        <EquipmentStatusPill
          target="capability"
          id={capability.id}
          label={`${equipment.equipment_code} — ${capability.label}`}
          status={capability.status}
          lastValidatedAt={capability.validated_at}
          lastValidatedBy={capability.validated_by_username}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Backs
        </span>
        {/* These were already toggles, but `secondary` against `outline` is
            near-indistinguishable — the row read as a static list of names and
            nobody could tell which were bound, let alone that clicking did
            anything. Same treatment as the deploy wizard's wiring chips:
            checked and tinted when on, plain when off. */}
        {services.map((s) => {
          const on = boundServices.some((b) => b.id === s.id)
          const required =
            capability.bindings.required_service_ids?.includes(s.id) ?? false
          const group = capability.bindings.group_keys?.[s.id]
          return (
            <span key={`s-${s.id}`} className="inline-flex items-center">
              <button
                type="button"
                disabled={pending}
                aria-pressed={on}
                title={on ? `Unbind from ${s.name}` : `Bind to ${s.name}`}
                onClick={() => toggle("services", s.id, on)}
                className={cn(bindingChipClass(on), on && "rounded-r-none")}
              >
                {on && <Check className="size-3" />}
                {s.name}
              </button>
              {/* Only offered once bound — "required" is a property OF a
                  binding, so there is nothing to require until one exists. */}
              {on && (
                <button
                  type="button"
                  disabled={pending}
                  aria-pressed={required}
                  aria-label={`${s.name}: needed for this service`}
                  title={
                    required
                      ? group
                        ? `Needed — redundant with others in "${group}". Click to make optional.`
                        : "Needed for this service. Click to make optional."
                      : "Click to mark this capability as needed for the service"
                  }
                  onClick={() => toggleRequired(s.id, !required)}
                  className={cn(
                    "-ml-px rounded-r-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors",
                    required
                      ? "border-foreground/30 bg-foreground/10 font-medium"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {required ? (group ? `req·${group}` : "req") : "opt"}
                </button>
              )}
            </span>
          )
        })}
        {gateways.map((g) => {
          const on = boundGateways.some((b) => b.id === g.id)
          return (
            <button
              key={`g-${g.id}`}
              type="button"
              disabled={pending}
              aria-pressed={on}
              title={on ? `Unbind from ${g.name}` : `Bind to ${g.name}`}
              onClick={() => toggle("gateways", g.id, on)}
              className={bindingChipClass(on)}
            >
              {on && <Check className="size-3" />}
              {g.name}
            </button>
          )
        })}
        {services.length === 0 && gateways.length === 0 && (
          <span className="text-xs text-muted-foreground">
            No services or gateways at this site yet.
          </span>
        )}
      </div>
    </li>
  )
}
