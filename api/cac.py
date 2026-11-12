"""DoD ID card (CAC) barcodes, read down to the one field we keep: the EDIPI.

A CAC carries two barcodes, both plain ASCII when a keyboard-wedge scanner
types them:

  * Front, PDF417 — 88 chars (version "1") or 89 (version "N", which adds
    the middle initial). Layout, by offset:
        [0]       version            "1" | "N"
        [1:7]     PDI                base-32  (person designator — SSN-derived
                                               on older cards; never kept)
        [7]       PDI type
        [8:15]    EDIPI              base-32  (the 10-digit DoD ID number)
        [15:35]   first name         space padded
        [35:61]   last name          space padded
        [61:65]   date of birth      base-32 days since 1000-01-01 (never kept)
        [65]      personnel category
        [66]      branch
        [67:69]   entitlement condition
        [69:75]   rank               space padded
        [75:77]   pay plan
        [77:79]   pay grade
        [79:83]   card issue date    base-32 days since 1000-01-01
        [83:87]   card expiry date   base-32 days since 1000-01-01
        [87]      card instance id
        [88]      middle initial     (version "N" only)
  * Front, PDF417 version "M" — 99 chars, on cards issued now. A different
    order: the EDIPI comes first, names are mixed case.
        [0]       version            "M"
        [1:8]     EDIPI              base-32
        [8:16]    (8-char code — not read)
        [16:36]   first name         space padded
        [36]      middle initial
        [37:63]   last name          space padded
        [63:67]   date of birth      (never read)
        [70]      personnel category
        [71]      branch
        [72:74]   entitlement condition
        [74:80]   rank               space padded
        [80:82]   pay plan           ("ZZ" none)
        [82:84]   pay grade          ("NS" none)
        [84]      card instance id
        [85:89]   card issue date
        [89:93]   card expiry date
        [93:99]   PDI                (never read)
    Rank / pay plan / grade offsets are checked against a public sample card
    (the published field table had them shifted into the rank field).
  * Back, Code 39 — 18 chars: version "1", PDI(6), PDI type, EDIPI(7),
    personnel category, branch, card instance id.

Base-32 here is digits 0-9 then A-V. The layouts follow DMDC's "DoD ID Bar
Code SDK Formats" (v7.5) as reverse-engineered in the open-source
CACBarcode parser (jkusner/CACBarcode; version M from the colintrachte fork); DMDC doesn't publish it, so a card that doesn't fit is
reported as unreadable rather than guessed at. Someone can always type their
10-digit DoD ID (printed on the back of the card) instead.

Only the EDIPI is ever stored. The name, rank and expiry are returned so a
kiosk can greet an unenrolled card or warn on an expired one, and are
dropped after the request. The PDI and date of birth are never decoded.
"""

from __future__ import annotations

import datetime
import hashlib
import hmac
import os
import re
from dataclasses import dataclass
from typing import Literal, Optional

_EPOCH = datetime.date(1000, 1, 1)
_B32 = re.compile(r"^[0-9A-Va-v]+$")
# Scanners set to transmit an AIM symbology identifier prefix the data with
# "]" + code letter + modifier digit (]L0 PDF417, ]A0 Code 39).
_AIM_PREFIX = re.compile(r"^\][A-Za-z][0-9]")

_BRANCHES = {
    "A": "army",
    "C": "coast_guard",
    "F": "air_force",
    "M": "marines",
    "N": "navy",
    # Anything else (D DoD, H USPHS, O NOAA, 1-4 foreign, X other) leaves
    # branch unset. Space Force members' cards aren't in the published table.
}


@dataclass(frozen=True)
class CacScan:
    edipi: str  # 10 digits, zero padded
    source: Literal["pdf417", "code39", "typed"]
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    middle_initial: Optional[str] = None
    rank: Optional[str] = None
    branch: Optional[str] = None
    # "E-5", "O-3", "W-2", "GS-12" — from the pay plan + grade fields, which
    # are more regular than the free-text rank.
    pay_grade: Optional[str] = None
    # Personnel category: civil service, contractors, NAF and foreign
    # nationals are "civilian" in this app's terms.
    is_civilian: Optional[bool] = None
    expires_on: Optional[datetime.date] = None

    @property
    def display_name(self) -> Optional[str]:
        if not self.last_name:
            return None
        return f"{self.last_name}, {self.first_name}".rstrip(", ")

    def is_expired(self, today: datetime.date | None = None) -> bool:
        if self.expires_on is None:
            return False
        return self.expires_on < (today or datetime.date.today())


_MIL_PLANS = {"ME": "E", "MO": "O", "MW": "W"}
_CIVILIAN_CATEGORIES = set("CEIKOUY")


def _pay_grade(plan: str, grade: str) -> Optional[str]:
    plan, grade = plan.strip().upper(), grade.strip()
    if not grade.isdigit() or int(grade) == 0:
        return None
    if plan in _MIL_PLANS:
        return f"{_MIL_PLANS[plan]}-{int(grade)}"
    if plan in ("GS", "GG", "GM"):
        return f"GS-{int(grade)}"
    return None


def _b32(s: str) -> int:
    if not _B32.match(s):
        # No characters in the message: they'd be card data.
        raise ValueError("not base-32")
    return int(s, 32)


def _b32_date(s: str) -> Optional[datetime.date]:
    try:
        return _EPOCH + datetime.timedelta(days=_b32(s))
    except (ValueError, OverflowError):
        return None


def _edipi(s: str) -> str:
    value = _b32(s)
    if value <= 0 or value >= 10**10:
        raise ValueError("EDIPI out of range")
    return f"{value:010d}"


def _clean(raw: str) -> str:
    # Keep interior spaces: the PDF417 name fields are space padded and their
    # offsets matter. Only the scanner's terminator and wrapper chars go.
    data = raw.strip("\r\n\t\x00")
    data = _AIM_PREFIX.sub("", data, count=1)
    if len(data) >= 2 and data[0] == "*" and data[-1] == "*":
        data = data[1:-1]  # Code 39 start/stop characters, if transmitted
    return data


def parse_cac(raw: str) -> Optional[CacScan]:
    """A scan from either barcode, or a typed DoD ID. None when unreadable."""
    if not raw:
        return None
    data = _clean(raw)
    digits = data.strip().replace(" ", "").replace("-", "")
    if re.fullmatch(r"\d{10}", digits):
        return CacScan(edipi=digits, source="typed")

    try:
        # Version "N" with a blank middle initial can arrive as 88 chars when
        # the scanner trims trailing whitespace; treat it as version-1 shaped.
        if len(data) == 99 and data[0] == "M":
            mi = data[36].strip()
            return CacScan(
                edipi=_edipi(data[1:8]),
                source="pdf417",
                first_name=data[16:36].strip() or None,
                last_name=data[37:63].strip() or None,
                middle_initial=mi or None,
                rank=data[74:80].strip() or None,
                branch=_BRANCHES.get(data[71]),
                pay_grade=_pay_grade(data[80:82], data[82:84]),
                is_civilian=data[70] in _CIVILIAN_CATEGORIES,
                expires_on=_b32_date(data[89:93]),
            )
        if len(data) in (88, 89) and data[0] in ("1", "N"):
            mi = data[88].strip() if len(data) == 89 else ""
            return CacScan(
                edipi=_edipi(data[8:15]),
                source="pdf417",
                first_name=data[15:35].strip() or None,
                last_name=data[35:61].strip() or None,
                middle_initial=mi or None,
                rank=data[69:75].strip() or None,
                branch=_BRANCHES.get(data[66]),
                pay_grade=_pay_grade(data[75:77], data[77:79]),
                is_civilian=data[65] in _CIVILIAN_CATEGORIES,
                expires_on=_b32_date(data[83:87]),
            )
        if len(data) == 18 and data[0] == "1":
            return CacScan(
                edipi=_edipi(data[8:15]),
                source="code39",
                branch=_BRANCHES.get(data[16]),
                is_civilian=data[15] in _CIVILIAN_CATEGORIES,
            )
    except ValueError:
        return None
    return None


def describe_shape(raw: str) -> str:
    """What a scan looked like, without what it said — for diagnosing a card
    that won't parse. Lengths, character-class counts and control codes
    only; never the characters themselves (a CAC barcode carries DOB and an
    SSN-derived number). The first character is the format version marker."""
    data = _clean(raw or "")
    first = data[:1]
    counts = {
        "digits": sum(c.isdigit() for c in data),
        "upper": sum("A" <= c <= "Z" for c in data),
        "lower": sum("a" <= c <= "z" for c in data),
        "spaces": data.count(" "),
        "other": sum(
            (32 < ord(c) < 127) and not c.isalnum() for c in data
        ),
        "non_ascii": sum(ord(c) > 126 for c in data),
    }
    controls = sorted({ord(c) for c in data if ord(c) < 32})
    parts = [
        f"raw_len={len(raw or '')}",
        f"len={len(data)}",
        "first=" + (repr(first) if first.isalnum() else f"0x{ord(first):02x}" if first else "none"),
        *(f"{k}={v}" for k, v in counts.items()),
    ]
    if controls:
        parts.append("controls=" + ",".join(f"0x{c:02x}" for c in controls))
    if len(data) >= 15:
        slot = data[1:8] if first == "M" else data[8:15]
        parts.append(f"edipi_slot_b32={bool(_B32.match(slot))}")
    return " ".join(parts)


def normalize_edipi(value: Optional[str]) -> Optional[str]:
    """For form fields: blank → None; a 10-digit number or a whole scanned
    barcode → the 10-digit EDIPI. Raises ValueError on anything else."""
    if value is None or not str(value).strip():
        return None
    scan = parse_cac(str(value))
    if scan is None:
        raise ValueError(
            "DoD ID must be the 10-digit number on the card, or a scan of "
            "its barcode"
        )
    return scan.edipi


class IdKeyMissing(RuntimeError):
    """XCOMM_HUD_ID_KEY isn't set, so DoD IDs can't be hashed or matched."""


def edipi_hash(edipi: str) -> str:
    """The stored form of a DoD ID: HMAC-SHA256 under XCOMM_HUD_ID_KEY, hex.

    Matching a scan only needs equality, so the number itself is never
    stored. Keyed, not a plain hash: there are only 10^10 DoD IDs, so an
    unkeyed hash could be reversed by trying them all. Deterministic, so the
    database can index it and enforce one card per person.
    """
    key = os.environ.get("XCOMM_HUD_ID_KEY", "").strip()
    if not key:
        raise IdKeyMissing(
            "XCOMM_HUD_ID_KEY is not set — CAC enrollment and check-in are "
            "unavailable until it is (see .env.example)."
        )
    return hmac.new(key.encode(), edipi.encode(), hashlib.sha256).hexdigest()
