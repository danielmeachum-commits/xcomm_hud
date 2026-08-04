"use client"

import { useMemo, useState } from "react"
import { ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { Personnel } from "@/lib/types"
import { cn } from "@/lib/utils"

function personLabel(p: Personnel): string {
  return `${p.rank ? `${p.rank} ` : ""}${p.last_name}, ${p.first_name}`
}

interface Props {
  /** Selected person id as a string ("" = none), matching the form drafts. */
  value: string
  onChange: (value: string) => void
  personnel: Personnel[]
  disabled?: boolean
  placeholder?: string
  emptyLabel?: string
  id?: string
}

/**
 * Type-to-filter picker for a person on the roster, valued by id. Unlike
 * `EscortCombobox` (which stores a free-typed name), this only ever yields an
 * id, so it's a drop-in for the `<select>`s that reference other personnel.
 */
export function PersonnelPicker({
  value,
  onChange,
  personnel,
  disabled,
  placeholder = "Search personnel…",
  emptyLabel = "— None —",
  id,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const sorted = useMemo(
    () =>
      [...personnel].sort((a, b) =>
        `${a.last_name} ${a.first_name}`.localeCompare(
          `${b.last_name} ${b.first_name}`,
        ),
      ),
    [personnel],
  )

  const selected = value
    ? sorted.find((p) => p.id.toString() === value)
    : undefined

  function choose(next: string) {
    onChange(next)
    setQuery("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-9 w-full justify-between font-normal",
              !selected && "text-muted-foreground",
            )}
          >
            <span className="truncate">
              {selected ? personLabel(selected) : emptyLabel}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-0">
        <Command>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching personnel.</CommandEmpty>
            <CommandItem value="__none__" onSelect={() => choose("")}>
              {emptyLabel}
            </CommandItem>
            {sorted.map((p) => (
              <CommandItem
                key={p.id}
                // Searchable text — cmdk matches on `value`, so include the
                // name in both orders plus the rank.
                value={`${personLabel(p)} ${p.first_name} ${p.last_name}`}
                data-checked={value === p.id.toString()}
                onSelect={() => choose(p.id.toString())}
              >
                {personLabel(p)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
