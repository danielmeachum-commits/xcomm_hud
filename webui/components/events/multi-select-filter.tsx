"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Search, X } from "lucide-react"

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

interface Props {
  label: string
  options: MultiSelectOption[]
  /** Ordered group definitions — only used when options carry a `group` key. */
  groups?: MultiSelectGroup[]
  /** Show search input above the list. */
  searchable?: boolean
  selected: Set<string>
  onChange: (next: Set<string>) => void
  /** How to summarize the trigger label when values are selected. */
  triggerSummary?: (selectedLabels: string[]) => string
}

function defaultSummary(labels: string[]): string {
  if (labels.length === 0) return ""
  if (labels.length === 1) return labels[0]
  return `${labels.length} selected`
}

export function MultiSelectFilter({
  label,
  options,
  groups,
  searchable = false,
  selected,
  onChange,
  triggerSummary = defaultSummary,
}: Props) {
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

  const selectedLabels = useMemo(() => {
    const labels: string[] = []
    for (const o of options) if (selected.has(o.value)) labels.push(o.label)
    return labels
  }, [options, selected])

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  function clear() {
    onChange(new Set())
  }

  const summary = triggerSummary(selectedLabels)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm",
              "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <span className="flex-1 truncate">
              <span className="text-muted-foreground">{label}</span>
              {summary && (
                <span className="ml-2 font-medium text-foreground">
                  {summary}
                </span>
              )}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-64 gap-2 p-2">
        <div className="flex items-center justify-between px-1 pb-1 text-xs">
          <span className="font-medium">{label}</span>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={clear}
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
    </Popover>
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

