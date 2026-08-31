"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { CodeBadge } from "@/components/equipment/code-badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { PackageDef, Role } from "@/lib/types"

/** The properties this page can write. Narrower than `PackageDef` on purpose:
 *  `PackageDefPatch` on the API accepts code, name and description (plus
 *  `retired`, which is a lifecycle action rather than a property and wants its
 *  own affordance). The UTC list has a separate wholesale-replace endpoint and
 *  is left read-only here. */
interface Form {
  code: string
  name: string
  description: string
}

function formOf(def: PackageDef): Form {
  return {
    code: def.code,
    name: def.name,
    description: def.description ?? "",
  }
}

/** Global catalog rows are admin-managed; a workspace row needs operator.
 *  Mirrors `_require_write` in api/routers/equipment_catalog.py — the API is
 *  still the authority, this only decides whether to offer the button. */
function canEdit(def: PackageDef, role: Role): boolean {
  return def.is_global ? role === "admin" : role !== "viewer"
}

export function PackageDetailClient({
  def,
  role,
}: {
  def: PackageDef
  role: Role
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>(() => formOf(def))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editable = canEdit(def, role)

  function startEditing() {
    // Reseeded from the row rather than from whatever a previous cancelled
    // edit left behind, so Cancel really does discard.
    setForm(formOf(def))
    setError(null)
    setEditing(true)
  }

  async function save() {
    setPending(true)
    setError(null)
    const res = await fetch(`/api/be/package-defs/${def.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
      }),
    })
    setPending(false)
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      setError(
        typeof detail.detail === "string" ? detail.detail : "Failed to save",
      )
      return
    }
    setEditing(false)
    // The page is a server component reading the package list, so a refresh is
    // what brings the saved values back down.
    router.refresh()
  }

  const unchanged =
    form.code.trim() === def.code &&
    form.name.trim() === def.name &&
    form.description.trim() === (def.description ?? "")

  return (
    <Card className="mx-auto w-full max-w-lg [--card-spacing:--spacing(8)]">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{def.name}</span>
          <CodeBadge code={def.code} tone="strong" />
        </CardTitle>
        <CardDescription>
          {def.utcs.length} {def.utcs.length === 1 ? "UTC" : "UTCs"}
          {def.is_global ? " · Global catalog" : " · Workspace"}
        </CardDescription>
        {/* Scope is stated once, in the description above, where it explains
            why Edit is or is not offered. A badge saying it again was the third
            copy of the same fact on this card. */}
        {editable && !editing && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={startEditing}>
              Edit
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {editing ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pkg-code">Code</Label>
              <Input
                id="pkg-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                disabled={pending}
                className="font-mono uppercase"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pkg-name">Name</Label>
              <Input
                id="pkg-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pkg-description">Description</Label>
              <Textarea
                id="pkg-description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                disabled={pending}
                rows={3}
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button
                onClick={save}
                // A blank code or name would be saved as one; the API has no
                // min-length on either, so the guard has to live here.
                disabled={
                  pending ||
                  unchanged ||
                  !form.code.trim() ||
                  !form.name.trim()
                }
              >
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <Property label="Code">
              <CodeBadge code={def.code} tone="strong" />
            </Property>
            <Property label="Name">{def.name}</Property>
            <Property label="Description">
              {def.description || (
                <span className="text-muted-foreground">—</span>
              )}
            </Property>
            {!editable && (
              <p className="text-xs text-muted-foreground">
                {def.is_global
                  ? "Read-only — global catalog rows are admin-managed."
                  : "Read-only — editing requires the operator role."}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Property({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
