"use client"

import { Boxes, Globe, Package, Radio, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { CatalogCreateDialog } from "@/components/equipment/catalog-create-dialog"
import {
  CATEGORY_VALUES,
  CodeBadge,
  EquipmentTypeSheet,
  PackageDefSheet,
  UtcDefSheet,
  aggregateCapabilities,
} from "@/components/equipment/catalog-detail-sheets"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ViewTabs } from "@/components/ui/view-tabs"
import {
  CAPABILITY_LABELS,
  EQUIPMENT_CATEGORY_LABELS,
  equipmentIcon,
} from "@/lib/equipment-meta"
import type {
  Enclave,
  EquipmentCategory,
  EquipmentType,
  PackageDef,
  UtcDef,
} from "@/lib/types"
import { cn } from "@/lib/utils"

type Tab = "types" | "utcs" | "packages"

interface Props {
  types: EquipmentType[]
  utcDefs: UtcDef[]
  packageDefs: PackageDef[]
  enclaves?: Enclave[]
  isAdmin: boolean
}

/** Marks a row as belonging to the shared, admin-managed catalog rather than
 *  to this workspace. Only admins can edit those. */
function GlobalBadge() {
  return (
    <span
      title="Global catalog — shared across workspaces, admin-managed"
      className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
    >
      <Globe className="size-3" />
      Global
    </span>
  )
}

/** Everything a person might type looking for a piece of gear. Lowercased
 *  once per row so the filter stays case-insensitive without re-allocating
 *  on every keystroke. */
function searchHaystack(t: EquipmentType): string {
  return [
    t.title,
    t.short_name,
    t.nsn,
    t.lin,
    t.manufacturer,
    t.model,
    ...t.aliases,
    ...t.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function EquipmentCatalogClient({
  types,
  utcDefs,
  packageDefs,
  enclaves = [],
  isAdmin,
}: Props) {
  const [tab, setTab] = useState<Tab>("types")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<EquipmentCategory | "all">("all")
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<EquipmentType | null>(null)
  const [selectedUtc, setSelectedUtc] = useState<UtcDef | null>(null)
  const [selectedPackage, setSelectedPackage] = useState<PackageDef | null>(
    null,
  )

  const typesById = useMemo(
    () => new Map(types.map((t) => [t.id, t])),
    [types],
  )

  const haystacks = useMemo(
    () => new Map(types.map((t) => [t.id, searchHaystack(t)])),
    [types],
  )

  /** Categories that actually have gear, so the filter never offers a dead
   *  option. */
  const presentCategories = useMemo(
    () => CATEGORY_VALUES.filter((c) => types.some((t) => t.category === c)),
    [types],
  )

  /** Every tag in use, so the filter bar only ever offers real ones. */
  const allTags = useMemo(
    () => [...new Set(types.flatMap((t) => t.tags))].sort(),
    [types],
  )

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = types.filter((t) => {
      if (category !== "all" && t.category !== category) return false
      // Multiple tags narrow rather than widen — "cci AND hand-receipt".
      if (activeTags.some((tag) => !t.tags.includes(tag))) return false
      if (!q) return true
      return (haystacks.get(t.id) ?? "").includes(q)
    })
    return CATEGORY_VALUES.map(
      (c) =>
        [c, matches.filter((t) => t.category === c)] as [
          EquipmentCategory,
          EquipmentType[],
        ],
    ).filter(([, rows]) => rows.length > 0)
  }, [types, query, category, activeTags, haystacks])

  const matchCount = grouped.reduce((n, [, rows]) => n + rows.length, 0)

  const canEditRow = (isGlobal: boolean) => isAdmin || !isGlobal

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewTabs<Tab>
          value={tab}
          onChange={setTab}
          variant="line"
          options={[
            { value: "types", label: "Equipment types", icon: Radio },
            { value: "utcs", label: "UTC definitions", icon: Boxes },
            { value: "packages", label: "Packages", icon: Package },
          ]}
        />
        {/* Creates whatever the active tab lists, so there's one button
            rather than three competing for the header. */}
        <CatalogCreateDialog
          kind={tab}
          types={types}
          utcDefs={utcDefs}
          isAdmin={isAdmin}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {tab === "types" &&
          "The gear catalog — one row per kind of equipment, not per item."}
        {tab === "utcs" &&
          "A UTC bundles equipment types into a deployable unit. Serialized gear is tracked from here down."}
        {tab === "packages" &&
          "A package composes UTCs into a full deployment (for example a primary plus an extension)."}
      </p>

      {!isAdmin && (
        <p className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
          Global catalog rows are read-only for your role. You can still add
          workspace-local entries.
        </p>
      )}

      {tab === "types" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, short name, alias, NSN…"
                className="pl-8"
                aria-label="Search equipment types"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setCategory("all")}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  category === "all"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                All
              </button>
              {presentCategories.map((c) => {
                const Icon = equipmentIcon(c)
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c === category ? "all" : c)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                      category === c
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="size-3" />
                    {EQUIPMENT_CATEGORY_LABELS[c]}
                  </button>
                )
              })}
            </div>
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Tags
              </span>
              {allTags.map((tag) => {
                const on = activeTags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setActiveTags(
                        on
                          ? activeTags.filter((t) => t !== tag)
                          : [...activeTags, tag],
                      )
                    }
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs transition-colors",
                      on
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tag}
                  </button>
                )
              })}
              {activeTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTags([])}
                  className="ml-1 text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {matchCount === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No equipment types match.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-28">Short name</TableHead>
                  <TableHead>Capabilities</TableHead>
                  <TableHead className="w-24 text-right">Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.map(([cat, rows]) => {
                  const Icon = equipmentIcon(cat)
                  return [
                    <TableRow
                      key={`group-${cat}`}
                      className="bg-muted/40 hover:bg-muted/40"
                    >
                      <TableCell
                        colSpan={4}
                        className="py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className="size-3.5" />
                          {EQUIPMENT_CATEGORY_LABELS[cat]}
                          <span className="font-normal">({rows.length})</span>
                        </span>
                      </TableCell>
                    </TableRow>,
                    ...rows.map((t) => (
                      <TableRow
                        key={t.id}
                        onClick={() => setSelectedType(t)}
                        className="cursor-pointer"
                      >
                        <TableCell className="font-medium">
                          {t.title}
                          {t.tags.length > 0 && (
                            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                              {t.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
                                >
                                  {tag}
                                </span>
                              ))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {t.short_name ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                              {t.short_name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.capabilities.length > 0
                            ? t.capabilities
                                .map((c) => CAPABILITY_LABELS[c.kind])
                                .join(" · ")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {t.is_global ? (
                            <GlobalBadge />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Workspace
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )),
                  ]
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {tab === "utcs" && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-24 text-right">Line items</TableHead>
              <TableHead>Capabilities</TableHead>
              <TableHead className="w-24 text-right">Scope</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {utcDefs.map((d) => (
              <TableRow
                key={d.id}
                onClick={() => setSelectedUtc(d)}
                className="cursor-pointer"
              >
                <TableCell>
                  <CodeBadge code={d.code} />
                </TableCell>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {d.lines.length}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {aggregateCapabilities(d.lines, typesById)
                    .map((k) => CAPABILITY_LABELS[k])
                    .join(" · ") || "—"}
                </TableCell>
                <TableCell className="text-right">
                  {d.is_global ? (
                    <GlobalBadge />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Workspace
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {tab === "packages" && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Unit type codes</TableHead>
              <TableHead className="w-24 text-right">Scope</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packageDefs.map((p) => (
              <TableRow
                key={p.id}
                onClick={() => setSelectedPackage(p)}
                className="cursor-pointer"
              >
                <TableCell>
                  <CodeBadge code={p.code} />
                </TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {p.utcs.map((u) => (
                      <CodeBadge key={u.id} code={u.utc_def_code ?? "—"} />
                    ))}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {p.is_global ? (
                    <GlobalBadge />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Workspace
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <EquipmentTypeSheet
        type={selectedType}
        canEdit={!!selectedType && canEditRow(selectedType.is_global)}
        tagSuggestions={allTags}
        onClose={() => setSelectedType(null)}
      />
      <UtcDefSheet
        enclaves={enclaves}
        def={selectedUtc}
        types={types}
        canEdit={!!selectedUtc && canEditRow(selectedUtc.is_global)}
        onClose={() => setSelectedUtc(null)}
      />
      <PackageDefSheet
        def={selectedPackage}
        utcDefs={utcDefs}
        types={types}
        canEdit={!!selectedPackage && canEditRow(selectedPackage.is_global)}
        onClose={() => setSelectedPackage(null)}
      />
    </>
  )
}
