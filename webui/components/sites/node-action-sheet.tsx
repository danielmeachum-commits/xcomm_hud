"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { ArrowDown, ArrowUp, ExternalLink, Trash2 } from "lucide-react"

import { GatewayStatusPill } from "@/components/services/gateway-status-pill"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { GatewayForm } from "@/components/sites/gateway-form"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  categoryLabel,
  gatewayIcon,
  gatewayKindLabel,
  reachLabel,
  serviceIcon,
} from "@/lib/service-meta"
import { formatLocal, formatZulu, timeAgo } from "@/lib/time"
import type { Gateway, Service } from "@/lib/types"

interface Props {
  open: boolean
  onClose: () => void
  /** Either a service or a gateway being acted on. */
  service?: Service | null
  gateway?: Gateway | null
}

export function NodeActionSheet({ open, onClose, service, gateway }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function move(kind: "service" | "gateway", id: number, direction: "up" | "down") {
    setPending(true)
    try {
      const res = await fetch(
        `/api/be/${kind === "service" ? "services" : "gateways"}/${id}/move?direction=${direction}`,
        { method: "POST" },
      )
      if (res.ok) router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function remove(kind: "service" | "gateway", id: number, name: string) {
    if (!confirm(`Delete ${kind} "${name}"?`)) return
    setPending(true)
    try {
      const res = await fetch(
        `/api/be/${kind === "service" ? "services" : "gateways"}/${id}`,
        { method: "DELETE" },
      )
      if (res.ok) {
        onClose()
        router.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[420px] sm:max-w-[420px]">
        {service && (
          <ServiceSheetBody
            service={service}
            pending={pending}
            onMove={(dir) => move("service", service.id, dir)}
            onDelete={() => remove("service", service.id, service.name)}
          />
        )}
        {gateway && (
          <GatewaySheetBody
            gateway={gateway}
            pending={pending}
            onMove={(dir) => move("gateway", gateway.id, dir)}
            onDelete={() => remove("gateway", gateway.id, gateway.name)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function ServiceSheetBody({
  service,
  pending,
  onMove,
  onDelete,
}: {
  service: Service
  pending: boolean
  onMove: (dir: "up" | "down") => void
  onDelete: () => void
}) {
  const Icon = serviceIcon(service.icon, service.kind)
  return (
    <div className="flex flex-col gap-4 p-4">
      <SheetHeader className="p-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="size-5 shrink-0 text-muted-foreground" />
            <SheetTitle className="truncate">{service.name}</SheetTitle>
          </div>
          <ServiceStatusPill
            serviceId={service.id}
            serviceName={service.name}
            status={service.status}
            effectiveStatus={service.effective_status}
            lastValidatedAt={service.validated_at}
            lastValidatedBy={service.validated_by_username}
            allowedStatuses={service.allowed_statuses}
          />
        </div>
      </SheetHeader>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Category</dt>
        <dd>{categoryLabel(service.category)}</dd>
        <dt className="text-muted-foreground">Reach</dt>
        <dd>{reachLabel(service.reach)}</dd>
        <dt className="text-muted-foreground">Kind</dt>
        <dd>{service.kind}</dd>
      </dl>

      {service.description && (
        <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
          {service.description}
        </p>
      )}

      {service.validated_at && (
        <div className="rounded-md border p-2 text-[11px]">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Last validation
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 font-mono">
            <div>{formatLocal(service.validated_at)}</div>
            <div>{formatZulu(service.validated_at)}</div>
          </div>
          <div className="mt-1 text-muted-foreground">
            {timeAgo(service.validated_at)}
            {service.validated_by_username ? ` · ${service.validated_by_username}` : ""}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => onMove("up")} disabled={pending}>
          <ArrowUp className="size-3.5" />
          Move up
        </Button>
        <Button size="sm" variant="outline" onClick={() => onMove("down")} disabled={pending}>
          <ArrowDown className="size-3.5" />
          Move down
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/services/${service.id}`}
          className="inline-flex items-center gap-1 text-xs hover:underline"
        >
          <ExternalLink className="size-3" />
          Open detail
        </Link>
        <Button variant="ghost" size="sm" onClick={onDelete} disabled={pending}>
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>
    </div>
  )
}

function GatewaySheetBody({
  gateway,
  pending,
  onMove,
  onDelete,
}: {
  gateway: Gateway
  pending: boolean
  onMove: (dir: "up" | "down") => void
  onDelete: () => void
}) {
  const Icon = gatewayIcon(gateway.kind)
  return (
    <div className="flex flex-col gap-4 p-4">
      <SheetHeader className="p-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="size-5 shrink-0 text-amber-700 dark:text-amber-400" />
            <SheetTitle className="truncate">{gateway.name}</SheetTitle>
          </div>
          <GatewayStatusPill
            gatewayId={gateway.id}
            gatewayName={gateway.name}
            status={gateway.status}
            lastValidatedAt={gateway.validated_at}
            lastValidatedBy={gateway.validated_by_username}
          />
        </div>
      </SheetHeader>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Kind</dt>
        <dd>{gatewayKindLabel(gateway.kind)}</dd>
        <dt className="text-muted-foreground">Provider</dt>
        <dd>{gateway.provider ?? "—"}</dd>
      </dl>

      {gateway.notes && (
        <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
          {gateway.notes}
        </p>
      )}

      {gateway.validated_at && (
        <div className="rounded-md border p-2 text-[11px]">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Last validation
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 font-mono">
            <div>{formatLocal(gateway.validated_at)}</div>
            <div>{formatZulu(gateway.validated_at)}</div>
          </div>
          <div className="mt-1 text-muted-foreground">
            {timeAgo(gateway.validated_at)}
            {gateway.validated_by_username ? ` · ${gateway.validated_by_username}` : ""}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => onMove("up")} disabled={pending}>
          <ArrowUp className="size-3.5" />
          Move up
        </Button>
        <Button size="sm" variant="outline" onClick={() => onMove("down")} disabled={pending}>
          <ArrowDown className="size-3.5" />
          Move down
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <GatewayForm siteId={gateway.site_id} gateway={gateway} triggerLabel="Edit details" />
        <Button variant="ghost" size="sm" onClick={onDelete} disabled={pending}>
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>
    </div>
  )
}
