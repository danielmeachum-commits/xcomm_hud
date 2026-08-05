"use client"

import { Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  CATEGORY_VALUES,
  CapabilityEditor,
  EnclaveCapabilityPicker,
  type CapabilityDraft,
} from "@/components/equipment/catalog-detail-sheets"
import { TagsInput } from "@/components/equipment/tags-input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  CAPABILITY_LABELS,
  EQUIPMENT_CATEGORY_LABELS,
} from "@/lib/equipment-meta"
import type {
  Enclave,
  EquipmentCategory,
  EquipmentType,
  UtcDef,
  UtcRoleHint,
} from "@/lib/types"

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

const ROLE_HINTS: { value: UtcRoleHint; label: string }[] = [
  { value: "either", label: "Any role" },
  { value: "primary", label: "Primary" },
  { value: "extension", label: "Extension" },
]

export type CatalogKind = "types" | "utcs" | "packages"

const KIND_LABELS: Record<CatalogKind, string> = {
  types: "equipment type",
  utcs: "UTC definition",
  packages: "package",
}

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (res.ok) return null
  const detail = await res.json().catch(() => ({}))
  return typeof detail.detail === "string"
    ? detail.detail
    : `Failed to create (${res.status})`
}

interface LineDraft {
  equipment_type_id: number | ""
  quantity: number
}

interface UtcSlotDraft {
  utc_def_id: number | ""
  quantity: number
  role_hint: UtcRoleHint
}

/** One row of a bill of materials — reused for both UTC lines (equipment
 *  types) and package slots (UTC defs), which differ only in what they pick. */
function QuantityRow({
  children,
  quantity,
  onQuantity,
  onRemove,
  disabled,
}: {
  children: React.ReactNode
  quantity: number
  onQuantity: (n: number) => void
  onRemove: () => void
  disabled: boolean
}) {
  return (
    <div className="flex gap-1.5">
      {children}
      <Input
        type="number"
        min={1}
        aria-label="Quantity"
        className="w-20"
        value={quantity}
        disabled={disabled}
        onChange={(e) => onQuantity(Math.max(1, Number(e.target.value) || 1))}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Remove row"
        disabled={disabled}
        onClick={onRemove}
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}

/** Create dialog for the three catalog kinds. Which form it shows follows the
 *  active tab, so the button always creates the thing the operator is looking
 *  at. */
export function CatalogCreateDialog({
  kind,
  types,
  utcDefs,
  enclaves = [],
  isAdmin,
}: {
  kind: CatalogKind
  types: EquipmentType[]
  utcDefs: UtcDef[]
  enclaves?: Enclave[]
  isAdmin: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Admins can seed the shared catalog; everyone else creates workspace rows.
  const [makeGlobal, setMakeGlobal] = useState(false)

  // shared by all three
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  // equipment type
  const [shortName, setShortName] = useState("")
  const [category, setCategory] = useState<EquipmentCategory>("other")
  const [tags, setTags] = useState<string[]>([])
  const [serialized, setSerialized] = useState(true)
  const [idPrefix, setIdPrefix] = useState("R")
  const [capabilities, setCapabilities] = useState<CapabilityDraft[]>([])
  const [typeEnclaves, setTypeEnclaves] = useState<number[]>([])
  // UTC def / package
  const [code, setCode] = useState("")
  const [lines, setLines] = useState<LineDraft[]>([])
  const [slots, setSlots] = useState<UtcSlotDraft[]>([])

  function reset() {
    setName("")
    setDescription("")
    setShortName("")
    setCategory("other")
    setTags([])
    setSerialized(true)
    setIdPrefix("R")
    setCapabilities([])
    setTypeEnclaves([])
    setCode("")
    setLines([])
    setSlots([])
    setMakeGlobal(false)
    setError(null)
  }

  const canSubmit =
    name.trim().length > 0 && (kind === "types" || code.trim().length > 0)

  async function submit() {
    setPending(true)
    setError(null)
    const scope = makeGlobal ? "?global=true" : ""
    let err: string | null
    if (kind === "types") {
      err = await post(`/api/be/equipment-types${scope}`, {
        title: name.trim(),
        short_name: shortName.trim() || null,
        category,
        tags,
        serialized,
        id_prefix: idPrefix.trim() || "R",
        description: description.trim() || null,
        enclave_ids: typeEnclaves,
        capabilities: capabilities.map((c) => ({
          kind: c.kind,
          label: c.label.trim() || CAPABILITY_LABELS[c.kind],
          materialize_by_default: c.materialize_by_default,
        })),
      })
    } else if (kind === "utcs") {
      err = await post(`/api/be/utc-defs${scope}`, {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
        lines: lines
          .filter((l) => l.equipment_type_id !== "")
          .map((l) => ({
            equipment_type_id: Number(l.equipment_type_id),
            quantity: l.quantity,
          })),
      })
    } else {
      err = await post(`/api/be/package-defs${scope}`, {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
        utcs: slots
          .filter((s) => s.utc_def_id !== "")
          .map((s) => ({
            utc_def_id: Number(s.utc_def_id),
            quantity: s.quantity,
            role_hint: s.role_hint,
          })),
      })
    }
    setPending(false)
    if (err) {
      setError(err)
      return
    }
    setOpen(false)
    reset()
    router.refresh()
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
        New {KIND_LABELS[kind]}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New {KIND_LABELS[kind]}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {kind !== "types" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="cat-code">Code</Label>
              <Input
                id="cat-code"
                value={code}
                placeholder={kind === "utcs" ? "UTC-6KQ9" : "FCP"}
                className="font-mono uppercase"
                disabled={pending}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="cat-name">
              {kind === "types" ? "Title" : "Name"}
            </Label>
            <Input
              id="cat-name"
              value={name}
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {kind === "types" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="cat-short">Short name</Label>
                  <Input
                    id="cat-short"
                    value={shortName}
                    disabled={pending}
                    onChange={(e) => setShortName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="cat-category">Category</Label>
                  <select
                    id="cat-category"
                    className={SELECT_CLASS}
                    value={category}
                    disabled={pending}
                    onChange={(e) =>
                      setCategory(e.target.value as EquipmentCategory)
                    }
                  >
                    {CATEGORY_VALUES.map((c) => (
                      <option key={c} value={c}>
                        {EQUIPMENT_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label>Tags</Label>
                <TagsInput
                  value={tags}
                  onChange={setTags}
                  disabled={pending}
                />
              </div>

              <div className="flex items-end gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="cat-prefix">ID prefix</Label>
                  <Input
                    id="cat-prefix"
                    className="w-20"
                    value={idPrefix}
                    disabled={pending || !serialized}
                    onChange={(e) => setIdPrefix(e.target.value)}
                  />
                </div>
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={serialized}
                    disabled={pending}
                    onChange={(e) => setSerialized(e.target.checked)}
                  />
                  Tracked by serial
                </label>
              </div>

              <div className="flex flex-col gap-1">
                <Label>Enclaves this gear can serve</Label>
                <EnclaveCapabilityPicker
                  enclaves={enclaves}
                  value={typeEnclaves}
                  onChange={setTypeEnclaves}
                  disabled={pending}
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label>Capabilities</Label>
                <CapabilityEditor
                  value={capabilities}
                  onChange={setCapabilities}
                  disabled={pending}
                />
              </div>
            </>
          )}

          {kind === "utcs" && (
            <div className="flex flex-col gap-1">
              <Label>Bill of materials</Label>
              <p className="text-xs text-muted-foreground">
                Equipment types and how many of each. Serialized types become
                one row per unit when the UTC is deployed.
              </p>
              <div className="mt-1 flex flex-col gap-1.5">
                {lines.map((l, i) => (
                  <QuantityRow
                    key={i}
                    quantity={l.quantity}
                    disabled={pending}
                    onQuantity={(n) =>
                      setLines(
                        lines.map((x, j) =>
                          j === i ? { ...x, quantity: n } : x,
                        ),
                      )
                    }
                    onRemove={() => setLines(lines.filter((_, j) => j !== i))}
                  >
                    <select
                      aria-label="Equipment type"
                      className={SELECT_CLASS + " flex-1"}
                      value={l.equipment_type_id}
                      disabled={pending}
                      onChange={(e) =>
                        setLines(
                          lines.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  equipment_type_id: e.target.value
                                    ? Number(e.target.value)
                                    : "",
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      <option value="">Select a type…</option>
                      {types.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.short_name ?? t.title}
                        </option>
                      ))}
                    </select>
                  </QuantityRow>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={pending}
                  onClick={() =>
                    setLines([
                      ...lines,
                      { equipment_type_id: "", quantity: 1 },
                    ])
                  }
                >
                  <Plus className="size-4" />
                  Add line item
                </Button>
              </div>
            </div>
          )}

          {kind === "packages" && (
            <div className="flex flex-col gap-1">
              <Label>UTCs</Label>
              <p className="text-xs text-muted-foreground">
                Which UTCs make up this package, and whether each is the primary
                or an extension.
              </p>
              <div className="mt-1 flex flex-col gap-1.5">
                {slots.map((s, i) => (
                  <QuantityRow
                    key={i}
                    quantity={s.quantity}
                    disabled={pending}
                    onQuantity={(n) =>
                      setSlots(
                        slots.map((x, j) =>
                          j === i ? { ...x, quantity: n } : x,
                        ),
                      )
                    }
                    onRemove={() => setSlots(slots.filter((_, j) => j !== i))}
                  >
                    <select
                      aria-label="UTC definition"
                      className={SELECT_CLASS + " flex-1"}
                      value={s.utc_def_id}
                      disabled={pending}
                      onChange={(e) =>
                        setSlots(
                          slots.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  utc_def_id: e.target.value
                                    ? Number(e.target.value)
                                    : "",
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      <option value="">Select a UTC…</option>
                      {utcDefs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} — {d.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Role"
                      className={SELECT_CLASS + " w-32"}
                      value={s.role_hint}
                      disabled={pending}
                      onChange={(e) =>
                        setSlots(
                          slots.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  role_hint: e.target.value as UtcRoleHint,
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      {ROLE_HINTS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </QuantityRow>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={pending}
                  onClick={() =>
                    setSlots([
                      ...slots,
                      { utc_def_id: "", quantity: 1, role_hint: "either" },
                    ])
                  }
                >
                  <Plus className="size-4" />
                  Add UTC
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="cat-desc">Description</Label>
            <Textarea
              id="cat-desc"
              rows={2}
              value={description}
              disabled={pending}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {isAdmin && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={makeGlobal}
                disabled={pending}
                onChange={(e) => setMakeGlobal(e.target.checked)}
              />
              Add to the global catalog (shared across workspaces)
            </label>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={pending || !canSubmit} onClick={submit}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
