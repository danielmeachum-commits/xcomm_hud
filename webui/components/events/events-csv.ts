import { statusLabel } from "@/lib/status"
import { formatZulu } from "@/lib/time"
import type { Event } from "@/lib/types"

function csvEscape(value: string | null | undefined): string {
  if (value == null) return ""
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const HEADERS = [
  "id",
  "validated_at_local",
  "validated_at_zulu",
  "subject_kind",
  "subject",
  "site",
  "previous",
  "status",
  "operator",
  "source",
  "note",
  "edited_at",
  "hidden_at",
]

function toRow(v: Event): string[] {
  const local = new Date(v.validated_at).toLocaleString()
  return [
    String(v.id),
    local,
    formatZulu(v.validated_at),
    v.subject_kind,
    v.subject_name ?? (v.subject_id != null ? `id ${v.subject_id}` : ""),
    v.site_name ?? "",
    v.prev_status ? statusLabel(v.prev_status) : "",
    v.status ? statusLabel(v.status) : "",
    v.validated_by_username ?? v.source,
    v.source,
    v.note ?? "",
    v.edited_at ?? "",
    v.hidden_at ?? "",
  ]
}

export function toCsv(rows: Event[]): string {
  const lines = [HEADERS.join(",")]
  for (const v of rows) {
    lines.push(toRow(v).map(csvEscape).join(","))
  }
  return lines.join("\r\n")
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
