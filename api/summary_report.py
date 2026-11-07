"""Summary report: every site's status, services and gateways, as a PDF.

The printable answer to "where do we stand?" — a SITREP-style page per site
with the remarks typed at export time. Built server-side with ReportLab
(pure Python, works offline), from the SAME numbers the app shows: the status
rollup (`routers.status.rollup`, including each service's effective status
through its gateways) and the gateways router's own output, so derived
statuses resolve exactly as they do on screen. Nothing here recomputes a
status.

Remarks are not stored anywhere; they exist only in the PDF.

Optionally followed, from a new page, by an events log: the event feed
filtered by time, site, kind, severity, status and type, oldest first, read
through the events router's own enrichment so names and sites match the
Events page.
"""
from __future__ import annotations

import datetime
import io
from typing import Optional
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session

from models import Event, EventTypeDef, Gateway, Site, User, Workspace
from schemas import SummaryEventsLogIn

# The events log holds at most this many rows (the most recent ones). A PDF
# longer than ~50 pages isn't read; narrow the filters instead.
EVENTS_LOG_LIMIT = 2000

# Same words as the web UI's SUBJECT_KIND_LABELS (lib/event-type-labels.ts).
_SUBJECT_KIND_LABELS = {
    "workspace": "Workspace", "site": "Site", "site_status": "Site status",
    "site_fpcon": "FPCON", "site_emcon": "EMCON", "team": "Team", "unit": "Unit",
    "work_center": "Work center", "system": "System", "mission": "Mission",
    "exercise": "Exercise", "service": "Service", "gateway": "Gateway",
    "service_gateway": "Cell", "personnel_location": "Personnel",
    "document": "Document", "doc_page": "Doc page", "equipment": "Equipment",
    "equipment_capability": "Capability", "equipment_link": "Equipment link",
    "utc_instance": "UTC", "package_instance": "Package",
}

# Status words -> cell colour. Anything not listed (unvalidated, setup, ...)
# reads as "not known", in grey.
_GOOD = {"up", "active", "operational", "ready"}
_WARN = {"degraded", "limited", "standby"}
_BAD = {"down", "offline", "non_operational", "inoperative"}
_FILL = {
    "good": colors.HexColor("#d9f2e3"),
    "warn": colors.HexColor("#fdf0cf"),
    "bad": colors.HexColor("#f8d7d7"),
    "none": colors.HexColor("#ececec"),
}
_PACE_ORDER = {"primary": 0, "alternate": 1, "contingency": 2, "emergency": 3}


def _tone(status: Optional[str]) -> str:
    s = (status or "").lower()
    if s in _GOOD:
        return "good"
    if s in _WARN:
        return "warn"
    if s in _BAD:
        return "bad"
    return "none"


def _label(value: Optional[str]) -> str:
    return (value or "-").replace("_", " ").capitalize()


def _zulu(dt: Optional[datetime.datetime]) -> str:
    if dt is None:
        return "-"
    return dt.astimezone(datetime.timezone.utc).strftime("%d %b %y %H%MZ").upper()


class _NumberedCanvas(rl_canvas.Canvas):
    """Adds "Page N of M" — M is only known once every page is laid out."""

    footer_text = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved: list[dict] = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self.setFont("Helvetica", 7.5)
            self.setFillColor(colors.HexColor("#666666"))
            self.drawString(0.6 * inch, 0.45 * inch, self.footer_text)
            self.drawRightString(
                letter[0] - 0.6 * inch, 0.45 * inch,
                f"Page {self._pageNumber} of {total}",
            )
            super().showPage()
        super().save()


def build_summary_pdf(
    db: Session,
    workspace: Workspace,
    user: User,
    remark: str,
    site_remarks: dict[int, str],
    site_ids: Optional[list[int]] = None,
    events_log: Optional[SummaryEventsLogIn] = None,
) -> bytes:
    # Imported here: the routers import their own dependencies freely.
    from routers.gateways import _gateway_out
    from routers.status import rollup

    data = rollup(db=db, workspace=workspace, _=None)
    sites = data.sites
    if site_ids:
        wanted = set(site_ids)
        sites = [s for s in sites if s.id in wanted]
    site_rows = {s.id: s for s in db.query(Site).filter(Site.workspace_id == workspace.id)}
    gateways_by_site: dict[int, list] = {}
    for g in (
        db.query(Gateway)
        .join(Site, Site.id == Gateway.site_id)
        .filter(Site.workspace_id == workspace.id)
        .all()
    ):
        gateways_by_site.setdefault(g.site_id, []).append(_gateway_out(db, g))
    services_by_site: dict[int, list] = {}
    for s in data.services:
        services_by_site.setdefault(s.site_id, []).append(s)

    now = datetime.datetime.now(datetime.timezone.utc)
    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=9, leading=12)
    small = ParagraphStyle("small", parent=body, fontSize=8, leading=10, textColor=colors.HexColor("#555555"))
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=17, alignment=TA_LEFT, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12.5, spaceBefore=10, spaceAfter=3)
    cell = ParagraphStyle("cell", parent=body, fontSize=8.5, leading=10.5)

    story: list = [
        Paragraph(f"{escape(workspace.name)} - Status summary", h1),
        Paragraph(
            f"Generated {_zulu(now)} by {escape(user.username)}",
            small,
        ),
        Spacer(1, 8),
    ]

    if remark.strip():
        story.append(_boxed(Paragraph("<b>Remarks</b><br/>" + _paragraphs(remark), body)))
        story.append(Spacer(1, 8))

    # Totals across the sites in the report.
    in_report = {s.id for s in sites}
    services = [s for s in data.services if s.site_id in in_report]
    totals = {"good": 0, "warn": 0, "bad": 0, "none": 0}
    for s in services:
        totals[_tone(s.effective_status)] += 1
    story.append(
        Paragraph(
            f"<b>{len(sites)}</b> site{'s' if len(sites) != 1 else ''} &nbsp;·&nbsp; "
            f"<b>{len(services)}</b> services: {totals['good']} up, "
            f"{totals['warn']} degraded, {totals['bad']} down, "
            f"{totals['none']} not validated",
            body,
        )
    )

    for site in sites:
        row = site_rows.get(site.id)
        posture = [f"Status: <b>{_label(site.status)}</b>"]
        if site.show_fpcon:
            posture.append(f"FPCON {site.fpcon.upper()}")
        if site.show_emcon:
            posture.append(f"EMCON {site.emcon.upper()}")
        block: list = [
            Paragraph(escape(site.name), h2),
            Paragraph(" &nbsp;·&nbsp; ".join(posture), body),
        ]
        if row is not None and row.location_label:
            block.append(Paragraph(escape(row.location_label), small))
        site_remark = (site_remarks.get(site.id) or "").strip()
        if site_remark:
            block += [Spacer(1, 4), _boxed(Paragraph(_paragraphs(site_remark), body))]
        block.append(Spacer(1, 5))

        svc_rows = sorted(services_by_site.get(site.id, []), key=lambda s: (s.category != "critical", s.name.lower()))
        if svc_rows:
            table = [["Service", "Criticality", "Local", "Effective", "Validated"]]
            fills = []
            for i, s in enumerate(svc_rows, start=1):
                table.append([
                    Paragraph(escape(s.name), cell),
                    _label(s.category),
                    _label(s.status),
                    _label(s.effective_status),
                    _zulu(s.validated_at),
                ])
                fills.append((2, i, _tone(s.status)))
                fills.append((3, i, _tone(s.effective_status)))
            block.append(_table(table, [2.5 * inch, 0.95 * inch, 0.95 * inch, 0.95 * inch, 1.25 * inch], fills))
        else:
            block.append(Paragraph("No services at this site.", small))
        # Clear air between the two tables, or they read as one.
        block.append(Spacer(1, 10))

        gws = sorted(gateways_by_site.get(site.id, []), key=lambda g: (_PACE_ORDER.get(g.pace, 9), g.name.lower()))
        if gws:
            table = [["Gateway", "Kind", "PACE", "Status"]]
            fills = []
            for i, g in enumerate(gws, start=1):
                table.append([Paragraph(escape(g.name), cell), _label(g.kind), _label(g.pace), _label(g.status)])
                fills.append((3, i, _tone(g.status)))
            block.append(_table(table, [2.5 * inch, 1.25 * inch, 1.25 * inch, 1.6 * inch], fills))
        # A whole site on one page when it fits — a site's gateways stranded
        # at the top of the next page, away from its name, read as nobody's.
        # KeepTogether still splits a site that's longer than a page.
        story.append(KeepTogether(block))
        story.append(Spacer(1, 6))

    if not sites:
        story.append(Paragraph("No sites.", body))

    if events_log is not None:
        story.append(PageBreak())
        story += _events_log_story(db, workspace, events_log, h1, body, small, cell)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.6 * inch, bottomMargin=0.7 * inch,
        title=f"{workspace.name} - Status summary",
        author=user.username,
    )
    footer = f"{workspace.name} - Status summary - {_zulu(now)}"

    class _Canvas(_NumberedCanvas):
        footer_text = footer

    doc.build(story, canvasmaker=_Canvas)
    return buf.getvalue()


def _paragraphs(text: str) -> str:
    """Typed text into Paragraph markup: escaped, line breaks kept."""
    return "<br/>".join(escape(line) for line in text.strip().splitlines())


def _boxed(flowable) -> Table:
    t = Table([[flowable]], colWidths=[7.3 * inch])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#bbbbbb")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f7f7f7")),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _table(rows: list, widths: list, fills: list) -> Table:
    t = Table(rows, colWidths=widths, repeatRows=1)
    style = [
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e4e7eb")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c4c8cd")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for col, row, tone in fills:
        style.append(("BACKGROUND", (col, row), (col, row), _FILL[tone]))
    t.setStyle(TableStyle(style))
    return t


def _events_log_rows(db: Session, workspace: Workspace, f: SummaryEventsLogIn):
    """(rows oldest-first, total matching) for the events log filters."""
    from routers.events import _enrich

    q = db.query(Event).filter(
        (Event.workspace_id == workspace.id) | (Event.workspace_id.is_(None)),
        Event.hidden_at.is_(None),
    )
    if f.since:
        q = q.filter(Event.validated_at >= f.since)
    if f.until:
        q = q.filter(Event.validated_at <= f.until)
    if f.event_types:
        q = q.filter(Event.event_type.in_(f.event_types))
    if f.subject_kinds:
        q = q.filter(Event.subject_kind.in_(f.subject_kinds))
    if f.severities:
        q = q.filter(Event.severity.in_(f.severities))
    if f.statuses:
        q = q.filter(Event.status.in_(f.statuses))
    if f.type_slugs:
        q = q.filter(Event.type_slug.in_(f.type_slugs))
    if f.events_only:
        q = q.filter(Event.record_class == "event")
    q = q.order_by(Event.validated_at.desc(), Event.id.desc())
    if not f.site_ids:
        total = q.count()
        rows = [_enrich(db, e) for e in q.limit(EVENTS_LOG_LIMIT)]
    else:
        # The site lives on the subject (a service's site, a gateway's...), so
        # it's known only after enrichment — the same as GET /events?site_id.
        wanted = set(f.site_ids)
        matching = [o for o in (_enrich(db, e) for e in q) if o.site_id in wanted]
        total = len(matching)
        rows = matching[:EVENTS_LOG_LIMIT]
    rows.reverse()
    return rows, total


def _events_log_story(db, workspace, f, h1, body, small, cell) -> list:
    rows, total = _events_log_rows(db, workspace, f)
    type_labels = {
        t.slug: t.label
        for t in db.query(EventTypeDef).filter(
            (EventTypeDef.workspace_id == workspace.id) | (EventTypeDef.workspace_id.is_(None))
        )
    }
    site_names = {
        s.id: s.name for s in db.query(Site).filter(Site.workspace_id == workspace.id)
    }

    filters = []
    if f.since or f.until:
        filters.append(f"{_zulu(f.since) if f.since else 'start'} to {_zulu(f.until) if f.until else 'now'}")
    if f.site_ids:
        filters.append("sites: " + ", ".join(site_names.get(i, f"#{i}") for i in f.site_ids))
    if f.event_types:
        filters.append("kinds: " + ", ".join(_label(t) for t in f.event_types))
    if f.subject_kinds:
        filters.append("subjects: " + ", ".join(_SUBJECT_KIND_LABELS.get(k, _label(k)) for k in f.subject_kinds))
    if f.type_slugs:
        filters.append("types: " + ", ".join(type_labels.get(t, t) for t in f.type_slugs))
    if f.severities:
        filters.append("severity: " + ", ".join(_label(x) for x in f.severities))
    if f.statuses:
        filters.append("status: " + ", ".join(_label(x) for x in f.statuses))
    if f.events_only:
        filters.append("significant events only")

    story: list = [
        Paragraph("Events log", h1),
        Paragraph(escape("; ".join(filters)) if filters else "All events", small),
    ]
    shown = f"{len(rows)} event{'s' if len(rows) != 1 else ''}, oldest first"
    if total > len(rows):
        shown += f" (the most recent {len(rows)} of {total}; narrow the filters to see the rest)"
    story += [Paragraph(shown, small), Spacer(1, 6)]
    if not rows:
        story.append(Paragraph("No events match these filters.", body))
        return story

    tiny = ParagraphStyle("tiny", parent=cell, fontSize=7.5, leading=9)
    table = [["Time (Z)", "Site", "Event", "Status", "By", "Note"]]
    fills = []
    for i, e in enumerate(rows, start=1):
        kind = type_labels.get(e.type_slug or "") or _SUBJECT_KIND_LABELS.get(e.subject_kind, _label(e.subject_kind))
        what = f"<b>{escape(kind)}</b>"
        if e.subject_name and e.subject_name != kind:
            what += f"<br/>{escape(e.subject_name)}"
        if e.status:
            status_txt = _label(e.status)
            if e.prev_status and e.prev_status != e.status:
                status_txt = f"{_label(e.prev_status)} → {status_txt}"
            fills.append((3, i, _tone(e.status)))
        else:
            status_txt = "-"
        # Tag anything above routine, so a rule's notice reads differently
        # from the log line of the same change.
        sev_color = {"notice": "#1d4ed8", "warning": "#b45309", "critical": "#b42318"}.get(e.severity)
        if sev_color:
            what += f" <font color='{sev_color}'>({e.severity})</font>"
        table.append([
            Paragraph(_zulu(e.validated_at), tiny),
            Paragraph(escape(e.site_name or "-"), tiny),
            Paragraph(what, tiny),
            Paragraph(escape(status_txt), tiny),
            Paragraph(escape(e.validated_by_username or e.source), tiny),
            Paragraph(_paragraphs(e.note) if e.note else "", tiny),
        ])
    widths = [1.12 * inch, 0.9 * inch, 1.63 * inch, 1.15 * inch, 0.7 * inch, 1.8 * inch]
    t = _table(table, widths, fills)
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t)
    return story
