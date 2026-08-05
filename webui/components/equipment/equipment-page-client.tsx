"use client"

import { Boxes, List, Network, Search } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"

import { DeployUtcWizard } from "@/components/equipment/deploy-utc-wizard"
import { EquipmentStatusPill } from "@/components/equipment/equipment-status-pill"
import { NetworkCanvas } from "@/components/equipment/network-canvas"
import { EnclaveChip } from "@/components/enclaves/enclaves-client"
import { UtcCompletenessPanel } from "@/components/equipment/utc-completeness-panel"
import { ViewTabs } from "@/components/ui/view-tabs"
import {
  CAPABILITY_LABELS,
  EQUIPMENT_CATEGORY_LABELS,
  equipmentIcon,
  equipmentRollup,
} from "@/lib/equipment-meta"
import { statusBadgeClass } from "@/lib/status"
import { useWorkspace } from "@/lib/workspace"
import { cn } from "@/lib/utils"
import type {
  Enclave,
  Equipment,
  EquipmentType,
  Gateway,
  NetworkTopology,
  PackageDef,
  PackageInstance,
  Service,
  Site,
  UtcDef,
  UtcInstance,
} from "@/lib/types"

type View = "list" | "topology" | "utcs"

interface Props {
  equipment: Equipment[]
  enclaves: Enclave[]
  sites: Site[]
  utcs: UtcInstance[]
  packages: PackageInstance[]
  types: EquipmentType[]
  utcDefs: UtcDef[]
  packageDefs: PackageDef[]
  services: Service[]
  gateways: Gateway[]
  topology: NetworkTopology
}

export function EquipmentPageClient({
  equipment,
  enclaves,
  sites,
  utcs,
  packages,
  types,
  utcDefs,
  packageDefs,
  services,
  gateways,
  topology,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { w } = useWorkspace()

  const view = (searchParams.get("view") as View) || "list"
  const [search, setSearch] = useState("")
  const [siteFilter, setSiteFilter] = useState<number | "all">("all")
  // "none" is a real answer, not an absence: power, cables and the RF shot
  // legitimately serve no single enclave, and finding them is a real task.
  const [enclaveFilter, setEnclaveFilter] = useState<number | "all" | "none">(
    "all",
  )

  function setView(next: View) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("view", next)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  // Aliases live on the catalog type, not on the instance, so searching for
  // "radio" needs this lookup. Without it the box would advertise a term in
  // its own placeholder that finds nothing — while the API's ?search= happily
  // matches it.
  const aliasesByTypeId = useMemo(
    () => new Map(types.map((t) => [t.id, t.aliases.map((a) => a.toLowerCase())])),
    [types],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return equipment.filter((e) => {
      if (siteFilter !== "all" && e.site_id !== siteFilter) return false
      if (enclaveFilter === "none" && e.enclave_id !== null) return false
      if (
        enclaveFilter !== "all" &&
        enclaveFilter !== "none" &&
        e.enclave_id !== enclaveFilter
      )
        return false
      if (!term) return true
      // Match the same things the API's ?search= does, so typing here and
      // typing there behave the same way.
      return (
        e.equipment_code.toLowerCase().includes(term) ||
        (e.serial_number ?? "").toLowerCase().includes(term) ||
        (e.type_title ?? "").toLowerCase().includes(term) ||
        (e.type_short_name ?? "").toLowerCase().includes(term) ||
        (aliasesByTypeId.get(e.equipment_type_id) ?? []).some((a) =>
          a.includes(term),
        )
      )
    })
  }, [equipment, search, siteFilter, enclaveFilter, aliasesByTypeId])

  const bySite = useMemo(() => {
    const map = new Map<number, Equipment[]>()
    for (const e of filtered) {
      const list = map.get(e.site_id) ?? []
      list.push(e)
      map.set(e.site_id, list)
    }
    return map
  }, [filtered])

  const siteById = useMemo(
    () => new Map(sites.map((s) => [s.id, s])),
    [sites],
  )
  const utcById = useMemo(() => new Map(utcs.map((u) => [u.id, u])), [utcs])
  const enclaveById = useMemo(
    () => new Map(enclaves.map((e) => [e.id, e])),
    [enclaves],
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Equipment</h1>
          <p className="text-xs text-muted-foreground">
            Serialized gear, what it provides, and how it connects across sites.
          </p>
        </div>
        <DeployUtcWizard
          sites={sites}
          enclaves={enclaves}
          types={types}
          utcDefs={utcDefs}
          packages={packages}
          packageDefs={packageDefs}
          services={services}
          gateways={gateways}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ViewTabs<View>
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "List", icon: List },
            { value: "utcs", label: "UTCs", icon: Boxes },
            { value: "topology", label: "Topology", icon: Network },
          ]}
        />
        {view === "list" && (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="117G, radio, 7421…"
                className="h-8 w-56 rounded-md border border-input bg-background pl-8 pr-3 text-sm"
              />
            </div>
            <select
              value={siteFilter}
              onChange={(e) =>
                setSiteFilter(
                  e.target.value === "all" ? "all" : Number(e.target.value),
                )
              }
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="all">All sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {enclaves.length > 0 && (
              <select
                aria-label="Filter by enclave"
                value={enclaveFilter}
                onChange={(e) =>
                  setEnclaveFilter(
                    e.target.value === "all" || e.target.value === "none"
                      ? (e.target.value as "all" | "none")
                      : Number(e.target.value),
                  )
                }
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="all">All enclaves</option>
                {enclaves.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.name}
                  </option>
                ))}
                <option value="none">No enclave</option>
              </select>
            )}
          </>
        )}
      </div>

      {view === "topology" ? (
        <NetworkCanvas topology={topology} enclaves={enclaves} />
      ) : view === "utcs" ? (
        utcs.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-12 text-center">
            <Boxes className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No UTCs deployed yet.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {utcs.map((u) => (
              <section
                key={u.id}
                className="rounded-xl border border-border p-4"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Link
                    href={w(`/equipment/utc/${u.id}`)}
                    className="font-medium hover:underline"
                  >
                    {u.name}
                  </Link>
                  {u.utc_def_code && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {u.utc_def_code}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {siteById.get(u.site_id)?.name ?? u.site_name}
                  </span>
                </div>
                <UtcCompletenessPanel utc={u} enclaves={enclaves} />
              </section>
            ))}
          </div>
        )
      ) : equipment.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-12 text-center">
          <Boxes className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No equipment yet — deploy a UTC to register serialized gear.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
          Nothing matches “{search}”.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(bySite.keys())
            .sort((a, b) =>
              (siteById.get(a)?.name ?? "").localeCompare(
                siteById.get(b)?.name ?? "",
              ),
            )
            .map((siteId) => {
              const items = bySite.get(siteId) ?? []
              return (
                <section key={siteId}>
                  <h2 className="mb-2 text-sm font-semibold tracking-tight">
                    <Link
                      href={w(`/sites/${siteId}`)}
                      className="hover:underline"
                    >
                      {siteById.get(siteId)?.name ?? `Site ${siteId}`}
                    </Link>
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {items.length} {items.length === 1 ? "item" : "items"}
                    </span>
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {items.map((e) => {
                      const Icon = equipmentIcon(e.type_category)
                      const rollup = equipmentRollup(e)
                      const utc = e.utc_instance_id
                        ? utcById.get(e.utc_instance_id)
                        : null
                      return (
                        <li
                          key={e.id}
                          className={cn(
                            "flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3",
                            statusBadgeClass(rollup),
                          )}
                        >
                          <Link
                            href={w(`/equipment/${e.id}`)}
                            className="flex min-w-0 flex-1 items-center gap-3 hover:underline"
                          >
                            <Icon className="size-5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-medium">
                                  {e.equipment_code}
                                </span>
                                <span className="truncate text-sm">
                                  {e.type_short_name ?? e.type_title}
                                </span>
                                {e.enclave_id !== null &&
                                  enclaveById.has(e.enclave_id) && (
                                    <EnclaveChip
                                      enclave={enclaveById.get(e.enclave_id)!}
                                    />
                                  )}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {e.type_category
                                  ? EQUIPMENT_CATEGORY_LABELS[e.type_category]
                                  : "—"}
                                {e.serial_number ? ` · SN ${e.serial_number}` : ""}
                                {e.nsn ? ` · NSN ${e.nsn}` : ""}
                                {utc ? ` · ${utc.name}` : ""}
                              </div>
                            </div>
                          </Link>

                          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                            {e.capabilities.map((c) => (
                              <EquipmentStatusPill
                                key={c.id}
                                target="capability"
                                id={c.id}
                                label={`${e.equipment_code} — ${c.label}`}
                                status={c.status}
                                lastValidatedAt={c.validated_at}
                                lastValidatedBy={c.validated_by_username}
                                displayText={CAPABILITY_LABELS[c.kind]}
                                className="gap-1"
                              />
                            ))}
                            {e.capabilities.length === 0 && (
                              <EquipmentStatusPill
                                target="equipment"
                                id={e.id}
                                label={e.equipment_code}
                                status={e.status}
                                lastValidatedAt={e.validated_at}
                                lastValidatedBy={e.validated_by_username}
                              />
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
        </div>
      )}
    </>
  )
}
