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
  /** Stored status — what the operator last validated. */
  status: StatusValue
  /** Effective status — same as status for local; for external it may be
   * forced to "down" by gateway cascade. Shown if different from status. */
  effectiveStatus?: StatusValue
  lastValidatedAt?: string | null
  lastValidatedBy?: string | null
  /** Optional whitelist of statuses this service can be set to. */
  allowedStatuses?: StatusValue[] | null
  className?: string
}

export function ServiceStatusPill({
  serviceId,
  serviceName,
  status,
  effectiveStatus,
  lastValidatedAt = null,
  lastValidatedBy = null,
  allowedStatuses = null,
  className,
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
            ? `Stored: ${statusLabel(status)} — overridden because no enabled gateway is live`
            : `Tap to validate`
        }
        className={cn(
          "nodrag nowheel inline-flex items-center gap-2 rounded-full border bg-background/60 px-2 py-1 text-xs uppercase tracking-wider transition-colors hover:bg-accent",
          cascaded && "border-red-500/60",
          className,
        )}
      >
        <StatusIndicator state={statusToIndicatorState(shown)} size="sm" />
        <span>{statusLabel(shown)}</span>
        {cascaded && <span className="text-[10px] text-muted-foreground">(no path)</span>}
      </button>
      <ValidationDialog
        open={open}
        onOpenChange={setOpen}
        kind="service"
        subjectId={serviceId}
        subjectName={serviceName}
        currentStatus={status}
        lastValidatedAt={lastValidatedAt}
        lastValidatedBy={lastValidatedBy}
        allowedStatuses={allowedStatuses}
      />
    </>
  )
}
