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
  value: string
  onChange: (value: string) => void
  /** Roster to pick from — guests are excluded by the caller. */
  personnel: Personnel[]
  disabled?: boolean
}

/**
 * Pick an escort/POC from the roster, storing their display name as text. Also
 * accepts a free-typed name for someone not on the roster.
 */
export function EscortCombobox({ value, onChange, personnel, disabled }: Props) {
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

  const q = query.trim()
  const freeTextIsNew =
    q.length > 0 &&
    !sorted.some((p) => personLabel(p).toLowerCase() === q.toLowerCase())

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
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <span className="truncate">{value || "None"}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput
            placeholder="Search personnel…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching personnel.</CommandEmpty>
            {value && (
              <CommandItem value="__clear escort__" onSelect={() => choose("")}>
                Clear escort
              </CommandItem>
            )}
            {sorted.map((p) => {
              const label = personLabel(p)
              return (
                <CommandItem
                  key={p.id}
                  value={label}
                  data-checked={value === label}
                  onSelect={() => choose(label)}
                >
                  {label}
                </CommandItem>
              )
            })}
            {freeTextIsNew && (
              <CommandItem value={q} onSelect={() => choose(q)}>
                Use “{q}”
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
