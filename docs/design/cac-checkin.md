# CAC check-in stations

Sign people in and out by scanning their Common Access Card at the door,
without anyone logged in to the app.

## Pieces

| Piece | Where |
|---|---|
| Barcode parser (PDF417 front, Code 39 back, typed DoD ID) | `api/cac.py` (mirrored in `webui/lib/cac.ts`) |
| `person.edipi_hash` — keyed hash of the DoD ID; the number itself is never stored | `0070`, hashed by `0072_hash_dod_ids` |
| `checkin_station` — a door: site, mode, token hash | same |
| `personnel_location_event.station_id` — which door | same |
| `kiosk_pending_scan` — unrecognized cards awaiting an operator | `0071_kiosk_pending_scans` |
| Unrecognized-cards queue (and kiosk guest requests) | top of the Personnel page (operators); `0073_kiosk_guest_requests` |
| Check-in log — door activity for the desk | Personnel → Check-in log (`/checkin-activity`) |
| Station admin + `/kiosk/*` API | `api/routers/kiosk.py` |
| Station admin page | Personnel → Check-in stations (`/w/<ws>/admin/checkin-stations`) |
| Kiosk client | `webui/public/kiosk.html` (static, no login) |
| DoD ID field (scan a card into it) | personnel form → Contact; roster dialog |

## Flow

1. **Enroll.** Scan the card into the person's DoD ID field (or type the 10
   digits from the back), or include an `edipi` / `dod_id` column in a roster
   CSV import. The field is write-only: it shows "CAC enrolled" with Re-scan
   and Remove, never the number. Operators can set it; other roster identity
   edits stay admin-only.
2. **Create a station** per entry point (admin): name, site, and mode:
   `toggle` (scan in, scan again out), `in` (entry door), or `out` (exit door).
   The kiosk link is shown once; it carries the token in the URL fragment.
3. **Open the link on the kiosk computer** with a USB scanner in keyboard (HID)
   mode, PDF417 and Code 39 enabled, Enter suffix. The page remembers the
   station. Keys are captured page-wide, so focus doesn't matter. Someone
   without a card types their DoD ID: each digit shows for a second and is
   then masked, and the tenth digit submits. A visitor with no CAC taps
   **Guest**, enters name / organization / who they're visiting, and the desk
   is notified. The kiosk shows only the person in front of it; the running
   activity is the app's **Check-in log**.
4. **Scan.** `POST /kiosk/scan` with `X-Station-Token` resolves the card to a
   person in the station's workspace and changes their status in one
   transaction (the personnel row is locked, so two doors can't interleave):

| Before | Station | Result |
|---|---|---|
| anything but on site here | toggle / in | `checked_in` — on site here |
| on site at **another** site | toggle / in | `moved` — one event ends the old site and starts this one |
| on site here | toggle / out | `checked_out` — `off_site` |
| same card, same station, < 20 s | any | `already` — double scan ignored |
| not on site | out | `already` |
| card nobody has | any | `unknown_card` — queued for an operator |
| roster person not in this picture | any | `not_in_workspace` — queued |
| — | — | `unreadable`, `stale` |

A person has a single current location, so checking in anywhere checks them
out of wherever they were.

Kiosk scans emit `personnel.location_changed` with `source_flow: "kiosk"`
and `prev_site_id`, so they reach the feed like any other check-in and rules
can filter on them.

## Unrecognized cards

The kiosk is unattended, so it never decides who a card belongs to. It
tells the person the desk has been notified and records the card in
`kiosk_pending_scan`: one row per card per workspace, with repeat scans
counted and moved to the latest door. The Personnel page shows these to
operators, who choose one of:

- **Link to roster.** An existing roster person without a DoD ID. Same-surname
  matches are suggested, and the operator confirms. The DoD ID is saved, the
  person is added to this picture if needed, and they're signed in.
- **Add to roster.** A new roster person, prefilled from the card: name,
  military or civilian (from personnel category), branch, and rank (from the
  card's rank text, else its pay grade, e.g. `E-5`).
- **Guest.** A local guest of this picture with the existing affiliation and
  escort fields. Their DoD ID is kept so the next scan here is recognized,
  without putting them on the unit's roster.
- **Add here** (for `not_in_workspace`). Adds the roster person the card
  already belongs to.
- **Dismiss.**

Resolving signs them in at the site and time of their latest scan, unless
it came from an exit-only door, the operator unticks it, or they've changed
status since. The row is then deleted, along with the name and rank it held
from the card.

## Offline

If the API can't be reached, the kiosk queues scans **in memory** as the
10-digit DoD ID plus time (nothing goes to browser storage), and replays them
oldest first with `scanned_at` — so a queue is lost if the kiosk page is
reloaded during the outage. A replayed scan older than the person's latest change is ignored
(`stale`); one more than 24 h old is applied at server time.

## The barcode

DMDC doesn't publish the CAC barcode layout. The parser follows the DoD ID Bar
Code SDK Formats v7.5 layout as reverse-engineered by the open-source
[CACBarcode](https://github.com/jkusner/CACBarcode) project:

- **PDF417 (front):** 88 chars (version `1`) or 89 (version `N`, + middle
  initial). EDIPI is 7 base-32 chars (`0-9A-V`) at offset 8. It also holds
  name, rank, branch, pay grade, card dates, **date of birth and a
  person-designator ID (SSN-derived on older cards)**.
- **PDF417 version `M` (front, current cards):** 99 chars. The EDIPI comes
  first (offset 1), names are mixed case; layout from the
  [colintrachte fork](https://github.com/colintrachte/CACBarcode). Rank text is
  at 74–80, pay plan 80–82 and grade 82–84 (the fork's table has these
  shifted; checked against its sample card).
- **Code 39 (back):** 18 chars. EDIPI at offset 8.

All numeric fields are base-32, not base64. An unreadable scan logs only its
shape (length, version character, character-class counts), never its content.

Only a keyed hash of the EDIPI is stored (`cac.edipi_hash`: HMAC-SHA256 under
`XCOMM_HUD_ID_KEY`). Matching needs only equality, so the number is never
kept, shown or returned — the API exposes `has_cac` instead. Keyed rather than
a plain hash because there are only 10^10 DoD IDs: an unkeyed hash could be
reversed by trying them all. Name, rank and expiry are read to greet or warn
at the kiosk and then dropped (the queue holds name and rank until resolved,
at most 7 days). DOB and the PDI are never decoded. A card that
doesn't match either layout is `unreadable`; the person can type their DoD ID
instead. Treat the format as unverified until it's been tried against real
cards. If a card generation differs, `parse_cac` is the one place to change.

## Security

- The station token is high-entropy and stored as SHA-256. Rotate it to cut
  off a lost kiosk; disable the station to pause it.
- A token only signs people in and out of one workspace and site, and shows
  names of people who scan. It can't read the roster.
- `XCOMM_HUD_ID_KEY` is separate from the session secret, so rotating that
  doesn't wipe enrollments. Back it up with the env file: lose it and every
  card must be re-enrolled. `gen-env.sh` and `xcomm.ps1` add it to an existing
  env file that predates it. Without it, CAC endpoints answer 503.
- Error responses never echo card input, and an unreadable scan is logged
  only as its shape.
