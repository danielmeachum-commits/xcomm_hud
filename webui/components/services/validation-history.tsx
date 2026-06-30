import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { LocalTime, TimeAgo } from "@/components/time-display"
import { statusLabel, statusToIndicatorState } from "@/lib/status"
import { formatZulu } from "@/lib/time"
import type { Validation } from "@/lib/types"

interface Props {
  validations: Validation[]
}

export function ValidationHistory({ validations }: Props) {
  if (validations.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
        No validations recorded for this service yet.
      </div>
    )
  }
  return (
    <div className="overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">When (local)</th>
            <th className="px-3 py-2 text-left">Zulu</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Validator</th>
            <th className="px-3 py-2 text-left">Note</th>
          </tr>
        </thead>
        <tbody>
          {validations.map((v) => (
            <tr key={v.id} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">
                <div><LocalTime iso={v.validated_at} /></div>
                <div className="text-[10px] text-muted-foreground">
                  <TimeAgo iso={v.validated_at} />
                </div>
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {formatZulu(v.validated_at)}
              </td>
              <td className="px-3 py-2">
                <div className="inline-flex items-center gap-2">
                  <StatusIndicator
                    state={statusToIndicatorState(v.status)}
                    size="sm"
                  />
                  <span>{statusLabel(v.status)}</span>
                </div>
                {v.prev_status && v.prev_status !== v.status && (
                  <div className="text-[10px] text-muted-foreground">
                    was {statusLabel(v.prev_status)}
                  </div>
                )}
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
  )
}
