# UI overhaul spec — landing page, how-to, cases/assign redesign, buddy call

Read SPEC.md first for the existing architecture (static app, no modules, globals,
localStorage state). This spec covers the next iteration. Keep every existing
feature working: per-date persistence, Update button, suggestions, backups,
copy output format (do NOT change export.js output except where stated).

## A. Cooper buddy call (data + engine — files: js/data.js, js/engine.js, tests/)

Source: "Cooper Buddy Call 2026-2027" PDF. The Cooper consult PGY-2 has a
senior buddy each session, drawn from these rotations (weekly template):

|    | Mon    | Tue           | Wed              | Thu    | Fri       |
|----|--------|---------------|------------------|--------|-----------|
| AM | Retina | Wills OR (B3) | Private Glaucoma | Cooper | Cooper OR |
| PM | Retina | Wills OR (B3) | Retina           | Cooper (PGY-4) | PT (B6) |

Named assignments exist for block 1 only so far:

- 2026-07-20 .. 2026-08-09 — AM: Mon DeSimone, Tue Williamson, Wed Camacho, Thu Nahar, Fri Nahar; PM: Mon DeSimone, Tue Williamson, Wed DeSimone, Thu Shields, Fri Perez
- 2026-08-10 .. 2026-08-30 — identical EXCEPT Thu PM = Aguwa

Encode in data.js as:
```js
buddyCall: {
  note: 'Cooper buddy call — senior buddy for the Cooper consult PGY-2. Later blocks TBD; the weekly template shows which rotation the buddy is pulled from.',
  template: {
    am: { mon: 'Retina', tue: 'Wills OR (B3)', wed: 'Private Glaucoma', thu: 'Cooper', fri: 'Cooper OR' },
    pm: { mon: 'Retina', tue: 'Wills OR (B3)', wed: 'Retina', thu: 'Cooper (PGY-4)', fri: 'PT (B6)' }
  },
  ranges: [
    { start: '2026-07-20', end: '2026-08-09', am: {mon:'DeSimone',tue:'Williamson',wed:'Camacho',thu:'Nahar',fri:'Nahar'}, pm: {mon:'DeSimone',tue:'Williamson',wed:'DeSimone',thu:'Shields',fri:'Perez'} },
    { start: '2026-08-10', end: '2026-08-30', am: {…same…}, pm: {…, thu:'Aguwa', …} }
  ]
}
```

engine.js `resolveDay` adds to the roster (weekday + inYear only, else null values):
```js
cooperBuddies: {
  am: 'Camacho' | null,          // from the matching range, if any
  pm: 'DeSimone' | null,
  templateAM: 'Private Glaucoma', // from buddyCall.template for that weekday
  templatePM: 'Retina'
}
```
Extend tests/test-engine.js: 2026-07-22 → am Camacho / pm DeSimone, templates
'Private Glaucoma'/'Retina'; 2026-08-13 (Thu in range 2) → am Nahar / pm Aguwa;
2026-09-02 → am/pm null but templates still populated; weekend → all null.
Do not touch app.js/index.html/css (another agent owns those).

## B. Landing page ("Home") — files: index.html, css/style.css, js/app.js

Boot no longer drops the user into the busy roster tab. New flow:

- On load: **Home view** only — `.app-header` and `.tabbar` hidden (body class
  `home-active`). Centered hero card (max-width ~560px):
  - Brand mark + "Surg Schedule Builder" + one quiet line: "Builds the daily
    surgery schedule from the block schedules — you add the cases."
  - Big date field (defaults to tomorrow) + primary button **"Create Surg
    Schedule →"**. If a draft exists for the chosen date (localStorage key),
    button text becomes **"Open schedule for M/D/YY"** with a small "saved
    draft" hint under it.
  - Secondary row of quiet links/buttons: "How it works" (opens the How-to view
    WITHOUT leaving home-less mode — i.e. enters the app shell on the howto
    tab), "Block schedule reference" (reference tab).
  - "Recent days" chips: up to 4 most recent saved dates (from lsKeys), click =
    enter app on that date.
- `enterApp(dateISO)`: set date (existing setDate), remove `home-active`, show
  header+tabbar, go to tab 1 (roster). Toast stays ("Roster built for …").
- Way back: the brand block in the header becomes a button (cursor pointer,
  title "Home") → returns to Home (`home-active` on; nothing lost — state saved).
- Keep the header date picker + Create working exactly as now once inside.

## C. How-to view — files: index.html, js/app.js (+css)

New panel `howto` with tab label "How-to" placed after "4 Preview & Copy",
before "Reference". Content = friendly onboarding cards (static, rendered from
a render function; pull chains/notes from SCHED_DATA where sensible):

1. **The flow** — four numbered rows mirroring the tabs: 1 Day Roster ("pick the
   date — everyone's block assignment, Surg 1–5, WER, consults and clinics fill
   in automatically; type night float, add-ons, vacation"), 2 Cases & Clinics
   ("copy the case list out of Cerner/NextGen by hand — count, start, service
   vs private; enter clinic patient counts"), 3 Assign ("press Suggest all —
   the how-to hierarchy proposes a resident per case with warnings; accept or
   override; use the clinic-backup suggestions"), 4 Preview & Copy ("the
   document, exactly in the usual format — Copy formatted and paste").
   Each row gets a "Go →" button to that tab.
2. **What fills itself in** vs **What you type** — two-column card (auto:
   rosters/Surg roles/WER/consults/clinic staffing/Cooper buddies/special
   clinic days; manual: cases from the EMRs, patient counts, night float,
   add-ons, vacation, lectures — "several EMRs, no interfaces: the case list is
   deliberately manual").
3. **The rules in 30 seconds** — condensed chains: scheduled cornea→Surg 3,
   glaucoma→Surg 4, cataracts→Surg 1/5/Wills OR, peds→junior on Peds OR→…,
   trauma→Surg 2 first, everything else chronologically Surg 2→3→4→Cooper→1→5;
   clinic coverage chain; then "Full chains, notes, and the block grids live in
   the Reference tab."
4. **Tips for new schedulers** — from the how-to deck: check Google Calendar
   for lectures/vacations first; Surg 3/4 reach out to attendings about
   scheduled cases; the schedule is built the evening before; Surg 2 is the
   boss — give them some grace.

## D. Cases & Clinics redesign — files: index.html, css/style.css, js/app.js

Replace the four wide 8-column tables with compact card lists (same state,
same fields, same handlers — presentation only):

- Each section (Wills/ASC, Privates, JHN/TJUH/JSC, Other) = `<details open>`
  card; `<summary>` shows title + live count badge ("3 cases") + "+ Add case"
  button (button inside summary must not toggle the details — stopPropagation).
- Each case = a `.case-card` with labeled mini-fields laid out by CSS grid:
  row 1: Surgeon (flexible), Cases (num, 64px), Service (num, 64px), Start
  (84px), Category (select), Add-on (checkbox pill), actions (duplicate ×);
  row 2: Notes (full width). Small uppercase labels above each input
  (`.mini-label`), so nothing needs a table header. Wraps cleanly at mobile
  widths (grid auto-flow).
- Empty section body: "No cases yet — add the first one." with the add button.
- Clinics card: align rows on a grid: [label+session badge 170px] [staff chips
  1fr] [count 90px] [note 1fr]; on mobile stack. Keep behavior identical.
- Add-ons card unchanged.

## E. Assign redesign — files: index.html, css/style.css, js/app.js

- Toolbar gains filter chips (local UI state, not persisted):
  **Needs resident (n)** — default — | **Assigned (n)** | **All (n)**.
  Counts live-update. "Needs resident" = serviceCount>0 && !assigned.
- Needs-resident cases keep the full card (suggestion box, coverage backup,
  selects). Assigned cases render as compact one-line rows: "✓ Huang x7 (0730)
  → Bair; backup Calotti" + small "Edit" button that expands that card inline.
  Private/no-resident cases show only under "All", compact.
- When "Needs resident" is empty and there are cases: friendly empty state
  "Everything has a resident — check the output" + button "Go to Preview &
  Copy". When there are no cases at all: point at tab 2.
- Right column (Resident load / coverage chain) unchanged.

## F. Buddy prefill in the UI — js/app.js (uses the A contract)

After computeRoster: if `roster.cooperBuddies` exists and the state's buddy
fields are empty (both name and note), prefill:
- `state.cooperBuddyAM = { name: buddies.am, note: (templateAM || '').toLowerCase() }` (only if buddies.am truthy)
- same for PM.
Never overwrite a non-empty user value. The buddy rows in Day details show a
small hint under them: "auto-filled from the buddy call schedule — edit
freely" when prefill happened. Glance card Cooper line becomes e.g.
"Illiano + Camacho AM / DeSimone PM" when buddies are set (from state).
On 2026-07-22 the preview Cooper line must reproduce the real document:
`Cooper Consults: Illiano + buddy [Camacho AM (private glaucoma) | DeSimone PM (retina)]`.

## Constraints

- Guard everything (`roster.cooperBuddies` may be absent while A lands).
- No new files except optionally js/howto content inside app.js. No frameworks.
- `node --check` all edited JS. Existing node tests must stay green
  (`node tests/test-engine.js`, `test-assign.js`, `test-integration.js`).
- Keep ids used by handlers (`btnCreate`, `btnUpdate`, `datePicker`, …); new
  ids for home: `homeDate`, `btnHomeCreate`, `homeRecent`, `btnHomeHowto`,
  `btnHomeReference`.
- Mobile (390px): no page-level horizontal scroll on any tab.
