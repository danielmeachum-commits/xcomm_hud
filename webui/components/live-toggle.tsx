"use client"

import { Radio } from "lucide-react"

import { useLive } from "@/components/live-updates-provider"
import { buttonVariants } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function LiveToggle() {
  const { enabled, setEnabled } = useLive()

  return (
    <Popover>
      <PopoverTrigger
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={enabled ? "Live updates on" : "Live updates off"}
      >
        <span className="relative inline-flex">
          <Radio
            className={cn(
              "h-4 w-4",
              enabled ? "text-emerald-500" : "text-muted-foreground",
            )}
          />
          {enabled && (
            <span className="absolute -top-0.5 -right-0.5 inline-flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6}>
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="font-heading text-sm font-medium leading-none">
                Live updates
              </span>
              <span className="text-xs text-muted-foreground">
                {enabled ? "Streaming" : "Paused"}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled(!enabled)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            >
              <span
                className={cn(
                  "inline-block size-4 rounded-full bg-background shadow-sm transition-transform",
                  enabled ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Stream server changes into this browser so you always see current
            data. Turn off to freeze the view — you&apos;ll need to refresh
            manually.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
