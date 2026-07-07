"""CRUD, duplicate, and export/import for site property templates.

Templates are workspace-scoped and hold a list of typed property
`definitions` (text/number/phone/email/url/date/bool/long_text/personnel).
Applying a template copies its definitions onto a site — see
`sites.apply_property_template` for that flow.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from db import get_db
from deps import get_current_workspace, requires
from models import (
    SitePropertyDefinition,
    SitePropertyTemplate,
    Workspace,
)
from pubsub import notify
from schemas import (
    ExportedSitePropertyDefinition,
    RenameGroupIn,
    SitePropertyDefinitionIn,
    SitePropertyDefinitionOut,
    SitePropertyDefinitionPatch,
    SitePropertyTemplateDuplicateIn,
    SitePropertyTemplateExport,
    SitePropertyTemplateImportIn,
    SitePropertyTemplateIn,
    SitePropertyTemplateOut,
    SitePropertyTemplatePatch,
)

router = APIRouter(prefix="/site-property-templates", tags=["site-property-templates"])


def _load_template(
    db: Session, template_id: int, workspace: Workspace
) -> SitePropertyTemplate:
    t = db.get(SitePropertyTemplate, template_id)
    if t is None or t.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    return t


def _load_definition(
    db: Session, template: SitePropertyTemplate, definition_id: int
) -> SitePropertyDefinition:
    d = db.get(SitePropertyDefinition, definition_id)
    if d is None or d.template_id != template.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Definition not found")
    return d


@router.get("", response_model=list[SitePropertyTemplateOut])
def list_templates(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return (
        db.query(SitePropertyTemplate)
        .options(selectinload(SitePropertyTemplate.definitions))
        .filter(SitePropertyTemplate.workspace_id == workspace.id)
        .order_by(SitePropertyTemplate.name)
        .all()
    )


@router.post(
    "", response_model=SitePropertyTemplateOut, status_code=status.HTTP_201_CREATED
)
def create_template(
    body: SitePropertyTemplateIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    if (
        db.query(SitePropertyTemplate)
        .filter(
            SitePropertyTemplate.workspace_id == workspace.id,
            SitePropertyTemplate.name == body.name,
        )
        .first()
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Template name already exists")
    t = SitePropertyTemplate(workspace_id=workspace.id, **body.model_dump())
    db.add(t)
    db.flush()
    notify(background_tasks, "site_property_templates")
    return t


@router.get("/{template_id}", response_model=SitePropertyTemplateOut)
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return _load_template(db, template_id, workspace)


@router.patch("/{template_id}", response_model=SitePropertyTemplateOut)
def patch_template(
    template_id: int,
    body: SitePropertyTemplatePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    t = _load_template(db, template_id, workspace)
    patch = body.model_dump(exclude_unset=True)
    if "name" in patch and patch["name"] != t.name:
        if (
            db.query(SitePropertyTemplate)
            .filter(
                SitePropertyTemplate.workspace_id == workspace.id,
                SitePropertyTemplate.name == patch["name"],
            )
            .first()
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Template name already exists"
            )
    for k, v in patch.items():
        setattr(t, k, v)
    db.flush()
    notify(background_tasks, "site_property_templates")
    return t


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    t = _load_template(db, template_id, workspace)
    db.delete(t)
    notify(background_tasks, "site_property_templates")


# --- Definitions ---


@router.post(
    "/{template_id}/definitions",
    response_model=SitePropertyDefinitionOut,
    status_code=status.HTTP_201_CREATED,
)
def create_definition(
    template_id: int,
    body: SitePropertyDefinitionIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    t = _load_template(db, template_id, workspace)
    if (
        db.query(SitePropertyDefinition)
        .filter(
            SitePropertyDefinition.template_id == t.id,
            SitePropertyDefinition.key == body.key,
        )
        .first()
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Key already exists in template")
    d = SitePropertyDefinition(template_id=t.id, **body.model_dump())
    db.add(d)
    db.flush()
    notify(background_tasks, "site_property_templates")
    return d


@router.patch(
    "/{template_id}/definitions/{definition_id}",
    response_model=SitePropertyDefinitionOut,
)
def patch_definition(
    template_id: int,
    definition_id: int,
    body: SitePropertyDefinitionPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    t = _load_template(db, template_id, workspace)
    d = _load_definition(db, t, definition_id)
    patch = body.model_dump(exclude_unset=True)
    if "key" in patch and patch["key"] != d.key:
        if (
            db.query(SitePropertyDefinition)
            .filter(
                SitePropertyDefinition.template_id == t.id,
                SitePropertyDefinition.key == patch["key"],
            )
            .first()
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Key already exists in template"
            )
    for k, v in patch.items():
        setattr(d, k, v)
    db.flush()
    notify(background_tasks, "site_property_templates")
    return d


@router.delete(
    "/{template_id}/definitions/{definition_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_definition(
    template_id: int,
    definition_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    t = _load_template(db, template_id, workspace)
    d = _load_definition(db, t, definition_id)
    db.delete(d)
    notify(background_tasks, "site_property_templates")


# --- Groups ---


@router.post(
    "/{template_id}/rename-group", response_model=SitePropertyTemplateOut
)
def rename_group(
    template_id: int,
    body: RenameGroupIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    """Rename or delete a group atomically.

    Updates `group_order` and every `SitePropertyDefinition.group` matching
    `old` in one transaction. `new=None` removes the group; its
    definitions become ungrouped.
    """
    t = _load_template(db, template_id, workspace)
    old = body.old
    new = body.new

    # Rewrite group_order.
    order = list(t.group_order)
    if new is None:
        if old is not None and old in order:
            order.remove(old)
    else:
        if new in order and new != old:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Group name already exists"
            )
        if old is None:
            if new not in order:
                order.append(new)
        elif old in order:
            order[order.index(old)] = new
        else:
            # Old name isn't tracked yet — treat this as an add of `new`.
            order.append(new)
    t.group_order = order

    # Rewrite matching definitions.
    if old is not None:
        for d in (
            db.query(SitePropertyDefinition)
            .filter(
                SitePropertyDefinition.template_id == t.id,
                SitePropertyDefinition.group == old,
            )
            .all()
        ):
            d.group = new

    db.flush()
    notify(background_tasks, "site_property_templates")
    return t


# --- Duplicate / export / import ---


@router.post(
    "/{template_id}/duplicate",
    response_model=SitePropertyTemplateOut,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_template(
    template_id: int,
    body: SitePropertyTemplateDuplicateIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    source = _load_template(db, template_id, workspace)
    if (
        db.query(SitePropertyTemplate)
        .filter(
            SitePropertyTemplate.workspace_id == workspace.id,
            SitePropertyTemplate.name == body.name,
        )
        .first()
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Template name already exists")
    dest = SitePropertyTemplate(
        workspace_id=workspace.id,
        name=body.name,
        description=body.description if body.description is not None else source.description,
        group_order=list(source.group_order),
    )
    db.add(dest)
    db.flush()
    for d in source.definitions:
        db.add(
            SitePropertyDefinition(
                template_id=dest.id,
                key=d.key,
                label=d.label,
                type=d.type,
                required=d.required,
                group=d.group,
                description=d.description,
                display_order=d.display_order,
            )
        )
    db.flush()
    db.refresh(dest)
    notify(background_tasks, "site_property_templates")
    return dest


@router.get(
    "/{template_id}/export", response_model=SitePropertyTemplateExport
)
def export_template(
    template_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    t = _load_template(db, template_id, workspace)
    return SitePropertyTemplateExport(
        exported_at=datetime.datetime.now(datetime.timezone.utc),
        name=t.name,
        description=t.description,
        group_order=list(t.group_order),
        definitions=[
            ExportedSitePropertyDefinition(
                key=d.key,
                label=d.label,
                type=d.type,
                required=d.required,
                group=d.group,
                description=d.description,
                display_order=d.display_order,
            )
            for d in sorted(t.definitions, key=lambda x: x.display_order)
        ],
    )


@router.post(
    "/import",
    response_model=SitePropertyTemplateOut,
    status_code=status.HTTP_201_CREATED,
)
def import_template(
    body: SitePropertyTemplateImportIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    payload = body.payload
    name = body.name_override or payload.name
    if (
        db.query(SitePropertyTemplate)
        .filter(
            SitePropertyTemplate.workspace_id == workspace.id,
            SitePropertyTemplate.name == name,
        )
        .first()
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Template name already exists")
    # Guard against duplicate keys in the import envelope.
    keys = [d.key for d in payload.definitions]
    if len(set(keys)) != len(keys):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Duplicate keys in import"
        )
    t = SitePropertyTemplate(
        workspace_id=workspace.id,
        name=name,
        description=payload.description,
        group_order=list(payload.group_order),
    )
    db.add(t)
    db.flush()
    for d in payload.definitions:
        db.add(
            SitePropertyDefinition(
                template_id=t.id,
                key=d.key,
                label=d.label,
                type=d.type,
                required=d.required,
                group=d.group,
                description=d.description,
                display_order=d.display_order,
            )
        )
    db.flush()
    db.refresh(t)
    notify(background_tasks, "site_property_templates")
    return t
