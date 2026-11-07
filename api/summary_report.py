"""Summary report: every site's status, services and gateways, as a PDF.

The printable answer to "where do we stand?" — a SITREP-style page per site
with the remarks typed at export time. Built server-side with ReportLab
(pure Python, works offline), from the SAME numbers the app shows: the status
rollup (`routers.status.rollup`, including each service's effective status
through its gateways) and the gateways router's own output, so derived
statuses resolve exactly as they do on screen. Nothing here recomputes a
status.

Remarks are not stored anywhere; they exist only in the PDF.
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
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session

from models import Gateway, Site, User, Workspace

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
