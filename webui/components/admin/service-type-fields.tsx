"use client"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ICON_MAP,
  ICON_NAMES,
  SERVICE_CATEGORIES,
  SERVICE_KINDS,
  SERVICE_REACH_VALUES,
  categoryLabel,
  kindLabel,
  reachLabel,
} from "@/lib/service-meta"
import { STATUS_VALUES, statusLabel, statusToIndicatorState } from "@/lib/status"
import type {
  Enclave,
  ServiceCategory,
  ServiceKind,
  ServiceReach,
  ServiceTemplate,
  StatusValue,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

/** Everything `ServiceTemplatePatch` accepts except the allowed statuses,
 *  which are a set rather than a field and are edited on their own — in place
 *  on the detail page, and as a separate block in the create dialog. */
export interface TemplateForm {
  name: string
  enclave_id: number | null
  kind: ServiceKind
  category: ServiceCategory
  reach: ServiceReach
  icon: string
  description: string
}

export function emptyTemplateForm(): TemplateForm {
  return {
    name: "",
    enclave_id: null,
    kind: "other",
    category: "other",
    reach: "local",
    icon: "",
    description: "",
  }
}

export function templateFormOf(t: ServiceTemplate): TemplateForm {
  return {
    name: t.name,
    enclave_id: t.enclave_id,
    kind: t.kind,
    category: t.category,
    reach: t.reach,
    icon: t.icon ?? "",
    description: t.description ?? "",
  }
}

/** The JSON body for a create or a patch. An empty icon or description is
 *  sent as null rather than "" — the column is nullable and the reader treats
 *  null as "default from kind". */
export function templateBody(form: TemplateForm) {
  return {
    name: form.name.trim(),
    enclave_id: form.enclave_id,
    kind: form.kind,
    category: form.category,
    reach: form.reach,
    icon: form.icon || null,
    description: form.description.trim() || null,
  }
}

export function templateFormUnchanged(
  form: TemplateForm,
  t: ServiceTemplate,
): boolean {
  return (
    form.name.trim() === t.name &&
    form.enclave_id === t.enclave_id &&
    form.kind === t.kind &&
    form.category === t.category &&
    form.reach === t.reach &&
    form.icon === (t.icon ?? "") &&
    form.description.trim() === (t.description ?? "")
  )
}

/** What a service type is: what it is called, which network it is on, and how
 *  it is classified. Shared by the create dialog and the detail page's
 *  properties sheet, which ask for exactly the same things — the two drifted
 *  apart while they were separate copies of the same eight fields.
 *
 *  `idPrefix` keeps the labels pointing at the right controls when both are
 *  mounted, and keeps the ids stable per surface. */
export function TemplateFields({
  form,
  setForm,
  enclaves,
  disabled,
  idPrefix,
}: {
  form: TemplateForm
  setForm: (form: TemplateForm) => void
  enclaves: Enclave[]
  disabled: boolean
  idPrefix: string
}) {
  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("name")}>Name</Label>
        <Input
          id={id("name")}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("description")}>Description</Label>
        <Textarea
          id={id("description")}
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("enclave")}>Enclave</Label>
        <select
          id={id("enclave")}
          className={SELECT_CLASS}
          value={form.enclave_id ?? ""}
          onChange={(e) =>
            setForm({
              ...form,
              enclave_id: e.target.value ? Number(e.target.value) : null,
            })
          }
          disabled={disabled}
        >
          <option value="">None</option>
          {enclaves.map((en) => (
            <option key={en.id} value={en.id}>
              {en.name}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground">
          Services created from this template inherit it. This is where the
          NIPR/SIPR split used to live as a name prefix.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("kind")}>Kind</Label>
          <select
            id={id("kind")}
            className={SELECT_CLASS}
            value={form.kind}
            onChange={(e) =>
              setForm({ ...form, kind: e.target.value as ServiceKind })
            }
            disabled={disabled}
          >
            {SERVICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("reach")}>Reach</Label>
          <select
            id={id("reach")}
            className={SELECT_CLASS}
            value={form.reach}
            onChange={(e) =>
              setForm({ ...form, reach: e.target.value as ServiceReach })
            }
            disabled={disabled}
          >
            {SERVICE_REACH_VALUES.map((r) => (
              <option key={r} value={r}>
                {reachLabel(r)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("category")}>Category</Label>
        <select
          id={id("category")}
          className={SELECT_CLASS}
          value={form.category}
          onChange={(e) =>
            setForm({ ...form, category: e.target.value as ServiceCategory })
          }
          disabled={disabled}
        >
          {SERVICE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("icon")}>Icon</Label>
        <span className="text-[11px] text-muted-foreground">
          Click to pick. Leave on auto to default from the kind.
        </span>
        {/* A radiogroup rather than a row of buttons: this picks one of a set,
            and a keyboard reaching it should hear that it has. */}
        <div
          id={id("icon")}
          role="radiogroup"
          aria-label="Icon"
          // Six across, not the nine the dialog used to pack in: at nine the
          // cells were narrower than the word "auto" printed in the first one.
          className="grid grid-cols-6 gap-1.5"
        >
          <button
            type="button"
            role="radio"
            aria-checked={form.icon === ""}
            onClick={() => setForm({ ...form, icon: "" })}
            className={cn(
              "flex h-9 items-center justify-center rounded-md border text-[10px] uppercase",
              form.icon === ""
                ? "border-foreground bg-accent"
                : "border-input hover:bg-accent/50",
            )}
            title="Default from kind"
            disabled={disabled}
          >
            auto
          </button>
          {ICON_NAMES.map((name) => {
            const IconComp = ICON_MAP[name]
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={form.icon === name}
                aria-label={name}
                onClick={() => setForm({ ...form, icon: name })}
                className={cn(
                  "flex h-9 items-center justify-center rounded-md border",
                  form.icon === name
                    ? "border-foreground bg-accent"
                    : "border-input hover:bg-accent/50",
                )}
                title={name}
                disabled={disabled}
              >
                <IconComp className="size-4" />
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

/** The statuses an instance of this type may be set to. `null` means every
 *  one of them — which is what the API stores, and what unchecking nothing
 *  has to come back to, so a full set is normalized back to null on the way
 *  out rather than written out longhand. */
export function AllowedStatusPicker({
  value,
  onChange,
  disabled,
}: {
  value: StatusValue[] | null
  onChange: (next: StatusValue[] | null) => void
  disabled: boolean
}) {
  const on = new Set(value ?? STATUS_VALUES)

  function toggle(s: StatusValue) {
    const current = value ?? STATUS_VALUES.slice()
    const next = current.includes(s)
      ? current.filter((x) => x !== s)
      : [...current, s]
    onChange(next.length === STATUS_VALUES.length ? null : next)
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {STATUS_VALUES.map((s) => (
        <button
          key={s}
          type="button"
          role="checkbox"
          aria-checked={on.has(s)}
          onClick={() => toggle(s)}
          className={cn(
            "flex items-center justify-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors",
            on.has(s)
              ? "border-foreground bg-accent"
              : "border-input opacity-50 hover:opacity-100",
          )}
          disabled={disabled}
        >
          <StatusIndicator state={statusToIndicatorState(s)} size="sm" />
          {statusLabel(s)}
        </button>
      ))}
    </div>
  )
}

/** The allowed statuses at rest. An empty set is stored as null and read as
 *  "all of them", so the absent case is a sentence rather than a blank. */
export function AllowedStatusChips({
  statuses,
}: {
  statuses: StatusValue[] | null
}) {
  if (!statuses || statuses.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        All allowed — nothing is ruled out.
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      {statuses.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider"
        >
          <StatusIndicator state={statusToIndicatorState(s)} size="sm" />
          {statusLabel(s)}
        </span>
      ))}
    </div>
  )
}
