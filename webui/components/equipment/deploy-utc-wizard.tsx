"use client"

import { Check, Plus, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { enclaveChipClass, enclaveChipStyle } from "@/lib/enclave-meta"
import { CAPABILITY_LABELS, UTC_ROLE_LABELS } from "@/lib/equipment-meta"
import { cn } from "@/lib/utils"
import type {
  CapabilityKind,
  Enclave,
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
  { key: "enclaves", label: "Enclaves" },
  { key: "site", label: "Site & role" },
  { key: "items", label: "Serialized" },
  { key: "bulk", label: "Bulk" },
  { key: "wiring", label: "Wiring" },
  { key: "review", label: "Review" },
] as const

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

/** Selected-vs-not for the wizard's inline choice buttons. `variant="secondary"`
 *  against `"outline"` was too close to read at a glance — this borrows the
 *  filled treatment the catalog filter chips already use, so "which one is on"
 *  survives a glance instead of needing a comparison. */
function choiceClass(on: boolean): string {
  return on
    ? "border-foreground bg-foreground text-background hover:bg-foreground/90"
    : "border-border text-muted-foreground hover:bg-muted"
}

interface ItemDraft {
  equipment_type_id: number
  serial_number: string
  equipment_code: string
  /** Carried from the UTC line this came from, so the gear arrives tagged
   *  instead of needing a second pass through the equipment list. */
  enclave_id: number | null
  /** Which declared capabilities this particular kit actually has. */
  capability_kinds: string[]
}

interface BulkDraft {
  equipment_type_id: number
  authorized_qty: number
  on_hand_qty: number
  enclave_id: number | null
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
  enclaves: Enclave[]
  types: EquipmentType[]
  utcDefs: UtcDef[]
  packages: PackageInstance[]
  packageDefs: PackageDef[]
  services: Service[]
  gateways: Gateway[]
}

export function DeployUtcWizard({
  sites,
  enclaves,
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
  // Enclaves this deployment supports. null until a def is chosen — an empty
  // Set is a real answer ("supporting none of them"), so it can't double as
  // "not asked yet".
  const [supported, setSupported] = useState<Set<number> | null>(null)
  // Whether the operator has typed their own name. Once they have, suggestions
  // stop — silently overwriting something someone typed is worse than a name
  // that lags the selection.
  const [nameTouched, setNameTouched] = useState(false)

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
    setSupported(null)
    setNameTouched(false)
    setError(null)
  }

  /** The placeholder the operator liked, made real: package name (or UTC code)
   *  plus the role. Nothing invents a name out of nothing — with no package and
   *  no definition there's no honest guess, so it stays empty. */
  const suggestedName = useMemo(() => {
    const base =
      (packageMode === "new" && newPackageName.trim()) ||
      (packageMode === "existing" && packageId
        ? (packages.find((p) => p.id === packageId)?.name ?? "")
        : "") ||
      selectedUtcDef?.code ||
      ""
    if (!base) return ""
    const suffix = role === "independent" ? "" : UTC_ROLE_LABELS[role]
    return suffix ? `${base} ${suffix}` : base
  }, [
    packageMode,
    newPackageName,
    packageId,
    packages,
    selectedUtcDef,
    role,
  ])

  useEffect(() => {
    if (nameTouched) return
    setName(suggestedName)
  }, [suggestedName, nameTouched])

  function goTo(i: number) {
    if (i <= maxVisited) setStep(i)
  }

  function next() {
    const n = Math.min(step + 1, STEPS.length - 1)
    setStep(n)
    setMaxVisited((m) => Math.max(m, n))
  }

  /** Enclaves this UTC's bill of materials mentions, in catalog order. Lines
   *  with no enclave (power, cables, the RF shot) are common to every one and
   *  never appear here — they ship regardless of what's supported. */
  const defEnclaves = useMemo(() => {
    // Building by hand: there is no bill of materials to derive from, so offer
    // the whole list and let the operator say what this UTC supports. Without
    // this the step was dead for every hand-built UTC.
    if (!selectedUtcDef) return enclaves
    const ids = new Set(
      selectedUtcDef.lines
        .map((l) => l.enclave_id)
        .filter((id): id is number => id !== null),
    )
    return enclaves.filter((e) => ids.has(e.id))
  }, [selectedUtcDef, enclaves])

  /** Prefill contents from the chosen UTC's bill of materials, keeping only
   *  the enclaves this deployment supports — this is what turns "we're leaving
   *  the SIPR stack home" into one checkbox instead of a row-by-row delete. */
  function buildContents(defId: number | "", keep: Set<number> | null) {
    if (!defId) return { items: [] as ItemDraft[], bulk: [] as BulkDraft[] }
    const def = utcDefs.find((d) => d.id === defId)
    if (!def) return { items: [] as ItemDraft[], bulk: [] as BulkDraft[] }
    const nextItems: ItemDraft[] = []
    const nextBulk: BulkDraft[] = []
    for (const line of def.lines) {
      const t = typeById.get(line.equipment_type_id)
      if (!t) continue
      // Untagged lines are common to every enclave, so they always ship.
      if (line.enclave_id !== null && keep && !keep.has(line.enclave_id))
        continue
      if (t.serialized) {
        // One row per unit — each needs its own serial.
        for (let i = 0; i < line.quantity; i++) {
          nextItems.push({
            equipment_type_id: t.id,
            serial_number: "",
            equipment_code: "",
            enclave_id: line.enclave_id,
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
          enclave_id: line.enclave_id,
        })
      }
    }
    return { items: nextItems, bulk: nextBulk }
  }

  function applyUtcDef(defId: number | "") {
    setUtcDefId(defId)
    setWiring({})
    if (!defId) {
      setSupported(null)
      setItems([])
      setBulk([])
      return
    }
    const def = utcDefs.find((d) => d.id === defId)
    // Everything checked by default: the common case is bringing the whole
    // UTC, and unchecking is the deliberate act.
    const all = new Set(
      (def?.lines ?? [])
        .map((l) => l.enclave_id)
        .filter((id): id is number => id !== null),
    )
    setSupported(all)
    setNameTouched(false)
    const built = buildContents(defId, all)
    setItems(built.items)
    setBulk(built.bulk)
  }

  /** Re-derive contents when the supported set changes. Rebuilding from the
   *  def rather than filtering the current drafts means re-checking an enclave
   *  restores its rows — but it also discards typed serials, so this only runs
   *  on an actual toggle. */
  function toggleEnclave(id: number) {
    const next = new Set(supported ?? [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSupported(next)
    const built = buildContents(utcDefId, next)
    setItems(built.items)
    setBulk(built.bulk)
    setWiring({})
  }

  /** Propose bindings by matching each item's capabilities against the
   *  site's existing services and gateways. Suggestions only — the operator
   *  unchecks what doesn't apply on the wiring step.
   *
   *  Enclave is matched before kind. Before enclaves existed this took the
   *  first service of a matching kind, which silently wired SIPR gear to NIPR
   *  Web whenever both existed — they are both kind="data" and nothing else
   *  told them apart. When the enclave can't disambiguate a genuinely
   *  ambiguous choice, propose nothing: a wrong pre-checked binding is worse
   *  than an empty one, because the operator has no reason to look at it. */
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
          const ofKind = svc.filter((s) => s.kind === kind)
          const sameEnclave =
            item.enclave_id !== null
              ? ofKind.filter((s) => s.enclave_id === item.enclave_id)
              : []
          const match =
            sameEnclave.length === 1
              ? sameEnclave[0]
              : sameEnclave.length === 0 && ofKind.length === 1
                ? ofKind[0]
                : null
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

  /** Site services bucketed by enclave, with the ones matching this kit first
   *  so the right answer is the first thing in the list. Nothing is hidden —
   *  an operator wiring a shared box across enclaves still needs the others. */
  function serviceGroupsFor(enclaveId: number | null) {
    const byEnclave = new Map<number | null, Service[]>()
    for (const svc of siteServices) {
      const k = svc.enclave_id ?? null
      const bucket = byEnclave.get(k)
      if (bucket) bucket.push(svc)
      else byEnclave.set(k, [svc])
    }
    const groups = [...byEnclave.entries()].map(([k, services]) => ({
      key: String(k ?? "none"),
      enclave: k === null ? null : (enclaves.find((e) => e.id === k) ?? null),
      services,
      matches: enclaveId !== null && k === enclaveId,
    }))
    // Matching first, then named enclaves, then the untagged bucket.
    return groups.sort((a, b) => {
      if (a.matches !== b.matches) return a.matches ? -1 : 1
      if (!a.enclave !== !b.enclave) return a.enclave ? -1 : 1
      return (a.enclave?.name ?? "").localeCompare(b.enclave?.name ?? "")
    })
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
        enclave_id: i.enclave_id,
        capability_kinds: i.capability_kinds,
      })),
      // Drop zeroed rows. Sending them created a quantity-0 expectation line,
      // so "we're not bringing any of these" was recorded as "we expect zero"
      // — indistinguishable from a real expectation in the completeness view.
      holdings: bulk
        .filter((b) => b.authorized_qty > 0 || b.on_hand_qty > 0)
        .map((b) => ({
          equipment_type_id: b.equipment_type_id,
          authorized_qty: b.authorized_qty,
          on_hand_qty: b.on_hand_qty,
          enclave_id: b.enclave_id,
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
                    variant="outline"
                    className={cn("gap-1.5", choiceClass(packageMode === m))}
                    onClick={() => setPackageMode(m)}
                  >
                    {packageMode === m && <Check className="size-3.5" />}
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

          {/* ---- 3. enclaves supported ---- */}
          {step === 2 && (
            <div className="space-y-3">
              {defEnclaves.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  {utcDefId
                    ? "No line in this UTC is tagged with an enclave, so there is nothing to leave home. Tag the UTC definition's lines in the equipment catalog to use this step."
                    : "No enclaves are defined yet — add them under Admin → Enclaves."}
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {selectedUtcDef
                      ? "Which enclaves is this deployment supporting? Unchecking one drops its whole stack — and records that it was never expected here, so completeness won't report it as missing. Gear common to every enclave (power, cables, the RF shot) ships either way."
                      : "Which enclaves is this hand-built UTC supporting? Checked ones become the choices when you assign each piece of gear on the next steps."}
                  </p>
                  <div className="space-y-1.5">
                    {defEnclaves.map((en) => {
                      const on = supported?.has(en.id) ?? false
                      const lines =
                        selectedUtcDef?.lines.filter(
                          (l) => l.enclave_id === en.id,
                        ) ?? []
                      const units = lines.reduce((n, l) => n + l.quantity, 0)
                      return (
                        <label
                          key={en.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                            on ? "border-border" : "border-dashed opacity-60",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleEnclave(en.id)}
                          />
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                              enclaveChipClass(en.color),
                            )}
                            style={enclaveChipStyle(en.color)}
                          >
                            {en.short_name || en.name}
                          </span>
                          <span className="flex-1 text-sm">{en.name}</span>
                          {selectedUtcDef && (
                            <span className="text-xs text-muted-foreground">
                              {lines.length} line
                              {lines.length === 1 ? "" : "s"} · {units} unit
                              {units === 1 ? "" : "s"}
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                  {supported?.size === 0 && (
                    <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                      Nothing enclave-specific will ship. That&apos;s a valid
                      deployment — only the common gear goes.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ---- 4. site & role ---- */}
          {step === 3 && (
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
                  onChange={(e) => {
                    setNameTouched(true)
                    setName(e.target.value)
                  }}
                  placeholder={suggestedName || "FCP-1 Primary"}
                  className={selectClass}
                />
                {nameTouched && suggestedName && name !== suggestedName && (
                  <button
                    type="button"
                    className="mt-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => {
                      setNameTouched(false)
                      setName(suggestedName)
                    }}
                  >
                    Use suggested name: {suggestedName}
                  </button>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Role</label>
                <div className="flex gap-2">
                  {(["primary", "extension", "independent"] as const).map((r) => (
                    <Button
                      key={r}
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn("gap-1.5", choiceClass(role === r))}
                      onClick={() => setRole(r)}
                    >
                      {role === r && <Check className="size-3.5" />}
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

          {/* ---- 5. serialized items ---- */}
          {step === 4 && (
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
                        // Hand-added gear isn't coming from a UTC line, so
                        // there's no enclave to inherit. Tagged later from the
                        // equipment list if it belongs to one.
                        enclave_id: null,
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
                    {enclaves.length > 0 && (
                      <div>
                        <label className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                          Enclave
                        </label>
                        <select
                          className={selectClass}
                          value={item.enclave_id ?? ""}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === index
                                  ? {
                                      ...it,
                                      enclave_id: e.target.value
                                        ? Number(e.target.value)
                                        : null,
                                    }
                                  : it,
                              ),
                            )
                          }
                        >
                          <option value="">None</option>
                          {/* Only what this model of gear is declared capable
                              of. An empty declaration means unrestricted, so
                              fall back to the full list rather than offering
                              nothing. */}
                          {(t && t.enclave_ids.length > 0
                            ? enclaves.filter((en) =>
                                t.enclave_ids.includes(en.id),
                              )
                            : enclaves
                          ).map((en) => (
                            <option key={en.id} value={en.id}>
                              {en.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
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

          {/* ---- 6. bulk ---- */}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Unserialized gear is counted, not tracked per item.
              </p>
              {bulk.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  Nothing bulk on this UTC yet.
                </p>
              )}
              {/* A hand-built UTC has no bill of materials to prefill from, so
                  without this there was no way to record bulk at all. */}
              <select
                aria-label="Add bulk line"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return
                  const t = typeById.get(Number(e.target.value))
                  if (!t) return
                  setBulk((prev) => [
                    ...prev,
                    {
                      equipment_type_id: t.id,
                      authorized_qty: 1,
                      on_hand_qty: 1,
                      // Bulk isn't enclave-tagged on the instance; this only
                      // rides along to the expectation snapshot.
                      enclave_id: null,
                    },
                  ])
                }}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">Add bulk gear…</option>
                {types
                  .filter(
                    (t) =>
                      !t.serialized &&
                      !bulk.some((b) => b.equipment_type_id === t.id),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.short_name ?? t.title}
                    </option>
                  ))}
              </select>
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
                    {/* Bulk had no way to drop a row — the only option was
                        zeroing both numbers, which still recorded an
                        expectation. */}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="Remove bulk line"
                      onClick={() =>
                        setBulk((prev) => prev.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          {/* ---- 7. wiring ---- */}
          {step === 6 && (
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
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="font-mono">
                        {item.equipment_code ||
                          proposeCode(t, item.serial_number)}
                      </span>
                      <span className="text-muted-foreground">
                        {t.short_name ?? t.title}
                      </span>
                      {/* The kit's own enclave, so "which service matches this"
                          is answerable without leaving the row. */}
                      {(() => {
                        const en = item.enclave_id
                          ? enclaves.find((e) => e.id === item.enclave_id)
                          : null
                        if (!en) return null
                        return (
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                              enclaveChipClass(en.color),
                            )}
                            style={enclaveChipStyle(en.color)}
                          >
                            {en.short_name || en.name}
                          </span>
                        )
                      })()}
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
                            {/* Services grouped by enclave, this kit's own
                                enclave first. A flat list gave no way to tell
                                which service matched the gear — with NIPR Web
                                and SIPR Web both present and both kind="data",
                                the names were the only clue. */}
                            {serviceGroupsFor(item.enclave_id).map((g) => (
                              <optgroup
                                key={g.key}
                                label={
                                  g.enclave
                                    ? `${g.enclave.name} services${
                                        g.matches ? " — matches this kit" : ""
                                      }`
                                    : "Services with no enclave"
                                }
                              >
                                {g.services.map((s) => (
                                  <option key={s.id} value={`service:${s.id}`}>
                                    {s.name}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
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

          {/* ---- 8. review ---- */}
          {step === 7 && (
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
