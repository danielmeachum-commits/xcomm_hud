"""Capability bindings to services/gateways, and equipment-to-equipment links.

This is where the equipment tier meets the tier the app already had. A
capability binds to a `service` (this box delivers it), to a `gateway` (this
box realizes that PACE transport path), or to both — which is how a single
AN/PRC-117G is simultaneously a service endpoint for voice and data and the
transport for a SATCOM gateway. Two concrete join tables rather than one
polymorphic (target_kind, target_id) table: real foreign keys, real cascades,
and it matches the precedent set by service_gateway_status.

These bindings are read-only inputs to an *advisory* comparison. Equipment
never writes service or gateway status — see the reasoning in api/effective.py
and schemas.DerivedStatus. The API reports derived-vs-reported side by side and
the operator applies it explicitly through the existing validation endpoint.

`equipment_link` is the topology. These rows are the truth about what is
physically connected to what, including across sites: an RFK at Site A
shooting to an RFK at Site B is precisely what makes B an extension of A, and
until now the hub had no way to record that at all. The optional capability
columns name which port carried the shot; most links won't bother.

Revision ID: 0042_equipment_bindings_links
Revises: 0041_equipment_instances
Create Date: 2026-08-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0042_equipment_bindings_links"
down_revision = "0041_equipment_instances"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "capability_service_link",
        sa.Column("equipment_capability_id", sa.BigInteger(), primary_key=True),
        sa.Column("service_id", sa.BigInteger(), primary_key=True),
        sa.Column("role", sa.String(16), nullable=False, server_default="endpoint"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["equipment_capability_id"],
            ["equipment_capability.id"],
            ondelete="CASCADE",
            name="fk_capability_service_link_capability",
        ),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["service.id"],
            ondelete="CASCADE",
            name="fk_capability_service_link_service",
        ),
    )
    # Composite PK covers capability-side lookups; this keeps "what backs this
    # service" fast, which is the direction the site detail view reads.
    op.create_index(
        "ix_capability_service_link_service_id", "capability_service_link", ["service_id"]
    )

    op.create_table(
        "capability_gateway_link",
        sa.Column("equipment_capability_id", sa.BigInteger(), primary_key=True),
        sa.Column("gateway_id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["equipment_capability_id"],
            ["equipment_capability.id"],
            ondelete="CASCADE",
            name="fk_capability_gateway_link_capability",
        ),
        sa.ForeignKeyConstraint(
            ["gateway_id"],
            ["gateway.id"],
            ondelete="CASCADE",
            name="fk_capability_gateway_link_gateway",
        ),
    )
    op.create_index(
        "ix_capability_gateway_link_gateway_id",
        "capability_gateway_link",
        ["gateway_id"],
    )

    op.create_table(
        "equipment_link",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("a_equipment_id", sa.BigInteger(), nullable=False),
        sa.Column("b_equipment_id", sa.BigInteger(), nullable=False),
        sa.Column("a_capability_id", sa.BigInteger(), nullable=True),
        sa.Column("b_capability_id", sa.BigInteger(), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False, server_default="other"),
        sa.Column(
            "direction", sa.String(16), nullable=False, server_default="bidirectional"
        ),
        sa.Column("label", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="unknown"),
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
            name="fk_equipment_link_workspace",
        ),
        sa.ForeignKeyConstraint(
            ["a_equipment_id"],
            ["equipment.id"],
            ondelete="CASCADE",
            name="fk_equipment_link_a",
        ),
        sa.ForeignKeyConstraint(
            ["b_equipment_id"],
            ["equipment.id"],
            ondelete="CASCADE",
            name="fk_equipment_link_b",
        ),
        # SET NULL: deleting a capability shouldn't silently delete the record
        # that the two boxes are connected — only which port carried it.
        sa.ForeignKeyConstraint(
            ["a_capability_id"],
            ["equipment_capability.id"],
            ondelete="SET NULL",
            name="fk_equipment_link_a_capability",
        ),
        sa.ForeignKeyConstraint(
            ["b_capability_id"],
            ["equipment_capability.id"],
            ondelete="SET NULL",
            name="fk_equipment_link_b_capability",
        ),
        sa.CheckConstraint(
            "a_equipment_id <> b_equipment_id", name="ck_equipment_link_distinct"
        ),
        sa.UniqueConstraint(
            "a_equipment_id", "b_equipment_id", "kind", name="uq_equipment_link_pair"
        ),
    )
    op.create_index("ix_equipment_link_workspace_id", "equipment_link", ["workspace_id"])
    op.create_index(
        "ix_equipment_link_a_equipment_id", "equipment_link", ["a_equipment_id"]
    )
    op.create_index(
        "ix_equipment_link_b_equipment_id", "equipment_link", ["b_equipment_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_equipment_link_b_equipment_id", table_name="equipment_link")
    op.drop_index("ix_equipment_link_a_equipment_id", table_name="equipment_link")
    op.drop_index("ix_equipment_link_workspace_id", table_name="equipment_link")
    op.drop_table("equipment_link")
    op.drop_index(
        "ix_capability_gateway_link_gateway_id", table_name="capability_gateway_link"
    )
    op.drop_table("capability_gateway_link")
    op.drop_index(
        "ix_capability_service_link_service_id", table_name="capability_service_link"
    )
    op.drop_table("capability_service_link")
