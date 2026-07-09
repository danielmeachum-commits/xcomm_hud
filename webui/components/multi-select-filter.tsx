"use client"

import { useMemo, useState } from "react"
import { Filter, Search, X } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface MultiSelectOption {
  value: string
  label: string
  /** Optional group key for grouped rendering. */
  group?: string
}

export interface MultiSelectGroup {
  key: string
  label: string
}

interface BodyProps {
  label: string
  options: MultiSelectOption[]
  /** Ordered group definitions — only used when options carry a `group` key. */
  groups?: MultiSelectGroup[]
  /** Show search input above the list. */
  searchable?: boolean
  selected: Set<string>
  onChange: (next: Set<string>) => void
  /** Popover edge to align the panel to its trigger. */
  align?: "start" | "center" | "end"
}

/** One filterable dimension: its options and the selection state that drives
 *  it. A bank (array of these) feeds a FilterBar and the FilterChips summary. */
export interface FilterBankItem {
  key: string
  label: string
  options: MultiSelectOption[]
  groups?: MultiSelectGroup[]
  searchable?: boolean
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

/** The popover panel — search + (grouped) checklist + clear. Shared by the
 *  toolbar bar button and the compact per-column header funnel. */
function FilterBody({
  label,
  options,
  groups,
  searchable = false,
  selected,
  onChange,
  align = "start",
}: BodyProps) {
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, search])

  const grouped = useMemo(() => {
    if (!groups || groups.length === 0) return null
    const map = new Map<string, MultiSelectOption[]>()
    for (const g of groups) map.set(g.key, [])
    const orphans: MultiSelectOption[] = []
    for (const o of filtered) {
      if (o.group && map.has(o.group)) {
        map.get(o.group)!.push(o)
      } else {
        orphans.push(o)
      }
    }
    return { map, orphans }
  }, [filtered, groups])

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  return (
    <PopoverContent align={align} className="w-64 gap-2 p-2">
      <div className="flex items-center justify-between px-1 pb-1 text-xs">
        <span className="font-medium">{label}</span>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
            Clear
          </button>
        )}
      </div>
      {searchable && (
        <div className="relative px-1">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 pl-7 text-xs"
          />
        </div>
      )}
      <div className="max-h-72 overflow-y-auto">
        {grouped ? (
          <div className="flex flex-col gap-2 py-1">
            {groups!.map((g) => {
              const items = grouped.map.get(g.key) ?? []
              if (items.length === 0) return null
              return (
                <div key={g.key}>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {g.label}
                  </div>
                  <div className="flex flex-col">
                    {items.map((o) => (
                      <OptionRow
                        key={o.value}
                        option={o}
                        checked={selected.has(o.value)}
                        onToggle={() => toggle(o.value)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            {grouped.orphans.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Other
                </div>
                <div className="flex flex-col">
                  {grouped.orphans.map((o) => (
                    <OptionRow
                      key={o.value}
                      option={o}
                      checked={selected.has(o.value)}
                      onToggle={() => toggle(o.value)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col py-1">
            {filtered.map((o) => (
              <OptionRow
                key={o.value}
                option={o}
                checked={selected.has(o.value)}
                onToggle={() => toggle(o.value)}
              />
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                No matches.
              </div>
            )}
          </div>
        )}
      </div>
    </PopoverContent>
  )
}

/** Compact funnel button for a table column header. Muted when idle; solid
 *  with a count badge when the column is filtered. */
export function HeaderFilter({ align = "start", ...body }: BodyProps) {
  const count = body.selected.size
  const active = count > 0
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Filter ${body.label}`}
            className={cn(
              "inline-flex items-center gap-0.5 rounded p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "text-primary"
                : "text-muted-foreground/40 hover:text-foreground",
            )}
          >
            <Filter className={cn("size-3", active && "fill-current")} />
            {active && (
              <span className="text-[9px] font-semibold tabular-nums leading-none">
                {count}
              </span>
            )}
          </button>
        }
      />
      <FilterBody {...body} align={align} />
    </Popover>
  )
}

/** Labeled funnel button for a filter bar (used where there's no column header
 *  to hang a funnel on — the timeline and the personnel list). */
export function FilterButton({
  item,
  align = "start",
}: {
  item: FilterBankItem
  align?: "start" | "center" | "end"
}) {
  const count = item.selected.size
  const active = count > 0
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary/40 bg-primary/5 text-foreground"
                : "border-input bg-background text-muted-foreground hover:bg-accent/50",
            )}
          >
            <Filter
              className={cn(
                "size-3.5",
                active ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span className="font-medium">{item.label}</span>
            {active && (
              <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
                {count}
              </span>
            )}
          </button>
        }
      />
      <FilterBody
        label={item.label}
        options={item.options}
        groups={item.groups}
        searchable={item.searchable}
        selected={item.selected}
        onChange={item.onChange}
        align={align}
      />
    </Popover>
  )
}

/** A row of labeled funnel buttons, one per bank dimension. */
export function FilterBar({
  bank,
  className,
}: {
  bank: FilterBankItem[]
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {bank.map((item) => (
        <FilterButton key={item.key} item={item} />
      ))}
    </div>
  )
}

/** Removable chips summarizing every active selection across a bank, plus a
 *  Clear all. Renders nothing when no filter is set. */
export function FilterChips({
  bank,
  className,
}: {
  bank: FilterBankItem[]
  className?: string
}) {
  const chips = bank.flatMap((f) =>
    Array.from(f.selected).map((value) => ({
      bankKey: f.key,
      group: f.label,
      value,
      label: f.options.find((o) => o.value === value)?.label ?? value,
      remove: () => {
        const next = new Set(f.selected)
        next.delete(value)
        f.onChange(next)
      },
    })),
  )
  if (chips.length === 0) return null
  const clearAll = () => {
    for (const f of bank) if (f.selected.size > 0) f.onChange(new Set())
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((chip) => (
        <button
          key={`${chip.bankKey}:${chip.value}`}
          type="button"
          onClick={chip.remove}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2 pr-1 text-[11px] text-foreground transition-colors hover:bg-muted"
        >
          <span className="text-muted-foreground">{chip.group}:</span>
          <span className="font-medium">{chip.label}</span>
          <X className="size-3 text-muted-foreground" aria-hidden />
        </button>
      ))}
      <button
        type="button"
        onClick={clearAll}
        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Clear all
      </button>
    </div>
  )
}

function OptionRow({
  option,
  checked,
  onToggle,
}: {
  option: MultiSelectOption
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
    >
      <Checkbox
        checked={checked}
        tabIndex={-1}
        className="pointer-events-none"
      />
      <span className="flex-1 truncate">{option.label}</span>
    </button>
  )
}
