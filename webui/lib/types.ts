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

/** Service-shaped status value (legacy name). Keeps existing imports working. */
export type StatusValue = ServiceStatus

/** Either a service or gateway status — used by shared helpers. Also
 *  includes FPCON/EMCON levels since site_fpcon/site_emcon validation rows
 *  reuse the same `status` column. */
export type AnyStatus = ServiceStatus | GatewayStatus | Fpcon | Emcon

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
]

export const GENERAL_SUBJECT_KINDS: readonly SubjectKind[] = [
  "system",
  "mission",
  "exercise",
]

export interface Me {
  user_id: number
  username: string
  display_name: string | null
  role: Role
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
  name: string
  location_label: string | null
  fpcon: Fpcon
  emcon: Emcon
  show_fpcon: boolean
  show_emcon: boolean
  lat: number | null
  lon: number | null
  notes: string | null
  status: StatusValue
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
  status: StatusValue
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
