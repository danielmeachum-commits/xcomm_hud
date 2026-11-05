"""Let a UTC definition declare the services it provides, pre-wired to its gear.

Two new tables under `utc_def`:

* `utc_def_service` — one row per service template the UTC brings up. The
  template carries the enclave, so "NIPR Web" and "SIPR Web" are already two
  rows without the line needing its own enclave column.
* `utc_def_service_wire` — which equipment capability backs that service, with
  the `required` / `group_key` the live `capability_service_link` carries.

A wire names its equipment line by (equipment type, enclave) rather than by
`utc_def_line.id`, and its capability by kind rather than by
`equipment_type_capability.id`. Both of those tables are saved by deleting and
re-inserting every row, so an id FK would either cascade the wiring away on
every LOGDET edit or block the edit outright. The natural keys are what the
line and capability constraints already make unique, and they are what the
deploy wizard has in hand when it matches items to wiring.

Separately, criticality (`category`) becomes per delivery. It is chosen when a
package deploys, and the same service can be critical at the main site and
sustainment at an extension — the precedent `enabled_pace` already set by
living on the delivery. `service.category` stays as the default a new delivery
starts from; every existing delivery is backfilled from its service, so nothing
reads differently after the upgrade.

Revision ID: 0068_utc_def_services
Revises: 0067_global_roster
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0068_utc_def_services"
down_revision = "0067_global_roster"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_delivery",
        sa.Column(
            "category",
            sa.String(24),
            nullable=False,
            server_default=sa.text("'other'"),
        ),
    )
    op.execute(
        """
        UPDATE service_delivery d
           SET category = s.category
          FROM service s
         WHERE s.id = d.service_id
        """
    )

    op.create_table(
        "utc_def_service",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "utc_def_id",
            sa.BigInteger,
            sa.ForeignKey("utc_def.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        # RESTRICT: deleting a template a UTC still provides would silently
        # drop the line, and the router answers that with a 409 instead.
        sa.Column(
            "service_template_id",
            sa.BigInteger,
            sa.ForeignKey("service_template.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("display_order", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint(
            "utc_def_id", "service_template_id", name="uq_utc_def_service_template"
        ),
    )

    op.create_table(
        "utc_def_service_wire",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "utc_def_service_id",
            sa.BigInteger,
            sa.ForeignKey("utc_def_service.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "equipment_type_id",
            sa.BigInteger,
            sa.ForeignKey("equipment_type.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # SET NULL to match `utc_def_line.enclave_id`, so a deleted enclave
        # untags the wire and the line together and they still match.
        sa.Column(
            "enclave_id",
            sa.BigInteger,
            sa.ForeignKey("enclave.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("capability_kind", sa.String(16), nullable=False),
        sa.Column(
            "role", sa.String(16), nullable=False, server_default=sa.text("'endpoint'")
        ),
        sa.Column(
            "required", sa.Boolean, nullable=False, server_default=sa.text("false")
        ),
        sa.Column("group_key", sa.String(48), nullable=True),
    )
    op.create_index(
        "uq_utc_def_service_wire_target",
        "utc_def_service_wire",
        ["utc_def_service_id", "equipment_type_id", "enclave_id", "capability_kind"],
        unique=True,
        postgresql_nulls_not_distinct=True,
    )


def downgrade() -> None:
    op.drop_index("uq_utc_def_service_wire_target", table_name="utc_def_service_wire")
    op.drop_table("utc_def_service_wire")
    op.drop_table("utc_def_service")
    op.drop_column("service_delivery", "category")
