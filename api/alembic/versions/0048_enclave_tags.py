"""Tag equipment, services and UTC lines with an enclave.

Five nullable FKs, all ON DELETE SET NULL — retiring an enclave must never
delete the gear or services tagged with it.

Not tagged, deliberately:
  - equipment_capability: equipment is already 1:1 with an enclave, and a
    second tag could disagree with itself.
  - equipment_link: transport is shared; a link's enclave is derived from its
    endpoints.
  - gateway: transport tier.

Backfill is limited to rows we seeded ourselves and can name exactly
(0002/0003's service_template rows), by template link first and then by exact
name for the rows that predate template linkage. Everything else stays null
until a human tags it — an inferred-wrong enclave is worse than a null one.

Revision ID: 0048_enclave_tags
Revises: 0047_enclave
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0048_enclave_tags"
down_revision = "0047_enclave"
branch_labels = None
depends_on = None

_TAGGED = [
    ("equipment", "ix_equipment_enclave_id"),
    ("service", "ix_service_enclave_id"),
    ("service_template", None),
    ("utc_def_line", None),
    ("utc_instance_line", None),
]

# Exact seeded names only. "File Share" is deliberately absent — it is genuinely
# ambiguous, and guessing it wrong is worse than leaving it null.
_TEMPLATE_ENCLAVE = {
    "NIPR Web": "NIPR",
    "VoIP": "NIPR",
    "VoIP Chat": "NIPR",
    "SIPR Web": "SIPR",
    "VoSIP": "SIPR",
    "VoSIP Chat": "SIPR",
}


def upgrade() -> None:
    for table, index_name in _TAGGED:
        op.add_column(table, sa.Column("enclave_id", sa.BigInteger(), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_enclave_id",
            table,
            "enclave",
            ["enclave_id"],
            ["id"],
            ondelete="SET NULL",
        )
        # Index only where we filter by enclave: the equipment list and the
        # service list. The line tables are always read per-UTC.
        if index_name:
            op.create_index(index_name, table, ["enclave_id"])

    conn = op.get_bind()
    for name, enclave in _TEMPLATE_ENCLAVE.items():
        conn.execute(
            sa.text(
                """
                UPDATE service_template SET enclave_id = (
                    SELECT id FROM enclave
                     WHERE name = :enclave AND workspace_id IS NULL
                )
                WHERE name = :name
                """
            ),
            {"enclave": enclave, "name": name},
        )

    # Services created from a tagged template inherit it. This is the honest
    # relationship, so it runs first.
    conn.execute(
        sa.text(
            """
            UPDATE service s SET enclave_id = t.enclave_id
              FROM service_template t
             WHERE t.id = s.service_template_id
               AND t.enclave_id IS NOT NULL
               AND s.enclave_id IS NULL
            """
        )
    )
    # Services predating template linkage carry the name and nothing else.
    # Exact match against the same seeded list, never a prefix or LIKE.
    for name, enclave in _TEMPLATE_ENCLAVE.items():
        conn.execute(
            sa.text(
                """
                UPDATE service SET enclave_id = (
                    SELECT id FROM enclave
                     WHERE name = :enclave AND workspace_id IS NULL
                )
                WHERE name = :name AND enclave_id IS NULL
                """
            ),
            {"enclave": enclave, "name": name},
        )


def downgrade() -> None:
    for table, index_name in _TAGGED:
        if index_name:
            op.drop_index(index_name, table_name=table)
        op.drop_constraint(f"fk_{table}_enclave_id", table, type_="foreignkey")
        op.drop_column(table, "enclave_id")
