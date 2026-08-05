"""Snapshot what a deployed UTC was planned to carry.

Completeness had no honest baseline. Comparing a deployed UTC against its
`utc_def` reports every deliberate omission as a shortfall — and omissions are
routine, because a UTC's bill of materials includes the router/switch/server
stack for each network enclave, and a team that isn't supporting an enclave
leaves that whole stack home. An indicator that is permanently red for expected
reasons is an indicator people learn to ignore.

So the expected list becomes per-deployment: seeded at deploy from what the
operator actually confirmed in the wizard, and editable afterwards. Shortfall
then means what it should — gear that was planned for and isn't there, which is
the "borrowed a radio out of the kit" case worth surfacing.

Snapshot rather than a reference to `utc_def_line` rows: defs stay editable and
`utc_instance.utc_def_id` is nullable-on-delete, so pointing at them would let a
later catalog edit rewrite what a past deployment expected.

Existing deployed UTCs get no rows, which reads as "no expectation recorded"
rather than "expected nothing" — the completeness endpoint reports `unknown` for
those instead of inventing a baseline from the def.

Revision ID: 0045_utc_instance_lines
Revises: 0044_equipment_type_tags
Create Date: 2026-08-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0045_utc_instance_lines"
down_revision = "0044_equipment_type_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "utc_instance_line",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("utc_instance_id", sa.BigInteger(), nullable=False),
        sa.Column("equipment_type_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
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
            ["utc_instance_id"], ["utc_instance.id"], ondelete="CASCADE"
        ),
        # RESTRICT, matching `equipment.equipment_type_id`: a catalog row with
        # deployments referencing it must be retired, not deleted.
        sa.ForeignKeyConstraint(
            ["equipment_type_id"], ["equipment_type.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "utc_instance_id",
            "equipment_type_id",
            name="uq_utc_instance_line_type",
        ),
    )
    op.create_index(
        "ix_utc_instance_line_utc_instance_id",
        "utc_instance_line",
        ["utc_instance_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_utc_instance_line_utc_instance_id", table_name="utc_instance_line"
    )
    op.drop_table("utc_instance_line")
