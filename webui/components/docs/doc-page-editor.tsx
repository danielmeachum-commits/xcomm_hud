"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Save, SlidersHorizontal, Trash2 } from "lucide-react"
import { createMarkdownRenderer } from "fumadocs-core/content/md"
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading"
import defaultMdxComponents from "fumadocs-ui/mdx"
import remarkGfm from "remark-gfm"
import { DocsBody } from "fumadocs-ui/page"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
import { EditorToolbar } from "@/components/docs/editor-toolbar"
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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)

  // Inline-create a section and select it.
  async function createSection() {
    const name = newSection.trim()
    if (!name) return
    setCreatingSection(true)
    setError(null)
    try {
      const res = await fetch("/api/be/doc-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, slug: slugify(name) }),
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
        display_order: page?.display_order ?? 0,
      }
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

  const details = (
    <Popover>
      <PopoverTrigger className={buttonVariants({ variant: "outline" })}>
        <SlidersHorizontal className="size-4" />
        Details
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-96 overflow-y-auto">
        <div className="flex flex-col gap-4">
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
            <Label htmlFor="doc-parent">Parent page</Label>
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
            <Label htmlFor="doc-desc">Description</Label>
            <Input
              id="doc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary (optional)"
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">Advanced</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-slug">URL slug</Label>
              <Input
                id="doc-slug"
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true)
                  setSlug(slugify(e.target.value))
                }}
                placeholder="page-url"
              />
              <p className="text-xs text-muted-foreground">
                {mode === "edit"
                  ? "Changing this breaks existing links to the page."
                  : "Auto-generated from the title."}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Reorder pages by dragging them in the sidebar.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled page"
          aria-label="Page title"
          className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 text-xl font-semibold tracking-tight shadow-none focus-visible:ring-0 md:text-2xl"
        />
        <div className="flex shrink-0 items-center gap-2">
          {details}
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

      {/* Split pane: markdown source | live preview */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
      >
        <ResizablePanel defaultSize="50%" minSize="25%">
          <div className="flex h-full flex-col">
            <EditorToolbar textareaRef={contentRef} onChange={setContent} />
            <Textarea
              ref={contentRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write markdown here…"
              spellCheck={false}
              className="min-h-0 w-full flex-1 resize-none rounded-none border-0 bg-transparent font-mono text-sm focus-visible:ring-0"
            />
          </div>
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
