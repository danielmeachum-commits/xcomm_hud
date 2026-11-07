"use client"

import { Link2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { ValidationDialog } from "@/components/validation-dialog"
import { statusLabel, statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type { CellStatus, GatewayStatus, StatusValue } from "@/lib/types"

interface Props {
  serviceId: number
  serviceName: string
  gatewayId: number
  gatewayName: string
  /** Live gateway status — used to render a second indicator in the
   *  validation dialog so the operator can see which gateway is being
   *  validated and what shape it's in right now. */
  gatewayStatus?: GatewayStatus
  /** Stored cell status — operator's last validation, or "ready" cascaded
   *  from a gateway on PACE standby. */
  status: CellStatus
  /** Displayed cell status — R10/R11 applied. Shown if it diverges from
   *  the stored value so the operator can see the cascade in effect. */
  effectiveStatus?: CellStatus
  lastValidatedAt?: string | null
  lastValidatedBy?: string | null
  /** Restricted to StatusValue — operators can't manually set a cell to
   *  "ready"; that value only arrives via the R9 gateway cascade. */
  allowedStatuses?: StatusValue[] | null
  className?: string
  /** Size of the inline StatusIndicator dot. */
  indicatorSize?: "sm" | "md" | "lg" | "xl"
  /** The gateway IS the device providing the service on this path. */
  sameDevice?: boolean
}

/** Matrix cell pill for a single (service × gateway) intersection. Same
 *  shape as ServiceStatusPill but its click routes to the cell validation
 *  endpoint via ValidationDialog kind="service_gateway". */
export function MatrixCellPill({
  serviceId,
  serviceName,
  gatewayId,
  gatewayName,
  gatewayStatus,
  status,
  effectiveStatus,
  lastValidatedAt = null,
  lastValidatedBy = null,
  allowedStatuses = null,
  className,
  indicatorSize = "sm",
  sameDevice = false,
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
            : sameDevice
              ? `${gatewayName} is the device providing ${serviceName} here — validating the gateway sets this path`
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
        {sameDevice && (
          <Link2 className="size-3 shrink-0 text-muted-foreground" aria-label="same device as the gateway" />
        )}
        {cascaded && (
          <span className="text-[10px] text-muted-foreground">(cascade)</span>
        )}
      </button>
      <ValidationDialog
        open={open}
        onOpenChange={setOpen}
        kind="service_gateway"
        subjectId={serviceId}
        subjectName={serviceName}
        secondSubjectId={gatewayId}
        secondSubjectName={gatewayName}
        secondSubjectStatus={gatewayStatus}
        currentStatus={status}
        lastValidatedAt={lastValidatedAt}
        lastValidatedBy={lastValidatedBy}
        allowedStatuses={allowedStatuses}
        recordExtra={
          <SameDeviceToggle
            serviceId={serviceId}
            serviceName={serviceName}
            gatewayId={gatewayId}
            gatewayName={gatewayName}
            sameDevice={sameDevice}
          />
        }
      />
    </>
  )
}

/**
 * "This gateway is the device providing the service on this path" — a 117G
 * doing MUOS voice. Saved immediately (it's a property of the path, not part
 * of a validation): validating the gateway then sets this cell, the service's
 * local status doesn't cap it, and a service whose every path is like this
 * has its local status follow. See api/same_device.py.
 */
function SameDeviceToggle({
  serviceId,
  serviceName,
  gatewayId,
  gatewayName,
  sameDevice,
}: {
  serviceId: number
  serviceName: string
  gatewayId: number
  gatewayName: string
  sameDevice: boolean
}) {
  const router = useRouter()
  const [on, setOn] = useState(sameDevice)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(next: boolean) {
    setPending(true)
    setError(null)
    setOn(next)
    try {
      const res = await fetch(`/api/be/services/${serviceId}/gateways/${gatewayId}/same-device`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ same_device: next }),
      })
      if (!res.ok) throw new Error("Couldn't save")
      router.refresh()
    } catch {
      setOn(!next)
      setError("Couldn't save that — try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <label className="flex items-start gap-2 rounded-md border bg-muted/20 p-2.5 text-xs">
      <input
        type="checkbox"
        className="mt-0.5 size-4"
        checked={on}
        disabled={pending}
        onChange={(e) => toggle(e.target.checked)}
      />
      <span>
        <span className="font-medium">
          {gatewayName} is the device providing {serviceName} here
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          Validating the gateway also sets this path, and the service&apos;s
          local status doesn&apos;t cap it. If every path is like this, local
          status follows too.
        </span>
        {error && <span className="mt-1 block text-destructive">{error}</span>}
      </span>
    </label>
  )
}
