"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { ClipboardList, Settings } from "lucide-react"

import { PageBreadcrumbs } from "@/components/breadcrumbs"
import { ServiceStatusPill } from "@/components/services/service-status-pill"
import { ValidationHistory } from "@/components/services/validation-history"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ViewTabs } from "@/components/ui/view-tabs"
import {
  GATEWAY_PACE_VALUES,
  ICON_MAP,
  ICON_NAMES,
  SERVICE_CATEGORIES,
  SERVICE_REACH_VALUES,
  categoryLabel,
  paceLabel,
  paceShort,
  reachLabel,
  serviceIcon,
} from "@/lib/service-meta"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"
import type {
  Event,
  GatewayPace,
  Me,
  Service,
  ServiceCategory,
  ServiceKind,
  ServiceReach,
  Site,
} from "@/lib/types"

const KINDS: ServiceKind[] = ["voice", "data", "other"]

type Tab = "details" | "history"

interface Props {
  me: Me
  service: Service
  sites: Site[]
  validations: Event[]
}

function makeDraft(service: Service) {
  return {
    name: service.name,
    icon: service.icon ?? null as string | null,
    kind: service.kind,
    category: service.category,
    reach: service.reach,
    site_id: service.site_id,
    description: service.description ?? "",
    notes: service.notes ?? "",
    connects_externally:
      service.reach === "external" ||
      (service.enabled_pace?.length ?? 0) > 0,
    enabled_pace:
      service.enabled_pace && service.enabled_pace.length > 0
        ? [...service.enabled_pace]
        : [...GATEWAY_PACE_VALUES],
  }
}

type Draft = ReturnType<typeof makeDraft>

export function ServiceDetailClient({ me, service, sites, validations }: Props) {
  const router = useRouter()
  const { w } = useWorkspace()
  const siteById = new Map(sites.map((s) => [s.id, s]))
  const [tab, setTab] = useState<Tab>("details")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() => makeDraft(service))

  const canDelete = me.role === "admin"
  const Icon = serviceIcon(draft.icon, draft.kind)

  async function save(overrides: Partial<Draft> = {}) {
    const cur = { ...draft, ...overrides }
    const savePace = cur.reach === "external" || cur.connects_externally
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/services/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cur.name,
          icon: cur.icon || null,
          kind: cur.kind,
          category: cur.category,
          reach: cur.reach,
          site_id: cur.site_id,
          description: cur.description || null,
          notes: cur.notes || null,
          enabled_pace: savePace ? cur.enabled_pace : [],
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
    if (res.ok) router.push(w("/services"))
  }

  function updateSelect<K extends keyof Draft>(key: K, value: Draft[K]) {
    const next = { ...draft, [key]: value }
    setDraft(next)
    save({ [key]: value } as Partial<Draft>)
  }

  const siteName = sites.find((s) => s.id === service.site_id)?.name
  const showsPaceConfig = draft.reach === "external" || draft.connects_externally

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Sites", href: w("/sites") },
          ...(siteName
            ? [{ label: siteName, href: w(`/sites/${service.site_id}`) }]
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

      <ViewTabs<Tab>
        value={tab}
        onChange={setTab}
        variant="line"
        options={[
          { value: "details", label: "Details", icon: Settings },
          { value: "history", label: "Validation history", icon: ClipboardList },
        ]}
      />

      {tab === "details" ? (
        <section className="grid gap-4 sm:max-w-xl">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onBlur={(e) => save({ name: e.target.value })}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-1.5">
              {ICON_NAMES.map((name) => {
                const IconOption = ICON_MAP[name]
                const selected = draft.icon === name
                return (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    onClick={() => {
                      const icon = selected ? null : name
                      setDraft({ ...draft, icon })
                      save({ icon })
                    }}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                      selected
                        ? "border-foreground bg-accent"
                        : "border-input text-muted-foreground hover:bg-accent/50",
                    )}
                    disabled={pending}
                  >
                    <IconOption className="size-4" />
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Click to select; click again to clear (uses kind default).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              onBlur={(e) => save({ description: e.target.value })}
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
                onChange={(e) => updateSelect("kind", e.target.value as ServiceKind)}
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
              <Label htmlFor="reach">Service origination</Label>
              <select
                id="reach"
                value={draft.reach}
                onChange={(e) => updateSelect("reach", e.target.value as ServiceReach)}
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
          {draft.reach === "local" && (
            <label className="inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={draft.connects_externally}
                onChange={(e) => updateSelect("connects_externally", e.target.checked)}
                disabled={pending}
              />
              Connects externally (rides one or more gateways)
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
                value={draft.category}
                onChange={(e) => updateSelect("category", e.target.value as ServiceCategory)}
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
                onChange={(e) => updateSelect("site_id", Number(e.target.value))}
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
          {showsPaceConfig && (
            <div className="space-y-1.5">
              <Label>PACE tiers this service rides</Label>
              <div className="grid grid-cols-4 gap-2">
                {GATEWAY_PACE_VALUES.map((p) => {
                  const on = draft.enabled_pace.includes(p)
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        const enabled_pace = on
                          ? draft.enabled_pace.filter((x: GatewayPace) => x !== p)
                          : [...draft.enabled_pace, p]
                        setDraft({ ...draft, enabled_pace })
                        save({ enabled_pace })
                      }}
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
                Canvas edges only render to gateways at an enabled PACE tier.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              onBlur={(e) => save({ notes: e.target.value })}
              disabled={pending}
              rows={3}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {canDelete && (
            <div>
              <Button variant="ghost" onClick={remove} disabled={pending} className="text-destructive hover:text-destructive">
                Delete service
              </Button>
            </div>
          )}
        </section>
      ) : (
        <ValidationHistory validations={validations} />
      )}
    </div>
  )
}
