// Layout tree: SplitNode (a stack) or LeafNode (a widget).
// Nesting is fully recursive — a split can contain other splits.

export type Orientation = "h" | "v"

export interface SplitNode {
  id: string
  kind: "split"
  orientation: Orientation
  children: LayoutNode[]
  /**
   * Proportional sizes for children, summing to 100. Index-aligned with
   * `children`. When empty, children divide evenly.
   */
  sizes: number[]
}

export interface LeafNode {
  id: string
  kind: "leaf"
  widgetId: string
  /**
   * Per-instance config persisted with the layout tree. Each widget owns its
   * shape; the dashboard just passes it through.
   */
  config?: Record<string, unknown>
}

export type LayoutNode = SplitNode | LeafNode

export interface DashboardLayout {
  root: SplitNode
}

export function isSplit(n: LayoutNode): n is SplitNode {
  return n.kind === "split"
}

export function isLeaf(n: LayoutNode): n is LeafNode {
  return n.kind === "leaf"
}
