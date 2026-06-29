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
import { Label } from "@/components/ui/label"
import { statusBadgeClass, statusLabel } from "@/lib/status"
import type {
  ComponentRole,
  Equipment,
  Service,
  Site,
  StatusValue,
  UTC,
} from "@/lib/types"

const COMPONENT_ROLES: ComponentRole[] = [
  "primary",
  "backup",
  "uplink",
  "dependency",
]
const STATUS_VALUES: StatusValue[] = ["unknown", "up", "degraded", "down"]

interface Props {
  service: Service
  allEquipment: Equipment[]
  sites: Site[]
  utcs: UTC[]
}

export function ServiceDetailClient({ service, allEquipment, sites }: Props) {
  const router = useRouter()
  const componentIds = new Set(service.components.map((c) => c.equipment_id))
  const equipmentById = new Map(allEquipment.map((e) => [e.id, e]))
  const siteById = new Map(sites.map((s) => [s.id, s]))

  async function detach(equipmentId: number) {
    const res = await fetch(
      `/api/be/services/${service.id}/components/${equipmentId}`,
      { method: "DELETE" },
    )
    if (res.ok) router.refresh()
  }

  async function patchStatus(newStatus: StatusValue) {
    const res = await fetch(`/api/be/services/${service.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) router.refresh()
  }

  async function clearOverride() {
    const res = await fetch(`/api/be/services/${service.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear_manual_override: true }),
    })
    if (res.ok) router.refresh()
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{service.name}</h1>
          <p className="text-xs text-muted-foreground">
            {service.kind} · {service.hosting} ·{" "}
            {service.site_id
              ? siteById.get(service.site_id)?.name ?? `site ${service.site_id}`
              : "cross-site"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-md border px-2 py-1 text-xs uppercase tracking-wider ${statusBadgeClass(service.status)}`}
          >
            {statusLabel(service.status)}
            {service.manual_status_override ? " · manual" : ""}
          </span>
          <select
            value={service.status}
            onChange={(e) => patchStatus(e.target.value as StatusValue)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {STATUS_VALUES.map((v) => (
              <option key={v} value={v}>
                {statusLabel(v)}
              </option>
            ))}
          </select>
          {service.manual_status_override && (
            <Button variant="ghost" size="sm" onClick={clearOverride}>
              Clear override
            </Button>
          )}
        </div>
      </header>

      <section>
        <header className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Components</h2>
          <AttachComponentButton
            serviceId={service.id}
            allEquipment={allEquipment}
            siteById={siteById}
            excludedIds={componentIds}
          />
        </header>
        {service.components.length === 0 ? (
          <p className="text-xs text-muted-foreground">No components yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {service.components.map((c) => {
              const eq = equipmentById.get(c.equipment_id)
              return (
                <li
                  key={c.equipment_id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {eq?.name ?? `equipment ${c.equipment_id}`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {c.role}
                      {c.required ? " · required" : " · optional"}
                      {eq ? ` · ${statusLabel(eq.status)}` : ""}
                      {eq
                        ? ` · ${siteById.get(eq.site_id)?.name ?? "?"}`
                        : ""}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => detach(c.equipment_id)}
                  >
                    Detach
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function AttachComponentButton({
  serviceId,
  allEquipment,
  siteById,
  excludedIds,
}: {
  serviceId: number
  allEquipment: Equipment[]
  siteById: Map<number, Site>
  excludedIds: Set<number>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(formData: FormData) {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/services/${serviceId}/components`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipment_id: Number(formData.get("equipment_id")),
          role: String(formData.get("role") ?? "primary"),
          required: String(formData.get("required") ?? "true") === "true",
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to attach")
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  const candidates = allEquipment.filter((e) => !excludedIds.has(e.id))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Attach equipment</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach equipment</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="equipment_id">Equipment</Label>
            <select
              id="equipment_id"
              name="equipment_id"
              required
              disabled={pending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {candidates.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.kind}, {siteById.get(e.site_id)?.name ?? "?"})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                name="role"
                defaultValue="primary"
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {COMPONENT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="required">Required</Label>
              <select
                id="required"
                name="required"
                defaultValue="true"
                disabled={pending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="true">Required</option>
                <option value="false">Optional</option>
              </select>
            </div>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || candidates.length === 0}>
              {pending ? "Attaching…" : "Attach"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
