"use client"

import "@xyflow/react/dist/style.css"

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react"
import { Maximize2, Minimize2, Plus } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { LinkForm } from "@/components/equipment/link-form"
import { Button } from "@/components/ui/button"
import {
  CAPABILITY_LABELS,
  LINK_KIND_DASH,
  LINK_KIND_LABELS,
  UTC_ROLE_LABELS,
  equipmentIcon,
  equipmentRollup,
} from "@/lib/equipment-meta"
import { statusEdgeAnimates, statusEdgeStroke, statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type {
  Enclave,
  Equipment,
  EquipmentLink,
  NetworkTopology,
  UtcInstance,
} from "@/lib/types"

const SAVE_DELAY_MS = 400

/** Deliberately a separate component from `map-canvas.tsx`. That one is a
 *  free-layout geographic view of sites with no edges at all; this one needs
 *  grouped nodes (site → UTC → equipment) and typed, status-styled edges.
 *  Merging them would make both worse. The position-persistence pattern and
 *  the status stroke helpers are shared, which is the part worth reusing. */

// ---------- collapsed view: one node per site ----------

interface SiteNodeData extends Record<string, unknown> {
  name: string
  utcs: UtcInstance[]
  equipment: Equipment[]
}

function SiteGroupNode({ data }: NodeProps) {
  const d = data as SiteNodeData
  const worst = d.equipment.length
    ? d.equipment
        .map(equipmentRollup)
        .sort((a, b) => rank(b) - rank(a))[0]
    : "unknown"
  return (
    <div className="min-w-[200px] rounded-xl border-2 border-border bg-card p-3 shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <StatusIndicator state={statusToIndicatorState(worst as never)} />
        <span className="font-semibold">{d.name}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {d.equipment.length} {d.equipment.length === 1 ? "item" : "items"} ·{" "}
        {d.utcs.length} UTC{d.utcs.length === 1 ? "" : "s"}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {d.utcs.map((u) => (
          <span
            key={u.id}
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[10px]",
              u.derived_role === "extension"
                ? "border-sky-500/50 bg-sky-500/10"
                : u.derived_role === "primary"
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-border",
            )}
            title={
              u.derived_role && u.derived_role !== u.role
                ? `Declared ${UTC_ROLE_LABELS[u.role]}, links say ${UTC_ROLE_LABELS[u.derived_role]}`
                : undefined
            }
          >
            {u.name}
            {u.derived_role && u.derived_role !== u.role ? " ⚠" : ""}
          </span>
        ))}
      </div>
    </div>
  )
}

function rank(s: string): number {
  return { up: 1, degraded: 2, maintenance: 3, down: 4, offline: 5 }[s] ?? 0
}

// ---------- expanded view: one node per piece of gear ----------

interface EquipmentNodeData extends Record<string, unknown> {
  equipment: Equipment
  utcName: string | null
  siteName: string | null
  enclave: Enclave | null
}

function EquipmentNode({ data }: NodeProps) {
  const d = data as EquipmentNodeData
  const eq = d.equipment
  const Icon = equipmentIcon(eq.type_category)
  const rollup = equipmentRollup(eq)
  // Enclave rides the LEFT BORDER only. Status owns the node's indicator and
  // its edges, and an operator scanning for what's down must not have that
  // signal competing with a hue that means something else entirely.
  const accent = d.enclave?.color
  return (
    <div
      className="min-w-[180px] rounded-lg border border-border bg-card p-2.5 shadow-sm"
      style={
        accent
          ? { borderLeftColor: accent, borderLeftWidth: 3 }
          : undefined
      }
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-sm font-medium">{eq.equipment_code}</span>
        <StatusIndicator state={statusToIndicatorState(rollup)} />
      </div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {eq.type_short_name ?? eq.type_title}
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        {d.siteName}
        {d.utcName ? ` · ${d.utcName}` : ""}
        {d.enclave ? ` · ${d.enclave.short_name || d.enclave.name}` : ""}
      </div>
      {eq.capabilities.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {eq.capabilities.map((c) => (
            <span
              key={c.id}
              title={`${c.label} — ${c.status}`}
              className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px]"
            >
              <StatusIndicator state={statusToIndicatorState(c.status)} />
              {CAPABILITY_LABELS[c.kind]}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const NODE_TYPES = { siteGroup: SiteGroupNode, equipment: EquipmentNode }

// ---------- canvas ----------

type Level = "sites" | "equipment"

function edgeFor(
  link: EquipmentLink,
  source: string,
  target: string,
  labelOverride?: string,
): Edge {
  return {
    id: `link-${link.id}-${source}-${target}`,
    source,
    target,
    // Carried so a click can find the row behind the edge. Only meaningful in
    // the expanded view — a collapsed edge stands for every link between two
    // sites, so the click handler ignores it there.
    data: { linkId: link.id },
    label: labelOverride ?? link.label ?? LINK_KIND_LABELS[link.kind],
    animated: statusEdgeAnimates(link.status),
    // Arrowheads only on directional shots — a peer trunk isn't a hierarchy.
    markerEnd:
      link.direction === "a_to_b"
        ? { type: "arrowclosed" as never, color: statusEdgeStroke(link.status) }
        : undefined,
    style: {
      stroke: statusEdgeStroke(link.status),
      strokeWidth: 2,
      strokeDasharray: LINK_KIND_DASH[link.kind],
    },
    labelStyle: { fontSize: 10 },
  }
}

function NetworkCanvasInner({
  topology,
  enclaves,
}: {
  topology: NetworkTopology
  enclaves: Enclave[]
}) {
  const [level, setLevel] = useState<Level>("sites")
  // Filtering is the half of enclave-awareness that costs no visual channel,
  // so it carries the weight here rather than the color accent.
  const [enclaveFilter, setEnclaveFilter] = useState<number | "all">("all")

  // Link editor. One mounted instance re-pointed per open, rather than a
  // dialog per edge — the graph can hold hundreds of links.
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingLink, setEditingLink] = useState<EquipmentLink | null>(null)
  const [draftEnds, setDraftEnds] = useState<{
    a: number | null
    b: number | null
  }>({ a: null, b: null })
  // Bumped on every open so the editor remounts with a fresh draft — see the
  // note on LinkForm about resetting via `key` rather than an effect.
  const [openSeq, setOpenSeq] = useState(0)

  const openCreate = useCallback((a: number | null, b: number | null) => {
    setEditingLink(null)
    setDraftEnds({ a, b })
    setOpenSeq((n) => n + 1)
    setEditorOpen(true)
  }, [])

  /** Dragging one node's handle onto another's is the fastest way to say
   *  "these two are connected" — it opens the editor pre-filled rather than
   *  creating a link outright, because kind and status are not guessable. */
  const onConnect = useCallback(
    (c: Connection) => {
      if (level !== "equipment") return
      if (!c.source?.startsWith("eq-") || !c.target?.startsWith("eq-")) return
      openCreate(Number(c.source.slice(3)), Number(c.target.slice(3)))
    },
    [level, openCreate],
  )

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      // Collapsed edges aggregate every link between a pair of sites, so
      // there is no single row to edit.
      if (level !== "equipment") return
      const linkId = (edge.data as { linkId?: number } | undefined)?.linkId
      const link = topology.links.find((l) => l.id === linkId)
      if (!link) return
      setEditingLink(link)
      setDraftEnds({ a: null, b: null })
      setOpenSeq((n) => n + 1)
      setEditorOpen(true)
    },
    [level, topology.links],
  )

  const enclaveById = useMemo(
    () => new Map(enclaves.map((e) => [e.id, e])),
    [enclaves],
  )

  /** Gear the current filter admits. Untagged gear stays visible under every
   *  filter: the RF shot and the power that carry an enclave's traffic are
   *  part of that picture even though they belong to no single one. */
  const visibleEquipment = useMemo(() => {
    if (enclaveFilter === "all") return topology.equipment
    return topology.equipment.filter(
      (e) => e.enclave_id === enclaveFilter || e.enclave_id === null,
    )
  }, [topology.equipment, enclaveFilter])

  const visibleIds = useMemo(
    () => new Set(visibleEquipment.map((e) => e.id)),
    [visibleEquipment],
  )

  const utcById = useMemo(
    () => new Map(topology.utc_instances.map((u) => [u.id, u])),
    [topology.utc_instances],
  )
  const positionById = useMemo(
    () => new Map(topology.positions.map((p) => [p.equipment_id, p])),
    [topology.positions],
  )

  const initialNodes = useMemo<Node[]>(() => {
    if (level === "sites") {
      return topology.sites.map((s, i) => ({
        id: `site-${s.site_id}`,
        type: "siteGroup",
        position: { x: 80 + i * 320, y: 120 },
        data: {
          name: s.name,
          utcs: topology.utc_instances.filter((u) => u.site_id === s.site_id),
          equipment: visibleEquipment.filter((e) => e.site_id === s.site_id),
        } satisfies SiteNodeData,
      }))
    }
    // Expanded: lay gear out in a column per site, then let saved positions
    // win so a tidied layout survives a refresh.
    const bySite = new Map<number, Equipment[]>()
    for (const e of visibleEquipment) {
      const list = bySite.get(e.site_id) ?? []
      list.push(e)
      bySite.set(e.site_id, list)
    }
    const siteOrder = topology.sites.map((s) => s.site_id)
    const nodes: Node[] = []
    siteOrder.forEach((siteId, col) => {
      const items = bySite.get(siteId) ?? []
      items.forEach((e, row) => {
        const saved = positionById.get(e.id)
        nodes.push({
          id: `eq-${e.id}`,
          type: "equipment",
          position: saved
            ? { x: saved.x, y: saved.y }
            : { x: 80 + col * 320, y: 80 + row * 150 },
          data: {
            equipment: e,
            utcName: e.utc_instance_id
              ? (utcById.get(e.utc_instance_id)?.name ?? null)
              : null,
            siteName: e.site_name,
            enclave: e.enclave_id ? (enclaveById.get(e.enclave_id) ?? null) : null,
          } satisfies EquipmentNodeData,
        })
      })
    })
    return nodes
  }, [level, topology, visibleEquipment, positionById, utcById, enclaveById])

  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  useEffect(() => setNodes(initialNodes), [initialNodes])

  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const scheduleSave = useCallback((node: Node) => {
    // Only equipment nodes have persisted positions; the collapsed site view
    // is derived layout, not something the operator owns.
    if (!node.id.startsWith("eq-")) return
    const key = node.id
    const existing = saveTimers.current.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(async () => {
      saveTimers.current.delete(key)
      const { x, y } = node.position
      await fetch(`/api/be/topology/positions/${Number(node.id.slice(3))}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      })
    }, SAVE_DELAY_MS)
    saveTimers.current.set(key, timer)
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current)
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

  const edges = useMemo<Edge[]>(() => {
    // A link is only drawable when both ends are on the canvas — otherwise the
    // filter would leave edges hanging off nodes that aren't there.
    const links = topology.links.filter(
      (l) => visibleIds.has(l.a_equipment_id) && visibleIds.has(l.b_equipment_id),
    )
    if (level === "equipment") {
      return links.map((l) =>
        edgeFor(l, `eq-${l.a_equipment_id}`, `eq-${l.b_equipment_id}`),
      )
    }
    // Collapsed: aggregate cross-site links into one edge per site pair per
    // kind, labelled with the count. Same-site links are internal detail and
    // would just clutter the leadership view.
    const grouped = new Map<string, { link: EquipmentLink; count: number }>()
    for (const l of links) {
      if (l.a_site_id == null || l.b_site_id == null) continue
      if (l.a_site_id === l.b_site_id) continue
      const key = `${l.a_site_id}-${l.b_site_id}-${l.kind}`
      const existing = grouped.get(key)
      if (existing) existing.count += 1
      else grouped.set(key, { link: l, count: 1 })
    }
    return Array.from(grouped.values()).map(({ link, count }) =>
      edgeFor(
        link,
        `site-${link.a_site_id}`,
        `site-${link.b_site_id}`,
        count > 1
          ? `${LINK_KIND_LABELS[link.kind]} ×${count}`
          : LINK_KIND_LABELS[link.kind],
      ),
    )
  }, [level, topology.links, visibleIds])

  const crossSite = topology.links.filter(
    (l) => l.a_site_id != null && l.b_site_id != null && l.a_site_id !== l.b_site_id,
  ).length

  return (
    <>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      // Sites aren't linkable — only the gear inside them is.
      nodesConnectable={level === "equipment"}
      nodeTypes={NODE_TYPES}
      fitView={nodes.length > 0}
      fitViewOptions={{ padding: 0.25 }}
      panOnDrag
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      <Controls />
      <Panel position="top-left" className="rounded-md border bg-background/90 px-2 py-1 text-xs">
        {visibleEquipment.length}
        {enclaveFilter !== "all" && ` of ${topology.equipment.length}`} items ·{" "}
        {topology.links.length} links · {crossSite} cross-site
        {level === "equipment" && (
          <span className="ml-2 text-muted-foreground">
            Drag between nodes to link · click a line to edit
          </span>
        )}
      </Panel>
      <Panel position="top-right" className="flex items-center gap-1.5">
        {level === "equipment" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => openCreate(null, null)}
          >
            <Plus className="size-3.5" />
            Add link
          </Button>
        )}
        {enclaves.length > 0 && (
          <select
            aria-label="Filter by enclave"
            value={enclaveFilter}
            onChange={(e) =>
              setEnclaveFilter(
                e.target.value === "all" ? "all" : Number(e.target.value),
              )
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="all">All enclaves</option>
            {enclaves.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </select>
        )}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setLevel(level === "sites" ? "equipment" : "sites")}
        >
          {level === "sites" ? (
            <>
              <Maximize2 className="size-3.5" />
              Expand to equipment
            </>
          ) : (
            <>
              <Minimize2 className="size-3.5" />
              Collapse to sites
            </>
          )}
        </Button>
      </Panel>
    </ReactFlow>
    {/* Picks from the unfiltered set on purpose — you routinely need to link
        to gear the current enclave filter is hiding. */}
    <LinkForm
      key={`${editingLink?.id ?? "new"}-${openSeq}`}
      equipment={topology.equipment}
      open={editorOpen}
      onOpenChange={setEditorOpen}
      link={editingLink}
      defaultA={draftEnds.a}
      defaultB={draftEnds.b}
    />
    </>
  )
}

export function NetworkCanvas({
  topology,
  enclaves = [],
}: {
  topology: NetworkTopology
  enclaves?: Enclave[]
}) {
  if (topology.equipment.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
        No equipment to lay out yet — deploy a UTC first.
      </div>
    )
  }
  return (
    <div className="h-[calc(100vh-220px)] w-full overflow-hidden rounded-lg border border-border">
      <ReactFlowProvider>
        <NetworkCanvasInner topology={topology} enclaves={enclaves} />
      </ReactFlowProvider>
    </div>
  )
}
