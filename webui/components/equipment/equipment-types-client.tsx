"use client"

import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Check,
  ListFilter,
  Search,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { GlobalBadge } from "@/components/equipment/global-badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
  EQUIPMENT_SUBCATEGORY_ICONS,
  EQUIPMENT_SUBCATEGORY_LABELS,
  EQUIPMENT_SUBCATEGORY_VALUES,
  equipmentIcon,
} from "@/lib/equipment-meta"
import type {
  AssetCategory,
  EquipmentSubcategory,
  EquipmentType,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

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

/** Columns you can sort by. Capabilities is deliberately absent: it is a set
 *  per row, and any order imposed on a set is arbitrary enough to mislead. */
type SortKey = "title" | "kind" | "short_name" | "scope"

interface Sort {
  key: SortKey
  dir: "asc" | "desc"
}

/** Rows still group by category, so this orders within a group rather than
 *  across the table — a sort that dissolved the grouping would be answering a
 *  different question than the tabs above asked. Ties fall back to the title
 *  so equal rows hold a stable order instead of shuffling between renders. */
function compareBy(key: SortKey, a: EquipmentType, b: EquipmentType): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title)
    case "kind":
      return (
        EQUIPMENT_SUBCATEGORY_VALUES.indexOf(a.subcategory) -
          EQUIPMENT_SUBCATEGORY_VALUES.indexOf(b.subcategory) ||
        a.title.localeCompare(b.title)
      )
    case "short_name": {
      // Rows without one sink to the bottom in both directions: a column of
      // em-dashes at the top is not what "sort by short name" was asking for.
      if (!a.short_name !== !b.short_name) return a.short_name ? -1 : 1
      return (
        (a.short_name ?? "").localeCompare(b.short_name ?? "") ||
        a.title.localeCompare(b.title)
      )
    }
    case "scope":
      return (
        Number(b.is_global) - Number(a.is_global) ||
        a.title.localeCompare(b.title)
      )
  }
}

/** A column header that sorts. The arrow is always drawn, faint until the
 *  column is the one in force — a control that only appears on hover cannot
 *  be found by someone who never hovers. */
function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
  align = "left",
}: {
  label: string
  sortKey: SortKey
  sort: Sort | null
  onSort: (key: SortKey) => void
  className?: string
  align?: "left" | "right"
}) {
  const active = sort?.key === sortKey
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead
      className={cn("p-0", className)}
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex h-12 w-full items-center gap-1 px-3 font-medium transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          align === "right" ? "justify-end" : "justify-start",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon
          className={cn("size-3.5", active ? "opacity-100" : "opacity-40")}
        />
      </button>
    </TableHead>
  )
}

interface KindOption {
  value: EquipmentSubcategory
  count: number
}

/** The kinds inside a category, as a faceted multiselect.
 *
 *  This was a second row of tabs, which is the right shape for four
 *  categories and the wrong one for ten kinds — a tab row that wraps is a
 *  wall, and tabs can only ask for one at a time anyway. Behind a trigger it
 *  costs one line whatever the catalog grows to, and "radios and antennas"
 *  becomes a question you can ask. */
function KindFilter({
  options,
  selected,
  onChange,
}: {
  options: KindOption[]
  selected: EquipmentSubcategory[]
  onChange: (next: EquipmentSubcategory[]) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="h-9 gap-1.5" />
        }
      >
        <ListFilter className="size-3.5" />
        Kind
        {selected.length > 0 && (
          <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background tabular-nums">
            {selected.length === 1
              ? EQUIPMENT_SUBCATEGORY_LABELS[selected[0]]
              : selected.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        {/* cmdk routes arrow keys and Enter through its input, so the input
            stays even though seven kinds fit on screen without one —
            dropping it left the menu unusable from the keyboard. */}
        <Command>
          <CommandInput placeholder="Filter kinds…" />
          <CommandList>
            <CommandEmpty>No kind matches.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = selected.includes(o.value)
                const Icon = EQUIPMENT_SUBCATEGORY_ICONS[o.value]
                return (
                  <CommandItem
                    key={o.value}
                    value={EQUIPMENT_SUBCATEGORY_LABELS[o.value]}
                    // Toggling leaves the list open: picking two kinds is the
                    // reason this stopped being a tab row.
                    onSelect={() =>
                      onChange(
                        on
                          ? selected.filter((v) => v !== o.value)
                          : [...selected, o.value],
                      )
                    }
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <Icon className="size-3.5 text-muted-foreground" />
                    <span>{EQUIPMENT_SUBCATEGORY_LABELS[o.value]}</span>
                    {/* A kind with nothing in it under the current search
                        stays on offer — dropping it would make the list jump
                        around as you type — but says so. */}
                    <span
                      className={cn(
                        "ml-auto text-xs tabular-nums",
                        o.count === 0
                          ? "text-muted-foreground/50"
                          : "text-muted-foreground",
                      )}
                    >
                      {o.count}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
          {/* Outside `CommandList`, which is the part that scrolls: as a row
              in the list this sat below the fold exactly when it was needed,
              since it only exists once you have picked enough to want it
              gone. */}
          {selected.length > 0 && (
            <div className="border-t border-border p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => onChange([])}
              >
                Clear kinds
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface Props {
  types: EquipmentType[]
  isAdmin: boolean
}

/** The gear catalog — one row per kind of equipment, not per item. A row
 *  opens the type in a sheet, which is where it is edited. */
export function EquipmentTypesClient({ types, isAdmin }: Props) {
  const router = useRouter()
  const { w } = useWorkspace()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<AssetCategory | "all">("all")
  const [kinds, setKinds] = useState<EquipmentSubcategory[]>([])
  const [sort, setSort] = useState<Sort | null>(null)
  const [activeTags, setActiveTags] = useState<string[]>([])

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

  /** What the category tab left standing, before the kind narrows it — the
   *  second row counts against this the way the first counts against
   *  `matches`. */
  const inCategory = useMemo(
    () => matches.filter((t) => category === "all" || t.category === category),
    [matches, category],
  )

  /** The kinds on offer inside the chosen category, listed from every type
   *  rather than from the current matches so the menu doesn't reshuffle while
   *  someone types. Counts do follow the search, so a kind can read 0.
   *  Nothing to offer when the category holds a single kind — Power really
   *  does have just batteries. */
  const kindOptions = useMemo(() => {
    const scope = types.filter(
      (t) => category === "all" || t.category === category,
    )
    const present = EQUIPMENT_SUBCATEGORY_VALUES.filter((sc) =>
      scope.some((t) => t.subcategory === sc),
    )
    if (present.length < 2) return []
    return present.map((sc) => ({
      value: sc,
      count: inCategory.filter((t) => t.subcategory === sc).length,
    }))
  }, [types, category, inCategory])

  /** A kind the current category doesn't have would filter everything away
   *  with no way left to see it was doing so — switching category prunes the
   *  selection, and this is the belt to that pair of braces. */
  const activeKinds = useMemo(
    () => kinds.filter((k) => kindOptions.some((o) => o.value === k)),
    [kinds, kindOptions],
  )

  /** Grouped by what a thing IS at the coarse level — Communications, Power,
   *  Environmental. The finer subcategory is too many headings to group by (a
   *  catalog of eight rows became eight sections); it is the second tab row
   *  and the Kind column instead, and rows sort by it so like still sits with
   *  like inside a category. */
  const grouped = useMemo(() => {
    const kept = inCategory.filter(
      (t) => activeKinds.length === 0 || activeKinds.includes(t.subcategory),
    )
    // No column chosen: kind then title, which keeps like next to like.
    const order = (a: EquipmentType, b: EquipmentType) =>
      sort
        ? (sort.dir === "asc" ? 1 : -1) * compareBy(sort.key, a, b)
        : compareBy("kind", a, b)
    return ASSET_CATEGORY_VALUES.filter(
      (c) => category === "all" || c === category,
    )
      .map(
        (c) =>
          [c, kept.filter((t) => t.category === c).sort(order)] as [
            AssetCategory,
            EquipmentType[],
          ],
      )
      .filter(([, rows]) => rows.length > 0)
  }, [inCategory, category, activeKinds, sort])

  /** Third click clears rather than going back to ascending: the natural
   *  order — kind, then title — is a state worth being able to return to,
   *  and cycling between two directions forever gives you no way back. */
  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key !== key
        ? { key, dir: "asc" }
        : prev.dir === "asc"
          ? { key, dir: "desc" }
          : null,
    )

  const matchCount = grouped.reduce((n, [, rows]) => n + rows.length, 0)

  return (
    <div className="flex flex-col gap-3">
        <ViewTabs<AssetCategory | "all">
          value={category}
          onChange={(next) => {
            setCategory(next)
            // The kinds on offer change with the category, so drop any pick
            // the new one doesn't have rather than filtering to nothing.
            setKinds((prev) =>
              prev.filter((k) =>
                types.some((t) => t.category === next && t.subcategory === k),
              ),
            )
          }}
          variant="line"
          options={tabs}
          label="Category"
        />

        {/* Search and kind on one line: the kind filter narrows what the tabs
            above chose, so it belongs with the other narrowing control rather
            than in a band of its own. */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, short name, alias, NSN…"
              className="pl-8"
              aria-label="Search equipment types"
            />
          </div>
          {kindOptions.length > 0 && (
            <KindFilter
              options={kindOptions}
              selected={activeKinds}
              onChange={setKinds}
            />
          )}
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
                <SortHead
                  label="Name"
                  sortKey="title"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortHead
                  label="Kind"
                  sortKey="kind"
                  sort={sort}
                  onSort={toggleSort}
                  className="w-32"
                />
                <SortHead
                  label="Short name"
                  sortKey="short_name"
                  sort={sort}
                  onSort={toggleSort}
                  className="w-28"
                />
                <TableHead>Capabilities</TableHead>
                <SortHead
                  label="Scope"
                  sortKey="scope"
                  sort={sort}
                  onSort={toggleSort}
                  className="w-24"
                  align="right"
                />
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
                        onClick={() =>
                          router.push(w(`/admin/equipment-types/${t.id}`))
                        }
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
  )
}
