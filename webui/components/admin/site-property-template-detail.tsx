"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import {
  ArrowLeft,
  Check,
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/lib/workspace"
import { cn } from "@/lib/utils"
import type {
  SitePropertyDefinition,
  SitePropertyTemplate,
  SitePropertyType,
} from "@/lib/types"

const TYPES: SitePropertyType[] = [
  "text",
  "long_text",
  "number",
  "phone",
  "email",
  "url",
  "date",
  "bool",
  "personnel",
]

const TYPE_LABEL: Record<SitePropertyType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  phone: "Phone",
  email: "Email",
  url: "URL",
  date: "Date",
  bool: "Yes/No",
  personnel: "Person",
}

const UNGROUPED = "__ungrouped__"

interface DraftRow {
  clientId: string
  label: string
  key: string
  type: SitePropertyType
  required: boolean
  group: string | null
  description: string
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
}

interface Props {
  template: SitePropertyTemplate
}

interface Section {
  /** Group name — null for the ungrouped bucket. */
  name: string | null
  definitions: SitePropertyDefinition[]
}

// A field being dragged between sections (or reordered within one).
type FieldDrag = { kind: "field"; id: number }
// A whole section being dragged to reorder — only real named sections.
type SectionDrag = { kind: "section"; name: string }
type DragState = FieldDrag | SectionDrag | null

export function SitePropertyTemplateDetail({ template }: Props) {
  const router = useRouter()
  const { w } = useWorkspace()
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [drag, setDrag] = useState<DragState>(null)
  const [fieldDropTarget, setFieldDropTarget] = useState<number | "end" | null>(
    null,
  )
  const [sectionDropTarget, setSectionDropTarget] = useState<string | null>(
    null,
  )

  // Fields, sorted by display_order, then grouped into sections. Sections
  // follow `group_order`; the ungrouped bucket goes last when non-empty.
  const sections = useMemo<Section[]>(() => {
    const byGroup = new Map<string | null, SitePropertyDefinition[]>()
    const sorted = [...template.definitions].sort(
      (a, b) => a.display_order - b.display_order,
    )
    for (const d of sorted) {
      const key = d.group ?? null
      const list = byGroup.get(key) ?? []
      list.push(d)
      byGroup.set(key, list)
    }
    const out: Section[] = []
    for (const name of template.group_order) {
      out.push({ name, definitions: byGroup.get(name) ?? [] })
      byGroup.delete(name)
    }
    // Named groups not in group_order — append in name order so nothing is
    // lost if a definition references an unknown group.
    const orphans = [...byGroup.keys()].filter((k) => k !== null) as string[]
    for (const name of orphans.sort()) {
      out.push({ name, definitions: byGroup.get(name) ?? [] })
      byGroup.delete(name)
    }
    // Ungrouped bucket, if any.
    const ungrouped = byGroup.get(null) ?? []
    if (ungrouped.length > 0) out.push({ name: null, definitions: ungrouped })
    return out
  }, [template.definitions, template.group_order])

  async function patchTemplate(
    patch: Partial<{
      name: string
      description: string | null
      group_order: string[]
    }>,
  ) {
    const res = await fetch(`/api/be/site-property-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (res.ok) router.refresh()
  }

  async function deleteTemplate() {
    if (
      !confirm(
        `Delete template "${template.name}"? Sites that already applied it keep their properties.`,
      )
    )
      return
    const res = await fetch(`/api/be/site-property-templates/${template.id}`, {
      method: "DELETE",
    })
    if (res.ok) router.push(w("/admin/site-properties"))
  }

  async function renameGroup(old: string | null, next: string | null) {
    const res = await fetch(
      `/api/be/site-property-templates/${template.id}/rename-group`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old, new: next }),
      },
    )
    if (res.ok) router.refresh()
    else {
      const j = await res.json().catch(() => ({}))
      alert(j.detail ?? "Rename failed")
    }
  }

  async function addSection() {
    // Nudge unique default names — "New section", "New section 2", …
    let base = "New section"
    const existing = new Set(template.group_order)
    let candidate = base
    let n = 2
    while (existing.has(candidate)) {
      candidate = `${base} ${n++}`
    }
    await patchTemplate({
      group_order: [...template.group_order, candidate],
    })
  }

  async function moveSection(name: string, targetName: string) {
    if (name === targetName) return
    const order = [...template.group_order]
    const from = order.indexOf(name)
    const to = order.indexOf(targetName)
    if (from < 0 || to < 0) return
    order.splice(to, 0, order.splice(from, 1)[0])
    await patchTemplate({ group_order: order })
  }

  function addDraft(group: string | null) {
    setDrafts((prev) => [
      ...prev,
      {
        clientId: crypto.randomUUID(),
        label: "",
        key: "",
        type: "text",
        required: false,
        group,
        description: "",
      },
    ])
  }

  function updateDraft(clientId: string, patch: Partial<DraftRow>) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.clientId !== clientId) return d
        const next = { ...d, ...patch }
        if (patch.label !== undefined && d.key === slugify(d.label)) {
          next.key = slugify(patch.label)
        }
        return next
      }),
    )
  }

  function discardDraft(clientId: string) {
    setDrafts((prev) => prev.filter((d) => d.clientId !== clientId))
  }

  async function saveDraft(clientId: string) {
    const d = drafts.find((x) => x.clientId === clientId)
    if (!d) return
    const body = {
      key: d.key,
      label: d.label,
      type: d.type,
      required: d.required,
      group: d.group,
      description: d.description || null,
      // Land at the end of the current field order.
      display_order: template.definitions.length,
    }
    const res = await fetch(
      `/api/be/site-property-templates/${template.id}/definitions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    )
    if (res.ok) {
      discardDraft(clientId)
      router.refresh()
    } else {
      const j = await res.json().catch(() => ({}))
      alert(j.detail ?? "Save failed")
    }
  }

  async function patchDefinition(
    id: number,
    patch: Partial<
      SitePropertyDefinition & {
        group: string | null
        description: string | null
      }
    >,
  ) {
    const res = await fetch(
      `/api/be/site-property-templates/${template.id}/definitions/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    )
    if (res.ok) router.refresh()
  }

  async function deleteDefinition(d: SitePropertyDefinition) {
    if (!confirm(`Remove field "${d.label}"?`)) return
    const res = await fetch(
      `/api/be/site-property-templates/${template.id}/definitions/${d.id}`,
      { method: "DELETE" },
    )
    if (res.ok) router.refresh()
  }

  /** Drop a field on another field: reorder + (if crossing sections) reparent. */
  async function commitFieldDrop(
    fromId: number,
    target: { kind: "field"; id: number } | { kind: "section-end"; group: string | null },
  ) {
    const dragged = template.definitions.find((d) => d.id === fromId)
    if (!dragged) return

    // Flat order = concat of all sections in section order.
    const flat = sections.flatMap((s) => s.definitions)
    const from = flat.findIndex((d) => d.id === fromId)
    if (from < 0) return

    let toIdx: number
    let newGroup: string | null
    if (target.kind === "field") {
      toIdx = flat.findIndex((d) => d.id === target.id)
      const targetDef = flat[toIdx]
      newGroup = targetDef.group
    } else {
      // Land at the end of a section — find the last field currently in
      // that section and insert after it, or at the top of that section if empty.
      const section = sections.find((s) => s.name === target.group)
      newGroup = target.group
      if (section && section.definitions.length > 0) {
        const lastId = section.definitions[section.definitions.length - 1].id
        toIdx = flat.findIndex((d) => d.id === lastId) + 1
      } else {
        // Empty section: place at the boundary where this section would go.
        // Find the position of the first field in the following section, else end.
        const sectionIdx = sections.findIndex((s) => s.name === target.group)
        let boundary = flat.length
        for (let i = sectionIdx + 1; i < sections.length; i++) {
          const firstNext = sections[i].definitions[0]
          if (firstNext) {
            boundary = flat.findIndex((d) => d.id === firstNext.id)
            break
          }
        }
        toIdx = boundary
      }
    }
    if (toIdx < 0) return

    // Splice
    const [moved] = flat.splice(from, 1)
    flat.splice(from < toIdx ? toIdx - 1 : toIdx, 0, moved)

    // Compute patches: any field whose display_order or group changed.
    const patches: Array<{
      id: number
      patch: { display_order?: number; group?: string | null }
    }> = []
    flat.forEach((d, idx) => {
      const patch: { display_order?: number; group?: string | null } = {}
      if (d.display_order !== idx) patch.display_order = idx
      if (d.id === fromId && d.group !== newGroup) patch.group = newGroup
      if (Object.keys(patch).length > 0) patches.push({ id: d.id, patch })
    })

    await Promise.all(
      patches.map(({ id, patch }) =>
        fetch(
          `/api/be/site-property-templates/${template.id}/definitions/${id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
        ),
      ),
    )
    router.refresh()
  }

  const groupNamesForDatalist = useMemo(() => {
    const set = new Set<string>()
    for (const g of template.group_order) set.add(g)
    for (const d of template.definitions) if (d.group) set.add(d.group)
    return [...set].sort()
  }, [template.definitions, template.group_order])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <Link
            href={w("/admin/site-properties")}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3" />
            All templates
          </Link>
          <TemplateMetaEditor
            name={template.name}
            description={template.description}
            onSave={patchTemplate}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => void deleteTemplate()}
        >
          <Trash2 className="size-3.5" />
          Delete template
        </Button>
      </div>

      <datalist id="tpl-group-suggestions">
        {groupNamesForDatalist.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Sections</h2>
          <p className="text-xs text-muted-foreground">
            Drag sections to reorder. Drag fields between sections to
            regroup. Section headers rename inline.
          </p>
        </div>
        <Button size="sm" onClick={() => void addSection()}>
          <Plus className="size-3.5" />
          Add section
        </Button>
      </div>

      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <SectionBlock
            key={section.name ?? UNGROUPED}
            section={section}
            template={template}
            drafts={drafts}
            drag={drag}
            fieldDropTarget={fieldDropTarget}
            sectionDropTarget={sectionDropTarget}
            setDrag={setDrag}
            setFieldDropTarget={setFieldDropTarget}
            setSectionDropTarget={setSectionDropTarget}
            onSectionRename={renameGroup}
            onSectionMove={moveSection}
            onSectionDelete={renameGroup}
            onAddField={addDraft}
            onUpdateDraft={updateDraft}
            onSaveDraft={saveDraft}
            onDiscardDraft={discardDraft}
            onPatchDefinition={patchDefinition}
            onDeleteDefinition={deleteDefinition}
            onFieldDrop={commitFieldDrop}
          />
        ))}
        {sections.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
            No sections yet. Click "Add section" to start.
          </div>
        )}
      </div>
    </div>
  )
}

function SectionBlock({
  section,
  template,
  drafts,
  drag,
  fieldDropTarget,
  sectionDropTarget,
  setDrag,
  setFieldDropTarget,
  setSectionDropTarget,
  onSectionRename,
  onSectionMove,
  onSectionDelete,
  onAddField,
  onUpdateDraft,
  onSaveDraft,
  onDiscardDraft,
  onPatchDefinition,
  onDeleteDefinition,
  onFieldDrop,
}: {
  section: Section
  template: SitePropertyTemplate
  drafts: DraftRow[]
  drag: DragState
  fieldDropTarget: number | "end" | null
  sectionDropTarget: string | null
  setDrag: (d: DragState) => void
  setFieldDropTarget: (t: number | "end" | null) => void
  setSectionDropTarget: (t: string | null) => void
  onSectionRename: (old: string, next: string) => void
  onSectionMove: (name: string, targetName: string) => void
  onSectionDelete: (name: string, next: null) => void
  onAddField: (group: string | null) => void
  onUpdateDraft: (id: string, patch: Partial<DraftRow>) => void
  onSaveDraft: (id: string) => void
  onDiscardDraft: (id: string) => void
  onPatchDefinition: (
    id: number,
    patch: Partial<
      SitePropertyDefinition & {
        group: string | null
        description: string | null
      }
    >,
  ) => void
  onDeleteDefinition: (d: SitePropertyDefinition) => void
  onFieldDrop: (
    fromId: number,
    target:
      | { kind: "field"; id: number }
      | { kind: "section-end"; group: string | null },
  ) => void
}) {
  const isNamed = section.name !== null
  const sectionKey = section.name ?? UNGROUPED
  const sectionDrafts = drafts.filter((d) => (d.group ?? null) === section.name)
  const isBeingDragged =
    drag?.kind === "section" && isNamed && drag.name === section.name
  const isSectionDropTarget =
    isNamed && sectionDropTarget === section.name && !isBeingDragged

  return (
    <section
      className={cn(
        "rounded-lg border",
        isBeingDragged && "opacity-40",
        isSectionDropTarget && "ring-2 ring-primary",
      )}
      onDragOver={(e) => {
        if (drag?.kind === "section" && isNamed && drag.name !== section.name) {
          e.preventDefault()
          e.dataTransfer.dropEffect = "move"
          if (sectionDropTarget !== section.name)
            setSectionDropTarget(section.name)
        }
      }}
      onDrop={(e) => {
        if (drag?.kind === "section" && isNamed && section.name) {
          e.preventDefault()
          onSectionMove(drag.name, section.name)
          setDrag(null)
          setSectionDropTarget(null)
        }
      }}
    >
      <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        {isNamed ? (
          <div
            draggable
            onDragStart={(e) => {
              setDrag({ kind: "section", name: section.name! })
              e.dataTransfer.effectAllowed = "move"
              e.dataTransfer.setData("text/plain", section.name!)
            }}
            onDragEnd={() => {
              setDrag(null)
              setSectionDropTarget(null)
            }}
            className="cursor-grab text-muted-foreground"
            title="Drag to reorder section"
          >
            <GripVertical className="size-4" />
          </div>
        ) : (
          <div className="size-4" />
        )}
        {isNamed ? (
          <BlurInput
            value={section.name!}
            className="h-8 flex-1 font-semibold"
            onCommit={(v) => {
              const next = v.trim()
              if (next && next !== section.name) onSectionRename(section.name!, next)
            }}
          />
        ) : (
          <div className="flex-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Ungrouped
          </div>
        )}
        <Button size="sm" variant="ghost" onClick={() => onAddField(section.name)}>
          <Plus className="size-3.5" />
          Add field
        </Button>
        {isNamed && (
          <Button
            size="sm"
            variant="ghost"
            title="Delete section (fields become ungrouped)"
            onClick={() => {
              if (
                confirm(
                  `Delete section "${section.name}"? Its fields become ungrouped.`,
                )
              )
                onSectionDelete(section.name!, null)
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </header>

      {section.definitions.length === 0 && sectionDrafts.length === 0 ? (
        <div
          onDragOver={(e) => {
            if (drag?.kind === "field") {
              e.preventDefault()
              e.dataTransfer.dropEffect = "move"
              // Signal "end of this section" via key.
              if (fieldDropTarget !== "end") setFieldDropTarget("end")
            }
          }}
          onDrop={(e) => {
            if (drag?.kind === "field") {
              e.preventDefault()
              onFieldDrop(drag.id, {
                kind: "section-end",
                group: section.name,
              })
              setDrag(null)
              setFieldDropTarget(null)
            }
          }}
          className={cn(
            "border-dashed p-6 text-center text-xs text-muted-foreground",
            fieldDropTarget === "end" &&
              drag?.kind === "field" &&
              "bg-accent/40",
          )}
        >
          No fields in this section. Drop a field here or click "Add field".
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2"></th>
                <th className="px-2 py-2 text-left">Label</th>
                <th className="px-2 py-2 text-left">Key</th>
                <th className="px-2 py-2 text-left">Type</th>
                <th className="px-2 py-2 text-left">Required</th>
                <th className="px-2 py-2 text-left">Description</th>
                <th className="w-16 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {section.definitions.map((d) => (
                <FieldRow
                  key={d.id}
                  definition={d}
                  templateId={template.id}
                  drag={drag}
                  fieldDropTarget={fieldDropTarget}
                  setDrag={setDrag}
                  setFieldDropTarget={setFieldDropTarget}
                  onPatchDefinition={onPatchDefinition}
                  onDeleteDefinition={onDeleteDefinition}
                  onFieldDrop={onFieldDrop}
                />
              ))}
              {sectionDrafts.map((d) => (
                <DraftRowView
                  key={d.clientId}
                  draft={d}
                  onUpdate={(patch) => onUpdateDraft(d.clientId, patch)}
                  onSave={() => onSaveDraft(d.clientId)}
                  onDiscard={() => onDiscardDraft(d.clientId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function FieldRow({
  definition: d,
  drag,
  fieldDropTarget,
  setDrag,
  setFieldDropTarget,
  onPatchDefinition,
  onDeleteDefinition,
  onFieldDrop,
}: {
  definition: SitePropertyDefinition
  templateId: number
  drag: DragState
  fieldDropTarget: number | "end" | null
  setDrag: (d: DragState) => void
  setFieldDropTarget: (t: number | "end" | null) => void
  onPatchDefinition: (
    id: number,
    patch: Partial<
      SitePropertyDefinition & {
        group: string | null
        description: string | null
      }
    >,
  ) => void
  onDeleteDefinition: (d: SitePropertyDefinition) => void
  onFieldDrop: (
    fromId: number,
    target:
      | { kind: "field"; id: number }
      | { kind: "section-end"; group: string | null },
  ) => void
}) {
  const isDragging = drag?.kind === "field" && drag.id === d.id
  const isDropTarget =
    drag?.kind === "field" && fieldDropTarget === d.id && drag.id !== d.id
  return (
    <tr
      onDragOver={(e) => {
        if (drag?.kind === "field") {
          e.preventDefault()
          e.dataTransfer.dropEffect = "move"
          if (fieldDropTarget !== d.id) setFieldDropTarget(d.id)
        }
      }}
      onDrop={(e) => {
        if (drag?.kind === "field") {
          e.preventDefault()
          onFieldDrop(drag.id, { kind: "field", id: d.id })
          setDrag(null)
          setFieldDropTarget(null)
        }
      }}
      className={cn(
        "border-t border-border align-top",
        isDragging && "opacity-40",
        isDropTarget && "bg-accent/40",
      )}
    >
      <td
        draggable
        onDragStart={(e) => {
          setDrag({ kind: "field", id: d.id })
          e.dataTransfer.effectAllowed = "move"
          e.dataTransfer.setData("text/plain", String(d.id))
        }}
        onDragEnd={() => {
          setDrag(null)
          setFieldDropTarget(null)
        }}
        className="cursor-grab px-2 py-2 text-muted-foreground"
        title="Drag to reorder or move to another section"
      >
        <GripVertical className="size-4" />
      </td>
      <td className="px-2 py-2">
        <BlurInput
          value={d.label}
          onCommit={(v) =>
            v !== d.label && onPatchDefinition(d.id, { label: v })
          }
        />
      </td>
      <td className="px-2 py-2">
        <BlurInput
          value={d.key}
          normalize={slugify}
          onCommit={(v) => v !== d.key && onPatchDefinition(d.id, { key: v })}
          className="font-mono text-xs"
        />
      </td>
      <td className="px-2 py-2">
        <select
          value={d.type}
          onChange={(e) =>
            onPatchDefinition(d.id, { type: e.target.value as SitePropertyType })
          }
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <input
          type="checkbox"
          checked={d.required}
          onChange={(e) =>
            onPatchDefinition(d.id, { required: e.target.checked })
          }
        />
      </td>
      <td className="px-2 py-2">
        <BlurInput
          value={d.description ?? ""}
          onCommit={(v) =>
            (v || null) !== d.description &&
            onPatchDefinition(d.id, { description: v || null })
          }
        />
      </td>
      <td className="px-2 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDeleteDefinition(d)}
          title="Delete field"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </td>
    </tr>
  )
}

function DraftRowView({
  draft,
  onUpdate,
  onSave,
  onDiscard,
}: {
  draft: DraftRow
  onUpdate: (patch: Partial<DraftRow>) => void
  onSave: () => void
  onDiscard: () => void
}) {
  const canSave = draft.label.trim().length > 0 && draft.key.trim().length > 0
  return (
    <tr className="border-t border-border bg-accent/10 align-top">
      <td className="px-2 py-2 text-muted-foreground">
        <Plus className="size-4" />
      </td>
      <td className="px-2 py-2">
        <Input
          value={draft.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Label"
          className="h-8"
        />
      </td>
      <td className="px-2 py-2">
        <Input
          value={draft.key}
          onChange={(e) => onUpdate({ key: slugify(e.target.value) })}
          placeholder="key"
          className="h-8 font-mono text-xs"
        />
      </td>
      <td className="px-2 py-2">
        <select
          value={draft.type}
          onChange={(e) =>
            onUpdate({ type: e.target.value as SitePropertyType })
          }
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <input
          type="checkbox"
          checked={draft.required}
          onChange={(e) => onUpdate({ required: e.target.checked })}
        />
      </td>
      <td className="px-2 py-2">
        <Input
          value={draft.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="Optional"
          className="h-8"
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!canSave}
            onClick={onSave}
            title="Save field"
          >
            <Check className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDiscard} title="Discard">
            <X className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function TemplateMetaEditor({
  name,
  description,
  onSave,
}: {
  name: string
  description: string | null
  onSave: (
    patch: Partial<{ name: string; description: string | null }>,
  ) => void | Promise<void>
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="space-y-1">
        <Label
          htmlFor="tpl-name"
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          Name
        </Label>
        <BlurInput
          id="tpl-name"
          value={name}
          className="h-9 text-base font-semibold"
          onCommit={(v) => v !== name && v.length > 0 && void onSave({ name: v })}
        />
      </div>
      <div className="space-y-1">
        <Label
          htmlFor="tpl-desc"
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          Description
        </Label>
        <BlurTextarea
          id="tpl-desc"
          value={description ?? ""}
          onCommit={(v) =>
            (v || null) !== description &&
            void onSave({ description: v || null })
          }
        />
      </div>
    </div>
  )
}

/** <input> that only fires onCommit when the user blurs or hits Enter,
 *  so we don't PATCH per keystroke. */
function BlurInput({
  value,
  onCommit,
  normalize,
  className,
  ...rest
}: {
  value: string
  onCommit: (v: string) => void
  normalize?: (v: string) => string
  className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [local, setLocal] = useState(value)
  // Re-sync when server value changes (e.g. reorder repaints).
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    setLocal(value)
  }
  function commit() {
    const v = normalize ? normalize(local) : local
    if (v !== local) setLocal(v)
    onCommit(v)
  }
  return (
    <input
      {...rest}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      className={cn(
        "h-8 w-full rounded-md border border-input bg-background px-2 text-sm",
        className,
      )}
    />
  )
}

function BlurTextarea({
  value,
  onCommit,
  id,
}: {
  value: string
  onCommit: (v: string) => void
  id?: string
}) {
  const [local, setLocal] = useState(value)
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    setLocal(value)
  }
  return (
    <Textarea
      id={id}
      value={local}
      rows={2}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local)}
    />
  )
}
