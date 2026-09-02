"use client"

import { Pencil, SlidersHorizontal, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  AllowedStatusChips,
  AllowedStatusPicker,
  TemplateFields,
  templateBody,
  templateFormOf,
  templateFormUnchanged,
  type TemplateForm,
} from "@/components/admin/service-type-fields"
import { EnclaveChip } from "@/components/enclaves/enclaves-client"
import { ManageBar } from "@/components/equipment/manage-bar"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  ICON_MAP,
  SERVICE_KIND_ICONS,
  categoryLabel,
  kindLabel,
  reachLabel,
} from "@/lib/service-meta"
import { STATUS_VALUES } from "@/lib/status"
import type { Enclave, ServiceTemplate, StatusValue } from "@/lib/types"

async function patch(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (res.ok) return null
  const detail = await res.json().catch(() => ({}))
  return typeof detail.detail === "string" ? detail.detail : "Failed to save"
}

/** Order is not part of the value — the API stores a set — so a signature
 *  sorts first, and null (every status) has to compare equal to the full list
 *  spelled out, which is what a picker that ends up with nothing unchecked
 *  hands back. */
function statusSignature(statuses: StatusValue[] | null): string {
  return [...(statuses ?? STATUS_VALUES)].sort().join(",")
}

/** One service type: what it is called, which network it is on, how it is
 *  classified, and which statuses its instances may be set to.
 *
 *  A page rather than the row-plus-dialog it used to be. The catalog table put
 *  every field in a column — description included — and hid editing behind a
 *  pencil at the end of a nine-column row, which meant the list was unreadable
 *  and the type had no address of its own. Built to the shape the UTC
 *  definition and equipment type pages settled on: read mode is the point of
 *  the page, the allowed statuses have a Manage that turns them into an editor
 *  with a Cancel/Save bar, and the plain properties sit behind one panel. */
export function ServiceTypeDetailClient({
  template,
  enclaves,
}: {
  template: ServiceTemplate
  enclaves: Enclave[]
}) {
  const router = useRouter()
  const [editingProperties, setEditingProperties] = useState(false)
  const [form, setForm] = useState<TemplateForm>(() => templateFormOf(template))

  const [managing, setManaging] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<StatusValue[] | null>(
    () => template.allowed_statuses,
  )

  // Indexed rather than resolved through `serviceIcon`: a call returning a
  // component in a render body is what the static-components rule is there to
  // catch. Same fallback, spelled out.
  const Icon =
    (template.icon ? ICON_MAP[template.icon] : undefined) ??
    SERVICE_KIND_ICONS[template.kind]
  const enclave =
    template.enclave_id === null
      ? null
      : (enclaves.find((e) => e.id === template.enclave_id) ?? null)

  const statusesDirty =
    statusSignature(statuses) !== statusSignature(template.allowed_statuses)

  /** Seed from the saved row on the way in, rather than trusting whatever a
   *  cancelled edit left behind. */
  function startManaging() {
    setStatuses(template.allowed_statuses)
    setError(null)
    setManaging(true)
  }

  function stopManaging() {
    setError(null)
    setManaging(false)
  }

  async function saveStatuses() {
    setPending(true)
    setError(null)
    // Sent even when null — `exclude_unset` on the patch schema means an
    // omitted key leaves the stored set alone, so clearing back to "all
    // allowed" has to say null out loud.
    const err = await patch(`/api/be/service-templates/${template.id}`, {
      allowed_statuses: statuses,
    })
    setPending(false)
    if (err) {
      setError(err)
      return
    }
    setManaging(false)
    router.refresh()
  }

  async function remove() {
    if (
      !confirm(
        `Delete service type "${template.name}"? Existing services are kept but lose the link.`,
      )
    )
      return
    const res = await fetch(`/api/be/service-templates/${template.id}`, {
      method: "DELETE",
    })
    if (res.ok) router.push("/admin/service-types")
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-lg flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            <Icon className="size-5 shrink-0 text-muted-foreground" />
            <span>{template.name}</span>
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {categoryLabel(template.category)}
            </span>
          </h1>
          {template.description ? (
            <p className="text-sm text-muted-foreground">
              {template.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/60">No description.</p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setForm(templateFormOf(template))
            setEditingProperties(true)
          }}
        >
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
      </header>

      {/* What a service created from this template starts out as. No heading
          and no Manage of its own: these are the header spelled out, and every
          one of them is edited in the panel the header opens. */}
      <ItemGroup>
        <DetailRow label="Enclave">
          {enclave ? (
            <EnclaveChip enclave={enclave} />
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </DetailRow>
        <DetailRow label="Kind">{kindLabel(template.kind)}</DetailRow>
        <DetailRow
          label="Reach"
          hint="Whether the service is served on site or comes in from outside it"
        >
          {reachLabel(template.reach)}
        </DetailRow>
      </ItemGroup>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Allowed statuses</h2>
            <p className="text-xs text-muted-foreground">
              What a service of this type may be set to. Leave every one on to
              allow all.
            </p>
          </div>
          {/* While managing, the action bar is the only way out — a second exit
              up here was easy to miss and, once dirty, would have been a button
              that silently discarded the edit. */}
          {!managing && (
            <Button variant="ghost" size="sm" onClick={startManaging}>
              <SlidersHorizontal data-icon="inline-start" />
              Manage
            </Button>
          )}
        </div>
        {managing ? (
          <>
            <AllowedStatusPicker
              value={statuses}
              onChange={setStatuses}
              disabled={pending}
            />
            <ManageBar
              hint="Switch off any status that should not be selectable."
              error={error}
              dirty={statusesDirty}
              pending={pending}
              onCancel={stopManaging}
              onSave={saveStatuses}
            />
          </>
        ) : (
          <AllowedStatusChips statuses={template.allowed_statuses} />
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          {template.icon
            ? `Icon: ${template.icon}`
            : `Icon: default for ${kindLabel(template.kind).toLowerCase()}`}
        </p>
        <Button variant="ghost" size="sm" onClick={remove}>
          <Trash2 data-icon="inline-start" />
          Delete type
        </Button>
      </footer>

      <PropertiesSheet
        template={template}
        form={form}
        setForm={setForm}
        enclaves={enclaves}
        open={editingProperties}
        onClose={() => setEditingProperties(false)}
      />
    </div>
  )
}

/** One fact about the type: what it is called on the left, what it is on the
 *  right. Same `Item` shape as the equipment type page's identification block,
 *  so the catalog pages stack their rows identically. */
function DetailRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <Item variant="muted" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle
          title={hint}
          className={
            "font-normal text-muted-foreground" +
            (hint ? " cursor-help decoration-dotted underline-offset-2" : "")
          }
        >
          {label}
        </ItemTitle>
      </ItemContent>
      <ItemActions className="flex-wrap justify-end gap-1.5 text-sm">
        {children}
      </ItemActions>
    </Item>
  )
}

/** Everything `ServiceTemplatePatch` accepts bar the allowed statuses, which
 *  are managed in place on the page — so a failure here names a field rather
 *  than reporting that part of a single Save went through. */
function PropertiesSheet({
  template,
  form,
  setForm,
  enclaves,
  open,
  onClose,
}: {
  template: ServiceTemplate
  form: TemplateForm
  setForm: (form: TemplateForm) => void
  enclaves: Enclave[]
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Close by any route — Cancel, the X, Escape, the backdrop — and drop the
   *  error with it, so a failed save cannot greet the next open. */
  function close() {
    setError(null)
    onClose()
  }

  const blocked =
    pending || templateFormUnchanged(form, template) || !form.name.trim()

  async function save() {
    setPending(true)
    setError(null)
    const err = await patch(
      `/api/be/service-templates/${template.id}`,
      templateBody(form),
    )
    setPending(false)
    if (err) {
      setError(err)
      return
    }
    close()
    router.refresh()
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit service type</SheetTitle>
          <SheetDescription>
            What a service created from this template starts out as.
          </SheetDescription>
        </SheetHeader>

        {/* A real form, so Enter in any single-line field saves the way it does
            in every other dialog. The description is a textarea, where Enter is
            a newline and rightly stays one. Escape is already Cancel — Base UI
            closes the dialog on it, and closing discards. */}
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (!blocked) save()
          }}
        >
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6">
            <TemplateFields
              form={form}
              setForm={setForm}
              enclaves={enclaves}
              disabled={pending}
              idPrefix="svc-type"
            />
          </div>

          <SheetFooter className="flex-col items-stretch gap-2">
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button
                type="submit"
                className="flex-1"
                // A blank name would be saved as one; the API has no
                // min-length on it, so the guard has to live here.
                disabled={blocked}
              >
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={close}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
