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
import { Textarea } from "@/components/ui/textarea"
import { GATEWAY_KINDS, gatewayKindLabel } from "@/lib/service-meta"
import { STATUS_VALUES, statusLabel } from "@/lib/status"
import type { Gateway, GatewayKind, StatusValue } from "@/lib/types"

interface Props {
  siteId: number
  /** When provided, the form edits this gateway (PATCH) instead of creating. */
  gateway?: Gateway
  triggerLabel?: string
  triggerSize?: "sm" | "md"
}

export function GatewayForm({ siteId, gateway, triggerLabel, triggerSize = "sm" }: Props) {
  const router = useRouter()
  const editing = !!gateway
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    name: gateway?.name ?? "",
    kind: (gateway?.kind ?? "isp") as GatewayKind,
    provider: gateway?.provider ?? "",
    status: (gateway?.status ?? "unknown") as StatusValue,
    notes: gateway?.notes ?? "",
  })

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const url = editing
        ? `/api/be/gateways/${gateway!.id}`
        : `/api/be/sites/${siteId}/gateways`
      const method = editing ? "PATCH" : "POST"
      const body: Record<string, unknown> = {
        name: draft.name,
        kind: draft.kind,
        provider: draft.provider || null,
        notes: draft.notes || null,
      }
      if (!editing) {
        body.status = draft.status
      }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail ?? "Failed to save gateway")
      }
      setOpen(false)
      if (!editing) {
        setDraft({ name: "", kind: "isp", provider: "", status: "unknown", notes: "" })
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size={triggerSize} variant="outline">
            {triggerLabel ?? (editing ? "Edit gateway" : "Add gateway")}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${gateway!.name}` : "Add gateway"}</DialogTitle>
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
          <div className={editing ? "" : "grid grid-cols-2 gap-3"}>
            <div className="space-y-1.5">
              <Label htmlFor="kind">Kind</Label>
              <select
                id="kind"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as GatewayKind })}
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
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="status">Initial status</Label>
                <select
                  id="status"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as StatusValue })}
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
            )}
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
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={2}
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
            {pending ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
