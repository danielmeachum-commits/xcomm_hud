"""xcomm_hud API — main application entry point."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from auth import get_current_user, hash_password
from db import SessionLocal, get_db
from default_rules import DEFAULT_RULES
from deps import get_current_workspace
from models import Rule, User, Workspace
from routers import (
    auth,
    canvas,
    doc_pages,
    doc_sections,
    documents,
    enclave_sources,
    event_types,
    events,
    folders,
    gateways,
    ingest,
    personnel,
    rules,
    service_gateway_status,
    service_templates,
    services,
    site_properties,
    site_property_templates,
    sites,
    status as status_router,
    teams,
    units,
    users,
    work_centers,
    workspaces,
)
from schemas import MeOut, WorkspaceOut

log = logging.getLogger("xcomm_hud.startup")
logging.basicConfig(level=logging.INFO)

DEFAULT_ADMIN_PASSWORD = "changeme"


def _seed_admin(db: Session) -> None:
    """Ensure the configured initial admin exists when the user table is empty."""
    if db.query(User).first() is not None:
        return
    username = os.environ.get("XCOMM_HUD_INITIAL_ADMIN_USER", "admin")
    password = os.environ.get("XCOMM_HUD_INITIAL_ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD)
    if password == DEFAULT_ADMIN_PASSWORD:
        log.warning(
            "XCOMM_HUD_INITIAL_ADMIN_PASSWORD is the default 'changeme'. "
            "Change it immediately in production."
        )
    db.add(
        User(
            username=username,
            password_hash=hash_password(password),
            display_name="System Admin",
            role="admin",
        )
    )
    log.info("Seeded initial admin user: %s", username)


def _reconcile_default_rules(db: Session) -> None:
    """Sync the global built-in rules to the canonical set in default_rules.py.

    Global rows (workspace_id NULL, is_builtin) are code-owned. Matching each
    spec to its row by stable `key`, this inserts new defaults and overwrites
    an existing row only when the code's `version` is higher — so unchanged
    rows, and any per-workspace disables layered on them, are never churned.
    A key dropped from code disables (never deletes) its row, preserving the
    rule_execution history that references it. Runs on every boot, so a
    default authored in code lands in every deployment on deploy.
    """
    specs = {spec["key"]: spec for spec in DEFAULT_RULES}
    existing = {
        row.key: row
        for row in db.query(Rule).filter(
            Rule.is_builtin.is_(True), Rule.workspace_id.is_(None)
        )
        if row.key is not None
    }
    for key, spec in specs.items():
        row = existing.get(key)
        if row is None:
            db.add(Rule(workspace_id=None, **spec))
            log.info("Reconcile: seeded default rule %r (v%s)", key, spec["version"])
        elif row.version < spec["version"]:
            for attr, value in spec.items():
                setattr(row, attr, value)
            log.info("Reconcile: updated default rule %r to v%s", key, spec["version"])
    for key, row in existing.items():
        if key not in specs and row.enabled:
            row.enabled = False
            log.info("Reconcile: disabled orphaned default rule %r", key)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        _seed_admin(db)
        _reconcile_default_rules(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    yield


app = FastAPI(title="xcomm_hud-api", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(workspaces.me_router)
app.include_router(sites.router)
app.include_router(site_property_templates.router)
app.include_router(site_properties.router)
app.include_router(services.router)
app.include_router(service_gateway_status.router)
app.include_router(service_templates.router)
app.include_router(gateways.router)
app.include_router(canvas.router)
app.include_router(status_router.router)
app.include_router(events.router)
app.include_router(event_types.router)
app.include_router(folders.router)
app.include_router(documents.router)
app.include_router(doc_pages.router)
app.include_router(doc_sections.router)
app.include_router(rules.router)
app.include_router(ingest.router)
app.include_router(users.router)
app.include_router(enclave_sources.router)
app.include_router(units.router)
app.include_router(work_centers.router)
app.include_router(teams.router)
app.include_router(personnel.router)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/me", response_model=MeOut)
def me(
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
    db: Session = Depends(get_db),
):
    workspaces_list = db.query(Workspace).order_by(Workspace.name).all()
    return MeOut(
        user_id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        role=current_user.role,
        current_workspace=WorkspaceOut.model_validate(current_workspace),
        workspaces=[WorkspaceOut.model_validate(w) for w in workspaces_list],
    )
