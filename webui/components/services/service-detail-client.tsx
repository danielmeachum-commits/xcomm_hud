"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { Button } from "@/components/ui/button"
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
import type {
  Service,
  ServiceCategory,
  ServiceHosting,
  ServiceKind,
  ServiceReach,
  Site,
} from "@/lib/types"

const KINDS: ServiceKind[] = ["voip", "data", "video", "crypto", "other"]
const HOSTING: ServiceHosting[] = ["self", "cloud", "hybrid"]

interface Props {
  service: Service
  sites: Site[]
}

export function ServiceDetailClient({ service, sites }: Props) {
  const router = useRouter()
  const siteById = new Map(sites.map((s) => [s.id, s]))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    name: service.name,
    kind: service.kind,
    hosting: service.hosting,
    category: service.category,
    reach: service.reach,
    site_id: service.site_id,
    notes: service.notes ?? "",
  })

  const Icon = serviceIcon(service.icon, service.kind)

  async function save() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/services/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          kind: draft.kind,
          hosting: draft.hosting,
          category: draft.category,
          reach: draft.reach,
          site_id: draft.site_id,
          notes: draft.notes || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to save")
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete service "${service.name}"?`)) return
    const res = await fetch(`/api/be/services/${service.id}`, { method: "DELETE" })
    if (res.ok) router.push("/services")
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon className="size-7 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{service.name}</h1>
            <p className="text-xs text-muted-foreground">
              {categoryLabel(service.category)} · {reachLabel(service.reach)} ·{" "}
              {service.hosting}
              {service.site_id
                ? ` · ${siteById.get(service.site_id)?.name ?? `site ${service.site_id}`}`
                : " · cross-site"}
            </p>
          </div>
        </div>
        <ServiceStatusPill serviceId={service.id} status={service.status} size="lg" />
      </header>

      <section className="grid gap-4 sm:max-w-xl">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
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
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            disabled={pending}
            rows={3}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={remove} disabled={pending}>
            Delete
          </Button>
        </div>
      </section>
    </div>
  )
}
