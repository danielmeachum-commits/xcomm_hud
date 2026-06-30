"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

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
import {
  SERVICE_CATEGORIES,
  SERVICE_REACH_VALUES,
  categoryLabel,
  reachLabel,
} from "@/lib/service-meta"
import { STATUS_VALUES, statusLabel } from "@/lib/status"
import type {
  ServiceCategory,
  ServiceHosting,
  ServiceKind,
  ServiceReach,
  ServiceTemplate,
  Site,
  StatusValue,
} from "@/lib/types"

const KINDS: ServiceKind[] = ["voip", "data", "video", "crypto", "other"]
const HOSTING: ServiceHosting[] = ["self", "cloud", "hybrid"]

interface Props {
  sites: Site[]
  templates: ServiceTemplate[]
  defaultSiteId?: number | null
}

export function ServiceForm({ sites, templates, defaultSiteId = null }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState({
    template_id: "" as string,
    name: "",
    site_id: defaultSiteId,
    kind: "other" as ServiceKind,
    hosting: "self" as ServiceHosting,
    category: "other" as ServiceCategory,
    reach: "local" as ServiceReach,
    icon: null as string | null,
    status: "unknown" as StatusValue,
  })

  function pickTemplate(idStr: string) {
    if (!idStr) {
      setDraft({ ...draft, template_id: "" })
      return
    }
    const t = templates.find((t) => String(t.id) === idStr)
    if (!t) return
    setDraft({
      ...draft,
      template_id: idStr,
      name: t.name,
      kind: t.kind,
      hosting: t.default_hosting,
      category: t.category,
      reach: t.reach,
      icon: t.icon,
    })
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          site_id: draft.site_id,
          kind: draft.kind,
          hosting: draft.hosting,
          category: draft.category,
          reach: draft.reach,
          icon: draft.icon,
          status: draft.status,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to create service")
      }
      setOpen(false)
      setDraft({
        template_id: "",
        name: "",
        site_id: defaultSiteId,
        kind: "other",
        hosting: "self",
        category: "other",
        reach: "local",
        icon: null,
        status: "unknown",
      })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Add service</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add service</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl">From template</Label>
            <select
              id="tpl"
              value={draft.template_id}
              onChange={(e) => pickTemplate(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={pending}
            >
              <option value="">(Custom — fill in below)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {categoryLabel(t.category)} · {reachLabel(t.reach)}
                </option>
              ))}
            </select>
          </div>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="kind">Kind</Label>
              <select
                id="kind"
                value={draft.kind}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as ServiceKind })
                }
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
              <Label htmlFor="hosting">Hosting</Label>
              <select
                id="hosting"
                value={draft.hosting}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    hosting: e.target.value as ServiceHosting,
                  })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                {HOSTING.map((h) => (
                  <option key={h} value={h}>
                    {h}
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
                  setDraft({
                    ...draft,
                    category: e.target.value as ServiceCategory,
                  })
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
              <Label htmlFor="reach">Reach</Label>
              <select
                id="reach"
                value={draft.reach}
                onChange={(e) =>
                  setDraft({ ...draft, reach: e.target.value as ServiceReach })
                }
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
              <Label htmlFor="site_id">Site</Label>
              <select
                id="site_id"
                value={draft.site_id ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    site_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                <option value="">(none / cross-site)</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Initial status</Label>
              <select
                id="status"
                value={draft.status}
                onChange={(e) =>
                  setDraft({ ...draft, status: e.target.value as StatusValue })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                {STATUS_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {statusLabel(v)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
