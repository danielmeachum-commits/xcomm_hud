"use client"

import { Boxes, List, Network, Search, Trash2 } from "lucide-react"
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
  // Which UTC a piece of gear came in on is the question asked right after a
  // deploy — "did that land, and where is it?" — and the flat list had no way
  // to answer it. "none" is again a real answer: gear detached from its UTC.
  const [utcFilter, setUtcFilter] = useState<number | "all" | "none">("all")

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
      if (utcFilter === "none" && e.utc_instance_id !== null) return false
      if (
        utcFilter !== "all" &&
        utcFilter !== "none" &&
        e.utc_instance_id !== utcFilter
      )
        return false
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
  }, [equipment, search, siteFilter, utcFilter, enclaveFilter, aliasesByTypeId])


  const siteById = useMemo(
    () => new Map(sites.map((s) => [s.id, s])),
    [sites],
  )
  const utcById = useMemo(() => new Map(utcs.map((u) => [u.id, u])), [utcs])

  /** UTCs under the package they deployed with, packages in name order and the
   *  standalone ones last. A package is the unit an operator thinks in — it's
   *  what they deployed and what they tear down — but nothing in this view used
   *  to show it. */
  const utcGroups = useMemo(() => {
    const byPackage = new Map<number | null, UtcInstance[]>()
    // Seeded with every package, including ones whose last UTC was deleted:
    // an empty package is still a real row, and if it isn't shown there is no
    // way left to reach it — the teardown that emptied it strands it.
    for (const p of packages) byPackage.set(p.id, [])
    for (const u of utcs) {
      const k = u.package_instance_id ?? null
      const bucket = byPackage.get(k)
      if (bucket) bucket.push(u)
      else byPackage.set(k, [u])
    }
    // Within a package, the primary leads and its extensions follow — the order
    // the deployment is described in, not the order the rows were inserted.
    const rank: Record<UtcInstance["role"], number> = {
      primary: 0,
      extension: 1,
      independent: 2,
    }
    return [...byPackage.entries()]
      .map(([k, grouped]) => ({
        key: String(k ?? "none"),
        package: k === null ? null : (packages.find((p) => p.id === k) ?? null),
        utcs: [...grouped].sort(
          (a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name),
        ),
      }))
      .sort((a, b) => {
        if (!a.package !== !b.package) return a.package ? -1 : 1
        return (a.package?.name ?? "").localeCompare(b.package?.name ?? "")
      })
  }, [utcs, packages])
  const enclaveById = useMemo(
    () => new Map(enclaves.map((e) => [e.id, e])),
    [enclaves],
  )

  /** The list, nested site → UTC → enclave.
   *
   *  Flat-under-site meant a site's gear was one undifferentiated run of rows
   *  with the UTC and enclave repeated as chips on every line — the two things
   *  you actually navigate by were the hardest to see. Nesting turns them into
   *  headings, so "what did FCP-1 bring, and which of it is SIPR" is reading
   *  rather than scanning.
   *
   *  Gear with no UTC and gear with no enclave are real answers, not gaps, so
   *  each level keeps a bucket for them — sorted last, since they're the
   *  exception. */
  const tree = useMemo(() => {
    const bySite = new Map<
      number,
      Map<number | null, Map<number | null, Equipment[]>>
    >()
    for (const e of filtered) {
      let byUtc = bySite.get(e.site_id)
      if (!byUtc) {
        byUtc = new Map()
        bySite.set(e.site_id, byUtc)
      }
      const utcKey = e.utc_instance_id ?? null
      let byEnclave = byUtc.get(utcKey)
      if (!byEnclave) {
        byEnclave = new Map()
        byUtc.set(utcKey, byEnclave)
      }
      const enclaveKey = e.enclave_id ?? null
      const items = byEnclave.get(enclaveKey)
      if (items) items.push(e)
      else byEnclave.set(enclaveKey, [e])
    }
    // Catalog order for enclaves, untagged last.
    const enclaveRank = new Map(enclaves.map((e, i) => [e.id, i]))
    const rankOf = (id: number | null) =>
      id === null ? Number.MAX_SAFE_INTEGER : (enclaveRank.get(id) ?? 1e6)

    return [...bySite.entries()]
      .map(([siteId, byUtc]) => {
        const utcGroups = [...byUtc.entries()]
          .map(([utcId, byEnclave]) => {
            const enclaveGroups = [...byEnclave.entries()]
              .map(([enclaveId, items]) => ({
                key: String(enclaveId ?? "none"),
                enclave: enclaveId === null ? null : enclaveById.get(enclaveId),
                items,
              }))
              .sort((a, b) => rankOf(a.enclave?.id ?? null) - rankOf(b.enclave?.id ?? null))
            return {
              key: String(utcId ?? "none"),
              utc: utcId === null ? null : utcById.get(utcId),
              enclaveGroups,
              count: enclaveGroups.reduce((n, g) => n + g.items.length, 0),
            }
          })
          .sort((a, b) => {
            if (!a.utc !== !b.utc) return a.utc ? -1 : 1
            return (
              (a.utc?.package_name ?? "").localeCompare(
                b.utc?.package_name ?? "",
              ) || (a.utc?.name ?? "").localeCompare(b.utc?.name ?? "")
            )
          })
        return {
          siteId,
          site: siteById.get(siteId),
          utcGroups,
          count: utcGroups.reduce((n, g) => n + g.count, 0),
        }
      })
      .sort((a, b) =>
        (a.site?.name ?? "").localeCompare(b.site?.name ?? ""),
      )
  }, [filtered, enclaves, enclaveById, siteById, utcById])

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
          existingCodes={equipment.map((e) => e.equipment_code)}
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
            {utcs.length > 0 && (
              <select
                aria-label="Filter by UTC"
                value={utcFilter}
                onChange={(e) =>
                  setUtcFilter(
                    e.target.value === "all" || e.target.value === "none"
                      ? (e.target.value as "all" | "none")
                      : Number(e.target.value),
                  )
                }
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="all">All UTCs</option>
                {/* Grouped by package, so "everything that went out with FCP-1"
                    is one glance rather than a name-matching exercise. */}
                {utcGroups.map((g) => (
                  <optgroup
                    key={g.key}
                    label={g.package?.name ?? "No package"}
                  >
                    {g.utcs.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value="none">No UTC</option>
              </select>
            )}
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
        utcs.length === 0 && packages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-12 text-center">
            <Boxes className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No UTCs deployed yet.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {utcGroups.map((g) => (
              <div key={g.key} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-tight">
                    {g.package?.name ?? "Standalone"}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {g.utcs.length === 0
                      ? "empty"
                      : `${g.utcs.length} UTC${g.utcs.length === 1 ? "" : "s"}`}
                  </span>
                  {g.package && (
                    <PackageTeardown
                      packageInstance={g.package}
                      utcs={g.utcs}
                      equipment={equipment}
                    />
                  )}
                </div>
                {g.utcs.map((u) => (
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
                      <span className="text-xs text-muted-foreground">
                        ·{" "}
                        {
                          equipment.filter((e) => e.utc_instance_id === u.id)
                            .length
                        }{" "}
                        serialized
                      </span>
                    </div>
                    <UtcCompletenessPanel utc={u} enclaves={enclaves} />
                  </section>
                ))}
              </div>
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
        <div className="flex flex-col gap-8">
          {tree.map((siteGroup) => (
            <section key={siteGroup.siteId}>
              <h2 className="mb-2 text-sm font-semibold tracking-tight">
                <Link
                  href={w(`/sites/${siteGroup.siteId}`)}
                  className="hover:underline"
                >
                  {siteGroup.site?.name ?? `Site ${siteGroup.siteId}`}
                </Link>
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {siteGroup.count} {siteGroup.count === 1 ? "item" : "items"}
                </span>
              </h2>

              <div className="flex flex-col gap-4">
                {siteGroup.utcGroups.map((utcGroup) => (
                  <div key={utcGroup.key} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2 border-l-2 border-border pl-2">
                      {utcGroup.utc ? (
                        <>
                          <Link
                            href={w(`/equipment/utc/${utcGroup.utc.id}`)}
                            className="text-sm font-medium hover:underline"
                          >
                            {utcGroup.utc.name}
                          </Link>
                          {utcGroup.utc.utc_def_code && (
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                              {utcGroup.utc.utc_def_code}
                            </span>
                          )}
                          {utcGroup.utc.package_name && (
                            <span className="text-xs text-muted-foreground">
                              {utcGroup.utc.package_name}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Not on a UTC
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        · {utcGroup.count}
                      </span>
                    </div>

                    {utcGroup.enclaveGroups.map((enclaveGroup) => (
                      <div
                        key={enclaveGroup.key}
                        className="flex flex-col gap-2 pl-4"
                      >
                        <div className="flex items-center gap-2">
                          {enclaveGroup.enclave ? (
                            <EnclaveChip enclave={enclaveGroup.enclave} />
                          ) : (
                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              No enclave
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            · {enclaveGroup.items.length}
                          </span>
                        </div>
                        <ul className="flex flex-col gap-2">
                          {enclaveGroup.items.map((e) => {
                            const Icon = equipmentIcon(e.type_category)
                            const rollup = equipmentRollup(e)
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
                                    </div>
                                    {/* The UTC and enclave chips this row used
                                        to carry are the two headings above it
                                        now, so what is left is what the
                                        headings do not already say. */}
                                    <div className="truncate text-xs text-muted-foreground">
                                      {e.type_category
                                        ? EQUIPMENT_CATEGORY_LABELS[
                                            e.type_category
                                          ]
                                        : "—"}
                                      {e.serial_number
                                        ? ` · SN ${e.serial_number}`
                                        : ""}
                                      {e.nsn ? ` · NSN ${e.nsn}` : ""}
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
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

/** Tear a deployed package down to nothing.
 *
 *  A package deploy that half-succeeded leaves gear registered under UTCs that
 *  were never finished, and unpicking it one PATCH at a time through the flat
 *  equipment list is what "I can't start over" actually means. This does the
 *  whole thing in the order the foreign keys demand — equipment, then UTCs,
 *  then the package — because `DELETE /packages/{id}` alone only nulls the
 *  UTCs' package_instance_id and leaves the deployment standing.
 *
 *  It stops at the first failure and says how far it got, rather than
 *  reporting success over a partial teardown. */
function PackageTeardown({
  packageInstance,
  utcs,
  equipment,
}: {
  packageInstance: PackageInstance
  utcs: UtcInstance[]
  equipment: Equipment[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const utcIds = new Set(utcs.map((u) => u.id))
  const gear = equipment.filter(
    (e) => e.utc_instance_id !== null && utcIds.has(e.utc_instance_id),
  )

  async function del(url: string, what: string) {
    const res = await fetch(url, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const detail = body?.detail
      throw new Error(
        `${what}: ${typeof detail === "string" ? detail : `failed (${res.status})`}`,
      )
    }
  }

  async function run() {
    const contents =
      utcs.length === 0
        ? "It has nothing deployed under it."
        : `This permanently deletes ${utcs.length} UTC${utcs.length === 1 ? "" : "s"} ` +
          `and ${gear.length} serialized item${gear.length === 1 ? "" : "s"}, ` +
          `along with their bulk holdings and capability bindings.\n\n` +
          `This cannot be undone.`
    if (!confirm(`Delete package “${packageInstance.name}”?\n\n${contents}`))
      return
    setPending(true)
    setError(null)
    try {
      for (const e of gear) {
        await del(`/api/be/equipment/${e.id}`, e.equipment_code)
      }
      for (const u of utcs) {
        await del(`/api/be/utcs/${u.id}`, u.name)
      }
      await del(`/api/be/packages/${packageInstance.id}`, packageInstance.name)
      router.refresh()
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "Teardown failed"} — some of it may already be deleted.`,
      )
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="inline-flex items-center gap-1 rounded-full border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
      >
        <Trash2 className="size-3" />
        {pending ? "Deleting…" : "Delete package"}
      </button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </>
  )
}
