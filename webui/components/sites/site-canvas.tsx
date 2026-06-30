"use client"

import "@xyflow/react/dist/style.css"

import { useMemo } from "react"
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

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { GatewayStatusPill } from "@/components/services/gateway-status-pill"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { gatewayIcon, gatewayKindLabel, serviceIcon } from "@/lib/service-meta"
import { statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type { Gateway, Service } from "@/lib/types"

const LANE_WIDTH = 240
const LANE_X = { local: 40, gateways: 360, external: 680 }
const NODE_HEIGHT = 76
const NODE_GAP = 12
const LANE_TOP = 80

interface ServiceNodeData extends Record<string, unknown> {
  service: Service
}

interface GatewayNodeData extends Record<string, unknown> {
  gateway: Gateway
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
  const { service } = data as ServiceNodeData
  const Icon = serviceIcon(service.icon, service.kind)
  const showLeft = service.reach !== "local"  // external/both anchor on left
  const showRight = service.reach !== "external"  // local/both anchor on right
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border bg-background p-3 shadow-sm"
      style={{ width: LANE_WIDTH }}
    >
      {showLeft && (
        <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      )}
      {showRight && (
        <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{service.name}</span>
        </div>
        <ServiceStatusPill serviceId={service.id} status={service.status} />
      </div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {service.kind} · {service.hosting}
      </div>
    </div>
  )
}

function GatewayCanvasNode({ data }: NodeProps) {
  const { gateway } = data as GatewayNodeData
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
        <GatewayStatusPill gatewayId={gateway.id} status={gateway.status} />
      </div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {gatewayKindLabel(gateway.kind)}
        {gateway.provider ? ` · ${gateway.provider}` : ""}
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

function SiteCanvasInner({ services, gateways }: Props) {
  const { nodes, edges } = useMemo(() => {
    const localServices = services.filter((s) => s.reach === "local")
    const bothServices = services.filter((s) => s.reach === "both")
    const externalServices = services.filter((s) => s.reach === "external")
    // "Both" services live in the local lane (they have a local instance) and
    // also receive an edge from gateways, so they appear connected on both sides.
    const localLane = [...localServices, ...bothServices]
    const externalLane = externalServices

    const built: Node[] = []
    const built_edges: Edge[] = []

    built.push(
      {
        id: "header-local",
        type: "laneHeader",
        position: { x: LANE_X.local, y: 20 },
        data: { label: "Local", count: localLane.length, accent: "border-emerald-500/40" },
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
        data: { label: "External", count: externalLane.length, accent: "border-sky-500/40" },
        draggable: false,
        selectable: false,
      },
    )

    localLane.forEach((svc, i) => {
      built.push({
        id: `service-${svc.id}`,
        type: "service",
        position: { x: LANE_X.local, y: LANE_TOP + i * (NODE_HEIGHT + NODE_GAP) },
        data: { service: svc },
        draggable: false,
      })
    })

    gateways.forEach((gw, i) => {
      built.push({
        id: `gateway-${gw.id}`,
        type: "gateway",
        position: { x: LANE_X.gateways, y: LANE_TOP + i * (NODE_HEIGHT + NODE_GAP) },
        data: { gateway: gw },
        draggable: false,
      })
    })

    externalLane.forEach((svc, i) => {
      built.push({
        id: `service-${svc.id}`,
        type: "service",
        position: { x: LANE_X.external, y: LANE_TOP + i * (NODE_HEIGHT + NODE_GAP) },
        data: { service: svc },
        draggable: false,
      })
    })

    // "both" services have local nodes but also need to connect through gateways
    // → external view. Render virtual external copies for the connect edges only
    // if you want. For MVP, just connect from gateway → "both" local node so the
    // operator can see the dependency without duplication.
    if (gateways.length > 0) {
      for (const gw of gateways) {
        for (const svc of externalLane) {
          built_edges.push({
            id: `e-gw${gw.id}-svc${svc.id}`,
            source: `gateway-${gw.id}`,
            target: `service-${svc.id}`,
            animated: gw.status === "up" && svc.status === "up",
            style: {
              stroke: gw.status === "down" ? "rgb(239 68 68)" : "rgb(245 158 11)",
              strokeDasharray: gw.status === "down" ? "4 4" : undefined,
            },
          })
        }
        for (const svc of bothServices) {
          built_edges.push({
            id: `e-svc${svc.id}-gw${gw.id}`,
            source: `service-${svc.id}`,
            target: `gateway-${gw.id}`,
            animated: gw.status === "up" && svc.status === "up",
            style: {
              stroke: gw.status === "down" ? "rgb(239 68 68)" : "rgb(245 158 11)",
              strokeDasharray: gw.status === "down" ? "4 4" : undefined,
            },
          })
        }
      }
    }

    return { nodes: built, edges: built_edges }
  }, [services, gateways])

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
  if (props.services.length === 0 && props.gateways.length === 0) {
    return (
      <div className="flex h-[480px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        Add a service or gateway above to populate the canvas.
      </div>
    )
  }
  return (
    <div className="h-[480px] w-full rounded-lg border border-border">
      <ReactFlowProvider>
        <SiteCanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  )
}
