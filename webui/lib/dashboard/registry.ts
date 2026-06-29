import type { ComponentType } from "react"

import type { SiteRollup, ServiceRollup } from "@/lib/types"

/**
 * Server-side data prefetched once per page render. Widgets pull what they
 * need from this; if absent they render their own loading/empty state.
 */
export interface WidgetData {
  sites?: SiteRollup[]
  services?: ServiceRollup[]
}

export interface WidgetProps {
  data: WidgetData
  /** Per-instance config persisted in the layout tree. */
  config: Record<string, unknown>
  /** Merge a patch into this leaf's config (persisted via the dashboard store). */
  setConfig: (
    patch:
      | Record<string, unknown>
      | ((cur: Record<string, unknown>) => Record<string, unknown>),
  ) => void
}

export interface WidgetDef {
  id: string
  title: string
  component: ComponentType<WidgetProps>
  standaloneOnly?: boolean
  minSizePct?: number
  description?: string
}
