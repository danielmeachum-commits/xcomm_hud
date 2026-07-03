"use client"

import { useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { ValidationDialog } from "@/components/validation-dialog"
import { statusLabel, statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type { StatusValue } from "@/lib/types"

interface Props {
  serviceId: number
  serviceName: string
  gatewayId: number
  gatewayName: string
  /** Stored cell status — operator's last validation of this pair. */
  status: StatusValue
  /** Displayed cell status — R10/R11 applied. Shown if it diverges from
   *  the stored value so the operator can see the cascade in effect. */
  effectiveStatus?: StatusValue
  lastValidatedAt?: string | null
  lastValidatedBy?: string | null
  allowedStatuses?: StatusValue[] | null
  className?: string
  /** Size of the inline StatusIndicator dot. */
  indicatorSize?: "sm" | "md" | "lg" | "xl"
}

/** Matrix cell pill for a single (service × gateway) intersection. Same
 *  shape as ServiceStatusPill but its click routes to the cell validation
 *  endpoint via ValidationDialog kind="service_gateway". */
export function MatrixCellPill({
  serviceId,
  serviceName,
  gatewayId,
  gatewayName,
  status,
  effectiveStatus,
  lastValidatedAt = null,
  lastValidatedBy = null,
  allowedStatuses = null,
  className,
  indicatorSize = "sm",
}: Props) {
  const [open, setOpen] = useState(false)
  const shown = effectiveStatus ?? status
  const cascaded = effectiveStatus !== undefined && effectiveStatus !== status

  return (
    <>
      <button
        onPointerDownCapture={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(true)
        }}
        title={
          cascaded
            ? `Stored: ${statusLabel(status)} — overridden by R10/R11 cascade`
            : `Tap to validate ${serviceName} via ${gatewayName}`
        }
        className={cn(
          "nodrag nowheel inline-flex items-center gap-2 rounded-full border bg-background/60 px-2 py-1 text-xs uppercase tracking-wider transition-colors hover:bg-accent",
          cascaded && "border-red-500/60",
          className,
        )}
      >
        <StatusIndicator
          state={statusToIndicatorState(shown)}
          size={indicatorSize}
        />
        <span>{statusLabel(shown)}</span>
        {cascaded && (
          <span className="text-[10px] text-muted-foreground">(cascade)</span>
        )}
      </button>
      <ValidationDialog
        open={open}
        onOpenChange={setOpen}
        kind="service_gateway"
        subjectId={serviceId}
        subjectName={`${serviceName} · ${gatewayName}`}
        secondSubjectId={gatewayId}
        currentStatus={status}
        lastValidatedAt={lastValidatedAt}
        lastValidatedBy={lastValidatedBy}
        allowedStatuses={allowedStatuses}
      />
    </>
  )
}
