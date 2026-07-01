"""FastAPI dependency factories for authz and workspace scoping."""

from __future__ import annotations

from typing import Callable, Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user
from db import get_db
from models import User, Workspace

ROLE_ORDER = ["viewer", "operator", "admin"]


def _role_rank(role_name: str) -> int:
    try:
        return ROLE_ORDER.index(role_name)
    except ValueError:
        return -1


def requires(min_role: str) -> Callable:
    """Return a FastAPI dependency that enforces a minimum global role."""

    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if _role_rank(current_user.role) < _role_rank(min_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires {min_role} role",
            )
        return current_user

    return dependency


def get_current_workspace(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_workspace_slug: Optional[str] = Header(default=None),
) -> Workspace:
    """Resolve the workspace whose data the caller is currently viewing.

    Precedence:
      1. `X-Workspace-Slug` header (set by the frontend from `/w/<slug>/...`
         URLs — the URL is the source of truth when present).
      2. `user.current_workspace_id` (last-used, for landing on `/`).
      3. The `is_default` workspace as a final fallback. The 0012 migration
         guarantees exactly one default row exists.
    """
    if x_workspace_slug:
        ws = (
            db.query(Workspace)
            .filter(Workspace.slug == x_workspace_slug)
            .first()
        )
        if ws is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Workspace '{x_workspace_slug}' not found",
            )
        return ws

    if current_user.current_workspace_id is not None:
        ws = db.get(Workspace, current_user.current_workspace_id)
        if ws is not None:
            return ws

    ws = db.query(Workspace).filter(Workspace.is_default.is_(True)).first()
    if ws is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No default workspace configured",
        )
    return ws
