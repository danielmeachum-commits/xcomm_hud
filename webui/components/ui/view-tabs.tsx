"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ViewTabOption<T extends string> {
  value: T
  label: string
  icon?: React.ComponentType<{ className?: string }>
}

export type ViewTabsVariant = "pill" | "line"

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: ViewTabOption<T>[]
  variant?: ViewTabsVariant
  className?: string
}

export function ViewTabs<T extends string>({
  value,
  onChange,
  options,
  variant = "pill",
  className,
}: Props<T>) {
  if (variant === "line") {
    return (
      <div
        role="tablist"
        className={cn(
          "inline-flex w-full items-center gap-4 border-b border-border text-sm",
          className,
        )}
      >
        {options.map((opt) => {
          const active = opt.value === value
          const Icon = opt.icon
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.value)}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-1 py-2 transition-colors",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon && <Icon className="size-4" />}
              {opt.label}
            </button>
          )
        })}
      </div>
    )
  }

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
