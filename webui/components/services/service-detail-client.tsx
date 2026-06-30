"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Breadcrumbs } from "@/components/breadcrumbs"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { ValidationHistory } from "@/components/services/validation-history"
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
import { formatLocal, formatZulu, timeAgo } from "@/lib/time"
import type {
  Service,
  ServiceCategory,
  ServiceKind,
  ServiceReach,
  Site,
  Validation,
} from "@/lib/types"

const KINDS: ServiceKind[] = ["voip", "data", "video", "crypto", "other"]

interface Props {
  service: Service
  sites: Site[]
  validations: Validation[]
}

export function ServiceDetailClient({ service, sites, validations }: Props) {
  const router = useRouter()
  const siteById = new Map(sites.map((s) => [s.id, s]))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    name: service.name,
    kind: service.kind,
    category: service.category,
    reach: service.reach,
    site_id: service.site_id,
    description: service.description ?? "",
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
          category: draft.category,
          reach: draft.reach,
          site_id: draft.site_id,
          description: draft.description || null,
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

  const siteName = sites.find((s) => s.id === service.site_id)?.name
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: "Sites", href: "/sites" },
          ...(siteName
            ? [{ label: siteName, href: `/sites/${service.site_id}` }]
            : []),
          { label: service.name },
        ]}
      />
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon className="size-7 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{service.name}</h1>
            <p className="text-xs text-muted-foreground">
              {categoryLabel(service.category)} · {reachLabel(service.reach)} ·{" "}
              {siteById.get(service.site_id)?.name ?? `site ${service.site_id}`}
            </p>
            {service.description && (
              <p className="mt-1 text-xs text-muted-foreground">
                {service.description}
              </p>
            )}
          </div>
        </div>
        <ServiceStatusPill
          serviceId={service.id}
          serviceName={service.name}
          status={service.status}
          effectiveStatus={service.effective_status}
          lastValidatedAt={service.validated_at}
          lastValidatedBy={service.validated_by_username}
          allowedStatuses={service.allowed_statuses}
        />
      </header>

      {service.validated_at && (
        <section className="rounded-md border bg-muted/30 p-3 text-xs">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Last validation
          </div>
          <div className="mt-1 grid grid-cols-2 gap-3 sm:max-w-md">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Local</div>
              <div className="font-mono">{formatLocal(service.validated_at)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Zulu</div>
              <div className="font-mono">{formatZulu(service.validated_at)}</div>
            </div>
          </div>
          <div className="mt-1 text-muted-foreground">
            {timeAgo(service.validated_at)}
            {service.validated_by_username ? ` · ${service.validated_by_username}` : ""}
          </div>
        </section>
      )}

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
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            disabled={pending}
            rows={2}
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

      <section>
        <h2 className="mb-2 text-sm font-semibold">Validation history</h2>
        <ValidationHistory validations={validations} />
      </section>
    </div>
  )
}
