"""Give a UTC definition a category — what kind of thing it is.

The app has only ever tracked XCOMM communications gear, so every UTC in the
table today is comm and nothing had to say so. Tracking the sets that keep that
gear alive — HVAC, PowerPro — breaks that assumption: those have no enclave to
divide their bill of materials along, and describing them enclave by enclave
describes nothing.

`package_def_utc.role_hint` already carries a `support` value documented as
"HVAC, PowerPro and the like", but that is a property of one MEMBERSHIP in one
package, not of the UTC. The same definition can be `support` in one package
and something else in another, and a comm UTC can be `alternate`. What kind of
thing a UTC *is* holds everywhere it appears, so it belongs here.

Backfilled to `comm` rather than `other`: every existing row really is comm
gear, and defaulting to `other` would strip the enclave view from UTCs that
have enclave-tagged lines right now.

No CHECK constraint, matching `equipment_type.category` and
`service.category` — the vocabulary lives in `schemas.UtcCategory`, and adding
a value should not need a migration.

Revision ID: 0061_utc_def_category
Revises: 0060_package_utc_role_uniqueness
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0061_utc_def_category"
down_revision = "0060_package_utc_role_uniqueness"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "utc_def",
        sa.Column(
            "category",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'comm'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("utc_def", "category")
