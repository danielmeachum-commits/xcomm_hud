"""Bring system record types into the event-type catalog.

Validation, sign-in, and posture-change records previously existed only
as registry slugs — invisible in the Event Types catalog, which made the
taxonomy look incomplete and left the wizard offering only declarable
types. Seed them as `is_system` catalog rows (categories: Validation,
Site posture, Personnel): visible and stylable in the catalog, pickable
in rule actions, but hidden from the manual "Log event" type picker.

Classification precedence is unchanged (rule params > registry defaults >
catalog), so these rows carry display metadata, not behavior.

Revision ID: 0033_system_event_types
Revises: 0032_rule_computed
Create Date: 2026-07-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0033_system_event_types"
down_revision = "0032_rule_computed"
branch_labels = None
depends_on = None

_SYSTEM_TYPES = [
    # slug, label, category, record_class, severity, icon, kinds
    (
        "service.validate",
        "Service validation",
        "Validation",
        "log",
        "info",
        "clipboard-check",
        ["service"],
    ),
    (
        "gateway.validate",
        "Gateway validation",
        "Validation",
        "log",
        "info",
        "radio",
        ["gateway"],
    ),
    (
        "cell.validate",
        "Cell validation",
        "Validation",
        "log",
        "info",
        "clipboard-check",
        ["service_gateway"],
    ),
    (
        "site.validate",
        "Site validation",
        "Validation",
        "log",
        "info",
        "clipboard-check",
        ["site"],
    ),
    (
        "site.status",
        "Site status change",
        "Site posture",
        "event",
        "notice",
        "flag",
        ["site_status"],
    ),
    (
        "site.fpcon",
        "FPCON change",
        "Site posture",
        "event",
        "warning",
        "siren",
        ["site_fpcon"],
    ),
    (
        "site.emcon",
        "EMCON change",
        "Site posture",
        "event",
        "warning",
        "triangle-alert",
        ["site_emcon"],
    ),
    (
        "personnel.checkin",
        "Sign-in / out",
        "Personnel",
        "log",
        "info",
        "users",
        ["personnel_location"],
    ),
]


def upgrade() -> None:
    op.add_column(
        "event_type_def",
        sa.Column(
            "is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    table = sa.table(
        "event_type_def",
        sa.column("workspace_id", sa.BigInteger()),
        sa.column("slug", sa.String()),
        sa.column("label", sa.String()),
        sa.column("category", sa.String()),
        sa.column("record_class", sa.String()),
        sa.column("default_severity", sa.String()),
        sa.column("icon", sa.String()),
        sa.column("allowed_subject_kinds", JSONB()),
        sa.column("is_builtin", sa.Boolean()),
        sa.column("is_system", sa.Boolean()),
    )
    op.bulk_insert(
        table,
        [
            {
                "workspace_id": None,
                "slug": slug,
                "label": label,
                "category": category,
                "record_class": record_class,
                "default_severity": severity,
                "icon": icon,
                "allowed_subject_kinds": kinds,
                "is_builtin": True,
                "is_system": True,
            }
            for slug, label, category, record_class, severity, icon, kinds in _SYSTEM_TYPES
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM event_type_def WHERE is_system AND workspace_id IS NULL"
    )
    op.drop_column("event_type_def", "is_system")
