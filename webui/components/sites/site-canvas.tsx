"use client"

import "@xyflow/react/dist/style.css"

import { useMemo, useState } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react"
import { MoreHorizontal } from "lucide-react"

import { GatewayStatusPill } from "@/components/services/gateway-status-pill"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { NodeActionPanel } from "@/components/sites/node-action-sheet"
import { TimeAgo } from "@/components/time-display"
import {
  gatewayIcon,
  gatewayKindLabel,
  paceClasses,
  paceShort,
  serviceIcon,
} from "@/lib/service-meta"
import {
  statusBadgeClass,
  statusEdgeHandle,
  statusEdgeStroke,
} from "@/lib/status"
import { cn } from "@/lib/utils"
import type {
  Gateway,
  GatewayStatus,
  Service,
} from "@/lib/types"

const LANE_WIDTH = 240
const LANE_X = { local: 40, gateways: 360, external: 680 }
const NODE_HEIGHT = 84
const NODE_GAP = 16
const LANE_TOP = 80

interface ServiceNodeData extends Record<string, unknown> {
  service: Service
  onOpen: () => void
}

interface GatewayNodeData extends Record<string, unknown> {
  gateway: Gateway
  onOpen: () => void
}

interface LaneHeaderData extends Record<string, unknown> {
  label: string
  count: number
  accent: string
}

function LaneHeaderNode({ data }: NodeProps) {
  const d = data as LaneHeaderData
  return (
    <div
      className={cn(
        "rounded-md border bg-background/70 px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground shadow-sm",
        d.accent,
      )}
      style={{ width: LANE_WIDTH }}
    >
      <div className="font-semibold">{d.label}</div>
      <div className="text-[10px] normal-case text-muted-foreground/80">
        {d.count} {d.count === 1 ? "item" : "items"}
      </div>
    </div>
  )
}

function ServiceFooter({
  kind,
  validatedAt,
}: {
  kind: string
  validatedAt: string | null
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
      <span>{kind}</span>
      <span className="normal-case">
        {validatedAt ? (
          <>
            validated <TimeAgo iso={validatedAt} />
          </>
        ) : (
          <span className="italic">never validated</span>
        )}
      </span>
    </div>
  )
}

function ServiceCanvasNode({ data }: NodeProps) {
  const { service, onOpen } = data as ServiceNodeData
  const Icon = serviceIcon(service.icon, service.kind)
  const isExternal = service.reach === "external"
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border p-3 shadow-sm transition-colors hover:brightness-110",
        statusBadgeClass(service.effective_status),
      )}
      style={{ width: LANE_WIDTH }}
    >
      {/* Both local and external services emit edges toward the gateway lane
       *  in the middle — local from its right edge, external from its left. */}
      {isExternal ? (
        <Handle type="source" position={Position.Left} className="!bg-muted-foreground" />
      ) : (
        <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
      )}
      <div className="flex items-center justify-between gap-2">
        <a
          href={`/services/${service.id}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDownCapture={(e) => e.stopPropagation()}
          className="nodrag flex min-w-0 flex-1 items-center gap-2 hover:underline"
          title="Open service detail"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{service.name}</span>
        </a>
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
      <ServiceFooter kind={service.kind} validatedAt={service.validated_at} />
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          onPointerDownCapture={(e) => e.stopPropagation()}
          className="nodrag rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Actions"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

/** Three colored handles per side (green/orange/red) mapped to service status
 *  categories — `ok` (up/active/unknown), `degraded`, `down`. Operators read
 *  the dock color at a glance to see "this service is fine going through this
 *  gateway" or "this service is broken on this gateway". */
function GatewayDocks({ side }: { side: "left" | "right" }) {
  const pos = side === "left" ? Position.Left : Position.Right
  return (
    <>
      <Handle
        id={`${side}-ok`}
        type="target"
        position={pos}
        style={{ top: "30%", background: "rgb(34 197 94)" }}
      />
      <Handle
        id={`${side}-degraded`}
        type="target"
        position={pos}
        style={{ top: "50%", background: "rgb(245 158 11)" }}
      />
      <Handle
        id={`${side}-down`}
        type="target"
        position={pos}
        style={{ top: "70%", background: "rgb(239 68 68)" }}
      />
    </>
  )
}

function GatewayCanvasNode({ data }: NodeProps) {
  const { gateway, onOpen } = data as GatewayNodeData
  const Icon = gatewayIcon(gateway.kind)
  const pace = paceClasses(gateway.pace)
  return (
    <div
      className={cn(
        "relative flex flex-col gap-1 rounded-lg border-2 p-3 shadow-sm",
        statusBadgeClass(gateway.status),
      )}
      style={{ width: LANE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <GatewayDocks side="left" />
      <GatewayDocks side="right" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <span className="truncate text-sm font-medium">{gateway.name}</span>
        </div>
        <GatewayStatusPill
          gatewayId={gateway.id}
          gatewayName={gateway.name}
          status={gateway.status}
          lastValidatedAt={gateway.validated_at}
          lastValidatedBy={gateway.validated_by_username}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span
            title={`PACE: ${gateway.pace}`}
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold",
              pace.bg,
              pace.text,
            )}
          >
            {paceShort(gateway.pace)}
          </span>
          <span>
            {gatewayKindLabel(gateway.kind)}
            {gateway.provider ? ` · ${gateway.provider}` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          onPointerDownCapture={(e) => e.stopPropagation()}
          className="nodrag rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Actions"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </div>
      <div className="text-[10px] normal-case text-muted-foreground">
        {gateway.validated_at ? (
          <>
            validated <TimeAgo iso={gateway.validated_at} />
          </>
        ) : (
          <span className="italic">never validated</span>
        )}
      </div>
    </div>
  )
}

const NODE_TYPES = {
  laneHeader: LaneHeaderNode,
  service: ServiceCanvasNode,
  gateway: GatewayCanvasNode,
}

interface Props {
  services: Service[]
  gateways: Gateway[]
}

/** Solid line only when the gateway is actively passing traffic. Any other
 *  status (ready/degraded/down/offline/setup) dashes to signal "not live". */
function dashForGateway(status: GatewayStatus): string | undefined {
  return status === "active" ? undefined : "6 4"
}

function SiteCanvasInner({
  services,
  gateways,
  onOpenService,
  onOpenGateway,
}: Props & {
  onOpenService: (svc: Service) => void
  onOpenGateway: (gw: Gateway) => void
}) {
  const { nodes, edges } = useMemo(() => {
    const local = services.filter((s) => s.reach === "local")
    const external = services.filter((s) => s.reach === "external")

    const built: Node[] = [
      {
        id: "header-local",
        type: "laneHeader",
        position: { x: LANE_X.local, y: 20 },
        data: { label: "Local", count: local.length, accent: "border-emerald-500/40" },
        draggable: false,
        selectable: false,
      },
      {
        id: "header-gateways",
        type: "laneHeader",
        position: { x: LANE_X.gateways, y: 20 },
        data: { label: "Gateways", count: gateways.length, accent: "border-amber-500/40" },
        draggable: false,
        selectable: false,
      },
      {
        id: "header-external",
        type: "laneHeader",
        position: { x: LANE_X.external, y: 20 },
        data: { label: "External", count: external.length, accent: "border-sky-500/40" },
        draggable: false,
        selectable: false,
      },
    ]
    const builtEdges: Edge[] = []

    local.forEach((svc, i) => {
      built.push({
        id: `service-${svc.id}`,
        type: "service",
        position: { x: LANE_X.local, y: LANE_TOP + i * (NODE_HEIGHT + NODE_GAP) },
        data: { service: svc, onOpen: () => onOpenService(svc) },
        draggable: false,
      })
    })

    gateways.forEach((gw, i) => {
      built.push({
        id: `gateway-${gw.id}`,
        type: "gateway",
        position: { x: LANE_X.gateways, y: LANE_TOP + i * (NODE_HEIGHT + NODE_GAP) },
        data: { gateway: gw, onOpen: () => onOpenGateway(gw) },
        draggable: false,
      })
    })

    external.forEach((svc, i) => {
      built.push({
        id: `service-${svc.id}`,
        type: "service",
        position: { x: LANE_X.external, y: LANE_TOP + i * (NODE_HEIGHT + NODE_GAP) },
        data: { service: svc, onOpen: () => onOpenService(svc) },
        draggable: false,
      })
    })

    function pushEdges(
      svcs: Service[],
      side: "left" | "right",
      lineWidth: number,
    ) {
      for (const svc of svcs) {
        const enabled = new Set(svc.enabled_pace ?? [])
        if (enabled.size === 0) continue
        const status = svc.effective_status
        const dock = statusEdgeHandle(status)
        const stroke = statusEdgeStroke(status)
        for (const gw of gateways) {
          if (!enabled.has(gw.pace)) continue
          const dash = dashForGateway(gw.status)
          // Healthy path = service up + gateway active. Those edges get
          // bolder + full opacity; everything else fades to recede visually.
          const isLive = svc.effective_status === "up" && gw.status === "active"
          builtEdges.push({
            id: `e-svc${svc.id}-gw${gw.id}-${side}`,
            source: `service-${svc.id}`,
            target: `gateway-${gw.id}`,
            targetHandle: `${side}-${dock}`,
            style: {
              stroke,
              strokeWidth: isLive ? lineWidth + 1 : lineWidth,
              strokeDasharray: dash,
              opacity: isLive ? 1 : 0.55,
            },
          })
        }
      }
    }

    pushEdges(local, "left", 1.6)
    pushEdges(external, "right", 1.8)

    return { nodes: built, edges: builtEdges }
  }, [services, gateways, onOpenService, onOpenGateway])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      nodesDraggable={false}
      panOnDrag
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export function SiteCanvas(props: Props) {
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [selectedGateway, setSelectedGateway] = useState<Gateway | null>(null)

  if (props.services.length === 0 && props.gateways.length === 0) {
    return (
      <div className="flex h-[480px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        Add a service or gateway above to populate the canvas.
      </div>
    )
  }
  const hasSelection = !!(selectedService || selectedGateway)
  return (
    <div className="flex h-[480px] w-full overflow-hidden rounded-lg border border-border">
      <div className="min-w-0 flex-1">
        <ReactFlowProvider>
          <SiteCanvasInner
            {...props}
            onOpenService={(svc) => {
              setSelectedService(svc)
              setSelectedGateway(null)
            }}
            onOpenGateway={(gw) => {
              setSelectedGateway(gw)
              setSelectedService(null)
            }}
          />
        </ReactFlowProvider>
      </div>
      {hasSelection && (
        <NodeActionPanel
          onClose={() => {
            setSelectedService(null)
            setSelectedGateway(null)
          }}
          service={selectedService}
          gateway={selectedGateway}
        />
      )}
    </div>
  )
}
