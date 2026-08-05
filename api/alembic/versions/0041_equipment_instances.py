"""Deployed equipment: packages, UTCs, serialized gear, bulk holdings, capabilities.

Where 0040 is the reference layer, this is what is actually on the ground.
`package_instance` is deliberately not site-scoped — an FCP spans sites, which
is the entire point of the extension topology. `utc_instance` binds a UTC to
one site and records the operator's *declared* role (primary / extension /
independent); the topology view derives the same thing independently from the
link graph, so plan-vs-reality drift stays visible.

`equipment` is one serialized box. Note the column naming: `equipment_code` is
the human-facing "Equipment ID" (R7421 = prefix + last 4 of the serial). It is
deliberately not called `equipment_id`, because every foreign key pointing at
this table is named that, and one name meaning two things is a standing
footgun. `site_id` is denormalized off the UTC because gear can sit at a site
without belonging to a deployed UTC, and every topology query filters by site.

`equipment_holding` is the unserialized tier — cables and batteries counted per
UTC rather than tracked per serial.

`equipment_capability` is the important one: capabilities are copied here from
the type's declaration at registration and then edited per kit. Each carries
its own status, which is what makes "the radio's data port is dead but voice
is fine" expressible — a single status column on `equipment` could not say
that, and it's the common real-world case.

Revision ID: 0041_equipment_instances
Revises: 0040_equipment_catalog
Create Date: 2026-08-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0041_equipment_instances"
down_revision = "0040_equipment_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "package_instance",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("package_def_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            ondelete="CASCADE",
            name="fk_package_instance_workspace",
        ),
        # SET NULL: retiring a package definition must not delete the record
        # of packages already deployed against it.
        sa.ForeignKeyConstraint(
            ["package_def_id"],
            ["package_def.id"],
            ondelete="SET NULL",
            name="fk_package_instance_def",
        ),
        sa.UniqueConstraint("workspace_id", "name", name="uq_package_instance_name"),
    )
    op.create_index(
        "ix_package_instance_workspace_id", "package_instance", ["workspace_id"]
    )

    op.create_table(
        "utc_instance",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("package_instance_id", sa.BigInteger(), nullable=True),
        sa.Column("utc_def_id", sa.BigInteger(), nullable=True),
        sa.Column("site_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column(
            "role", sa.String(16), nullable=False, server_default="independent"
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
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
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            ondelete="CASCADE",
            name="fk_utc_instance_workspace",
        ),
        sa.ForeignKeyConstraint(
            ["package_instance_id"],
            ["package_instance.id"],
            ondelete="SET NULL",
            name="fk_utc_instance_package",
        ),
        sa.ForeignKeyConstraint(
            ["utc_def_id"],
            ["utc_def.id"],
            ondelete="SET NULL",
            name="fk_utc_instance_def",
        ),
        sa.ForeignKeyConstraint(
            ["site_id"],
            ["site.id"],
            ondelete="CASCADE",
            name="fk_utc_instance_site",
        ),
        sa.UniqueConstraint("workspace_id", "name", name="uq_utc_instance_name"),
    )
    op.create_index("ix_utc_instance_workspace_id", "utc_instance", ["workspace_id"])
    op.create_index("ix_utc_instance_site_id", "utc_instance", ["site_id"])
    op.create_index(
        "ix_utc_instance_package_instance_id", "utc_instance", ["package_instance_id"]
    )

    op.create_table(
        "equipment",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("equipment_type_id", sa.BigInteger(), nullable=False),
        sa.Column("utc_instance_id", sa.BigInteger(), nullable=True),
        sa.Column("site_id", sa.BigInteger(), nullable=False),
        sa.Column("equipment_code", sa.String(32), nullable=False),
        sa.Column("serial_number", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validated_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            ondelete="CASCADE",
            name="fk_equipment_workspace",
        ),
        # RESTRICT: you can't delete a catalog type while real gear points at
        # it — the instance would lose its identity. Retire the type instead.
        sa.ForeignKeyConstraint(
            ["equipment_type_id"],
            ["equipment_type.id"],
            ondelete="RESTRICT",
            name="fk_equipment_type",
        ),
        sa.ForeignKeyConstraint(
            ["utc_instance_id"],
            ["utc_instance.id"],
            ondelete="SET NULL",
            name="fk_equipment_utc_instance",
        ),
        sa.ForeignKeyConstraint(
            ["site_id"], ["site.id"], ondelete="CASCADE", name="fk_equipment_site"
        ),
        sa.ForeignKeyConstraint(
            ["validated_by_user_id"],
            ["user.id"],
            ondelete="SET NULL",
            name="fk_equipment_validated_by",
        ),
        sa.UniqueConstraint(
            "workspace_id", "equipment_code", name="uq_equipment_code"
        ),
    )
    op.create_index("ix_equipment_workspace_id", "equipment", ["workspace_id"])
    op.create_index("ix_equipment_site_id", "equipment", ["site_id"])
    op.create_index("ix_equipment_utc_instance_id", "equipment", ["utc_instance_id"])
    # Serials are unique per workspace when present, but plenty of gear is
    # registered before someone walks out to read the plate.
    op.create_index(
        "uq_equipment_serial",
        "equipment",
        ["workspace_id", "serial_number"],
        unique=True,
        postgresql_where=sa.text("serial_number IS NOT NULL"),
    )

    op.create_table(
        "equipment_holding",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("utc_instance_id", sa.BigInteger(), nullable=False),
        sa.Column("equipment_type_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "authorized_qty", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("on_hand_qty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            ondelete="CASCADE",
            name="fk_equipment_holding_workspace",
        ),
        sa.ForeignKeyConstraint(
            ["utc_instance_id"],
            ["utc_instance.id"],
            ondelete="CASCADE",
            name="fk_equipment_holding_utc",
        ),
        sa.ForeignKeyConstraint(
            ["equipment_type_id"],
            ["equipment_type.id"],
            ondelete="RESTRICT",
            name="fk_equipment_holding_type",
        ),
        sa.UniqueConstraint(
            "utc_instance_id", "equipment_type_id", name="uq_equipment_holding_type"
        ),
    )
    op.create_index(
        "ix_equipment_holding_workspace_id", "equipment_holding", ["workspace_id"]
    )

    op.create_table(
        "equipment_capability",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("equipment_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("label", sa.String(96), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("source", sa.String(16), nullable=False, server_default="template"),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validated_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["equipment_id"],
            ["equipment.id"],
            ondelete="CASCADE",
            name="fk_equipment_capability_equipment",
        ),
        sa.ForeignKeyConstraint(
            ["validated_by_user_id"],
            ["user.id"],
            ondelete="SET NULL",
            name="fk_equipment_capability_validated_by",
        ),
        sa.UniqueConstraint(
            "equipment_id", "kind", "label", name="uq_equipment_capability_kind_label"
        ),
    )
    op.create_index(
        "ix_equipment_capability_equipment_id", "equipment_capability", ["equipment_id"]
    )

    # Separate table rather than x/y on `equipment`, mirroring
    # site_canvas_position, so dragging a node never touches the equipment
    # row's updated_at.
    op.create_table(
        "equipment_canvas_position",
        sa.Column("equipment_id", sa.BigInteger(), primary_key=True),
        sa.Column("x", sa.Float(), nullable=False, server_default="0"),
        sa.Column("y", sa.Float(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["equipment_id"],
            ["equipment.id"],
            ondelete="CASCADE",
            name="fk_equipment_canvas_position_equipment",
        ),
    )


def downgrade() -> None:
    op.drop_table("equipment_canvas_position")
    op.drop_index(
        "ix_equipment_capability_equipment_id", table_name="equipment_capability"
    )
    op.drop_table("equipment_capability")
    op.drop_index("ix_equipment_holding_workspace_id", table_name="equipment_holding")
    op.drop_table("equipment_holding")
    op.drop_index("uq_equipment_serial", table_name="equipment")
    op.drop_index("ix_equipment_utc_instance_id", table_name="equipment")
    op.drop_index("ix_equipment_site_id", table_name="equipment")
    op.drop_index("ix_equipment_workspace_id", table_name="equipment")
    op.drop_table("equipment")
    op.drop_index("ix_utc_instance_package_instance_id", table_name="utc_instance")
    op.drop_index("ix_utc_instance_site_id", table_name="utc_instance")
    op.drop_index("ix_utc_instance_workspace_id", table_name="utc_instance")
    op.drop_table("utc_instance")
    op.drop_index("ix_package_instance_workspace_id", table_name="package_instance")
    op.drop_table("package_instance")
