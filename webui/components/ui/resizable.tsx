"use client"

import * as React from "react"
import { Group, Panel, Separator } from "react-resizable-panels"

import { cn } from "@/lib/utils"

// Thin wrapper over react-resizable-panels v4 (Group / Panel / Separator).
// Group manages its own flex layout; we only add sizing + handle styling.
function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Group>) {
  return <Group className={cn("h-full w-full", className)} {...props} />
}

const ResizablePanel = Panel

function ResizableHandle({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        "relative w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40 data-[orientation=vertical]:h-1.5 data-[orientation=vertical]:w-full data-[orientation=vertical]:cursor-row-resize",
        className,
      )}
      {...props}
    />
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
