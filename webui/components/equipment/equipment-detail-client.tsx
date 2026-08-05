"use client"

import { Wrench } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { EquipmentStatusPill } from "@/components/equipment/equipment-status-pill"
import { Button } from "@/components/ui/button"
import {
  CAPABILITY_LABELS,
  EQUIPMENT_CATEGORY_LABELS,
  LINK_KIND_LABELS,
  equipmentIcon,
} from "@/lib/equipment-meta"
import { statusBadgeClass, statusLabel, statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type {
  Equipment,
  EquipmentCapability,
  EquipmentLink,
  Event,
  Gateway,
  Service,
} from "@/lib/types"

interface Props {
  equipment: Equipment
  services: Service[]
  gateways: Gateway[]
  links: EquipmentLink[]
  events: Event[]
}

export function EquipmentDetailClient({
  equipment,
  services,
  gateways,
  links,
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
          <Field label="Site" value={equipment.site_name ?? "—"} />
          <Field label="UTC" value={equipment.utc_name ?? "Not in a UTC"} />
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

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Connections
        </h2>
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
                <li
                  key={l.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md border p-2 text-sm",
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
                </li>
              )
            })}
          </ul>
        )}
      </section>

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
        {services.map((s) => {
          const on = boundServices.some((b) => b.id === s.id)
          return (
            <Button
              key={`s-${s.id}`}
              type="button"
              size="sm"
              variant={on ? "secondary" : "outline"}
              disabled={pending}
              onClick={() => toggle("services", s.id, on)}
              className="h-6 px-2 text-[11px]"
            >
              {s.name}
            </Button>
          )
        })}
        {gateways.map((g) => {
          const on = boundGateways.some((b) => b.id === g.id)
          return (
            <Button
              key={`g-${g.id}`}
              type="button"
              size="sm"
              variant={on ? "secondary" : "outline"}
              disabled={pending}
              onClick={() => toggle("gateways", g.id, on)}
              className="h-6 px-2 text-[11px]"
            >
              {g.name}
            </Button>
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
