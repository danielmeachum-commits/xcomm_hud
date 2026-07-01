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
from models import User
from routers import (
    auth,
    canvas,
    enclave_sources,
    events,
    gateways,
    ingest,
    service_templates,
    services,
    sites,
    status as status_router,
    users,
)
from schemas import MeOut

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        _seed_admin(db)
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
app.include_router(sites.router)
app.include_router(services.router)
app.include_router(service_templates.router)
app.include_router(gateways.router)
app.include_router(canvas.router)
app.include_router(status_router.router)
app.include_router(events.router)
app.include_router(ingest.router)
app.include_router(users.router)
app.include_router(enclave_sources.router)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/me", response_model=MeOut)
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return MeOut(
        user_id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        role=current_user.role,
    )
