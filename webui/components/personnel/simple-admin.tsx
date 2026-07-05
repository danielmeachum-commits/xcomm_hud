"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export interface AdminRow {
  id: number
  name: string
  description: string | null
  // Optional per-entity extras rendered in the row and edit form.
  extras?: Record<string, string | null>
}

interface ExtraField {
  key: string
  label: string
  placeholder?: string
}

interface Props<T extends AdminRow> {
  title: string
  description: string
  /** REST resource base, e.g. "/work-centers", "/teams", "/units". */
  resource: string
  rows: T[]
  /** Extra column labels shown in the table. */
  extraColumns?: Array<{ key: string; label: string }>
  /** Extra edit-form fields. */
  extraFields?: ExtraField[]
  /** Extra display in the row (e.g. parent unit name). */
  rowExtras?: (row: T) => Record<string, string | null>
  canEdit: boolean
  canDelete: boolean
}

export function SimpleAdmin<T extends AdminRow>({
  title,
  description,
  resource,
  rows,
  extraColumns = [],
  extraFields = [],
  rowExtras,
  canEdit,
  canDelete,
}: Props<T>) {
  const router = useRouter()
  const [editing, setEditing] = useState<T | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [extras, setExtras] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startCreate() {
    setEditing(null)
    setName("")
    setDesc("")
    setExtras({})
    setError(null)
    setCreating(true)
  }

  function startEdit(row: T) {
    setCreating(false)
    setEditing(row)
    setName(row.name)
    setDesc(row.description ?? "")
    const rowEx = row.extras ?? {}
    setExtras(
      Object.fromEntries(
        extraFields.map((f) => [f.key, rowEx[f.key] ?? ""]),
      ),
    )
    setError(null)
  }

  function cancel() {
    setEditing(null)
    setCreating(false)
    setError(null)
  }

  async function save() {
    setPending(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: desc || null,
      }
      for (const f of extraFields) {
        const val = extras[f.key]
        body[f.key] = val ? val : null
      }
      const url = editing ? `/api/be${resource}/${editing.id}` : `/api/be${resource}`
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to save")
      }
      cancel()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  async function del(row: T) {
    if (!confirm(`Delete "${row.name}"?`)) return
    const res = await fetch(`/api/be${resource}/${row.id}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      alert(detail.detail ?? "Failed to delete")
      return
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={startCreate}>
            Add
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <div className="rounded-md border border-input p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="admin-name">Name</Label>
              <Input
                id="admin-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                required
              />
            </div>
            {extraFields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`admin-${f.key}`}>{f.label}</Label>
                <Input
                  id={`admin-${f.key}`}
                  value={extras[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) =>
                    setExtras({ ...extras, [f.key]: e.target.value })
                  }
                  disabled={pending}
                />
              </div>
            ))}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="admin-desc">Description</Label>
              <Textarea
                id="admin-desc"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={2}
                disabled={pending}
              />
            </div>
          </div>
          {error && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={save} disabled={pending || !name.trim()}>
              {pending ? "Saving…" : editing ? "Save" : "Create"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={cancel}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Name</th>
              {extraColumns.map((c) => (
                <th key={c.key} className="px-3 py-2">
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2">Description</th>
              <th className="w-1 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={3 + extraColumns.length}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  Nothing here yet.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const ex = rowExtras ? rowExtras(row) : row.extras ?? {}
              return (
                <tr key={row.id} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  {extraColumns.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-muted-foreground">
                      {ex[c.key] ?? "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.description ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(row)}
                      >
                        Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2"
                        onClick={() => del(row)}
                      >
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
