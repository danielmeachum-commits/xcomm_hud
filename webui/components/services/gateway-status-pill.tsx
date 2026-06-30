"use client"

import { useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { ValidationDialog } from "@/components/validation-dialog"
import { statusLabel, statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type { StatusValue } from "@/lib/types"

interface Props {
  gatewayId: number
  gatewayName: string
  status: StatusValue
  lastValidatedAt?: string | null
  lastValidatedBy?: string | null
  className?: string
}

export function GatewayStatusPill({
  gatewayId,
  gatewayName,
  status,
  lastValidatedAt = null,
  lastValidatedBy = null,
  className,
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onPointerDownCapture={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(true)
        }}
        className={cn(
          "nodrag nowheel inline-flex items-center gap-2 rounded-full border bg-background/60 px-2 py-1 text-xs uppercase tracking-wider transition-colors hover:bg-accent",
          className,
        )}
      >
        <StatusIndicator state={statusToIndicatorState(status)} size="sm" />
        <span>{statusLabel(status)}</span>
      </button>
      <ValidationDialog
        open={open}
        onOpenChange={setOpen}
        kind="gateway"
        subjectId={gatewayId}
        subjectName={gatewayName}
        currentStatus={status}
        lastValidatedAt={lastValidatedAt}
        lastValidatedBy={lastValidatedBy}
      />
    </>
  )
}
