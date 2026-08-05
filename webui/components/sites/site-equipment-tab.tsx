"use client"

import { Boxes, List, Network } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

import { EquipmentStatusPill } from "@/components/equipment/equipment-status-pill"
import { ViewTabs } from "@/components/ui/view-tabs"
import {
  CAPABILITY_LABELS,
  UTC_ROLE_LABELS,
  equipmentIcon,
  equipmentRollup,
} from "@/lib/equipment-meta"
import { statusBadgeClass } from "@/lib/status"
import { useWorkspace } from "@/lib/workspace"
import { cn } from "@/lib/utils"
import type {
  Equipment,
  EquipmentHolding,
  UtcInstance,
} from "@/lib/types"

type SubView = "list" | "utc"

interface Props {
  equipment: Equipment[]
  utcs: UtcInstance[]
  holdings: EquipmentHolding[]
}

export function SiteEquipmentTab({ equipment, utcs, holdings }: Props) {
  const { w } = useWorkspace()
  const [view, setView] = useState<SubView>("utc")

  const byUtc = useMemo(() => {
    const map = new Map<number | "none", Equipment[]>()
    for (const e of equipment) {
      const key = e.utc_instance_id ?? ("none" as const)
      const list = map.get(key) ?? []
      list.push(e)
      map.set(key, list)
    }
    return map
  }, [equipment])

  const holdingsByUtc = useMemo(() => {
    const map = new Map<number, EquipmentHolding[]>()
    for (const h of holdings) {
      const list = map.get(h.utc_instance_id) ?? []
      list.push(h)
      map.set(h.utc_instance_id, list)
    }
    return map
  }, [holdings])

  if (equipment.length === 0 && utcs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center">
        <Boxes className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">No equipment at this site</p>
        <p className="text-xs text-muted-foreground">
          Deploy a UTC from the Equipment page to register gear here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ViewTabs<SubView>
        value={view}
        onChange={setView}
        options={[
          { value: "utc", label: "By UTC", icon: Network },
          { value: "list", label: "All items", icon: List },
        ]}
      />

      {view === "list" ? (
        <ul className="flex flex-col gap-2">
          {equipment.map((e) => (
            <EquipmentRow key={e.id} equipment={e} href={w(`/equipment/${e.id}`)} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          {utcs.map((u) => {
            const items = byUtc.get(u.id) ?? []
            const bulk = holdingsByUtc.get(u.id) ?? []
            // The declared role and what the link graph implies can disagree —
            // that gap is worth showing, not smoothing over.
            const mismatch = u.derived_role && u.derived_role !== u.role
            return (
              <section
                key={u.id}
                className="rounded-lg border border-border p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{u.name}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px]">
                    {UTC_ROLE_LABELS[u.role]}
                  </span>
                  {mismatch && (
                    <span
                      title="The links drawn on the topology imply a different role than the one declared here."
                      className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                    >
                      links say {UTC_ROLE_LABELS[u.derived_role!]}
                    </span>
                  )}
                  {u.utc_def_code && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {u.utc_def_code}
                    </span>
                  )}
                  {u.package_name && (
                    <span className="text-[10px] text-muted-foreground">
                      · {u.package_name}
                    </span>
                  )}
                </div>

                {items.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {items.map((e) => (
                      <EquipmentRow
                        key={e.id}
                        equipment={e}
                        href={w(`/equipment/${e.id}`)}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No serialized items recorded.
                  </p>
                )}

                {bulk.length > 0 && (
                  <div className="mt-2 border-t border-border pt-2">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                      Bulk
                    </div>
                    <ul className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                      {bulk.map((h) => {
                        const short = h.on_hand_qty < h.authorized_qty
                        return (
                          <li
                            key={h.id}
                            className="flex justify-between gap-2"
                          >
                            <span>{h.type_short_name ?? h.type_title}</span>
                            <span
                              className={cn(
                                "font-mono",
                                short
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground",
                              )}
                            >
                              {h.on_hand_qty}/{h.authorized_qty}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </section>
            )
          })}

          {(byUtc.get("none") ?? []).length > 0 && (
            <section className="rounded-lg border border-dashed border-border p-3">
              <div className="mb-2 text-sm font-medium">Not in a UTC</div>
              <ul className="flex flex-col gap-2">
                {(byUtc.get("none") ?? []).map((e) => (
                  <EquipmentRow
                    key={e.id}
                    equipment={e}
                    href={w(`/equipment/${e.id}`)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function EquipmentRow({
  equipment,
  href,
}: {
  equipment: Equipment
  href: string
}) {
  const Icon = equipmentIcon(equipment.type_category)
  const rollup = equipmentRollup(equipment)
  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5",
        statusBadgeClass(rollup),
      )}
    >
      <Link
        href={href}
        className="flex min-w-0 flex-1 items-center gap-2.5 hover:underline"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-sm font-medium">
          {equipment.equipment_code}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {equipment.type_short_name ?? equipment.type_title}
          {equipment.serial_number ? ` · SN ${equipment.serial_number}` : ""}
        </span>
      </Link>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {equipment.capabilities.map((c) => (
          <EquipmentStatusPill
            key={c.id}
            target="capability"
            id={c.id}
            label={`${equipment.equipment_code} — ${c.label}`}
            status={c.status}
            lastValidatedAt={c.validated_at}
            lastValidatedBy={c.validated_by_username}
            displayText={CAPABILITY_LABELS[c.kind]}
          />
        ))}
        {equipment.capabilities.length === 0 && (
          <EquipmentStatusPill
            target="equipment"
            id={equipment.id}
            label={equipment.equipment_code}
            status={equipment.status}
            lastValidatedAt={equipment.validated_at}
            lastValidatedBy={equipment.validated_by_username}
          />
        )}
      </div>
    </li>
  )
}
