"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronRight,
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder as FolderIcon,
  FolderPlus,
  Home,
  LayoutGrid,
  List,
  MoreHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react"

import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ViewTabs } from "@/components/ui/view-tabs"
import { LocalTime } from "@/components/time-display"
import { groupByCategory } from "@/lib/event-type-meta"
import { cn } from "@/lib/utils"
import type { Document, Folder } from "@/lib/types"

function downloadUrl(id: number): string {
  return `/api/documents/${id}/download`
}

/** Trigger a browser download without navigating away. */
function triggerDownload(id: number) {
  const a = document.createElement("a")
  a.href = downloadUrl(id)
  a.download = ""
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—"
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function docIcon(contentType: string) {
  if (contentType.startsWith("image/")) return FileImage
  if (contentType.startsWith("video/")) return FileVideo
  if (contentType.startsWith("audio/")) return FileAudio
  if (
    contentType.includes("zip") ||
    contentType.includes("tar") ||
    contentType.includes("compressed")
  )
    return FileArchive
  if (
    contentType.includes("spreadsheet") ||
    contentType.includes("excel") ||
    contentType === "text/csv"
  )
    return FileSpreadsheet
  if (
    contentType === "application/pdf" ||
    contentType.startsWith("text/") ||
    contentType.includes("word") ||
    contentType.includes("document")
  )
    return FileText
  return FileIcon
}

/** Depth-first flattening of the folder tree for <select> pickers. */
function flattenFolders(
  folders: Folder[],
): Array<{ folder: Folder; depth: number }> {
  const byParent = new Map<number | null, Folder[]>()
  for (const f of folders) {
    const list = byParent.get(f.parent_id) ?? []
    list.push(f)
    byParent.set(f.parent_id, list)
  }
  const out: Array<{ folder: Folder; depth: number }> = []
  const walk = (parentId: number | null, depth: number) => {
    const children = (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const f of children) {
      out.push({ folder: f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

type View = "list" | "gallery"

interface Props {
  folders: Folder[]
  documents: Document[]
  /** When set, all folder/document writes are scoped to this site. */
  siteId?: number
}

export function DocumentsBrowser({ folders, documents, siteId }: Props) {
  const router = useRouter()

  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null)
  const [view, setView] = useState<View>("list")
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const [folderDialog, setFolderDialog] = useState<{
    folder: Folder | null
  } | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editingDoc, setEditingDoc] = useState<Document | null>(null)

  const [moveTarget, setMoveTarget] = useState("")
  const [bulkPending, setBulkPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const foldersById = useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders],
  )

  // If the current folder disappears (deleted, or the server data refreshed),
  // fall back to the root rather than showing an orphaned view.
  useEffect(() => {
    if (currentFolderId != null && !foldersById.has(currentFolderId)) {
      setCurrentFolderId(null)
    }
  }, [currentFolderId, foldersById])

  const breadcrumbs = useMemo(() => {
    const chain: Folder[] = []
    let cur =
      currentFolderId != null ? foldersById.get(currentFolderId) : undefined
    while (cur) {
      chain.unshift(cur)
      cur = cur.parent_id != null ? foldersById.get(cur.parent_id) : undefined
    }
    return chain
  }, [currentFolderId, foldersById])

  const childFolders = useMemo(
    () =>
      folders
        .filter((f) => f.parent_id === currentFolderId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, currentFolderId],
  )

  const docsHere = useMemo(
    () =>
      documents
        .filter((d) => d.folder_id === currentFolderId)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [documents, currentFolderId],
  )

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          documents
            .map((d) => d.category?.trim())
            .filter((c): c is string => !!c),
        ),
      ).sort(),
    [documents],
  )

  const flatFolders = useMemo(() => flattenFolders(folders), [folders])

  // Prune selection when it drifts outside the current folder's documents.
  useEffect(() => {
    if (selected.size === 0) return
    const inView = new Set(docsHere.map((d) => d.id))
    let changed = false
    const next = new Set<number>()
    for (const id of selected) {
      if (inView.has(id)) next.add(id)
      else changed = true
    }
    if (changed) setSelected(next)
  }, [docsHere, selected])

  function openFolder(id: number | null) {
    setCurrentFolderId(id)
    setSelected(new Set())
    setActionError(null)
  }

  function toggleRowSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllSelected() {
    const allSelected =
      docsHere.length > 0 && docsHere.every((d) => selected.has(d.id))
    setSelected(allSelected ? new Set() : new Set(docsHere.map((d) => d.id)))
  }

  async function deleteFolder(f: Folder) {
    if (!confirm(`Delete folder "${f.name}"?`)) return
    setActionError(null)
    try {
      const res = await fetch(`/api/be/folders/${f.id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          typeof body.detail === "string"
            ? body.detail
            : `Delete failed (${res.status})`,
        )
      }
      if (currentFolderId === f.id) setCurrentFolderId(f.parent_id)
      router.refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unknown error")
    }
  }

  async function deleteDocs(ids: number[]) {
    const label =
      ids.length === 1 ? "this document" : `${ids.length} documents`
    if (!confirm(`Delete ${label}? The stored file is removed too.`)) return
    setBulkPending(true)
    setActionError(null)
    try {
      for (const id of ids) {
        const res = await fetch(`/api/be/documents/${id}`, {
          method: "DELETE",
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(
            typeof body.detail === "string"
              ? body.detail
              : `Delete failed (${res.status})`,
          )
        }
      }
      setSelected(new Set())
      router.refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setBulkPending(false)
    }
  }

  async function bulkMove() {
    if (moveTarget === "") return
    setBulkPending(true)
    setActionError(null)
    try {
      const folderId = moveTarget === "root" ? null : Number(moveTarget)
      for (const id of selected) {
        const res = await fetch(`/api/be/documents/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_id: folderId }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(
            typeof body.detail === "string"
              ? body.detail
              : `Move failed (${res.status})`,
          )
        }
      }
      setSelected(new Set())
      setMoveTarget("")
      router.refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setBulkPending(false)
    }
  }

  function bulkDownload() {
    for (const id of selected) triggerDownload(id)
  }

  const allChecked =
    docsHere.length > 0 && docsHere.every((d) => selected.has(d.id))
  const someChecked = docsHere.some((d) => selected.has(d.id))

  const grouped = useMemo(() => groupByCategory(docsHere), [docsHere])

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb trail through the folder tree. */}
      <nav
        aria-label="Folder path"
        className="flex flex-wrap items-center gap-1 text-sm"
      >
        <button
          type="button"
          onClick={() => openFolder(null)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted",
            currentFolderId === null
              ? "font-medium text-foreground"
              : "text-muted-foreground",
          )}
        >
          <Home className="size-3.5" />
          All documents
        </button>
        {breadcrumbs.map((f, i) => (
          <span key={f.id} className="inline-flex items-center gap-1">
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <button
              type="button"
              onClick={() => openFolder(f.id)}
              className={cn(
                "rounded-md px-1.5 py-0.5 hover:bg-muted",
                i === breadcrumbs.length - 1
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {f.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewTabs<View>
          value={view}
          onChange={setView}
          variant="pill"
          options={[
            { value: "list", label: "List", icon: List },
            { value: "gallery", label: "Gallery", icon: LayoutGrid },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFolderDialog({ folder: null })}
          >
            <FolderPlus data-icon="inline-start" />
            New folder
          </Button>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload data-icon="inline-start" />
            Upload
          </Button>
        </div>
      </div>

      {actionError && (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      )}

      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 shadow-sm backdrop-blur">
          <div className="text-sm font-medium">{selected.size} selected</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={bulkDownload}
              disabled={bulkPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              <Download className="size-3.5" />
              Download
            </button>
            <div className="flex items-center gap-1">
              <select
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
                disabled={bulkPending}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                aria-label="Move to folder"
              >
                <option value="">Move to…</option>
                <option value="root">All documents (root)</option>
                {flatFolders.map(({ folder, depth }) => (
                  <option key={folder.id} value={folder.id}>
                    {`${"  ".repeat(depth)}${folder.name}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={bulkMove}
                disabled={bulkPending || moveTarget === ""}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
              >
                <FolderIcon className="size-3.5" />
                Move
              </button>
            </div>
            <button
              type="button"
              onClick={() => deleteDocs(Array.from(selected))}
              disabled={bulkPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/40 bg-background px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Clear selection"
            >
              <X className="size-3.5" />
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Child folders of the current folder. */}
      {childFolders.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {childFolders.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/50"
            >
              <button
                type="button"
                onClick={() => openFolder(f.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">{f.name}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Folder actions for ${f.name}`}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setFolderDialog({ folder: f })}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => deleteFolder(f)}
                    className="text-destructive"
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {docsHere.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm font-medium">No documents here yet</p>
          <p className="text-xs text-muted-foreground">
            Use <span className="font-medium">Upload</span> to add files
            {childFolders.length > 0 ? ", or open a folder above" : ""}.
          </p>
        </div>
      ) : view === "gallery" ? (
        <div className="flex flex-col gap-6">
          {grouped.map((g) => (
            <section key={g.category} className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {g.category}
              </h2>
              <div className="flex flex-wrap gap-3">
                {g.types.map((d) => {
                  const Icon = docIcon(d.content_type)
                  return (
                    <Attachment key={d.id} className="w-full sm:w-80">
                      <AttachmentMedia variant="icon">
                        <Icon />
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle>{d.title}</AttachmentTitle>
                        <AttachmentDescription>
                          {d.filename} · {formatBytes(d.size_bytes)}
                        </AttachmentDescription>
                      </AttachmentContent>
                      {d.category && (
                        <Badge variant="outline" className="shrink-0">
                          {d.category}
                        </Badge>
                      )}
                      <AttachmentActions>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                type="button"
                                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                                aria-label={`Actions for ${d.title}`}
                              >
                                <MoreHorizontal className="size-3.5" />
                              </button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => triggerDownload(d.id)}
                            >
                              Download
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditingDoc(d)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => deleteDocs([d.id])}
                              className="text-destructive"
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </AttachmentActions>
                    </Attachment>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider">
              <tr>
                <th className="w-10 px-3 py-2 text-left">
                  <Checkbox
                    checked={allChecked}
                    indeterminate={someChecked && !allChecked}
                    onCheckedChange={toggleAllSelected}
                    aria-label="Select all documents"
                  />
                </th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Filename</th>
                <th className="px-3 py-2 text-left">Size</th>
                <th className="px-3 py-2 text-left">Uploaded</th>
                <th className="px-3 py-2 text-left">Uploaded by</th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {docsHere.map((d) => {
                const isChecked = selected.has(d.id)
                const Icon = docIcon(d.content_type)
                return (
                  <tr
                    key={d.id}
                    className={cn(
                      "border-t border-border",
                      isChecked && "bg-primary/5",
                    )}
                  >
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleRowSelected(d.id)}
                        aria-label={`Select ${d.title}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{d.title}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {d.category ? (
                        <Badge variant="outline">{d.category}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {d.filename}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatBytes(d.size_bytes)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <LocalTime iso={d.created_at} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {d.created_by_username ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label={`Actions for ${d.title}`}
                            >
                              <MoreHorizontal className="size-3.5" />
                            </button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => triggerDownload(d.id)}
                          >
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditingDoc(d)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => deleteDocs([d.id])}
                            className="text-destructive"
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {folderDialog && (
        <FolderDialog
          folder={folderDialog.folder}
          parentId={currentFolderId}
          siteId={siteId}
          onClose={() => setFolderDialog(null)}
        />
      )}
      {uploadOpen && (
        <UploadDialog
          folderId={currentFolderId}
          siteId={siteId}
          categories={categories}
          onClose={() => setUploadOpen(false)}
        />
      )}
      {editingDoc && (
        <DocumentEditDialog
          key={editingDoc.id}
          doc={editingDoc}
          flatFolders={flatFolders}
          categories={categories}
          onClose={() => setEditingDoc(null)}
        />
      )}
    </div>
  )
}

function FolderDialog({
  folder,
  parentId,
  siteId,
  onClose,
}: {
  /** null = create a new folder under parentId; otherwise rename. */
  folder: Folder | null
  parentId: number | null
  siteId?: number
  onClose: () => void
}) {
  const router = useRouter()
  const editing = !!folder
  const [name, setName] = useState(folder?.name ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const url = editing ? `/api/be/folders/${folder!.id}` : "/api/be/folders"
      const body = editing
        ? { name: name.trim() }
        : {
            name: name.trim(),
            parent_id: parentId,
            ...(siteId != null ? { site_id: siteId } : {}),
          }
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to save folder")
      }
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? `Rename ${folder!.name}` : "New folder"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={pending}
              autoFocus
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {pending ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UploadDialog({
  folderId,
  siteId,
  categories,
  onClose,
}: {
  folderId: number | null
  siteId?: number
  categories: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [titleTouched, setTitleTouched] = useState(false)
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("")
  const [dragActive, setDragActive] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pickFile(f: File | null) {
    setFile(f)
    if (f && (!titleTouched || !title.trim())) setTitle(f.name)
  }

  async function submit() {
    if (!file) {
      setError("Choose a file to upload.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("title", title.trim() || file.name)
      if (description.trim()) fd.append("description", description.trim())
      if (category.trim()) fd.append("category", category.trim())
      if (folderId != null) fd.append("folder_id", String(folderId))
      if (siteId != null) fd.append("site_id", String(siteId))
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: fd,
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Upload failed")
      }
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <label
            htmlFor="doc-file"
            onDragOver={(e) => {
              e.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragActive(false)
              const f = e.dataTransfer.files?.[0]
              if (f) pickFile(f)
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-6 text-center transition-colors",
              dragActive
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50",
            )}
          >
            <Upload className="size-5 text-muted-foreground" />
            {file ? (
              <>
                <span className="text-sm font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(file.size)} — click or drop to replace
                </span>
              </>
            ) : (
              <>
                <span className="text-sm font-medium">
                  Drop a file here, or click to browse
                </span>
                <span className="text-xs text-muted-foreground">
                  The file uploads into the current folder.
                </span>
              </>
            )}
            <input
              id="doc-file"
              type="file"
              className="sr-only"
              disabled={pending}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleTouched(true)
              }}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-description">Description</Label>
            <Textarea
              id="doc-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-category">Category</Label>
            <Input
              id="doc-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. SOPs, Diagrams…"
              list="doc-upload-category-options"
              disabled={pending}
            />
            <datalist id="doc-upload-category-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !file}>
            {pending ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DocumentEditDialog({
  doc,
  flatFolders,
  categories,
  onClose,
}: {
  doc: Document
  flatFolders: Array<{ folder: Folder; depth: number }>
  categories: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState({
    title: doc.title,
    description: doc.description ?? "",
    category: doc.category ?? "",
    folder: doc.folder_id === null ? "root" : String(doc.folder_id),
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description.trim() || null,
          category: draft.category.trim() || null,
          folder_id: draft.folder === "root" ? null : Number(draft.folder),
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to save document")
      }
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {doc.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="doc-edit-title">Title</Label>
            <Input
              id="doc-edit-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-edit-description">Description</Label>
            <Textarea
              id="doc-edit-description"
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              rows={2}
              disabled={pending}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="doc-edit-category">Category</Label>
              <Input
                id="doc-edit-category"
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
                }
                list="doc-edit-category-options"
                disabled={pending}
              />
              <datalist id="doc-edit-category-options">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-edit-folder">Folder</Label>
              <select
                id="doc-edit-folder"
                value={draft.folder}
                onChange={(e) =>
                  setDraft({ ...draft, folder: e.target.value })
                }
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="root">All documents (root)</option>
                {flatFolders.map(({ folder, depth }) => (
                  <option key={folder.id} value={folder.id}>
                    {`${"  ".repeat(depth)}${folder.name}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {doc.filename} · {formatBytes(doc.size_bytes)} — replace the file
            by uploading a new document.
          </p>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !draft.title.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
