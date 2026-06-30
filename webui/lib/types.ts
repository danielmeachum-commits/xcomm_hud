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

export type ServiceKind = "voip" | "data" | "video" | "crypto" | "other"

export type ServiceHosting = "self" | "cloud" | "hybrid"

export type ServiceCategory = "core_critical_local" | "sustainment" | "other"

export type ServiceReach = "local" | "external" | "both"

export type GatewayKind = "isp" | "modem" | "satellite" | "other"

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

export interface Service {
  id: number
  name: string
  site_id: number | null
  kind: ServiceKind
  hosting: ServiceHosting
  category: ServiceCategory
  reach: ServiceReach
  icon: string | null
  status: StatusValue
  notes: string | null
}

export interface ServiceTemplate {
  id: number
  name: string
  kind: ServiceKind
  category: ServiceCategory
  reach: ServiceReach
  default_hosting: ServiceHosting
  icon: string | null
  notes: string | null
}

export interface Gateway {
  id: number
  site_id: number
  name: string
  kind: GatewayKind
  provider: string | null
  status: StatusValue
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
  classification: Classification | null
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
  service_count: number
}

export interface ServiceRollup {
  id: number
  name: string
  kind: ServiceKind
  category: ServiceCategory
  reach: ServiceReach
  icon: string | null
  hosting: ServiceHosting
  status: StatusValue
  site_id: number | null
  site_name: string | null
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
