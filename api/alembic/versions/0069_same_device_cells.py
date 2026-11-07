"""Mark a service-via-gateway cell as "same device".

Some gateways ARE the device providing a service: a 117G radio doing MUOS
voice is both the MUOS gateway and the voice service on that path. Recording
that on the cell lets one gateway validation set the cell (and, when every
path of a service is such a device, the service's local status) instead of
three separate validations of one fact. See api/same_device.py.

Per cell, not per service, because one service can run over several PACE
tiers: Secure Voice over MUOS on the 117G (same device) as Primary, and over
VoSIP through separate gear as Alternate.

Revision ID: 0069_same_device_cells
Revises: 0068_utc_def_services
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0069_same_device_cells"
down_revision = "0068_utc_def_services"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_gateway_status",
        sa.Column(
            "same_device", sa.Boolean, nullable=False, server_default=sa.text("false")
        ),
    )


def downgrade() -> None:
    op.drop_column("service_gateway_status", "same_device")
