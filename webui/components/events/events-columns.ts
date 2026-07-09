// Time, site, and severity are not listed here: they render in the fixed
// leading gutter (detached from the configurable columns), like the timeline.
export type ColumnKey =
  | "type_slug"
  | "record_class"
  | "subject_kind"
  | "subject_name"
  | "prev_status"
  | "status"
  | "operator"
  | "source"
  | "note"

export interface ColumnDef {
  key: ColumnKey
  label: string
  sortable: boolean
  /** Whether this column can be hidden by the user. Selection col is not user-configurable and is not in this list. */
  hideable: boolean
}

export const ALL_COLUMNS: ColumnDef[] = [
  { key: "subject_name", label: "Subject", sortable: true, hideable: false },
  { key: "subject_kind", label: "Kind", sortable: true, hideable: true },
  { key: "prev_status", label: "Previous", sortable: false, hideable: true },
  { key: "status", label: "Status", sortable: true, hideable: true },
  { key: "operator", label: "Operator", sortable: true, hideable: true },
  { key: "type_slug", label: "Type", sortable: false, hideable: true },
  { key: "record_class", label: "Class", sortable: false, hideable: true },
  { key: "source", label: "Source", sortable: false, hideable: true },
  { key: "note", label: "Note", sortable: false, hideable: true },
]

export const DEFAULT_VISIBLE: ColumnKey[] = [
  "subject_name",
  "prev_status",
  "status",
  "note",
]

export const DEFAULT_ORDER: ColumnKey[] = ALL_COLUMNS.map((c) => c.key)

// v5: Site joins Time + Severity in the detached gutter, dropped from columns.
const STORAGE_KEY = "events.columns.v5"

interface ColumnPrefs {
  visible: ColumnKey[]
  order: ColumnKey[]
}

export function loadColumnPrefs(): ColumnPrefs {
  if (typeof window === "undefined") {
    return { visible: DEFAULT_VISIBLE, order: DEFAULT_ORDER }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { visible: DEFAULT_VISIBLE, order: DEFAULT_ORDER }
    const parsed = JSON.parse(raw) as Partial<ColumnPrefs>
    const known = new Set<ColumnKey>(DEFAULT_ORDER)
    const order = (parsed.order ?? []).filter((k): k is ColumnKey =>
      known.has(k as ColumnKey),
    )
    for (const k of DEFAULT_ORDER) if (!order.includes(k)) order.push(k)
    const visible = (parsed.visible ?? DEFAULT_VISIBLE).filter(
      (k): k is ColumnKey => known.has(k as ColumnKey),
    )
    return { visible, order }
  } catch {
    return { visible: DEFAULT_VISIBLE, order: DEFAULT_ORDER }
  }
}

export function saveColumnPrefs(prefs: ColumnPrefs): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // ignore quota / private-mode errors
  }
}

export type { ColumnPrefs }
