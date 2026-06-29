"""FastAPI dependency factories for authz."""

from __future__ import annotations

from typing import Callable

from fastapi import Depends, HTTPException, status

from auth import get_current_user
from db import get_db  # noqa: F401  (re-exported)
from models import User

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
