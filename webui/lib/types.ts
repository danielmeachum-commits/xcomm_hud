// TypeScript types matching the xcomm_hud API contract.

export type Classification = "U" | "CUI" | "S" | "TS"

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  U: "Unclassified",
  CUI: "Controlled Unclassified",
  S: "Secret",
  TS: "Top Secret",
}

export type Role = "viewer" | "operator" | "admin"

export type StatusValue = "up" | "degraded" | "down" | "unknown"

export type EquipmentKind =
  | "router"
  | "switch"
  | "server"
  | "crypto"
  | "phone"
  | "other"

export type ServiceKind = "voip" | "data" | "video" | "crypto" | "other"

export type ServiceHosting = "self" | "cloud" | "hybrid"

export type ComponentRole = "primary" | "backup" | "uplink" | "dependency"

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
  classification: Classification
  lat: number | null
  lon: number | null
  notes: string | null
  status: StatusValue
}

export interface UTC {
  id: number
  site_id: number
  designation: string
  name: string | null
  notes: string | null
  status: StatusValue
}

export interface Equipment {
  id: number
  site_id: number
  utc_id: number | null
  name: string
  kind: EquipmentKind
  vendor: string | null
  model: string | null
  role: string | null
  status: StatusValue
  manual_status_override: boolean
  source_enclave_id: number | null
  source_device_ref: string | null
  notes: string | null
}

export interface ServiceComponent {
  equipment_id: number
  role: ComponentRole
  required: boolean
}

export interface Service {
  id: number
  name: string
  site_id: number | null
  kind: ServiceKind
  hosting: ServiceHosting
  status: StatusValue
  manual_status_override: boolean
  notes: string | null
  components: ServiceComponent[]
}

export interface SiteRollup {
  id: number
  name: string
  status: StatusValue
  utc_count: number
  equipment_count: number
  service_count: number
}

export interface ServiceRollup {
  id: number
  name: string
  kind: ServiceKind
  hosting: ServiceHosting
  status: StatusValue
  site_id: number | null
}

export interface StatusRollup {
  sites: SiteRollup[]
  services: ServiceRollup[]
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
