"""Split `service` into identity (Service) and location (ServiceDelivery).

`service.site_id` was NOT NULL and was a service's only identity, which
conflated *what a service is* with *where you can get it*. Every symptom the
redesign set out to fix came from that one column: equipment serving two sites
had nowhere to bind, an extension had to be stood up as its own UTC so its gear
had a site, and two sites' "NIPR Web" were unrelated rows that could not answer
"is NIPR up anywhere?".

The central trick, and the reason this migration is far less risky than it
looks: **each delivery keeps the id of the `service` row it came from.** Every
value in `capability_service_link.service_id` and
`service_gateway_status.service_id` already pointed at a per-site row, which is
exactly what a delivery is — so those columns are renamed in place and not one
foreign key value is remapped. The surviving identity row keeps the lowest id
of its group, in a different table with its own id space.

Grouping is (workspace_id, enclave_id, name) with NULLS NOT DISTINCT. Without
that flag Postgres treats NULL as never-equal, so two enclave-less services of
the same name would refuse to collapse and silently produce two identities
where one was intended.

Where members of a group disagree on an identity attribute (kind, category,
icon, description, template) the lowest id wins. That is arbitrary but
deterministic; disagreement is reported by the accompanying check script rather
than resolved cleverly, because a silent pick is how you lose data nobody
notices. `reach`, `enabled_pace`, `status`, `display_order` and `notes` are NOT
subject to this — they move to the delivery, where per-site difference is the
expected case. (Real data already disagreed: VoIP enabled three PACE tiers at
one site and four at another.)

Revision ID: 0054_service_delivery_split
Revises: 0053_unvalidated_status
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0054_service_delivery_split"
down_revision = "0053_unvalidated_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- 1. service gains a direct workspace, backfilled through its site ----
    op.add_column(
        "service", sa.Column("workspace_id", sa.BigInteger(), nullable=True)
    )
    op.execute(
        sa.text(
            "UPDATE service s SET workspace_id = si.workspace_id "
            "FROM site si WHERE si.id = s.site_id"
        )
    )
    op.alter_column("service", "workspace_id", nullable=False)
    op.create_foreign_key(
        "service_workspace_id_fkey",
        "service",
        "workspace",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_service_workspace_id", "service", ["workspace_id"])

    # ---- 2. the delivery table, seeded from today's per-site service rows ----
    op.create_table(
        "service_delivery",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("service_id", sa.BigInteger(), nullable=False),
        sa.Column("site_id", sa.BigInteger(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="local"),
        sa.Column("reach", sa.String(16), nullable=False, server_default="local"),
        sa.Column(
            "status", sa.String(16), nullable=False, server_default="unvalidated"
        ),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validated_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("enabled_pace", sa.dialects.postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["site.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["validated_by_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint("service_id", "site_id", name="uq_delivery_service_site"),
    )

    # id carried over verbatim — see the module docstring. service_id points at
    # the group's surviving row, which is why this runs before the losers are
    # deleted.
    op.execute(
        sa.text(
            """
            INSERT INTO service_delivery (
                id, service_id, site_id, source, reach, status, validated_at,
                validated_by_user_id, display_order, notes, enabled_pace,
                created_at, updated_at
            )
            SELECT
                s.id,
                MIN(s.id) OVER (
                    PARTITION BY s.workspace_id, s.enclave_id, s.name
                ),
                s.site_id,
                'local',
                s.reach,
                s.status,
                s.validated_at,
                s.validated_by_user_id,
                s.display_order,
                s.notes,
                s.enabled_pace,
                s.created_at,
                s.updated_at
            FROM service s
            """
        )
    )
    op.execute(
        sa.text(
            "SELECT setval(pg_get_serial_sequence('service_delivery', 'id'), "
            "COALESCE((SELECT MAX(id) FROM service_delivery), 1))"
        )
    )

    # ---- 3. repoint the two join tables (rename only; values already right) ----
    op.drop_constraint(
        "fk_capability_service_link_service",
        "capability_service_link",
        type_="foreignkey",
    )
    op.alter_column(
        "capability_service_link", "service_id", new_column_name="service_delivery_id"
    )
    op.create_foreign_key(
        "capability_service_link_service_delivery_id_fkey",
        "capability_service_link",
        "service_delivery",
        ["service_delivery_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint(
        "fk_service_gateway_status_service",
        "service_gateway_status",
        type_="foreignkey",
    )
    op.alter_column(
        "service_gateway_status", "service_id", new_column_name="service_delivery_id"
    )
    op.create_foreign_key(
        "service_gateway_status_service_delivery_id_fkey",
        "service_gateway_status",
        "service_delivery",
        ["service_delivery_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # ---- 4. collapse duplicate identities, then drop the moved columns ----
    # Losers go only after service_delivery.service_id has been pointed at the
    # survivor, so nothing is orphaned.
    op.execute(
        sa.text(
            "DELETE FROM service s WHERE s.id <> ("
            "  SELECT MIN(s2.id) FROM service s2"
            "  WHERE s2.workspace_id = s.workspace_id"
            "    AND s2.name = s.name"
            "    AND s2.enclave_id IS NOT DISTINCT FROM s.enclave_id"
            ")"
        )
    )
    op.create_foreign_key(
        "service_delivery_service_id_fkey",
        "service_delivery",
        "service",
        ["service_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_service_delivery_service_id", "service_delivery", ["service_id"]
    )
    op.create_index("ix_service_delivery_site_id", "service_delivery", ["site_id"])

    for column in (
        "site_id",
        "reach",
        "status",
        "validated_at",
        "validated_by_user_id",
        "display_order",
        "notes",
        "enabled_pace",
    ):
        op.drop_column("service", column)

    op.create_index(
        "uq_service_workspace_enclave_name",
        "service",
        ["workspace_id", "enclave_id", "name"],
        unique=True,
        postgresql_nulls_not_distinct=True,
    )


def downgrade() -> None:
    """Rebuild the per-site `service` table from deliveries.

    Lossy in one direction only: a service whose deliveries were merged from
    separate rows comes back as separate rows again, but any identity edit made
    after the split applies to all of them. That is inherent to un-merging.
    """
    op.drop_index("uq_service_workspace_enclave_name", table_name="service")

    op.add_column("service", sa.Column("site_id", sa.BigInteger(), nullable=True))
    op.add_column(
        "service", sa.Column("reach", sa.String(16), nullable=False, server_default="local")
    )
    op.add_column(
        "service",
        sa.Column("status", sa.String(16), nullable=False, server_default="unvalidated"),
    )
    op.add_column(
        "service", sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "service", sa.Column("validated_by_user_id", sa.BigInteger(), nullable=True)
    )
    op.add_column(
        "service",
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("service", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column(
        "service",
        sa.Column("enabled_pace", sa.dialects.postgresql.JSONB(), nullable=True),
    )

    # Recreate one service row per delivery, reusing the delivery id so the
    # join-table values stay valid on the way back too.
    op.execute(
        sa.text(
            """
            INSERT INTO service (
                id, workspace_id, service_template_id, name, kind, category,
                icon, description, enclave_id, site_id, reach, status,
                validated_at, validated_by_user_id, display_order, notes,
                enabled_pace, created_at, updated_at
            )
            SELECT
                d.id, s.workspace_id, s.service_template_id, s.name, s.kind,
                s.category, s.icon, s.description, s.enclave_id,
                d.site_id, d.reach, d.status, d.validated_at,
                d.validated_by_user_id, d.display_order, d.notes,
                d.enabled_pace, d.created_at, d.updated_at
            FROM service_delivery d
            JOIN service s ON s.id = d.service_id
            WHERE d.id <> d.service_id
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE service s SET
                site_id = d.site_id, reach = d.reach, status = d.status,
                validated_at = d.validated_at,
                validated_by_user_id = d.validated_by_user_id,
                display_order = d.display_order, notes = d.notes,
                enabled_pace = d.enabled_pace
            FROM service_delivery d
            WHERE d.id = s.id
            """
        )
    )
    op.execute(
        sa.text(
            "SELECT setval(pg_get_serial_sequence('service', 'id'), "
            "COALESCE((SELECT MAX(id) FROM service), 1))"
        )
    )
    op.alter_column("service", "site_id", nullable=False)
    op.alter_column("service", "enabled_pace", nullable=False)
    op.create_foreign_key(
        "service_site_id_fkey", "service", "site", ["site_id"], ["id"],
        ondelete="CASCADE",
    )

    # Constraint names here follow the repo's existing fk_<table>_<target>
    # convention, not Alembic's default — 0054 discovered the hard way that
    # they differ.
    for table, name in (
        ("capability_service_link", "fk_capability_service_link_service"),
        ("service_gateway_status", "fk_service_gateway_status_service"),
    ):
        op.drop_constraint(
            f"{table}_service_delivery_id_fkey", table, type_="foreignkey"
        )
        op.alter_column(table, "service_delivery_id", new_column_name="service_id")
        op.create_foreign_key(
            name, table, "service", ["service_id"], ["id"], ondelete="CASCADE",
        )

    op.drop_table("service_delivery")

    op.drop_index("ix_service_workspace_id", table_name="service")
    op.drop_constraint("service_workspace_id_fkey", "service", type_="foreignkey")
    op.drop_column("service", "workspace_id")
