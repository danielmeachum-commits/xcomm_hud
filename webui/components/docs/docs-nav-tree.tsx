"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import type { DocPage } from "@/lib/types"

interface Node {
  page: DocPage
  children: Node[]
}

type DropPos = "before" | "after" | "into"
interface Target {
  id: number
  pos: DropPos
}
type Order = { id: number; parent_id: number | null; display_order: number }

function buildTree(pages: DocPage[]): Node[] {
  const byId = new Map<number, DocPage>(pages.map((p) => [p.id, p]))
  const nodes = new Map<number, Node>(
    pages.map((p) => [p.id, { page: p, children: [] }]),
  )
  const roots: Node[] = []
  for (const p of pages) {
    const node = nodes.get(p.id)!
    if (p.parent_id != null && byId.has(p.parent_id)) {
      nodes.get(p.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sort = (list: Node[]) => {
    list.sort(
      (a, b) =>
        a.page.display_order - b.page.display_order ||
        a.page.title.localeCompare(b.page.title),
    )
    list.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

function findNode(roots: Node[], id: number): Node | null {
  for (const n of roots) {
    if (n.page.id === id) return n
    const f = findNode(n.children, id)
    if (f) return f
  }
  return null
}

function subtreeIds(node: Node): Set<number> {
  const ids = new Set<number>()
  const walk = (n: Node) => {
    ids.add(n.page.id)
    n.children.forEach(walk)
  }
  walk(node)
  return ids
}

/** Clone the tree with node `id` removed, also returning the detached subtree. */
function detach(roots: Node[], id: number): { roots: Node[]; removed: Node | null } {
  let removed: Node | null = null
  const filter = (list: Node[]): Node[] => {
    const out: Node[] = []
    for (const n of list) {
      if (n.page.id === id) {
        removed = n
        continue
      }
      out.push({ page: n.page, children: filter(n.children) })
    }
    return out
  }
  return { roots: filter(roots), removed }
}

/** Insert `node` relative to `targetId`; mutates the (freshly cloned) roots. */
function insert(
  roots: Node[],
  targetId: number,
  pos: DropPos,
  node: Node,
): boolean {
  if (pos === "into") {
    const find = (list: Node[]): boolean => {
      for (const n of list) {
        if (n.page.id === targetId) {
          n.children.push(node)
          return true
        }
        if (find(n.children)) return true
      }
      return false
    }
    return find(roots)
  }
  const place = (list: Node[]): boolean => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].page.id === targetId) {
        list.splice(i + (pos === "after" ? 1 : 0), 0, node)
        return true
      }
      if (place(list[i].children)) return true
    }
    return false
  }
  return place(roots)
}

function flatten(roots: Node[]): Order[] {
  const out: Order[] = []
  const walk = (list: Node[], parentId: number | null) => {
    list.forEach((n, i) => {
      out.push({ id: n.page.id, parent_id: parentId, display_order: i })
      walk(n.children, n.page.id)
    })
  }
  walk(roots, null)
  return out
}

/** The section's page tree. When `canEdit`, rows are drag-reorderable: drop
 * above/below a row to re-order as a sibling, or onto the middle of a row to
 * nest it as a child. Changes apply optimistically and persist via
 * /doc-pages/reorder. */
export function DocsNavTree({
  pages,
  currentSlug,
  base,
  canEdit,
}: {
  pages: DocPage[]
  currentSlug: string | null
  base: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [items, setItems] = useState(pages)
  useEffect(() => setItems(pages), [pages])

  const roots = useMemo(() => buildTree(items), [items])

  const [dragId, setDragId] = useState<number | null>(null)
  const [target, setTarget] = useState<Target | null>(null)

  // Ids that can't accept the current drag (the dragged node + its subtree).
  const banned = useMemo(() => {
    if (dragId == null) return new Set<number>()
    const node = findNode(roots, dragId)
    return node ? subtreeIds(node) : new Set<number>()
  }, [dragId, roots])

  function reset() {
    setDragId(null)
    setTarget(null)
  }

  function drop() {
    if (dragId == null || !target || banned.has(target.id)) return reset()
    const { roots: without, removed } = detach(roots, dragId)
    if (!removed) return reset()
    insert(without, target.id, target.pos, removed)
    const flat = flatten(without)
    const byId = new Map(flat.map((f) => [f.id, f]))
    setItems((cur) =>
      cur.map((p) => {
        const f = byId.get(p.id)
        return f ? { ...p, parent_id: f.parent_id, display_order: f.display_order } : p
      }),
    )
    reset()
    persist(flat)
  }

  async function persist(order: Order[]) {
    try {
      const res = await fetch("/api/be/doc-pages/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: order }),
      })
      if (!res.ok && res.status !== 204) throw new Error("reorder failed")
      router.refresh()
    } catch {
      setItems(pages) // revert to server truth
    }
  }

  return (
    <TreeList
      nodes={roots}
      depth={0}
      currentSlug={currentSlug}
      base={base}
      canEdit={canEdit}
      dragId={dragId}
      target={target}
      banned={banned}
      setDragId={setDragId}
      setTarget={setTarget}
      onDrop={drop}
      onEnd={reset}
    />
  )
}

function TreeList({
  nodes,
  depth,
  currentSlug,
  base,
  canEdit,
  dragId,
  target,
  banned,
  setDragId,
  setTarget,
  onDrop,
  onEnd,
}: {
  nodes: Node[]
  depth: number
  currentSlug: string | null
  base: string
  canEdit: boolean
  dragId: number | null
  target: Target | null
  banned: Set<number>
  setDragId: (id: number | null) => void
  setTarget: (t: Target | null) => void
  onDrop: () => void
  onEnd: () => void
}) {
  return (
    <ul className={cn(depth > 0 && "ml-3 border-l border-border/60 pl-2")}>
      {nodes.map(({ page, children }) => {
        const active = page.slug === currentSlug
        const isTarget = target?.id === page.id
        return (
          <li key={page.id}>
            <div className="relative">
              {isTarget && target.pos !== "into" && (
                <div
                  className={cn(
                    "pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary",
                    target.pos === "before" ? "top-0" : "bottom-0",
                  )}
                />
              )}
              <Link
                href={`${base}/${page.slug}`}
                draggable={canEdit}
                onDragStart={
                  canEdit
                    ? (e) => {
                        e.dataTransfer.effectAllowed = "move"
                        setDragId(page.id)
                      }
                    : undefined
                }
                onDragOver={
                  canEdit
                    ? (e) => {
                        e.preventDefault()
                        if (banned.has(page.id)) {
                          setTarget(null)
                          return
                        }
                        const r = e.currentTarget.getBoundingClientRect()
                        const ratio = (e.clientY - r.top) / r.height
                        const pos: DropPos =
                          ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "into"
                        setTarget({ id: page.id, pos })
                      }
                    : undefined
                }
                onDrop={
                  canEdit
                    ? (e) => {
                        e.preventDefault()
                        onDrop()
                      }
                    : undefined
                }
                onDragEnd={canEdit ? onEnd : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  isTarget && target.pos === "into" && "ring-1 ring-inset ring-primary",
                  dragId === page.id && "opacity-50",
                )}
              >
                <span className="truncate">{page.title}</span>
              </Link>
            </div>
            {children.length > 0 && (
              <TreeList
                nodes={children}
                depth={depth + 1}
                currentSlug={currentSlug}
                base={base}
                canEdit={canEdit}
                dragId={dragId}
                target={target}
                banned={banned}
                setDragId={setDragId}
                setTarget={setTarget}
                onDrop={onDrop}
                onEnd={onEnd}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
