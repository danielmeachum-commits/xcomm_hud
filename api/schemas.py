"""Pydantic v2 schemas for xcomm_hud API."""

from __future__ import annotations

import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Classification = Literal["U", "CUI", "S", "TS"]
StatusValue = Literal["up", "degraded", "down", "unknown"]
ServiceKind = Literal["voip", "data", "video", "crypto", "other"]
ServiceHosting = Literal["self", "cloud", "hybrid"]
ServiceCategory = Literal["core_critical_local", "sustainment", "other"]
ServiceReach = Literal["local", "external", "both"]
GatewayKind = Literal["isp", "modem", "satellite", "other"]
UserRole = Literal["viewer", "operator", "admin"]
SubjectKind = Literal["service", "site", "gateway"]


class _ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Users ---


class UserOut(_ORM):
    id: int
    username: str
    display_name: Optional[str] = None
    role: UserRole
    disabled_at: Optional[datetime.datetime] = None


class UserIn(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = None
    role: UserRole = "viewer"


class UserPatch(BaseModel):
    display_name: Optional[str] = None
    role: Optional[UserRole] = None
    password: Optional[str] = None
    disabled: Optional[bool] = None


class MeOut(BaseModel):
    user_id: int
    username: str
    display_name: Optional[str] = None
    role: UserRole


# --- Site ---


class SiteIn(BaseModel):
    name: str
    location_label: Optional[str] = None
    classification: Classification = "U"
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None


class SitePatch(BaseModel):
    name: Optional[str] = None
    location_label: Optional[str] = None
    classification: Optional[Classification] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None


class SiteOut(_ORM):
    id: int
    name: str
    location_label: Optional[str] = None
    classification: Classification
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None
    status: StatusValue = "unknown"


# --- Service template (catalog) ---


class ServiceTemplateOut(_ORM):
    id: int
    name: str
    kind: ServiceKind
    category: ServiceCategory
    reach: ServiceReach
    default_hosting: ServiceHosting
    icon: Optional[str] = None
    notes: Optional[str] = None


# --- Service ---


class ServiceIn(BaseModel):
    name: str
    site_id: Optional[int] = None
    kind: ServiceKind = "other"
    hosting: ServiceHosting = "self"
    category: ServiceCategory = "other"
    reach: ServiceReach = "local"
    icon: Optional[str] = None
    status: StatusValue = "unknown"
    notes: Optional[str] = None


class ServicePatch(BaseModel):
    name: Optional[str] = None
    site_id: Optional[int] = None
    kind: Optional[ServiceKind] = None
    hosting: Optional[ServiceHosting] = None
    category: Optional[ServiceCategory] = None
    reach: Optional[ServiceReach] = None
    icon: Optional[str] = None
    status: Optional[StatusValue] = None
    notes: Optional[str] = None
    note: Optional[str] = None


class ServiceOut(_ORM):
    id: int
    name: str
    site_id: Optional[int] = None
    kind: ServiceKind
    hosting: ServiceHosting
    category: ServiceCategory
    reach: ServiceReach
    icon: Optional[str] = None
    status: StatusValue
    notes: Optional[str] = None


# --- Gateway ---


class GatewayIn(BaseModel):
    name: str
    kind: GatewayKind = "other"
    provider: Optional[str] = None
    status: StatusValue = "unknown"
    notes: Optional[str] = None


class GatewayPatch(BaseModel):
    name: Optional[str] = None
    kind: Optional[GatewayKind] = None
    provider: Optional[str] = None
    status: Optional[StatusValue] = None
    notes: Optional[str] = None


class GatewayOut(_ORM):
    id: int
    site_id: int
    name: str
    kind: GatewayKind
    provider: Optional[str] = None
    status: StatusValue
    notes: Optional[str] = None


# --- Canvas ---


class CanvasPositionIn(BaseModel):
    x: float
    y: float


class CanvasPositionOut(BaseModel):
    site_id: int
    x: float
    y: float


class CanvasAnnotationIn(BaseModel):
    text: str = ""
    x: float = 0.0
    y: float = 0.0
    classification: Optional[Classification] = None


class CanvasAnnotationPatch(BaseModel):
    text: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    classification: Optional[Classification] = None


class CanvasAnnotationOut(_ORM):
    id: int
    text: str
    x: float
    y: float
    classification: Optional[Classification] = None


class MapBundle(BaseModel):
    """Single fetch for the /map canvas — sites + their positions + services
    + gateways + annotations."""

    sites: list[SiteOut]
    positions: list[CanvasPositionOut]
    services: list[ServiceOut]
    gateways: list[GatewayOut]
    annotations: list[CanvasAnnotationOut]


# --- Status / rollup ---


class SiteRollup(BaseModel):
    id: int
    name: str
    status: StatusValue
    service_count: int


class ServiceRollup(BaseModel):
    id: int
    name: str
    kind: ServiceKind
    category: ServiceCategory
    reach: ServiceReach
    icon: Optional[str] = None
    hosting: ServiceHosting
    status: StatusValue
    site_id: Optional[int] = None
    site_name: Optional[str] = None


class StatusRollupOut(BaseModel):
    sites: list[SiteRollup]
    services: list[ServiceRollup]


# --- Enclave source / ingest ---


class EnclaveSourceIn(BaseModel):
    name: str
    scoi_url: Optional[str] = None
    notes: Optional[str] = None


class EnclaveSourceOut(_ORM):
    id: int
    name: str
    scoi_url: Optional[str] = None
    last_contact_at: Optional[datetime.datetime] = None
    sync_status: str
    notes: Optional[str] = None


class EnclaveSourceCreated(BaseModel):
    enclave_source: EnclaveSourceOut
    ingest_token: str


class IngestService(BaseModel):
    name: str
    kind: ServiceKind = "other"
    hosting: ServiceHosting = "self"
    status: StatusValue = "unknown"
    site_name: Optional[str] = None


class IngestPayload(BaseModel):
    source_name: str
    ts: datetime.datetime
    services: list[IngestService] = Field(default_factory=list)


class IngestAck(BaseModel):
    accepted: bool
    enclave_source_id: int


# --- Status event ---


class StatusEventOut(_ORM):
    id: int
    ts: datetime.datetime
    subject_kind: SubjectKind
    subject_id: int
    old_state: Optional[StatusValue] = None
    new_state: StatusValue
    source: Literal["manual", "ingest"]
    actor_user_id: Optional[int] = None
    note: Optional[str] = None
