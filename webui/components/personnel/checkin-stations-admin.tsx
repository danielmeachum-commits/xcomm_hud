"use client"

import { Copy, ExternalLink, KeyRound, ScanLine, Trash2 } from "lucide-react"
import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type {
  CheckinStation,
  CheckinStationMode,
  CheckinStationWithToken,
  Site,
} from "@/lib/types"

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

const MODES: { value: CheckinStationMode; label: string; hint: string }[] = [
  {
    value: "toggle",
    label: "In / out",
    hint: "Scan once to check in, again to check out",
  },
  { value: "in", label: "Entry only", hint: "Every scan checks in" },
  { value: "out", label: "Exit only", hint: "Every scan checks out" },
]

function kioskLink(token: string): string {
  // Fragment, not query: it never reaches a server log. The kiosk stores it
  // and strips it from the address bar on first load.
  return `${window.location.origin}/kiosk.html#token=${encodeURIComponent(token)}`
}

function ago(iso: string | null): string {
  if (!iso) return "never"
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return "just now"
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 129600) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

export function CheckinStationsAdmin({
  stations,
  sites,
}: {
  stations: CheckinStation[]
  sites: Site[]
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [siteId, setSiteId] = useState(sites[0]?.id.toString() ?? "")
  const [mode, setMode] = useState<CheckinStationMode>("toggle")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The one moment a token is visible: right after create / rotate.
  const [issued, setIssued] = useState<CheckinStationWithToken | null>(null)
  const [copied, setCopied] = useState(false)

  async function call(url: string, init: RequestInit) {
    const res = await fetch(`/api/be${url}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? "Request failed")
    }
    return res.status === 204 ? null : res.json()
  }

  async function create() {
    setPending(true)
    setError(null)
    try {
      const s = (await call("/checkin-stations", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          site_id: Number(siteId),
          mode,
        }),
      })) as CheckinStationWithToken
      setIssued(s)
      setCopied(false)
      setCreating(false)
      setName("")
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create")
    } finally {
      setPending(false)
    }
  }

  async function patch(s: CheckinStation, body: Partial<CheckinStation>) {
    try {
      await call(`/checkin-stations/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
      router.refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save")
    }
  }

  async function rotate(s: CheckinStation) {
    if (
      !confirm(
        `Issue a new token for "${s.name}"? The kiosk using the old one stops working until it's set up with the new link.`,
      )
    )
      return
    try {
      const out = (await call(`/checkin-stations/${s.id}/rotate-token`, {
        method: "POST",
      })) as CheckinStationWithToken
      setIssued(out)
      setCopied(false)
      router.refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to rotate")
    }
  }

  async function remove(s: CheckinStation) {
    if (!confirm(`Delete station "${s.name}"? Its history stays.`)) return
    try {
      await call(`/checkin-stations/${s.id}`, { method: "DELETE" })
      if (issued?.id === s.id) setIssued(null)
      router.refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Check-in stations
          </h1>
          <p className="max-w-2xl text-xs text-muted-foreground">
            A card reader at a door. Every CAC scanned there checks the person
            in or out at the station&apos;s site — and someone still checked in
            somewhere else is moved in the same step. Open the station&apos;s
            link on the kiosk computer with a USB barcode scanner plugged in;
            no login needed. People are matched by the DoD ID on their
            personnel record.
          </p>
        </div>
        {!creating && (
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            disabled={sites.length === 0}
          >
            Add station
          </Button>
        )}
      </div>

      {sites.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Add a site first — a station checks people in at one site.
        </p>
      )}

      {creating && (
        <div className="rounded-md border border-input p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="st-name">Name</Label>
              <Input
                id="st-name"
                value={name}
                placeholder="Main entry"
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-site">Site</Label>
              <select
                id="st-site"
                className={selectClass}
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={pending}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-mode">Scans</Label>
              <select
                id="st-mode"
                className={selectClass}
                value={mode}
                onChange={(e) => setMode(e.target.value as CheckinStationMode)}
                disabled={pending}
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {MODES.find((m) => m.value === mode)?.hint}
              </p>
            </div>
          </div>
          {error && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={create}
              disabled={pending || !name.trim() || !siteId}
            >
              {pending ? "Creating…" : "Create"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreating(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {issued && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium">
            Kiosk link for &ldquo;{issued.name}&rdquo; — shown only now
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Open it on the kiosk computer; it remembers the station after that.
            Anyone with this link can check people in and out at{" "}
            {issued.site_name}, so treat it like a password. Lost it? Issue a
            new token.
          </p>
          <div className="mt-2 flex gap-2">
            <Input readOnly value={kioskLink(issued.token)} className="font-mono text-xs" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(kioskLink(issued.token))
                setCopied(true)
              }}
            >
              <Copy className="size-4" /> {copied ? "Copied" : "Copy"}
            </Button>
            <a
              href={kioskLink(issued.token)}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              <ExternalLink className="size-4" /> Open
            </a>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setIssued(null)}
          >
            Done
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Station</th>
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2">Scans</th>
              <th className="px-3 py-2">Last seen</th>
              <th className="px-3 py-2">Token</th>
              <th className="w-1 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  <ScanLine className="mx-auto mb-1 size-5" />
                  No stations yet.
                </td>
              </tr>
            )}
            {stations.map((s) => (
              <tr key={s.id} className={s.disabled ? "opacity-50" : undefined}>
                <td className="px-3 py-2 font-medium">
                  {s.name}
                  {s.disabled && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      (disabled)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    className={selectClass}
                    value={s.site_id}
                    onChange={(e) =>
                      patch(s, { site_id: Number(e.target.value) })
                    }
                  >
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    className={selectClass}
                    value={s.mode}
                    onChange={(e) =>
                      patch(s, { mode: e.target.value as CheckinStationMode })
                    }
                  >
                    {MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {ago(s.last_seen_at)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  …{s.token_hint}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => patch(s, { disabled: !s.disabled })}
                  >
                    {s.disabled ? "Enable" : "Disable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Issue a new token (new kiosk link)"
                    onClick={() => rotate(s)}
                  >
                    <KeyRound className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Delete"
                    onClick={() => remove(s)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
