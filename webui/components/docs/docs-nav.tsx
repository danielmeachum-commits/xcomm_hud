"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Check,
  ChevronDown,
  FolderCog,
  PanelLeft,
  Plus,
  Search,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { DocPage, DocSection } from "@/lib/types"
import { useWorkspace } from "@/lib/workspace"
import { DocsSearch } from "./docs-search"
import { DocsNavTree } from "./docs-nav-tree"
import { SectionIcon } from "./section-icon"
import { SectionManager } from "./section-manager"

// The "General" pseudo-section (pages with no section_id).
const GENERAL = {
  id: null as number | null,
  title: "General",
  description: null as string | null,
  icon: null as string | null,
}

export function DocsNav({
  pages,
  sections,
  currentSlug,
  currentSectionId,
  canEdit,
  canDelete,
}: {
  pages: DocPage[]
  sections: DocSection[]
  currentSlug: string | null
  currentSectionId: number | null
  canEdit: boolean
  canDelete: boolean
}) {
  const { w } = useWorkspace()
  const router = useRouter()
  const base = w("/docs")
  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

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

  // First page (by order) in each section — used to navigate on section switch.
  const firstPageBySection = useMemo(() => {
    const m = new Map<number | null, DocPage>()
    for (const p of [...pages].sort(
      (a, b) => a.display_order - b.display_order || a.title.localeCompare(b.title),
    )) {
      const key = p.section_id ?? null
      if (!m.has(key)) m.set(key, p)
    }
    return m
  }, [pages])

  // Sections that actually contain pages, plus General if there are loose pages.
  const switcherSections = useMemo(() => {
    const list: typeof GENERAL[] = []
    if (firstPageBySection.has(null)) list.push(GENERAL)
    for (const s of [...sections].sort(
      (a, b) => a.display_order - b.display_order || a.title.localeCompare(b.title),
    )) {
      if (firstPageBySection.has(s.id)) list.push(s)
    }
    return list
  }, [sections, firstPageBySection])

  const current =
    switcherSections.find((s) => s.id === currentSectionId) ??
    switcherSections[0] ??
    GENERAL

  const sectionPages = pages.filter((p) => (p.section_id ?? null) === current.id)

  const goToSection = (id: number | null) => {
    const first = firstPageBySection.get(id)
    if (first) router.push(`${base}/${first.slug}`)
  }

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
    <nav className="flex w-60 shrink-0 flex-col gap-2 overflow-y-auto">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-semibold">Knowledge Hub</span>
        <div className="flex items-center gap-0.5">
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => setManageOpen(true)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Manage sections"
              >
                <FolderCog className="size-4" />
              </button>
              <Link
                href={`${base}/new`}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="New page"
              >
                <Plus className="size-4" />
              </Link>
            </>
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

      {/* Section switcher */}
      {switcherSections.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md border border-border bg-input/30 px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
              />
            }
          >
            <SectionIcon
              name={current.icon}
              className="size-4 shrink-0 opacity-70"
            />
            <span className="truncate font-medium">{current.title}</span>
            <ChevronDown className="ml-auto size-4 shrink-0 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {switcherSections.map((s) => (
              <DropdownMenuItem
                key={s.id ?? "general"}
                onClick={() => goToSection(s.id)}
                className="flex items-start gap-2"
              >
                <SectionIcon
                  name={s.icon}
                  className="mt-0.5 size-4 shrink-0 opacity-70"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{s.title}</span>
                    {s.id === current.id && (
                      <Check className="size-3.5 text-primary" />
                    )}
                  </div>
                  {s.description && (
                    <p className="truncate text-xs text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

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
      {canEdit && (
        <SectionManager
          open={manageOpen}
          onOpenChange={setManageOpen}
          sections={sections}
          canDelete={canDelete}
        />
      )}

      {sectionPages.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">No pages yet.</p>
      ) : (
        <DocsNavTree
          pages={sectionPages}
          currentSlug={currentSlug}
          base={base}
          canEdit={canEdit}
        />
      )}
    </nav>
  )
}
