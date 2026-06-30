"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ViewTabOption<T extends string> {
  value: T
  label: string
  icon?: React.ComponentType<{ className?: string }>
}

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: ViewTabOption<T>[]
  className?: string
}

export function ViewTabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: Props<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1 text-xs",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value
        const Icon = opt.icon
        return (
          <Button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            variant={active ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-7 gap-1.5 px-3 text-xs",
              active ? "shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {opt.label}
          </Button>
        )
      })}
    </div>
  )
}
