import React from "react"

import { cn } from "@/lib/utils"
import {
  emconClasses,
  emconLabel,
  fpconClasses,
  fpconLabel,
} from "@/lib/threat-level"
import type { Emcon, Fpcon } from "@/lib/types"

interface TransportBadgeProps {
  fpcon?: Fpcon
  emcon?: Emcon
  size?: "sm" | "md"
  className?: string
}

/** Pill-style badge for FPCON and/or EMCON levels. Renders either or both
 * stacked horizontally — color follows the standard threat-level palette. */
const TransportBadge: React.FC<TransportBadgeProps> = ({
  fpcon,
  emcon,
  size = "md",
  className,
}) => {
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      {fpcon && (
        <span
          className={cn(
            "rounded-md font-bold uppercase tracking-wider ring-1 ring-inset",
            padding,
            fpconClasses(fpcon).bg,
            fpconClasses(fpcon).text,
            fpconClasses(fpcon).ring,
          )}
        >
          FPCON {fpconLabel(fpcon)}
        </span>
      )}
      {emcon && (
        <span
          className={cn(
            "rounded-md font-semibold uppercase tracking-wider",
            padding,
            emconClasses(emcon).bg,
            emconClasses(emcon).text,
          )}
        >
          {emconLabel(emcon)}
        </span>
      )}
    </div>
  )
}

export default TransportBadge
