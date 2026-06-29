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
import { STATUS_VALUES, statusLabel } from "@/lib/status"
import type { ServiceHosting, ServiceKind, Site, StatusValue } from "@/lib/types"

const KINDS: ServiceKind[] = ["voip", "data", "video", "crypto", "other"]
const HOSTING: ServiceHosting[] = ["self", "cloud", "hybrid"]

interface Props {
  sites: Site[]
}

export function ServiceForm({ sites }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(formData: FormData) {
    setPending(true)
    setError(null)
    try {
      const siteRaw = String(formData.get("site_id") ?? "")
      const res = await fetch(`/api/be/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(formData.get("name") ?? ""),
          site_id: siteRaw ? Number(siteRaw) : null,
          kind: String(formData.get("kind") ?? "other"),
          hosting: String(formData.get("hosting") ?? "self"),
          status: String(formData.get("status") ?? "unknown") as StatusValue,
          notes: String(formData.get("notes") ?? "") || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to create service")
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
      <DialogTrigger render={<Button size="sm">Add service</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add service</DialogTitle>
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
                name="hosting"
                defaultValue="self"
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
              <Label htmlFor="site_id">Site</Label>
              <select
                id="site_id"
                name="site_id"
                defaultValue=""
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
