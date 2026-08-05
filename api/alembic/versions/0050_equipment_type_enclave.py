"""Which enclaves each equipment type is capable of serving.

The catalog/instance split the equipment tier already uses for capabilities:
the type declares what's possible, the instance records what's actually true.
A switch type can be capable of NIPR and SIPR; each physical switch is assigned
exactly one via equipment.enclave_id, because crypto separation means a box
serves one network at a time.

Empty means unrestricted, not "capable of nothing" — declaring nothing must not
stop an operator from tagging gear.

No backfill: nothing is known about which types are enclave-restricted, and an
inferred-wrong restriction would block assignments that are actually valid.

Revision ID: 0050_equipment_type_enclave
Revises: 0049_transport_black
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0050_equipment_type_enclave"
down_revision = "0049_transport_black"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "equipment_type_enclave",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("equipment_type_id", sa.BigInteger(), nullable=False),
        sa.Column("enclave_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["equipment_type_id"], ["equipment_type.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["enclave_id"], ["enclave.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "equipment_type_id", "enclave_id", name="uq_equipment_type_enclave"
        ),
    )
    op.create_index(
        "ix_equipment_type_enclave_type",
        "equipment_type_enclave",
        ["equipment_type_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_equipment_type_enclave_type", table_name="equipment_type_enclave"
    )
    op.drop_table("equipment_type_enclave")
