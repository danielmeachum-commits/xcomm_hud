"use client"

import { useMemo, useState } from "react"
import { Check, Plus, Trash2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SEVERITY_LABELS } from "@/lib/severity"
import { groupByCategory } from "@/lib/event-type-meta"
import { cn } from "@/lib/utils"
import type {
  EventTypeDef,
  RecordClass,
  Rule,
  RuleComputedField,
  RuleFieldMeta,
  RulesMeta,
  Severity,
} from "@/lib/types"
import { SEVERITIES } from "@/lib/types"

const STEPS = [
  { key: "trigger", label: "Trigger" },
  { key: "enrich", label: "Enrich" },
  { key: "conditions", label: "Conditions" },
  { key: "action", label: "Action" },
  { key: "review", label: "Review" },
] as const

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

// --- Condition rows <-> jsonlogic tree ---

type CondOp = "is" | "is_not" | "one_of" | "contains" | "gt" | "lt"

interface CondRow {
  field: string
  op: CondOp
  value: string
}

const OP_LABELS: Record<CondOp, string> = {
  is: "is",
  is_not: "is not",
  one_of: "is one of",
  contains: "contains",
  gt: "is greater than",
  lt: "is less than",
}

// --- Computed value builder modes ---
//
// Formulas cluster into a few shapes, each with a visual editor; raw JSON
// stays as the escape hatch. Stored exprs are shape-detected on edit so a
// builder-made formula reopens in its builder.

type ComputedMode = "template" | "rank" | "compare" | "lookup" | "json"

type CmpOp = ">" | ">=" | "<" | "<=" | "==" | "!="

interface LookupCase {
  when: string
  then: string
}

interface ComputedRow {
  name: string
  mode: ComputedMode
  /** Template text, or raw JSON in json mode. */
  value: string
  rankField: string
  rankOrder: string
  cmpA: string
  cmpOp: CmpOp
  cmpB: string
  cmpBCustom: string
  cmpThen: string
  cmpElse: string
  lookupField: string
  lookupCases: LookupCase[]
  lookupDefault: string
}

const CUSTOM_OPERAND = "__custom"

/** Severity-select sentinel: read severity from a payload/computed field. */
const FROM_FIELD = "__from_field"

function emptyComputedRow(): ComputedRow {
  return {
    name: "",
    mode: "template",
    value: "",
    rankField: "",
    rankOrder: "",
    cmpA: "",
    cmpOp: ">",
    cmpB: CUSTOM_OPERAND,
    cmpBCustom: "",
    cmpThen: "yes",
    cmpElse: "no",
    lookupField: "",
    lookupCases: [{ when: "", then: "" }],
    lookupDefault: "",
  }
}

function encodeComputedRow(row: ComputedRow): RuleComputedField | string {
  const base = emptyComputedRow()
  switch (row.mode) {
    case "template":
      return { name: row.name, kind: "template", template: row.value }
    case "rank": {
      const order = row.rankOrder.split(",").map((s) => s.trim()).filter(Boolean)
      if (!row.rankField || order.length === 0)
        return `“${row.name}”: pick a field and an ordered list.`
      return {
        name: row.name,
        kind: "expr",
        expr: { rank: [{ var: row.rankField }, order] },
      }
    }
    case "compare": {
      if (!row.cmpA) return `“${row.name}”: pick the left-hand field.`
      const b =
        row.cmpB === CUSTOM_OPERAND ? coerce(row.cmpBCustom) : { var: row.cmpB }
      return {
        name: row.name,
        kind: "expr",
        expr: {
          if: [
            { [row.cmpOp]: [{ var: row.cmpA }, b] },
            coerce(row.cmpThen),
            coerce(row.cmpElse),
          ],
        },
      }
    }
    case "lookup": {
      const cases = row.lookupCases.filter((c) => c.when !== "")
      if (!row.lookupField || cases.length === 0)
        return `“${row.name}”: pick a field and add at least one case.`
      let expr: unknown = coerce(row.lookupDefault)
      for (const c of [...cases].reverse()) {
        expr = {
          if: [
            { "==": [{ var: row.lookupField }, coerce(c.when)] },
            coerce(c.then),
            expr,
          ],
        }
      }
      return { name: row.name, kind: "expr", expr }
    }
    case "json":
      try {
        return { name: row.name, kind: "expr", expr: JSON.parse(row.value) }
      } catch {
        return `Formula for “${row.name}” isn't valid JSON.`
      }
    default:
      return `“${row.name ?? base.name}”: unknown mode.`
  }
}

function varKey(x: unknown): string | null {
  if (typeof x === "object" && x !== null && "var" in (x as object)) {
    return String((x as { var: unknown }).var)
  }
  return null
}

/** Detect a stored expr's builder shape; json mode when nothing matches. */
function decodeComputedField(c: RuleComputedField): ComputedRow {
  const row = { ...emptyComputedRow(), name: c.name }
  if (c.kind === "template") {
    return { ...row, mode: "template", value: String(c.template ?? "") }
  }
  const expr = c.expr
  const asJson = (): ComputedRow => ({
    ...row,
    mode: "json",
    value: JSON.stringify(expr ?? null, null, 0),
  })
  if (typeof expr !== "object" || expr === null) return asJson()
  const obj = expr as Record<string, unknown>

  // rank: {"rank": [{"var": f}, [scalars]]}
  if (Array.isArray(obj.rank) && obj.rank.length === 2) {
    const field = varKey(obj.rank[0])
    if (field && Array.isArray(obj.rank[1])) {
      return {
        ...row,
        mode: "rank",
        rankField: field,
        rankOrder: (obj.rank[1] as unknown[]).map(String).join(", "),
      }
    }
  }

  if (Array.isArray(obj.if) && obj.if.length === 3) {
    const [cond, then, other] = obj.if as [unknown, unknown, unknown]
    const scalar = (v: unknown) =>
      typeof v === "string" || typeof v === "number" || typeof v === "boolean"
    // compare: {"if": [{op: [{"var": a}, b]}, then, else]}
    if (scalar(then) && scalar(other) && typeof cond === "object" && cond !== null) {
      const entries = Object.entries(cond as Record<string, unknown>)
      if (entries.length === 1) {
        const [op, args] = entries[0]
        if (
          [">", ">=", "<", "<=", "==", "!="].includes(op) &&
          Array.isArray(args) &&
          args.length === 2
        ) {
          const a = varKey(args[0])
          const bVar = varKey(args[1])
          if (a && (bVar || scalar(args[1]))) {
            // A single ==-on-one-field if could be a 1-case lookup, but
            // compare is the friendlier editor for it.
            return {
              ...row,
              mode: "compare",
              cmpA: a,
              cmpOp: op as CmpOp,
              cmpB: bVar ?? CUSTOM_OPERAND,
              cmpBCustom: bVar ? "" : String(args[1]),
              cmpThen: String(then),
              cmpElse: String(other),
            }
          }
        }
      }
    }
    // lookup: nested ifs, every cond {"==": [{"var": sameField}, scalar]}
    const cases: LookupCase[] = []
    let field: string | null = null
    let cursor: unknown = expr
    while (
      typeof cursor === "object" &&
      cursor !== null &&
      Array.isArray((cursor as Record<string, unknown>).if)
    ) {
      const [c0, t0, e0] = (cursor as { if: unknown[] }).if
      if (typeof c0 !== "object" || c0 === null) return asJson()
      const eq = (c0 as Record<string, unknown>)["=="]
      if (!Array.isArray(eq) || eq.length !== 2) return asJson()
      const f = varKey(eq[0])
      if (!f || (field !== null && f !== field) || !scalar(eq[1]) || !scalar(t0))
        return asJson()
      field = f
      cases.push({ when: String(eq[1]), then: String(t0) })
      cursor = e0
    }
    if (field && cases.length > 0 && (cursor == null || scalar(cursor))) {
      return {
        ...row,
        mode: "lookup",
        lookupField: field,
        lookupCases: cases,
        lookupDefault: cursor == null ? "" : String(cursor),
      }
    }
  }
  return asJson()
}

function toComputedRows(computed: RuleComputedField[] | undefined): ComputedRow[] {
  return (computed ?? []).map(decodeComputedField)
}

function sanitizeComputedName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, 48)
}

/** Draggable/clickable field tokens. Dragging uses native text/plain DnD —
 *  browsers insert the dropped text into a textarea at the drop caret —
 *  and clicking appends, as the keyboard-friendly path. */
function FieldChips({
  fields,
  makeToken,
  onInsert,
}: {
  fields: RuleFieldMeta[]
  makeToken: (key: string) => string
  onInsert: (token: string) => void
}) {
  if (fields.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {fields.map((f) => (
        <button
          key={f.key}
          type="button"
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/plain", makeToken(f.key))}
          onClick={() => onInsert(makeToken(f.key))}
          title={`${f.label} — drag into the field, or click to append`}
          className="cursor-grab rounded-full border border-input bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          {`{${f.key}}`}
        </button>
      ))}
    </div>
  )
}

const FORMULA_OPS: { sig: string; desc: string }[] = [
  { sig: '{"var": "field"}', desc: "a field's value" },
  { sig: '{"if": [cond, then, else]}', desc: "branch on a condition" },
  { sig: '{"cat": [a, b, …]}', desc: "join as text" },
  { sig: '{"coalesce": [a, b, …]}', desc: "first non-empty value" },
  { sig: '{"+": [a, b]}', desc: "arithmetic — also -, *, /" },
  { sig: '{"upper": x} · {"lower": x}', desc: "text casing" },
  { sig: '{"round": [x, digits]}', desc: "round a number" },
  { sig: '{"rank": [x, ["low", "mid", "high"]]}', desc: "position in an ordered scale" },
  { sig: '"==", "!=", "in", "contains", ">", "<"', desc: "conditions, usable inside if" },
]

/** Always-visible operations reference for formula mode — placeholders
 *  vanish on the first keystroke, this doesn't. */
function FormulaReference() {
  return (
    <div className="rounded-md bg-muted/30 px-2.5 py-2">
      <p className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Operations
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {FORMULA_OPS.map((op) => (
          <div key={op.sig} className="contents">
            <dt className="font-mono text-[10px] text-foreground/80">{op.sig}</dt>
            <dd className="text-[10px] text-muted-foreground">{op.desc}</dd>
          </div>
        ))}
      </dl>
      <p className="pt-1.5 font-mono text-[10px] text-muted-foreground">
        e.g. {'{"if": [{"in": [{"var": "new_status"}, ["down", "offline"]]}, "OUTAGE", "OK"]}'}
      </p>
    </div>
  )
}

const COMPUTED_MODE_LABELS: Record<ComputedMode, string> = {
  template: "Text template",
  rank: "Rank in a scale",
  compare: "Compare two values",
  lookup: "Map values",
  json: "Formula (JSON)",
}

const COMPUTED_MODE_HINTS: Record<ComputedMode, string> = {
  template: "Build text with {field} placeholders.",
  rank: "The value's position (0, 1, 2, …) in an ordered list — great for severity scales like FPCON.",
  compare: "Compare two values and produce one result or the other.",
  lookup: "Translate specific values into results, with a fallback.",
  json: "Raw expression tree for anything the builders can't express.",
}

function ComputedRowEditor({
  row,
  fields,
  onChange,
  onRemove,
}: {
  row: ComputedRow
  fields: RuleFieldMeta[]
  onChange: (row: ComputedRow) => void
  onRemove: () => void
}) {
  const fieldSelect = (
    value: string,
    set: (v: string) => void,
    extra?: { label: string; value: string },
  ) => (
    <select
      value={value}
      onChange={(e) => set(e.target.value)}
      className={cn(selectClass, "w-44 flex-none")}
    >
      <option value="">Field…</option>
      {fields.map((f) => (
        <option key={f.key} value={f.key}>
          {f.label}
        </option>
      ))}
      {extra && <option value={extra.value}>{extra.label}</option>}
    </select>
  )

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-input p-2.5">
      <div className="flex items-center gap-2">
        <Input
          value={row.name}
          onChange={(e) =>
            onChange({ ...row, name: sanitizeComputedName(e.target.value) })
          }
          placeholder="field_name"
          className="w-44 flex-none font-mono text-xs"
        />
        <select
          value={row.mode}
          onChange={(e) => onChange({ ...row, mode: e.target.value as ComputedMode })}
          className={cn(selectClass, "w-44 flex-none")}
        >
          {(Object.keys(COMPUTED_MODE_LABELS) as ComputedMode[]).map((m) => (
            <option key={m} value={m}>
              {COMPUTED_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
          aria-label="Remove computed value"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {COMPUTED_MODE_HINTS[row.mode]}
      </p>

      {(row.mode === "template" || row.mode === "json") && (
        <>
          <Textarea
            value={row.value}
            onChange={(e) => onChange({ ...row, value: e.target.value })}
            placeholder={
              row.mode === "template"
                ? "e.g. {service_name} at {site_name}"
                : '{"if": [{"in": [{"var": "new_status"}, ["down", "offline"]]}, "OUTAGE", "OK"]}'
            }
            className="min-h-12 font-mono text-xs"
          />
          <FieldChips
            fields={fields}
            makeToken={(key) =>
              row.mode === "template" ? `{${key}}` : `{"var": "${key}"}`
            }
            onInsert={(token) => onChange({ ...row, value: row.value + token })}
          />
          {row.mode === "json" && <FormulaReference />}
        </>
      )}

      {row.mode === "rank" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {fieldSelect(row.rankField, (v) => onChange({ ...row, rankField: v }))}
            <span className="text-xs text-muted-foreground">position in</span>
            <Input
              value={row.rankOrder}
              onChange={(e) => onChange({ ...row, rankOrder: e.target.value })}
              placeholder="normal, alpha, bravo, charlie, delta"
              className="font-mono text-xs"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Ordered lowest → highest, comma-separated. Result is 0-based; a
            value not in the list yields nothing (comparisons won't match).
          </p>
        </div>
      )}

      {row.mode === "compare" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {fieldSelect(row.cmpA, (v) => onChange({ ...row, cmpA: v }))}
            <select
              value={row.cmpOp}
              onChange={(e) => onChange({ ...row, cmpOp: e.target.value as CmpOp })}
              className={cn(selectClass, "w-16 flex-none")}
            >
              {[">", ">=", "<", "<=", "==", "!="].map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            {fieldSelect(row.cmpB, (v) => onChange({ ...row, cmpB: v }), {
              label: "Custom value…",
              value: CUSTOM_OPERAND,
            })}
            {row.cmpB === CUSTOM_OPERAND && (
              <Input
                value={row.cmpBCustom}
                onChange={(e) => onChange({ ...row, cmpBCustom: e.target.value })}
                placeholder="value"
                className="w-28 flex-none font-mono text-xs"
              />
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            if true →
            <Input
              value={row.cmpThen}
              onChange={(e) => onChange({ ...row, cmpThen: e.target.value })}
              className="w-28 flex-none font-mono text-xs"
            />
            otherwise →
            <Input
              value={row.cmpElse}
              onChange={(e) => onChange({ ...row, cmpElse: e.target.value })}
              className="w-28 flex-none font-mono text-xs"
            />
          </div>
        </div>
      )}

      {row.mode === "lookup" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">When</span>
            {fieldSelect(row.lookupField, (v) => onChange({ ...row, lookupField: v }))}
            <span className="text-xs text-muted-foreground">is…</span>
          </div>
          {row.lookupCases.map((c, i) => (
            <div key={i} className="flex items-center gap-2 pl-4">
              <Input
                value={c.when}
                onChange={(e) =>
                  onChange({
                    ...row,
                    lookupCases: row.lookupCases.map((x, j) =>
                      j === i ? { ...x, when: e.target.value } : x,
                    ),
                  })
                }
                placeholder="value"
                className="w-36 flex-none font-mono text-xs"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                value={c.then}
                onChange={(e) =>
                  onChange({
                    ...row,
                    lookupCases: row.lookupCases.map((x, j) =>
                      j === i ? { ...x, then: e.target.value } : x,
                    ),
                  })
                }
                placeholder="result"
                className="w-36 flex-none font-mono text-xs"
              />
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...row,
                    lookupCases: row.lookupCases.filter((_, j) => j !== i),
                  })
                }
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                aria-label="Remove case"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pl-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  ...row,
                  lookupCases: [...row.lookupCases, { when: "", then: "" }],
                })
              }
              className="h-7 gap-1 px-2 text-xs"
            >
              <Plus className="size-3" />
              Case
            </Button>
            <span className="text-xs text-muted-foreground">anything else →</span>
            <Input
              value={row.lookupDefault}
              onChange={(e) => onChange({ ...row, lookupDefault: e.target.value })}
              placeholder="default"
              className="w-36 flex-none font-mono text-xs"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function coerce(v: string): string | number {
  const n = Number(v)
  return v.trim() !== "" && !Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(v.trim())
    ? n
    : v
}

function encodeRow(row: CondRow): unknown {
  const field = { var: row.field }
  switch (row.op) {
    case "is":
      return { "==": [field, coerce(row.value)] }
    case "is_not":
      return { "!=": [field, coerce(row.value)] }
    case "one_of":
      return { in: [field, row.value.split(",").map((s) => s.trim()).filter(Boolean)] }
    case "contains":
      return { contains: [field, row.value] }
    case "gt":
      return { ">": [field, coerce(row.value)] }
    case "lt":
      return { "<": [field, coerce(row.value)] }
  }
}

function encodeConditions(rows: CondRow[], mode: "all" | "any"): unknown {
  const clauses = rows.filter((r) => r.field).map(encodeRow)
  if (clauses.length === 0) return null
  if (clauses.length === 1) return clauses[0]
  return mode === "all" ? { and: clauses } : { or: clauses }
}

function decodeRow(clause: unknown): CondRow | null {
  if (typeof clause !== "object" || clause === null) return null
  const entries = Object.entries(clause as Record<string, unknown>)
  if (entries.length !== 1) return null
  const [op, args] = entries[0]
  if (!Array.isArray(args) || args.length !== 2) return null
  const [a, b] = args
  const field =
    typeof a === "object" && a !== null && "var" in (a as object)
      ? String((a as { var: unknown }).var)
      : null
  if (!field) return null
  switch (op) {
    case "==":
      return { field, op: "is", value: String(b) }
    case "!=":
      return { field, op: "is_not", value: String(b) }
    case "in":
      return Array.isArray(b)
        ? { field, op: "one_of", value: b.map(String).join(", ") }
        : null
    case "contains":
      return { field, op: "contains", value: String(b) }
    case ">":
      return { field, op: "gt", value: String(b) }
    case "<":
      return { field, op: "lt", value: String(b) }
    default:
      return null
  }
}

/** Decode a stored condition tree into editable rows; null when the tree
 *  was hand-authored in a shape the row editor can't represent. */
function decodeConditions(
  cond: unknown,
): { rows: CondRow[]; mode: "all" | "any" } | null {
  if (cond == null || (typeof cond === "object" && Object.keys(cond as object).length === 0)) {
    return { rows: [], mode: "all" }
  }
  if (typeof cond !== "object") return null
  const obj = cond as Record<string, unknown>
  const clauses = Array.isArray(obj.and)
    ? { list: obj.and, mode: "all" as const }
    : Array.isArray(obj.or)
      ? { list: obj.or, mode: "any" as const }
      : { list: [cond], mode: "all" as const }
  const rows: CondRow[] = []
  for (const clause of clauses.list) {
    const row = decodeRow(clause)
    if (row === null) return null
    rows.push(row)
  }
  return { rows, mode: clauses.mode }
}

// --- The wizard ---

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  meta: RulesMeta
  eventTypes: EventTypeDef[]
  /** Rule being edited, or null for create. */
  rule: Rule | null
  /** Treat `rule` as a template: prefill everything except name/description
   *  and save as a new rule instead of patching. */
  duplicate?: boolean
  onSaved: (rule: Rule) => void
}

export function RuleWizard({
  open,
  onOpenChange,
  meta,
  eventTypes,
  rule,
  duplicate = false,
  onSaved,
}: Props) {
  const editing = rule !== null && !duplicate
  const prefilled = rule !== null
  const decoded = useMemo(
    () => (rule ? decodeConditions(rule.conditions) : { rows: [], mode: "all" as const }),
    [rule],
  )
  const createParams = rule?.actions?.[0]?.params ?? {}

  const [step, setStep] = useState(0)
  const [maxVisited, setMaxVisited] = useState(prefilled ? STEPS.length - 1 : 0)
  const [trigger, setTrigger] = useState<string>(rule?.trigger ?? "")
  const [enrichers, setEnrichers] = useState<Set<string>>(
    () => new Set(rule?.enrichers ?? []),
  )
  const [computedRows, setComputedRows] = useState<ComputedRow[]>(() =>
    toComputedRows(rule?.computed),
  )
  const [condRows, setCondRows] = useState<CondRow[]>(decoded?.rows ?? [])
  const [condMode, setCondMode] = useState<"all" | "any">(decoded?.mode ?? "all")
  // Hand-authored condition trees the row editor can't represent are edited
  // as raw JSON instead of being silently mangled.
  const [rawCond, setRawCond] = useState<string>(
    decoded === null ? JSON.stringify(rule?.conditions, null, 2) : "",
  )
  const rawMode = decoded === null

  const [typeSlug, setTypeSlug] = useState<string>(
    String(createParams.type_slug ?? "note.general"),
  )
  const [recordClass, setRecordClass] = useState<
    RecordClass | "" | typeof FROM_FIELD
  >(
    createParams.record_class_from
      ? FROM_FIELD
      : ((createParams.record_class as RecordClass) ?? ""),
  )
  const [recordClassFrom, setRecordClassFrom] = useState<string>(
    String(createParams.record_class_from ?? ""),
  )
  const [severity, setSeverity] = useState<Severity | "" | typeof FROM_FIELD>(
    createParams.severity_from
      ? FROM_FIELD
      : ((createParams.severity as Severity) ?? ""),
  )
  const [severityFrom, setSeverityFrom] = useState<string>(
    String(createParams.severity_from ?? ""),
  )
  const [noteTemplate, setNoteTemplate] = useState<string>(
    String(createParams.note_template ?? ""),
  )
  const [name, setName] = useState(duplicate ? "" : rule?.name ?? "")
  const [description, setDescription] = useState(
    duplicate ? "" : rule?.description ?? "",
  )
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [testSample, setTestSample] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<{
    computed_values: Record<string, unknown>
    matched: boolean
  } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [testPending, setTestPending] = useState(false)

  const triggerMeta = useMemo(
    () => meta.triggers.find((t) => t.key === trigger) ?? null,
    [meta, trigger],
  )
  const availableEnrichers = useMemo(
    () =>
      meta.enrichers.filter((e) => triggerMeta?.enrichers.includes(e.key)),
    [meta, triggerMeta],
  )
  /** Fields conditions and note templates can reference: trigger payload +
   *  every selected enricher's additions + this rule's computed values. */
  const fields = useMemo<RuleFieldMeta[]>(() => {
    const out = [...(triggerMeta?.fields ?? [])]
    const seen = new Set(out.map((f) => f.key))
    for (const e of availableEnrichers) {
      if (!enrichers.has(e.key)) continue
      for (const f of e.fields) {
        if (!seen.has(f.key)) {
          out.push(f)
          seen.add(f.key)
        }
      }
    }
    for (const c of computedRows) {
      if (c.name && !seen.has(c.name)) {
        out.push({ key: c.name, label: `${c.name} (computed)`, type: "string" })
        seen.add(c.name)
      }
    }
    return out
  }, [triggerMeta, availableEnrichers, enrichers, computedRows])

  const typeGroups = useMemo(
    () => groupByCategory(eventTypes.filter((t) => !t.retired_at)),
    [eventTypes],
  )
  const selectedType = eventTypes.find((t) => t.slug === typeSlug)

  function goTo(i: number) {
    setStep(i)
    setMaxVisited((m) => Math.max(m, i))
    setError(null)
  }

  function next() {
    if (step === 0 && !trigger) {
      setError("Pick a trigger.")
      return
    }
    if (step === STEPS.length - 1) return
    goTo(step + 1)
  }

  function summarySentence(): string {
    const t = triggerMeta?.label ?? trigger
    const n = rawMode ? "custom conditions" : condRows.filter((r) => r.field).length
    const condPart = rawMode
      ? " if custom conditions match"
      : typeof n === "number" && n > 0
        ? ` if ${n} condition${n === 1 ? "" : "s"} ${condMode === "all" ? "all match" : "any match"}`
        : ""
    const tLower = t.charAt(0).toLowerCase() + t.slice(1)
    if (severity === FROM_FIELD) {
      return `When ${tLower}${condPart}, create a “${selectedType?.label ?? typeSlug}” record with severity from {${severityFrom || "?"}}.`
    }
    const sev = severity || selectedType?.default_severity || "notice"
    return `When ${tLower}${condPart}, create a ${SEVERITY_LABELS[sev as Severity].toLowerCase()} “${selectedType?.label ?? typeSlug}” record.`
  }

  /** Encode all computed rows, or return the first validation error. */
  function buildComputed(): RuleComputedField[] | string {
    const out: RuleComputedField[] = []
    for (const row of computedRows) {
      if (!row.name) continue
      const encoded = encodeComputedRow(row)
      if (typeof encoded === "string") return encoded
      out.push(encoded)
    }
    return out
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Give the rule a name.")
      return
    }
    let conditions: unknown = null
    if (rawMode) {
      try {
        conditions = rawCond.trim() ? JSON.parse(rawCond) : null
      } catch {
        setError("Conditions JSON doesn't parse.")
        return
      }
    } else {
      conditions = encodeConditions(condRows, condMode)
    }
    const built = buildComputed()
    if (typeof built === "string") {
      setError(built)
      return
    }
    const computed = built

    const params: Record<string, unknown> = { type_slug: typeSlug }
    if (recordClass === FROM_FIELD) {
      if (!recordClassFrom) {
        setError("Pick the field that supplies the record class.")
        return
      }
      params.record_class_from = recordClassFrom
    } else if (recordClass) {
      params.record_class = recordClass
    }
    if (severity === FROM_FIELD) {
      if (!severityFrom) {
        setError("Pick the field that supplies the severity.")
        return
      }
      params.severity_from = severityFrom
    } else if (severity) {
      params.severity = severity
    }
    if (noteTemplate.trim()) params.note_template = noteTemplate.trim()

    const payload: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      trigger,
      conditions,
      conditions_clear: conditions === null,
      enrichers: Array.from(enrichers),
      computed,
      actions: [{ action: "create_event", params }],
      enabled,
    }
    if (!editing) delete payload.conditions_clear

    setPending(true)
    setError(null)
    try {
      const res = await fetch(
        editing ? `/api/be/rules/${rule!.id}` : "/api/be/rules",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          typeof body.detail === "string" ? body.detail : `Save failed (${res.status})`,
        )
      }
      onSaved((await res.json()) as Rule)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  async function runTest() {
    const built = buildComputed()
    if (typeof built === "string") {
      setTestError(built)
      return
    }
    let conditions: unknown = null
    if (rawMode) {
      try {
        conditions = rawCond.trim() ? JSON.parse(rawCond) : null
      } catch {
        setTestError("Conditions JSON doesn't parse.")
        return
      }
    } else {
      conditions = encodeConditions(condRows, condMode)
    }
    const sample: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(testSample)) {
      if (v !== "") sample[k] = coerce(v)
    }
    setTestPending(true)
    setTestError(null)
    try {
      const res = await fetch("/api/be/rules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ computed: built, conditions, sample }),
      })
      if (!res.ok) throw new Error(`Test failed (${res.status})`)
      setTestResult(await res.json())
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Unknown error")
      setTestResult(null)
    } finally {
      setTestPending(false)
    }
  }

  /** Sample inputs = trigger + enricher fields (computed are derived). */
  const sampleFields = useMemo(
    () => fields.filter((f) => !computedRows.some((c) => c.name === f.key)),
    [fields, computedRows],
  )

  const onLastStep = step === STEPS.length - 1

  return (
    // Multi-step form — a stray click outside must not discard progress
    // (Esc and the close button still work).
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit rule: ${rule!.name}`
              : duplicate
                ? `Duplicate rule: ${rule!.name}`
                : "New rule"}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator — visited steps are clickable. */}
        <div className="flex flex-wrap items-center gap-1">
          {STEPS.map((s, i) => {
            const reachable = prefilled || i <= maxVisited
            const done = i < step
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => reachable && goTo(i)}
                disabled={!reachable || pending}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2 py-1 text-xs",
                  i === step
                    ? "bg-primary/10 font-semibold text-primary"
                    : reachable
                      ? "text-muted-foreground hover:bg-muted"
                      : "text-muted-foreground/50",
                )}
              >
                <span
                  className={cn(
                    "flex size-4.5 items-center justify-center rounded-full border text-[10px]",
                    i === step
                      ? "border-primary bg-primary text-primary-foreground"
                      : done
                        ? "border-primary/50 text-primary"
                        : "border-muted-foreground/40",
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
          {step === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                What should this rule react to?
              </p>
              {meta.triggers.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTrigger(t.key)
                    if (t.key !== trigger) {
                      setEnrichers(new Set())
                      setCondRows([])
                    }
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm",
                    trigger === t.key
                      ? "border-primary bg-primary/5"
                      : "border-input hover:bg-accent/50",
                  )}
                >
                  <span>{t.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {t.key}
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Enrichers add extra fields to the trigger payload — usable in
                conditions and in the note template. Optional.
              </p>
              {availableEnrichers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No enrichers available for this trigger.
                </p>
              )}
              {availableEnrichers.map((e) => (
                <label
                  key={e.key}
                  className="flex items-start gap-2.5 rounded-md border border-input px-3 py-2"
                >
                  <Checkbox
                    checked={enrichers.has(e.key)}
                    onCheckedChange={() =>
                      setEnrichers((prev) => {
                        const nextSet = new Set(prev)
                        if (nextSet.has(e.key)) nextSet.delete(e.key)
                        else nextSet.add(e.key)
                        return nextSet
                      })
                    }
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm">{e.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      adds: {e.fields.map((f) => f.key).join(", ")}
                    </span>
                  </span>
                </label>
              ))}

              <div className="space-y-2 pt-2">
                <div>
                  <p className="text-sm font-medium">Computed values</p>
                  <p className="text-xs text-muted-foreground">
                    Derive your own fields from the payload — usable in
                    conditions and the note template like any other field.
                    Pick a builder (rank, compare, map) or drop to raw
                    formula JSON for anything else; test them from the
                    Review step.
                  </p>
                </div>
                {computedRows.map((row, i) => (
                  <ComputedRowEditor
                    key={i}
                    row={row}
                    fields={fields.filter(
                      (f) =>
                        !computedRows
                          .slice(i)
                          .some((later) => later.name === f.key),
                    )}
                    onChange={(next) =>
                      setComputedRows((rows) =>
                        rows.map((r, j) => (j === i ? next : r)),
                      )
                    }
                    onRemove={() =>
                      setComputedRows((rows) => rows.filter((_, j) => j !== i))
                    }
                  />
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setComputedRows((rows) => [...rows, emptyComputedRow()])
                  }
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  Add computed value
                </Button>
              </div>
            </div>
          )}

          {step === 2 &&
            (rawMode ? (
              <div className="space-y-1.5">
                <Label>Conditions (JSON)</Label>
                <p className="text-[10px] text-muted-foreground">
                  This rule's conditions were authored in a shape the row
                  editor can't represent — edit the raw tree instead.
                </p>
                <Textarea
                  value={rawCond}
                  onChange={(e) => setRawCond(e.target.value)}
                  className="min-h-40 font-mono text-xs"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  Fire when
                  <select
                    value={condMode}
                    onChange={(e) => setCondMode(e.target.value as "all" | "any")}
                    className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="all">all</option>
                    <option value="any">any</option>
                  </select>
                  of these match. No conditions = fire every time.
                </div>
                {condRows.map((row, i) => {
                  const fieldMeta = fields.find((f) => f.key === row.field)
                  const enumValues =
                    fieldMeta?.type === "enum" ? fieldMeta.values ?? [] : null
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={row.field}
                        onChange={(e) =>
                          setCondRows((rows) =>
                            rows.map((r, j) =>
                              j === i ? { ...r, field: e.target.value, value: "" } : r,
                            ),
                          )
                        }
                        className={cn(selectClass, "w-44 flex-none")}
                      >
                        <option value="">Field…</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={row.op}
                        onChange={(e) =>
                          setCondRows((rows) =>
                            rows.map((r, j) =>
                              j === i ? { ...r, op: e.target.value as CondOp } : r,
                            ),
                          )
                        }
                        className={cn(selectClass, "w-36 flex-none")}
                      >
                        {Object.entries(OP_LABELS).map(([op, label]) => (
                          <option key={op} value={op}>
                            {label}
                          </option>
                        ))}
                      </select>
                      {enumValues && row.op !== "one_of" && row.op !== "contains" ? (
                        <select
                          value={row.value}
                          onChange={(e) =>
                            setCondRows((rows) =>
                              rows.map((r, j) =>
                                j === i ? { ...r, value: e.target.value } : r,
                              ),
                            )
                          }
                          className={selectClass}
                        >
                          <option value="">Value…</option>
                          {enumValues.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          value={row.value}
                          onChange={(e) =>
                            setCondRows((rows) =>
                              rows.map((r, j) =>
                                j === i ? { ...r, value: e.target.value } : r,
                              ),
                            )
                          }
                          placeholder={
                            row.op === "one_of"
                              ? "value1, value2, …"
                              : enumValues
                                ? enumValues.join(" / ")
                                : "value"
                          }
                        />
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setCondRows((rows) => rows.filter((_, j) => j !== i))
                        }
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                        aria-label="Remove condition"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCondRows((rows) => [...rows, { field: "", op: "is", value: "" }])
                  }
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  Add condition
                </Button>
              </div>
            ))}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                What happens when the rule fires. v1 creates a feed record;
                more action types (notifications, status changes) plug in here
                later.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Event type</Label>
                  <select
                    value={typeSlug}
                    onChange={(e) => setTypeSlug(e.target.value)}
                    className={selectClass}
                  >
                    {typeGroups.map((g) => (
                      <optgroup key={g.category} label={g.category}>
                        {g.types.map((t) => (
                          <option key={t.id} value={t.slug}>
                            {t.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Record class</Label>
                  <select
                    value={recordClass}
                    onChange={(e) =>
                      setRecordClass(
                        e.target.value as RecordClass | "" | typeof FROM_FIELD,
                      )
                    }
                    className={selectClass}
                  >
                    <option value="">
                      Type default ({selectedType?.record_class ?? "event"})
                    </option>
                    <option value="event">Event (timeline)</option>
                    <option value="log">Log (audit only)</option>
                    <option value={FROM_FIELD}>From a field…</option>
                  </select>
                </div>
                {recordClass === FROM_FIELD && (
                  <div className="space-y-1.5">
                    <Label>Class field</Label>
                    <select
                      value={recordClassFrom}
                      onChange={(e) => setRecordClassFrom(e.target.value)}
                      className={selectClass}
                    >
                      <option value="">Pick a field…</option>
                      {fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground">
                      The field's value must be “log” or “event”; anything
                      else falls back to the type default.
                    </p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Severity</Label>
                  <select
                    value={severity}
                    onChange={(e) =>
                      setSeverity(e.target.value as Severity | "" | typeof FROM_FIELD)
                    }
                    className={selectClass}
                  >
                    <option value="">
                      Type default (
                      {SEVERITY_LABELS[selectedType?.default_severity ?? "notice"]})
                    </option>
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY_LABELS[s]}
                      </option>
                    ))}
                    <option value={FROM_FIELD}>From a field…</option>
                  </select>
                </div>
                {severity === FROM_FIELD && (
                  <div className="space-y-1.5">
                    <Label>Severity field</Label>
                    <select
                      value={severityFrom}
                      onChange={(e) => setSeverityFrom(e.target.value)}
                      className={selectClass}
                    >
                      <option value="">Pick a field…</option>
                      {fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground">
                      The field's value must be info / notice / warning /
                      critical — anything else falls back to the type
                      default. Use a “Map values” computed field to translate
                      (e.g. escalation yes → critical, no → info).
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>
                  Note template
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    (optional — overrides the operator's note)
                  </span>
                </Label>
                <Textarea
                  value={noteTemplate}
                  onChange={(e) => setNoteTemplate(e.target.value)}
                  placeholder="e.g. {service_name} at {site_name} went {new_status}"
                  className="min-h-16 font-mono text-xs"
                />
                <FieldChips
                  fields={fields}
                  makeToken={(key) => `{${key}}`}
                  onInsert={(token) => setNoteTemplate((v) => v + token)}
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                {summarySentence()}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Service outage alarm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Enabled</Label>
                  <label className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={() => setEnabled((v) => !v)}
                    />
                    Rule is active
                  </label>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional — why this rule exists."
                  className="min-h-16"
                />
              </div>

              <div className="flex flex-col gap-2 rounded-md border border-input bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-medium">Test this rule</p>
                  <p className="text-xs text-muted-foreground">
                    Enter a sample payload and see every computed value plus
                    whether the conditions match — no events are created.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {sampleFields.map((f) => (
                    <div key={f.key} className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        {f.label}
                      </span>
                      {f.type === "enum" && f.values ? (
                        <select
                          value={testSample[f.key] ?? ""}
                          onChange={(e) =>
                            setTestSample((s) => ({ ...s, [f.key]: e.target.value }))
                          }
                          className={cn(selectClass, "h-8 text-xs")}
                        >
                          <option value="">—</option>
                          {f.values.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          value={testSample[f.key] ?? ""}
                          onChange={(e) =>
                            setTestSample((s) => ({ ...s, [f.key]: e.target.value }))
                          }
                          className="h-8 font-mono text-xs"
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={runTest}
                    disabled={testPending}
                  >
                    {testPending ? "Running…" : "Run test"}
                  </Button>
                  {testResult && (
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                        testResult.matched
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {testResult.matched ? "Would fire" : "Would not fire"}
                    </span>
                  )}
                </div>
                {testError && (
                  <p className="text-xs text-destructive">{testError}</p>
                )}
                {testResult && Object.keys(testResult.computed_values).length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {Object.entries(testResult.computed_values).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="font-mono text-[11px] text-muted-foreground">
                          {k}
                        </dt>
                        <dd className="font-mono text-[11px]">
                          {v === null ? "∅ (nothing)" : JSON.stringify(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => goTo(step - 1)}
              disabled={pending}
            >
              Back
            </Button>
          )}
          {onLastStep ? (
            <Button type="button" onClick={handleSave} disabled={pending}>
              {pending ? "Saving…" : editing ? "Save rule" : "Create rule"}
            </Button>
          ) : (
            <Button type="button" onClick={next} disabled={pending}>
              Next
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
