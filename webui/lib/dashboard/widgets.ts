import { SiteStatusGridWidget } from "@/components/dashboard/widgets/site-status-grid"
import { ServiceHealthRollupWidget } from "@/components/dashboard/widgets/service-health-rollup"

import type { WidgetDef } from "./registry"

export const WIDGETS: Record<string, WidgetDef> = {
  "site-status-grid": {
    id: "site-status-grid",
    title: "Site status grid",
    description: "Per-site rollup tiles colored by worst-of status.",
    component: SiteStatusGridWidget,
    minSizePct: 25,
  },
  "service-health-rollup": {
    id: "service-health-rollup",
    title: "Service health rollup",
    description: "Services grouped by kind with worst-of component status.",
    component: ServiceHealthRollupWidget,
    minSizePct: 20,
  },
}

export function getWidget(id: string): WidgetDef | undefined {
  return WIDGETS[id]
}

export function listWidgets(): WidgetDef[] {
  return Object.values(WIDGETS)
}
