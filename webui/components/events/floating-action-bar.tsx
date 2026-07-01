"use client"

import { Download, EyeOff, X } from "lucide-react"

interface Props {
  count: number
  canHide: boolean
  onExport: () => void
  onHide: () => void
  onClear: () => void
}

export function FloatingActionBar({
  count,
  canHide,
  onExport,
  onHide,
  onClear,
}: Props) {
  return (
    <div className="sticky top-2 z-20 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 shadow-sm backdrop-blur">
      <div className="text-sm font-medium">
        {count} selected
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent"
        >
          <Download className="size-3.5" />
          Export CSV
        </button>
        {canHide && (
          <button
            type="button"
            onClick={onHide}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/40 bg-background px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <EyeOff className="size-3.5" />
            Hide
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Clear selection"
        >
          <X className="size-3.5" />
          Clear
        </button>
      </div>
    </div>
  )
}
