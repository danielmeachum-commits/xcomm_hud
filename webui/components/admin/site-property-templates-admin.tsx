"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { Copy, Download, Pencil, Plus, Trash2, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/lib/workspace"
import type {
  SitePropertyTemplate,
  SitePropertyTemplateExport,
} from "@/lib/types"

interface Props {
  templates: SitePropertyTemplate[]
}

export function SitePropertyTemplatesAdmin({ templates }: Props) {
  const router = useRouter()
  const { w } = useWorkspace()
  const fileRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [editingMeta, setEditingMeta] = useState<SitePropertyTemplate | null>(
    null,
  )
  const [duplicating, setDuplicating] = useState<SitePropertyTemplate | null>(
    null,
  )
  const [importError, setImportError] = useState<string | null>(null)

  async function remove(t: SitePropertyTemplate) {
    if (
      !confirm(
        `Delete template "${t.name}"? Sites that already applied it keep their properties.`,
      )
    )
      return
    const res = await fetch(`/api/be/site-property-templates/${t.id}`, {
      method: "DELETE",
    })
    if (res.ok) router.refresh()
  }

  async function exportTemplate(t: SitePropertyTemplate) {
    const res = await fetch(`/api/be/site-property-templates/${t.id}/export`)
    if (!res.ok) return
    const payload = (await res.json()) as SitePropertyTemplateExport
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${t.name.replace(/[^a-z0-9-]+/gi, "_")}.template.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError(null)
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const payload = JSON.parse(text) as SitePropertyTemplateExport
      if (payload.format_version !== 1 || !Array.isArray(payload.definitions)) {
        throw new Error("Not a valid site property template export")
      }
      const res = await fetch("/api/be/site-property-templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Import failed")
      }
      router.refresh()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed")
    } finally {
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={onImportFile}
        />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" />
          Import
        </Button>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New template
        </Button>
      </div>
      {importError && (
        <p className="text-sm text-destructive" role="alert">
          {importError}
        </p>
      )}
      <div className="overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Fields</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link
                    href={w(`/admin/site-properties/${t.id}`)}
                    className="font-medium hover:underline"
                  >
                    {t.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {t.definitions.length}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {t.description ?? ""}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Rename / description"
                      onClick={() => setEditingMeta(t)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Duplicate"
                      onClick={() => setDuplicating(t)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Export"
                      onClick={() => void exportTemplate(t)}
                    >
                      <Download className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Delete"
                      onClick={() => void remove(t)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-xs text-muted-foreground"
                >
                  No templates yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(creating || editingMeta) && (
        <TemplateMetaDialog
          template={editingMeta}
          onClose={() => {
            setCreating(false)
            setEditingMeta(null)
          }}
        />
      )}

      {duplicating && (
        <DuplicateDialog
          template={duplicating}
          onClose={() => setDuplicating(null)}
        />
      )}
    </>
  )
}

function TemplateMetaDialog({
  template,
  onClose,
}: {
  template: SitePropertyTemplate | null
  onClose: () => void
}) {
  const router = useRouter()
  const editing = template !== null
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(template?.name ?? "")
  const [description, setDescription] = useState(template?.description ?? "")

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const body = { name, description: description || null }
      const url = editing
        ? `/api/be/site-property-templates/${template!.id}`
        : `/api/be/site-property-templates`
      const method = editing ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Save failed")
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
            {editing ? `Edit ${template!.name}` : "New template"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={pending}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !name}>
            {pending ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DuplicateDialog({
  template,
  onClose,
}: {
  template: SitePropertyTemplate
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(`${template.name} (copy)`)
  const [description, setDescription] = useState(template.description ?? "")

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/be/site-property-templates/${template.id}/duplicate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description: description || null }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Duplicate failed")
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
          <DialogTitle>Duplicate {template.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dup-name">Name</Label>
            <Input
              id="dup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dup-desc">Description</Label>
            <Textarea
              id="dup-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={pending}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !name}>
            {pending ? "Copying…" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
