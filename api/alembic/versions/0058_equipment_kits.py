"""Equipment kits — reusable rosters of pinned serials.

See docs/design/equipment-kits.md.

The deploy wizard was create-only: `deploy_utc` 409s on any serial already
registered in the workspace, so the same physical radio could not be deployed
twice. In a unit with a finite equipment pool that is the normal case, and the
workaround in use was "deploy the UTC empty, then PATCH each radio one at a
time" from the equipment list.

Two things land together here, because the second is useless without the first:

1. Deploying gear that already exists (no schema change — `UtcDeployItemIn`
   gains `equipment_id`, and the write reassigns `equipment.utc_instance_id`
   instead of inserting). Only the new `equipment.reassigned` event type is
   needed, seeded below.

2. The kit tables: a workspace-scoped roster pinning *specific* equipment rows
   to UTC slots, so a package's configuration is saved once and reused.

Kits are deliberately NOT a column on `package_def`. Package definitions can be
global catalog rows (`workspace_id IS NULL`) and serial numbers must never sit
where another workspace can read them — the same doctrine-vs-serials split
`utc_instance_line` already draws.

`equipment_kit_item.equipment_id` cascades: gear sold off or written down leaves
every kit that listed it, rather than leaving the kit promising a radio the
workspace no longer owns. Pinning is non-exclusive by design — one TACLANE can
be listed by every kit that would use it, since what actually prevents
double-deployment is `equipment.utc_instance_id` being a single FK.

Revision ID: 0058_equipment_kits
Revises: 0057_delivery_gateway_dependency
Create Date: 2026-08-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0058_equipment_kits"
down_revision = "0057_delivery_gateway_dependency"
branch_labels = None
depends_on = None


# slug, label, category, record_class, severity, icon, kinds
_KIT_EVENT_TYPES = [
    (
        "equipment.reassigned",
        "Equipment moved between UTCs",
        "Equipment",
        "log",
        "info",
        "package-open",
        ["equipment"],
    ),
    (
        "kit.saved",
        "Kit saved",
        "Equipment",
        "log",
        "info",
        "boxes",
        ["equipment_kit"],
    ),
    (
        "kit.deleted",
        "Kit deleted",
        "Equipment",
        "log",
        "info",
        "trash-2",
        ["equipment_kit"],
    ),
]

_SLUGS = tuple(row[0] for row in _KIT_EVENT_TYPES)


def upgrade() -> None:
    op.create_table(
        "equipment_kit",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("package_def_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["package_def_id"], ["package_def.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_equipment_kit_name"),
    )
    op.create_index(
        "ix_equipment_kit_workspace_id", "equipment_kit", ["workspace_id"]
    )

    op.create_table(
        "equipment_kit_utc",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("kit_id", sa.BigInteger(), nullable=False),
        sa.Column("utc_def_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column(
            "role_hint",
            sa.String(length=16),
            nullable=False,
            server_default="either",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["kit_id"], ["equipment_kit.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["utc_def_id"], ["utc_def.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_equipment_kit_utc_kit_id", "equipment_kit_utc", ["kit_id"])

    op.create_table(
        "equipment_kit_item",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("kit_utc_id", sa.BigInteger(), nullable=False),
        sa.Column("equipment_id", sa.BigInteger(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["kit_utc_id"], ["equipment_kit_utc.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["equipment_id"], ["equipment.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "kit_utc_id", "equipment_id", name="uq_equipment_kit_item_pair"
        ),
    )
    op.create_index(
        "ix_equipment_kit_item_kit_utc_id", "equipment_kit_item", ["kit_utc_id"]
    )
    op.create_index(
        "ix_equipment_kit_item_equipment_id", "equipment_kit_item", ["equipment_id"]
    )

    op.create_table(
        "equipment_kit_bulk",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("kit_utc_id", sa.BigInteger(), nullable=False),
        sa.Column("equipment_type_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("enclave_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["kit_utc_id"], ["equipment_kit_utc.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["equipment_type_id"], ["equipment_type.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["enclave_id"], ["enclave.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "kit_utc_id",
            "equipment_type_id",
            "enclave_id",
            name="uq_equipment_kit_bulk_type_enclave",
        ),
    )
    op.create_index(
        "ix_equipment_kit_bulk_kit_utc_id", "equipment_kit_bulk", ["kit_utc_id"]
    )
    # A NULL enclave never equals another NULL, so the composite unique above
    # does not constrain untagged lines at all — the same partial-index trick
    # `utc_instance_line` uses.
    op.create_index(
        "uq_equipment_kit_bulk_type_no_enclave",
        "equipment_kit_bulk",
        ["kit_utc_id", "equipment_type_id"],
        unique=True,
        postgresql_where=sa.text("enclave_id IS NULL"),
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
            for slug, label, category, record_class, severity, icon, kinds in _KIT_EVENT_TYPES
        ],
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM event_type_def "
            "WHERE workspace_id IS NULL AND slug IN :slugs"
        ).bindparams(sa.bindparam("slugs", value=_SLUGS, expanding=True))
    )
    op.drop_table("equipment_kit_bulk")
    op.drop_table("equipment_kit_item")
    op.drop_table("equipment_kit_utc")
    op.drop_table("equipment_kit")
