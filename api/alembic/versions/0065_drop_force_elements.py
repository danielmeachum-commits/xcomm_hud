"""Remove force elements.

Force elements (née kits, 0058/0064) never found a use that the deploy wizard
and the property book did not already cover, and having a third way to group
gear made it harder to explain the other two. The tables go, along with the
two event types that announced saving and deleting one.

Deploying gear that already exists — `equipment_id` and `asset_id` on a deploy
item — came in alongside kits but stands on its own and is kept, as is the
`equipment.reassigned` event type 0058 seeded with it.

Events written against a force element are deleted rather than left behind.
`subject_kind` is checked against the `SubjectKind` literal on the way out of
the events API, so a row still naming `force_element` would break the feed
for every workspace that has one.

The downgrade recreates the tables empty and reseeds the event types. The rows
themselves do not come back.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0065_drop_force_elements"
down_revision = "0064_force_elements"
branch_labels = None
depends_on = None


# slug, label, icon — as 0058 seeded them and 0064 relabeled them.
_EVENT_TYPES = [
    ("kit.saved", "Force element saved", "boxes"),
    ("kit.deleted", "Force element deleted", "trash-2"),
]
_SLUGS = tuple(row[0] for row in _EVENT_TYPES)


def upgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM validation "
            "WHERE subject_kind = 'force_element' OR type_slug IN :slugs"
        ).bindparams(sa.bindparam("slugs", value=_SLUGS, expanding=True))
    )
    op.execute(
        sa.text("DELETE FROM event_type_def WHERE slug IN :slugs").bindparams(
            sa.bindparam("slugs", value=_SLUGS, expanding=True)
        )
    )

    op.drop_table("force_element_bulk")
    op.drop_table("force_element_item")
    op.drop_table("force_element_utc")
    op.drop_table("force_element")


def downgrade() -> None:
    # The schema as 0064 left it: 0058's tables, renamed, with 0059's move from
    # workspace-scoped equipment pins to nullable-workspace asset pins.
    op.create_table(
        "force_element",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
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
        sa.UniqueConstraint("workspace_id", "name", name="uq_force_element_name"),
    )
    op.create_index(
        "ix_equipment_kit_workspace_id", "force_element", ["workspace_id"]
    )
    op.create_index(
        "uq_force_element_global_name",
        "force_element",
        ["name"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )

    op.create_table(
        "force_element_utc",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("force_element_id", sa.BigInteger(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["force_element_id"], ["force_element.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["utc_def_id"], ["utc_def.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_equipment_kit_utc_kit_id", "force_element_utc", ["force_element_id"]
    )

    op.create_table(
        "force_element_item",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("force_element_utc_id", sa.BigInteger(), nullable=False),
        sa.Column("asset_id", sa.BigInteger(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["force_element_utc_id"], ["force_element_utc.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"], ["equipment_asset.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "force_element_utc_id", "asset_id", name="uq_force_element_item_pair"
        ),
    )
    op.create_index(
        "ix_equipment_kit_item_kit_utc_id",
        "force_element_item",
        ["force_element_utc_id"],
    )
    op.create_index(
        "ix_equipment_kit_item_asset_id", "force_element_item", ["asset_id"]
    )

    op.create_table(
        "force_element_bulk",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("force_element_utc_id", sa.BigInteger(), nullable=False),
        sa.Column("equipment_type_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("enclave_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["force_element_utc_id"], ["force_element_utc.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["equipment_type_id"], ["equipment_type.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["enclave_id"], ["enclave.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "force_element_utc_id",
            "equipment_type_id",
            "enclave_id",
            name="uq_force_element_bulk_type_enclave",
        ),
    )
    op.create_index(
        "ix_equipment_kit_bulk_kit_utc_id",
        "force_element_bulk",
        ["force_element_utc_id"],
    )
    op.create_index(
        "uq_force_element_bulk_type_no_enclave",
        "force_element_bulk",
        ["force_element_utc_id", "equipment_type_id"],
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
                "category": "Equipment",
                "record_class": "log",
                "default_severity": "info",
                "icon": icon,
                "allowed_subject_kinds": ["force_element"],
                "is_builtin": True,
                "is_system": True,
            }
            for slug, label, icon in _EVENT_TYPES
        ],
    )
