"use client"

import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EVENT_ICON_MAP, EVENT_ICON_NAMES } from "@/lib/event-type-meta"
import { TEAM_COLOR_PRESETS } from "@/lib/personnel-data"
import { cn } from "@/lib/utils"

/** Preset color dropdown — same pattern as the Teams admin color picker. */
export function ColorSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
}) {
  const label = value
    ? TEAM_COLOR_PRESETS.find(
        (c) => c.value.toLowerCase() === value.toLowerCase(),
      )?.label ?? `Custom (${value})`
    : "None"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className="h-9 w-full justify-between font-normal"
            disabled={disabled}
          >
            <span className="flex items-center gap-2">
              <ColorSwatch color={value} />
              {label}
            </span>
            <ChevronDown className="size-4 opacity-50" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onClick={() => onChange(null)}>
          <ColorSwatch color={null} />
          None
        </DropdownMenuItem>
        {TEAM_COLOR_PRESETS.map((c) => (
          <DropdownMenuItem key={c.value} onClick={() => onChange(c.value)}>
            <ColorSwatch color={c.value} />
            {c.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ColorSwatch({ color }: { color: string | null }) {
  return (
    <span
      className="inline-block size-3.5 shrink-0 rounded-full border border-border"
      style={color ? { backgroundColor: color, borderColor: color } : {}}
      aria-hidden
    />
  )
}

/** Click-to-pick icon grid — same pattern as the service catalog admin. */
export function IconGrid({
  value,
  onChange,
  disabled,
}: {
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-9 gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "flex h-9 items-center justify-center rounded-md border text-[10px] uppercase",
          value == null ? "border-foreground bg-accent" : "border-input",
        )}
        title="No icon (neutral dot)"
        disabled={disabled}
      >
        none
      </button>
      {EVENT_ICON_NAMES.map((name) => {
        const IconComp = EVENT_ICON_MAP[name]
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            className={cn(
              "flex h-9 items-center justify-center rounded-md border",
              value === name
                ? "border-foreground bg-accent"
                : "border-input hover:bg-accent/50",
            )}
            title={name}
            disabled={disabled}
          >
            <IconComp className="size-4" />
          </button>
        )
      })}
    </div>
  )
}
