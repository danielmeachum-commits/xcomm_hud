"use client"

import { Boxes, Check, Link2, Plus, Trash2 } from "lucide-react"
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
import { enclaveChipClass, enclaveChipStyle } from "@/lib/enclave-meta"
import { CAPABILITY_LABELS, UTC_ROLE_LABELS } from "@/lib/equipment-meta"
import { useWorkspace } from "@/lib/workspace"
import { cn } from "@/lib/utils"
import type {
  CapabilityKind,
  Enclave,
  Equipment,
  EquipmentAsset,
  EquipmentKit,
  EquipmentType,
  Gateway,
  PackageDef,
  PackageInstance,
  ReassignedEquipment,
  Service,
  Site,
  UtcDef,
  UtcDeployPayload,
  UtcRole,
  UtcRoleHint,
} from "@/lib/types"

const STEPS = [
  { key: "package", label: "Package & UTCs" },
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

/** Smaller sibling of `choiceClass` for the wiring step's target chips, where
 *  a dozen can share a row. */
function chipClass(on: boolean): string {
  return cn(
    "rounded-full border px-2 py-0.5 text-xs transition-colors",
    on
      ? "border-primary/50 bg-primary/10 text-primary"
      : "border-border text-muted-foreground hover:bg-muted",
  )
}

interface ItemDraft {
  equipment_type_id: number
  /** Set when this row draws a box from the global property book. The normal
   *  path from a kit — this workspace's row is materialized from the asset at
   *  deploy, carrying the serial and ID that were typed once, globally. */
  asset_id: number | null
  /** Set when this row claims gear THIS workspace already registered. The
   *  serial, ID and capabilities all come off the existing row, so those
   *  fields go read-only. */
  equipment_id: number | null
  /** Unchecked rows are left home — they never reach the payload, and so
   *  never reach the deployment's expectation snapshot either. This is the
   *  "check off the items actually going" interaction; deleting the row would
   *  work too, but re-adding a kit item afterwards would mean finding it
   *  again. */
  included: boolean
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

/** One UTC queued for deployment. A package routinely means several — the
 *  primary and its extensions — so the wizard carries a list of these and the
 *  per-UTC steps edit whichever one is selected. */
interface UtcDraft {
  key: string
  utcDefId: number | ""
  name: string
  /** Whether the operator has typed their own name. Once they have,
   *  suggestions stop — silently overwriting something someone typed is worse
   *  than a name that lags the selection. */
  nameTouched: boolean
  role: UtcRole
  siteId: number | ""
  /** Enclaves this deployment supports. null until a def is chosen — an empty
   *  Set is a real answer ("supporting none of them"), so it can't double as
   *  "not asked yet". */
  supported: Set<number> | null
  items: ItemDraft[]
  bulk: BulkDraft[]
  /** "<itemIndex>:<kind>" -> ["service:3", "gateway:1", …]. A capability can
   *  back more than one service — a TACLANE's crypto covers every service
   *  behind it — so this is a set, not a single choice. */
  wiring: Record<string, string[]>
  /** Set once the server has accepted this one. A partial failure part-way
   *  down the list must not re-deploy what already exists on retry. */
  deployed: boolean
}

let draftSeq = 0

/** A UTC with nothing chosen yet — what the wizard opens on, and what "Add
 *  UTC" starts from before a definition is applied. */
function emptyDraft(role: UtcRole = "independent", siteId: number | "" = ""): UtcDraft {
  return {
    key: `utc-${++draftSeq}`,
    utcDefId: "",
    name: "",
    nameTouched: false,
    role,
    siteId,
    supported: null,
    items: [],
    bulk: [],
    wiring: {},
    deployed: false,
  }
}

/** `<prefix><last 4 of serial>`, mirroring api/equipment_codes.py so the
 *  wizard shows the same ID the server would generate. */
function proposeCode(type: EquipmentType | undefined, serial: string): string {
  const prefix = (type?.id_prefix || "R").toUpperCase()
  const cleaned = serial.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return cleaned ? `${prefix}${cleaned.slice(-4)}` : prefix
}

/** A package definition says what each UTC is *for*; the deployment has to
 *  commit to a role. "Either" is a definition-level shrug, so it deploys as
 *  independent until the operator says otherwise. */
function roleFromHint(hint: UtcRoleHint): UtcRole {
  return hint === "either" ? "independent" : hint
}

interface Props {
  sites: Site[]
  enclaves: Enclave[]
  types: EquipmentType[]
  utcDefs: UtcDef[]
  packages: PackageInstance[]
  packageDefs: PackageDef[]
  /** Saved rosters. Deploying from one is what turns "retype nine serials"
   *  into "uncheck the two that aren't going". */
  kits: EquipmentKit[]
  /** Everything the workspace has already registered, for the local half of
   *  the picker. Carries `utc_name` and `site_name` already, so "held by
   *  FCP-2 (Site Bravo)" needs no extra round-trip. */
  equipment: Equipment[]
  /** The unit's property book. The other half of the picker, and where kit
   *  pins resolve from. */
  assets: EquipmentAsset[]
  services: Service[]
  gateways: Gateway[]
  /** Equipment IDs already registered in this workspace, so proposed IDs can
   *  avoid the ones that would be rejected. */
  existingCodes?: string[]
}

export function DeployUtcWizard({
  sites,
  enclaves,
  types,
  utcDefs,
  packages,
  packageDefs,
  kits,
  equipment,
  assets,
  services,
  gateways,
  existingCodes = [],
}: Props) {
  const router = useRouter()
  // Destructured under another name: `current` is already the active draft
  // throughout this component.
  const { current: activeWorkspace } = useWorkspace()
  const currentWorkspaceId = activeWorkspace.id
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [maxVisited, setMaxVisited] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** What the deploy took off other UTCs, accumulated across the queue and
   *  shown after it lands. Not a warning to acknowledge before the fact —
   *  taking gear from last week's deployment is the normal workflow — but the
   *  operator is owed a plain statement of what moved. */
  const [reassigned, setReassigned] = useState<ReassignedEquipment[]>([])
  /** True once the queue has fully landed — swaps the body for the summary of
   *  what moved. */
  const [submitted, setSubmitted] = useState(false)

  // step 1 — package and the UTCs going out under it
  const [packageMode, setPackageMode] = useState<
    "kit" | "existing" | "new" | "none"
  >(kits.length > 0 ? "kit" : "new")
  const [kitId, setKitId] = useState<number | "">("")
  const [packageId, setPackageId] = useState<number | "">("")
  const [newPackageName, setNewPackageName] = useState("")
  const [newPackageDefId, setNewPackageDefId] = useState<number | "">("")
  const [drafts, setDrafts] = useState<UtcDraft[]>(() => [emptyDraft()])
  const [active, setActive] = useState(0)

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])

  /** Prefill contents from a UTC's bill of materials, keeping only the
   *  enclaves this deployment supports — this is what turns "we're leaving the
   *  SIPR stack home" into one checkbox instead of a row-by-row delete. */
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
            asset_id: null,
            equipment_id: null,
            included: true,
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

  function makeDraft(
    defId: number | "",
    role: UtcRole = "independent",
    siteId: number | "" = "",
  ): UtcDraft {
    const def = defId ? utcDefs.find((d) => d.id === defId) : null
    // Everything checked by default: the common case is bringing the whole
    // UTC, and unchecking is the deliberate act.
    const all = def
      ? new Set(
          def.lines
            .map((l) => l.enclave_id)
            .filter((id): id is number => id !== null),
        )
      : null
    const built = buildContents(defId, all)
    return {
      ...emptyDraft(role, siteId),
      utcDefId: defId,
      supported: all,
      items: built.items,
      bulk: built.bulk,
    }
  }

  /** Expand a package definition into one draft per UTC it calls for, honoring
   *  quantity — a package with two extensions queues two. */
  function draftsFromPackageDef(def: PackageDef): UtcDraft[] {
    const ordered = [...def.utcs].sort(
      (a, b) => a.display_order - b.display_order,
    )
    const out: UtcDraft[] = []
    for (const u of ordered) {
      for (let i = 0; i < Math.max(1, u.quantity); i++) {
        out.push(makeDraft(u.utc_def_id, roleFromHint(u.role_hint)))
      }
    }
    return out.length > 0 ? out : [emptyDraft()]
  }

  /** Expand a saved kit into one draft per UTC slot, with its pinned gear
   *  already claimed and checked. This is the whole point of kits: the
   *  operator arrives at the Serialized step with nine rows filled in and
   *  unchecks the two staying home, instead of typing nine serials. */
  function draftsFromKit(kit: EquipmentKit): UtcDraft[] {
    const ordered = [...kit.utcs].sort(
      (a, b) => a.display_order - b.display_order,
    )
    const out: UtcDraft[] = ordered.map((ku) => {
      const base = makeDraft(ku.utc_def_id ?? "", roleFromHint(ku.role_hint))
      const items: ItemDraft[] = ku.items
        // A pin whose asset was struck from the property book is gear the unit
        // no longer has. Dropping it beats queueing a row that cannot deploy.
        .filter((pin) => !pin.retired)
        .map((pin) => {
          return {
            equipment_type_id: pin.equipment_type_id ?? 0,
            asset_id: pin.asset_id,
            equipment_id: null,
            included: true,
            serial_number: pin.serial_number ?? "",
            equipment_code: pin.equipment_code ?? "",
            // Enclave is a property of THIS deployment, not of the box — the
            // kit is global and knows nothing about this workspace's networks.
            // Left unset so the enclave step is a real decision.
            enclave_id: null,
            // The asset's own capabilities, not the type's declaration: a box
            // that had `los_rf` struck must not be promised one here.
            capability_kinds: pin.capability_kinds,
          } satisfies ItemDraft
        })
      const bulk: BulkDraft[] = ku.bulk.map((b) => ({
        equipment_type_id: b.equipment_type_id,
        authorized_qty: b.quantity,
        on_hand_qty: b.quantity,
        enclave_id: b.enclave_id,
      }))
      return {
        ...base,
        name: ku.name,
        // The kit named these; keeping the name means the suggestion machinery
        // doesn't overwrite something the operator already curated.
        nameTouched: true,
        items,
        bulk,
      }
    })
    return out.length > 0 ? out : [emptyDraft()]
  }

  function reset() {
    setStep(0)
    setMaxVisited(0)
    setPackageMode(kits.length > 0 ? "kit" : "new")
    setKitId("")
    setReassigned([])
    setSubmitted(false)
    setPackageId("")
    setNewPackageName("")
    setNewPackageDefId("")
    setDrafts([emptyDraft()])
    setActive(0)
    setError(null)
  }

  function patchDraft(index: number, patch: Partial<UtcDraft>) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    )
  }

  const current = drafts[active] ?? drafts[0]

  const siteServices = services.filter((s) => s.site_id === current?.siteId)
  const siteGateways = gateways.filter((g) => g.site_id === current?.siteId)

  /** The placeholder the operator liked, made real: package name (or UTC code)
   *  plus the role. Nothing invents a name out of nothing — with no package
   *  and no definition there's no honest guess, so it stays empty. Deploying a
   *  package of three extensions would otherwise propose one name three times,
   *  so repeats get numbered. */
  const suggestedNames = useMemo(() => {
    const packageBase =
      packageMode === "new" || packageMode === "kit"
        ? newPackageName.trim()
        : packageMode === "existing" && packageId
          ? (packages.find((p) => p.id === packageId)?.name ?? "")
          : ""
    const used = new Map<string, number>()
    return drafts.map((d) => {
      const def = d.utcDefId ? utcDefs.find((x) => x.id === d.utcDefId) : null
      const base = packageBase || def?.code || ""
      if (!base) return ""
      const suffix = d.role === "independent" ? "" : UTC_ROLE_LABELS[d.role]
      const stem = suffix ? `${base} ${suffix}` : base
      const n = (used.get(stem) ?? 0) + 1
      used.set(stem, n)
      return n > 1 ? `${stem} ${n}` : stem
    })
  }, [drafts, packageMode, newPackageName, packageId, packages, utcDefs])

  /** The equipment ID every queued item would register under, disambiguated.
   *
   *  `proposeCode` falls back to the bare type prefix when no serial has been
   *  typed, so a UTC carrying two of the same model proposed "C" twice and the
   *  server rejected the whole deploy on a duplicate ID — the normal case of
   *  "we'll add serials when the gear arrives" couldn't deploy at all.
   *  Numbering spans the entire queue, since IDs are unique workspace-wide and
   *  a package deploys several UTCs against the same namespace. A code the
   *  operator typed is left exactly as typed. */
  const proposedCodes = useMemo(() => {
    // Claimed gear keeps the ID it already has, and must not consume a name
    // from the pool below — proposing around it would renumber new gear to
    // dodge a collision that isn't one.
    const bases = drafts.map((d) =>
      d.items.map((it) =>
        it.asset_id !== null || it.equipment_id !== null
          ? it.equipment_code
          : it.equipment_code.trim() ||
            proposeCode(typeById.get(it.equipment_type_id), it.serial_number),
      ),
    )
    const total = new Map<string, number>()
    bases.forEach((row, di) => {
      row.forEach((base, ii) => {
        const row = drafts[di].items[ii]
        if (row.asset_id !== null || row.equipment_id !== null) return
        total.set(base, (total.get(base) ?? 0) + 1)
      })
    })
    // Seeded with what the workspace has already registered, not just what
    // this queue proposes: deploying a second UTC from the same definition
    // re-proposed the first one's IDs and the server rejected every item.
    // The server still has the final say — this only stops the wizard from
    // walking into a collision it can already see.
    const taken = new Set(existingCodes.map((c) => c.toUpperCase()))
    return bases.map((row, di) =>
      row.map((base, ii) => {
        const row = drafts[di].items[ii]
        if (row.asset_id !== null || row.equipment_id !== null) return base
        if (drafts[di].items[ii].equipment_code.trim()) return base
        if ((total.get(base) ?? 0) < 2 && !taken.has(base.toUpperCase())) {
          taken.add(base.toUpperCase())
          return base
        }
        let n = 1
        while (taken.has(`${base}${n}`.toUpperCase())) n++
        taken.add(`${base}${n}`.toUpperCase())
        return `${base}${n}`
      }),
    )
  }, [drafts, typeById, existingCodes])

  /** What the field shows and what gets submitted. Derived rather than synced
   *  into state by an effect: until the operator types, the name simply IS the
   *  suggestion, so there is nothing to keep in step. */
  function nameOf(index: number): string {
    const d = drafts[index]
    if (!d) return ""
    return d.nameTouched ? d.name : (suggestedNames[index] ?? "")
  }

  function goTo(i: number) {
    if (i <= maxVisited) setStep(i)
  }

  function next() {
    const n = Math.min(step + 1, STEPS.length - 1)
    setStep(n)
    setMaxVisited((m) => Math.max(m, n))
  }

  /** Enclaves the active UTC's bill of materials mentions, in catalog order.
   *  Lines with no enclave (power, cables, the RF shot) are common to every
   *  one and never appear here — they ship regardless of what's supported. */
  const currentDefId: number | "" = current?.utcDefId ?? ""
  const defEnclaves = useMemo(() => {
    const def = currentDefId
      ? utcDefs.find((d) => d.id === currentDefId)
      : null
    // Building by hand: there is no bill of materials to derive from, so offer
    // the whole list and let the operator say what this UTC supports. Without
    // this the step was dead for every hand-built UTC.
    if (!def) return enclaves
    const ids = new Set(
      def.lines
        .map((l) => l.enclave_id)
        .filter((id): id is number => id !== null),
    )
    return enclaves.filter((e) => ids.has(e.id))
  }, [currentDefId, utcDefs, enclaves])

  const selectedUtcDef = currentDefId
    ? utcDefs.find((d) => d.id === currentDefId)
    : null

  /** Swap the definition under a queued UTC, rebuilding its contents. */
  function applyUtcDef(index: number, defId: number | "") {
    const prev = drafts[index]
    if (!prev) return
    const rebuilt = makeDraft(defId, prev.role, prev.siteId)
    // The site survives the swap, so the proposals can be rebuilt for the new
    // contents rather than leaving the wiring step blank.
    if (prev.siteId) {
      rebuilt.wiring = proposeWiring(rebuilt.items, Number(prev.siteId))
    }
    setDrafts((ds) =>
      ds.map((d, i) => (i === index ? { ...rebuilt, key: d.key } : d)),
    )
  }

  /** Re-derive contents when the supported set changes. Rebuilding from the
   *  def rather than filtering the current drafts means re-checking an enclave
   *  restores its rows — but it also discards typed serials, so this only runs
   *  on an actual toggle. */
  function toggleEnclave(id: number) {
    if (!current) return
    const nextSet = new Set(current.supported ?? [])
    if (nextSet.has(id)) nextSet.delete(id)
    else nextSet.add(id)
    const built = buildContents(current.utcDefId, nextSet)
    patchDraft(active, {
      supported: nextSet,
      items: built.items,
      bulk: built.bulk,
      wiring: {},
    })
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
  function proposeWiring(items: ItemDraft[], targetSiteId: number) {
    const proposals: Record<string, string[]> = {}
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
          if (match) proposals[`${index}:${kind}`] = [`service:${match.id}`]
        }
        if (kind === "satcom_rf") {
          const match = gws.find((g) => g.kind === "milsat") ?? gws[0]
          if (match) proposals[`${index}:${kind}`] = [`gateway:${match.id}`]
        }
      }
    })
    return proposals
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
    const groups = [...byEnclave.entries()].map(([k, grouped]) => ({
      key: String(k ?? "none"),
      enclave: k === null ? null : (enclaves.find((e) => e.id === k) ?? null),
      services: grouped,
      matches: enclaveId !== null && k === enclaveId,
    }))
    // Matching first, then named enclaves, then the untagged bucket.
    return groups.sort((a, b) => {
      if (a.matches !== b.matches) return a.matches ? -1 : 1
      if (!a.enclave !== !b.enclave) return a.enclave ? -1 : 1
      return (a.enclave?.name ?? "").localeCompare(b.enclave?.name ?? "")
    })
  }

  /** Every piece of gear the queue has already claimed, so two UTCs in one
   *  deployment can't both take the same radio — the server rejects that, and
   *  finding out at submit time after filling in five more rows is a bad way
   *  to learn it. */
  const claimedInQueue = useMemo(() => {
    const out = new Map<number, number>()
    drafts.forEach((d, di) => {
      for (const it of d.items) {
        if (it.equipment_id !== null && it.included) out.set(it.equipment_id, di)
      }
    })
    return out
  }, [drafts])

  /** Assets already spoken for elsewhere in this queue. Two UTCs in one
   *  deployment can't both take the same box — the server rejects it, and
   *  learning that at submit time after filling in five more rows is a bad
   *  way to find out. */
  const assetsInQueue = useMemo(() => {
    const out = new Set<number>()
    for (const d of drafts) {
      for (const it of d.items) {
        if (it.asset_id !== null && it.included) out.add(it.asset_id)
      }
    }
    return out
  }, [drafts])

  /** Property-book boxes of a given type this row could draw. Nothing is
   *  hidden on the grounds of being busy elsewhere: workspaces are separate
   *  operating pictures, so a radio in another exercise is still deployable
   *  here — the label just says who else has it. */
  function assetsFor(typeId: number, keep: number | null): EquipmentAsset[] {
    return assets
      .filter((a) => a.equipment_type_id === typeId && !a.retired_at)
      .filter((a) => a.id === keep || !assetsInQueue.has(a.id))
      .sort((a, b) => {
        const aBusy = a.commitments.length > 0 ? 1 : 0
        const bBusy = b.commitments.length > 0 ? 1 : 0
        if (aBusy !== bBusy) return aBusy - bBusy
        return a.equipment_code.localeCompare(b.equipment_code)
      })
  }

  /** Gear of a given type this row could claim: idle first, then whatever is
   *  out on another deployment. Nothing is hidden — taking a radio off last
   *  week's package is the normal move, and the label says where it is so the
   *  choice is informed rather than blocked. */
  function poolFor(typeId: number, keep: number | null): Equipment[] {
    return equipment
      .filter((e) => e.equipment_type_id === typeId)
      .filter((e) => {
        if (e.id === keep) return true
        const claimedBy = claimedInQueue.get(e.id)
        return claimedBy === undefined
      })
      .sort((a, b) => {
        const aIdle = a.utc_instance_id === null ? 0 : 1
        const bIdle = b.utc_instance_id === null ? 0 : 1
        if (aIdle !== bIdle) return aIdle - bIdle
        return a.equipment_code.localeCompare(b.equipment_code)
      })
  }

  /** What this whole deployment would take off other UTCs, computed from the
   *  equipment list rather than waiting for the server. Shown on review so the
   *  operator sees it before committing, not after. */
  const willMove = useMemo(() => {
    const out: { code: string; from: string; site: string | null }[] = []
    for (const d of drafts) {
      if (d.deployed) continue
      for (const it of d.items) {
        if (it.equipment_id === null || !it.included) continue
        const eq = equipment.find((e) => e.id === it.equipment_id)
        if (eq && eq.utc_instance_id !== null) {
          out.push({
            code: eq.equipment_code,
            from: eq.utc_name ?? `UTC ${eq.utc_instance_id}`,
            site: eq.site_name,
          })
        }
      }
    }
    return out
  }, [drafts, equipment])

  /** Property-book boxes this deployment draws that another picture is also
   *  using. Not a warning — nothing moves and nothing is taken — but the
   *  operator planning around a finite pool should know before committing. */
  const alsoInUse = useMemo(() => {
    const out: { code: string; where: string[] }[] = []
    for (const d of drafts) {
      if (d.deployed) continue
      for (const it of d.items) {
        if (it.asset_id === null || !it.included) continue
        const a = assets.find((x) => x.id === it.asset_id)
        const elsewhere = (a?.commitments ?? []).filter(
          (c) => c.workspace_id !== currentWorkspaceId,
        )
        if (a && elsewhere.length > 0) {
          out.push({
            code: a.equipment_code,
            where: elsewhere.map(
              (c) => `${c.workspace_name}${c.utc_name ? ` · ${c.utc_name}` : ""}`,
            ),
          })
        }
      }
    }
    return out
  }, [drafts, assets, currentWorkspaceId])

  /** Toggle one target on a capability. Bindings are a set: the same crypto
   *  device fronts every service behind it, and forcing a single choice made
   *  the operator pick one and fix the rest by hand afterwards. */
  function toggleTarget(key: string, value: string) {
    if (!current) return
    const held = current.wiring[key] ?? []
    const nextTargets = held.includes(value)
      ? held.filter((v) => v !== value)
      : [...held, value]
    patchDraft(active, { wiring: { ...current.wiring, [key]: nextTargets } })
  }

  /** Copy one capability's targets onto every other capability of the same
   *  kit. A TACLANE's crypto and routing back the same services far more often
   *  than not, and setting them one at a time is the tedious part. */
  function matchAcrossCapabilities(itemIndex: number, kind: string) {
    if (!current) return
    const item = current.items[itemIndex]
    if (!item) return
    const source = current.wiring[`${itemIndex}:${kind}`] ?? []
    const nextWiring = { ...current.wiring }
    for (const other of item.capability_kinds) {
      nextWiring[`${itemIndex}:${other}`] = [...source]
    }
    patchDraft(active, { wiring: nextWiring })
  }

  function bindingCount(d: UtcDraft): number {
    return Object.values(d.wiring).reduce((n, v) => n + v.length, 0)
  }

  function buildPayload(
    d: UtcDraft,
    index: number,
    packageInstanceId: number | null,
  ): UtcDeployPayload {
    // Only the checked rows ship. `wiring` is keyed by position in `d.items`,
    // so dropping rows shifts every index after them — the payload has to be
    // renumbered or a UTC that left one radio home would wire the wrong box to
    // the wrong service.
    const shipping: number[] = []
    d.items.forEach((it, i) => {
      if (it.included) shipping.push(i)
    })
    const renumber = new Map<number, number>()
    shipping.forEach((original, position) => renumber.set(original, position))

    const wiringOut = Object.entries(d.wiring).flatMap(([key, values]) => {
      const [indexStr, kind] = key.split(":")
      const target = renumber.get(Number(indexStr))
      // Wiring proposed for a row the operator then unchecked. Dropping it is
      // right: the gear isn't going, so neither is its binding.
      if (target === undefined) return []
      return values.map((value) => {
        const [targetKind, targetId] = value.split(":")
        return {
          item_index: target,
          capability_kind: kind as CapabilityKind,
          service_id: targetKind === "service" ? Number(targetId) : null,
          gateway_id: targetKind === "gateway" ? Number(targetId) : null,
          role: "endpoint" as const,
        }
      })
    })
    // Every UTC after the first joins the package the first one resolved or
    // created — otherwise deploying a package of three would create three
    // packages with the same name.
    const joinExisting =
      packageInstanceId ??
      (packageMode === "existing" && packageId ? Number(packageId) : null)
    // Deploying from a kit creates a package too — the kit is the roster, not
    // the deployment, and its gear still has to land under something.
    const creatingNew =
      joinExisting === null &&
      (packageMode === "new" || packageMode === "kit")
    const selectedKit =
      packageMode === "kit" && kitId
        ? kits.find((k) => k.id === kitId)
        : undefined
    return {
      site_id: Number(d.siteId),
      name: nameOf(index).trim(),
      role: d.role,
      utc_def_id: d.utcDefId ? Number(d.utcDefId) : null,
      package_instance_id: joinExisting,
      new_package_name:
        creatingNew && newPackageName.trim() ? newPackageName.trim() : null,
      new_package_def_id: creatingNew
        ? (selectedKit?.package_def_id ??
          (newPackageDefId ? Number(newPackageDefId) : null))
        : null,
      items: shipping.map((ii) => {
        const i = d.items[ii]
        // Gear with an identity of its own — a property-book asset, or a row
        // this workspace already registered. Sending a proposed code for
        // either would be a request to rename a radio that has a name.
        if (i.asset_id !== null) {
          return {
            equipment_type_id: i.equipment_type_id,
            asset_id: i.asset_id,
            enclave_id: i.enclave_id,
          }
        }
        if (i.equipment_id !== null) {
          return {
            equipment_type_id: i.equipment_type_id,
            equipment_id: i.equipment_id,
            enclave_id: i.enclave_id,
          }
        }
        return {
          equipment_type_id: i.equipment_type_id,
          serial_number: i.serial_number.trim() || null,
          equipment_code: proposedCodes[index]?.[ii] ?? i.equipment_code.trim(),
          enclave_id: i.enclave_id,
          capability_kinds: i.capability_kinds,
        }
      }),
      // Drop zeroed rows. Sending them created a quantity-0 expectation line,
      // so "we're not bringing any of these" was recorded as "we expect zero"
      // — indistinguishable from a real expectation in the completeness view.
      holdings: d.bulk
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

  async function deployOne(
    d: UtcDraft,
    index: number,
    packageInstanceId: number | null,
    collector: ReassignedEquipment[],
  ): Promise<number | null> {
    const res = await fetch("/api/be/utcs/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(d, index, packageInstanceId)),
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
    const out = await res.json().catch(() => null)
    // Collected into the caller's array rather than state: submit() has to
    // decide whether to show the summary in the same tick it finishes, and a
    // setState wouldn't have landed yet.
    collector.push(...((out?.reassigned ?? []) as ReassignedEquipment[]))
    return out?.utc_instance?.package_instance_id ?? packageInstanceId
  }

  /** Deploy the queue one UTC at a time. Each request is atomic on its own,
   *  but the queue isn't — so a failure half-way stops, keeps what landed, and
   *  says which one broke rather than replaying the successes on retry. */
  async function submit() {
    setPending(true)
    setError(null)
    const moved: ReassignedEquipment[] = []
    let packageInstanceId: number | null =
      packageMode === "existing" && packageId ? Number(packageId) : null
    let done = 0
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i]
      if (d.deployed) continue
      try {
        packageInstanceId = await deployOne(d, i, packageInstanceId, moved)
        patchDraft(i, { deployed: true })
        done++
      } catch (e) {
        const message = e instanceof Error ? e.message : "Something went wrong"
        setError(
          drafts.length === 1
            ? message
            : `${nameOf(i) || `UTC ${i + 1}`} failed: ${message} ` +
              `(${done} of ${drafts.length} deployed — fix this one and deploy again; ` +
              `the ones that landed won't be re-sent.)`,
        )
        setPending(false)
        setActive(i)
        setReassigned(moved)
        // The ones that landed are real, so the page behind should show them
        // even though the wizard stays open on the failure.
        if (done > 0) router.refresh()
        return
      }
    }
    setPending(false)
    router.refresh()
    // Gear changing hands is accountable property moving between deployments,
    // and the server is the authority on what actually moved — another
    // operator may have shifted something since this page loaded. Worth one
    // acknowledgement rather than a dialog that vanishes. Nothing moved is the
    // ordinary case and closes straight away.
    if (moved.length > 0) {
      setReassigned(moved)
      setSubmitted(true)
      return
    }
    setOpen(false)
    reset()
  }

  const pendingDrafts = drafts.filter((d) => !d.deployed)
  const incomplete = drafts.some(
    (d, i) => !d.deployed && (!d.siteId || !nameOf(i).trim()),
  )

  const canAdvance = (() => {
    switch (STEPS[step].key) {
      case "package":
        return (
          drafts.length > 0 &&
          (packageMode !== "existing" || packageId !== "") &&
          (packageMode !== "kit" || kitId !== "")
        )
      case "site":
        return !!current?.siteId && nameOf(active).trim().length > 0
      default:
        return true
    }
  })()

  const onLastStep = step === STEPS.length - 1

  /** UTC switcher for the per-UTC steps. Only earns its space once there's
   *  more than one in the queue. */
  function draftTabs() {
    if (drafts.length < 2) return null
    return (
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {drafts.map((d, i) => {
          const def = d.utcDefId ? utcDefs.find((x) => x.id === d.utcDefId) : null
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                i === active
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {d.deployed && <Check className="size-3" />}
              {nameOf(i) || def?.code || `UTC ${i + 1}`}
            </button>
          )
        })}
      </div>
    )
  }

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
          <DialogTitle>
            {drafts.length > 1 ? `Deploy ${drafts.length} UTCs` : "Deploy a UTC"}
          </DialogTitle>
        </DialogHeader>

        {/* step indicator */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STEPS.map((s, i) => {
            const done = i < step
            const isActive = i === step
            const visited = i <= maxVisited
            return (
              <button
                key={s.key}
                type="button"
                disabled={!visited}
                onClick={() => goTo(i)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
                  isActive
                    ? "bg-primary/10 font-semibold text-primary"
                    : visited
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-muted-foreground/50",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-4 items-center justify-center rounded-full border text-[10px]",
                    isActive ? "border-primary" : "border-muted-foreground/40",
                  )}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                {s.label}
              </button>
            )
          })}
        </div>

        {submitted ? (
          /* The server is the authority on what moved — another operator may
             have shifted gear since this page loaded — so this reports its
             answer rather than the prediction the review step showed. */
          <div className="min-h-[300px] space-y-3">
            <div className="rounded-lg border border-border p-3">
              <div className="mb-1.5 text-sm font-medium">
                Deployed. {reassigned.length} item
                {reassigned.length === 1 ? "" : "s"} moved here from another
                deployment.
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {reassigned.map((r) => (
                  <li key={r.equipment_id}>
                    <span className="font-mono">{r.equipment_code}</span>
                    {r.serial_number ? ` · ${r.serial_number}` : ""} — taken
                    from {r.previous_utc_name}
                    {r.previous_site_name ? ` · ${r.previous_site_name}` : ""}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              Each of those UTCs now reads short against what it expected to
              carry. Update their expected contents if the gear isn&apos;t
              coming back.
            </p>
          </div>
        ) : (
        <div className="min-h-[300px] space-y-4">
          {/* ---- 1. package & UTCs ---- */}
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                A package spans sites — the primary UTC and its extensions
                belong to the same one.
              </p>
              <div className="flex flex-wrap gap-2">
                {(["kit", "new", "existing", "none"] as const)
                  .filter((m) => m !== "kit" || kits.length > 0)
                  .map((m) => (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn("gap-1.5", choiceClass(packageMode === m))}
                      onClick={() => setPackageMode(m)}
                    >
                      {packageMode === m && <Check className="size-3.5" />}
                      {m === "kit"
                        ? "From a kit"
                        : m === "new"
                          ? "New package"
                          : m === "existing"
                            ? "Existing"
                            : "Standalone"}
                    </Button>
                  ))}
              </div>

              {packageMode === "kit" && (
                <div className="space-y-2">
                  <select
                    value={kitId}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : ""
                      setKitId(id)
                      const kit = id ? kits.find((k) => k.id === id) : null
                      if (kit) {
                        setDrafts(draftsFromKit(kit))
                        setActive(0)
                        if (!newPackageName.trim()) setNewPackageName(kit.name)
                      }
                    }}
                    className={selectClass}
                  >
                    <option value="">Select a kit…</option>
                    {kits.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} — {k.utcs.length} UTC
                        {k.utcs.length === 1 ? "" : "s"}, {k.item_count} item
                        {k.item_count === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const kit = kitId ? kits.find((k) => k.id === kitId) : null
                    if (!kit) {
                      return (
                        <p className="text-xs text-muted-foreground">
                          A kit remembers which UTCs go out and exactly which
                          gear is in them, so this deployment only has to check
                          off what is actually going.
                        </p>
                      )
                    }
                    return (
                      <div className="space-y-1.5 rounded-lg border border-border p-2.5">
                        <div className="flex items-center gap-2 text-xs">
                          <Boxes className="size-3.5 text-muted-foreground" />
                          <span className="font-medium">{kit.name}</span>
                          {kit.package_def_code && (
                            <span className="text-muted-foreground">
                              {kit.package_def_code}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {kit.item_count} serialized item
                          {kit.item_count === 1 ? "" : "s"} pinned
                          {kit.bulk_count > 0 &&
                            `, ${kit.bulk_count} bulk unit${
                              kit.bulk_count === 1 ? "" : "s"
                            }`}
                          .
                        </p>
                        {kit.committed_count > 0 && (
                          /* Not a warning. Gear moving between packages is the
                             normal workflow for a unit that owns one of
                             something — this is here so the number isn't a
                             surprise on the review step. */
                          <p className="text-[11px] text-muted-foreground">
                            {kit.committed_count} of them{" "}
                            {kit.committed_count === 1 ? "is" : "are"} currently
                            on another deployment and will move here.
                          </p>
                        )}
                      </div>
                    )
                  })()}
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
                </div>
              )}

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
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : ""
                        setNewPackageDefId(id)
                        // A package definition already says which UTCs go out
                        // and in what role — queue them rather than making the
                        // operator retype the list it just described.
                        const def = id
                          ? packageDefs.find((p) => p.id === id)
                          : null
                        const untouched =
                          drafts.length === 1 &&
                          !drafts[0].utcDefId &&
                          drafts[0].items.length === 0
                        if (def && def.utcs.length > 0 && untouched) {
                          setDrafts(draftsFromPackageDef(def))
                          setActive(0)
                        }
                      }}
                      className={selectClass}
                    >
                      <option value="">No definition</option>
                      {packageDefs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} — {p.name}
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const def = newPackageDefId
                        ? packageDefs.find((p) => p.id === newPackageDefId)
                        : null
                      if (!def || def.utcs.length === 0) return null
                      return (
                        <button
                          type="button"
                          className="mt-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          onClick={() => {
                            setDrafts(draftsFromPackageDef(def))
                            setActive(0)
                          }}
                        >
                          Queue the{" "}
                          {def.utcs.reduce((n, u) => n + u.quantity, 0)} UTCs
                          this package calls for
                        </button>
                      )
                    })()}
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium">
                    UTCs in this deployment
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      // Extensions almost always follow a primary, and they
                      // start at the same site more often than not.
                      const last = drafts[drafts.length - 1]
                      setDrafts((prev) => [
                        ...prev,
                        makeDraft("", "extension", last?.siteId ?? ""),
                      ])
                      setActive(drafts.length)
                    }}
                  >
                    <Plus className="size-3.5" />
                    Add UTC
                  </Button>
                </div>
                {drafts.map((d, i) => {
                  const def = d.utcDefId
                    ? utcDefs.find((x) => x.id === d.utcDefId)
                    : null
                  const units =
                    def?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0
                  return (
                    <div
                      key={d.key}
                      className="flex items-center gap-2 rounded-lg border border-border p-2"
                    >
                      <select
                        value={d.utcDefId}
                        onChange={(e) =>
                          applyUtcDef(
                            i,
                            e.target.value ? Number(e.target.value) : "",
                          )
                        }
                        className={selectClass}
                      >
                        <option value="">No definition (build by hand)</option>
                        {utcDefs.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code} — {u.name}
                          </option>
                        ))}
                      </select>
                      <span className="w-32 shrink-0 text-right text-[11px] text-muted-foreground">
                        {def
                          ? `${def.lines.length} line${
                              def.lines.length === 1 ? "" : "s"
                            } · ${units} unit${units === 1 ? "" : "s"}`
                          : "hand-built"}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Remove UTC"
                        disabled={drafts.length === 1}
                        onClick={() => {
                          setDrafts((prev) => prev.filter((_, x) => x !== i))
                          setActive((a) => (a >= i && a > 0 ? a - 1 : a))
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )
                })}
                <p className="text-xs text-muted-foreground">
                  Each one gets its own site, contents and wiring on the steps
                  that follow — switch between them at the top.
                </p>
              </div>
            </div>
          )}

          {/* ---- 2. enclaves supported ---- */}
          {step === 1 && current && (
            <div className="space-y-3">
              {draftTabs()}
              {defEnclaves.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  {current.utcDefId
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
                      const on = current.supported?.has(en.id) ?? false
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
                  {current.supported?.size === 0 && (
                    <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                      Nothing enclave-specific will ship. That&apos;s a valid
                      deployment — only the common gear goes.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ---- 3. site & role ---- */}
          {step === 2 && current && (
            <div className="space-y-3">
              {draftTabs()}
              <div>
                <label className="mb-1 block text-xs font-medium">Site</label>
                <select
                  value={current.siteId}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    patchDraft(active, {
                      siteId: v,
                      wiring: proposeWiring(current.items, v),
                    })
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
                  value={nameOf(active)}
                  onChange={(e) =>
                    patchDraft(active, {
                      nameTouched: true,
                      name: e.target.value,
                    })
                  }
                  placeholder={suggestedNames[active] || "FCP-1 Primary"}
                  className={selectClass}
                />
                {current.nameTouched &&
                  suggestedNames[active] &&
                  current.name !== suggestedNames[active] && (
                    <button
                      type="button"
                      className="mt-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() =>
                        patchDraft(active, { nameTouched: false, name: "" })
                      }
                    >
                      Use suggested name: {suggestedNames[active]}
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
                      className={cn("gap-1.5", choiceClass(current.role === r))}
                      onClick={() => patchDraft(active, { role: r })}
                    >
                      {current.role === r && <Check className="size-3.5" />}
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
          {step === 3 && current && (
            <div className="space-y-3">
              {draftTabs()}
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {current.items.some((i) => i.equipment_id !== null)
                    ? `${current.items.filter((i) => i.included).length} of ${
                        current.items.length
                      } going — uncheck anything staying home.`
                    : "Pick gear you already own, or type a serial to register something new."}
                </p>
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return
                    const t = typeById.get(Number(e.target.value))
                    if (!t) return
                    patchDraft(active, {
                      items: [
                        ...current.items,
                        {
                          equipment_type_id: t.id,
                          asset_id: null,
                          equipment_id: null,
                          included: true,
                          serial_number: "",
                          equipment_code: "",
                          // Hand-added gear isn't coming from a UTC line, so
                          // there's no enclave to inherit. Tagged later from
                          // the equipment list if it belongs to one.
                          enclave_id: null,
                          capability_kinds: t.capabilities
                            .filter((c) => c.materialize_by_default)
                            .map((c) => c.kind),
                        },
                      ],
                    })
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

              {current.items.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  No serialized items — pick a UTC definition or add them by
                  hand.
                </p>
              )}

              {current.items.map((item, index) => {
                const t = typeById.get(item.equipment_type_id)
                // Either kind of identified gear: a property-book asset, or a
                // row this workspace already registered. Both mean the serial
                // and ID are already settled and must not be retyped here.
                const claimed =
                  item.asset_id !== null || item.equipment_id !== null
                const asset =
                  item.asset_id !== null
                    ? assets.find((a) => a.id === item.asset_id)
                    : undefined
                const held =
                  item.equipment_id !== null
                    ? equipment.find((e) => e.id === item.equipment_id)
                    : undefined
                const onAnotherUtc = held?.utc_instance_id != null
                const elsewhere = (asset?.commitments ?? []).filter(
                  (c) => c.workspace_id !== currentWorkspaceId,
                )
                const pool = poolFor(item.equipment_type_id, item.equipment_id)
                const bookPool = assetsFor(item.equipment_type_id, item.asset_id)
                function patchItem(patch: Partial<ItemDraft>) {
                  patchDraft(active, {
                    items: current.items.map((it, i) =>
                      i === index ? { ...it, ...patch } : it,
                    ),
                  })
                }
                return (
                  <div
                    key={index}
                    className={cn(
                      "space-y-2 rounded-lg border p-3 transition-colors",
                      item.included
                        ? "border-border"
                        : "border-dashed border-border bg-muted/30",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex min-w-0 items-center gap-2">
                        {/* The "check off what's actually going" control. Rows
                            arrive checked; unchecking leaves the item home and
                            keeps it out of the expectation snapshot, so it
                            never reads as a shortfall. */}
                        <input
                          type="checkbox"
                          checked={item.included}
                          onChange={(e) =>
                            patchItem({ included: e.target.checked })
                          }
                          className="size-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 truncate text-sm font-medium">
                          {t?.short_name ?? t?.title}
                          {claimed && item.equipment_code && (
                            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                              {item.equipment_code}
                            </span>
                          )}
                          {!claimed && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {t?.nsn ? `NSN ${t.nsn}` : ""}
                            </span>
                          )}
                        </span>
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Remove item"
                        onClick={() =>
                          patchDraft(active, {
                            items: current.items.filter((_, i) => i !== index),
                          })
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>

                    {/* Where this row's gear comes from. Claimed rows say which
                        box and where it is now; new rows offer the pool before
                        asking anyone to type a serial, because the finite-pool
                        case is the common one. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                        value={
                          item.asset_id !== null
                            ? `a:${item.asset_id}`
                            : item.equipment_id !== null
                              ? `e:${item.equipment_id}`
                              : ""
                        }
                        disabled={!item.included}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (!raw) {
                            patchItem({
                              asset_id: null,
                              equipment_id: null,
                              serial_number: "",
                              equipment_code: "",
                              capability_kinds: (t?.capabilities ?? [])
                                .filter((c) => c.materialize_by_default)
                                .map((c) => c.kind),
                            })
                            return
                          }
                          const [kind, rawId] = raw.split(":")
                          const id = Number(rawId)
                          if (kind === "a") {
                            const picked = assets.find((x) => x.id === id)
                            if (!picked) return
                            patchItem({
                              asset_id: picked.id,
                              equipment_id: null,
                              serial_number: picked.serial_number ?? "",
                              equipment_code: picked.equipment_code,
                              capability_kinds: picked.capability_kinds,
                            })
                            return
                          }
                          const picked = equipment.find((x) => x.id === id)
                          if (!picked) return
                          patchItem({
                            asset_id: null,
                            equipment_id: picked.id,
                            serial_number: picked.serial_number ?? "",
                            equipment_code: picked.equipment_code,
                            // Its own materialized capabilities, not the
                            // type's declaration — this particular box may
                            // have had one removed.
                            capability_kinds: picked.capabilities.map(
                              (c) => c.kind,
                            ),
                            enclave_id: picked.enclave_id ?? item.enclave_id,
                          })
                        }}
                      >
                        <option value="">Register new gear</option>
                        {bookPool.length > 0 && (
                          <optgroup label="Property book">
                            {bookPool.map((a) => (
                              <option key={`a-${a.id}`} value={`a:${a.id}`}>
                                {a.equipment_code}
                                {a.serial_number ? ` · ${a.serial_number}` : ""}
                                {a.commitments.length > 0
                                  ? ` — in ${a.commitments.length} picture${
                                      a.commitments.length === 1 ? "" : "s"
                                    }`
                                  : " — free"}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {pool.length > 0 && (
                          <optgroup label="Already in this workspace">
                            {pool.map((e) => (
                              <option key={`e-${e.id}`} value={`e:${e.id}`}>
                                {e.equipment_code}
                                {e.serial_number ? ` · ${e.serial_number}` : ""}
                                {e.utc_instance_id !== null
                                  ? ` — on ${e.utc_name ?? "another UTC"}`
                                  : " — idle"}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {item.equipment_id !== null && onAnotherUtc && (
                        <span className="text-[11px] text-muted-foreground">
                          Currently on {held?.utc_name ?? "another UTC"}
                          {held?.site_name ? ` · ${held.site_name}` : ""} — it
                          will move here.
                        </span>
                      )}
                      {item.asset_id !== null && (
                        /* Nothing moves: another picture keeps its own row.
                           Said out loud anyway, because planning around a
                           finite pool means knowing who else has the box. */
                        <span className="text-[11px] text-muted-foreground">
                          {elsewhere.length === 0
                            ? "Free — no other workspace is using it."
                            : `Also in ${elsewhere
                                .map((c) => c.workspace_name)
                                .join(", ")}.`}
                        </span>
                      )}
                    </div>

                    {item.included && (
                      <>
                        {enclaves.length > 0 && (
                          <div>
                            <label className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                              Enclave
                            </label>
                            <select
                              className={selectClass}
                              value={item.enclave_id ?? ""}
                              onChange={(e) =>
                                patchItem({
                                  enclave_id: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                })
                              }
                            >
                              <option value="">None</option>
                              {/* Only what this model of gear is declared
                                  capable of. An empty declaration means
                                  unrestricted, so fall back to the full list
                                  rather than offering nothing. */}
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

                        {claimed ? (
                          /* Identity is the existing row's, and editing it here
                             would be a rename of accountable property disguised
                             as a deploy field. Shown, not offered. */
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                                Serial number
                              </div>
                              <div className="flex h-8 items-center rounded-md border border-dashed border-border px-2 text-sm text-muted-foreground">
                                {item.serial_number || "—"}
                              </div>
                            </div>
                            <div>
                              <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                                Equipment ID
                              </div>
                              <div className="flex h-8 items-center rounded-md border border-dashed border-border px-2 font-mono text-sm text-muted-foreground">
                                {item.equipment_code}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                                Serial number
                              </label>
                              <input
                                value={item.serial_number}
                                onChange={(e) =>
                                  patchItem({ serial_number: e.target.value })
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
                                  (proposedCodes[active]?.[index] ??
                                    proposeCode(t, item.serial_number))
                                }
                                onChange={(e) =>
                                  patchItem({ equipment_code: e.target.value })
                                }
                                className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-sm"
                              />
                            </div>
                          </div>
                        )}

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
                                    disabled={claimed}
                                    onClick={() =>
                                      patchItem({
                                        capability_kinds: on
                                          ? item.capability_kinds.filter(
                                              (k) => k !== c.kind,
                                            )
                                          : [...item.capability_kinds, c.kind],
                                      })
                                    }
                                    className={cn(
                                      chipClass(on),
                                      claimed && "cursor-default opacity-70",
                                    )}
                                  >
                                    {c.label}
                                  </button>
                                )
                              })}
                            </div>
                            {claimed && (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                Already materialized on this box — edit them
                                from its equipment page.
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ---- 5. bulk ---- */}
          {step === 4 && current && (
            <div className="space-y-3">
              {draftTabs()}
              <p className="text-xs text-muted-foreground">
                Unserialized gear is counted, not tracked per item.
              </p>
              {current.bulk.length === 0 && (
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
                  patchDraft(active, {
                    bulk: [
                      ...current.bulk,
                      {
                        equipment_type_id: t.id,
                        authorized_qty: 1,
                        on_hand_qty: 1,
                        // Bulk isn't enclave-tagged on the instance; this only
                        // rides along to the expectation snapshot.
                        enclave_id: null,
                      },
                    ],
                  })
                }}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">Add bulk gear…</option>
                {types
                  .filter(
                    (t) =>
                      !t.serialized &&
                      !current.bulk.some((b) => b.equipment_type_id === t.id),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.short_name ?? t.title}
                    </option>
                  ))}
              </select>
              {current.bulk.map((b, index) => {
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
                        patchDraft(active, {
                          bulk: current.bulk.map((it, i) =>
                            i === index
                              ? { ...it, authorized_qty: Number(e.target.value) }
                              : it,
                          ),
                        })
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
                        patchDraft(active, {
                          bulk: current.bulk.map((it, i) =>
                            i === index
                              ? { ...it, on_hand_qty: Number(e.target.value) }
                              : it,
                          ),
                        })
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
                        patchDraft(active, {
                          bulk: current.bulk.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          {/* ---- 6. wiring ---- */}
          {step === 5 && current && (
            <div className="space-y-3">
              {draftTabs()}
              <p className="text-xs text-muted-foreground">
                Which services or gateways each capability backs — a capability
                can back several. Pre-selected where the match was obvious.
              </p>
              {siteServices.length === 0 && siteGateways.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  This site has no services or gateways yet — you can wire this
                  gear up later from the equipment detail page.
                </p>
              )}
              {current.items.map((item, index) => {
                const t = typeById.get(item.equipment_type_id)
                if (!t || item.capability_kinds.length === 0) return null
                const groups = serviceGroupsFor(item.enclave_id)
                return (
                  <div
                    key={index}
                    className="space-y-2 rounded-lg border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="font-mono">
                        {proposedCodes[active]?.[index] ??
                          item.equipment_code ??
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
                      const chosen = current.wiring[key] ?? []
                      return (
                        <div
                          key={kind}
                          className="flex items-start gap-2 border-t border-border/60 pt-2 first:border-t-0 first:pt-0"
                        >
                          <span className="w-28 shrink-0 pt-1 text-xs">
                            {CAPABILITY_LABELS[kind as CapabilityKind] ?? kind}
                          </span>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            {/* Services grouped by enclave, this kit's own
                                enclave first. A flat list gave no way to tell
                                which service matched the gear — with NIPR Web
                                and SIPR Web both present and both kind="data",
                                the names were the only clue. */}
                            {groups.map((g) => (
                              <div
                                key={g.key}
                                className="flex flex-wrap items-center gap-1.5"
                              >
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                  {g.enclave
                                    ? `${g.enclave.short_name || g.enclave.name}${
                                        g.matches ? " · matches" : ""
                                      }`
                                    : "No enclave"}
                                </span>
                                {g.services.map((s) => {
                                  const value = `service:${s.id}`
                                  return (
                                    <button
                                      key={s.id}
                                      type="button"
                                      onClick={() => toggleTarget(key, value)}
                                      className={chipClass(
                                        chosen.includes(value),
                                      )}
                                    >
                                      {s.name}
                                    </button>
                                  )
                                })}
                              </div>
                            ))}
                            {siteGateways.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                  Gateways
                                </span>
                                {siteGateways.map((g) => {
                                  const value = `gateway:${g.id}`
                                  return (
                                    <button
                                      key={g.id}
                                      type="button"
                                      onClick={() => toggleTarget(key, value)}
                                      className={chipClass(
                                        chosen.includes(value),
                                      )}
                                    >
                                      {g.name} ({g.pace})
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                            {chosen.length === 0 && (
                              <p className="text-[11px] text-muted-foreground">
                                Not wired
                              </p>
                            )}
                          </div>
                          {item.capability_kinds.length > 1 && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="shrink-0 gap-1.5 text-[11px]"
                              aria-label="Match these services across every capability on this kit"
                              title="Match these services across every capability on this kit"
                              onClick={() =>
                                matchAcrossCapabilities(index, kind)
                              }
                            >
                              <Link2 className="size-3.5" />
                              Match all
                            </Button>
                          )}
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
                <dt className="text-xs text-muted-foreground">Package</dt>
                <dd className="col-span-2">
                  {packageMode === "new" || packageMode === "kit"
                    ? newPackageName || "—"
                    : packageMode === "existing"
                      ? (packages.find((p) => p.id === packageId)?.name ?? "—")
                      : "Standalone"}
                  {/* Only worth saying when the two differ — the package name
                      is seeded from the kit's, so the common case would read
                      "FCP-1 from FCP-1". */}
                  {packageMode === "kit" &&
                    kitId &&
                    kits.find((k) => k.id === kitId)?.name !==
                      newPackageName.trim() && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        from {kits.find((k) => k.id === kitId)?.name}
                      </span>
                    )}
                </dd>
                <dt className="text-xs text-muted-foreground">UTCs</dt>
                <dd className="col-span-2">
                  {drafts.length} queued
                  {drafts.some((d) => d.deployed) &&
                    ` · ${drafts.filter((d) => d.deployed).length} already deployed`}
                </dd>
              </dl>

              {drafts.map((d, i) => {
                const def = d.utcDefId
                  ? utcDefs.find((x) => x.id === d.utcDefId)
                  : null
                const missing = !d.siteId || !nameOf(i).trim()
                return (
                  <div
                    key={d.key}
                    className={cn(
                      "rounded-lg border p-3",
                      d.deployed
                        ? "border-border opacity-60"
                        : missing
                          ? "border-destructive/50"
                          : "border-border",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {nameOf(i) || "Unnamed UTC"}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({UTC_ROLE_LABELS[d.role]})
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {d.deployed
                          ? "Deployed"
                          : (sites.find((s) => s.id === d.siteId)?.name ??
                            "No site")}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {def ? `${def.code} — ${def.name}` : "No definition"} ·{" "}
                      {d.items.filter((i) => i.included).length} serialized
                      {d.items.some((i) => !i.included) &&
                        ` (${d.items.filter((i) => !i.included).length} left home)`}{" "}
                      · {d.bulk.length} bulk{" "}
                      {d.bulk.length === 1 ? "line" : "lines"} ·{" "}
                      {bindingCount(d)} bindings
                    </div>
                    {missing && !d.deployed && (
                      <p className="mt-1 text-xs text-destructive">
                        Needs a site and a name before it can deploy.
                      </p>
                    )}
                  </div>
                )
              })}

              {willMove.length > 0 && (
                /* Stated, not gated. One radio is in one UTC or none, so this
                   moves gear rather than duplicating it — the UTC it leaves
                   reads as a shortfall straight away, which is the honest
                   outcome. Worth saying out loud before the operator commits. */
                <div className="space-y-1.5 rounded-lg border border-border p-3">
                  <div className="text-xs font-medium">
                    {willMove.length} item{willMove.length === 1 ? "" : "s"} will
                    move here from another deployment
                  </div>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {willMove.map((m, i) => (
                      <li key={`${m.code}-${i}`}>
                        <span className="font-mono">{m.code}</span> — from{" "}
                        {m.from}
                        {m.site ? ` · ${m.site}` : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground">
                    Those UTCs will show a shortfall until the gear is replaced
                    or their expected contents are updated.
                  </p>
                </div>
              )}

              {alsoInUse.length > 0 && (
                /* Distinct from `willMove` above: nothing is taken here.
                   Workspaces are separate operating pictures, so each keeps
                   its own row for the same physical box — this is a heads-up
                   for planning a finite pool, not a warning. */
                <div className="space-y-1.5 rounded-lg border border-border p-3">
                  <div className="text-xs font-medium">
                    {alsoInUse.length} item{alsoInUse.length === 1 ? "" : "s"}{" "}
                    {alsoInUse.length === 1 ? "is" : "are"} also in another
                    workspace
                  </div>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {alsoInUse.map((m, i) => (
                      <li key={`${m.code}-${i}`}>
                        <span className="font-mono">{m.code}</span> —{" "}
                        {m.where.join(", ")}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground">
                    Nothing is taken from them — each picture keeps its own
                    record. Worth knowing if the same box can&apos;t physically
                    be in both.
                  </p>
                </div>
              )}

              {drafts.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  These deploy one at a time under the same package. If one
                  fails the rest stop, and the ones already accepted stay.
                </p>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}
        </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => (step === 0 ? setOpen(false) : setStep(step - 1))}
            disabled={pending || submitted}
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {submitted ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              Done
            </Button>
          ) : onLastStep ? (
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={pending || incomplete || pendingDrafts.length === 0}
            >
              {pending
                ? "Deploying…"
                : pendingDrafts.length > 1
                  ? `Deploy ${pendingDrafts.length} UTCs`
                  : "Deploy UTC"}
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
