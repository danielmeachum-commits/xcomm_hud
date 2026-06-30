"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Edit3, Plus, Trash2 } from "lucide-react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
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
import {
  SERVICE_CATEGORIES,
  SERVICE_REACH_VALUES,
  categoryLabel,
  reachLabel,
  serviceIcon,
} from "@/lib/service-meta"
import { STATUS_VALUES, statusLabel, statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type {
  ServiceCategory,
  ServiceKind,
  ServiceReach,
  ServiceTemplate,
  StatusValue,
} from "@/lib/types"

const KINDS: ServiceKind[] = ["voip", "data", "video", "crypto", "other"]
const ICON_OPTIONS = [
  "globe",
  "shield",
  "phone",
  "phone-call",
  "message-square",
  "lock",
  "folder",
  "printer",
  "cloud",
  "router",
  "satellite",
  "antenna",
  "network",
  "radio",
  "database",
  "video",
  "key-round",
  "boxes",
]

interface Props {
  templates: ServiceTemplate[]
}

export function ServiceTypesAdmin({ templates }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState<ServiceTemplate | null>(null)
  const [creating, setCreating] = useState(false)

  async function remove(id: number, name: string) {
    if (!confirm(`Delete service type "${name}"? Existing instances are kept but lose the link.`)) return
    const res = await fetch(`/api/be/service-templates/${id}`, { method: "DELETE" })
    if (res.ok) router.refresh()
  }

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New type
        </Button>
      </div>
      <div className="overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left">Reach</th>
              <th className="px-3 py-2 text-left">Allowed statuses</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const Icon = serviceIcon(t.icon, t.kind)
              return (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{t.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{t.kind}</td>
                  <td className="px-3 py-2">{categoryLabel(t.category)}</td>
                  <td className="px-3 py-2">{reachLabel(t.reach)}</td>
                  <td className="px-3 py-2">
                    {t.allowed_statuses && t.allowed_statuses.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {t.allowed_statuses.map((s) => (
                          <span
                            key={s}
                            className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
                          >
                            <StatusIndicator state={statusToIndicatorState(s)} size="sm" />
                            {statusLabel(s)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">All allowed</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {t.description ?? ""}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                        <Edit3 className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove(t.id, t.name)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {templates.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No service types yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <TemplateDialog
          template={editing}
          onClose={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      )}
    </>
  )
}

function TemplateDialog({
  template,
  onClose,
}: {
  template: ServiceTemplate | null
  onClose: () => void
}) {
  const router = useRouter()
  const editing = template !== null
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    name: template?.name ?? "",
    kind: (template?.kind ?? "other") as ServiceKind,
    category: (template?.category ?? "other") as ServiceCategory,
    reach: (template?.reach ?? "local") as ServiceReach,
    icon: template?.icon ?? "",
    description: template?.description ?? "",
    allowed_statuses: (template?.allowed_statuses ?? null) as StatusValue[] | null,
  })

  function toggleAllowed(s: StatusValue) {
    const current = draft.allowed_statuses ?? STATUS_VALUES.slice()
    const next = current.includes(s)
      ? current.filter((x) => x !== s)
      : [...current, s]
    setDraft({
      ...draft,
      allowed_statuses: next.length === STATUS_VALUES.length ? null : next,
    })
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const body = {
        name: draft.name,
        kind: draft.kind,
        category: draft.category,
        reach: draft.reach,
        icon: draft.icon || null,
        description: draft.description || null,
        allowed_statuses: draft.allowed_statuses,
      }
      const url = editing
        ? `/api/be/service-templates/${template!.id}`
        : `/api/be/service-templates`
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

  const allowedSet = new Set(draft.allowed_statuses ?? STATUS_VALUES)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${template!.name}` : "New service type"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              disabled={pending}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="kind">Kind</Label>
              <select
                id="kind"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as ServiceKind })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reach">Reach</Label>
              <select
                id="reach"
                value={draft.reach}
                onChange={(e) => setDraft({ ...draft, reach: e.target.value as ServiceReach })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                {SERVICE_REACH_VALUES.map((r) => (
                  <option key={r} value={r}>
                    {reachLabel(r)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value as ServiceCategory })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="icon">Icon</Label>
              <select
                id="icon"
                value={draft.icon}
                onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                <option value="">(default from kind)</option>
                {ICON_OPTIONS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Allowed statuses</Label>
            <p className="text-[10px] text-muted-foreground">
              Toggle which statuses are valid when validating instances of this type.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STATUS_VALUES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleAllowed(s)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors",
                    allowedSet.has(s)
                      ? "border-foreground bg-accent"
                      : "border-input opacity-50 hover:opacity-100",
                  )}
                  disabled={pending}
                >
                  <StatusIndicator state={statusToIndicatorState(s)} size="sm" />
                  {statusLabel(s)}
                </button>
              ))}
            </div>
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
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
