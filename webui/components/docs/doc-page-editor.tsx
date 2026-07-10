"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Globe, Save, Trash2 } from "lucide-react"
import { createMarkdownRenderer } from "fumadocs-core/content/md"
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading"
import defaultMdxComponents from "fumadocs-ui/mdx"
import remarkGfm from "remark-gfm"
import { DocsBody } from "fumadocs-ui/page"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Mermaid } from "@/components/docs/mermaid"
import { rehypeMermaid } from "@/lib/rehype-mermaid"
import { cn } from "@/lib/utils"
import type { DocPage, DocSection } from "@/lib/types"

// Synchronous client-side renderer for the live preview — GitHub-flavored
// markdown + heading ids + mermaid diagrams. No Shiki (async); the saved page
// gets highlighting from the server renderer.
const previewComponents = { ...defaultMdxComponents, mermaid: Mermaid }
const { Markdown: PreviewMarkdown } = createMarkdownRenderer({
  remarkPlugins: [remarkGfm, remarkHeading],
  rehypePlugins: [rehypeMermaid],
})

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160)
}

export function DocPageEditor({
  mode,
  page,
  allPages,
  sections,
  basePath,
  canDelete,
}: {
  mode: "create" | "edit"
  page?: DocPage
  allPages: DocPage[]
  sections: DocSection[]
  basePath: string
  canDelete: boolean
}) {
  const router = useRouter()
  const [title, setTitle] = useState(page?.title ?? "")
  const [slug, setSlug] = useState(page?.slug ?? "")
  const [slugEdited, setSlugEdited] = useState(mode === "edit")
  const [description, setDescription] = useState(page?.description ?? "")
  const [content, setContent] = useState(page?.content ?? "")
  const [parentId, setParentId] = useState<string>(
    page?.parent_id != null ? String(page.parent_id) : "",
  )
  const [sectionId, setSectionId] = useState<string>(
    page?.section_id != null ? String(page.section_id) : "",
  )
  const [localSections, setLocalSections] = useState<DocSection[]>(sections)
  const [newSection, setNewSection] = useState("")
  const [creatingSection, setCreatingSection] = useState(false)
  const [displayOrder, setDisplayOrder] = useState<string>(
    String(page?.display_order ?? 0),
  )
  const [scope, setScope] = useState<"workspace" | "global">(
    page?.is_global ? "global" : "workspace",
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Inline-create a section (matches the page's current scope) and select it.
  async function createSection() {
    const name = newSection.trim()
    if (!name) return
    setCreatingSection(true)
    setError(null)
    try {
      const res = await fetch("/api/be/doc-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, slug: slugify(name), scope }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail ?? "Failed to create section")
      }
      const created: DocSection = await res.json()
      setLocalSections((s) => [...s, created])
      setSectionId(String(created.id))
      setNewSection("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create section")
    } finally {
      setCreatingSection(false)
    }
  }

  // Auto-derive the slug from the title until the author edits it by hand.
  useEffect(() => {
    if (!slugEdited) setSlug(slugify(title))
  }, [title, slugEdited])

  // Debounce the preview so fast typing doesn't reparse on every keystroke.
  const [preview, setPreview] = useState(content)
  useEffect(() => {
    const t = setTimeout(() => setPreview(content), 150)
    return () => clearTimeout(t)
  }, [content])

  const parentOptions = allPages.filter((p) => p.id !== page?.id)

  async function save() {
    setError(null)
    if (!title.trim()) return setError("Title is required")
    if (!slug.trim()) return setError("Slug is required")
    if (slug.trim() === "new") return setError('"new" is a reserved slug')
    setPending(true)
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        content,
        parent_id: parentId === "" ? null : Number(parentId),
        section_id: sectionId === "" ? null : Number(sectionId),
        display_order: Number(displayOrder) || 0,
      }
      if (mode === "create") body.scope = scope
      const url = mode === "edit" ? `/api/be/doc-pages/${page!.id}` : "/api/be/doc-pages"
      const res = await fetch(url, {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail ?? "Failed to save page")
      }
      router.push(`${basePath}/${slug.trim()}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save page")
      setPending(false)
    }
  }

  async function remove() {
    if (!page) return
    if (!confirm(`Delete "${page.title}"? This cannot be undone.`)) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/doc-pages/${page.id}`, { method: "DELETE" })
      if (!res.ok && res.status !== 204) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail ?? "Failed to delete page")
      }
      router.push(basePath)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete page")
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">
          {mode === "edit" ? "Edit page" : "New page"}
        </h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() =>
              router.push(mode === "edit" ? `${basePath}/${page!.slug}` : basePath)
            }
            disabled={pending}
          >
            Cancel
          </Button>
          {mode === "edit" && canDelete && (
            <Button variant="destructive" onClick={remove} disabled={pending}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          )}
          <Button onClick={save} disabled={pending}>
            <Save className="size-4" />
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Metadata */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-title">Title</Label>
          <Input
            id="doc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-slug">Slug</Label>
          <Input
            id="doc-slug"
            value={slug}
            onChange={(e) => {
              setSlugEdited(true)
              setSlug(slugify(e.target.value))
            }}
            placeholder="page-url"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-parent">Parent</Label>
          <select
            id="doc-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="h-9 rounded-md border border-input bg-input/30 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">— None (top level) —</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-section">Section</Label>
          <select
            id="doc-section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="h-9 rounded-md border border-input bg-input/30 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">General</option>
            {localSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.is_global ? " (global)" : ""}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <Input
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  createSection()
                }
              }}
              placeholder="New section…"
              className="h-8 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              onClick={createSection}
              disabled={creatingSection || !newSection.trim()}
              className="h-8 px-2 text-xs"
            >
              Add
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-order">Order</Label>
          <Input
            id="doc-order"
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="doc-desc">Description</Label>
          <Input
            id="doc-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short summary (optional)"
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>Scope</Label>
          {mode === "edit" ? (
            <p className="flex h-9 items-center text-sm text-muted-foreground">
              {page?.is_global ? (
                <>
                  <Globe className="mr-1.5 size-3.5" /> Global — shared across all
                  workspaces
                </>
              ) : (
                "This workspace"
              )}
            </p>
          ) : (
            <div className="inline-flex rounded-md border border-input p-0.5">
              {(["workspace", "global"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={cn(
                    "rounded px-3 py-1 text-sm transition-colors",
                    scope === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "workspace" ? "This workspace" : "Global"}
                </button>
              ))}
            </div>
          )}
          {mode === "create" && scope === "global" && (
            <p className="text-xs text-muted-foreground">
              Global pages appear in every workspace.
            </p>
          )}
        </div>
      </div>

      {/* Split pane: markdown source | live preview */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
      >
        <ResizablePanel defaultSize="50%" minSize="25%">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write markdown here…"
            spellCheck={false}
            className="h-full w-full resize-none rounded-none border-0 bg-transparent font-mono text-sm focus-visible:ring-0"
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="50%" minSize="25%">
          <div className="h-full overflow-auto bg-background p-4">
            <DocsBody>
              <PreviewMarkdown async={false} components={previewComponents}>
                {preview || "*Nothing to preview yet.*"}
              </PreviewMarkdown>
            </DocsBody>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
