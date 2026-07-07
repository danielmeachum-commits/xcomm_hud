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
)
EVENT_TYPES = ("validation", "general")
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
