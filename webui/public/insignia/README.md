# Personnel Insignia Assets

Drop image files here. The web UI resolves them at runtime; missing files fall
back to the lucide branch icon so you can populate this tree incrementally.

Recommended source: <https://www.war.gov/resources/insignia/> (public domain
US Gov works).

## Directory layout

```
insignia/
├── branches/            ← branch seals / service marks
│   ├── air_force.png
│   ├── army.png
│   ├── navy.png
│   ├── marines.png
│   ├── space_force.png
│   └── coast_guard.png
└── ranks/
    ├── air_force/
    │   ├── AB.png       ← file named after the rank `short` field
    │   ├── Amn.png
    │   ├── A1C.png
    │   ├── SrA.png
    │   ├── SSgt.png
    │   ├── TSgt.png
    │   ├── MSgt.png
    │   ├── SMSgt.png
    │   ├── CMSgt.png
    │   ├── 2d Lt.png
    │   ├── 1st Lt.png
    │   ├── Capt.png
    │   ├── Maj.png
    │   ├── Lt Col.png
    │   ├── Col.png
    │   ├── Brig Gen.png
    │   ├── Maj Gen.png
    │   ├── Lt Gen.png
    │   └── Gen.png
    ├── army/
    │   ├── PVT.png
    │   ├── PV2.png
    │   ├── PFC.png
    │   ├── SPC.png      ← two different insignia at E-4
    │   ├── CPL.png      ←
    │   ├── SGT.png
    │   ├── ... etc
    ├── navy/
    ├── marines/
    ├── space_force/
    └── coast_guard/
```

## Naming convention

- Branch seals: `branches/{branch}.png` where branch is `air_force`, `army`,
  `navy`, `marines`, `space_force`, or `coast_guard`.
- Rank files: `ranks/{branch}/{stem}.png`. The **stem is arbitrary** — it does
  not have to match the abbreviation. Each rank entry in
  `webui/lib/personnel-data.ts` carries an explicit `insignia:` field naming
  its file. The Air Force set uses a `{grade}-{descriptive-name}` scheme, e.g.:

  ```
  E-2-airman.png
  E-5-staff-sergeant.png
  E-7-master-sergeant.png
  E-7-master-sergeant-First-Sergeant.png      ← First Sergeant (diamond) variant
  E-9-command-chief-master-sergeant.png
  E-9-chief-master-sergeant-of-the-air-force.png
  W1-warrant-officer-1.png                     ← note: W1, not W-1
  O-3-captain.png
  O-7-Brigadier-General.png                    ← capitalization varies; match exactly
  General-of-the-Air-Force.png
  ```

- **To add a new branch's files:** drop the PNGs in `ranks/{branch}/`, then
  tell Claude the filenames (or add an `insignia:` field to each rank entry in
  `personnel-data.ts` yourself). Until an entry has an `insignia` field, that
  rank falls back to the lucide branch icon.
- Extension: **`.png`** by default. Change `INSIGNIA_EXT` in
  `webui/lib/personnel-data.ts` if you use `.svg` instead.

## Fallback behavior

- Missing rank file → falls back to the lucide branch icon
  (Plane / Shield / Anchor / Star / Rocket / LifeBuoy)
- Missing branch seal → falls back to the same lucide icon
- Civilian personnel → always render the `User` lucide icon (no seal lookup)
