"""Give an enclave an associated classification level.

0047 established that an enclave is NOT a classification level, and that still
holds: this is an attribute an enclave HAS, not what defines it. A `SECRET`
marking and "is on SIPR" answer different questions — the column only records
what a network is generally understood to carry, for display. Deliberately no
ordering, no severity, no ranking, and no link to the classification banner
tints; nothing in the app branches on this value.

The vocabulary is static (schemas.Classification), not a managed lookup table —
the levels are stable enough that a table would be ceremony around a constant.

Nullable because an enclave need not declare one: Transport is the transport
layer everything rides on, and realistically carries no marking of its own.

Backfill touches only the seeded global rows (workspace_id IS NULL) that have
said nothing yet, so a workspace that already set a value keeps it.

Revision ID: 0052_enclave_classification
Revises: 0051_line_enclave_uniqueness
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0052_enclave_classification"
down_revision = "0051_line_enclave_uniqueness"
branch_labels = None
depends_on = None


# Transport is absent on purpose — NULL is its correct answer, not an omission.
_SEED = {
    "NIPR": "unclassified",
    "SIPR": "secret",
    "ACBN": "secret",
    "BICES": "secret",
    "Coalition": "secret",
}


def upgrade() -> None:
    op.add_column(
        "enclave", sa.Column("classification", sa.String(16), nullable=True)
    )
    for name, level in _SEED.items():
        op.execute(
            sa.text(
                "UPDATE enclave SET classification = :level "
                "WHERE name = :name "
                "AND workspace_id IS NULL AND classification IS NULL"
            ).bindparams(level=level, name=name)
        )


def downgrade() -> None:
    op.drop_column("enclave", "classification")
