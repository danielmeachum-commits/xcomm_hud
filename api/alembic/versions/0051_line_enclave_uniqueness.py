"""Let a UTC list the same equipment type once per enclave.

Both line tables were UNIQUE on (parent, equipment_type_id), which predates
enclaves and made "2 switches for NIPR, 2 for SIPR" inexpressible — one line,
one enclave, one quantity of 4. Enclave tagging is what made that bite: the
deploy wizard's drop-a-stack step filters by line, so a merged line either
ships entirely or not at all.

Widened to (parent, equipment_type_id, enclave_id), plus a partial unique index
covering the untagged slice — Postgres treats NULLs as distinct in a UNIQUE
constraint, so without it a type could appear any number of times with no
enclave, which is the one case that really is a duplicate.

Revision ID: 0051_line_enclave_uniqueness
Revises: 0050_equipment_type_enclave
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0051_line_enclave_uniqueness"
down_revision = "0050_equipment_type_enclave"
branch_labels = None
depends_on = None

_TABLES = [
    ("utc_def_line", "utc_def_id", "uq_utc_def_line_type"),
    ("utc_instance_line", "utc_instance_id", "uq_utc_instance_line_type"),
]


def upgrade() -> None:
    for table, parent, old_name in _TABLES:
        op.drop_constraint(old_name, table, type_="unique")
        op.create_unique_constraint(
            f"{old_name}_enclave", table, [parent, "equipment_type_id", "enclave_id"]
        )
        op.create_index(
            f"{old_name}_no_enclave",
            table,
            [parent, "equipment_type_id"],
            unique=True,
            postgresql_where=sa.text("enclave_id IS NULL"),
        )


def downgrade() -> None:
    # Collapse any rows the widened constraint allowed, so the old narrower one
    # can be recreated. Quantities are summed and the lowest id keeps the row —
    # losing the enclave split is the honest cost of going back.
    for table, parent, old_name in _TABLES:
        op.execute(
            sa.text(
                f"""
                UPDATE {table} t SET quantity = agg.total
                  FROM (
                    SELECT MIN(id) AS keep_id,
                           SUM(quantity) AS total
                      FROM {table}
                     GROUP BY {parent}, equipment_type_id
                  ) agg
                 WHERE t.id = agg.keep_id
                """
            )
        )
        op.execute(
            sa.text(
                f"""
                DELETE FROM {table} t
                 WHERE t.id NOT IN (
                    SELECT MIN(id) FROM {table}
                     GROUP BY {parent}, equipment_type_id
                 )
                """
            )
        )
        op.drop_index(f"{old_name}_no_enclave", table_name=table)
        op.drop_constraint(f"{old_name}_enclave", table, type_="unique")
        op.create_unique_constraint(
            old_name, table, [parent, "equipment_type_id"]
        )
