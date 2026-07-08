"""Rules engine: rule + rule_execution tables, seeded system rules.

Mutations now emit typed triggers; rules decide the reactions. The seeded
global rules replicate the exact prior hard-wired behavior (every
validation/check-in/posture change recorded to the feed), so this
migration changes no visible behavior — it makes it tunable.

Seeded rules use on_error='abort' to preserve the old dual-write
atomicity: if the feed row fails, the mutation rolls back with it.

Revision ID: 0031_rules_engine
Revises: 0030_event_type_category
Create Date: 2026-07-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0031_rules_engine"
down_revision = "0030_event_type_category"
branch_labels = None
depends_on = None


def _create_event(type_slug: str, event_type: str, record_class: str, severity: str) -> list:
    return [
        {
            "action": "create_event",
            "params": {
                "type_slug": type_slug,
                "event_type": event_type,
                "record_class": record_class,
                "severity": severity,
            },
        }
    ]


_SEED_RULES = [
    # name, description, trigger, conditions, actions
    (
        "Record service validations",
        "Append a feed record whenever a service status is validated.",
        "service.status_changed",
        None,
        _create_event("service.validate", "validation", "log", "info"),
    ),
    (
        "Record gateway validations",
        "Append a feed record whenever a gateway status is validated.",
        "gateway.status_changed",
        None,
        _create_event("gateway.validate", "validation", "log", "info"),
    ),
    (
        "Record cell validations",
        "Append a feed record whenever a service-via-gateway cell is validated.",
        "cell.status_changed",
        None,
        _create_event("cell.validate", "validation", "log", "info"),
    ),
    (
        "Record site status changes",
        "Surface site posture changes as timeline events.",
        "site.status_changed",
        None,
        _create_event("site.status", "validation", "event", "notice"),
    ),
    (
        "Record FPCON changes",
        "Surface FPCON changes as warning events on the timeline.",
        "site.fpcon_changed",
        None,
        _create_event("site.fpcon", "validation", "event", "warning"),
    ),
    (
        "Record EMCON changes",
        "Surface EMCON changes as warning events on the timeline.",
        "site.emcon_changed",
        None,
        _create_event("site.emcon", "validation", "event", "warning"),
    ),
    (
        "Record personnel sign-ins",
        "Append a feed record for check-ins/outs — except end-of-day roster "
        "resets, which would flood the feed with one row per person.",
        "personnel.location_changed",
        {"!=": [{"var": "source_flow"}, "reset"]},
        _create_event("personnel.checkin", "personnel", "log", "info"),
    ),
]


def upgrade() -> None:
    op.create_table(
        "rule",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "workspace_id",
            sa.BigInteger(),
            sa.ForeignKey("workspace.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("trigger", sa.String(64), nullable=False, index=True),
        sa.Column("conditions", JSONB(), nullable=True),
        sa.Column(
            "enrichers", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column(
            "actions", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column(
            "enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "is_builtin", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("on_error", sa.String(8), nullable=False, server_default="skip"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
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
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_table(
        "rule_execution",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "rule_id",
            sa.BigInteger(),
            sa.ForeignKey("rule.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "workspace_id",
            sa.BigInteger(),
            sa.ForeignKey("workspace.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("trigger", sa.String(64), nullable=False),
        sa.Column(
            "fired_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            index=True,
        ),
        sa.Column("status", sa.String(8), nullable=False, server_default="ok"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("context", JSONB(), nullable=True),
    )

    table = sa.table(
        "rule",
        sa.column("workspace_id", sa.BigInteger()),
        sa.column("name", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("trigger", sa.String()),
        sa.column("conditions", JSONB()),
        sa.column("enrichers", JSONB()),
        sa.column("actions", JSONB()),
        sa.column("enabled", sa.Boolean()),
        sa.column("is_builtin", sa.Boolean()),
        sa.column("on_error", sa.String()),
        sa.column("priority", sa.Integer()),
    )
    op.bulk_insert(
        table,
        [
            {
                "workspace_id": None,
                "name": name,
                "description": description,
                "trigger": trigger,
                "conditions": conditions,
                "enrichers": [],
                "actions": actions,
                "enabled": True,
                "is_builtin": True,
                "on_error": "abort",
                "priority": 10,
            }
            for name, description, trigger, conditions, actions in _SEED_RULES
        ],
    )


def downgrade() -> None:
    op.drop_table("rule_execution")
    op.drop_table("rule")
