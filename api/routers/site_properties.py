"""Per-site typed properties.

Values live under `/sites/{site_id}/properties`. Each row denormalizes
its own schema (label/type/required/group/description/display_order) so
sites can diverge from the template they were seeded from without
back-references. `source` records how the row got there — `template` if
copied by an apply, `custom` if added ad-hoc — for UI hinting only.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import Personnel, Site, SiteProperty, SitePropertyTemplate, Workspace
from pubsub import notify
from schemas import (
    SiteApplyTemplateIn,
    SitePropertyIn,
    SitePropertyOut,
    SitePropertyPatch,
    SitePropertyValueIn,
)

router = APIRouter(prefix="/sites/{site_id}/properties", tags=["site-properties"])


def _load_site(db: Session, site_id: int, workspace: Workspace) -> Site:
    site = db.get(Site, site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    return site


def _load_property(db: Session, site: Site, property_id: int) -> SiteProperty:
    p = db.get(SiteProperty, property_id)
    if p is None or p.site_id != site.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    return p


@router.get("", response_model=list[SitePropertyOut])
def list_properties(
    site_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    site = _load_site(db, site_id, workspace)
    return (
        db.query(SiteProperty)
        .filter(SiteProperty.site_id == site.id)
        .order_by(SiteProperty.display_order, SiteProperty.label)
        .all()
    )


@router.post("", response_model=SitePropertyOut, status_code=status.HTTP_201_CREATED)
def create_property(
    site_id: int,
    body: SitePropertyIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    site = _load_site(db, site_id, workspace)
    if (
        db.query(SiteProperty)
        .filter(SiteProperty.site_id == site.id, SiteProperty.key == body.key)
        .first()
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Key already exists on site")
    p = SiteProperty(site_id=site.id, source="custom", **body.model_dump())
    db.add(p)
    db.flush()
    notify(background_tasks)
    return p


@router.patch("/{property_id}", response_model=SitePropertyOut)
def patch_property(
    site_id: int,
    property_id: int,
    body: SitePropertyPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    site = _load_site(db, site_id, workspace)
    p = _load_property(db, site, property_id)
    patch = body.model_dump(exclude_unset=True)
    if "key" in patch and patch["key"] != p.key:
        if (
            db.query(SiteProperty)
            .filter(
                SiteProperty.site_id == site.id, SiteProperty.key == patch["key"]
            )
            .first()
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Key already exists on site"
            )
    for k, v in patch.items():
        setattr(p, k, v)
    db.flush()
    notify(background_tasks)
    return p


@router.put("/{property_id}/value", response_model=SitePropertyOut)
def set_property_value(
    site_id: int,
    property_id: int,
    body: SitePropertyValueIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    """Value-only write for the Details inline editor.

    Kept separate from PATCH so the common "edit a value" call has a tiny
    body and can't accidentally rename a key or change the type.
    """
    site = _load_site(db, site_id, workspace)
    p = _load_property(db, site, property_id)
    # Personnel-typed values are references, not freeform data — reject ids
    # that don't resolve to someone in this workspace.
    if p.type == "personnel" and body.value is not None:
        pid = (
            body.value
            if isinstance(body.value, int) and not isinstance(body.value, bool)
            else None
        )
        person = db.get(Personnel, pid) if pid is not None else None
        if person is None or person.workspace_id != workspace.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Personnel record not found in this workspace",
            )
    p.value = body.value
    db.flush()
    notify(background_tasks)
    return p


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_property(
    site_id: int,
    property_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    site = _load_site(db, site_id, workspace)
    p = _load_property(db, site, property_id)
    db.delete(p)
    notify(background_tasks)


@router.post("/apply-template", response_model=list[SitePropertyOut])
def apply_template(
    site_id: int,
    body: SiteApplyTemplateIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    """Copy a template's definitions onto the site.

    `mode="add"` — keep existing rows; only add keys that don't already
    exist. Values are not overwritten.

    `mode="replace"` — refresh all template-sourced rows: drop those whose
    keys are no longer in the template, add missing keys, update schema
    metadata (label, type, group, etc) on the rest. Existing values are
    preserved unless the type changes, in which case the value is cleared.
    Custom (ad-hoc) properties are left untouched either way.
    """
    site = _load_site(db, site_id, workspace)
    template = db.get(SitePropertyTemplate, body.template_id)
    if template is None or template.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")

    existing = {
        p.key: p
        for p in db.query(SiteProperty).filter(SiteProperty.site_id == site.id).all()
    }
    template_keys: set[str] = set()

    for d in template.definitions:
        template_keys.add(d.key)
        if d.key in existing:
            p = existing[d.key]
            if body.mode == "add" and p.source == "template":
                # Refresh schema metadata even in add mode so re-applying an
                # updated template can fix labels/types without a full replace.
                _copy_schema(p, d)
                if p.type != d.type:
                    p.value = None
                p.type = d.type
            elif body.mode == "replace" and p.source == "template":
                if p.type != d.type:
                    p.value = None
                _copy_schema(p, d)
                p.type = d.type
            # If it's a custom row with the same key, leave it alone in
            # either mode — operator-added fields take precedence.
        else:
            db.add(
                SiteProperty(
                    site_id=site.id,
                    key=d.key,
                    label=d.label,
                    type=d.type,
                    required=d.required,
                    group=d.group,
                    description=d.description,
                    display_order=d.display_order,
                    value=None,
                    source="template",
                )
            )

    if body.mode == "replace":
        for key, p in existing.items():
            if p.source == "template" and key not in template_keys:
                db.delete(p)

    db.flush()
    notify(background_tasks)
    return (
        db.query(SiteProperty)
        .filter(SiteProperty.site_id == site.id)
        .order_by(SiteProperty.display_order, SiteProperty.label)
        .all()
    )


def _copy_schema(p: SiteProperty, d) -> None:
    p.label = d.label
    p.required = d.required
    p.group = d.group
    p.description = d.description
    p.display_order = d.display_order
