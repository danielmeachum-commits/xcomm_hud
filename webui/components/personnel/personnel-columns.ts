export type PersonnelColumnKey =
  | "name"
  | "status"
  | "work_center"
  | "unit"
  | "assigned_site"
  | "cellphone"
  | "dsn"
  | "email"
  | "room"

export interface PersonnelColumnDef {
  key: PersonnelColumnKey
  label: string
  sortable: boolean
  /** Cannot be hidden (Name anchors the row). */
  alwaysOn: boolean
}

export const ALL_PERSONNEL_COLUMNS: PersonnelColumnDef[] = [
  { key: "name", label: "Name", sortable: true, alwaysOn: true },
  { key: "status", label: "Status", sortable: true, alwaysOn: false },
  { key: "work_center", label: "Work center", sortable: true, alwaysOn: false },
  { key: "unit", label: "Unit", sortable: true, alwaysOn: false },
  { key: "assigned_site", label: "Assigned site", sortable: true, alwaysOn: false },
  { key: "cellphone", label: "Phone", sortable: true, alwaysOn: false },
  { key: "dsn", label: "DSN", sortable: true, alwaysOn: false },
  { key: "email", label: "Email", sortable: true, alwaysOn: false },
  { key: "room", label: "Room", sortable: true, alwaysOn: false },
]

export const DEFAULT_VISIBLE: PersonnelColumnKey[] = [
  "name",
  "status",
  "work_center",
  "unit",
  "assigned_site",
  "cellphone",
  "email",
]

const STORAGE_KEY = "personnel.columns.v1"

/** Load persisted visible-column prefs, falling back to defaults. SSR-safe. */
export function loadVisibleColumns(): PersonnelColumnKey[] {
  if (typeof window === "undefined") return DEFAULT_VISIBLE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_VISIBLE
    const parsed = JSON.parse(raw) as PersonnelColumnKey[]
    const known = new Set(ALL_PERSONNEL_COLUMNS.map((c) => c.key))
    const visible = parsed.filter((k) => known.has(k))
    // Name is always present even if a stale pref dropped it.
    if (!visible.includes("name")) visible.unshift("name")
    return visible.length > 0 ? visible : DEFAULT_VISIBLE
  } catch {
    return DEFAULT_VISIBLE
  }
}

export function saveVisibleColumns(visible: PersonnelColumnKey[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visible))
  } catch {
    // ignore quota / disabled storage
  }
}
