// TypeScript types matching the xcomm_hud API contract.

export type Role = "viewer" | "operator" | "admin"

export type ServiceStatus =
  | "up"
  | "degraded"
  | "down"
  | "unknown"
  | "offline"
  | "setup"

export type GatewayStatus =
  | "active"
  | "ready"
  | "degraded"
  | "down"
  | "offline"
  | "setup"

/** Manually set posture describing the site itself — not a rollup of its
 *  services. Distinct from ServiceStatus on purpose. */
export type SiteStatus =
  | "operational"
  | "limited"
  | "degraded"
  | "maintenance"
  | "standby"
  | "offline"
  | "setup"

/** Service-shaped status value (legacy name). Keeps existing imports working. */
export type StatusValue = ServiceStatus

/** Union across every status kind that shares the validation `status` column:
 *  service/gateway/site statuses plus FPCON and EMCON levels. */
export type AnyStatus =
  | ServiceStatus
  | GatewayStatus
  | SiteStatus
  | Fpcon
  | Emcon

export type ServiceKind = "voice" | "data" | "other"

export type ServiceCategory = "critical" | "sustainment" | "other"

export type ServiceReach = "local" | "external"

export type GatewayKind = "milsat" | "commercial" | "other"

export type GatewayPace = "primary" | "alternate" | "contingency" | "emergency"

export type Fpcon = "normal" | "alpha" | "bravo" | "charlie" | "delta"

export type Emcon = "a" | "b" | "c" | "d"

export type SubjectKind =
  | "service"
  | "site"
  | "gateway"
  | "site_fpcon"
  | "site_emcon"
  | "site_status"
  | "system"
  | "mission"
  | "exercise"

export type EventType = "validation" | "general"

export const VALIDATION_SUBJECT_KINDS: readonly SubjectKind[] = [
  "service",
  "site",
  "gateway",
  "site_fpcon",
  "site_emcon",
  "site_status",
]

export const GENERAL_SUBJECT_KINDS: readonly SubjectKind[] = [
  "system",
  "mission",
  "exercise",
]

export interface Workspace {
  id: number
  slug: string
  name: string
  description: string | null
  tags: string[]
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface Me {
  user_id: number
  username: string
  display_name: string | null
  role: Role
  current_workspace: Workspace
  workspaces: Workspace[]
}

export interface User {
  id: number
  username: string
  display_name: string | null
  role: Role
  disabled_at: string | null
}

export interface Site {
  id: number
  workspace_id: number
  name: string
  location_label: string | null
  status: SiteStatus
  fpcon: Fpcon
  emcon: Emcon
  show_fpcon: boolean
  show_emcon: boolean
  lat: number | null
  lon: number | null
  notes: string | null
}

export interface ServiceGatewayStatus {
  gateway_id: number
  /** Raw stored value — the operator's last cell validation. */
  status: ServiceStatus
  /** Displayed value: applies R10 gateway/local overrides and R11 clamp
   *  to the raw stored status. UI should render this. */
  effective_status: ServiceStatus
  validated_at: string | null
  validated_by_user_id: number | null
  validated_by_username: string | null
}

export interface Service {
  id: number
  name: string
  site_id: number
  service_template_id: number | null
  kind: ServiceKind
  category: ServiceCategory
  reach: ServiceReach
  icon: string | null
  description: string | null
  status: ServiceStatus
  effective_status: ServiceStatus
  allowed_statuses: ServiceStatus[] | null
  enabled_pace: GatewayPace[]
  validated_at: string | null
  validated_by_user_id: number | null
  validated_by_username: string | null
  display_order: number
  notes: string | null
  /** Per-(service × gateway) matrix cells for every gateway on this site
   *  whose PACE tier the service enables. Materialized by the API on read. */
  gateway_statuses: ServiceGatewayStatus[]
}

export interface ServiceTemplate {
  id: number
  name: string
  kind: ServiceKind
  category: ServiceCategory
  reach: ServiceReach
  icon: string | null
  description: string | null
  allowed_statuses: StatusValue[] | null
}

export interface Gateway {
  id: number
  site_id: number
  name: string
  kind: GatewayKind
  provider: string | null
  status: GatewayStatus
  pace: GatewayPace
  validated_at: string | null
  validated_by_user_id: number | null
  validated_by_username: string | null
  display_order: number
  notes: string | null
}

export interface CanvasPosition {
  site_id: number
  x: number
  y: number
}

export interface CanvasAnnotation {
  id: number
  text: string
  x: number
  y: number
}

export interface MapBundle {
  sites: Site[]
  positions: CanvasPosition[]
  services: Service[]
  gateways: Gateway[]
  annotations: CanvasAnnotation[]
}

export interface SiteRollup {
  id: number
  name: string
  status: SiteStatus
  fpcon: Fpcon
  emcon: Emcon
  show_fpcon: boolean
  show_emcon: boolean
  service_count: number
  gateway_count: number
}

export interface ServiceRollup {
  id: number
  name: string
  kind: ServiceKind
  category: ServiceCategory
  reach: ServiceReach
  icon: string | null
  status: StatusValue
  effective_status: StatusValue
  allowed_statuses: StatusValue[] | null
  site_id: number
  site_name: string
  validated_at: string | null
}

export interface StatusRollup {
  sites: SiteRollup[]
  services: ServiceRollup[]
}

export interface Event {
  id: number
  event_type: EventType
  validated_at: string
  subject_kind: SubjectKind
  subject_id: number | null
  subject_name: string | null
  subject_label: string | null
  site_id: number | null
  site_name: string | null
  prev_status: AnyStatus | null
  status: AnyStatus | null
  source: "manual" | "ingest"
  validated_by_user_id: number | null
  validated_by_username: string | null
  note: string | null
  edited_at: string | null
  hidden_at: string | null
  hidden_by_user_id: number | null
}

export interface EnclaveSource {
  id: number
  name: string
  scoi_url: string | null
  last_contact_at: string | null
  sync_status: string
  notes: string | null
}

export interface ApiError {
  detail: string
}
