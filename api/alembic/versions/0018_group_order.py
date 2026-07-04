"""Persist an ordered list of group names on each template.

Groups on `site_property_definition.group` are still freeform strings; this
column just records the order sections should appear in and lets the UI
carry an empty group (one with no fields yet) between edits.

Revision ID: 0018_group_order
Revises: 0017_backfill_second_subject
Create Date: 2026-07-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "0018_group_order"
down_revision = "0017_backfill_second_subject"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "site_property_template",
        sa.Column(
            "group_order",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("site_property_template", "group_order")
