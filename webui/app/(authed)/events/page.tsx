import { requireSession } from "@/lib/auth"
import { apiGet } from "@/lib/api"
import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { statusLabel, statusToIndicatorState } from "@/lib/status"
import { formatLocal, formatZulu } from "@/lib/time"
import type { Validation } from "@/lib/types"

export default async function EventsPage() {
  await requireSession()
  let validations: Validation[] = []
  try {
    validations = await apiGet<Validation[]>("/validations?limit=200")
  } catch {
    // ignore
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Validation events</h1>
        <p className="text-xs text-muted-foreground">
          Append-only history of every status validation. Most recent first.
        </p>
      </div>
      {validations.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-12 text-sm text-muted-foreground">
          No validations recorded yet.
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Local</th>
                <th className="px-3 py-2 text-left">Zulu</th>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2 text-left">Site</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Validator</th>
                <th className="px-3 py-2 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {validations.map((v) => (
                <tr key={v.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">
                    {formatLocal(v.validated_at)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {formatZulu(v.validated_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                      {v.subject_kind}
                    </span>{" "}
                    {v.subject_name ?? `id ${v.subject_id}`}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {v.site_name ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <StatusIndicator
                        state={statusToIndicatorState(v.status)}
                        size="sm"
                      />
                      {statusLabel(v.status)}
                      {v.prev_status && v.prev_status !== v.status && (
                        <span className="text-[10px] text-muted-foreground">
                          (was {statusLabel(v.prev_status)})
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {v.validated_by_username ?? v.source}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {v.note ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
