"""SQLAlchemy 2.x declarative models for xcomm_hud."""

from __future__ import annotations

import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


SERVICE_STATUS_VALUES = ("up", "degraded", "down", "unvalidated", "offline", "setup")
GATEWAY_STATUS_VALUES = ("active", "ready", "degraded", "down", "offline", "setup")
SITE_STATUS_VALUES = (
    "operational",
    "limited",
    "degraded",
    "maintenance",
    "standby",
    "offline",
    "setup",
)
STATUS_VALUES = SERVICE_STATUS_VALUES  # legacy alias
SERVICE_KINDS = ("voice", "data", "other")
SERVICE_CATEGORIES = ("critical", "sustainment", "other")
SERVICE_REACH = ("local", "external")
GATEWAY_KINDS = ("milsat", "commercial", "other")
GATEWAY_PACE = ("primary", "alternate", "contingency", "emergency")
USER_ROLES = ("viewer", "operator", "admin")
VALIDATION_SOURCES = ("manual", "ingest")
# Subject kinds are declared once, in schemas.SubjectKind — this module used to
# carry a second copy that nothing read and nobody kept in sync.
EVENT_TYPES = ("validation", "general", "personnel")
# Every Event row is either a high-volume audit "log" or a briefing-worthy
# "event" — the timeline shows events, the audit view shows everything.
RECORD_CLASSES = ("log", "event")
SEVERITIES = ("info", "notice", "warning", "critical")
FPCON_LEVELS = ("normal", "alpha", "bravo", "charlie", "delta")
EMCON_LEVELS = ("a", "b", "c", "d")
SITE_PROPERTY_TYPES = (
    "text",
    "long_text",
    "number",
    "phone",
    "email",
    "url",
    "date",
    "bool",
)
SITE_PROPERTY_SOURCES = ("template", "custom")
PERSONNEL_TYPES = ("military", "civilian")
BRANCH_VALUES = (
    "air_force",
    "army",
    "navy",
    "marines",
    "space_force",
    "coast_guard",
)
# Location sign-in board — captures where each person is right now. "on_site"
# and "traveling" carry a site_id (present location / destination); the rest
# are site-less dispositions the person entered manually. The UI derives
# "at assigned site" vs "temporary" from current_site_id vs assigned_site_id,
# so there is no separate enum value for those.
PERSONNEL_STATUS_VALUES = (
    "unknown",
    "on_site",
    "traveling",
    "off_site",
    "out_of_office",
    "lunch",
    "leave",
    "sick",
    "training",
)
# Hard cap on a single document upload (enforced by the documents router).
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# ---------- Equipment tier ----------
# Broad shelf a piece of gear sits on. Drives the default icon and the default
# equipment-ID prefix (a radio becomes R<last4>, a crypto device K<last4>, ...).
EQUIPMENT_CATEGORIES = (
    "radio",
    "satcom",
    "crypto",
    "network",
    "compute",
    "power",
    "antenna",
    "cable",
    "other",
)
# What a box can *do*. Declared once per equipment_type in the catalog, then
# materialized onto each registered instance so an operator can drop the ones
# a particular kit doesn't have. A capability is the thing that binds to a
# service or a gateway — which is how one radio is simultaneously a service
# endpoint (voice, data) and a transport path (satcom_rf).
CAPABILITY_KINDS = (
    "voice",
    "data",
    "video",
    "satcom_rf",
    "los_rf",
    "routing",
    "switching",
    "crypto",
    "power",
    "other",
)
# Deliberately its own set rather than reusing SERVICE/GATEWAY statuses: gear
# goes to `maintenance`, services and gateways don't. Ranked in
# api/effective.py (EQUIPMENT_STATUS_RANK) for worst-of rollups.
EQUIPMENT_STATUS_VALUES = (
    "up",
    "degraded",
    "down",
    "maintenance",
    "offline",
    "unvalidated",
)
EQUIPMENT_LINK_KINDS = ("los", "satcom", "fiber", "cable", "wireless", "other")
# `a_to_b` is the extension shot (A feeds B); `bidirectional` is a peer trunk.
# The topology view derives primary-vs-extension from these.
EQUIPMENT_LINK_DIRECTIONS = ("bidirectional", "a_to_b")
# Operator's *declaration* of what a deployed UTC is for. The link graph
# derives the same thing independently; the view shows both so a disagreement
# between plan and reality is visible.
UTC_ROLES = ("primary", "extension", "independent")
# How a package definition expects one of its UTCs to be used.
UTC_ROLE_HINTS = ("primary", "extension", "either")
# `endpoint` = this box is where the service is delivered; `transport` = it
# only carries the service through.
CAPABILITY_BIND_ROLES = ("endpoint", "transport")
# Whether a capability row came from the type's declaration or was added by
# hand to this one instance.
CAPABILITY_SOURCES = ("template", "custom")


class Workspace(Base):
    """A container for one full operating picture (sites/services/gateways/canvas).

    Users switch between workspaces to plan upcoming exercises, look back at
    past missions, or maintain a garrison baseline separate from mission
    layouts. Tags are freeform strings (e.g. "garrison", "exercise", "archived")
    and are used by the UI switcher for grouping — no server-side state machine.
    """

    __tablename__ = "workspace"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    # URL-safe identifier generated once at creation from the name. Slug is
    # frozen after creation — this keeps shared links stable when workspaces
    # are renamed.
    slug: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="viewer")
    disabled_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    current_workspace_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class Site(Base):
    __tablename__ = "site"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_site_workspace_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    location_label: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="operational"
    )
    fpcon: Mapped[str] = mapped_column(String(16), nullable=False, default="normal")
    emcon: Mapped[str] = mapped_column(String(8), nullable=False, default="a")
    show_fpcon: Mapped[bool] = mapped_column(default=True, nullable=False)
    show_emcon: Mapped[bool] = mapped_column(default=True, nullable=False)
    lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    # A site holds DELIVERIES now, not services — a service outlives any one
    # site, so the old `site.services` had the ownership backwards.
    deliveries: Mapped[list["ServiceDelivery"]] = relationship(
        "ServiceDelivery", back_populates="site"
    )
    gateways: Mapped[list["Gateway"]] = relationship(
        "Gateway", back_populates="site", cascade="all, delete-orphan"
    )
    canvas_position: Mapped[Optional["SiteCanvasPosition"]] = relationship(
        "SiteCanvasPosition",
        back_populates="site",
        uselist=False,
        cascade="all, delete-orphan",
    )


class ScoiSource(Base):
    __tablename__ = "scoi_source"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    scoi_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ingest_token_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_contact_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sync_status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class ServiceTemplate(Base):
    __tablename__ = "service_template"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    category: Mapped[str] = mapped_column(String(24), nullable=False, default="other")
    reach: Mapped[str] = mapped_column(String(16), nullable=False, default="local")
    icon: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Where the NIPR/SIPR distinction actually lived before `enclave` existed:
    # as a prefix on `name` plus an icon choice. Services created from a
    # template inherit this. Nullable — plenty of templates serve no single one.
    enclave_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("enclave.id", ondelete="SET NULL"), nullable=True
    )
    # null = all 6 status values allowed; otherwise restricts the picker.
    allowed_statuses: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)


class Service(Base):
    """WHAT a service is, once per workspace — not where you can get it.

    "NIPR Web" is one row even when three sites deliver it. That is the whole
    point of the split: `site_id` used to live here and be NOT NULL, which made
    a service's identity inseparable from one location. Every symptom followed
    from that single column — equipment serving two sites had nowhere to bind,
    an extension had to be modelled as its own UTC to give its gear a site, and
    two sites' "NIPR Web" were unrelated rows that could not be asked "is NIPR
    up anywhere?".

    Identity attributes live here (what the thing IS). Anything that can
    legitimately differ per location lives on ServiceDelivery — see the note
    there about `enabled_pace`, which real data already disagreed on.

    Uniqueness is (workspace, enclave, name) with NULLS NOT DISTINCT, so two
    enclave-less services of the same name collapse rather than splitting on a
    NULL that SQL would otherwise treat as never-equal.
    """

    __tablename__ = "service"
    __table_args__ = (
        Index(
            "uq_service_workspace_enclave_name",
            "workspace_id",
            "enclave_id",
            "name",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # Direct, where it used to be reached through `site`. A service no longer
    # has one site to inherit a workspace from.
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    service_template_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("service_template.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    category: Mapped[str] = mapped_column(String(24), nullable=False, default="other")
    icon: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Which network this service is on. Copied from the template at creation,
    # editable after. Retires `name` as the only signal — "NIPR Web" keeps its
    # name, but nothing has to parse it to know which network it is.
    enclave_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("enclave.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    deliveries: Mapped[list["ServiceDelivery"]] = relationship(
        "ServiceDelivery", back_populates="service", cascade="all, delete-orphan"
    )


class ServiceDelivery(Base):
    """WHERE a service is delivered, and what its status is THERE.

    This table is the old `service` row: same id values, carried across by
    migration 0054 precisely so `capability_service_link` and
    `service_gateway_status` only had to rename a column rather than remap
    every foreign key. Anything holding a pre-0054 "service id" is really
    holding a delivery id, and still resolves correctly.

    Status lives here, not on Service. A rollup across deliveries is a derived
    question ("is NIPR up anywhere?") and deliberately not a stored column —
    storing it would need a cascade, and every status in this system is
    attributed to whoever validated it at a place.

    `enabled_pace` and `reach` are here rather than on Service because real
    data already disagreed: VoIP at one site enabled three PACE tiers and the
    same service at another enabled four. Gateways are per-site, so the PACE
    matrix could not work any other way.
    """

    __tablename__ = "service_delivery"
    __table_args__ = (
        UniqueConstraint("service_id", "site_id", name="uq_delivery_service_site"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    service_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("service.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # `local` = delivered by gear at this site. `extended` = reached from
    # another site over a shot. Descriptive; nothing branches on it yet.
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="local")
    reach: Mapped[str] = mapped_column(String(16), nullable=False, default="local")
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unvalidated"
    )
    validated_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    validated_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Which PACE tiers this delivery uses. Defaults to all four (full fan-out =
    # previous behavior). Operators clear PACE letters it can't use.
    enabled_pace: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=lambda: ["primary", "alternate", "contingency", "emergency"],
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    service: Mapped["Service"] = relationship("Service", back_populates="deliveries")
    site: Mapped["Site"] = relationship("Site", back_populates="deliveries")


class Gateway(Base):
    __tablename__ = "gateway"
    __table_args__ = (
        UniqueConstraint("site_id", "name", name="uq_gateway_site_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    provider: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    # `ready`, matching GatewayIn — NOT the seed value the other tiers use.
    # GATEWAY_STATUS_VALUES has never contained one, so this column defaulted
    # to a string its own output schema rejects; nothing reached it because the
    # API always supplies a status, but any direct Gateway() would have written
    # a row that fails on read. A gateway's "nothing said yet" is PACE standby.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ready")
    pace: Mapped[str] = mapped_column(String(16), nullable=False, default="primary")
    validated_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    validated_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    site: Mapped["Site"] = relationship("Site", back_populates="gateways")


class ServiceGatewayStatus(Base):
    """Per-(service, gateway) reachability cell backing the matrix view.

    One row per intersection where a service's enabled_pace matches a
    gateway's pace. The API materializes missing rows on read/write and
    seeds them to `unvalidated` (needs validation). Cascade rules in
    api/effective.py drive how a gateway or local service status change
    propagates here — but only when the validation dialog leaves
    "cascade to cells" checked. Manual cell writes enforce R11 (cell
    cannot exceed local service status) and the R10 down/offline lock
    as hard invariants regardless of the cascade flag.
    """

    __tablename__ = "service_gateway_status"

    # A cell is (delivery × gateway), not (service × gateway): gateways belong
    # to a site, so a cell only ever meant "this service AT THIS SITE over that
    # path". The column was renamed in 0054 and the values were already correct
    # — delivery ids reuse the old service ids.
    service_delivery_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("service_delivery.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # Composite PK covers service-side lookups; a separate index on
    # gateway_id keeps "find every cell for this gateway" fast when a
    # gateway status change cascades.
    gateway_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("gateway.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unvalidated"
    )
    validated_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    validated_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class SiteCanvasPosition(Base):
    __tablename__ = "site_canvas_position"

    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), primary_key=True
    )
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    site: Mapped["Site"] = relationship("Site", back_populates="canvas_position")


class CanvasAnnotation(Base):
    __tablename__ = "canvas_annotation"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class SitePropertyTemplate(Base):
    """A named set of typed property fields that can be applied to sites.

    Templates are workspace-scoped so operators can maintain distinct sets
    per exercise/garrison. Applying a template to a site copies its
    definitions into `SiteProperty` rows — the site then owns its schema
    and can diverge (add custom fields, edit labels, etc).
    """

    __tablename__ = "site_property_template"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "name", name="uq_site_property_template_workspace_name"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Ordered list of group (section) names for this template. Definitions
    # still store their group as a freeform string; this column controls the
    # section render order and lets the UI keep an empty section around
    # between edits.
    group_order: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    definitions: Mapped[list["SitePropertyDefinition"]] = relationship(
        "SitePropertyDefinition",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="SitePropertyDefinition.display_order",
    )


class SitePropertyDefinition(Base):
    """One field on a `SitePropertyTemplate` — the schema, not a value."""

    __tablename__ = "site_property_definition"
    __table_args__ = (
        UniqueConstraint(
            "template_id", "key", name="uq_site_property_definition_template_key"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("site_property_template.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    group: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    template: Mapped["SitePropertyTemplate"] = relationship(
        "SitePropertyTemplate", back_populates="definitions"
    )


class SiteProperty(Base):
    """A property + value belonging to a specific site.

    Definitions are copied here on template apply so each site owns its own
    schema. `source` records whether the field came from a template or was
    added ad-hoc — used only for UI hinting today, no behavior hangs off it.
    Values are stored as JSON so scalar types (text/number/bool/date/etc)
    can share one column without a discriminated schema.
    """

    __tablename__ = "site_property"
    __table_args__ = (
        UniqueConstraint("site_id", "key", name="uq_site_property_site_key"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("site.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    group: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    value = mapped_column(JSONB, nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="custom")


class Event(Base):
    """Append-only audit of every status change.

    One row per event: who said *this* subject is in *this* state at
    *this* time, with optional notes. Drives the reporting feed and history view.
    Table name stays `validation` for compatibility with other API instances
    running against the same shared postgres.
    """

    __tablename__ = "validation"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="validation"
    )
    # Workspace the record belongs to, denormalized at write time so the
    # feed can be scoped without joining through the subject. Nullable for
    # legacy rows whose subject no longer resolves.
    workspace_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # "log" = routine audit record; "event" = significant occurrence worth
    # surfacing on the timeline and in summaries.
    record_class: Mapped[str] = mapped_column(
        String(8), nullable=False, default="log"
    )
    severity: Mapped[str] = mapped_column(
        String(12), nullable=False, default="info"
    )
    # Specific action or catalog type that produced this row, e.g.
    # "service.validate" (registry) or "exercise.startex" (EventTypeDef).
    type_slug: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )
    validated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, index=True
    )
    subject_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    # For paired subjects like (service, gateway) cell validations — the
    # gateway id lives here so history can be scoped to a single cell.
    second_subject_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True, index=True
    )
    subject_label: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    prev_status: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    validated_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    edited_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    hidden_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    hidden_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )


class EventTypeDef(Base):
    """A declarable event type users pick (or create) when logging manually.

    Global rows (workspace_id NULL) are the seeded baseline vocabulary
    (STARTEX, safety brief, ...) available in every workspace; workspace
    rows are custom types defined in-app for one exercise. Retiring is a
    soft-delete so historical events keep resolving their type.
    """

    __tablename__ = "event_type_def"
    __table_args__ = (
        UniqueConstraint("workspace_id", "slug", name="uq_event_type_def_ws_slug"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Free-form grouping for pickers and the management page ("Exercise",
    # "Briefing", ...). Null renders under "Other".
    category: Mapped[Optional[str]] = mapped_column(String(48), nullable=True)
    record_class: Mapped[str] = mapped_column(
        String(8), nullable=False, default="event"
    )
    default_severity: Mapped[str] = mapped_column(
        String(12), nullable=False, default="notice"
    )
    # Lucide icon name and hex accent color for timeline/badge rendering.
    icon: Mapped[Optional[str]] = mapped_column(String(48), nullable=True)
    color: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    # Which subject_kinds an event of this type may attach to.
    allowed_subject_kinds: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # System types are the vocabulary of automatic records (validations,
    # sign-ins, posture changes) — shown in the catalog and pickable in
    # rule actions, but hidden from the manual "Log event" type picker.
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    retired_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class Rule(Base):
    """An event-condition-action rule evaluated when a trigger fires.

    Domain mutations emit typed triggers (service.status_changed, ...);
    the engine (api/rules_engine.py) matches enabled rules by trigger,
    enriches the payload with the rule's named enrichers, evaluates the
    stored condition tree, and runs the action list — all synchronously
    inside the mutation's transaction so effects commit (or roll back)
    together. Global rows (workspace_id NULL, is_builtin) are the seeded
    system behavior; workspace rows are user-defined.
    """

    __tablename__ = "rule"
    __table_args__ = (
        # A global (workspace_id NULL) built-in is identified by its stable
        # `key` — the handle the startup reconcile matches on. At most one
        # global row per key; workspace rules leave `key` NULL.
        Index(
            "uq_rule_global_key",
            "key",
            unique=True,
            postgresql_where=text("workspace_id IS NULL AND key IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # Stable identity for global built-in rules, owned by api/default_rules.py.
    # NULL for workspace rules. The reconcile upserts globals by this key.
    key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Definition version for global built-ins: the reconcile only overwrites a
    # stored row when the code's version is higher, so unchanged rows and
    # per-workspace state are never churned. Irrelevant for workspace rules.
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    trigger: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # jsonlogic-subset predicate tree; null = always fire.
    conditions = mapped_column(JSONB, nullable=True)
    # Named enrichers applied to the payload before condition evaluation.
    enrichers: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    # Computed fields derived after enrichment, in order (later fields may
    # reference earlier ones): [{"name", "kind": "template"|"expr",
    # "template"?, "expr"?}, ...]. Available to conditions and actions.
    computed = mapped_column(JSONB, nullable=False, default=list)
    # Ordered [{"action": name, "params": {...}}, ...] — each receives the
    # same enriched context (no inter-action piping in v1).
    actions = mapped_column(JSONB, nullable=False, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # "abort" re-raises action errors (rolls back the whole mutation —
    # used by the seeded record-keeping rules to preserve dual-write
    # atomicity); "skip" logs the failure and lets the mutation commit.
    on_error: Mapped[str] = mapped_column(String(8), nullable=False, default="skip")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class RuleExecution(Base):
    """Per-fire audit of the rules engine, for debugging from the UI.

    One row per rule whose trigger matched AND condition passed (condition
    misses aren't logged — too chatty). `context` is a trimmed snapshot of
    the enriched payload the actions received.
    """

    __tablename__ = "rule_execution"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("rule.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workspace_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=True,
    )
    trigger: Mapped[str] = mapped_column(String(64), nullable=False)
    fired_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, index=True
    )
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="ok")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    context = mapped_column(JSONB, nullable=True)


class WorkspaceRuleState(Base):
    """Per-workspace overlay on a global built-in rule.

    Global rules (workspace_id NULL, is_builtin) are code-owned and fire
    across every workspace. A workspace can't edit them, but it can turn one
    off for itself — that override lives here, one row per (workspace, rule),
    instead of mutating the shared row. To customize behavior, operators
    duplicate the global into an editable workspace rule.
    """

    __tablename__ = "workspace_rule_state"
    __table_args__ = (
        UniqueConstraint("workspace_id", "rule_id", name="uq_workspace_rule_state"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    rule_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("rule.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    disabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class Unit(Base):
    """A military unit / organization (squadron, wing, group, ...) for chain of command.

    Distinct from WorkCenter (physical/functional workshop) — a person may
    belong to the 375th Communications Squadron (Unit) while working in the
    "Radio Shop" (WorkCenter). Unit primarily applies to military members
    but is available for civilians too. `parent_unit_id` is a self-reference
    to model the org hierarchy (e.g. squadron → group → wing).
    """

    __tablename__ = "unit"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_unit_workspace_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Service branch of the organization — prepopulates a new member's branch
    # in the personnel form once their unit is picked.
    branch: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    # At most one per workspace (partial unique index) — preselected when
    # adding personnel.
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    parent_unit_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("unit.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class WorkCenter(Base):
    """A logical grouping of personnel (and later, equipment) within a workspace.

    Work centers are the physical/functional bucket a person belongs to — one
    person to one work center. Distinct from Unit (military org) and Team
    (many-to-many overlay for ad-hoc collaboration across work centers).
    """

    __tablename__ = "work_center"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_work_center_workspace_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class Team(Base):
    """A many-to-many overlay grouping personnel from across work centers.

    Teams are ad-hoc — a person can belong to multiple teams. `color` is a
    hex string used by the UI for pill accents; null falls back to a neutral.
    `slug` is a short code ("FCP1") for compact display; `ncoic_id` is the
    team's NCOIC (SET NULL so a departing NCOIC doesn't remove the team).
    """

    __tablename__ = "team"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_team_workspace_name"),
        UniqueConstraint("workspace_id", "slug", name="uq_team_workspace_slug"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    color: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    ncoic_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("personnel.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    leads: Mapped[list["TeamWorkCenterLead"]] = relationship(
        "TeamWorkCenterLead",
        cascade="all, delete-orphan",
        order_by="TeamWorkCenterLead.work_center_id",
    )


class Personnel(Base):
    """A person assigned to this workspace's roster.

    Covers both uniformed members and DoD civilians. For civilians the
    `branch` field records the service they support (rank is optional or
    a GS grade). Contact fields are all optional so a partial CSV import
    doesn't reject rows.
    """

    __tablename__ = "personnel"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    personnel_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="military"
    )
    # Guests / visitors are flagged so they can be signed in and tracked like
    # anyone else (on-site list, accountability, check-out) while staying out of
    # the permanent roster. `affiliation` is their org/unit, `escort` the on-site
    # point of contact hosting them.
    is_guest: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Unit commander/OIC — at most one per unit (partial unique index), and
    # only meaningful with a unit set (the API rejects a unitless commander).
    # Marked with a gold star wherever the person's name is rendered.
    is_commander: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    affiliation: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    escort: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    branch: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    rank: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    # AFSC skill level for Air Force enlisted members (1 Helper, 3 Apprentice,
    # 5 Journeyman, 7 Craftsman, 9 Superintendent). Optional and only
    # meaningful for enlisted ranks.
    skill_level: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    last_name: Mapped[str] = mapped_column(String(64), nullable=False)
    first_name: Mapped[str] = mapped_column(String(64), nullable=False)
    cellphone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    dsn: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    sipr_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    work_center_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("work_center.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    unit_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("unit.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Direct supervisor for chain-of-command display. SET NULL on delete so
    # a departing supervisor doesn't cascade-remove their reports.
    supervisor_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("personnel.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    assigned_site_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("site.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    room_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    # Current sign-in status. Denormalized from the latest
    # PersonnelLocationEvent row so list pages don't have to join.
    current_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="unknown"
    )
    current_site_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("site.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    current_status_since: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    current_status_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Optional accountability timer — when the person expects to be back at
    # their assigned site / available again. Past this with no new check-in =
    # overdue (the UI flags it red).
    expected_return_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    teams: Mapped[list["Team"]] = relationship(
        "Team",
        secondary="personnel_team",
        backref="personnel",
    )


class PersonnelLocationEvent(Base):
    """Append-only history of every personnel sign-in/out.

    Latest row for a person also seeds `Personnel.current_*` for fast reads.
    `site_id` is only populated when `status == "on_site"`.
    """

    __tablename__ = "personnel_location_event"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    personnel_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("personnel.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    site_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("site.id", ondelete="SET NULL"),
        nullable=True,
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expected_return_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    changed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, index=True
    )
    changed_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )


class PersonnelTeam(Base):
    """Join row for the many-to-many between Personnel and Team."""

    __tablename__ = "personnel_team"

    personnel_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("personnel.id", ondelete="CASCADE"),
        primary_key=True,
    )
    team_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("team.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )


class Folder(Base):
    """A folder in the document library tree.

    Folders are workspace-scoped; `site_id` NULL means the workspace-level
    library, non-NULL scopes the folder to one site's document tab. The tree
    shape lives entirely in `parent_id` — the API returns flat lists and the
    UI assembles the hierarchy.
    """

    __tablename__ = "folder"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "site_id", "parent_id", "name", name="uq_folder_scope_name"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    site_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("site.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    parent_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("folder.id", ondelete="CASCADE"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class Document(Base):
    """Metadata for one uploaded file; the bytes live in object storage.

    `storage_key` is the S3 key (unique — one object per row). Deleting a
    folder leaves its documents in place (folder_id SET NULL) so files are
    never silently lost with their container.

    File columns (filename/content_type/size_bytes/storage_key) are
    denormalized copies of the CURRENT version's fields; the full history
    lives in `document_version` and `current_version_id` says which row is
    live (not necessarily the newest — Restore repoints it).
    """

    __tablename__ = "document"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    site_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("site.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    folder_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("folder.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_key: Mapped[str] = mapped_column(
        String(1024), nullable=False, unique=True
    )
    # Soft cycle with document_version.document_id — nullable and set after
    # flush, so inserts never deadlock on each other.
    current_version_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("document_version.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class DocumentVersion(Base):
    """One immutable uploaded file for a document.

    Every upload — including the document's original — gets a row with a
    sequential per-document `version_no` and its own unique `storage_key`.
    Rows are never mutated; the document's denormalized file columns point
    at whichever row `document.current_version_id` selects.
    """

    __tablename__ = "document_version"
    __table_args__ = (
        UniqueConstraint("document_id", "version_no", name="uq_document_version_no"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("document.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_key: Mapped[str] = mapped_column(
        String(1024), nullable=False, unique=True
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class TeamWorkCenterLead(Base):
    """A team's designated lead for one work center.

    Leads are scoped per team — FCP1's Tech Control lead can differ from
    FCP2's. Rows cascade away with the team, the work center, or the person.
    """

    __tablename__ = "team_work_center_lead"

    team_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("team.id", ondelete="CASCADE"),
        primary_key=True,
    )
    work_center_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("work_center.id", ondelete="CASCADE"),
        primary_key=True,
    )
    personnel_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("personnel.id", ondelete="CASCADE"),
        nullable=False,
    )


class DocPage(Base):
    """A documentation page authored in-app; markdown lives in `content`.

    The Knowledge Hub is global — every page is shared across all workspaces.
    The nav hierarchy lives in `parent_id` + `display_order`; the API returns a
    flat list and the UI assembles the tree. URLs are flat (`/docs/<slug>`), so
    slugs are globally unique.
    """

    __tablename__ = "doc_page"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_doc_page_slug"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("doc_page.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Optional top-level grouping (the section switcher). NULL = the implicit
    # "General" section.
    section_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("doc_section.id", ondelete="SET NULL"),
        nullable=True,
    )
    slug: Mapped[str] = mapped_column(String(160), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class DocSection(Base):
    """A top-level grouping for doc pages (the Knowledge Hub section switcher).

    Sections are global — shared across all workspaces, like the pages they
    hold. Pages reference a section via `doc_page.section_id`; a NULL
    section_id means the implicit "General" section that always exists in the
    UI.
    """

    __tablename__ = "doc_section"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_doc_section_slug"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(160), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Lucide icon name for the section switcher (optional).
    icon: Mapped[Optional[str]] = mapped_column(String(48), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


# ===================== Enclaves =====================


class Enclave(Base):
    """A network an operator would name out loud — NIPR, SIPR, ACBN, BICES.

    This existed as a convention long before it existed as a table: seeded
    service names ("NIPR Web" vs "SIPR Web"), an icon choice, and hand-written
    capability labels ("SIPR data"). Convention was enough until behavior needed
    to hang off it — the deploy wizard cannot tell two `kind="data"` services
    apart, and "we're leaving the SIPR stack home" had no way to be said in one
    action. That is the signal a tag deserves a real column, per 0044.

    Nested via `parent_id` the same way Folder and DocPage do it: FK only, no
    self-relationship, flat list from the API, tree assembled in the UI.
    Transport sits at the top with no parent and no color; NIPR and SIPR hang
    off it; ACBN and BICES hang off those.

    NOT DEFINED BY a classification level, but it may HAVE one. An enclave and a
    classification answer different questions — a `SECRET` marking and "is on
    SIPR" are not the same fact, and gear moves between enclaves without its
    markings changing. `classification` is descriptive metadata for display: it
    records what an enclave is generally understood to carry (SIPR is secret,
    Transport declares nothing at all). Nothing may branch on it.

    So the original rule still stands where it counts: there is deliberately no
    ordering, no severity, no ranking of enclaves by classification, and no link
    to the `--classification-surface` banner tints. Giving the column any of
    those turns this into a different feature.
    """

    __tablename__ = "enclave"
    __table_args__ = (
        Index(
            "uq_enclave_global_name",
            "name",
            unique=True,
            postgresql_where=text("workspace_id IS NULL"),
        ),
        UniqueConstraint("workspace_id", "name", name="uq_enclave_workspace_name"),
        CheckConstraint("parent_id <> id", name="ck_enclave_parent_not_self"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # SET NULL, not CASCADE: retiring a parent should orphan its children to the
    # top level, never delete the enclave rows that gear is tagged with.
    parent_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("enclave.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    short_name: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    # Hex string, matching EventTypeDef.color and Team.color. Null on purpose
    # for the transport layer, which operators describe as having no color.
    color: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    # What this enclave is generally understood to carry. A static vocabulary
    # (schemas.Classification), not a managed lookup table — the levels are
    # stable. Nullable because an enclave need not declare one: Transport
    # realistically has none. Display only; see the class docstring.
    classification: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Soft delete: tagged equipment and services hold FKs to these rows.
    retired_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


# ===================== Equipment: catalog =====================
# Catalog rows follow the same global-vs-workspace pattern as Rule and
# EventTypeDef: `workspace_id IS NULL` means a globally-seeded, admin-managed
# row (NSNs and UTC composition are service-wide facts, not workspace
# opinions); a non-null workspace_id is a local addition.


class EquipmentType(Base):
    """A model of gear in the catalog — "AN/PRC-117G", not a specific radio.

    Nobody says the title out loud, so `short_name` ("117G") and `aliases`
    (["117G", "radio"]) are first-class and both are searched.
    """

    __tablename__ = "equipment_type"
    __table_args__ = (
        Index(
            "uq_equipment_type_global_title",
            "title",
            unique=True,
            postgresql_where=text("workspace_id IS NULL"),
        ),
        UniqueConstraint(
            "workspace_id", "title", name="uq_equipment_type_workspace_title"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    short_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Free-list of what people actually call it. Matched by GET /equipment?search=.
    aliases: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    # Operator-defined facets ("cci", "hand-receipt", "low-power"). Free-form on
    # purpose: the fixed fields above cover what the system reasons about, and
    # this covers everything a unit tracks that we shouldn't model for them.
    # Lowercased on the way in so filtering stays case-insensitive.
    tags: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    nsn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    lin: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    category: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    # False = tracked as a bulk quantity (equipment_holding), not per serial.
    serialized: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Prefix for the generated equipment ID: "R" + last 4 of serial = R7421.
    id_prefix: Mapped[str] = mapped_column(String(4), nullable=False, default="R")
    manufacturer: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    icon: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Soft delete — retired types stay resolvable for existing instances.
    retired_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    capabilities: Mapped[list["EquipmentTypeCapability"]] = relationship(
        "EquipmentTypeCapability",
        back_populates="equipment_type",
        cascade="all, delete-orphan",
        order_by="EquipmentTypeCapability.display_order",
    )
    enclave_links: Mapped[list["EquipmentTypeEnclave"]] = relationship(
        "EquipmentTypeEnclave",
        cascade="all, delete-orphan",
    )


class EquipmentTypeEnclave(Base):
    """Which enclaves a model of gear is *capable* of serving.

    The catalog/instance split again, same as capabilities: the type declares
    what's possible, the instance records what's actually true. A switch type
    may be capable of NIPR and SIPR; each physical switch is assigned exactly
    one via `equipment.enclave_id`, because crypto separation means a box
    serves one network at a time.

    An empty list means unrestricted, not "capable of nothing" — the same
    convention the rest of the catalog uses. Declaring nothing shouldn't stop
    an operator from tagging gear.
    """

    __tablename__ = "equipment_type_enclave"
    __table_args__ = (
        UniqueConstraint(
            "equipment_type_id", "enclave_id", name="uq_equipment_type_enclave"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    equipment_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("equipment_type.id", ondelete="CASCADE"), nullable=False
    )
    enclave_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("enclave.id", ondelete="CASCADE"), nullable=False
    )


class EquipmentTypeCapability(Base):
    """What this model of gear can do, declared once in the catalog.

    Registering an instance copies these into `equipment_capability` rows the
    operator can then edit or delete per kit.
    """

    __tablename__ = "equipment_type_capability"
    __table_args__ = (
        UniqueConstraint(
            "equipment_type_id",
            "kind",
            "label",
            name="uq_equipment_type_capability_kind_label",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    equipment_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("equipment_type.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    label: Mapped[str] = mapped_column(String(96), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Unchecked capabilities are offered in the register/deploy wizard but not
    # created by default (e.g. an optional LOS antenna kit).
    materialize_by_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )

    equipment_type: Mapped["EquipmentType"] = relationship(
        "EquipmentType", back_populates="capabilities"
    )


class UtcDef(Base):
    """A Unit Type Code definition — the authorized bill of materials."""

    __tablename__ = "utc_def"
    __table_args__ = (
        Index(
            "uq_utc_def_global_code",
            "code",
            unique=True,
            postgresql_where=text("workspace_id IS NULL"),
        ),
        UniqueConstraint("workspace_id", "code", name="uq_utc_def_workspace_code"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retired_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    lines: Mapped[list["UtcDefLine"]] = relationship(
        "UtcDefLine",
        back_populates="utc_def",
        cascade="all, delete-orphan",
        order_by="UtcDefLine.display_order",
    )


class UtcDefLine(Base):
    """One line item of a UTC's bill of materials.

    Serialized-vs-bulk is not stored here — it comes from
    `equipment_type.serialized`, so a type can never disagree with itself
    across two UTCs.
    """

    __tablename__ = "utc_def_line"
    __table_args__ = (
        # Once per type PER ENCLAVE: a UTC can bring two NIPR switches and two
        # SIPR switches, and those have to be separate lines or the wizard
        # can't drop one enclave's stack without dropping the other's.
        UniqueConstraint(
            "utc_def_id",
            "equipment_type_id",
            "enclave_id",
            name="uq_utc_def_line_type_enclave",
        ),
        # NULLs are distinct in a UNIQUE constraint, so the untagged slice
        # needs its own guard — that case really is a duplicate.
        Index(
            "uq_utc_def_line_type_no_enclave",
            "utc_def_id",
            "equipment_type_id",
            unique=True,
            postgresql_where=text("enclave_id IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    utc_def_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("utc_def.id", ondelete="CASCADE"), nullable=False
    )
    equipment_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("equipment_type.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Which enclave's stack this line belongs to. This is what lets the deploy
    # wizard drop a whole enclave in one action instead of row by row.
    enclave_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("enclave.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    utc_def: Mapped["UtcDef"] = relationship("UtcDef", back_populates="lines")


class PackageDef(Base):
    """A high-level package definition (FCP, etc.) composed of UTCs."""

    __tablename__ = "package_def"
    __table_args__ = (
        Index(
            "uq_package_def_global_code",
            "code",
            unique=True,
            postgresql_where=text("workspace_id IS NULL"),
        ),
        UniqueConstraint("workspace_id", "code", name="uq_package_def_workspace_code"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retired_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    utcs: Mapped[list["PackageDefUtc"]] = relationship(
        "PackageDefUtc",
        back_populates="package_def",
        cascade="all, delete-orphan",
        order_by="PackageDefUtc.display_order",
    )


class PackageDefUtc(Base):
    """Which UTCs a package definition is built from, and in what role."""

    __tablename__ = "package_def_utc"
    __table_args__ = (
        UniqueConstraint(
            "package_def_id", "utc_def_id", name="uq_package_def_utc_pair"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    package_def_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("package_def.id", ondelete="CASCADE"), nullable=False
    )
    utc_def_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("utc_def.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Seeds the deploy wizard's role picker; not a constraint.
    role_hint: Mapped[str] = mapped_column(String(16), nullable=False, default="either")
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    package_def: Mapped["PackageDef"] = relationship(
        "PackageDef", back_populates="utcs"
    )


# ===================== Equipment: deployed instances =====================


class PackageInstance(Base):
    """A deployed package. Deliberately NOT site-scoped — an FCP spans sites,
    which is the whole point of the extension topology."""

    __tablename__ = "package_instance"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_package_instance_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    package_def_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("package_def.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class UtcInstance(Base):
    """A UTC deployed to a site.

    `role` is the operator's declaration (what was planned). The topology
    view independently derives primary-vs-extension from the equipment_link
    graph and shows both, so plan-vs-reality drift is visible rather than
    silently resolved.

    `site_id` is the HOME site — where this UTC is accountable — not the
    authority on where its gear is. Equipment carries its own `site_id`, and a
    UTC that shoots to a second location legitimately has gear at both; the
    API derives that spread (`UtcInstanceOut.site_ids`) rather than reading it
    off this column. Standing up a separate "extension" UTC to hold the far
    end is a workaround for a UI limit, not something the model requires.
    """

    __tablename__ = "utc_instance"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_utc_instance_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    package_instance_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("package_instance.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    utc_def_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("utc_def.id", ondelete="SET NULL"), nullable=True
    )
    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="independent")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class UtcInstanceLine(Base):
    """What this deployed UTC was planned to carry — one row per type.

    Snapshotted at deploy from what the operator actually confirmed, NOT copied
    from `utc_def_line`. A UTC routinely ships without the stack for a network
    enclave the team isn't supporting, and those omissions are deliberate:
    measuring completeness against doctrine would report them as shortfalls
    forever, which trains people to ignore the indicator.

    This is the middle layer of the same plan-vs-reality split `role` and
    `derived_role` already use on UtcInstance: doctrine (`utc_def_line`), what
    we meant to bring (here), what is actually present (`equipment` rows and
    `equipment_holding` quantities). A snapshot rather than a pointer at def
    lines, because defs stay editable and `utc_def_id` is nullable-on-delete —
    a later catalog edit must not silently rewrite what a past deployment
    expected.

    Editable after deploy: "we're leaving the SIPR stack home" is sometimes
    decided mid-mission, not at the wizard.
    """

    __tablename__ = "utc_instance_line"
    __table_args__ = (
        UniqueConstraint(
            "utc_instance_id",
            "equipment_type_id",
            "enclave_id",
            name="uq_utc_instance_line_type_enclave",
        ),
        Index(
            "uq_utc_instance_line_type_no_enclave",
            "utc_instance_id",
            "equipment_type_id",
            unique=True,
            postgresql_where=text("enclave_id IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    utc_instance_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("utc_instance.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    equipment_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("equipment_type.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Snapshotted alongside the line, like everything else here: the enclave a
    # line served at deploy time, so a later catalog edit can't rewrite what a
    # past deployment expected.
    enclave_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("enclave.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class Equipment(Base):
    """One serialized piece of gear.

    NOTE the column naming: `equipment_code` is the human-facing "equipment
    ID" (R7421 — prefix plus last 4 of the serial). It is deliberately NOT
    called `equipment_id`, because every foreign key in this file that points
    at this table is named `equipment_id`, and having that mean two different
    things would be a standing footgun. The UI labels it "Equipment ID".

    `site_id` is denormalized from the UTC on purpose: gear can sit at a site
    without belonging to a deployed UTC, and every topology query filters by
    site.
    """

    __tablename__ = "equipment"
    __table_args__ = (
        UniqueConstraint("workspace_id", "equipment_code", name="uq_equipment_code"),
        Index(
            "uq_equipment_serial",
            "workspace_id",
            "serial_number",
            unique=True,
            postgresql_where=text("serial_number IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    equipment_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("equipment_type.id", ondelete="RESTRICT"), nullable=False
    )
    utc_instance_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("utc_instance.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # One piece of gear serves exactly one enclave. Nullable because plenty of
    # gear serves none — power, cables, and the RF shot are common to all of
    # them. SET NULL so retiring an enclave never deletes equipment.
    enclave_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("enclave.id", ondelete="SET NULL"), nullable=True
    )
    equipment_code: Mapped[str] = mapped_column(String(32), nullable=False)
    serial_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unvalidated")
    validated_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    validated_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    capabilities: Mapped[list["EquipmentCapability"]] = relationship(
        "EquipmentCapability",
        back_populates="equipment",
        cascade="all, delete-orphan",
        order_by="EquipmentCapability.display_order",
    )


class EquipmentHolding(Base):
    """The unserialized tier — bulk gear counted per deployed UTC.

    Serialized items get their own `equipment` row; everything else (cables,
    connectors, batteries) is a quantity here.
    """

    __tablename__ = "equipment_holding"
    __table_args__ = (
        UniqueConstraint(
            "utc_instance_id", "equipment_type_id", name="uq_equipment_holding_type"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    utc_instance_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("utc_instance.id", ondelete="CASCADE"), nullable=False
    )
    equipment_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("equipment_type.id", ondelete="RESTRICT"), nullable=False
    )
    authorized_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    on_hand_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class EquipmentCapability(Base):
    """A capability materialized onto one specific piece of gear.

    Copied from the type's declaration at registration, then editable — an
    operator can delete `los_rf` from a kit that shipped without the antenna.
    Carries its own status so a radio with a dead data port but working voice
    is expressible, which a single status field on `equipment` could not do.
    """

    __tablename__ = "equipment_capability"
    __table_args__ = (
        UniqueConstraint(
            "equipment_id", "kind", "label", name="uq_equipment_capability_kind_label"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    equipment_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("equipment.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    label: Mapped[str] = mapped_column(String(96), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unvalidated")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="template")
    validated_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    validated_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    equipment: Mapped["Equipment"] = relationship(
        "Equipment", back_populates="capabilities"
    )


class EquipmentCanvasPosition(Base):
    """Saved node position on the network topology canvas.

    Separate table rather than x/y columns on `equipment`, mirroring the
    existing `site_canvas_position`, so a layout change never touches the
    equipment row's updated_at.
    """

    __tablename__ = "equipment_canvas_position"

    equipment_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("equipment.id", ondelete="CASCADE"),
        primary_key=True,
    )
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0)


# ===================== Equipment: bindings and links =====================
# Two concrete join tables rather than one polymorphic (target_kind,
# target_id) table — real foreign keys, real cascades, and it matches the
# precedent set by service_gateway_status.


class CapabilityServiceLink(Base):
    """This capability backs that service AT A PARTICULAR SITE.

    Binding to a delivery rather than to a service is what lets the far end of
    a shot back the same service the near end does, without claiming the gear
    is in two places. Renamed from `service_id` in 0054; the values needed no
    remapping because delivery ids reuse the old service ids.
    """

    __tablename__ = "capability_service_link"

    equipment_capability_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("equipment_capability.id", ondelete="CASCADE"),
        primary_key=True,
    )
    service_delivery_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("service_delivery.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="endpoint")
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class CapabilityGatewayLink(Base):
    """This capability realizes that PACE transport path."""

    __tablename__ = "capability_gateway_link"

    equipment_capability_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("equipment_capability.id", ondelete="CASCADE"),
        primary_key=True,
    )
    gateway_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("gateway.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class EquipmentLink(Base):
    """A physical/RF connection between two pieces of gear.

    These rows are the truth about the network topology, including across
    sites — an RFK at Site A shooting to an RFK at Site B is what makes B an
    extension of A. The optional capability columns say which port carried it
    ("the shot leaves the los_rf, not the satcom_rf"); most links won't bother.
    """

    __tablename__ = "equipment_link"
    __table_args__ = (
        CheckConstraint(
            "a_equipment_id <> b_equipment_id", name="ck_equipment_link_distinct"
        ),
        UniqueConstraint(
            "a_equipment_id", "b_equipment_id", "kind", name="uq_equipment_link_pair"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    a_equipment_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("equipment.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    b_equipment_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("equipment.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    a_capability_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("equipment_capability.id", ondelete="SET NULL"),
        nullable=True,
    )
    b_capability_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("equipment_capability.id", ondelete="SET NULL"),
        nullable=True,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    direction: Mapped[str] = mapped_column(
        String(16), nullable=False, default="bidirectional"
    )
    label: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unvalidated")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )
