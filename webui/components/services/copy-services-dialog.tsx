"use client"

import { Copy } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { categoryLabel, paceShort } from "@/lib/service-meta"
import type { Gateway, Service, Site } from "@/lib/types"

/**
 * Copy services — and optionally gateways — from another site onto this one.
 *
 * Setting a site up meant adding every service and gateway by hand. This
 * brings another site's choices across in one go: the same services (each
 * joins the existing identity, so "NIPR Web" is still one service delivered at
 * both), their PACE tiers, reach, criticality and notes. Nothing copies a
 * status: a service at a new site starts unvalidated, a gateway at `ready`.
 */
export function CopyServicesDialog({
  site,
  sites,
  siteServices,
  siteGateways,
}: {
  site: Site
  sites: Site[]
  /** What this site already has — those are skipped, never duplicated. */
  siteServices: Service[]
  siteGateways: Gateway[]
}) {
  const router = useRouter()
  const others = useMemo(() => sites.filter((s) => s.id !== site.id), [sites, site.id])
  const [open, setOpen] = useState(false)
  const [fromSiteId, setFromSiteId] = useState<number | "">("")
  const [allServices, setAllServices] = useState<Service[]>([])
  const [allGateways, setAllGateways] = useState<Gateway[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [includeGateways, setIncludeGateways] = useState(true)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const haveService = useMemo(
    () => new Set(siteServices.map((s) => s.service_id)),
    [siteServices],
  )
  const haveGateway = useMemo(
    () => new Set(siteGateways.map((g) => g.name)),
    [siteGateways],
  )
  const sourceServices = allServices.filter((s) => s.site_id === fromSiteId)
  const sourceGateways = allGateways.filter((g) => g.site_id === fromSiteId)
  const newGateways = sourceGateways.filter((g) => !haveGateway.has(g.name))

  function pickSource(id: number, services: Service[] = allServices) {
    setFromSiteId(id)
    // Everything this site doesn't have yet, ticked — the usual intent.
    setSelected(
      new Set(
        services
          .filter((s) => s.site_id === id && !haveService.has(s.service_id))
          .map((s) => s.id),
      ),
    )
  }

  async function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setError(null)
    setLoading(true)
    try {
      const [svcRes, gwRes] = await Promise.all([
        fetch("/api/be/services"),
        fetch("/api/be/gateways"),
      ])
      if (!svcRes.ok || !gwRes.ok) throw new Error("Couldn't load the other sites.")
      const services = (await svcRes.json()) as Service[]
      setAllServices(services)
      setAllGateways((await gwRes.json()) as Gateway[])
      // Default to the site with the most services to copy from.
      const best = [...others].sort(
        (a, b) =>
          services.filter((s) => s.site_id === b.id).length -
          services.filter((s) => s.site_id === a.id).length,
      )[0]
      if (best) pickSource(best.id, services)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the other sites.")
    } finally {
      setLoading(false)
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copyingGateways = includeGateways && newGateways.length > 0
  const nothingToDo = selected.size === 0 && !copyingGateways

  async function submit() {
    if (fromSiteId === "" || nothingToDo) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/be/services/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_site_id: fromSiteId,
          to_site_id: site.id,
          // Always explicit: [] copies no services (gateways only).
          delivery_ids: [...selected],
          include_gateways: includeGateways,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(typeof body.detail === "string" ? body.detail : "Copy failed")
      }
      await res.json()
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed")
    } finally {
      setPending(false)
    }
  }

  if (others.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5">
            <Copy className="size-3.5" />
            Copy from site…
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy services to {site.name}</DialogTitle>
          <DialogDescription>
            Brings another site&apos;s services across with their PACE tiers and
            criticality. Copies start unvalidated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="copy-from">From</Label>
          <select
            id="copy-from"
            value={fromSiteId}
            onChange={(e) => pickSource(Number(e.target.value))}
            disabled={loading || pending}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-medium">Services</div>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : sourceServices.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              That site has no services.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {sourceServices.map((s) => {
                const here = haveService.has(s.service_id)
                return (
                  <li key={s.id}>
                    <label
                      className={`flex items-center gap-2 px-3 py-2 text-sm ${here ? "opacity-50" : "cursor-pointer"}`}
                    >
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={!here && selected.has(s.id)}
                        disabled={here || pending}
                        onChange={() => toggle(s.id)}
                      />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {here
                          ? "already here"
                          : `${categoryLabel(s.category)} · ${s.enabled_pace.map(paceShort).join("") || "no PACE"}`}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {sourceGateways.length > 0 && (
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={includeGateways}
              disabled={pending}
              onChange={(e) => setIncludeGateways(e.target.checked)}
            />
            <span className="min-w-0">
              Also copy its gateways
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {sourceGateways
                  .map(
                    (g) =>
                      `${g.name} (${paceShort(g.pace)})${haveGateway.has(g.name) ? " - already here" : ""}`,
                  )
                  .join(", ")}
              </span>
            </span>
          </label>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || loading || nothingToDo}>
            {pending
              ? "Copying…"
              : `Copy ${selected.size} service${selected.size === 1 ? "" : "s"}${
                  copyingGateways
                    ? ` + ${newGateways.length} gateway${newGateways.length === 1 ? "" : "s"}`
                    : ""
                }`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
