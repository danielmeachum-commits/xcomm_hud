"""Slug generation for Workspace URLs.

Workspace slugs are lowercase, hyphen-separated, and unique. They are
generated once at creation from the workspace name and never rewritten,
so that shared `/w/<slug>/...` links keep working even after a rename.
"""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from models import Workspace

_SLUGIFY_RE = re.compile(r"[^a-z0-9]+")
_MAX_LEN = 64


def slugify(text: str) -> str:
    slug = _SLUGIFY_RE.sub("-", text.lower()).strip("-")
    if len(slug) > _MAX_LEN:
        slug = slug[:_MAX_LEN].rstrip("-")
    return slug or "workspace"


def unique_workspace_slug(db: Session, base_name: str) -> str:
    """Return a slug derived from `base_name` that isn't taken.

    Collisions are resolved by appending -2, -3, ... — cheap and predictable.
    """
    base = slugify(base_name)
    candidate = base
    n = 2
    while db.query(Workspace).filter(Workspace.slug == candidate).first() is not None:
        candidate = f"{base}-{n}"
        n += 1
    return candidate
