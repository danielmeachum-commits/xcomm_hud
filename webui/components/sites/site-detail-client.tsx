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
import { statusBadgeClass, statusLabel } from "@/lib/status"
import type {
  Equipment,
  EquipmentKind,
  Site,
  StatusValue,
  UTC,
} from "@/lib/types"

interface Props {
  site: Site
  initialUtcs: UTC[]
  initialEquipment: Equipment[]
}

const EQUIPMENT_KINDS: EquipmentKind[] = [
  "router",
  "switch",
  "server",
  "crypto",
  "phone",
  "other",
]
const STATUS_VALUES: StatusValue[] = ["unknown", "up", "degraded", "down"]

export function SiteDetailClient({ site, initialUtcs, initialEquipment }: Props) {
  const router = useRouter()
  const utcs = initialUtcs
  const equipment = initialEquipment

  const grouped = new Map<number | "shared", Equipment[]>()
  for (const eq of equipment) {
    const key: number | "shared" = eq.utc_id ?? "shared"
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(eq)
  }
  const sharedBucket = grouped.get("shared") ?? []

  async function patchEquipmentStatus(eqId: number, status: StatusValue) {
    const res = await fetch(`/api/be/equipment/${eqId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (res.ok) router.refresh()
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{site.name}</h1>
          <p className="text-xs text-muted-foreground">
            {site.location_label ?? "—"} · Classification {site.classification} ·{" "}
            {statusLabel(site.status)}
          </p>
        </div>
        <div className="flex gap-2">
          <AddUtcButton siteId={site.id} />
          <AddEquipmentButton siteId={site.id} utcs={utcs} />
        </div>
      </header>

      <section className="space-y-4">
        {utcs.map((utc) => {
          const items = grouped.get(utc.id) ?? []
          return (
            <UtcSection
              key={utc.id}
              title={`UTC ${utc.designation}${utc.name ? ` — ${utc.name}` : ""}`}
              status={utc.status}
              items={items}
              onStatusChange={patchEquipmentStatus}
            />
          )
        })}
        <UtcSection
          title="Shared / unassigned"
          status="unknown"
          items={sharedBucket}
          onStatusChange={patchEquipmentStatus}
        />
      </section>
    </div>
  )
}

function UtcSection({
  title,
  status,
  items,
  onStatusChange,
}: {
  title: string
  status: StatusValue
  items: Equipment[]
  onStatusChange: (id: number, status: StatusValue) => void
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${statusBadgeClass(status)}`}
    >
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs uppercase tracking-wider">
          {statusLabel(status)}
        </span>
      </header>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No equipment.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((eq) => (
            <li
              key={eq.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <div className="flex flex-col">
                <span className="font-medium">{eq.name}</span>
                <span className="text-xs text-muted-foreground">
                  {eq.kind}
                  {eq.vendor ? ` · ${eq.vendor}` : ""}
                  {eq.model ? ` ${eq.model}` : ""}
                  {eq.manual_status_override ? " · manual override" : ""}
                </span>
              </div>
              <select
                value={eq.status}
                onChange={(e) =>
                  onStatusChange(eq.id, e.target.value as StatusValue)
                }
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                {STATUS_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {statusLabel(v)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddUtcButton({ siteId }: { siteId: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(formData: FormData) {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/sites/${siteId}/utcs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designation: String(formData.get("designation") ?? ""),
          name: String(formData.get("name") ?? "") || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to create UTC")
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">Add UTC</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add UTC</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="designation">Designation</Label>
            <Input id="designation" name="designation" required disabled={pending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name (optional)</Label>
            <Input id="name" name="name" disabled={pending} />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddEquipmentButton({
  siteId,
  utcs,
}: {
  siteId: number
  utcs: UTC[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(formData: FormData) {
    setPending(true)
    setError(null)
    try {
      const utcRaw = String(formData.get("utc_id") ?? "")
      const res = await fetch(`/api/be/equipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          utc_id: utcRaw ? Number(utcRaw) : null,
          name: String(formData.get("name") ?? ""),
          kind: String(formData.get("kind") ?? "other"),
          vendor: String(formData.get("vendor") ?? "") || null,
          model: String(formData.get("model") ?? "") || null,
          status: String(formData.get("status") ?? "unknown"),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to create equipment")
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Add equipment</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add equipment</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required disabled={pending} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="kind">Kind</Label>
              <select
                id="kind"
                name="kind"
                defaultValue="other"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                {EQUIPMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="utc_id">UTC</Label>
              <select
                id="utc_id"
                name="utc_id"
                defaultValue=""
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                <option value="">(shared / unassigned)</option>
                {utcs.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.designation}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vendor">Vendor</Label>
              <Input id="vendor" name="vendor" disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model">Model</Label>
              <Input id="model" name="model" disabled={pending} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue="unknown"
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
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
