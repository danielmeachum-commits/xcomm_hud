export type ColumnKey =
  | "validated_at"
  | "zulu"
  | "subject_kind"
  | "subject_name"
  | "site_name"
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
  { key: "validated_at", label: "Local", sortable: true, hideable: false },
  { key: "zulu", label: "Zulu", sortable: false, hideable: true },
  { key: "subject_kind", label: "Kind", sortable: true, hideable: true },
  { key: "subject_name", label: "Subject", sortable: true, hideable: true },
  { key: "site_name", label: "Site", sortable: true, hideable: true },
  { key: "prev_status", label: "Previous", sortable: false, hideable: true },
  { key: "status", label: "Status", sortable: true, hideable: true },
  { key: "operator", label: "Operator", sortable: true, hideable: true },
  { key: "source", label: "Source", sortable: false, hideable: true },
  { key: "note", label: "Note", sortable: false, hideable: true },
]

export const DEFAULT_VISIBLE: ColumnKey[] = [
  "validated_at",
  "zulu",
  "subject_kind",
  "subject_name",
  "site_name",
  "prev_status",
  "status",
  "operator",
  "note",
]

export const DEFAULT_ORDER: ColumnKey[] = ALL_COLUMNS.map((c) => c.key)

const STORAGE_KEY = "events.columns.v1"

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
