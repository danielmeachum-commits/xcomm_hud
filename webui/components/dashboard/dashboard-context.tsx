"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import { defaultLayout, nid } from "@/lib/dashboard/default"
import { getWidget } from "@/lib/dashboard/widgets"
import type {
  DashboardLayout,
  LayoutNode,
  Orientation,
  SplitNode,
} from "@/lib/dashboard/types"

const STORAGE_KEY_PREFIX = "xcomm_hud.dashboard.v1."

interface DashboardContextValue {
  layout: DashboardLayout
  editMode: boolean
  selectedId: string | null
  setEditMode: (v: boolean) => void
  setSelected: (id: string | null) => void

  // Mutations
  addWidget: (widgetId: string, parentId?: string) => void
  removeNode: (nodeId: string) => void
  toggleOrientation: (splitId: string) => void
  setSizes: (splitId: string, sizes: number[]) => void
  reorderChildren: (splitId: string, fromIdx: number, toIdx: number) => void
  /** Move `nodeId` to `insertIdx` inside `parentSplitId`. */
  insertAt: (nodeId: string, parentSplitId: string, insertIdx: number) => void
  promoteToStandalone: (nodeId: string) => void
  wrapInSplit: (nodeId: string, orientation: Orientation) => void
  updateLeafConfig: (
    leafId: string,
    patch: Record<string, unknown> | ((cur: Record<string, unknown>) => Record<string, unknown>),
  ) => void
  resetLayout: () => void
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext)
  if (!ctx) {
    throw new Error("useDashboard must be used within DashboardProvider")
  }
  return ctx
}

export function DashboardProvider({
  username,
  children,
}: {
  username: string
  children: React.ReactNode
}) {
  const storageKey = `${STORAGE_KEY_PREFIX}${username}`
  const [layout, setLayout] = useState<DashboardLayout>(defaultLayout)
  const [editMode, setEditMode] = useState(false)
  const [selectedId, setSelected] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // Load on mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as DashboardLayout
        if (parsed?.root?.kind === "split") {
          setLayout(parsed)
        }
      }
    } catch {
      // ignore — fall back to default
    }
    setHydrated(true)
  }, [storageKey])

  // Save on change
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout))
    } catch {
      // ignore quota errors
    }
  }, [layout, storageKey, hydrated])

  const mutate = useCallback(
    (fn: (root: SplitNode) => SplitNode) => {
      setLayout((prev) => ({ root: fn(clone(prev.root)) }))
    },
    [],
  )

  const addWidget = useCallback(
    (widgetId: string, parentId?: string) => {
      const def = getWidget(widgetId)
      if (!def) return
      mutate((root) => {
        const targetId = def.standaloneOnly ? root.id : parentId ?? root.id
        const parent = findSplit(root, targetId) ?? root
        parent.children.push({ id: nid(), kind: "leaf", widgetId })
        parent.sizes = evenSizes(parent.children.length)
        return root
      })
    },
    [mutate],
  )

  const removeNode = useCallback(
    (nodeId: string) => {
      mutate((root) => {
        removeFromTree(root, nodeId)
        // If root has zero children, leave it empty (editor will offer add)
        return root
      })
      setSelected((cur) => (cur === nodeId ? null : cur))
    },
    [mutate],
  )

  const toggleOrientation = useCallback(
    (splitId: string) => {
      mutate((root) => {
        const split = findSplit(root, splitId)
        if (split) split.orientation = split.orientation === "h" ? "v" : "h"
        return root
      })
    },
    [mutate],
  )

  const setSizes = useCallback(
    (splitId: string, sizes: number[]) => {
      mutate((root) => {
        const split = findSplit(root, splitId)
        if (split) split.sizes = sizes
        return root
      })
    },
    [mutate],
  )

  const reorderChildren = useCallback(
    (splitId: string, fromIdx: number, toIdx: number) => {
      mutate((root) => {
        const split = findSplit(root, splitId)
        if (!split) return root
        const [item] = split.children.splice(fromIdx, 1)
        split.children.splice(toIdx, 0, item)
        // Reorder sizes alongside
        if (split.sizes.length === split.children.length + 0) {
          const [s] = split.sizes.splice(fromIdx, 1)
          split.sizes.splice(toIdx, 0, s)
        }
        return root
      })
    },
    [mutate],
  )

  const promoteToStandalone = useCallback(
    (nodeId: string) => {
      mutate((root) => {
        const found = findWithParent(root, nodeId)
        if (!found || !found.parent || found.parent.id === root.id) return root
        // Detach from current parent
        const idx = found.parent.children.indexOf(found.node)
        if (idx >= 0) {
          found.parent.children.splice(idx, 1)
          if (found.parent.sizes.length > idx) {
            found.parent.sizes.splice(idx, 1)
          }
          found.parent.sizes = evenSizes(found.parent.children.length)
        }
        root.children.push(found.node)
        root.sizes = evenSizes(root.children.length)
        return root
      })
    },
    [mutate],
  )

  const insertAt = useCallback(
    (nodeId: string, parentSplitId: string, insertIdx: number) => {
      if (nodeId === parentSplitId) return
      mutate((root) => {
        const src = findWithParent(root, nodeId)
        const dstParent = findSplit(root, parentSplitId)
        if (!src || !dstParent || !src.parent) return root

        // Standalone widgets must end up at root.
        const def =
          src.node.kind === "leaf" ? getWidget(src.node.widgetId) : undefined
        if (def?.standaloneOnly && dstParent.id !== root.id) return root

        // Prevent dropping a stack into itself or any descendant.
        if (src.node.kind === "split" && containsId(src.node, dstParent.id)) {
          return root
        }

        // Clamp against the *current* destination length (insertion at end is
        // allowed, i.e. idx == length). Clamping after detach would lose the
        // "after last" slot when src and dst are the same parent.
        let idx = Math.max(0, Math.min(insertIdx, dstParent.children.length))

        // Detach src from its current parent.
        const srcIdx = src.parent.children.indexOf(src.node)
        if (srcIdx < 0) return root
        src.parent.children.splice(srcIdx, 1)
        if (src.parent.sizes.length > srcIdx) src.parent.sizes.splice(srcIdx, 1)
        src.parent.sizes = evenSizes(src.parent.children.length)

        // If we just removed an earlier sibling from the destination parent,
        // every index past it shifts left by one.
        if (dstParent.id === src.parent.id && srcIdx < idx) {
          idx -= 1
        }

        dstParent.children.splice(idx, 0, src.node)
        dstParent.sizes = evenSizes(dstParent.children.length)
        return root
      })
    },
    [mutate],
  )

  const wrapInSplit = useCallback(
    (nodeId: string, orientation: Orientation) => {
      mutate((root) => {
        const found = findWithParent(root, nodeId)
        if (!found || !found.parent) return root
        const idx = found.parent.children.indexOf(found.node)
        if (idx < 0) return root
        const newSplit: SplitNode = {
          id: nid("s"),
          kind: "split",
          orientation,
          sizes: [100],
          children: [found.node],
        }
        found.parent.children.splice(idx, 1, newSplit)
        return root
      })
    },
    [mutate],
  )

  const updateLeafConfig = useCallback(
    (
      leafId: string,
      patch:
        | Record<string, unknown>
        | ((cur: Record<string, unknown>) => Record<string, unknown>),
    ) => {
      mutate((root) => {
        const found = findWithParent(root, leafId)
        if (!found || found.node.kind !== "leaf") return root
        const cur = (found.node.config ?? {}) as Record<string, unknown>
        const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch }
        found.node.config = next
        return root
      })
    },
    [mutate],
  )

  const resetLayout = useCallback(() => {
    setLayout(defaultLayout())
    setSelected(null)
  }, [])

  const value = useMemo<DashboardContextValue>(
    () => ({
      layout,
      editMode,
      selectedId,
      setEditMode,
      setSelected,
      addWidget,
      removeNode,
      toggleOrientation,
      setSizes,
      reorderChildren,
      insertAt,
      promoteToStandalone,
      wrapInSplit,
      updateLeafConfig,
      resetLayout,
    }),
    [
      layout,
      editMode,
      selectedId,
      addWidget,
      removeNode,
      toggleOrientation,
      setSizes,
      reorderChildren,
      insertAt,
      promoteToStandalone,
      wrapInSplit,
      updateLeafConfig,
      resetLayout,
    ],
  )

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  )
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x))
}

function evenSizes(n: number): number[] {
  if (n <= 0) return []
  const each = 100 / n
  return Array.from({ length: n }, () => each)
}

function findSplit(node: LayoutNode, id: string): SplitNode | null {
  if (node.kind === "split") {
    if (node.id === id) return node
    for (const c of node.children) {
      const hit = findSplit(c, id)
      if (hit) return hit
    }
  }
  return null
}

function findWithParent(
  root: SplitNode,
  id: string,
): { node: LayoutNode; parent: SplitNode | null } | null {
  if (root.id === id) return { node: root, parent: null }
  function visit(
    n: LayoutNode,
    parent: SplitNode | null,
  ): { node: LayoutNode; parent: SplitNode | null } | null {
    if (n.id === id) return { node: n, parent }
    if (n.kind === "split") {
      for (const c of n.children) {
        const hit = visit(c, n)
        if (hit) return hit
      }
    }
    return null
  }
  return visit(root, null)
}

function containsId(node: LayoutNode, id: string): boolean {
  if (node.id === id) return true
  if (node.kind === "split") {
    return node.children.some((c) => containsId(c, id))
  }
  return false
}

function removeFromTree(root: SplitNode, id: string): boolean {
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i]
    if (c.id === id) {
      root.children.splice(i, 1)
      if (root.sizes.length > i) root.sizes.splice(i, 1)
      root.sizes = evenSizes(root.children.length)
      return true
    }
    if (c.kind === "split") {
      if (removeFromTree(c, id)) {
        // Collapse empty splits up the tree
        if (c.children.length === 0 && c.id !== root.id) {
          root.children.splice(i, 1)
          if (root.sizes.length > i) root.sizes.splice(i, 1)
          root.sizes = evenSizes(root.children.length)
        }
        return true
      }
    }
  }
  return false
}
