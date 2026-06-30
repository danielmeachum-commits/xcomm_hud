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
import { NodeActionSheet } from "@/components/sites/node-action-sheet"
import { gatewayIcon, gatewayKindLabel, serviceIcon } from "@/lib/service-meta"
import { cn } from "@/lib/utils"
import type { Gateway, Service } from "@/lib/types"

const LANE_WIDTH = 240
const LANE_X = { local: 40, gateways: 360, external: 680 }
const NODE_HEIGHT = 76
const NODE_GAP = 12
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

function ServiceCanvasNode({ data }: NodeProps) {
  const { service, onOpen } = data as ServiceNodeData
  const Icon = serviceIcon(service.icon, service.kind)
  const isExternal = service.reach === "external"
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border bg-background p-3 shadow-sm transition-colors hover:bg-accent/40"
      style={{ width: LANE_WIDTH }}
    >
      {/* Local services sit left of gateways → emit from the right.
       *  External services sit right of gateways → receive on the left. */}
      {isExternal ? (
        <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
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
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {service.kind} {isExternal ? "· external" : "· local"}
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
    </div>
  )
}

function GatewayCanvasNode({ data }: NodeProps) {
  const { gateway, onOpen } = data as GatewayNodeData
  const Icon = gatewayIcon(gateway.kind)
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-3 shadow-sm"
      style={{ width: LANE_WIDTH }}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-500" />
      <Handle type="source" position={Position.Right} className="!bg-amber-500" />
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
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {gatewayKindLabel(gateway.kind)}
          {gateway.provider ? ` · ${gateway.provider}` : ""}
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
    // Services are pre-sorted by display_order from the API; preserve that here.
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

    // Edges from each gateway to ALL services at the site. Local edges are
    // subtle (slate, dashed, no recolor when gateway down) since local is not
    // gateway-dependent; external edges go red when the gateway drops.
    for (const gw of gateways) {
      // local: gateway is on the right of locals, so source=service target=gateway
      for (const svc of local) {
        const animated = gw.status === "up" && svc.effective_status === "up"
        builtEdges.push({
          id: `e-svc${svc.id}-gw${gw.id}`,
          source: `service-${svc.id}`,
          target: `gateway-${gw.id}`,
          animated,
          style: {
            stroke: "rgb(148 163 184)",
            strokeDasharray: "2 4",
            strokeWidth: 1.2,
            opacity: 0.7,
          },
        })
      }
      // external: gateway is on the left of externals, so source=gateway target=service
      for (const svc of external) {
        const isDown = gw.status === "down"
        builtEdges.push({
          id: `e-gw${gw.id}-svc${svc.id}`,
          source: `gateway-${gw.id}`,
          target: `service-${svc.id}`,
          animated: gw.status === "up" && svc.effective_status === "up",
          style: {
            stroke: isDown ? "rgb(239 68 68)" : "rgb(245 158 11)",
            strokeDasharray: isDown ? "4 4" : undefined,
            strokeWidth: 1.8,
          },
        })
      }
    }

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
  return (
    <>
      <div className="h-[480px] w-full rounded-lg border border-border">
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
      <NodeActionSheet
        open={!!(selectedService || selectedGateway)}
        onClose={() => {
          setSelectedService(null)
          setSelectedGateway(null)
        }}
        service={selectedService}
        gateway={selectedGateway}
      />
    </>
  )
}
