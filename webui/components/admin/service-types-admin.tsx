"use client"

import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  AllowedStatusPicker,
  TemplateFields,
  emptyTemplateForm,
  templateBody,
  type TemplateForm,
} from "@/components/admin/service-type-fields"
import { EnclaveChip } from "@/components/enclaves/enclaves-client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  SERVICE_CATEGORIES,
  categoryLabel,
  kindLabel,
  reachLabel,
  serviceIcon,
} from "@/lib/service-meta"
import { STATUS_VALUES } from "@/lib/status"
import type { Enclave, ServiceTemplate, StatusValue } from "@/lib/types"

interface Props {
  templates: ServiceTemplate[]
  enclaves?: Enclave[]
}

/** The service catalog, one row per type.
 *
 *  A row is a link to the type's own page rather than nine columns and a
 *  pencil at the end of them: the table used to carry every field the editor
 *  did — description included — which made it both unreadable and the only
 *  place a type could be looked at. What is left is what tells two types
 *  apart at a glance.
 *
 *  Grouped by category, which is also the order the API returns. */
export function ServiceTypesAdmin({ templates, enclaves = [] }: Props) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const enclaveById = new Map(enclaves.map((e) => [e.id, e]))

  // Every category that has rows, in the canonical order, plus anything the
  // API sends that this build does not know the name of — a row nobody can
  // see is worse than a row under an unfamiliar heading.
  const groups = [
    ...SERVICE_CATEGORIES,
    ...new Set(
      templates
        .map((t) => t.category)
        .filter((c) => !SERVICE_CATEGORIES.includes(c)),
    ),
  ]
    .map((c) => [c, templates.filter((t) => t.category === c)] as const)
    .filter(([, rows]) => rows.length > 0)

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus data-icon="inline-start" />
          New type
        </Button>
      </div>

      {templates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No service types yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Enclave</TableHead>
              <TableHead className="w-24">Kind</TableHead>
              <TableHead className="w-24">Reach</TableHead>
              <TableHead className="w-36 text-right">Statuses</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(([cat, rows]) => [
              <TableRow key={`group-${cat}`} className="bg-muted/40 hover:bg-muted/40">
                <TableCell
                  colSpan={5}
                  className="py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {categoryLabel(cat)}
                  <span className="ml-1.5 font-normal">({rows.length})</span>
                </TableCell>
              </TableRow>,
              ...rows.map((t) => {
                const Icon = serviceIcon(t.icon, t.kind)
                const enclave =
                  t.enclave_id === null ? undefined : enclaveById.get(t.enclave_id)
                return (
                  <TableRow
                    key={t.id}
                    onClick={() => router.push(`/admin/service-types/${t.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <div className="flex min-w-0 items-start gap-2">
                        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="font-medium">{t.name}</div>
                          {t.description && (
                            <div className="truncate text-xs text-muted-foreground">
                              {t.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {enclave ? (
                        <EnclaveChip enclave={enclave} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {kindLabel(t.kind)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {reachLabel(t.reach)}
                    </TableCell>
                    {/* A count rather than the chips themselves: a row of
                        seven status pills was the widest thing on the page
                        and said the same thing on almost every row. */}
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {t.allowed_statuses && t.allowed_statuses.length > 0
                        ? `${t.allowed_statuses.length} of ${STATUS_VALUES.length}`
                        : "All allowed"}
                    </TableCell>
                  </TableRow>
                )
              }),
            ])}
          </TableBody>
        </Table>
      )}

      {creating && (
        <CreateDialog
          enclaves={enclaves}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/admin/service-types/${id}`)}
        />
      )}
    </>
  )
}

/** A new type, then straight to its page — the thing you do next after
 *  creating one is look at it. */
function CreateDialog({
  enclaves,
  onClose,
  onCreated,
}: {
  enclaves: Enclave[]
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<TemplateForm>(emptyTemplateForm)
  const [statuses, setStatuses] = useState<StatusValue[] | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/be/service-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...templateBody(form),
          allowed_statuses: statuses,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(typeof j.detail === "string" ? j.detail : "Save failed")
      }
      const created: ServiceTemplate = await res.json()
      onClose()
      onCreated(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  const blocked = pending || !form.name.trim()

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New service type</DialogTitle>
        </DialogHeader>
        {/* A real form, so Enter in any single-line field creates the way it
            does in every other dialog. */}
        <form
          className="flex min-h-0 flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (!blocked) submit()
          }}
        >
          {/* The field set is tall enough to run off a laptop screen, so it
              scrolls rather than pushing the buttons past the bottom of the
              dialog. */}
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            <TemplateFields
              form={form}
              setForm={setForm}
              enclaves={enclaves}
              disabled={pending}
              idPrefix="new-svc-type"
            />
            <div className="flex flex-col gap-1.5">
              <Label>Allowed statuses</Label>
              <span className="text-[11px] text-muted-foreground">
                What a service of this type may be set to. Leave every one on
                to allow all.
              </span>
              <AllowedStatusPicker
                value={statuses}
                onChange={setStatuses}
                disabled={pending}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={blocked}>
              {pending ? "Saving…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
