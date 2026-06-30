"""Pydantic v2 schemas for xcomm_hud API."""

from __future__ import annotations

import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

StatusValue = Literal["up", "degraded", "down", "unknown", "offline", "setup"]
ServiceKind = Literal["voip", "data", "video", "crypto", "other"]
ServiceCategory = Literal["core_critical_local", "sustainment", "other"]
ServiceReach = Literal["local", "external"]
GatewayKind = Literal["isp", "modem", "satellite", "other"]
UserRole = Literal["viewer", "operator", "admin"]
SubjectKind = Literal["service", "site", "gateway"]
Fpcon = Literal["normal", "alpha", "bravo", "charlie", "delta"]
Emcon = Literal["a", "b", "c", "d"]


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
    fpcon: Fpcon = "normal"
    emcon: Emcon = "a"
    show_fpcon: bool = True
    show_emcon: bool = True
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None


class SitePatch(BaseModel):
    name: Optional[str] = None
    location_label: Optional[str] = None
    fpcon: Optional[Fpcon] = None
    emcon: Optional[Emcon] = None
    show_fpcon: Optional[bool] = None
    show_emcon: Optional[bool] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None


class SiteOut(_ORM):
    id: int
    name: str
    location_label: Optional[str] = None
    fpcon: Fpcon
    emcon: Emcon
    show_fpcon: bool = True
    show_emcon: bool = True
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None
    status: StatusValue = "unknown"  # computed rollup (effective)


# --- Service template ---


class ServiceTemplateOut(_ORM):
    id: int
    name: str
    kind: ServiceKind
    category: ServiceCategory
    reach: ServiceReach
    icon: Optional[str] = None
    description: Optional[str] = None


# --- Service ---


class ServiceIn(BaseModel):
    name: str
    site_id: int
    kind: ServiceKind = "other"
    category: ServiceCategory = "other"
    reach: ServiceReach = "local"
    icon: Optional[str] = None
    description: Optional[str] = None
    status: StatusValue = "unknown"
    notes: Optional[str] = None


class ServicePatch(BaseModel):
    name: Optional[str] = None
    site_id: Optional[int] = None
    kind: Optional[ServiceKind] = None
    category: Optional[ServiceCategory] = None
    reach: Optional[ServiceReach] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class ServiceValidateIn(BaseModel):
    status: StatusValue
    note: Optional[str] = None
    validated_at: Optional[datetime.datetime] = None  # override; defaults to now


class ServiceOut(_ORM):
    id: int
    name: str
    site_id: int
    kind: ServiceKind
    category: ServiceCategory
    reach: ServiceReach
    icon: Optional[str] = None
    description: Optional[str] = None
    status: StatusValue
    effective_status: StatusValue = "unknown"  # cascaded; same as status for local
    validated_at: Optional[datetime.datetime] = None
    validated_by_user_id: Optional[int] = None
    validated_by_username: Optional[str] = None
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
    notes: Optional[str] = None


class GatewayValidateIn(BaseModel):
    status: StatusValue
    note: Optional[str] = None
    validated_at: Optional[datetime.datetime] = None  # override; defaults to now


class GatewayOut(_ORM):
    id: int
    site_id: int
    name: str
    kind: GatewayKind
    provider: Optional[str] = None
    status: StatusValue
    validated_at: Optional[datetime.datetime] = None
    validated_by_user_id: Optional[int] = None
    validated_by_username: Optional[str] = None
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


class CanvasAnnotationPatch(BaseModel):
    text: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None


class CanvasAnnotationOut(_ORM):
    id: int
    text: str
    x: float
    y: float


class MapBundle(BaseModel):
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
    fpcon: Fpcon
    emcon: Emcon
    show_fpcon: bool = True
    show_emcon: bool = True
    service_count: int
    gateway_count: int


class ServiceRollup(BaseModel):
    id: int
    name: str
    kind: ServiceKind
    category: ServiceCategory
    reach: ServiceReach
    icon: Optional[str] = None
    status: StatusValue
    effective_status: StatusValue
    site_id: int
    site_name: str
    validated_at: Optional[datetime.datetime] = None


class StatusRollupOut(BaseModel):
    sites: list[SiteRollup]
    services: list[ServiceRollup]


# --- Validation feed ---


class ValidationOut(_ORM):
    id: int
    validated_at: datetime.datetime
    subject_kind: SubjectKind
    subject_id: int
    subject_name: Optional[str] = None
    site_id: Optional[int] = None
    site_name: Optional[str] = None
    prev_status: Optional[StatusValue] = None
    status: StatusValue
    source: Literal["manual", "ingest"]
    validated_by_user_id: Optional[int] = None
    validated_by_username: Optional[str] = None
    note: Optional[str] = None


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
    status: StatusValue = "unknown"
    site_name: Optional[str] = None


class IngestPayload(BaseModel):
    source_name: str
    ts: datetime.datetime
    services: list[IngestService] = Field(default_factory=list)


class IngestAck(BaseModel):
    accepted: bool
    enclave_source_id: int
