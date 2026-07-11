"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { DocSection } from "@/lib/types"
import { SectionIcon, SECTION_ICON_NAMES } from "./section-icon"

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160)
}

/** CRUD + icon + ordering for Knowledge Hub sections. Edits persist immediately
 * (title/description on blur, icon on pick, order on move) and refresh the nav.
 * Slugs are derived from the title and kept internal — sections aren't in URLs. */
export function SectionManager({
  open,
  onOpenChange,
  sections,
  canDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: DocSection[]
  canDelete: boolean
}) {
  const router = useRouter()
  const [items, setItems] = useState<DocSection[]>(sections)
  const [newTitle, setNewTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reseed from server truth each time the dialog opens.
  useEffect(() => {
    if (open) {
      setItems(sections)
      setError(null)
      setNewTitle("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function send(
    path: string,
    method: string,
    body?: Record<string, unknown>,
    fallback = "Request failed",
  ): Promise<Response | null> {
    setError(null)
    try {
      const res = await fetch(`/api/be${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok && res.status !== 204) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail ?? fallback)
      }
      router.refresh()
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback)
      return null
    }
  }

  async function addSection() {
    const title = newTitle.trim()
    if (!title) return
    setBusy(true)
    const res = await send(
      "/doc-sections",
      "POST",
      { title, slug: slugify(title), display_order: items.length },
      "Failed to create section",
    )
    if (res) {
      const created: DocSection = await res.json()
      setItems((cur) => [...cur, created])
      setNewTitle("")
    }
    setBusy(false)
  }

  async function removeSection(id: number, title: string) {
    if (!confirm(`Delete section "${title}"? Its pages move to General.`)) return
    const res = await send(
      `/doc-sections/${id}`,
      "DELETE",
      undefined,
      "Failed to delete section",
    )
    if (res) setItems((cur) => cur.filter((s) => s.id !== id))
  }

  function setIcon(id: number, icon: string | null) {
    setItems((cur) => cur.map((s) => (s.id === id ? { ...s, icon } : s)))
    send(`/doc-sections/${id}`, "PATCH", { icon }, "Failed to update section")
  }

  function editField(id: number, field: "title" | "description", value: string) {
    setItems((cur) => cur.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
  }

  function commitField(id: number, field: "title" | "description") {
    const item = items.find((s) => s.id === id)
    const orig = sections.find((s) => s.id === id)
    if (!item || !orig) return
    if (field === "title") {
      const value = item.title.trim()
      if (!value) {
        setItems((cur) =>
          cur.map((s) => (s.id === id ? { ...s, title: orig.title } : s)),
        )
        return
      }
      if (value !== orig.title)
        send(`/doc-sections/${id}`, "PATCH", { title: value }, "Failed to update section")
    } else {
      const value = (item.description ?? "").trim()
      if (value !== (orig.description ?? ""))
        send(
          `/doc-sections/${id}`,
          "PATCH",
          { description: value || null },
          "Failed to update section",
        )
    }
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    setItems(next)
    send(`/doc-sections/${next[index].id}`, "PATCH", { display_order: index })
    send(`/doc-sections/${next[target].id}`, "PATCH", { display_order: target })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage sections</DialogTitle>
          <DialogDescription>
            Sections group Knowledge Hub pages and are shared across all
            workspaces.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              No sections yet — add one below.
            </p>
          ) : (
            items.map((s, i) => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-lg border border-border p-2"
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                </div>

                <Popover>
                  <PopoverTrigger
                    className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
                    title="Choose icon"
                  >
                    <SectionIcon name={s.icon} className="size-4" />
                  </PopoverTrigger>
                  <PopoverContent className="w-64" align="start">
                    <div className="grid grid-cols-6 gap-1">
                      <PopoverClose
                        render={
                          <button
                            type="button"
                            onClick={() => setIcon(s.id, null)}
                            className={cn(
                              "flex size-9 items-center justify-center rounded-md hover:bg-muted",
                              !s.icon && "bg-muted ring-1 ring-ring",
                            )}
                            title="No icon"
                          />
                        }
                      >
                        <SectionIcon name={null} className="size-4 opacity-60" />
                      </PopoverClose>
                      {SECTION_ICON_NAMES.map((name) => (
                        <PopoverClose
                          key={name}
                          render={
                            <button
                              type="button"
                              onClick={() => setIcon(s.id, name)}
                              className={cn(
                                "flex size-9 items-center justify-center rounded-md hover:bg-muted",
                                s.icon === name && "bg-muted ring-1 ring-ring",
                              )}
                              title={name}
                            />
                          }
                        >
                          <SectionIcon name={name} className="size-4" />
                        </PopoverClose>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Input
                    value={s.title}
                    onChange={(e) => editField(s.id, "title", e.target.value)}
                    onBlur={() => commitField(s.id, "title")}
                    className="h-8"
                  />
                  <Input
                    value={s.description ?? ""}
                    onChange={(e) => editField(s.id, "description", e.target.value)}
                    onBlur={() => commitField(s.id, "description")}
                    placeholder="Description (optional)"
                    className="h-7 text-xs"
                  />
                </div>

                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeSection(s.id, s.title)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete section"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addSection()
              }
            }}
            placeholder="New section name…"
            className="h-9"
          />
          <Button onClick={addSection} disabled={busy || !newTitle.trim()}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
