"use client"

import { Globe, Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  enclaveChipClass,
  enclaveChipStyle,
  enclaveDepth,
  enclaveTreeOrder,
} from "@/lib/enclave-meta"
import type { Classification, Enclave } from "@/lib/types"
import { cn } from "@/lib/utils"

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

/** A static vocabulary, not a managed list — the levels are stable. Listed
 *  in the order an operator would recite them, which is NOT a ranking the app
 *  uses for anything: nothing sorts or branches on classification. */
const CLASSIFICATION_LABELS: Record<Classification, string> = {
  unclassified: "Unclassified",
  cui: "CUI",
  secret: "Secret",
  top_secret: "Top Secret",
}

const CLASSIFICATION_VALUES = Object.keys(
  CLASSIFICATION_LABELS,
) as Classification[]

/** Suggested swatches. Free-text hex is still allowed — these just save the
 *  operator from picking a color that reads as a status. */
const SWATCHES = [
  // Black is the transport layer's color. It renders from theme tokens rather
  // than literally, so it stays legible on a dark canvas.
  "#000000",
  "#3f7f3f",
  "#b03030",
  "#2f6fb0",
  "#8b5a2b",
  "#7a4fb0",
  "#b07f2f",
]

interface Form {
  name: string
  short_name: string
  parent_id: number | ""
  color: string
  /** "" is the "None" option — an enclave declaring no level. */
  classification: Classification | ""
  display_order: number
  notes: string
}

function emptyForm(): Form {
  return {
    name: "",
    short_name: "",
    parent_id: "",
    color: "",
    classification: "",
    display_order: 0,
    notes: "",
  }
}

function formOf(e: Enclave): Form {
  return {
    name: e.name,
    short_name: e.short_name ?? "",
    parent_id: e.parent_id ?? "",
    color: e.color ?? "",
    classification: e.classification ?? "",
    display_order: e.display_order,
    notes: e.notes ?? "",
  }
}

export function EnclaveChip({ enclave }: { enclave: Enclave }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        enclaveChipClass(enclave.color),
      )}
      style={enclaveChipStyle(enclave.color)}
    >
      {enclave.short_name || enclave.name}
    </span>
  )
}

function GlobalBadge() {
  return (
    <span
      title="Global — shared across workspaces, admin-managed"
      className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
    >
      <Globe className="size-3" />
      Global
    </span>
  )
}

export function EnclavesClient({
  enclaves,
  isAdmin,
}: {
  enclaves: Enclave[]
  isAdmin: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Enclave | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<Form>(emptyForm)
  const [makeGlobal, setMakeGlobal] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byId = useMemo(
    () => new Map(enclaves.map((e) => [e.id, e])),
    [enclaves],
  )
  const ordered = useMemo(() => enclaveTreeOrder(enclaves), [enclaves])

  const open = creating || editing !== null
  const canEdit = (e: Enclave) => isAdmin || !e.is_global

  function startCreate() {
    setForm(emptyForm())
    setMakeGlobal(false)
    setError(null)
    setCreating(true)
  }

  function startEdit(e: Enclave) {
    if (!canEdit(e)) return
    setForm(formOf(e))
    setError(null)
    setEditing(e)
  }

  function close() {
    setCreating(false)
    setEditing(null)
    setError(null)
  }

  /** Candidate parents: everything except the row being edited and its own
   *  descendants. The API rejects a cycle anyway, but offering an option that
   *  can only fail is a worse experience than not offering it. */
  const parentOptions = useMemo(() => {
    if (!editing) return ordered
    const banned = new Set<number>([editing.id])
    let grew = true
    while (grew) {
      grew = false
      for (const e of enclaves) {
        if (e.parent_id && banned.has(e.parent_id) && !banned.has(e.id)) {
          banned.add(e.id)
          grew = true
        }
      }
    }
    return ordered.filter((e) => !banned.has(e.id))
  }, [editing, enclaves, ordered])

  async function submit() {
    setPending(true)
    setError(null)
    const body = {
      name: form.name.trim(),
      short_name: form.short_name.trim() || null,
      parent_id: form.parent_id === "" ? null : Number(form.parent_id),
      color: form.color.trim() || null,
      classification: form.classification || null,
      display_order: form.display_order,
      notes: form.notes.trim() || null,
    }
    const url = editing
      ? `/api/be/enclaves/${editing.id}`
      : `/api/be/enclaves${makeGlobal ? "?global=true" : ""}`
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setPending(false)
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      setError(
        typeof detail.detail === "string"
          ? detail.detail
          : `Failed to save (${res.status})`,
      )
      return
    }
    close()
    router.refresh()
  }

  /** Disable/enable rather than delete. Equipment, services and UTC lines hold
   *  foreign keys here, so a disabled enclave has to stay resolvable — gear
   *  tagged with it must not lose the answer to "which network is this on".
   *  Reversible for the same reason: the row was never destroyed. */
  async function setEnabled(e: Enclave, enabled: boolean) {
    setPending(true)
    const res = await fetch(`/api/be/enclaves/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retired: !enabled }),
    })
    setPending(false)
    if (res.ok) router.refresh()
  }

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={startCreate}>
          <Plus className="size-4" />
          New enclave
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Enclave</TableHead>
            <TableHead className="w-32">Classification</TableHead>
            <TableHead className="w-24 text-right">Scope</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((e) => (
            <TableRow
              key={e.id}
              className={cn(
                canEdit(e) && "cursor-pointer",
                e.retired_at && "opacity-55",
              )}
              onClick={() => startEdit(e)}
            >
              <TableCell>
                <span
                  className="flex items-center gap-2"
                  style={{ paddingLeft: enclaveDepth(e, byId) * 16 }}
                >
                  <EnclaveChip enclave={e} />
                  <span className="font-medium">{e.name}</span>
                  {e.retired_at && (
                    <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Disabled
                    </span>
                  )}
                  {!e.color && (
                    <span className="text-[11px] text-muted-foreground">
                      no color
                    </span>
                  )}
                </span>
              </TableCell>
              {/* Plain muted text, no badge: this is metadata about the
                  network, not a status or a marking on anything. */}
              <TableCell className="text-xs text-muted-foreground">
                {e.classification ? (
                  CLASSIFICATION_LABELS[e.classification]
                ) : (
                  <span className="opacity-60">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {e.is_global ? (
                  <GlobalBadge />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Workspace
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {canEdit(e) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      setEnabled(e, e.retired_at !== null)
                    }}
                  >
                    {e.retired_at ? "Enable" : "Disable"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={open}
        onOpenChange={(o) => !o && close()}
        disablePointerDismissal
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.name}` : "New enclave"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="enc-name">Name</Label>
                <Input
                  id="enc-name"
                  value={form.name}
                  disabled={pending}
                  onChange={(ev) =>
                    setForm({ ...form, name: ev.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="enc-short">Short name</Label>
                <Input
                  id="enc-short"
                  value={form.short_name}
                  disabled={pending}
                  onChange={(ev) =>
                    setForm({ ...form, short_name: ev.target.value })
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              {/* "Parent", not "tier" — tier already means PACE in this app. */}
              <Label htmlFor="enc-parent">Parent enclave</Label>
              <select
                id="enc-parent"
                className={SELECT_CLASS}
                value={form.parent_id}
                disabled={pending}
                onChange={(ev) =>
                  setForm({
                    ...form,
                    parent_id: ev.target.value ? Number(ev.target.value) : "",
                  })
                }
              >
                <option value="">None — top level</option>
                {parentOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="enc-class">Classification</Label>
              <select
                id="enc-class"
                className={SELECT_CLASS}
                value={form.classification}
                disabled={pending}
                onChange={(ev) =>
                  setForm({
                    ...form,
                    classification: ev.target.value as Classification | "",
                  })
                }
              >
                <option value="">None</option>
                {CLASSIFICATION_VALUES.map((c) => (
                  <option key={c} value={c}>
                    {CLASSIFICATION_LABELS[c]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                What this network is understood to carry. Descriptive only —
                nothing in the app is gated or ordered by it, and an enclave is
                still not the same thing as a classification. Leave as None for
                transport, which carries no marking of its own.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="enc-color">Color</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="enc-color"
                  className="w-32 font-mono"
                  placeholder="#3f7f3f"
                  value={form.color}
                  disabled={pending}
                  onChange={(ev) =>
                    setForm({ ...form, color: ev.target.value })
                  }
                />
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Use ${c}`}
                    className="size-6 rounded-full border border-border"
                    style={{ backgroundColor: c }}
                    disabled={pending}
                    onClick={() => setForm({ ...form, color: c })}
                  />
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Black is the transport layer — it renders as the foreground
                color so it reads in both light and dark. Leave empty for no
                color at all.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="enc-notes">Notes</Label>
              <Textarea
                id="enc-notes"
                rows={2}
                value={form.notes}
                disabled={pending}
                onChange={(ev) => setForm({ ...form, notes: ev.target.value })}
              />
            </div>

            {!editing && isAdmin && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={makeGlobal}
                  disabled={pending}
                  onChange={(ev) => setMakeGlobal(ev.target.checked)}
                />
                Add to the global list (shared across workspaces)
              </label>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={pending} onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={pending || !form.name.trim()}
                onClick={submit}
              >
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
