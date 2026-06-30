"use client"

import "@xyflow/react/dist/style.css"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
} from "@xyflow/react"
import { ExternalLink, Plus, StickyNote, Trash2 } from "lucide-react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { Button } from "@/components/ui/button"
import {
  categoryAccentClass,
  gatewayIcon,
  serviceIcon,
} from "@/lib/service-meta"
import { statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type {
  CanvasAnnotation,
  Gateway,
  MapBundle,
  Service,
  Site,
} from "@/lib/types"

interface SiteNodeData extends Record<string, unknown> {
  site: Site
  services: Service[]
  gateways: Gateway[]
}

interface AnnotationNodeData extends Record<string, unknown> {
  annotation: CanvasAnnotation
  onEdit: (id: number, text: string) => void
  onDelete: (id: number) => void
}

const SITE_NODE_WIDTH = 280

function SiteMapNode({ data }: NodeProps) {
  const { site, services, gateways } = data as SiteNodeData

  // Group services by category for visual clustering inside the site card
  const byCategory = new Map<string, Service[]>()
  for (const s of services) {
    const list = byCategory.get(s.category) ?? []
    list.push(s)
    byCategory.set(s.category, list)
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border bg-background p-3 shadow-md"
      style={{ width: SITE_NODE_WIDTH }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIndicator
            state={statusToIndicatorState(site.status)}
            size="md"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{site.name}</div>
            {site.location_label && (
              <div className="truncate text-[10px] text-muted-foreground">
                {site.location_label}
              </div>
            )}
          </div>
        </div>
        <a
          href={`/sites/${site.id}`}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Open site"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>

      {gateways.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {gateways.map((g) => {
            const Icon = gatewayIcon(g.kind)
            return (
              <span
                key={g.id}
                title={`${g.name} · ${g.status}`}
                className="inline-flex items-center gap-1 rounded-full border-2 border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px]"
              >
                <Icon className="size-3 text-amber-700 dark:text-amber-400" />
                <StatusIndicator state={statusToIndicatorState(g.status)} size="sm" />
                <span className="truncate max-w-[80px]">{g.name}</span>
              </span>
            )
          })}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {Array.from(byCategory.entries()).map(([cat, items]) => (
          <div key={cat} className={cn("rounded-md border p-1.5", categoryAccentClass(cat as Service["category"]))}>
            <div className="flex flex-wrap gap-1">
              {items.map((s) => {
                const Icon = serviceIcon(s.icon, s.kind)
                return (
                  <span
                    key={s.id}
                    title={`${s.name} · ${s.status}`}
                    className="inline-flex items-center gap-1 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px]"
                  >
                    <Icon className="size-3 text-muted-foreground" />
                    <StatusIndicator state={statusToIndicatorState(s.status)} size="sm" />
                    <span className="truncate max-w-[68px]">{s.name}</span>
                  </span>
                )
              })}
            </div>
          </div>
        ))}
        {services.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-2 text-[10px] text-muted-foreground">
            No services
          </div>
        )}
      </div>
    </div>
  )
}

function AnnotationNode({ data }: NodeProps) {
  const d = data as AnnotationNodeData
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(d.annotation.text)

  function commit() {
    setEditing(false)
    if (text !== d.annotation.text) d.onEdit(d.annotation.id, text)
  }

  return (
    <div
      className="group flex flex-col gap-1 rounded-md border border-dashed border-foreground/40 bg-background/80 p-2 text-xs shadow-sm"
      style={{ minWidth: 120 }}
    >
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          autoFocus
          rows={Math.max(1, text.split("\n").length)}
          className="w-full resize-none bg-transparent outline-none"
        />
      ) : (
        <div
          onDoubleClick={() => setEditing(true)}
          className="whitespace-pre-wrap"
        >
          {d.annotation.text || (
            <span className="italic text-muted-foreground">(double-click to edit)</span>
          )}
        </div>
      )}
      <button
        onClick={() => d.onDelete(d.annotation.id)}
        className="invisible self-end text-muted-foreground hover:text-destructive group-hover:visible"
        aria-label="Delete annotation"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  )
}

const NODE_TYPES = {
  site: SiteMapNode,
  annotation: AnnotationNode,
}

interface Props {
  bundle: MapBundle
}

const SAVE_DELAY_MS = 400

function MapCanvasInner({ bundle }: Props) {
  const router = useRouter()

  const positionMap = useMemo(() => {
    const m = new Map<number, { x: number; y: number }>()
    for (const p of bundle.positions) m.set(p.site_id, { x: p.x, y: p.y })
    return m
  }, [bundle.positions])

  // Bin services + gateways by site for each node's data prop
  const servicesBySite = useMemo(() => {
    const m = new Map<number, Service[]>()
    for (const s of bundle.services) {
      if (s.site_id == null) continue
      const list = m.get(s.site_id) ?? []
      list.push(s)
      m.set(s.site_id, list)
    }
    return m
  }, [bundle.services])

  const gatewaysBySite = useMemo(() => {
    const m = new Map<number, Gateway[]>()
    for (const g of bundle.gateways) {
      const list = m.get(g.site_id) ?? []
      list.push(g)
      m.set(g.site_id, list)
    }
    return m
  }, [bundle.gateways])

  async function patchAnnotation(id: number, body: Record<string, unknown>) {
    await fetch(`/api/be/canvas/annotations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    router.refresh()
  }

  async function deleteAnnotation(id: number) {
    await fetch(`/api/be/canvas/annotations/${id}`, { method: "DELETE" })
    router.refresh()
  }

  async function addAnnotation() {
    await fetch(`/api/be/canvas/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "New label", x: 40, y: 40 }),
    })
    router.refresh()
  }

  const initialNodes = useMemo<Node[]>(() => {
    const built: Node[] = []
    bundle.sites.forEach((site, i) => {
      const pos = positionMap.get(site.id) ?? { x: 60 + i * 320, y: 80 }
      built.push({
        id: `site-${site.id}`,
        type: "site",
        position: pos,
        data: {
          site,
          services: servicesBySite.get(site.id) ?? [],
          gateways: gatewaysBySite.get(site.id) ?? [],
        },
      })
    })
    for (const ann of bundle.annotations) {
      built.push({
        id: `ann-${ann.id}`,
        type: "annotation",
        position: { x: ann.x, y: ann.y },
        data: {
          annotation: ann,
          onEdit: (id: number, text: string) => patchAnnotation(id, { text }),
          onDelete: deleteAnnotation,
        },
      })
    }
    return built
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, positionMap, servicesBySite, gatewaysBySite])

  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  useEffect(() => setNodes(initialNodes), [initialNodes])

  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const scheduleSave = useCallback((node: Node) => {
    const key = node.id
    const existing = saveTimers.current.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(async () => {
      saveTimers.current.delete(key)
      const { x, y } = node.position
      if (node.id.startsWith("site-")) {
        const siteId = Number(node.id.slice(5))
        await fetch(`/api/be/canvas/positions/${siteId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x, y }),
        })
      } else if (node.id.startsWith("ann-")) {
        const annId = Number(node.id.slice(4))
        await patchAnnotation(annId, { x, y })
      }
    }, SAVE_DELAY_MS)
    saveTimers.current.set(key, timer)
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current)
        // After applying, schedule saves for any dragged node whose position changed
        for (const ch of changes) {
          if (ch.type === "position" && ch.dragging === false) {
            const moved = next.find((n) => n.id === ch.id)
            if (moved) scheduleSave(moved)
          }
        }
        return next
      })
    },
    [scheduleSave],
  )

  const edges: Edge[] = []

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={NODE_TYPES}
      fitView={initialNodes.length > 0}
      fitViewOptions={{ padding: 0.3 }}
      panOnDrag
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      <Controls />
      <Panel position="top-right" className="flex gap-2">
        <Button size="sm" variant="outline" onClick={addAnnotation}>
          <StickyNote className="size-3.5" />
          Add label
        </Button>
        <a
          href="/sites"
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
        >
          <Plus className="size-3" />
          Add site
        </a>
      </Panel>
    </ReactFlow>
  )
}

export function MapCanvas({ bundle }: Props) {
  return (
    <div className="h-[calc(100vh-180px)] w-full overflow-hidden rounded-lg border border-border">
      <ReactFlowProvider>
        <MapCanvasInner bundle={bundle} />
      </ReactFlowProvider>
    </div>
  )
}
