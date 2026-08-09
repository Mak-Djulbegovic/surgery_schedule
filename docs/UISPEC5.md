# Iteration 5 — NF schedule, day-float coverage, CPEC PO, dress code, new-year setup

Read docs/SPEC.md, docs/UISPEC2.md, docs/UISPEC3.md first. Keep everything
working (all tests, routing, persistence, output format except where stated).

## A. Night Float schedule + day-float coverage (js/data.js, js/engine.js, tests)

Source: the program's call-schedule Google Sheet ("Summer Interim Call '26" +
"PGY3 Call Schedule '26-'27" tabs). The NF resident works Sun–Thu nights for a
week at a time; while on NF, their normal daytime block duties are covered by
the Day Float resident.

Encode in data.js (weekly Mon–Sun ranges; missing weeks = not yet filled in
the sheet, later weeks TBD — the Setup import updates this):

```js
nfSchedule: {
  note: 'Weekly Night Float (Sun–Thu nights) from the PGY-3 call schedule. While on NF, the resident’s daytime duties are covered by Day Float. Weeks not listed are not yet assigned in the call sheet.',
  ranges: [
    { start: '2026-07-13', end: '2026-07-19', name: 'Cotton' },
    { start: '2026-07-20', end: '2026-07-26', name: 'Perez' },
    { start: '2026-07-27', end: '2026-08-02', name: 'Camacho' },
    { start: '2026-08-03', end: '2026-08-09', name: 'Williamson' },
    { start: '2026-08-10', end: '2026-08-16', name: 'Tang' },
    { start: '2026-08-17', end: '2026-08-23', name: 'DeSimone' },
    { start: '2026-08-24', end: '2026-08-30', name: 'Cotton' },
    { start: '2026-09-07', end: '2026-09-13', name: 'Tang' },
    { start: '2026-09-14', end: '2026-09-20', name: 'Nahar' },
    { start: '2026-09-21', end: '2026-09-27', name: 'DeSimone' },
    { start: '2026-09-28', end: '2026-10-04', name: 'Perez' },
    { start: '2026-10-05', end: '2026-10-11', name: 'Camacho' },
    { start: '2026-10-12', end: '2026-10-18', name: 'Williamson' },
    { start: '2026-10-19', end: '2026-10-25', name: 'Cotton' }
  ]
}
```

engine.js — `Engine.resolveDay` adds (null-safe; guard absent nfSchedule):

```js
nightFloat: 'Perez' | null,          // ISO compare against nfSchedule.ranges
dayFloatCoverage: {                  // null when no NF known for the date
  nf: 'Perez',
  nfDuties: { am: 'CPEC', pm: 'CPEC' },  // the NF resident's OWN resolved cells that day
  coveredBy: ['Tang'] | []               // roster.dayFloat names, [] if none
} | null
```

Tests (extend test-engine.js): 2026-07-22 → nightFloat 'Perez',
dayFloatCoverage.nf 'Perez', coveredBy ['Tang'], nfDuties = Perez's Wed cells
(pgy3 block 6 → CPEC/CPEC); 2026-08-10 → 'Tang' (who IS day float that block —
coveredBy ['Tang'] still fine); 2026-09-02 → null (week not filled);
2026-11-04 → null; weekend/out-of-year → null. Do NOT touch app/export/css/html.

## B. UI for NF + day-float coverage (js/app.js)

- Prefill `state.nightFloat` from `roster.nightFloat` when the field is empty
  (never overwrite typed values) — same pattern as buddy prefill. Hint under
  the Night Float input when prefilled: "from the call schedule — edit freely".
- Glance coverage line: Night Float shows the value; Day Float item becomes
  e.g. `Tang — covering Perez's daytime (CPEC)` when dayFloatCoverage exists
  and nf ≠ the day-float person; just the name otherwise.
- Full-roster grid: the NF resident's row gets an amber note "Night Float this
  week — daytime covered by Day Float" on both sessions.

## C. CPEC Post-op standing clinic (js/app.js, js/export.js)

The chiefs now check CPEC post-ops daily ("CPEC PO: Djulbegovic, Samuel,
Cheng, Calotti" in the real schedule).

- export.js `clinicLines`: iterate sessions `['day','am','pm']` where session
  'day' renders NO session suffix — `CPEC PO (…): **names**`. Everything else
  unchanged.
- app.js Clinics card: a standing first row labeled **CPEC PO** (no AM/PM
  badge) that always renders. Staff via the usual chips/add-select stored
  under override key `'CPEC PO|day'`; count/note fields under
  `clinicCounts['CPEC PO|day']`. It appears in output only when staffed or
  counted (clinicLines already skips empty). Typical staffing = the operating
  PGY-4s; leave it manual.
- Make sure effectiveClinicStaff/clinicStaff handle a label that has no roster
  group (base = []).

## D. Dress-code reminders (js/app.js (+css))

Rule: Bilyk or Sergott in clinic → business casual + white coat.

- Auto: when `roster.specialClinicsToday` includes a Bilyk entry, show an
  amber chip in the glance chips AND a banner line at the top of the Clinics
  card: "Bilyk clinic today — business casual + white coat".
- Text detection: if any clinic count/note field or clinic label contains
  /bilyk|sergott/i, show the same banner (named accordingly, e.g. "Sergott
  clinic today — business casual + white coat"). Re-evaluate on render (touch
  → Clinics re-render path is fine; also glance on Update/Create).
- No automatic changes to the copied output — the reminder is in-app; the
  chief already writes dress notes into the clinic line when needed.

## E. New-year setup / import-export (js/app.js, index.html, css)

Goal: the next class can load THEIR schedules without touching code.

- New route `'setup'` (add to VALID_ROUTES + a panel `panel-setup` with
  `#setupBody`). Entry points: a quiet "Set up a new year" link on the Home
  card links row, and a "Setup / new year" item in the header ⋯ menu.
- Panel content (render function `renderSetup()`):
  1. **How it works** paragraph: all schedule knowledge lives in one
     configuration object (block schedules, block dates, CPEC sheet, buddy
     call, NF schedule, hierarchy); download it, edit/replace the data for the
     new academic year, upload it back. Uploads live in this browser only.
  2. **Download current configuration** button → serializes the ACTIVE data
     object (`data()`, which includes any override) to
     `surg-schedule-config.json` via a Blob download.
  3. **Upload configuration** — `<input type=file accept=".json">` +
     also a paste-textarea alternative. Parse; validate minimally: object with
     `ayStart`, `ayEnd`, `years.pgy2/pgy3/pgy4` each with residents/blockRanges/grid.
     On success: store JSON string in localStorage key
     `surgsched:v1:dataOverride`, set `window.SCHED_DATA` to it, recompute +
     re-render everything (incl. static tabs: reference/howto/cpec), toast.
     On failure: toast the validation error, store nothing.
  4. **Active configuration** status line: "Built-in AY 2026–2027" vs
     "Imported (<ayLabel>) — stored in this browser" + a "Remove imported
     configuration" button (reverts to built-in; keep a captured reference to
     the original built-in object from boot).
  5. **Danger zone**: "Delete all saved schedule days" (every
     `surgsched:v1:day:*` key) with confirm — for handing the app to the next
     class fresh.
- Boot: BEFORE first render, read the override key; if it parses and
  validates, replace `window.SCHED_DATA` (keep the built-in in a variable for
  revert). Wrap in try/catch — a corrupt override must never brick the app;
  on failure, ignore it (and console.warn).
- README: short "New academic year" section update mentioning the Setup page.

## F. Verification

Node suites green + new §A tests. Browser (2026-07-22): Night Float input
prefills 'Perez' with hint; glance shows `Tang — covering Perez's daytime
(CPEC)`; roster row Perez carries the NF note; Clinics card starts with the
CPEC PO row — add Cheng + count, preview shows `CPEC PO (…): Cheng`; a Bilyk
day (e.g. 2026-07-22 is a Bilyk PM day per specialClinics) shows the
dress-code banner + chip; Setup: download produces JSON, uploading a config
with ayLabel changed re-renders header, remove reverts, delete-days clears
localStorage days. No console errors; mobile 390px no horizontal scroll.
