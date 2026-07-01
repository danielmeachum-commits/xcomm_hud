"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { Copy, Download, Pencil, Trash2, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWorkspace } from "@/lib/workspace"
import type { Workspace } from "@/lib/types"

function tagsFromInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
}

interface Props {
  initialWorkspaces: Workspace[]
}

export function WorkspacesAdminClient({ initialWorkspaces }: Props) {
  const router = useRouter()
  const { current, switchTo } = useWorkspace()
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initialWorkspaces)

  async function refresh() {
    const res = await fetch("/api/be/workspaces")
    if (res.ok) setWorkspaces((await res.json()) as Workspace[])
    router.refresh()
  }

  async function deleteWorkspace(ws: Workspace) {
    if (
      !confirm(
        `Delete workspace "${ws.name}"? Its sites, services, gateways, and canvas will be removed permanently.`,
      )
    )
      return
    const res = await fetch(`/api/be/workspaces/${ws.id}`, { method: "DELETE" })
    if (res.ok) await refresh()
    else alert("Failed to delete workspace")
  }

  async function exportWorkspace(ws: Workspace) {
    const res = await fetch(`/api/be/workspaces/${ws.id}/export`)
    if (!res.ok) {
      alert(`Export failed: ${res.status}`)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const safeName = ws.name.replace(/[^a-z0-9-_]+/gi, "_")
    const stamp = new Date().toISOString().slice(0, 10)
    a.download = `workspace-${safeName}-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Workspaces</h1>
          <p className="text-xs text-muted-foreground">
            Each workspace holds one operating picture. Duplicate a workspace
            to seed the next exercise; tag with "archived" to hide it from the
            switcher.
          </p>
        </div>
        <div className="flex gap-2">
          <ImportWorkspaceButton onDone={refresh} />
          <CreateWorkspaceButton onCreated={refresh} />
        </div>
      </header>

      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 text-left">Name</th>
            <th className="py-2 text-left">Description</th>
            <th className="py-2 text-left">Tags</th>
            <th className="py-2 text-left">Created</th>
            <th className="py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {workspaces.map((ws) => (
            <tr key={ws.id} className="border-b last:border-0 align-top">
              <td className="py-2">
                <button
                  className="text-left hover:underline"
                  onClick={() => switchTo(ws.slug)}
                >
                  {ws.name}
                </button>
                {ws.id === current.id && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-primary">
                    current
                  </span>
                )}
                {ws.is_default && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    default
                  </span>
                )}
              </td>
              <td className="py-2 text-muted-foreground">
                {ws.description ?? "—"}
              </td>
              <td className="py-2">
                <div className="flex flex-wrap gap-1">
                  {ws.tags.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    ws.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                      >
                        {t}
                      </span>
                    ))
                  )}
                </div>
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                {new Date(ws.created_at).toLocaleDateString()}
              </td>
              <td className="py-2 text-right">
                <div className="flex justify-end gap-1">
                  <EditWorkspaceButton workspace={ws} onDone={refresh} />
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Export"
                    onClick={() => void exportWorkspace(ws)}
                  >
                    <Download className="size-4" />
                  </Button>
                  <DuplicateWorkspaceButton source={ws} onDone={refresh} />
                  {!ws.is_default && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Delete"
                      onClick={() => void deleteWorkspace(ws)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {workspaces.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-muted-foreground">
                No workspaces yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function EditWorkspaceButton({
  workspace,
  onDone,
}: {
  workspace: Workspace
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description ?? "")
  const [tagInput, setTagInput] = useState(workspace.tags.join(", "))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName(workspace.name)
    setDescription(workspace.description ?? "")
    setTagInput(workspace.tags.join(", "))
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          tags: tagsFromInput(tagInput),
        }),
      })
      if (res.ok) {
        setOpen(false)
        onDone()
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body?.detail ?? `Edit failed: ${res.status}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" title="Edit">
            <Pencil className="size-4" />
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit workspace</DialogTitle>
          </DialogHeader>
          <p className="text-[11px] text-muted-foreground">
            Slug{" "}
            <span className="font-mono">/w/{workspace.slug}</span> stays the
            same — renaming keeps shared links working.
          </p>
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-desc">Description</Label>
            <Input
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-tags">Tags</Label>
            <Input
              id="edit-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="exercise, planning"
            />
            <span className="text-[11px] text-muted-foreground">
              Comma-separated. Use "archived" to hide from the switcher.
            </span>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting || !name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CreateWorkspaceButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [tagInput, setTagInput] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch("/api/be/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          tags: tagsFromInput(tagInput),
        }),
      })
      if (res.ok) {
        setName("")
        setDescription("")
        setTagInput("")
        setOpen(false)
        onCreated()
      } else {
        alert(`Create failed: ${res.status}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">New workspace</Button>} />
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ws-desc">Description</Label>
            <Input
              id="ws-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ws-tags">Tags</Label>
            <Input
              id="ws-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="exercise, planning"
            />
            <span className="text-[11px] text-muted-foreground">
              Comma-separated. Use "archived" to hide from the switcher.
            </span>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting || !name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DuplicateWorkspaceButton({
  source,
  onDone,
}: {
  source: Workspace
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [tagInput, setTagInput] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch(`/api/be/workspaces/${source.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          tags: tagsFromInput(tagInput),
        }),
      })
      if (res.ok) {
        setName("")
        setTagInput("")
        setOpen(false)
        onDone()
      } else {
        alert(`Duplicate failed: ${res.status}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" title="Duplicate">
            <Copy className="size-4" />
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Duplicate "{source.name}"</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Copies sites, services, gateways, canvas positions, and annotations
            into a fresh workspace. Statuses reset; events are not copied.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="dup-name">New workspace name</Label>
            <Input
              id="dup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="dup-tags">Tags</Label>
            <Input
              id="dup-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="exercise, planning"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting || !name.trim()}>
              Duplicate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface ExportEnvelope {
  format_version: number
  workspace: { name: string; description: string | null; tags: string[] }
  [key: string]: unknown
}

function ImportWorkspaceButton({ onDone }: { onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [envelope, setEnvelope] = useState<ExportEnvelope | null>(null)
  const [nameOverride, setNameOverride] = useState("")
  const [fileName, setFileName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function pickFile() {
    setError(null)
    inputRef.current?.click()
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as ExportEnvelope
      if (parsed.format_version !== 1 || !parsed.workspace?.name) {
        throw new Error("Not a valid workspace export file")
      }
      setEnvelope(parsed)
      setNameOverride(parsed.workspace.name)
      setFileName(file.name)
      setError(null)
      setOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file")
      setOpen(true)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!envelope) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/be/workspaces/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: envelope,
          name_override: nameOverride.trim() || null,
        }),
      })
      if (res.ok) {
        setEnvelope(null)
        setNameOverride("")
        setFileName("")
        setOpen(false)
        onDone()
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body?.detail ?? `Import failed: ${res.status}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onFileChange}
      />
      <Button size="sm" variant="outline" onClick={pickFile}>
        <Upload className="mr-1 size-4" />
        Import
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Import workspace</DialogTitle>
            </DialogHeader>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            {envelope && (
              <>
                <p className="text-xs text-muted-foreground">
                  From <span className="font-mono">{fileName}</span> — this
                  will create a new workspace with{" "}
                  {(envelope.sites as unknown[])?.length ?? 0} site(s) and{" "}
                  {(envelope.services as unknown[])?.length ?? 0} service(s).
                  Statuses reset to defaults.
                </p>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="imp-name">Workspace name</Label>
                  <Input
                    id="imp-name"
                    value={nameOverride}
                    onChange={(e) => setNameOverride(e.target.value)}
                    required
                    autoFocus
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Rename if a workspace with this name already exists.
                  </span>
                </div>
              </>
            )}
            <DialogFooter>
              <Button
                type="submit"
                disabled={submitting || !envelope || !nameOverride.trim()}
              >
                Import
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
