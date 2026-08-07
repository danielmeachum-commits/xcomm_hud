"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { paceLabel, paceShort } from "@/lib/service-meta"
import { statusLabel } from "@/lib/status"
import { cn } from "@/lib/utils"
import type { DeliveryGatewayDependency, Gateway } from "@/lib/types"

interface Props {
  /** The DELIVERY id — one service at one site. */
  serviceId: number
  siteId: number
}

/**
 * Declares which transport paths a delivery needs.
 *
 * This is the §7 half of the dependency chain. Its real job is not adding a
 * vote but removing a double one: once a delivery depends on a gateway, any
 * capability that also backs that gateway stops counting separately, so a
 * shared radio can no longer appear in two "independent" redundancy groups.
 * The server does that suppression — see `_shadowed_capabilities`.
 *
 * Grouping is the same idea as on capability bindings: dependencies sharing a
 * key are OR'd, so putting the primary and the alternate in one group means
 * losing the primary reads degraded rather than down.
 */
export function GatewayDependencyEditor({ serviceId, siteId }: Props) {
  const router = useRouter()
  const [gateways, setGateways] = useState<Gateway[] | null>(null)
  const [deps, setDeps] = useState<DeliveryGatewayDependency[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [gwRes, depRes] = await Promise.all([
          fetch(`/api/be/sites/${siteId}/gateways`),
          fetch(`/api/be/services/${serviceId}/gateway-dependencies`),
        ])
        if (!gwRes.ok || !depRes.ok) throw new Error("Failed to load gateways")
        const [gw, dep] = await Promise.all([gwRes.json(), depRes.json()])
        if (cancelled) return
        setGateways(gw)
        setDeps(dep)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load gateways")
          setGateways([])
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [serviceId, siteId])

  async function write(
    gatewayId: number,
    next: { required: boolean; group_key: string | null } | null,
  ) {
    setPending(true)
    setError(null)
    try {
      const base = `/api/be/services/${serviceId}/gateway-dependencies/${gatewayId}`
      let res: Response
      if (next === null) {
        res = await fetch(base, { method: "DELETE" })
      } else {
        const qs = new URLSearchParams({ required: String(next.required) })
        if (next.group_key) qs.set("group_key", next.group_key)
        res = await fetch(`${base}?${qs}`, { method: "PUT" })
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail ?? `Request failed (${res.status})`)
      }
      const refreshed = await fetch(
        `/api/be/services/${serviceId}/gateway-dependencies`,
      )
      if (refreshed.ok) setDeps(await refreshed.json())
      // The chain moved, so anything showing a derived value is now stale.
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setPending(false)
    }
  }

  if (gateways === null) {
    return (
      <p className="text-[11px] text-muted-foreground">Loading gateways…</p>
    )
  }
  if (gateways.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No gateways at this site.
      </p>
    )
  }

  const byId = new Map(deps.map((d) => [d.gateway_id, d]))

  return (
    <div className="space-y-1.5">
      <Label>Transport paths this service depends on</Label>
      <ul className="flex flex-col gap-1">
        {gateways.map((g) => {
          const dep = byId.get(g.id)
          const on = dep !== undefined
          return (
            <li
              key={g.id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                on ? "border-foreground/40 bg-accent/40" : "border-input",
              )}
            >
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={pending}
                  onChange={(e) =>
                    write(
                      g.id,
                      e.target.checked
                        ? { required: true, group_key: null }
                        : null,
                    )
                  }
                />
                <span className="font-medium">{g.name}</span>
                <span
                  title={paceLabel(g.pace)}
                  className="rounded-full border border-border px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground"
                >
                  {paceShort(g.pace)}
                </span>
                <span className="text-muted-foreground">
                  {statusLabel(g.status as never)}
                </span>
              </label>

              {on && (
                <div className="flex items-center gap-2">
                  <Input
                    value={dep.group_key ?? ""}
                    placeholder="group (optional)"
                    disabled={pending}
                    onChange={(e) =>
                      setDeps((prev) =>
                        prev.map((d) =>
                          d.gateway_id === g.id
                            ? { ...d, group_key: e.target.value || null }
                            : d,
                        ),
                      )
                    }
                    onBlur={(e) =>
                      write(g.id, {
                        required: dep.required,
                        group_key: e.target.value || null,
                      })
                    }
                    className="h-7 w-36 text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    title={
                      dep.required
                        ? "Gates this service — click to make it context only"
                        : "Context only — click to make it required"
                    }
                    onClick={() =>
                      write(g.id, {
                        required: !dep.required,
                        group_key: dep.group_key,
                      })
                    }
                    className="h-7 px-2 text-[10px] uppercase tracking-wide"
                  >
                    {dep.required ? "Required" : "Context"}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Depending on a gateway is how a shared radio gets counted once. Paths
        sharing a group name are alternatives — one live path is enough.
      </p>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
