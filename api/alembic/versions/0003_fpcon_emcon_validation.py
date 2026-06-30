"""FPCON/EMCON on site, drop service.hosting + cross-site, validation model.

Revision ID: 0003_fpcon_emcon_validation
Revises: 0002_categories_gateways_canvas
Create Date: 2026-06-29
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_fpcon_emcon_validation"
down_revision = "0002_categories_gateways_canvas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Site: drop classification, add fpcon + emcon
    with op.batch_alter_table("site") as b:
        b.add_column(
            sa.Column("fpcon", sa.String(16), nullable=False, server_default="normal")
        )
        b.add_column(
            sa.Column("emcon", sa.String(8), nullable=False, server_default="a")
        )
        b.drop_column("classification")

    # --- Drop classification from annotation (unused) for consistency
    with op.batch_alter_table("canvas_annotation") as b:
        b.drop_column("classification")

    # --- Service refactor
    # 1) Attach any null-site services to the lowest-id site (or delete if none).
    op.execute(
        """
        WITH default_site AS (SELECT id FROM site ORDER BY id LIMIT 1)
        UPDATE service SET site_id = (SELECT id FROM default_site)
        WHERE site_id IS NULL AND EXISTS (SELECT 1 FROM default_site)
        """
    )
    op.execute("DELETE FROM service WHERE site_id IS NULL")

    # 2) reach='both' folds to 'external' (those are the ones tied to gateways).
    op.execute("UPDATE service SET reach = 'external' WHERE reach = 'both'")

    # 3) Drop hosting; add description, validation tracking; tighten site_id.
    with op.batch_alter_table("service") as b:
        b.drop_column("hosting")
        b.add_column(sa.Column("description", sa.Text(), nullable=True))
        b.add_column(
            sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True)
        )
        b.add_column(sa.Column("validated_by_user_id", sa.BigInteger(), nullable=True))
        b.alter_column("site_id", existing_type=sa.BigInteger(), nullable=False)
        b.create_foreign_key(
            "fk_service_validated_by_user",
            "user",
            ["validated_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # service.site_id was ON DELETE SET NULL — rewrite to CASCADE now that it's required
    op.execute(
        "ALTER TABLE service DROP CONSTRAINT IF EXISTS service_site_id_fkey"
    )
    op.create_foreign_key(
        "service_site_id_fkey", "service", "site", ["site_id"], ["id"], ondelete="CASCADE"
    )

    # --- Gateway: add validation tracking
    with op.batch_alter_table("gateway") as b:
        b.add_column(
            sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True)
        )
        b.add_column(sa.Column("validated_by_user_id", sa.BigInteger(), nullable=True))
        b.create_foreign_key(
            "fk_gateway_validated_by_user",
            "user",
            ["validated_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # --- ServiceTemplate: drop default_hosting, add description
    with op.batch_alter_table("service_template") as b:
        b.drop_column("default_hosting")
        b.add_column(sa.Column("description", sa.Text(), nullable=True))

    # Re-seed templates: every entry is unambiguous local OR external; VoIP-style
    # services are local-only (the local call manager). For external-reach
    # variants the operator can add a custom service alongside.
    op.execute("DELETE FROM service_template")
    op.execute(
        """
        INSERT INTO service_template (name, kind, category, reach, icon, description) VALUES
            ('NIPR Web',   'data', 'core_critical_local', 'external', 'globe',          'Unclassified internet web access'),
            ('SIPR Web',   'data', 'core_critical_local', 'external', 'shield',         'Secret internet web access'),
            ('VoIP',       'voip', 'core_critical_local', 'local',    'phone',          'Local call manager and IP phones'),
            ('VoIP Chat',  'data', 'core_critical_local', 'local',    'message-square', 'Local chat over the VoIP infrastructure'),
            ('VoSIP',      'voip', 'core_critical_local', 'local',    'phone-call',     'Secret voice over IP'),
            ('VoSIP Chat', 'data', 'core_critical_local', 'local',    'lock',           'Secret chat')
        """
    )

    # --- Rename status_event → validation with cleaner column names
    op.rename_table("status_event", "validation")
    with op.batch_alter_table("validation") as b:
        b.alter_column("ts", new_column_name="validated_at")
        b.alter_column("old_state", new_column_name="prev_status")
        b.alter_column("new_state", new_column_name="status")
        b.alter_column("actor_user_id", new_column_name="validated_by_user_id")
    op.execute("ALTER INDEX IF EXISTS ix_status_event_ts RENAME TO ix_validation_validated_at")


def downgrade() -> None:
    op.execute(
        "ALTER INDEX IF EXISTS ix_validation_validated_at RENAME TO ix_status_event_ts"
    )
    with op.batch_alter_table("validation") as b:
        b.alter_column("validated_by_user_id", new_column_name="actor_user_id")
        b.alter_column("status", new_column_name="new_state")
        b.alter_column("prev_status", new_column_name="old_state")
        b.alter_column("validated_at", new_column_name="ts")
    op.rename_table("validation", "status_event")

    op.execute("DELETE FROM service_template")
    with op.batch_alter_table("service_template") as b:
        b.drop_column("description")
        b.add_column(
            sa.Column("default_hosting", sa.String(16), nullable=False, server_default="self")
        )

    with op.batch_alter_table("gateway") as b:
        b.drop_constraint("fk_gateway_validated_by_user", type_="foreignkey")
        b.drop_column("validated_by_user_id")
        b.drop_column("validated_at")

    op.execute(
        "ALTER TABLE service DROP CONSTRAINT IF EXISTS service_site_id_fkey"
    )
    with op.batch_alter_table("service") as b:
        b.drop_constraint("fk_service_validated_by_user", type_="foreignkey")
        b.drop_column("validated_by_user_id")
        b.drop_column("validated_at")
        b.drop_column("description")
        b.add_column(
            sa.Column("hosting", sa.String(16), nullable=False, server_default="self")
        )
        b.alter_column("site_id", existing_type=sa.BigInteger(), nullable=True)
    op.create_foreign_key(
        "service_site_id_fkey", "service", "site", ["site_id"], ["id"], ondelete="SET NULL"
    )

    with op.batch_alter_table("canvas_annotation") as b:
        b.add_column(sa.Column("classification", sa.String(8), nullable=True))

    with op.batch_alter_table("site") as b:
        b.add_column(
            sa.Column("classification", sa.String(8), nullable=False, server_default="U")
        )
        b.drop_column("emcon")
        b.drop_column("fpcon")
