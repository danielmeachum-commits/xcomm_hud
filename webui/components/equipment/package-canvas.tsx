"use client"

import "@xyflow/react/dist/style.css"

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
import { UserRound } from "lucide-react"
import { useMemo } from "react"

import { CodeBadge } from "@/components/equipment/code-badge"
import { SkillLevelBadge } from "@/components/personnel/skill-level-badge"
import { enclaveHeadingClass, enclaveHeadingStyle } from "@/lib/enclave-meta"
import {
  ASSET_CATEGORY_ICONS,
  UTC_ROLE_HINT_ICONS,
  UTC_ROLE_HINT_LABELS,
  UTC_ROLE_HINT_VALUES,
  equipmentIcon,
  utcEnclaveColumns,
  utcUsesEnclaves,
} from "@/lib/equipment-meta"
import { manforStrength, peopleLabel, sortedManfor } from "@/lib/manfor-meta"
import type {
  Enclave,
  EquipmentType,
  PackageDef,
  UtcDef,
  UtcDefLine,
  UtcDefManforLine,
  UtcRoleHint,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

// Deliberately the same measurements as `personnel-canvas.tsx`: those two are
// the only tree diagrams in the app, and a reader who has seen one should not
// have to re-learn the second. Separate modules because nothing else is
// shared — that one charts people from a supervisor chain, this one charts a
// catalog definition.
const NODE_WIDTH = 240
const PACKAGE_HEIGHT = 64
const ROLE_HEIGHT = 54
const UTC_HEIGHT = 54
const ENCLAVE_HEIGHT = 30
const POSITION_HEIGHT = 34
const LINE_HEIGHT = 34
const LINE_GAP = 6
/** Gap between a card and the stack beneath it. */
const CARD_TO_STACK = 12
/** A new enclave heading needs more air above it than the next line does —
 *  that gap is what makes the groups read as groups. */
const ENCLAVE_GAP = 18
const LEVEL_GAP = 56
const SIBLING_GAP = 40
const TOP = 20
const LEFT = 40

// slate-500 — reads on both light and dark canvas backgrounds.
const EDGE_STROKE = "#64748b"

function itemsLabel(n: number): string {
  return `${n} item${n === 1 ? "" : "s"}`
}

// ===================== node renderers =====================

interface PackageNodeData extends Record<string, unknown> {
  code: string
  name: string
  utcs: number
  people: number
  items: number
}

function PackageCanvasNode({ data }: NodeProps) {
  const d = data as PackageNodeData
  return (
    <div
      className="flex flex-col justify-center gap-1 rounded-md border-2 border-foreground/60 bg-background px-3 py-2 shadow-sm"
      style={{ width: NODE_WIDTH, height: PACKAGE_HEIGHT }}
    >
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground"
      />
      <div className="flex items-center gap-2">
        <CodeBadge code={d.code} tone="strong" />
        <span className="truncate text-xs font-semibold">{d.name}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">
        {d.utcs} UTC{d.utcs === 1 ? "" : "s"} · {peopleLabel(d.people)} ·{" "}
        {itemsLabel(d.items)}
      </div>
    </div>
  )
}

interface RoleNodeData extends Record<string, unknown> {
  role: UtcRoleHint
  count: number
}

/** Role is a heading, not a badge on a UTC — the same call the read view
 *  makes. It is the one thing every UTC beneath it shares. */
function RoleCanvasNode({ data }: NodeProps) {
  const d = data as RoleNodeData
  const Icon = UTC_ROLE_HINT_ICONS[d.role]
  return (
    <div
      className="flex flex-col justify-center gap-1 rounded-md border bg-background/70 px-3 py-2 shadow-sm"
      style={{ width: NODE_WIDTH, height: ROLE_HEIGHT }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground"
      />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate text-xs font-semibold uppercase tracking-widest">
          {UTC_ROLE_HINT_LABELS[d.role]}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground/80">
        {d.count} UTC{d.count === 1 ? "" : "s"}
      </div>
    </div>
  )
}

interface UtcNodeData extends Record<string, unknown> {
  code: string
  name: string
  /** Null when the package points at a definition this page wasn't handed. */
  category: UtcDef["category"] | null
  href: string | null
  people: number
  items: number
}

function UtcCanvasNode({ data }: NodeProps) {
  const d = data as UtcNodeData
  const CategoryIcon = d.category ? ASSET_CATEGORY_ICONS[d.category] : null
  return (
    <div
      className="flex flex-col justify-center gap-1 rounded-md border-2 border-border bg-muted/40 px-3 py-2 shadow-sm"
      style={{ width: NODE_WIDTH, height: UTC_HEIGHT }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground"
      />
      <div className="flex items-center gap-2">
        <CodeBadge code={d.code} />
        {d.href ? (
          <a
            href={d.href}
            onClick={(e) => e.stopPropagation()}
            onPointerDownCapture={(e) => e.stopPropagation()}
            className="nodrag min-w-0 flex-1 truncate text-xs font-medium hover:underline"
            title={d.name}
          >
            {d.name}
          </a>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {d.name}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {CategoryIcon && <CategoryIcon className="size-3 shrink-0" />}
        <span>
          {d.people === 0 && d.items === 0
            ? "Empty"
            : [
                d.people > 0 ? peopleLabel(d.people) : null,
                d.items > 0 ? itemsLabel(d.items) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
      </div>
    </div>
  )
}

interface EnclaveNodeData extends Record<string, unknown> {
  /** Null is the Common group — lines the UTC ties to no enclave. */
  enclave: Enclave | null
  items: number
}

/** The enclave's hue as text over a rule, with no fill or border box — the
 *  same call `ColumnHeading` makes on the bill of materials. A chip is a label
 *  attached to a thing; every group wearing one turns the chart into a field
 *  of pills. */
function EnclaveCanvasNode({ data }: NodeProps) {
  const d = data as EnclaveNodeData
  return (
    <div
      className="flex items-baseline gap-2 border-b px-1 pb-1.5"
      style={{
        width: NODE_WIDTH,
        height: ENCLAVE_HEIGHT,
        ...(d.enclave?.color ? { borderColor: d.enclave.color } : {}),
      }}
    >
      <span
        className={cn(
          "truncate text-xs font-semibold",
          d.enclave
            ? enclaveHeadingClass(d.enclave.color)
            : "text-muted-foreground",
        )}
        style={d.enclave ? enclaveHeadingStyle(d.enclave.color) : undefined}
      >
        {d.enclave ? d.enclave.name : "Common"}
      </span>
      <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {itemsLabel(d.items)}
      </span>
    </div>
  )
}

interface GroupNodeData extends Record<string, unknown> {
  label: string
  count: string
}

/** A heading over a stack, in the neutral case. Same shape as the enclave
 *  heading next door, which earns a hue because an enclave has one; MANFOR
 *  does not, and inventing a color for it would say something untrue. */
function GroupCanvasNode({ data }: NodeProps) {
  const d = data as GroupNodeData
  return (
    <div
      className="flex items-baseline gap-2 border-b border-border px-1 pb-1.5"
      style={{ width: NODE_WIDTH, height: ENCLAVE_HEIGHT }}
    >
      <span className="truncate text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {d.label}
      </span>
      <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {d.count}
      </span>
    </div>
  )
}

interface PositionNodeData extends Record<string, unknown> {
  position: UtcDefManforLine
}

function PositionCanvasNode({ data }: NodeProps) {
  const { position } = data as PositionNodeData
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border/70 bg-background pr-2.5 pl-2 shadow-sm"
      style={{ width: NODE_WIDTH, height: POSITION_HEIGHT }}
    >
      {position.skill_level != null ? (
        <SkillLevelBadge level={position.skill_level} />
      ) : (
        <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span
        className="min-w-0 flex-1 truncate text-xs font-medium"
        title={position.work_center}
      >
        {position.work_center}
      </span>
      {position.quantity > 1 && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          ×{position.quantity}
        </span>
      )}
    </div>
  )
}

interface LineNodeData extends Record<string, unknown> {
  line: UtcDefLine
  type: EquipmentType | undefined
  href: string
}

function LineCanvasNode({ data }: NodeProps) {
  const { line, type, href } = data as LineNodeData
  const Icon = equipmentIcon(type?.subcategory ?? null)
  const title = line.equipment_type_title ?? "Unknown equipment type"
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border/70 bg-background pr-2.5 pl-2 shadow-sm"
      style={{ width: NODE_WIDTH, height: LINE_HEIGHT }}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <a
        href={href}
        onClick={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        className="nodrag min-w-0 flex-1 truncate text-xs hover:underline"
        title={title}
      >
        {title}
      </a>
      {line.equipment_type_short_name && (
        <span className="shrink-0 rounded border border-border bg-muted/60 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          {line.equipment_type_short_name}
        </span>
      )}
      {/* A quantity of one prints nothing: it's the default, and "×1" is a
          number to decode rather than a fact to read. Same rule as the bill of
          materials, so a line reads identically in both places. */}
      {line.quantity > 1 && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          ×{line.quantity}
        </span>
      )}
    </div>
  )
}

const NODE_TYPES = {
  pkg: PackageCanvasNode,
  role: RoleCanvasNode,
  utc: UtcCanvasNode,
  group: GroupCanvasNode,
  enclave: EnclaveCanvasNode,
  position: PositionCanvasNode,
  line: LineCanvasNode,
}

// ===================== the tree, before it is a graph =====================

/** One item in the column that hangs under a card: an enclave heading, or a
 *  piece of gear under it. */
interface StackItem {
  key: string
  type: "group" | "enclave" | "position" | "line"
  height: number
  /** Air above this item. A new enclave group needs more of it than the next
   *  line does. */
  gapAbove: number
  data: Record<string, unknown>
}

/** One card in the tree, plus the column stacked beneath it.
 *
 *  Built first, laid out second: measuring a subtree needs the whole shape,
 *  and the shape is far easier to read as a tree than as a node list. */
interface Col {
  id: string
  type: "pkg" | "role" | "utc"
  height: number
  data: Record<string, unknown>
  /** What a UTC brings, as a column rather than a fourth and fifth branching
   *  level. Branching here was the honest tree and unreadable with it: one
   *  240px column per enclave per copy of every UTC ran the chart past 3000px
   *  wide, which `fitView` then shrank to unreadable. Stacked, a UTC's
   *  contents read exactly like its bill of materials — enclave heading over
   *  its gear — and the chart branches only where the package does. */
  stack: StackItem[]
  children: Col[]
}

/** `[0, 1, … n-1]`, and never empty — a stored quantity of zero must not make
 *  a membership row vanish. Mirrors `repeat` on the package detail page. */
function repeat(n: number): number[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => i)
}

function totalItems(lines: UtcDefLine[]): number {
  return lines.reduce((a, l) => a + l.quantity, 0)
}

function buildTree(
  def: PackageDef,
  utcById: Map<number, UtcDef>,
  enclaves: Enclave[],
  typeById: Map<number, EquipmentType>,
  typeHref: (id: number) => string,
  utcHref: (id: number) => string,
): Col {
  const links = [...def.utcs].sort((a, b) => a.display_order - b.display_order)

  /** Stack rows for one copy of one UTC. Keys are scoped by the copy — the
   *  same definition can appear twice in a package, and node ids have to stay
   *  unique. */
  const lineItems = (scope: string, lines: UtcDefLine[]): StackItem[] =>
    lines.map((line) => ({
      key: `${scope}-line-${line.id}`,
      type: "line" as const,
      height: LINE_HEIGHT,
      gapAbove: LINE_GAP,
      data: {
        line,
        type: typeById.get(line.equipment_type_id),
        href: typeHref(line.equipment_type_id),
      } satisfies LineNodeData,
    }))

  let utcCount = 0
  let peopleCount = 0
  let itemCount = 0

  const roleCols: Col[] = []
  for (const role of UTC_ROLE_HINT_VALUES) {
    const inRole = links.filter((l) => l.role_hint === role)
    if (inRole.length === 0) continue

    const utcCols: Col[] = []
    for (const link of inRole) {
      const utc = utcById.get(link.utc_def_id) ?? null
      const lines = utc
        ? [...utc.lines].sort((a, b) => a.display_order - b.display_order)
        : []
      const items = totalItems(lines)
      const strength = utc ? manforStrength(utc.manfor) : 0
      // Two of a UTC is two nodes, not one wearing a count — the package
      // detail page makes the same call, and a package reads as the list of
      // things it puts on the ground.
      for (const copy of repeat(link.quantity)) {
        const scope = `utc-${link.id}-${copy}`
        utcCount += 1
        itemCount += items
        peopleCount += strength

        // Only a comm UTC divides by enclave; everything else gets one plain
        // list. See `utcUsesEnclaves`.
        const groups =
          utc && utcUsesEnclaves(utc.category)
            ? utcEnclaveColumns(utc, enclaves)
            : []
        const logdet =
          groups.length > 0
            ? groups.flatMap((g) => [
                {
                  key: `${scope}-enc-${g.enclave?.id ?? "common"}`,
                  type: "enclave" as const,
                  height: ENCLAVE_HEIGHT,
                  gapAbove: ENCLAVE_GAP,
                  data: {
                    enclave: g.enclave,
                    items: totalItems(g.lines),
                  } satisfies EnclaveNodeData,
                },
                ...lineItems(`${scope}-${g.enclave?.id ?? "common"}`, g.lines),
              ])
            : lineItems(scope, lines)

        // Both halves MEFPAK registers the UTC as, in the order it names
        // them: who deploys with it, then what they take. A LOGDET drawn
        // without its MANFOR is a pile of gear arriving with nobody to set it
        // up, which is exactly the thing this chart is for spotting.
        const positions = utc ? sortedManfor(utc.manfor) : []
        const manfor: StackItem[] =
          positions.length === 0
            ? []
            : [
                {
                  key: `${scope}-manfor`,
                  type: "group" as const,
                  height: ENCLAVE_HEIGHT,
                  gapAbove: ENCLAVE_GAP,
                  data: {
                    label: "MANFOR",
                    count: peopleLabel(manforStrength(positions)),
                  } satisfies GroupNodeData,
                },
                ...positions.map((position) => ({
                  key: `${scope}-pos-${position.id}`,
                  type: "position" as const,
                  height: POSITION_HEIGHT,
                  gapAbove: LINE_GAP,
                  data: { position } satisfies PositionNodeData,
                })),
              ]

        // The LOGDET gets its own heading only when the MANFOR is above it —
        // on its own it needs no label, because the whole stack is it.
        const logdetHeading: StackItem[] =
          manfor.length > 0 && logdet.length > 0
            ? [
                {
                  key: `${scope}-logdet`,
                  type: "group" as const,
                  height: ENCLAVE_HEIGHT,
                  gapAbove: ENCLAVE_GAP,
                  data: {
                    label: "LOGDET",
                    count: itemsLabel(items),
                  } satisfies GroupNodeData,
                },
              ]
            : []
        const stack = [...manfor, ...logdetHeading, ...logdet]

        utcCols.push({
          id: scope,
          type: "utc",
          height: UTC_HEIGHT,
          data: {
            code: utc?.code ?? link.utc_def_code ?? "—",
            name: utc?.name ?? link.utc_def_name ?? "Unknown UTC",
            category: utc?.category ?? null,
            href: utc ? utcHref(utc.id) : null,
            people: strength,
            items,
          } satisfies UtcNodeData,
          stack,
          children: [],
        })
      }
    }

    roleCols.push({
      id: `role-${role}`,
      type: "role",
      height: ROLE_HEIGHT,
      data: { role, count: utcCols.length } satisfies RoleNodeData,
      stack: [],
      children: utcCols,
    })
  }

  return {
    id: `pkg-${def.id}`,
    type: "pkg",
    height: PACKAGE_HEIGHT,
    data: {
      code: def.code,
      name: def.name,
      utcs: utcCount,
      people: peopleCount,
      items: itemCount,
    } satisfies PackageNodeData,
    stack: [],
    children: roleCols,
  }
}

// ===================== tree → nodes and edges =====================

/** How tall a column stands: its own card plus everything stacked under it. */
function columnHeight(col: Col): number {
  if (col.stack.length === 0) return col.height
  return (
    col.height +
    CARD_TO_STACK +
    col.stack.reduce((h, item, i) => h + item.height + (i === 0 ? 0 : item.gapAbove), 0)
  )
}

function layout(root: Col): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Subtree width — a card is centered over its children.
  const widths = new Map<string, number>()
  function measure(col: Col): number {
    const kidsWidth =
      col.children.reduce((acc, k) => acc + measure(k), 0) +
      Math.max(0, col.children.length - 1) * SIBLING_GAP
    const w = Math.max(NODE_WIDTH, kidsWidth)
    widths.set(col.id, w)
    return w
  }
  measure(root)

  // Levels align across the chart: each depth starts below the tallest column
  // — card plus stack — of the depth above it.
  const levelHeights: number[] = []
  function scanDepth(col: Col, depth: number) {
    levelHeights[depth] = Math.max(levelHeights[depth] ?? 0, columnHeight(col))
    for (const k of col.children) scanDepth(k, depth + 1)
  }
  scanDepth(root, 0)
  const levelY: number[] = []
  {
    let y = TOP
    for (let d = 0; d < levelHeights.length; d++) {
      levelY[d] = y
      y += levelHeights[d] + LEVEL_GAP
    }
  }

  function place(col: Col, x: number, depth: number) {
    const cx = x + widths.get(col.id)! / 2 - NODE_WIDTH / 2
    nodes.push({
      id: col.id,
      type: col.type,
      position: { x: cx, y: levelY[depth] },
      data: col.data,
      draggable: false,
    })
    let y = levelY[depth] + col.height + CARD_TO_STACK
    col.stack.forEach((item, i) => {
      if (i > 0) y += item.gapAbove
      nodes.push({
        id: item.key,
        type: item.type,
        position: { x: cx, y },
        data: item.data,
        draggable: false,
        selectable: false,
      })
      y += item.height
    })
    let kx = x
    for (const k of col.children) {
      edges.push({
        id: `e-${col.id}-${k.id}`,
        source: col.id,
        target: k.id,
        type: "smoothstep",
        style: { stroke: EDGE_STROKE, strokeWidth: 1.5, opacity: 0.6 },
      })
      place(k, kx, depth + 1)
      kx += widths.get(k.id)! + SIBLING_GAP
    }
  }
  place(root, LEFT, 0)

  return { nodes, edges }
}

// ===================== the canvas =====================

function PackageCanvasInner({
  def,
  utcDefs,
  enclaves,
  types,
}: {
  def: PackageDef
  utcDefs: UtcDef[]
  enclaves: Enclave[]
  types: EquipmentType[]
}) {
  const { w } = useWorkspace()
  const { nodes, edges } = useMemo(() => {
    const utcById = new Map(utcDefs.map((d) => [d.id, d]))
    const typeById = new Map(types.map((t) => [t.id, t]))
    return layout(
      buildTree(
        def,
        utcById,
        enclaves,
        typeById,
        (id) => w(`/admin/equipment-types/${id}`),
        (id) => w(`/admin/utcs/${id}`),
      ),
    )
  }, [def, utcDefs, enclaves, types, w])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.1 }}
      minZoom={0.1}
      nodesDraggable={false}
      panOnDrag
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

/**
 * The shape of a package definition, drawn: the package, the roles it fills,
 * the UTCs in each role, and beneath each UTC the gear it brings, grouped by
 * the enclave it serves.
 *
 * Read-only and derived, so nothing is draggable or persisted. Sibling of
 * `personnel-canvas.tsx`, which charts people the same way.
 */
export function PackageCanvas({
  def,
  utcDefs,
  enclaves,
  types,
  className,
}: {
  def: PackageDef
  /** The UTC catalog — a membership row carries only an id, and the chart
   *  needs the definition's lines to draw anything below the UTC. */
  utcDefs: UtcDef[]
  /** Names and colors the enclave groups. */
  enclaves: Enclave[]
  /** Only for the icon on a piece of gear: a line knows its type's title but
   *  not what kind of box it is. */
  types: EquipmentType[]
  className?: string
}) {
  if (def.utcs.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        No UTCs — this package definition is empty.
      </div>
    )
  }
  return (
    <div
      className={cn(
        "h-[620px] w-full overflow-hidden rounded-lg border border-border",
        className,
      )}
    >
      <ReactFlowProvider>
        <PackageCanvasInner
          def={def}
          utcDefs={utcDefs}
          enclaves={enclaves}
          types={types}
        />
      </ReactFlowProvider>
    </div>
  )
}
