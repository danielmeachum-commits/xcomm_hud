"use client"

import { useMemo, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  GATEWAY_STATUS_VALUES,
  SERVICE_STATUS_VALUES,
  SITE_STATUS_VALUES,
  statusLabel,
} from "@/lib/status"
import {
  emconLabel,
  fpconLabel,
} from "@/lib/threat-level"
import { cn } from "@/lib/utils"
import type {
  AnyStatus,
  Emcon,
  Event,
  EventType,
  Fpcon,
  Gateway,
  Service,
  Site,
  SubjectKind,
} from "@/lib/types"

const FPCON_LEVELS: AnyStatus[] = ["normal", "alpha", "bravo", "charlie", "delta"]
const EMCON_LEVELS: AnyStatus[] = ["a", "b", "c", "d"]

const FPCON_SET = new Set<string>(FPCON_LEVELS)
const EMCON_SET = new Set<string>(EMCON_LEVELS)

function labelForStatus(value: AnyStatus): string {
  if (FPCON_SET.has(value)) return `FPCON ${fpconLabel(value as Fpcon)}`
  if (EMCON_SET.has(value)) return `EMCON ${emconLabel(value as Emcon)}`
  return statusLabel(value)
}

function statusOptionsFor(kind: SubjectKind): AnyStatus[] {
  switch (kind) {
    case "service":
    case "service_gateway":
    case "site":
      return SERVICE_STATUS_VALUES
    case "gateway":
      return GATEWAY_STATUS_VALUES
    case "site_status":
      return SITE_STATUS_VALUES
    case "site_fpcon":
      return FPCON_LEVELS
    case "site_emcon":
      return EMCON_LEVELS
    case "system":
    case "mission":
    case "exercise":
      return [...SERVICE_STATUS_VALUES]
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  sites: Site[]
  services: Service[]
  gateways: Gateway[]
  onCreated: (v: Event) => void
}

export function EventCreateDialog({
  open,
  onOpenChange,
  sites,
  services,
  gateways,
  onCreated,
}: Props) {
  const [eventType, setEventType] = useState<EventType>("validation")
  const [kind, setKind] = useState<SubjectKind>("service")
  const [subjectId, setSubjectId] = useState<string>("")
  const [subjectLabel, setSubjectLabel] = useState<string>("")
  const [status, setStatus] = useState<AnyStatus | "">("up")
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subjectOptions = useMemo(() => {
    switch (kind) {
      case "service":
        return services.map((s) => ({
          id: s.id,
          label: `${s.name}${s.site_id ? ` — ${siteName(sites, s.site_id)}` : ""}`,
        }))
      case "gateway":
        return gateways.map((g) => ({
          id: g.id,
          label: `${g.name} — ${siteName(sites, g.site_id)}`,
        }))
      case "site":
      case "site_status":
      case "site_fpcon":
      case "site_emcon":
        return sites.map((s) => ({ id: s.id, label: s.name }))
      default:
        return []
    }
  }, [kind, services, gateways, sites])

  const statusOptions = useMemo(() => statusOptionsFor(kind), [kind])

  function reset() {
    setEventType("validation")
    setKind("service")
    setSubjectId("")
    setSubjectLabel("")
    setStatus("up")
    setNote("")
    setError(null)
  }

  function switchEventType(next: EventType) {
    setEventType(next)
    if (next === "validation") {
      setKind("service")
      setStatus("up")
    } else {
      setKind("system")
      setStatus("")
    }
    setSubjectId("")
    setSubjectLabel("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (eventType === "validation") {
      if (!subjectId) {
        setError("Pick a subject.")
        return
      }
      if (!status) {
        setError("Pick a status.")
        return
      }
    } else {
      if (!subjectLabel.trim()) {
        setError("Enter a subject.")
        return
      }
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/be/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: eventType,
          subject_kind: kind,
          subject_id:
            eventType === "validation" ? Number(subjectId) : null,
          subject_label:
            eventType === "general" ? subjectLabel.trim() : null,
          status: status || null,
          note: note.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Create failed (${res.status})`)
      }
      const created = (await res.json()) as Event
      onCreated(created)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log new event</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-1 rounded-md border border-input bg-muted/30 p-1 text-sm">
            <TabButton
              active={eventType === "validation"}
              onClick={() => switchEventType("validation")}
            >
              Validation
            </TabButton>
            <TabButton
              active={eventType === "general"}
              onClick={() => switchEventType("general")}
            >
              General
            </TabButton>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <select
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as SubjectKind
                  setKind(k)
                  setSubjectId("")
                  setStatus(
                    eventType === "validation" ? statusOptionsFor(k)[0] : "",
                  )
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {eventType === "validation" ? (
                  <>
                    <option value="service">Service</option>
                    <option value="gateway">Gateway</option>
                    <option value="site">Site</option>
                    <option value="site_fpcon">Site FPCON</option>
                    <option value="site_emcon">Site EMCON</option>
                  </>
                ) : (
                  <>
                    <option value="system">System</option>
                    <option value="mission">Mission</option>
                    <option value="exercise">Exercise</option>
                  </>
                )}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>
                Status
                {eventType === "general" && (
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    (optional)
                  </span>
                )}
              </Label>
              <select
                value={status}
                onChange={(e) =>
                  setStatus((e.target.value as AnyStatus | "") || "")
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {eventType === "general" && (
                  <option value="">— none —</option>
                )}
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {labelForStatus(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Subject</Label>
            {eventType === "validation" ? (
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select a subject…</option>
                {subjectOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={subjectLabel}
                onChange={(e) => setSubjectLabel(e.target.value)}
                placeholder={
                  kind === "system"
                    ? "e.g. NIPR Access, HF Radio, etc."
                    : kind === "mission"
                      ? "Mission name or ID"
                      : "Exercise name"
                }
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional context or reason for this event."
              className="min-h-20"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Log event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-md text-xs font-medium",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function siteName(sites: Site[], siteId: number): string {
  return sites.find((s) => s.id === siteId)?.name ?? `site ${siteId}`
}
