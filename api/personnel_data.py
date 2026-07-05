"""Static reference data for personnel: branches and their rank sets.

Used by the API for validation-lite (rank strings aren't strictly enforced,
but this lets us pre-populate a rank picker and serve the same catalog to
the web UI so both sides stay in sync). The webui mirrors this in
webui/lib/personnel-data.ts — keep them aligned.
"""

from __future__ import annotations

from typing import TypedDict


class RankEntry(TypedDict):
    grade: str  # E-1, O-3, W-2, GS-13, etc.
    short: str  # abbreviation shown on the pill
    full: str  # long form for the picker


# --- Air Force / Space Force share a nearly-identical rank ladder. ---

# First Sergeant (◆) is a special duty held by an E-7/E-8/E-9. Warrant officers
# were reintroduced by the Air Force in 2024. Kept in sync with the webui's
# webui/lib/personnel-data.ts, which also carries the insignia filenames.
_AF_ENLISTED: list[RankEntry] = [
    {"grade": "E-1", "short": "AB", "full": "Airman Basic"},
    {"grade": "E-2", "short": "Amn", "full": "Airman"},
    {"grade": "E-3", "short": "A1C", "full": "Airman First Class"},
    {"grade": "E-4", "short": "SrA", "full": "Senior Airman"},
    {"grade": "E-5", "short": "SSgt", "full": "Staff Sergeant"},
    {"grade": "E-6", "short": "TSgt", "full": "Technical Sergeant"},
    {"grade": "E-7", "short": "MSgt", "full": "Master Sergeant"},
    {"grade": "E-7", "short": "MSgt ◆", "full": "Master Sergeant (First Sergeant)"},
    {"grade": "E-8", "short": "SMSgt", "full": "Senior Master Sergeant"},
    {"grade": "E-8", "short": "SMSgt ◆", "full": "Senior Master Sergeant (First Sergeant)"},
    {"grade": "E-9", "short": "CMSgt", "full": "Chief Master Sergeant"},
    {"grade": "E-9", "short": "CMSgt ◆", "full": "Chief Master Sergeant (First Sergeant)"},
    {"grade": "E-9", "short": "CCM", "full": "Command Chief Master Sergeant"},
    {"grade": "E-9", "short": "CMSAF", "full": "Chief Master Sergeant of the Air Force"},
]

_AF_WARRANT: list[RankEntry] = [
    {"grade": "W-1", "short": "WO1", "full": "Warrant Officer 1"},
    {"grade": "W-2", "short": "CW2", "full": "Chief Warrant Officer 2"},
    {"grade": "W-3", "short": "CW3", "full": "Chief Warrant Officer 3"},
    {"grade": "W-4", "short": "CW4", "full": "Chief Warrant Officer 4"},
    {"grade": "W-5", "short": "CW5", "full": "Chief Warrant Officer 5"},
]

_AF_OFFICER: list[RankEntry] = [
    {"grade": "O-1", "short": "2d Lt", "full": "Second Lieutenant"},
    {"grade": "O-2", "short": "1st Lt", "full": "First Lieutenant"},
    {"grade": "O-3", "short": "Capt", "full": "Captain"},
    {"grade": "O-4", "short": "Maj", "full": "Major"},
    {"grade": "O-5", "short": "Lt Col", "full": "Lieutenant Colonel"},
    {"grade": "O-6", "short": "Col", "full": "Colonel"},
    {"grade": "O-7", "short": "Brig Gen", "full": "Brigadier General"},
    {"grade": "O-8", "short": "Maj Gen", "full": "Major General"},
    {"grade": "O-9", "short": "Lt Gen", "full": "Lieutenant General"},
    {"grade": "O-10", "short": "Gen", "full": "General"},
    {"grade": "Special", "short": "GAF", "full": "General of the Air Force"},
]

_SF_ENLISTED: list[RankEntry] = [
    {"grade": "E-1", "short": "Spc1", "full": "Specialist 1"},
    {"grade": "E-2", "short": "Spc2", "full": "Specialist 2"},
    {"grade": "E-3", "short": "Spc3", "full": "Specialist 3"},
    {"grade": "E-4", "short": "Spc4", "full": "Specialist 4"},
    {"grade": "E-5", "short": "Sgt", "full": "Sergeant"},
    {"grade": "E-6", "short": "TSgt", "full": "Technical Sergeant"},
    {"grade": "E-7", "short": "MSgt", "full": "Master Sergeant"},
    {"grade": "E-8", "short": "SMSgt", "full": "Senior Master Sergeant"},
    {"grade": "E-9", "short": "CMSgt", "full": "Chief Master Sergeant"},
]

_ARMY_ENLISTED: list[RankEntry] = [
    {"grade": "E-1", "short": "PVT", "full": "Private"},
    {"grade": "E-2", "short": "PV2", "full": "Private Second Class"},
    {"grade": "E-3", "short": "PFC", "full": "Private First Class"},
    {"grade": "E-4", "short": "SPC", "full": "Specialist"},
    {"grade": "E-4", "short": "CPL", "full": "Corporal"},
    {"grade": "E-5", "short": "SGT", "full": "Sergeant"},
    {"grade": "E-6", "short": "SSG", "full": "Staff Sergeant"},
    {"grade": "E-7", "short": "SFC", "full": "Sergeant First Class"},
    {"grade": "E-8", "short": "MSG", "full": "Master Sergeant"},
    {"grade": "E-8", "short": "1SG", "full": "First Sergeant"},
    {"grade": "E-9", "short": "SGM", "full": "Sergeant Major"},
    {"grade": "E-9", "short": "CSM", "full": "Command Sergeant Major"},
    {"grade": "E-9", "short": "SMA", "full": "Sergeant Major of the Army"},
]

_ARMY_WARRANT: list[RankEntry] = [
    {"grade": "W-1", "short": "WO1", "full": "Warrant Officer 1"},
    {"grade": "W-2", "short": "CW2", "full": "Chief Warrant Officer 2"},
    {"grade": "W-3", "short": "CW3", "full": "Chief Warrant Officer 3"},
    {"grade": "W-4", "short": "CW4", "full": "Chief Warrant Officer 4"},
    {"grade": "W-5", "short": "CW5", "full": "Chief Warrant Officer 5"},
]

_ARMY_OFFICER: list[RankEntry] = [
    {"grade": "O-1", "short": "2LT", "full": "Second Lieutenant"},
    {"grade": "O-2", "short": "1LT", "full": "First Lieutenant"},
    {"grade": "O-3", "short": "CPT", "full": "Captain"},
    {"grade": "O-4", "short": "MAJ", "full": "Major"},
    {"grade": "O-5", "short": "LTC", "full": "Lieutenant Colonel"},
    {"grade": "O-6", "short": "COL", "full": "Colonel"},
    {"grade": "O-7", "short": "BG", "full": "Brigadier General"},
    {"grade": "O-8", "short": "MG", "full": "Major General"},
    {"grade": "O-9", "short": "LTG", "full": "Lieutenant General"},
    {"grade": "O-10", "short": "GEN", "full": "General"},
]

_NAVY_ENLISTED: list[RankEntry] = [
    {"grade": "E-1", "short": "SR", "full": "Seaman Recruit"},
    {"grade": "E-2", "short": "SA", "full": "Seaman Apprentice"},
    {"grade": "E-3", "short": "SN", "full": "Seaman"},
    {"grade": "E-4", "short": "PO3", "full": "Petty Officer Third Class"},
    {"grade": "E-5", "short": "PO2", "full": "Petty Officer Second Class"},
    {"grade": "E-6", "short": "PO1", "full": "Petty Officer First Class"},
    {"grade": "E-7", "short": "CPO", "full": "Chief Petty Officer"},
    {"grade": "E-8", "short": "SCPO", "full": "Senior Chief Petty Officer"},
    {"grade": "E-9", "short": "MCPO", "full": "Master Chief Petty Officer"},
    {"grade": "E-9", "short": "MCPON", "full": "Master Chief Petty Officer of the Navy"},
]

_NAVY_WARRANT: list[RankEntry] = [
    {"grade": "W-2", "short": "CWO2", "full": "Chief Warrant Officer 2"},
    {"grade": "W-3", "short": "CWO3", "full": "Chief Warrant Officer 3"},
    {"grade": "W-4", "short": "CWO4", "full": "Chief Warrant Officer 4"},
    {"grade": "W-5", "short": "CWO5", "full": "Chief Warrant Officer 5"},
]

_NAVY_OFFICER: list[RankEntry] = [
    {"grade": "O-1", "short": "ENS", "full": "Ensign"},
    {"grade": "O-2", "short": "LTJG", "full": "Lieutenant Junior Grade"},
    {"grade": "O-3", "short": "LT", "full": "Lieutenant"},
    {"grade": "O-4", "short": "LCDR", "full": "Lieutenant Commander"},
    {"grade": "O-5", "short": "CDR", "full": "Commander"},
    {"grade": "O-6", "short": "CAPT", "full": "Captain"},
    {"grade": "O-7", "short": "RDML", "full": "Rear Admiral (Lower Half)"},
    {"grade": "O-8", "short": "RADM", "full": "Rear Admiral"},
    {"grade": "O-9", "short": "VADM", "full": "Vice Admiral"},
    {"grade": "O-10", "short": "ADM", "full": "Admiral"},
]

_MARINES_ENLISTED: list[RankEntry] = [
    {"grade": "E-1", "short": "Pvt", "full": "Private"},
    {"grade": "E-2", "short": "PFC", "full": "Private First Class"},
    {"grade": "E-3", "short": "LCpl", "full": "Lance Corporal"},
    {"grade": "E-4", "short": "Cpl", "full": "Corporal"},
    {"grade": "E-5", "short": "Sgt", "full": "Sergeant"},
    {"grade": "E-6", "short": "SSgt", "full": "Staff Sergeant"},
    {"grade": "E-7", "short": "GySgt", "full": "Gunnery Sergeant"},
    {"grade": "E-8", "short": "MSgt", "full": "Master Sergeant"},
    {"grade": "E-8", "short": "1stSgt", "full": "First Sergeant"},
    {"grade": "E-9", "short": "MGySgt", "full": "Master Gunnery Sergeant"},
    {"grade": "E-9", "short": "SgtMaj", "full": "Sergeant Major"},
    {"grade": "E-9", "short": "SgtMajMC", "full": "Sergeant Major of the Marine Corps"},
]

_MARINES_WARRANT: list[RankEntry] = [
    {"grade": "W-1", "short": "WO", "full": "Warrant Officer"},
    {"grade": "W-2", "short": "CWO2", "full": "Chief Warrant Officer 2"},
    {"grade": "W-3", "short": "CWO3", "full": "Chief Warrant Officer 3"},
    {"grade": "W-4", "short": "CWO4", "full": "Chief Warrant Officer 4"},
    {"grade": "W-5", "short": "CWO5", "full": "Chief Warrant Officer 5"},
]

_MARINES_OFFICER: list[RankEntry] = [
    {"grade": "O-1", "short": "2ndLt", "full": "Second Lieutenant"},
    {"grade": "O-2", "short": "1stLt", "full": "First Lieutenant"},
    {"grade": "O-3", "short": "Capt", "full": "Captain"},
    {"grade": "O-4", "short": "Maj", "full": "Major"},
    {"grade": "O-5", "short": "LtCol", "full": "Lieutenant Colonel"},
    {"grade": "O-6", "short": "Col", "full": "Colonel"},
    {"grade": "O-7", "short": "BGen", "full": "Brigadier General"},
    {"grade": "O-8", "short": "MajGen", "full": "Major General"},
    {"grade": "O-9", "short": "LtGen", "full": "Lieutenant General"},
    {"grade": "O-10", "short": "Gen", "full": "General"},
]

_COAST_GUARD_ENLISTED: list[RankEntry] = [
    {"grade": "E-1", "short": "SR", "full": "Seaman Recruit"},
    {"grade": "E-2", "short": "SA", "full": "Seaman Apprentice"},
    {"grade": "E-3", "short": "SN", "full": "Seaman"},
    {"grade": "E-4", "short": "PO3", "full": "Petty Officer Third Class"},
    {"grade": "E-5", "short": "PO2", "full": "Petty Officer Second Class"},
    {"grade": "E-6", "short": "PO1", "full": "Petty Officer First Class"},
    {"grade": "E-7", "short": "CPO", "full": "Chief Petty Officer"},
    {"grade": "E-8", "short": "SCPO", "full": "Senior Chief Petty Officer"},
    {"grade": "E-9", "short": "MCPO", "full": "Master Chief Petty Officer"},
    {"grade": "E-9", "short": "MCPOCG", "full": "Master Chief Petty Officer of the Coast Guard"},
]

_COAST_GUARD_OFFICER: list[RankEntry] = _NAVY_OFFICER

_CIVILIAN_RANKS: list[RankEntry] = [
    *[
        {"grade": f"GS-{n}", "short": f"GS-{n}", "full": f"General Schedule {n}"}
        for n in range(1, 16)
    ],
    {"grade": "SES", "short": "SES", "full": "Senior Executive Service"},
    {"grade": "SL", "short": "SL", "full": "Senior Level"},
    {"grade": "ST", "short": "ST", "full": "Scientific/Technical"},
]


BRANCH_LABELS: dict[str, str] = {
    "air_force": "Air Force",
    "army": "Army",
    "navy": "Navy",
    "marines": "Marine Corps",
    "space_force": "Space Force",
    "coast_guard": "Coast Guard",
}

RANKS_BY_BRANCH: dict[str, list[RankEntry]] = {
    "air_force": [*_AF_ENLISTED, *_AF_WARRANT, *_AF_OFFICER],
    "army": [*_ARMY_ENLISTED, *_ARMY_WARRANT, *_ARMY_OFFICER],
    "navy": [*_NAVY_ENLISTED, *_NAVY_WARRANT, *_NAVY_OFFICER],
    "marines": [*_MARINES_ENLISTED, *_MARINES_WARRANT, *_MARINES_OFFICER],
    "space_force": [*_SF_ENLISTED, *_AF_OFFICER],
    "coast_guard": [*_COAST_GUARD_ENLISTED, *_COAST_GUARD_OFFICER],
}

CIVILIAN_RANKS: list[RankEntry] = _CIVILIAN_RANKS

DEFAULT_BRANCH = "air_force"
