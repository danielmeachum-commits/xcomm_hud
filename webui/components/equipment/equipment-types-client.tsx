"use client"

import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { EquipmentTypeSheet } from "@/components/equipment/catalog-detail-sheets"
import { GlobalBadge } from "@/components/equipment/global-badge"
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
  ASSET_CATEGORY_ICONS,
  ASSET_CATEGORY_LABELS,
  ASSET_CATEGORY_VALUES,
  CAPABILITY_LABELS,
  EQUIPMENT_SUBCATEGORY_LABELS,
  EQUIPMENT_SUBCATEGORY_VALUES,
  equipmentIcon,
} from "@/lib/equipment-meta"
import type {
  AssetCategory,
  Enclave,
  EquipmentType,
  WorkCenter,
} from "@/lib/types"
import { cn } from "@/lib/utils"

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

interface Props {
  types: EquipmentType[]
  enclaves: Enclave[]
  workCenters: WorkCenter[]
  isAdmin: boolean
}

/** The gear catalog — one row per kind of equipment, not per item. A row
 *  opens the type in a sheet, which is where it is edited. */
export function EquipmentTypesClient({
  types,
  enclaves,
  workCenters,
  isAdmin,
}: Props) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<AssetCategory | "all">("all")
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<EquipmentType | null>(null)

  const haystacks = useMemo(
    () => new Map(types.map((t) => [t.id, searchHaystack(t)])),
    [types],
  )

  /** Every tag in use, so the filter bar only ever offers real ones. */
  const allTags = useMemo(
    () => [...new Set(types.flatMap((t) => t.tags))].sort(),
    [types],
  )

  /** Search and tags applied, but not the category — the tabs count against
   *  this, so each tab says how many rows it would show rather than how many
   *  exist. */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return types.filter((t) => {
      // Multiple tags narrow rather than widen — "cci AND hand-receipt".
      if (activeTags.some((tag) => !t.tags.includes(tag))) return false
      if (!q) return true
      return (haystacks.get(t.id) ?? "").includes(q)
    })
  }, [types, query, activeTags, haystacks])

  /** One tab per category the catalog actually has, drawn from every type
   *  rather than from the current matches so the tab row doesn't reshuffle
   *  under the cursor while someone is typing. */
  const tabs = useMemo(() => {
    const present = ASSET_CATEGORY_VALUES.filter((c) =>
      types.some((t) => t.category === c),
    )
    return [
      { value: "all" as const, label: `All (${matches.length})` },
      ...present.map((c) => ({
        value: c,
        label: `${ASSET_CATEGORY_LABELS[c]} (${matches.filter((t) => t.category === c).length})`,
        icon: ASSET_CATEGORY_ICONS[c],
      })),
    ]
  }, [types, matches])

  /** Grouped by what a thing IS at the coarse level — Communications, Power,
   *  Environmental. The finer subcategory is too many headings to group by (a
   *  catalog of eight rows became eight sections); it survives as the Kind
   *  column, and rows sort by it so like still sits with like inside a
   *  category. */
  const grouped = useMemo(() => {
    const subOrder = (t: EquipmentType) =>
      EQUIPMENT_SUBCATEGORY_VALUES.indexOf(t.subcategory)
    return ASSET_CATEGORY_VALUES.filter(
      (c) => category === "all" || c === category,
    )
      .map(
        (c) =>
          [
            c,
            matches
              .filter((t) => t.category === c)
              .sort(
                (a, b) =>
                  subOrder(a) - subOrder(b) || a.title.localeCompare(b.title),
              ),
          ] as [AssetCategory, EquipmentType[]],
      )
      .filter(([, rows]) => rows.length > 0)
  }, [matches, category])

  const matchCount = grouped.reduce((n, [, rows]) => n + rows.length, 0)

  return (
    <>
      <div className="flex flex-col gap-3">
        <ViewTabs<AssetCategory | "all">
          value={category}
          onChange={setCategory}
          variant="line"
          options={tabs}
        />

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, short name, alias, NSN…"
            className="pl-8"
            aria-label="Search equipment types"
          />
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

        {!isAdmin && (
          <p className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            Global catalog rows are read-only for your role. You can still add
            workspace-local entries.
          </p>
        )}

        {matchCount === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {types.length === 0
              ? "No equipment types yet."
              : "No equipment types match."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-32">Kind</TableHead>
                <TableHead className="w-28">Short name</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead className="w-24 text-right">Scope</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.map(([cat, rows]) => {
                const Icon = ASSET_CATEGORY_ICONS[cat]
                return [
                  // A heading over the only group there is repeats the tab
                  // that put it there, so it only prints under All.
                  category === "all" ? (
                    <TableRow
                      key={`group-${cat}`}
                      className="bg-muted/40 hover:bg-muted/40"
                    >
                      <TableCell
                        colSpan={5}
                        className="py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className="size-3.5" />
                          {ASSET_CATEGORY_LABELS[cat]}
                          <span className="font-normal">({rows.length})</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : null,
                  ...rows.map((t) => {
                    const SubIcon = equipmentIcon(t.subcategory)
                    return (
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
                        <TableCell className="text-xs text-muted-foreground">
                          {/* The subcategory the page used to group by. Its
                              glyph is the one that can actually be drawn —
                              `AssetCategory` is too coarse, so every comm box
                              would share a symbol. */}
                          <span className="inline-flex items-center gap-1.5">
                            <SubIcon className="size-3.5 shrink-0" />
                            {EQUIPMENT_SUBCATEGORY_LABELS[t.subcategory]}
                          </span>
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
                    )
                  }),
                ]
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <EquipmentTypeSheet
        enclaves={enclaves}
        workCenters={workCenters}
        type={selectedType}
        canEdit={!!selectedType && (isAdmin || !selectedType.is_global)}
        tagSuggestions={allTags}
        onClose={() => setSelectedType(null)}
      />
    </>
  )
}
