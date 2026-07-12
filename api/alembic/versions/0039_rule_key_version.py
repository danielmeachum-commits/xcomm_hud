"""Rules become code-owned: stable key + version, per-workspace disable.

Default rules move from a one-time seed (0031) to a canonical set in
api/default_rules.py that a startup reconcile upserts on every boot. That
needs a durable handle that survives across environments — the autoincrement
id isn't it — so this adds:

- rule.key      stable identity for global built-ins (NULL for workspace
                rules); one global row per key via a partial unique index.
- rule.version  definition version; the reconcile overwrites a stored global
                only when the code's version is higher.

It also adds workspace_rule_state so a workspace can turn a global rule off
for itself without mutating the shared row (the row is code-owned; to
customize, operators duplicate it into a workspace rule).

The seven rows seeded by 0031 are backfilled with keys at version 1, matching
default_rules.py — so the first post-deploy reconcile is a clean no-op.

Revision ID: 0039_rule_key_version
Revises: 0038_drop_doc_scope
Create Date: 2026-07-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0039_rule_key_version"
down_revision = "0038_drop_doc_scope"
branch_labels = None
depends_on = None


# name -> stable key for the rows seeded by 0031. Must match the keys in
# api/default_rules.py exactly, or the reconcile would insert duplicates.
_KEY_BY_NAME = {
    "Record service validations": "record-service-validations",
    "Record gateway validations": "record-gateway-validations",
    "Record cell validations": "record-cell-validations",
    "Record site status changes": "record-site-status-changes",
    "Record FPCON changes": "record-fpcon-changes",
    "Record EMCON changes": "record-emcon-changes",
    "Record personnel sign-ins": "record-personnel-signins",
}


def upgrade() -> None:
    op.add_column("rule", sa.Column("key", sa.String(length=64), nullable=True))
    op.add_column(
        "rule",
        sa.Column(
            "version", sa.Integer(), nullable=False, server_default="1"
        ),
    )

    # Backfill keys onto the existing global built-ins (workspace_id IS NULL).
    rule = sa.table(
        "rule",
        sa.column("name", sa.String()),
        sa.column("key", sa.String()),
        sa.column("workspace_id", sa.BigInteger()),
        sa.column("is_builtin", sa.Boolean()),
    )
    for name, key in _KEY_BY_NAME.items():
        op.execute(
            rule.update()
            .where(
                sa.and_(
                    rule.c.name == name,
                    rule.c.workspace_id.is_(None),
                    rule.c.is_builtin.is_(True),
                )
            )
            .values(key=key)
        )

    # One global row per key; workspace rules leave key NULL and are exempt.
    op.create_index(
        "uq_rule_global_key",
        "rule",
        ["key"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL AND key IS NOT NULL"),
    )

    op.create_table(
        "workspace_rule_state",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "workspace_id",
            sa.BigInteger(),
            sa.ForeignKey("workspace.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "rule_id",
            sa.BigInteger(),
            sa.ForeignKey("rule.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "disabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
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
        sa.UniqueConstraint(
            "workspace_id", "rule_id", name="uq_workspace_rule_state"
        ),
    )
    op.create_index(
        "ix_workspace_rule_state_workspace_id",
        "workspace_rule_state",
        ["workspace_id"],
    )
    op.create_index(
        "ix_workspace_rule_state_rule_id",
        "workspace_rule_state",
        ["rule_id"],
    )


def downgrade() -> None:
    op.drop_table("workspace_rule_state")
    op.drop_index("uq_rule_global_key", table_name="rule")
    op.drop_column("rule", "version")
    op.drop_column("rule", "key")
