"""SQLAlchemy 2.x declarative models for xcomm_hud."""

from __future__ import annotations

import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


SERVICE_STATUS_VALUES = ("up", "degraded", "down", "unknown", "offline", "setup")
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
SUBJECT_KINDS = (
    "service",
    "site",
    "gateway",
    "service_gateway",
    "site_fpcon",
    "site_emcon",
    "site_status",
    "personnel_location",
    "system",
    "mission",
    "exercise",
    "team",
    "unit",
    "work_center",
    "workspace",
    "document",
    "doc_page",
)
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

    services: Mapped[list["Service"]] = relationship("Service", back_populates="site")
    gateways: Mapped[list["Gateway"]] = relationship(
        "Gateway", back_populates="site", cascade="all, delete-orphan"
    )
    canvas_position: Mapped[Optional["SiteCanvasPosition"]] = relationship(
        "SiteCanvasPosition",
        back_populates="site",
        uselist=False,
        cascade="all, delete-orphan",
    )


class EnclaveSource(Base):
    __tablename__ = "enclave_source"

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
    # null = all 6 status values allowed; otherwise restricts the picker.
    allowed_statuses: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)


class Service(Base):
    __tablename__ = "service"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), nullable=False
    )
    service_template_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("service_template.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    category: Mapped[str] = mapped_column(String(24), nullable=False, default="other")
    reach: Mapped[str] = mapped_column(String(16), nullable=False, default="local")
    icon: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    validated_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    validated_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Which PACE tiers this service uses. Defaults to all four (full fan-out =
    # previous behavior). Operators clear PACE letters a service can't use.
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

    site: Mapped["Site"] = relationship("Site", back_populates="services")


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
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
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
    seeds them to `unknown` (needs validation). Cascade rules in
    api/effective.py drive how a gateway or local service status change
    propagates here — but only when the validation dialog leaves
    "cascade to cells" checked. Manual cell writes enforce R11 (cell
    cannot exceed local service status) and the R10 down/offline lock
    as hard invariants regardless of the cascade flag.
    """

    __tablename__ = "service_gateway_status"

    service_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("service.id", ondelete="CASCADE"),
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
        String(16), nullable=False, default="unknown"
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

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("workspace.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
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
