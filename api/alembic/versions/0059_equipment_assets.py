"""The property book: global equipment assets, and kits promoted to global.

See docs/design/equipment-kits.md §9.

0058 scoped kits to a workspace. That was one level too low. A workspace is an
operating picture, not a tenant — the workspaces admin page says so outright
("Duplicate a workspace to seed the next exercise") — so the radio in the rack
is a fact about the unit, not about any one exercise, and a kit describing the
unit's gear belongs alongside the enclaves and the equipment catalog in the
global tier.

The obstacle was that `equipment` is workspace-scoped: workspace-unique serial
and equipment ID, NOT NULL `site_id`. A global kit cannot pin one of those
rows. So this adds the missing layer rather than bending the existing one:

* `equipment_asset` is the property book — one row per physical box the unit
  owns, with its serial, its equipment ID, and (via
  `equipment_asset_capability`) which capabilities that box actually has.
* `equipment.asset_id` records which asset a workspace's row was materialized
  from. Workspace equipment is otherwise untouched, so topology, completeness,
  wiring and status code all keep working unchanged.

Materializing rather than reassigning is the deliberate choice. A single global
assignment would have made the pool exclusive across workspaces, which reads
tidy but breaks the ordinary case: planning next month's exercise while this
month's is live means two pictures legitimately list the same radio. So an
asset is a shared source each picture draws from, and "committed in N
workspaces" is a report, not a conflict. Within a single workspace exclusivity
still holds, because `equipment.utc_instance_id` is still one FK.

`equipment_kit_item.equipment_id` becomes `asset_id`. There is no automatic
mapping from a workspace equipment row to an asset, and 0058 shipped hours
earlier on the same day, so existing pins are dropped rather than guessed —
re-capturing a kit is one click. The kit and its UTC slots survive; only the
pinned items clear.

Revision ID: 0059_equipment_assets
Revises: 0058_equipment_kits
Create Date: 2026-08-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0059_equipment_assets"
down_revision = "0058_equipment_kits"
branch_labels = None
depends_on = None


_ASSET_EVENT_TYPES = [
    (
        "asset.registered",
        "Asset added to the property book",
        "Equipment",
        "log",
        "info",
        "package-plus",
        ["equipment_asset"],
    ),
    (
        "asset.retired",
        "Asset retired from the property book",
        "Equipment",
        "log",
        "info",
        "archive",
        ["equipment_asset"],
    ),
]
_SLUGS = tuple(row[0] for row in _ASSET_EVENT_TYPES)


def upgrade() -> None:
    op.create_table(
        "equipment_asset",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("equipment_type_id", sa.BigInteger(), nullable=False),
        sa.Column("equipment_code", sa.String(length=32), nullable=False),
        sa.Column("serial_number", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["equipment_type_id"], ["equipment_type.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("equipment_code", name="uq_equipment_asset_code"),
    )
    # Serial is globally unique when present, but plenty of gear has none
    # recorded — a plain unique constraint would allow only one such row.
    op.create_index(
        "uq_equipment_asset_serial",
        "equipment_asset",
        ["serial_number"],
        unique=True,
        postgresql_where=sa.text("serial_number IS NOT NULL"),
    )

    op.create_table(
        "equipment_asset_capability",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("asset_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["asset_id"], ["equipment_asset.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_id", "kind", name="uq_equipment_asset_capability"),
    )
    op.create_index(
        "ix_equipment_asset_capability_asset_id",
        "equipment_asset_capability",
        ["asset_id"],
    )

    op.add_column(
        "equipment", sa.Column("asset_id", sa.BigInteger(), nullable=True)
    )
    op.create_foreign_key(
        "fk_equipment_asset_id",
        "equipment",
        "equipment_asset",
        ["asset_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_equipment_asset_id", "equipment", ["asset_id"])

    # --- kits become global-or-workspace ---
    op.alter_column(
        "equipment_kit", "workspace_id", existing_type=sa.BigInteger(), nullable=True
    )
    op.create_index(
        "uq_equipment_kit_global_name",
        "equipment_kit",
        ["name"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )

    # --- pins move from workspace equipment to global assets ---
    # No honest mapping exists, and 0058 is hours old. Clear rather than guess;
    # the kit's UTC slots and bulk lines survive, so re-capturing restores it.
    op.execute(sa.text("DELETE FROM equipment_kit_item"))
    op.drop_constraint(
        "uq_equipment_kit_item_pair", "equipment_kit_item", type_="unique"
    )
    op.drop_column("equipment_kit_item", "equipment_id")
    op.add_column(
        "equipment_kit_item", sa.Column("asset_id", sa.BigInteger(), nullable=False)
    )
    op.create_foreign_key(
        "fk_equipment_kit_item_asset",
        "equipment_kit_item",
        "equipment_asset",
        ["asset_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_equipment_kit_item_asset_id", "equipment_kit_item", ["asset_id"]
    )
    op.create_unique_constraint(
        "uq_equipment_kit_item_pair", "equipment_kit_item", ["kit_utc_id", "asset_id"]
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
            for slug, label, category, record_class, severity, icon, kinds in _ASSET_EVENT_TYPES
        ],
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM event_type_def "
            "WHERE workspace_id IS NULL AND slug IN :slugs"
        ).bindparams(sa.bindparam("slugs", value=_SLUGS, expanding=True))
    )

    op.execute(sa.text("DELETE FROM equipment_kit_item"))
    op.drop_constraint(
        "uq_equipment_kit_item_pair", "equipment_kit_item", type_="unique"
    )
    op.drop_index("ix_equipment_kit_item_asset_id", "equipment_kit_item")
    op.drop_constraint(
        "fk_equipment_kit_item_asset", "equipment_kit_item", type_="foreignkey"
    )
    op.drop_column("equipment_kit_item", "asset_id")
    op.add_column(
        "equipment_kit_item", sa.Column("equipment_id", sa.BigInteger(), nullable=False)
    )
    op.create_unique_constraint(
        "uq_equipment_kit_item_pair",
        "equipment_kit_item",
        ["kit_utc_id", "equipment_id"],
    )

    op.drop_index("uq_equipment_kit_global_name", "equipment_kit")
    # Global kits have no workspace to fall back to, so they cannot survive a
    # column that must be NOT NULL.
    op.execute(sa.text("DELETE FROM equipment_kit WHERE workspace_id IS NULL"))
    op.alter_column(
        "equipment_kit", "workspace_id", existing_type=sa.BigInteger(), nullable=False
    )

    op.drop_index("ix_equipment_asset_id", "equipment")
    op.drop_constraint("fk_equipment_asset_id", "equipment", type_="foreignkey")
    op.drop_column("equipment", "asset_id")

    op.drop_table("equipment_asset_capability")
    op.drop_index("uq_equipment_asset_serial", "equipment_asset")
    op.drop_table("equipment_asset")
