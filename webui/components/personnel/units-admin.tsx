"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Unit } from "@/lib/types"

interface Props {
  units: Unit[]
  canEdit: boolean
  canDelete: boolean
}

export function UnitsAdmin({ units, canEdit, canDelete }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState<Unit | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [parentId, setParentId] = useState<string>("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])

  function startCreate() {
    setEditing(null)
    setCreating(true)
    setName("")
    setDesc("")
    setParentId("")
    setError(null)
  }
  function startEdit(u: Unit) {
    setCreating(false)
    setEditing(u)
    setName(u.name)
    setDesc(u.description ?? "")
    setParentId(u.parent_unit_id?.toString() ?? "")
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
      const body = {
        name: name.trim(),
        description: desc || null,
        parent_unit_id: parentId ? Number(parentId) : null,
      }
      const res = await fetch(
        editing ? `/api/be/units/${editing.id}` : "/api/be/units",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      )
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
  async function del(u: Unit) {
    if (!confirm(`Delete "${u.name}"?`)) return
    const res = await fetch(`/api/be/units/${u.id}`, { method: "DELETE" })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      alert(detail.detail ?? "Failed to delete")
      return
    }
    router.refresh()
  }

  const parentOptions = editing
    ? units.filter((u) => u.id !== editing.id)
    : units

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Units</h1>
          <p className="text-xs text-muted-foreground">
            Military organizations for chain of command. Units may nest (parent).
          </p>
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
              <Label htmlFor="unit-name">Name</Label>
              <Input
                id="unit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit-parent">Parent unit</Label>
              <select
                id="unit-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— None —</option>
                {parentOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="unit-desc">Description</Label>
              <Textarea
                id="unit-desc"
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
              <th className="px-3 py-2">Parent</th>
              <th className="px-3 py-2">Description</th>
              <th className="w-1 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {units.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  Nothing here yet.
                </td>
              </tr>
            )}
            {units.map((u) => (
              <tr key={u.id} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{u.name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {u.parent_unit_id
                    ? unitById.get(u.parent_unit_id)?.name ?? "—"
                    : "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {u.description ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(u)}
                    >
                      Edit
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-2"
                      onClick={() => del(u)}
                    >
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
