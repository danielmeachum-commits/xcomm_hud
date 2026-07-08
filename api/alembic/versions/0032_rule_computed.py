"""Computed values on rules.

A rule may define named computed fields — string templates or value
expressions evaluated against the enriched trigger payload — which then
feed its conditions and actions like any other field.

Revision ID: 0032_rule_computed
Revises: 0031_rules_engine
Create Date: 2026-07-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0032_rule_computed"
down_revision = "0031_rules_engine"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rule",
        sa.Column(
            "computed", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
    )


def downgrade() -> None:
    op.drop_column("rule", "computed")
