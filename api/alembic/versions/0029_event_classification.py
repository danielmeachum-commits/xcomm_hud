"""Classify the event feed: workspace scope, log/event class, severity, type.

The validation table conflated high-volume audit records with
briefing-worthy occurrences. Add:

- workspace_id — denormalized scope so the feed filters without joining
  through the subject (backfilled via subject joins below).
- record_class — "log" (routine audit) vs "event" (timeline-worthy).
- severity — info/notice/warning/critical.
- type_slug — the action or catalog type that produced the row.

Also creates event_type_def, the user-extensible catalog of declarable
event types (global seeded rows + per-workspace custom), and seeds the
baseline vocabulary (exercise lifecycle, briefs, general note).

Revision ID: 0029_event_classification
Revises: 0028_commander_per_unit
Create Date: 2026-07-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0029_event_classification"
down_revision = "0028_commander_per_unit"
branch_labels = None
depends_on = None


# (event_type, subject_kind) → (record_class, severity, type_slug) for
# existing rows. Mirrors api/action_registry.py ACTIONS.
_BACKFILL_CLASSIFICATION = [
    ("validation", "service", "log", "info", "service.validate"),
    ("validation", "gateway", "log", "info", "gateway.validate"),
    ("validation", "service_gateway", "log", "info", "cell.validate"),
    ("validation", "site", "log", "info", "site.validate"),
    ("validation", "site_status", "event", "notice", "site.status"),
    ("validation", "site_fpcon", "event", "warning", "site.fpcon"),
    ("validation", "site_emcon", "event", "warning", "site.emcon"),
    ("personnel", "personnel_location", "log", "info", "personnel.checkin"),
    ("general", "system", "event", "notice", "note.general"),
    ("general", "mission", "event", "notice", "note.general"),
    ("general", "exercise", "event", "notice", "note.general"),
]

_SEED_TYPES = [
    # slug, label, description, record_class, severity, icon, color, kinds
    (
        "exercise.startex",
        "STARTEX",
        "Start of exercise.",
        "event",
        "critical",
        "flag",
        "#16a34a",
        ["workspace", "exercise"],
    ),
    (
        "exercise.pauseex",
        "PAUSEEX",
        "Exercise paused.",
        "event",
        "warning",
        "pause",
        "#d97706",
        ["workspace", "exercise"],
    ),
    (
        "exercise.resumeex",
        "RESUMEEX",
        "Exercise resumed after a pause.",
        "event",
        "notice",
        "play",
        "#2563eb",
        ["workspace", "exercise"],
    ),
    (
        "exercise.endex",
        "ENDEX",
        "End of exercise.",
        "event",
        "critical",
        "flag-off",
        "#dc2626",
        ["workspace", "exercise"],
    ),
    (
        "brief.safety",
        "Safety brief",
        "Workspace-wide or localized safety brief.",
        "event",
        "notice",
        "shield-check",
        "#0891b2",
        ["workspace", "site", "team", "unit", "work_center"],
    ),
    (
        "brief.general",
        "Briefing",
        "General briefing (ops, intel, shift change).",
        "event",
        "notice",
        "presentation",
        "#7c3aed",
        ["workspace", "site", "team", "unit", "work_center"],
    ),
    (
        "note.general",
        "General note",
        "Free-form note on any scope.",
        "event",
        "info",
        "sticky-note",
        None,
        [
            "system",
            "mission",
            "exercise",
            "workspace",
            "site",
            "team",
            "unit",
            "work_center",
        ],
    ),
]


def upgrade() -> None:
    op.add_column(
        "validation",
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "validation",
        sa.Column(
            "record_class", sa.String(8), nullable=False, server_default="log"
        ),
    )
    op.add_column(
        "validation",
        sa.Column(
            "severity", sa.String(12), nullable=False, server_default="info"
        ),
    )
    op.add_column(
        "validation",
        sa.Column("type_slug", sa.String(64), nullable=True),
    )
    op.create_foreign_key(
        "fk_validation_workspace_id",
        "validation",
        "workspace",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_validation_workspace_validated_at",
        "validation",
        ["workspace_id", "validated_at"],
    )
    op.create_index("ix_validation_type_slug", "validation", ["type_slug"])

    # --- Backfill workspace_id via subject joins ---
    op.execute(
        """
        UPDATE validation v SET workspace_id = s.workspace_id
        FROM service svc JOIN site s ON s.id = svc.site_id
        WHERE v.subject_kind IN ('service', 'service_gateway')
          AND v.subject_id = svc.id
        """
    )
    op.execute(
        """
        UPDATE validation v SET workspace_id = s.workspace_id
        FROM gateway g JOIN site s ON s.id = g.site_id
        WHERE v.subject_kind = 'gateway' AND v.subject_id = g.id
        """
    )
    op.execute(
        """
        UPDATE validation v SET workspace_id = s.workspace_id
        FROM site s
        WHERE v.subject_kind IN ('site', 'site_fpcon', 'site_emcon', 'site_status')
          AND v.subject_id = s.id
        """
    )
    op.execute(
        """
        UPDATE validation v SET workspace_id = p.workspace_id
        FROM personnel p
        WHERE v.subject_kind = 'personnel_location' AND v.subject_id = p.id
        """
    )

    # --- Backfill classification from the registry mapping ---
    for event_type, kind, record_class, severity, type_slug in _BACKFILL_CLASSIFICATION:
        op.execute(
            sa.text(
                "UPDATE validation SET record_class = :rc, severity = :sev, "
                "type_slug = :slug "
                "WHERE event_type = :et AND subject_kind = :kind"
            ).bindparams(
                rc=record_class,
                sev=severity,
                slug=type_slug,
                et=event_type,
                kind=kind,
            )
        )

    # --- Catalog table ---
    op.create_table(
        "event_type_def",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "workspace_id",
            sa.BigInteger(),
            sa.ForeignKey("workspace.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("label", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("record_class", sa.String(8), nullable=False, server_default="event"),
        sa.Column(
            "default_severity", sa.String(12), nullable=False, server_default="notice"
        ),
        sa.Column("icon", sa.String(48), nullable=True),
        sa.Column("color", sa.String(16), nullable=True),
        sa.Column(
            "allowed_subject_kinds",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "is_builtin", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("workspace_id", "slug", name="uq_event_type_def_ws_slug"),
    )
    # Postgres treats NULLs as distinct in unique constraints, so global
    # rows (workspace_id IS NULL) need their own partial unique index.
    op.create_index(
        "uq_event_type_def_global_slug",
        "event_type_def",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )

    # --- Seed the global baseline vocabulary ---
    table = sa.table(
        "event_type_def",
        sa.column("workspace_id", sa.BigInteger()),
        sa.column("slug", sa.String()),
        sa.column("label", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("record_class", sa.String()),
        sa.column("default_severity", sa.String()),
        sa.column("icon", sa.String()),
        sa.column("color", sa.String()),
        sa.column("allowed_subject_kinds", JSONB()),
        sa.column("is_builtin", sa.Boolean()),
    )
    op.bulk_insert(
        table,
        [
            {
                "workspace_id": None,
                "slug": slug,
                "label": label,
                "description": description,
                "record_class": record_class,
                "default_severity": severity,
                "icon": icon,
                "color": color,
                "allowed_subject_kinds": kinds,
                "is_builtin": True,
            }
            for slug, label, description, record_class, severity, icon, color, kinds in _SEED_TYPES
        ],
    )


def downgrade() -> None:
    op.drop_table("event_type_def")
    op.drop_index("ix_validation_type_slug", table_name="validation")
    op.drop_index("ix_validation_workspace_validated_at", table_name="validation")
    op.drop_constraint("fk_validation_workspace_id", "validation", type_="foreignkey")
    op.drop_column("validation", "type_slug")
    op.drop_column("validation", "severity")
    op.drop_column("validation", "record_class")
    op.drop_column("validation", "workspace_id")
