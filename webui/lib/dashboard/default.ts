import type { DashboardLayout, LayoutNode, SplitNode } from "./types"

export function defaultLayout(): DashboardLayout {
  return {
    root: {
      id: "root",
      kind: "split",
      orientation: "h",
      sizes: [50, 50],
      children: [
        {
          id: "leaf_default_sites",
          kind: "leaf",
          widgetId: "site-status-grid",
        },
        {
          id: "leaf_default_services",
          kind: "leaf",
          widgetId: "service-health-rollup",
        },
      ],
    },
  }
}

let counter = 0
export function nid(prefix = "n"): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

export function walk(
  node: LayoutNode,
  fn: (n: LayoutNode, parent: SplitNode | null) => boolean | void,
  parent: SplitNode | null = null,
): void {
  if (fn(node, parent) === false) return
  if (node.kind === "split") {
    for (const c of node.children) walk(c, fn, node)
  }
}

export function findNode(
  root: LayoutNode,
  id: string,
): { node: LayoutNode; parent: SplitNode | null } | null {
  let hit: { node: LayoutNode; parent: SplitNode | null } | null = null
  walk(root, (n, p) => {
    if (n.id === id) {
      hit = { node: n, parent: p }
      return false
    }
  })
  return hit
}
