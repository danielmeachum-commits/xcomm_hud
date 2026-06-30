"""Canvas state for the React Flow map: site positions + annotations.

`GET /canvas/map` returns a single bundle of everything the /map page needs
so the client doesn't fan out to 4+ endpoints on every render.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import (
    CanvasAnnotation,
    Gateway,
    Service,
    Site,
    SiteCanvasPosition,
)
from rollup import site_status
from schemas import (
    CanvasAnnotationIn,
    CanvasAnnotationOut,
    CanvasAnnotationPatch,
    CanvasPositionIn,
    CanvasPositionOut,
    GatewayOut,
    MapBundle,
    ServiceOut,
    SiteOut,
)

router = APIRouter(prefix="/canvas", tags=["canvas"])


@router.get("/map", response_model=MapBundle)
def map_bundle(db: Session = Depends(get_db), _=Depends(requires("viewer"))):
    sites = db.query(Site).order_by(Site.name).all()
    services = db.query(Service).order_by(Service.name).all()
    gateways = db.query(Gateway).order_by(Gateway.site_id, Gateway.name).all()
    positions = db.query(SiteCanvasPosition).all()
    annotations = db.query(CanvasAnnotation).order_by(CanvasAnnotation.id).all()

    services_by_site: dict[int, list[Service]] = {}
    for s in services:
        if s.site_id is not None:
            services_by_site.setdefault(s.site_id, []).append(s)

    site_outs: list[SiteOut] = []
    for site in sites:
        out = SiteOut.model_validate(site)
        out.status = site_status(
            [s.status for s in services_by_site.get(site.id, [])]
        )
        site_outs.append(out)

    return MapBundle(
        sites=site_outs,
        positions=[
            CanvasPositionOut(site_id=p.site_id, x=p.x, y=p.y) for p in positions
        ],
        services=[ServiceOut.model_validate(s) for s in services],
        gateways=[GatewayOut.model_validate(g) for g in gateways],
        annotations=[CanvasAnnotationOut.model_validate(a) for a in annotations],
    )


@router.put("/positions/{site_id}", response_model=CanvasPositionOut)
def upsert_position(
    site_id: int,
    body: CanvasPositionIn,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    if db.get(Site, site_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    pos = db.get(SiteCanvasPosition, site_id)
    if pos is None:
        pos = SiteCanvasPosition(site_id=site_id, x=body.x, y=body.y)
        db.add(pos)
    else:
        pos.x = body.x
        pos.y = body.y
    db.flush()
    return CanvasPositionOut(site_id=site_id, x=pos.x, y=pos.y)


@router.get("/annotations", response_model=list[CanvasAnnotationOut])
def list_annotations(db: Session = Depends(get_db), _=Depends(requires("viewer"))):
    return db.query(CanvasAnnotation).order_by(CanvasAnnotation.id).all()


@router.post(
    "/annotations",
    response_model=CanvasAnnotationOut,
    status_code=status.HTTP_201_CREATED,
)
def create_annotation(
    body: CanvasAnnotationIn,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    ann = CanvasAnnotation(**body.model_dump())
    db.add(ann)
    db.flush()
    return ann


@router.patch("/annotations/{ann_id}", response_model=CanvasAnnotationOut)
def patch_annotation(
    ann_id: int,
    body: CanvasAnnotationPatch,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    ann = db.get(CanvasAnnotation, ann_id)
    if ann is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Annotation not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ann, k, v)
    db.flush()
    return ann


@router.delete("/annotations/{ann_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_annotation(
    ann_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    ann = db.get(CanvasAnnotation, ann_id)
    if ann is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Annotation not found")
    db.delete(ann)
