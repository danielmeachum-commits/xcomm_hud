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
import { GATEWAY_KINDS, gatewayKindLabel } from "@/lib/service-meta"
import { STATUS_VALUES, statusLabel } from "@/lib/status"
import type { GatewayKind, StatusValue } from "@/lib/types"

interface Props {
  siteId: number
}

export function GatewayForm({ siteId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    name: "",
    kind: "isp" as GatewayKind,
    provider: "",
    status: "unknown" as StatusValue,
    notes: "",
  })

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/sites/${siteId}/gateways`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          kind: draft.kind,
          provider: draft.provider || null,
          status: draft.status,
          notes: draft.notes || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to create gateway")
      }
      setOpen(false)
      setDraft({ name: "", kind: "isp", provider: "", status: "unknown", notes: "" })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">Add gateway</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add gateway</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Primary ISP"
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
                  setDraft({ ...draft, kind: e.target.value as GatewayKind })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              >
                {GATEWAY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {gatewayKindLabel(k)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
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
          <div className="space-y-1.5">
            <Label htmlFor="provider">Provider</Label>
            <Input
              id="provider"
              value={draft.provider}
              onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
              placeholder="Comcast, Starlink, Viasat…"
              disabled={pending}
            />
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
