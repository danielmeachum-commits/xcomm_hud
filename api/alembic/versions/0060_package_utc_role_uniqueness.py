"""Let a package list the same UTC once per role.

`uq_package_def_utc_pair` was UNIQUE on (package_def_id, utc_def_id), which
made a package carrying the same UTC in two roles inexpressible — a primary and
the alternate standing by to replace it are the same UTC definition twice, and
that is a real force structure, not a mistake.

Widened to (package_def_id, utc_def_id, role_hint). The narrower invariant
worth keeping is the one the old constraint was reaching for: the same UTC in
the *same* role twice is not a second row, it is a quantity of two. That is
what the new constraint still rejects, and `role_hint` is NOT NULL, so no
partial index is needed to cover a null slice.

Revision ID: 0060_package_utc_role_uniqueness
Revises: 0059_equipment_assets
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0060_package_utc_role_uniqueness"
down_revision = "0059_equipment_assets"
branch_labels = None
depends_on = None

_TABLE = "package_def_utc"
_OLD = "uq_package_def_utc_pair"
_NEW = "uq_package_def_utc_role"


def upgrade() -> None:
    op.drop_constraint(_OLD, _TABLE, type_="unique")
    op.create_unique_constraint(
        _NEW, _TABLE, ["package_def_id", "utc_def_id", "role_hint"]
    )


def downgrade() -> None:
    # Collapse any rows the widened constraint allowed, so the old narrower one
    # can be recreated. Quantities are summed and the lowest id keeps the row —
    # losing the role split is the honest cost of going back.
    op.execute(
        sa.text(
            f"""
            UPDATE {_TABLE} t SET quantity = agg.total
              FROM (
                SELECT MIN(id) AS keep_id,
                       SUM(quantity) AS total
                  FROM {_TABLE}
                 GROUP BY package_def_id, utc_def_id
              ) agg
             WHERE t.id = agg.keep_id
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            DELETE FROM {_TABLE} t
             WHERE t.id NOT IN (
                SELECT MIN(id) FROM {_TABLE}
                 GROUP BY package_def_id, utc_def_id
             )
            """
        )
    )
    op.drop_constraint(_NEW, _TABLE, type_="unique")
    op.create_unique_constraint(_OLD, _TABLE, ["package_def_id", "utc_def_id"])
