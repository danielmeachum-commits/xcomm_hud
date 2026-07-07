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
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react"
import { Settings2 } from "lucide-react"

import { PersonnelStatusPill } from "@/components/personnel/personnel-status-pill"
import { RankInsignia } from "@/components/personnel/rank-insignia"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { branchColor, rankGrade, rankSeniority } from "@/lib/personnel-data"
import type { PersonnelGroup } from "@/lib/personnel-grouping"
import type { Personnel, Site, Team, Unit, WorkCenter } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

const NODE_WIDTH = 240
const LANE_GAP = 60
// Extra space parking the "No …" catch-all lane visually off to the side.
const UNGROUPED_GAP = 160
const HEADER_HEIGHT = 54
const HEADER_TO_PEOPLE = 14
const PERSON_HEIGHT = 38
const PERSON_GAP = 8
const TOP = 20
const UNIT_HEIGHT = 54
const LEVEL_GAP = 56
const TREE_SIBLING_GAP = 40
// Per-tier indent when supervisor tiers are on; capped so deep chains don't
// walk out of the lane.
const TIER_INDENT = 18
const TIER_MAX = 4

// slate-500 — reads on both light and dark canvas backgrounds.
const EDGE_STROKE = "#64748b"

interface PersonNodeData extends Record<string, unknown> {
  person: Personnel
  href: string
  width?: number
  sites: Site[]
  canEdit: boolean
  /** Role chip, e.g. "NCOIC" or "Lead". */
  badge?: string
  /** Faded — outside the highlighted subset (e.g. not part of this site). */
  dimmed?: boolean
}

function PersonCanvasNode({ data }: NodeProps) {
  const { person, href, width, sites, canEdit, badge, dimmed } =
    data as PersonNodeData
  const accent = branchColor(person.branch, person.personnel_type)
  const rankLabel =
    person.rank || (person.personnel_type === "civilian" ? "Civ" : "")
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border/70 bg-background pr-2.5 pl-2 shadow-sm",
        dimmed && "opacity-40",
      )}
      style={{
        width: width ?? NODE_WIDTH,
        height: PERSON_HEIGHT,
        // Branch color rides on a slim accent bar — the card itself stays
        // neutral so the canvas reads calm at a glance.
        borderLeftWidth: 3,
        borderLeftColor: accent,
      }}
    >
      {/* Invisible anchors. Left pair carries the bracket lines beside a
          stack; top/bottom carry org-tree branch edges. Left handles are
          declared first so edges without an explicit handle keep using them. */}
      <Handle
        id="lt"
        type="target"
        position={Position.Left}
        className="!pointer-events-none !opacity-0"
      />
      <Handle
        id="ls"
        type="source"
        position={Position.Left}
        className="!pointer-events-none !opacity-0"
      />
      <Handle
        id="tt"
        type="target"
        position={Position.Top}
        className="!pointer-events-none !opacity-0"
      />
      <Handle
        id="bs"
        type="source"
        position={Position.Bottom}
        className="!pointer-events-none !opacity-0"
      />
      <RankInsignia
        branch={person.branch}
        personnelType={person.personnel_type}
        rank={person.rank}
        size={18}
        className="shrink-0"
      />
      <a
        href={href}
        onClick={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        className="nodrag min-w-0 flex-1 truncate text-xs font-medium hover:underline"
        title={`${rankLabel} ${person.last_name}, ${person.first_name}`.trim()}
      >
        {rankLabel && (
          <span className="font-normal text-muted-foreground">
            {rankLabel}{" "}
          </span>
        )}
        {person.last_name}, {person.first_name}
      </a>
      {badge && (
        <span className="shrink-0 rounded border border-border bg-muted/60 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          {badge}
        </span>
      )}
      <span
        className="nodrag shrink-0"
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        <PersonnelStatusPill
          person={person}
          sites={sites}
          canEdit={canEdit}
          variant="dot"
        />
      </span>
    </div>
  )
}

interface GroupHeaderData extends Record<string, unknown> {
  label: string
  count: number
  color: string | null
  ungrouped?: boolean
}

function peopleCount(n: number): string {
  return n === 1 ? "1 person" : `${n} people`
}

function GroupHeaderNode({ data }: NodeProps) {
  const d = data as GroupHeaderData
  return (
    <div
      className={cn(
        "rounded-md border bg-background/70 px-3 py-2 shadow-sm",
        d.ungrouped && "border-dashed",
      )}
      style={{
        width: NODE_WIDTH,
        height: HEADER_HEIGHT,
        ...(d.color ? { borderColor: d.color } : {}),
      }}
    >
      <div className="truncate text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {d.label}
      </div>
      <div className="text-[10px] text-muted-foreground/80">
        {peopleCount(d.count)}
      </div>
    </div>
  )
}

interface UnitNodeData extends Record<string, unknown> {
  label: string
  count: number
  /** Small prefix chip, e.g. a team slug ("FCP1"). */
  tag?: string | null
  /** Accent border (team color); null keeps the neutral border. */
  color?: string | null
  /** Dashed border for catch-all buckets ("No work center"). */
  dashed?: boolean
}

function UnitCanvasNode({ data }: NodeProps) {
  const d = data as UnitNodeData
  return (
    <div
      className={cn(
        "rounded-md border-2 border-border bg-muted/40 px-3 py-2 shadow-sm",
        d.dashed && "border-dashed bg-background/70",
      )}
      style={{
        width: NODE_WIDTH,
        height: UNIT_HEIGHT,
        ...(d.color ? { borderColor: d.color } : {}),
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
      <div className="flex items-center gap-1.5">
        {d.tag && (
          <span
            className="shrink-0 rounded border border-border px-1 py-px text-[9px] font-bold tracking-wide"
            style={d.color ? { borderColor: d.color, color: d.color } : {}}
          >
            {d.tag}
          </span>
        )}
        <span className="truncate text-xs font-semibold uppercase tracking-widest">
          {d.label}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground">
        {peopleCount(d.count)}
      </div>
    </div>
  )
}

const NODE_TYPES = {
  groupHeader: GroupHeaderNode,
  person: PersonCanvasNode,
  unit: UnitCanvasNode,
}

type Props = {
  /** Appended to person links so the detail page breadcrumbs back here. */
  linkFrom?: { path: string; label: string }
  /** For the status dot's location popover/dialog. */
  sites: Site[]
  canEdit: boolean
  /** Merged onto the outer frame — e.g. "h-full" to fill a sheet. */
  className?: string
} & (
  | { mode: "lanes"; groups: PersonnelGroup[] }
  | { mode: "unit-tree"; units: Unit[]; people: Personnel[] }
  | {
      mode: "org-tree"
      people: Personnel[]
      /** When set, people outside this set render faded. */
      highlightIds?: ReadonlySet<number>
    }
  | {
      mode: "team-tree"
      teams: Team[]
      workCenters: WorkCenter[]
      people: Personnel[]
    }
)

/** Per-node context threaded to every person card. */
interface PersonCtx {
  sites: Site[]
  canEdit: boolean
  href: (p: Personnel) => string
  /** Fades cards outside a highlighted subset. */
  dim?: (p: Personnel) => boolean
}

function personNode(
  person: Personnel,
  x: number,
  y: number,
  scope: string,
  ctx: PersonCtx,
  depth = 0,
  badge?: string,
): Node {
  const indent = Math.min(depth, TIER_MAX) * TIER_INDENT
  return {
    // Scoped id — with team grouping the same person appears in every team
    // lane they belong to, and node ids must stay unique.
    id: `person-${scope}-${person.id}`,
    type: "person",
    position: { x: x + indent, y },
    // Width shrinks with the indent so the stack's right edge stays aligned
    // and nesting reads like a tree list.
    data: {
      person,
      href: ctx.href(person),
      width: NODE_WIDTH - indent,
      sites: ctx.sites,
      canEdit: ctx.canEdit,
      badge,
      dimmed: ctx.dim?.(person) ?? false,
    },
    draggable: false,
  }
}

interface TieredPerson {
  person: Personnel
  depth: number
}

/** Most senior rank first; ties break alphabetically so order is stable. */
function bySeniority(a: Personnel, b: Personnel): number {
  const diff =
    rankSeniority(b.personnel_type, b.branch, b.rank) -
    rankSeniority(a.personnel_type, a.branch, a.rank)
  if (diff !== 0) return diff
  return a.last_name.localeCompare(b.last_name)
}

/**
 * Order a group's people by chain of command: anyone whose supervisor is
 * outside the group anchors a tier-0 chain, with reports nested beneath.
 * Roots and sibling reports are ordered most-senior-rank first; with tiers
 * off the whole stack is flat (depth 0) in seniority order. A supervisor
 * cycle (blocked by the API, guarded anyway) leaves people unvisited —
 * they're appended flat rather than dropped.
 */
function tierPeople(people: Personnel[], tiers: boolean): TieredPerson[] {
  const ranked = [...people].sort(bySeniority)
  if (!tiers) return ranked.map((person) => ({ person, depth: 0 }))
  const ids = new Set(people.map((p) => p.id))
  const reports = new Map<number, Personnel[]>()
  const roots: Personnel[] = []
  for (const p of ranked) {
    if (
      p.supervisor_id != null &&
      p.supervisor_id !== p.id &&
      ids.has(p.supervisor_id)
    ) {
      const list = reports.get(p.supervisor_id) ?? []
      list.push(p)
      reports.set(p.supervisor_id, list)
    } else {
      roots.push(p)
    }
  }
  const out: TieredPerson[] = []
  const visited = new Set<number>()
  function walk(p: Personnel, depth: number) {
    if (visited.has(p.id)) return
    visited.add(p.id)
    out.push({ person: p, depth })
    for (const r of reports.get(p.id) ?? []) walk(r, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  for (const p of ranked) if (!visited.has(p.id)) walk(p, 0)
  return out
}

/**
 * Supervisor → report edges within one stack. Drawn only when tiers are on —
 * flat roster order would make the lines zigzag. Both handles sit on the left
 * edge, so smoothstep routes each edge as a bracket alongside the stack.
 */
function supervisorEdges(
  people: Personnel[],
  scope: string,
  tiers: boolean,
): Edge[] {
  if (!tiers) return []
  const ids = new Set(people.map((p) => p.id))
  const edges: Edge[] = []
  for (const p of people) {
    if (
      p.supervisor_id != null &&
      p.supervisor_id !== p.id &&
      ids.has(p.supervisor_id)
    ) {
      edges.push({
        id: `e-sup-${scope}-${p.supervisor_id}-${p.id}`,
        source: `person-${scope}-${p.supervisor_id}`,
        sourceHandle: "ls",
        target: `person-${scope}-${p.id}`,
        targetHandle: "lt",
        type: "smoothstep",
        style: { stroke: EDGE_STROKE, strokeWidth: 1.25, opacity: 0.55 },
      })
    }
  }
  return edges
}

function buildLanes(
  groups: PersonnelGroup[],
  ctx: PersonCtx,
  tiers: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  let x = 40
  groups.forEach((g, i) => {
    if (g.ungrouped && i > 0) x += UNGROUPED_GAP - LANE_GAP
    nodes.push({
      id: `group-${g.key}`,
      type: "groupHeader",
      position: { x, y: TOP },
      data: { label: g.label, count: g.people.length, color: g.color, ungrouped: g.ungrouped },
      draggable: false,
      selectable: false,
    })
    let y = TOP + HEADER_HEIGHT + HEADER_TO_PEOPLE
    for (const { person, depth } of tierPeople(g.people, tiers)) {
      nodes.push(personNode(person, x, y, g.key, ctx, depth))
      y += PERSON_HEIGHT + PERSON_GAP
    }
    edges.push(...supervisorEdges(g.people, g.key, tiers))
    x += NODE_WIDTH + LANE_GAP
  })
  return { nodes, edges }
}

function buildUnitTree(
  units: Unit[],
  people: Personnel[],
  ctx: PersonCtx,
  tiers: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const unitById = new Map(units.map((u) => [u.id, u]))
  const childrenOf = new Map<number | null, Unit[]>()
  for (const u of [...units].sort((a, b) => a.name.localeCompare(b.name))) {
    // A unit pointing at a missing parent (shouldn't happen) surfaces as a root.
    const parent =
      u.parent_unit_id != null && unitById.has(u.parent_unit_id)
        ? u.parent_unit_id
        : null
    const list = childrenOf.get(parent) ?? []
    list.push(u)
    childrenOf.set(parent, list)
  }

  const peopleByUnit = new Map<number, Personnel[]>()
  const noUnit: Personnel[] = []
  for (const p of people) {
    if (p.unit_id != null && unitById.has(p.unit_id)) {
      const list = peopleByUnit.get(p.unit_id) ?? []
      list.push(p)
      peopleByUnit.set(p.unit_id, list)
    } else {
      noUnit.push(p)
    }
  }

  // Prune units whose whole subtree is empty — org scaffolding with nobody in
  // it is noise in a personnel view. The pre-seeded false doubles as a cycle
  // guard (the API validates against cycles; this keeps render safe anyway).
  const hasPeople = new Map<number, boolean>()
  function subtreeHasPeople(u: Unit): boolean {
    if (hasPeople.has(u.id)) return hasPeople.get(u.id)!
    hasPeople.set(u.id, false)
    const own = (peopleByUnit.get(u.id) ?? []).length > 0
    const result = own || (childrenOf.get(u.id) ?? []).some(subtreeHasPeople)
    hasPeople.set(u.id, result)
    return result
  }
  const visibleChildren = (u: Unit) =>
    (childrenOf.get(u.id) ?? []).filter(subtreeHasPeople)
  const roots = (childrenOf.get(null) ?? []).filter(subtreeHasPeople)

  // Subtree width — a unit column is centered over its visible children.
  const widths = new Map<number, number>()
  function measure(u: Unit): number {
    const kids = visibleChildren(u)
    const kidsWidth =
      kids.reduce((acc, k) => acc + measure(k), 0) +
      Math.max(0, kids.length - 1) * TREE_SIBLING_GAP
    const w = Math.max(NODE_WIDTH, kidsWidth)
    widths.set(u.id, w)
    return w
  }

  // Levels align across the tree: each depth starts below the tallest column
  // (unit node + its stacked people) of the previous depth.
  function columnHeight(u: Unit): number {
    const n = (peopleByUnit.get(u.id) ?? []).length
    return (
      UNIT_HEIGHT +
      (n > 0 ? HEADER_TO_PEOPLE + n * (PERSON_HEIGHT + PERSON_GAP) - PERSON_GAP : 0)
    )
  }
  const levelHeights: number[] = []
  function scanDepth(u: Unit, depth: number) {
    levelHeights[depth] = Math.max(levelHeights[depth] ?? 0, columnHeight(u))
    for (const k of visibleChildren(u)) scanDepth(k, depth + 1)
  }
  roots.forEach((r) => scanDepth(r, 0))
  const levelY: number[] = []
  {
    let y = TOP
    for (let d = 0; d < levelHeights.length; d++) {
      levelY[d] = y
      y += levelHeights[d] + LEVEL_GAP
    }
  }

  const nodes: Node[] = []
  const edges: Edge[] = []
  function place(u: Unit, x: number, depth: number) {
    const ux = x + widths.get(u.id)! / 2 - NODE_WIDTH / 2
    nodes.push({
      id: `unit-${u.id}`,
      type: "unit",
      position: { x: ux, y: levelY[depth] },
      data: { label: u.name, count: (peopleByUnit.get(u.id) ?? []).length },
      draggable: false,
    })
    let py = levelY[depth] + UNIT_HEIGHT + HEADER_TO_PEOPLE
    const unitPeople = peopleByUnit.get(u.id) ?? []
    for (const { person, depth: tier } of tierPeople(unitPeople, tiers)) {
      nodes.push(personNode(person, ux, py, `u${u.id}`, ctx, tier))
      py += PERSON_HEIGHT + PERSON_GAP
    }
    edges.push(...supervisorEdges(unitPeople, `u${u.id}`, tiers))
    let cx = x
    for (const k of visibleChildren(u)) {
      edges.push({
        id: `e-unit-${u.id}-${k.id}`,
        source: `unit-${u.id}`,
        target: `unit-${k.id}`,
        type: "smoothstep",
        style: { stroke: EDGE_STROKE, strokeWidth: 1.5, opacity: 0.6 },
      })
      place(k, cx, depth + 1)
      cx += widths.get(k.id)! + TREE_SIBLING_GAP
    }
  }
  let x = 40
  for (const r of roots) {
    measure(r)
    place(r, x, 0)
    x += widths.get(r.id)! + TREE_SIBLING_GAP
  }

  // People with no unit park in their own lane off to the side of the tree.
  if (noUnit.length > 0) {
    const nx = x + (roots.length > 0 ? UNGROUPED_GAP - TREE_SIBLING_GAP : 0)
    nodes.push({
      id: "group-no-unit",
      type: "groupHeader",
      position: { x: nx, y: TOP },
      data: { label: "No unit", count: noUnit.length, color: null, ungrouped: true },
      draggable: false,
      selectable: false,
    })
    let y = TOP + HEADER_HEIGHT + HEADER_TO_PEOPLE
    for (const { person, depth } of tierPeople(noUnit, tiers)) {
      nodes.push(personNode(person, nx, y, "no-unit", ctx, depth))
      y += PERSON_HEIGHT + PERSON_GAP
    }
    edges.push(...supervisorEdges(noUnit, "no-unit", tiers))
  }

  return { nodes, edges }
}

/**
 * Traditional org chart from the supervisor chain. Anyone who supervises
 * others is a branching node; their reports who supervise nobody stack
 * directly beneath their card (one indent tier + bracket lines), while
 * reports who are themselves supervisors branch out horizontally below.
 *
 * Officers (and warrant officers) chart in their own section beside the
 * enlisted force — everyone formally rolls up under the commander, but the
 * chart reads better split by tier. Supervisor links that cross the split
 * simply make the report a root of its own section.
 */
function buildOrgTree(
  people: Personnel[],
  ctx: PersonCtx,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Lays out one supervisor forest starting at (xStart, top); returns the x
  // just past the forest (including one trailing sibling gap).
  function layoutForest(
    sectionPeople: Personnel[],
    xStart: number,
    top: number,
  ): number {
    const ranked = [...sectionPeople].sort(bySeniority)
    const ids = new Set(sectionPeople.map((p) => p.id))
    const reports = new Map<number, Personnel[]>()
    const roots: Personnel[] = []
    for (const p of ranked) {
      if (
        p.supervisor_id != null &&
        p.supervisor_id !== p.id &&
        ids.has(p.supervisor_id)
      ) {
        const list = reports.get(p.supervisor_id) ?? []
        list.push(p)
        reports.set(p.supervisor_id, list)
      } else {
        roots.push(p)
      }
    }
    // A supervisor cycle (blocked by the API, guarded anyway) leaves people
    // unreachable from any root — promote one per cycle so nobody is dropped.
    const reachable = new Set<number>()
    function markReachable(p: Personnel) {
      if (reachable.has(p.id)) return
      reachable.add(p.id)
      for (const r of reports.get(p.id) ?? []) markReachable(r)
    }
    roots.forEach(markReachable)
    for (const p of ranked) {
      if (!reachable.has(p.id)) {
        roots.push(p)
        markReachable(p)
      }
    }

    const isBranch = (p: Personnel) => (reports.get(p.id) ?? []).length > 0
    const leavesOf = (p: Personnel) =>
      (reports.get(p.id) ?? []).filter((r) => !isBranch(r))
    const branchesOf = (p: Personnel) =>
      (reports.get(p.id) ?? []).filter(isBranch)

    const widths = new Map<number, number>()
    function measure(p: Personnel): number {
      const kids = branchesOf(p)
      const kidsWidth =
        kids.reduce((acc, k) => acc + measure(k), 0) +
        Math.max(0, kids.length - 1) * TREE_SIBLING_GAP
      const w = Math.max(NODE_WIDTH, kidsWidth)
      widths.set(p.id, w)
      return w
    }

    function columnHeight(p: Personnel): number {
      const n = leavesOf(p).length
      return (
        PERSON_HEIGHT +
        (n > 0
          ? HEADER_TO_PEOPLE + n * (PERSON_HEIGHT + PERSON_GAP) - PERSON_GAP
          : 0)
      )
    }
    const levelHeights: number[] = []
    function scanDepth(p: Personnel, depth: number) {
      levelHeights[depth] = Math.max(levelHeights[depth] ?? 0, columnHeight(p))
      for (const k of branchesOf(p)) scanDepth(k, depth + 1)
    }
    roots.forEach((r) => scanDepth(r, 0))
    const levelY: number[] = []
    {
      let y = top
      for (let d = 0; d < levelHeights.length; d++) {
        levelY[d] = y
        y += levelHeights[d] + LEVEL_GAP
      }
    }

    function place(p: Personnel, x: number, depth: number) {
      const px = x + widths.get(p.id)! / 2 - NODE_WIDTH / 2
      nodes.push(personNode(p, px, levelY[depth], "org", ctx))
      let py = levelY[depth] + PERSON_HEIGHT + HEADER_TO_PEOPLE
      const leaves = leavesOf(p)
      for (const leaf of leaves) {
        nodes.push(personNode(leaf, px, py, "org", ctx, 1))
        py += PERSON_HEIGHT + PERSON_GAP
      }
      edges.push(...supervisorEdges([p, ...leaves], "org", true))
      let cx = x
      for (const k of branchesOf(p)) {
        edges.push({
          id: `e-org-${p.id}-${k.id}`,
          source: `person-org-${p.id}`,
          sourceHandle: "bs",
          target: `person-org-${k.id}`,
          targetHandle: "tt",
          type: "smoothstep",
          style: { stroke: EDGE_STROKE, strokeWidth: 1.5, opacity: 0.6 },
        })
        place(k, cx, depth + 1)
        cx += widths.get(k.id)! + TREE_SIBLING_GAP
      }
    }
    let x = xStart
    for (const r of roots) {
      measure(r)
      place(r, x, 0)
      x += widths.get(r.id)! + TREE_SIBLING_GAP
    }
    return x
  }

  const isOfficer = (p: Personnel) => {
    const grade = rankGrade(p.personnel_type, p.branch, p.rank)
    return (
      grade != null &&
      (grade === "Special" || grade.startsWith("O-") || grade.startsWith("W-"))
    )
  }
  const officers = people.filter(isOfficer)
  const rest = people.filter((p) => !isOfficer(p))
  const sections = [
    { key: "officers", label: "Officers", people: officers },
    {
      key: "enlisted",
      label: rest.some((p) => p.personnel_type === "civilian")
        ? "Enlisted & Civilians"
        : "Enlisted",
      people: rest,
    },
  ].filter((s) => s.people.length > 0)

  // With a single populated section the header is noise — skip it.
  const withHeaders = sections.length > 1
  const forestTop = withHeaders ? TOP + HEADER_HEIGHT + HEADER_TO_PEOPLE : TOP
  let x = 40
  for (const [i, s] of sections.entries()) {
    if (i > 0) x += UNGROUPED_GAP - TREE_SIBLING_GAP
    if (withHeaders) {
      nodes.push({
        id: `group-org-${s.key}`,
        type: "groupHeader",
        position: { x, y: TOP },
        data: { label: s.label, count: s.people.length, color: null },
        draggable: false,
        selectable: false,
      })
    }
    x = layoutForest(s.people, x, forestTop)
  }

  return { nodes, edges }
}

/**
 * Team structure: one tree per team — the team header (slug + color) with the
 * NCOIC pinned directly beneath, branching to a node per work center the team
 * draws from, that work center's designated lead on top of its member stack.
 * People on no team park in a lane off to the right.
 */
function buildTeamTree(
  teams: Team[],
  workCenters: WorkCenter[],
  people: Personnel[],
  ctx: PersonCtx,
): { nodes: Node[]; edges: Edge[] } {
  const byId = new Map(people.map((p) => [p.id, p]))
  const wcSorted = [...workCenters].sort((a, b) => a.name.localeCompare(b.name))

  interface Branch {
    key: string
    label: string
    dashed?: boolean
    people: Array<{ person: Personnel; badge?: string }>
  }
  interface TeamCol {
    team: Team
    ncoic: Personnel | null
    branches: Branch[]
    width: number
  }

  const cols: TeamCol[] = []
  for (const t of [...teams].sort((a, b) => a.name.localeCompare(b.name))) {
    const members = people.filter((p) => p.team_ids.includes(t.id))
    const ncoic = t.ncoic_id != null ? byId.get(t.ncoic_id) ?? null : null
    if (members.length === 0 && !ncoic) continue
    const rest = members.filter((p) => p.id !== ncoic?.id)

    const branches: Branch[] = []
    for (const wc of wcSorted) {
      const inWc = rest
        .filter((p) => p.work_center_id === wc.id)
        .sort(bySeniority)
      const leadId = t.leads.find((l) => l.work_center_id === wc.id)?.personnel_id
      // The designated lead may sit outside the member list (or even the
      // roster) — show them when we can resolve them, badged, on top.
      const lead =
        leadId != null && leadId !== ncoic?.id ? byId.get(leadId) ?? null : null
      const stack = [
        ...(lead ? [{ person: lead, badge: "Lead" }] : []),
        ...inWc
          .filter((p) => p.id !== lead?.id)
          .map((person) => ({ person })),
      ]
      if (stack.length > 0)
        branches.push({ key: `wc-${wc.id}`, label: wc.name, people: stack })
    }
    const noWc = rest
      .filter(
        (p) =>
          p.work_center_id == null ||
          !wcSorted.some((wc) => wc.id === p.work_center_id),
      )
      .sort(bySeniority)
    if (noWc.length > 0)
      branches.push({
        key: "no-wc",
        label: "No work center",
        dashed: true,
        people: noWc.map((person) => ({ person })),
      })

    const width = Math.max(
      NODE_WIDTH,
      branches.length * NODE_WIDTH +
        Math.max(0, branches.length - 1) * TREE_SIBLING_GAP,
    )
    cols.push({ team: t, ncoic, branches, width })
  }

  // Two fixed levels: team headers (plus their NCOIC card), then the work
  // center columns — aligned across teams like the other tree renderings.
  const level0 =
    Math.max(
      0,
      ...cols.map(
        ({ ncoic }) =>
          UNIT_HEIGHT + (ncoic ? HEADER_TO_PEOPLE + PERSON_HEIGHT : 0),
      ),
    ) || UNIT_HEIGHT
  const level1Y = TOP + level0 + LEVEL_GAP

  const nodes: Node[] = []
  const edges: Edge[] = []
  let x = 40
  for (const { team: t, ncoic, branches, width } of cols) {
    const scope = `t${t.id}`
    const tx = x + width / 2 - NODE_WIDTH / 2
    // Count what the tree shows — designated leads render even when they
    // aren't formal members, and the NCOIC sits outside the branches.
    const shown = new Set(
      branches.flatMap((b) => b.people.map(({ person }) => person.id)),
    )
    if (ncoic) shown.add(ncoic.id)
    nodes.push({
      id: `team-${t.id}`,
      type: "unit",
      position: { x: tx, y: TOP },
      data: {
        label: t.name,
        tag: t.slug,
        color: t.color,
        count: shown.size,
      },
      draggable: false,
    })
    if (ncoic) {
      nodes.push(
        personNode(
          ncoic,
          tx,
          TOP + UNIT_HEIGHT + HEADER_TO_PEOPLE,
          scope,
          ctx,
          0,
          "NCOIC",
        ),
      )
    }
    let bx = x
    for (const b of branches) {
      const bid = `${scope}-${b.key}`
      nodes.push({
        id: bid,
        type: "unit",
        position: { x: bx, y: level1Y },
        data: { label: b.label, count: b.people.length, dashed: b.dashed },
        draggable: false,
      })
      edges.push({
        id: `e-${scope}-${b.key}`,
        source: `team-${t.id}`,
        target: bid,
        type: "smoothstep",
        style: { stroke: EDGE_STROKE, strokeWidth: 1.5, opacity: 0.6 },
      })
      let py = level1Y + UNIT_HEIGHT + HEADER_TO_PEOPLE
      for (const { person, badge } of b.people) {
        nodes.push(personNode(person, bx, py, bid, ctx, 0, badge))
        py += PERSON_HEIGHT + PERSON_GAP
      }
      bx += NODE_WIDTH + TREE_SIBLING_GAP
    }
    x += width + LANE_GAP
  }

  // People on no team park in their own lane off to the side.
  const noTeam = people
    .filter((p) => p.team_ids.length === 0)
    .sort(bySeniority)
  if (noTeam.length > 0) {
    const nx = x + (cols.length > 0 ? UNGROUPED_GAP - LANE_GAP : 0)
    nodes.push({
      id: "group-no-team",
      type: "groupHeader",
      position: { x: nx, y: TOP },
      data: { label: "No team", count: noTeam.length, color: null, ungrouped: true },
      draggable: false,
      selectable: false,
    })
    let y = TOP + HEADER_HEIGHT + HEADER_TO_PEOPLE
    for (const p of noTeam) {
      nodes.push(personNode(p, nx, y, "no-team", ctx))
      y += PERSON_HEIGHT + PERSON_GAP
    }
  }

  return { nodes, edges }
}

function PersonnelCanvasInner(props: Props) {
  const { w } = useWorkspace()
  const { linkFrom, sites, canEdit } = props
  // Order stacks by chain of command (reports indented under supervisors).
  const [tiers, setTiers] = useState(true)

  const highlightIds =
    props.mode === "org-tree" ? props.highlightIds : undefined
  const { nodes, edges } = useMemo(() => {
    const ctx: PersonCtx = {
      sites,
      canEdit,
      href: (p) => {
        const base = w(`/personnel/${p.id}`)
        if (!linkFrom) return base
        const params = new URLSearchParams({
          from: linkFrom.path,
          fromLabel: linkFrom.label,
        })
        return `${base}?${params.toString()}`
      },
      dim: highlightIds ? (p) => !highlightIds.has(p.id) : undefined,
    }
    switch (props.mode) {
      case "lanes":
        return buildLanes(props.groups, ctx, tiers)
      case "unit-tree":
        return buildUnitTree(props.units, props.people, ctx, tiers)
      case "org-tree":
        return buildOrgTree(props.people, ctx)
      case "team-tree":
        return buildTeamTree(props.teams, props.workCenters, props.people, ctx)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.mode,
    props.mode === "lanes" ? props.groups : null,
    props.mode === "unit-tree" ? props.units : null,
    props.mode === "team-tree" ? props.teams : null,
    props.mode === "team-tree" ? props.workCenters : null,
    props.mode !== "lanes" ? props.people : null,
    highlightIds,
    linkFrom,
    sites,
    canEdit,
    w,
    tiers,
  ])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      nodesDraggable={false}
      panOnDrag
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
      {/* Tier ordering only applies to the stack renderings — the org tree
          IS the supervisor structure, and team stacks pin the lead instead. */}
      {(props.mode === "lanes" || props.mode === "unit-tree") && (
      <Panel position="top-right">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 bg-background/90 backdrop-blur"
              >
                <Settings2 className="size-3.5" />
                Options
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Graph options</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={tiers} onCheckedChange={setTiers}>
                Supervisor tiers
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Panel>
      )}
    </ReactFlow>
  )
}

/**
 * Read-only personnel graph. Four renderings:
 *  - "lanes": one column per group (status / work center / team / …), the
 *    catch-all "No …" bucket parked further off to the right.
 *  - "unit-tree": the org structure from Unit.parent_unit_id, people stacked
 *    under their unit, empty subtrees pruned, unit-less people off to the side.
 *  - "org-tree": traditional org chart from Personnel.supervisor_id —
 *    supervisors branch, their leaf reports stack right beneath them.
 *  - "team-tree": one tree per team — header (slug/color) → NCOIC →
 *    work-center columns with the team's lead pinned on top of each stack.
 * Layout is derived, so nothing is draggable or persisted.
 */
export function PersonnelCanvas(props: Props) {
  const empty =
    props.mode === "lanes"
      ? props.groups.every((g) => g.people.length === 0)
      : props.people.length === 0
  if (empty) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        No personnel to display.
      </div>
    )
  }
  return (
    <div
      className={cn(
        "h-[560px] w-full overflow-hidden rounded-lg border border-border",
        props.className,
      )}
    >
      <ReactFlowProvider>
        <PersonnelCanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  )
}
