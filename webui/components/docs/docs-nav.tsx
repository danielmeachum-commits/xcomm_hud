"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ChevronDown,
  Globe,
  PanelLeft,
  Plus,
  Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { DocPage } from "@/lib/types"
import { useWorkspace } from "@/lib/workspace"
import { DocsSearch } from "./docs-search"

interface TreeNode {
  page: DocPage
  children: TreeNode[]
}

/** Build a tree from a flat page list. Orphans (parent not in the set) fall to root. */
function buildTree(pages: DocPage[]): TreeNode[] {
  const byId = new Map<number, DocPage>(pages.map((p) => [p.id, p]))
  const nodes = new Map<number, TreeNode>(
    pages.map((p) => [p.id, { page: p, children: [] }]),
  )
  const roots: TreeNode[] = []
  for (const p of pages) {
    const node = nodes.get(p.id)!
    if (p.parent_id != null && byId.has(p.parent_id)) {
      nodes.get(p.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sort = (list: TreeNode[]) => {
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

function NavItems({
  nodes,
  currentSlug,
  base,
  depth,
}: {
  nodes: TreeNode[]
  currentSlug: string | null
  base: string
  depth: number
}) {
  return (
    <ul className={cn(depth > 0 && "ml-3 border-l border-border/60 pl-2")}>
      {nodes.map(({ page, children }) => {
        const active = page.slug === currentSlug
        return (
          <li key={page.id}>
            <Link
              href={`${base}/${page.slug}`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="truncate">{page.title}</span>
            </Link>
            {children.length > 0 && (
              <NavItems
                nodes={children}
                currentSlug={currentSlug}
                base={base}
                depth={depth + 1}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function NavSection({
  title,
  icon: Icon,
  pages,
  currentSlug,
  base,
}: {
  title: string
  icon?: typeof Globe
  pages: DocPage[]
  currentSlug: string | null
  base: string
}) {
  const [open, setOpen] = useState(true)
  if (pages.length === 0) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {Icon && <Icon className="size-3" />}
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "ml-auto size-3.5 transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && (
        <NavItems
          nodes={buildTree(pages)}
          currentSlug={currentSlug}
          base={base}
          depth={0}
        />
      )}
    </div>
  )
}

export function DocsNav({
  pages,
  currentSlug,
  canEdit,
}: {
  pages: DocPage[]
  currentSlug: string | null
  canEdit: boolean
}) {
  const { w } = useWorkspace()
  const base = w("/docs")
  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // ⌘K / Ctrl+K opens search (fumadocs' built-in ⌘K is disabled in the layout).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const globalPages = pages.filter((p) => p.is_global)
  const workspacePages = pages.filter((p) => !p.is_global)

  // Search dialog is always mounted so ⌘K works even when the rail is collapsed.
  const search = (
    <DocsSearch
      open={searchOpen}
      onOpenChange={setSearchOpen}
      pages={pages}
      base={base}
    />
  )

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col gap-1">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Expand navigation"
        >
          <PanelLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Search (⌘K)"
        >
          <Search className="size-4" />
        </button>
        {search}
      </div>
    )
  }

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-semibold">Knowledge Hub</span>
        <div className="flex items-center gap-0.5">
          {canEdit && (
            <Link
              href={`${base}/new`}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="New page"
            >
              <Plus className="size-4" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Collapse navigation"
          >
            <PanelLeft className="size-4" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2 rounded-md border border-border bg-input/30 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4" />
        <span>Search…</span>
        <kbd className="ml-auto rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>
      {search}

      {pages.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">No pages yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <NavSection
            title="This workspace"
            pages={workspacePages}
            currentSlug={currentSlug}
            base={base}
          />
          <NavSection
            title="Global"
            icon={Globe}
            pages={globalPages}
            currentSlug={currentSlug}
            base={base}
          />
        </div>
      )}
    </nav>
  )
}
