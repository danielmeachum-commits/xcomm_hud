"""Give personnel activity its own event_type instead of "validation".

Personnel check-in/out has always written its own PersonnelLocationEvent
history row, but it also dual-writes into the shared validation/Event feed
tagged as event_type="validation" with subject_kind="personnel_location" —
riding inside the same bucket as service/gateway/site validations. Split it
into a distinct event_type="personnel" so the Events feed can group and
filter it separately.

Backfills existing rows so history stays consistent with newly-written ones.

Revision ID: 0023_personnel_event_type
Revises: 0022_personnel_guest
Create Date: 2026-07-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0023_personnel_event_type"
down_revision = "0022_personnel_guest"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE validation SET event_type = 'personnel' "
            "WHERE subject_kind = 'personnel_location' AND event_type = 'validation'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE validation SET event_type = 'validation' "
            "WHERE subject_kind = 'personnel_location' AND event_type = 'personnel'"
        )
    )
