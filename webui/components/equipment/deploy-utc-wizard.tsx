"use client"

import { Check, Plus, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { CAPABILITY_LABELS, UTC_ROLE_LABELS } from "@/lib/equipment-meta"
import { cn } from "@/lib/utils"
import type {
  CapabilityKind,
  EquipmentType,
  Gateway,
  PackageDef,
  PackageInstance,
  Service,
  Site,
  UtcDef,
  UtcDeployPayload,
  UtcRole,
} from "@/lib/types"

const STEPS = [
  { key: "package", label: "Package" },
  { key: "utc", label: "UTC" },
  { key: "site", label: "Site & role" },
  { key: "items", label: "Serialized" },
  { key: "bulk", label: "Bulk" },
  { key: "wiring", label: "Wiring" },
  { key: "review", label: "Review" },
] as const

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

interface ItemDraft {
  equipment_type_id: number
  serial_number: string
  equipment_code: string
  /** Which declared capabilities this particular kit actually has. */
  capability_kinds: string[]
}

interface BulkDraft {
  equipment_type_id: number
  authorized_qty: number
  on_hand_qty: number
}

/** `<prefix><last 4 of serial>`, mirroring api/equipment_codes.py so the
 *  wizard shows the same ID the server would generate. */
function proposeCode(type: EquipmentType | undefined, serial: string): string {
  const prefix = (type?.id_prefix || "R").toUpperCase()
  const cleaned = serial.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return cleaned ? `${prefix}${cleaned.slice(-4)}` : prefix
}

interface Props {
  sites: Site[]
  types: EquipmentType[]
  utcDefs: UtcDef[]
  packages: PackageInstance[]
  packageDefs: PackageDef[]
  services: Service[]
  gateways: Gateway[]
}

export function DeployUtcWizard({
  sites,
  types,
  utcDefs,
  packages,
  packageDefs,
  services,
  gateways,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [maxVisited, setMaxVisited] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // step 1 — package
  const [packageMode, setPackageMode] = useState<"existing" | "new" | "none">(
    "new",
  )
  const [packageId, setPackageId] = useState<number | "">("")
  const [newPackageName, setNewPackageName] = useState("")
  const [newPackageDefId, setNewPackageDefId] = useState<number | "">("")
  // step 2 — UTC definition
  const [utcDefId, setUtcDefId] = useState<number | "">("")
  // step 3 — site & role
  const [siteId, setSiteId] = useState<number | "">("")
  const [name, setName] = useState("")
  const [role, setRole] = useState<UtcRole>("independent")
  // steps 4/5 — contents
  const [items, setItems] = useState<ItemDraft[]>([])
  const [bulk, setBulk] = useState<BulkDraft[]>([])
  // step 6 — wiring: "<itemIndex>:<kind>" -> {service|gateway}:<id>
  const [wiring, setWiring] = useState<Record<string, string>>({})

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])
  const selectedUtcDef = utcDefId ? utcDefs.find((d) => d.id === utcDefId) : null
  const siteServices = services.filter((s) => s.site_id === siteId)
  const siteGateways = gateways.filter((g) => g.site_id === siteId)

  function reset() {
    setStep(0)
    setMaxVisited(0)
    setPackageMode("new")
    setPackageId("")
    setNewPackageName("")
    setNewPackageDefId("")
    setUtcDefId("")
    setSiteId("")
    setName("")
    setRole("independent")
    setItems([])
    setBulk([])
    setWiring({})
    setError(null)
  }

  function goTo(i: number) {
    if (i <= maxVisited) setStep(i)
  }

  function next() {
    const n = Math.min(step + 1, STEPS.length - 1)
    setStep(n)
    setMaxVisited((m) => Math.max(m, n))
  }

  /** Prefill contents from the chosen UTC's bill of materials — this is the
   *  payoff for declaring capabilities in the catalog: the operator confirms
   *  and types serials rather than building the list from nothing. */
  function applyUtcDef(defId: number | "") {
    setUtcDefId(defId)
    if (!defId) return
    const def = utcDefs.find((d) => d.id === defId)
    if (!def) return
    const nextItems: ItemDraft[] = []
    const nextBulk: BulkDraft[] = []
    for (const line of def.lines) {
      const t = typeById.get(line.equipment_type_id)
      if (!t) continue
      if (t.serialized) {
        // One row per unit — each needs its own serial.
        for (let i = 0; i < line.quantity; i++) {
          nextItems.push({
            equipment_type_id: t.id,
            serial_number: "",
            equipment_code: "",
            capability_kinds: t.capabilities
              .filter((c) => c.materialize_by_default)
              .map((c) => c.kind),
          })
        }
      } else {
        nextBulk.push({
          equipment_type_id: t.id,
          authorized_qty: line.quantity,
          on_hand_qty: line.quantity,
        })
      }
    }
    setItems(nextItems)
    setBulk(nextBulk)
  }

  /** Propose bindings by matching each item's capabilities against the
   *  site's existing services and gateways. Suggestions only — the operator
   *  unchecks what doesn't apply on the wiring step. */
  function proposeWiring(targetSiteId: number) {
    const proposals: Record<string, string> = {}
    const svc = services.filter((s) => s.site_id === targetSiteId)
    const gws = gateways.filter((g) => g.site_id === targetSiteId)
    items.forEach((item, index) => {
      const t = typeById.get(item.equipment_type_id)
      if (!t) return
      for (const kind of item.capability_kinds) {
        // Service kinds and capability kinds share vocabulary for voice/data,
        // which is exactly the common case worth auto-proposing.
        if (kind === "voice" || kind === "data") {
          const match = svc.find((s) => s.kind === kind)
          if (match) proposals[`${index}:${kind}`] = `service:${match.id}`
        }
        if (kind === "satcom_rf") {
          const match = gws.find((g) => g.kind === "milsat") ?? gws[0]
          if (match) proposals[`${index}:${kind}`] = `gateway:${match.id}`
        }
      }
    })
    setWiring(proposals)
  }

  function buildPayload(): UtcDeployPayload {
    const wiringOut = Object.entries(wiring)
      .filter(([, v]) => v)
      .map(([key, value]) => {
        const [indexStr, kind] = key.split(":")
        const [targetKind, targetId] = value.split(":")
        return {
          item_index: Number(indexStr),
          capability_kind: kind as CapabilityKind,
          service_id: targetKind === "service" ? Number(targetId) : null,
          gateway_id: targetKind === "gateway" ? Number(targetId) : null,
          role: "endpoint" as const,
        }
      })
    return {
      site_id: Number(siteId),
      name: name.trim(),
      role,
      utc_def_id: utcDefId ? Number(utcDefId) : null,
      package_instance_id:
        packageMode === "existing" && packageId ? Number(packageId) : null,
      new_package_name:
        packageMode === "new" && newPackageName.trim()
          ? newPackageName.trim()
          : null,
      new_package_def_id:
        packageMode === "new" && newPackageDefId ? Number(newPackageDefId) : null,
      items: items.map((i) => ({
        equipment_type_id: i.equipment_type_id,
        serial_number: i.serial_number.trim() || null,
        equipment_code:
          i.equipment_code.trim() ||
          proposeCode(typeById.get(i.equipment_type_id), i.serial_number),
        capability_kinds: i.capability_kinds,
      })),
      holdings: bulk.map((b) => ({
        equipment_type_id: b.equipment_type_id,
        authorized_qty: b.authorized_qty,
        on_hand_qty: b.on_hand_qty,
      })),
      wiring: wiringOut,
    }
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/be/utcs/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const detail = body?.detail
        // The server refuses to silently rename a colliding equipment ID and
        // hands back a suggestion instead; surface both.
        if (detail && typeof detail === "object" && detail.message) {
          throw new Error(
            detail.suggestion
              ? `${detail.message} Try ${detail.suggestion}.`
              : detail.message,
          )
        }
        throw new Error(
          typeof detail === "string" ? detail : `Request failed (${res.status})`,
        )
      }
      setOpen(false)
      reset()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setPending(false)
    }
  }

  const canAdvance = (() => {
    switch (STEPS[step].key) {
      case "package":
        return packageMode !== "existing" || packageId !== ""
      case "utc":
        return true
      case "site":
        return siteId !== "" && name.trim().length > 0
      default:
        return true
    }
  })()

  const onLastStep = step === STEPS.length - 1

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
      disablePointerDismissal
    >
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="size-4" />
        Deploy UTC
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Deploy a UTC</DialogTitle>
        </DialogHeader>

        {/* step indicator */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STEPS.map((s, i) => {
            const done = i < step
            const active = i === step
            const visited = i <= maxVisited
            return (
              <button
                key={s.key}
                type="button"
                disabled={!visited}
                onClick={() => goTo(i)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "bg-primary/10 font-semibold text-primary"
                    : visited
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-muted-foreground/50",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-4 items-center justify-center rounded-full border text-[10px]",
                    active ? "border-primary" : "border-muted-foreground/40",
                  )}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                {s.label}
              </button>
            )
          })}
        </div>

        <div className="min-h-[300px] space-y-4">
          {/* ---- 1. package ---- */}
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                A package spans sites — the primary UTC and its extensions
                belong to the same one.
              </p>
              <div className="flex gap-2">
                {(["new", "existing", "none"] as const).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={packageMode === m ? "secondary" : "outline"}
                    onClick={() => setPackageMode(m)}
                  >
                    {m === "new"
                      ? "New package"
                      : m === "existing"
                        ? "Existing"
                        : "Standalone"}
                  </Button>
                ))}
              </div>

              {packageMode === "existing" && (
                <select
                  value={packageId}
                  onChange={(e) => setPackageId(Number(e.target.value))}
                  className={selectClass}
                >
                  <option value="">Select a package…</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}

              {packageMode === "new" && (
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium">
                      Package name
                    </label>
                    <input
                      value={newPackageName}
                      onChange={(e) => setNewPackageName(e.target.value)}
                      placeholder="FCP-1"
                      className={selectClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">
                      Based on{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <select
                      value={newPackageDefId}
                      onChange={(e) =>
                        setNewPackageDefId(
                          e.target.value ? Number(e.target.value) : "",
                        )
                      }
                      className={selectClass}
                    >
                      <option value="">No definition</option>
                      {packageDefs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- 2. UTC definition ---- */}
          {step === 1 && (
            <div className="space-y-3">
              <label className="mb-1 block text-xs font-medium">
                UTC definition
              </label>
              <select
                value={utcDefId}
                onChange={(e) =>
                  applyUtcDef(e.target.value ? Number(e.target.value) : "")
                }
                className={selectClass}
              >
                <option value="">No definition (build by hand)</option>
                {utcDefs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>
              {selectedUtcDef && (
                <div className="rounded-lg border border-border p-3">
                  <div className="mb-2 text-xs font-medium">
                    Bill of materials — prefilled onto the next two steps
                  </div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {selectedUtcDef.lines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-2">
                        <span>
                          {l.equipment_type_short_name ?? l.equipment_type_title}
                          {!l.serialized && " (bulk)"}
                        </span>
                        <span className="font-mono">×{l.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ---- 3. site & role ---- */}
          {step === 2 && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Site</label>
                <select
                  value={siteId}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setSiteId(v)
                    proposeWiring(v)
                  }}
                  className={selectClass}
                >
                  <option value="">Select a site…</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  UTC name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="FCP-1 Primary"
                  className={selectClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Role</label>
                <div className="flex gap-2">
                  {(["primary", "extension", "independent"] as const).map((r) => (
                    <Button
                      key={r}
                      type="button"
                      size="sm"
                      variant={role === r ? "secondary" : "outline"}
                      onClick={() => setRole(r)}
                    >
                      {UTC_ROLE_LABELS[r]}
                    </Button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  What this UTC is <em>for</em>. The topology view works out
                  the same thing from the links you draw, and shows both — so a
                  mismatch between plan and reality stays visible.
                </p>
              </div>
            </div>
          )}

          {/* ---- 4. serialized items ---- */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Equipment IDs fill in from the serial as you type.
                </p>
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return
                    const t = typeById.get(Number(e.target.value))
                    if (!t) return
                    setItems((prev) => [
                      ...prev,
                      {
                        equipment_type_id: t.id,
                        serial_number: "",
                        equipment_code: "",
                        capability_kinds: t.capabilities
                          .filter((c) => c.materialize_by_default)
                          .map((c) => c.kind),
                      },
                    ])
                  }}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">+ Add item…</option>
                  {types
                    .filter((t) => t.serialized && !t.retired_at)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.short_name ?? t.title}
                      </option>
                    ))}
                </select>
              </div>

              {items.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  No serialized items — pick a UTC definition or add them by
                  hand.
                </p>
              )}

              {items.map((item, index) => {
                const t = typeById.get(item.equipment_type_id)
                return (
                  <div
                    key={index}
                    className="space-y-2 rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">
                        {t?.short_name ?? t?.title}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {t?.nsn ? `NSN ${t.nsn}` : ""}
                        </span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setItems((prev) => prev.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                          Serial number
                        </label>
                        <input
                          value={item.serial_number}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === index
                                  ? { ...it, serial_number: e.target.value }
                                  : it,
                              ),
                            )
                          }
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                          Equipment ID
                        </label>
                        <input
                          value={
                            item.equipment_code ||
                            proposeCode(t, item.serial_number)
                          }
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === index
                                  ? { ...it, equipment_code: e.target.value }
                                  : it,
                              ),
                            )
                          }
                          className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-sm"
                        />
                      </div>
                    </div>
                    {t && t.capabilities.length > 0 && (
                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                          Capabilities on this kit
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {t.capabilities.map((c) => {
                            const on = item.capability_kinds.includes(c.kind)
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() =>
                                  setItems((prev) =>
                                    prev.map((it, i) =>
                                      i === index
                                        ? {
                                            ...it,
                                            capability_kinds: on
                                              ? it.capability_kinds.filter(
                                                  (k) => k !== c.kind,
                                                )
                                              : [...it.capability_kinds, c.kind],
                                          }
                                        : it,
                                    ),
                                  )
                                }
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-xs transition-colors",
                                  on
                                    ? "border-primary/50 bg-primary/10 text-primary"
                                    : "border-border text-muted-foreground",
                                )}
                              >
                                {c.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ---- 5. bulk ---- */}
          {step === 4 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Unserialized gear is counted, not tracked per item.
              </p>
              {bulk.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  Nothing bulk in this UTC.
                </p>
              )}
              {bulk.map((b, index) => {
                const t = typeById.get(b.equipment_type_id)
                return (
                  <div
                    key={index}
                    className="flex items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 flex-1 text-sm">
                      {t?.short_name ?? t?.title}
                    </div>
                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Auth
                    </label>
                    <input
                      type="number"
                      value={b.authorized_qty}
                      onChange={(e) =>
                        setBulk((prev) =>
                          prev.map((it, i) =>
                            i === index
                              ? { ...it, authorized_qty: Number(e.target.value) }
                              : it,
                          ),
                        )
                      }
                      className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
                    />
                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      On hand
                    </label>
                    <input
                      type="number"
                      value={b.on_hand_qty}
                      onChange={(e) =>
                        setBulk((prev) =>
                          prev.map((it, i) =>
                            i === index
                              ? { ...it, on_hand_qty: Number(e.target.value) }
                              : it,
                          ),
                        )
                      }
                      className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
                    />
                  </div>
                )
              })}
            </div>
          )}

          {/* ---- 6. wiring ---- */}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Which service or gateway each capability backs. Pre-checked
                where the match was obvious — uncheck anything that doesn&apos;t
                apply.
              </p>
              {siteServices.length === 0 && siteGateways.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  This site has no services or gateways yet — you can wire this
                  gear up later from the equipment detail page.
                </p>
              )}
              {items.map((item, index) => {
                const t = typeById.get(item.equipment_type_id)
                if (!t || item.capability_kinds.length === 0) return null
                return (
                  <div
                    key={index}
                    className="space-y-2 rounded-lg border border-border p-3"
                  >
                    <div className="text-sm font-medium">
                      <span className="font-mono">
                        {item.equipment_code ||
                          proposeCode(t, item.serial_number)}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {t.short_name ?? t.title}
                      </span>
                    </div>
                    {item.capability_kinds.map((kind) => {
                      const key = `${index}:${kind}`
                      return (
                        <div key={kind} className="flex items-center gap-2">
                          <span className="w-28 shrink-0 text-xs">
                            {CAPABILITY_LABELS[kind as CapabilityKind] ?? kind}
                          </span>
                          <select
                            value={wiring[key] ?? ""}
                            onChange={(e) =>
                              setWiring((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }))
                            }
                            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value="">Not wired</option>
                            {siteServices.length > 0 && (
                              <optgroup label="Services">
                                {siteServices.map((s) => (
                                  <option key={s.id} value={`service:${s.id}`}>
                                    {s.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {siteGateways.length > 0 && (
                              <optgroup label="Gateways">
                                {siteGateways.map((g) => (
                                  <option key={g.id} value={`gateway:${g.id}`}>
                                    {g.name} ({g.pace})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {/* ---- 7. review ---- */}
          {step === 6 && (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-3 gap-y-2">
                <dt className="text-xs text-muted-foreground">Site</dt>
                <dd className="col-span-2">
                  {sites.find((s) => s.id === siteId)?.name ?? "—"}
                </dd>
                <dt className="text-xs text-muted-foreground">UTC</dt>
                <dd className="col-span-2">
                  {name || "—"}{" "}
                  <span className="text-muted-foreground">
                    ({UTC_ROLE_LABELS[role]})
                  </span>
                </dd>
                <dt className="text-xs text-muted-foreground">Package</dt>
                <dd className="col-span-2">
                  {packageMode === "new"
                    ? newPackageName || "—"
                    : packageMode === "existing"
                      ? (packages.find((p) => p.id === packageId)?.name ?? "—")
                      : "Standalone"}
                </dd>
                <dt className="text-xs text-muted-foreground">Definition</dt>
                <dd className="col-span-2">
                  {selectedUtcDef
                    ? `${selectedUtcDef.code} — ${selectedUtcDef.name}`
                    : "None"}
                </dd>
              </dl>

              <div className="rounded-lg border border-border p-3">
                <div className="mb-1.5 text-xs font-medium">
                  {items.length} serialized{" "}
                  {items.length === 1 ? "item" : "items"}
                </div>
                <ul className="space-y-1 text-xs">
                  {items.map((i, index) => {
                    const t = typeById.get(i.equipment_type_id)
                    return (
                      <li key={index} className="flex justify-between gap-2">
                        <span className="font-mono">
                          {i.equipment_code || proposeCode(t, i.serial_number)}
                        </span>
                        <span className="text-muted-foreground">
                          {t?.short_name ?? t?.title}
                          {i.serial_number ? ` · SN ${i.serial_number}` : " · no serial"}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="mb-1.5 text-xs font-medium">
                  {Object.values(wiring).filter(Boolean).length} bindings,{" "}
                  {bulk.length} bulk {bulk.length === 1 ? "line" : "lines"}
                </div>
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => (step === 0 ? setOpen(false) : setStep(step - 1))}
            disabled={pending}
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {onLastStep ? (
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={pending || !siteId || !name.trim()}
            >
              {pending ? "Deploying…" : "Deploy UTC"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={next}
              disabled={!canAdvance}
            >
              Next
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
