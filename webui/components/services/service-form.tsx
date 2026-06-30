"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
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
import { Textarea } from "@/components/ui/textarea"
import {
  GATEWAY_PACE_VALUES,
  SERVICE_CATEGORIES,
  SERVICE_REACH_VALUES,
  categoryLabel,
  paceLabel,
  paceShort,
  reachLabel,
  serviceIcon,
} from "@/lib/service-meta"
import { STATUS_VALUES, statusLabel, statusToIndicatorState } from "@/lib/status"
import { cn } from "@/lib/utils"
import type {
  GatewayPace,
  ServiceCategory,
  ServiceKind,
  ServiceReach,
  ServiceTemplate,
  Site,
  StatusValue,
} from "@/lib/types"

const KINDS: ServiceKind[] = ["voice", "data", "other"]

interface Props {
  sites: Site[]
  templates: ServiceTemplate[]
  defaultSiteId?: number
}

export function ServiceForm({ sites, templates, defaultSiteId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initial = {
    template_id: "" as string,
    service_template_id: null as number | null,
    name: "",
    site_id: defaultSiteId ?? sites[0]?.id ?? 0,
    kind: "other" as ServiceKind,
    category: "other" as ServiceCategory,
    reach: "local" as ServiceReach,
    icon: null as string | null,
    description: "",
    status: "unknown" as StatusValue,
    enabled_pace: [...GATEWAY_PACE_VALUES] as GatewayPace[],
  }
  const [draft, setDraft] = useState(initial)
  const Icon = serviceIcon(draft.icon, draft.kind)
  const siteFixed = defaultSiteId != null

  function pickTemplate(idStr: string) {
    if (!idStr) {
      setDraft({ ...draft, template_id: "", service_template_id: null })
      return
    }
    const t = templates.find((t) => String(t.id) === idStr)
    if (!t) return
    setDraft({
      ...draft,
      template_id: idStr,
      service_template_id: t.id,
      name: t.name,
      kind: t.kind,
      category: t.category,
      reach: t.reach,
      icon: t.icon,
      description: t.description ?? "",
    })
  }

  async function submit() {
    if (!draft.site_id) {
      setError("Pick a site first.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          site_id: draft.site_id,
          service_template_id: draft.service_template_id,
          kind: draft.kind,
          category: draft.category,
          reach: draft.reach,
          icon: draft.icon,
          description: draft.description || null,
          status: draft.status,
          enabled_pace: draft.reach === "external" ? draft.enabled_pace : [],
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to create service")
      }
      setOpen(false)
      setDraft(initial)
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
            <div className="flex items-center gap-2">
              <Icon className="size-5 shrink-0 text-muted-foreground" />
              <Input
                id="name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
                disabled={pending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              placeholder="What this service is and how it's verified"
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

          {draft.reach === "external" && (
            <div className="space-y-1.5">
              <Label>PACE tiers this service rides</Label>
              <div className="grid grid-cols-4 gap-2">
                {GATEWAY_PACE_VALUES.map((p) => {
                  const on = draft.enabled_pace.includes(p)
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          enabled_pace: on
                            ? draft.enabled_pace.filter((x) => x !== p)
                            : [...draft.enabled_pace, p],
                        })
                      }
                      className={cn(
                        "flex flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 text-xs transition-colors",
                        on
                          ? "border-foreground bg-accent"
                          : "border-input text-muted-foreground hover:bg-accent/50",
                      )}
                      disabled={pending}
                    >
                      <span className="text-sm font-semibold">{paceShort(p)}</span>
                      <span className="text-[10px]">{paceLabel(p)}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Edge to a gateway only renders when its PACE tier is enabled here.
              </p>
            </div>
          )}

          <div className={cn(siteFixed ? "" : "grid grid-cols-2 gap-3")}>
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
            {!siteFixed && (
              <div className="space-y-1.5">
                <Label htmlFor="site_id">Site</Label>
                <select
                  id="site_id"
                  value={draft.site_id}
                  onChange={(e) =>
                    setDraft({ ...draft, site_id: Number(e.target.value) })
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  disabled={pending}
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Initial status</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STATUS_VALUES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDraft({ ...draft, status: s })}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors",
                    draft.status === s
                      ? "border-foreground bg-accent"
                      : "border-input hover:bg-accent/50",
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
          <Button onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
