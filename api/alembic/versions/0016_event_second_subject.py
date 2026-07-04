"""Second subject id on events for paired-subject scoping.

Cell validations (service × gateway) previously only stored the service id
on the event, with the gateway spliced into ``subject_label``. That made
history-by-cell impossible without string matching. This adds a nullable
``second_subject_id`` column so paired subjects can be queried directly.

Revision ID: 0016_event_second_subject
Revises: 0015_site_property_templates
Create Date: 2026-07-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0016_event_second_subject"
down_revision = "0015_site_property_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "validation",
        sa.Column("second_subject_id", sa.BigInteger(), nullable=True),
    )
    op.create_index(
        "ix_validation_second_subject_id",
        "validation",
        ["second_subject_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_validation_second_subject_id", table_name="validation")
    op.drop_column("validation", "second_subject_id")
