"""Rename enclave_source -> scoi_source.

The table registers upstream scoi instances allowed to push into /ingest
(scoi_url, ingest_token_hash, sync_status). scoi runs per-enclave, which is how
it picked up the name, but "which sibling instance do we pull from" is a
different question from "which network is this gear on" — and the second one is
about to get a real `enclave` table. Renaming first so one word means one thing.

Data-preserving: RENAME TO keeps rows, the primary key, and the unique index on
name. No application contract changes — the /ingest endpoint is still an unwired
stub and nothing in webui consumed /enclave-sources.

Revision ID: 0046_rename_scoi_source
Revises: 0045_utc_instance_lines
"""

from __future__ import annotations

from alembic import op

revision = "0046_rename_scoi_source"
down_revision = "0045_utc_instance_lines"
branch_labels = None
depends_on = None


def _rename_constraint(table: str, old: str, new: str) -> None:
    """RENAME CONSTRAINT has no IF EXISTS, and these names are only what the
    baseline's unnamed PrimaryKeyConstraint/UniqueConstraint happened to get
    from Postgres. Skip quietly rather than fail a migration over cosmetics."""
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = '{old}'
            ) THEN
                ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new};
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    op.rename_table("enclave_source", "scoi_source")
    _rename_constraint("scoi_source", "enclave_source_pkey", "scoi_source_pkey")
    _rename_constraint(
        "scoi_source", "enclave_source_name_key", "scoi_source_name_key"
    )


def downgrade() -> None:
    _rename_constraint(
        "scoi_source", "scoi_source_name_key", "enclave_source_name_key"
    )
    _rename_constraint("scoi_source", "scoi_source_pkey", "enclave_source_pkey")
    op.rename_table("scoi_source", "enclave_source")
