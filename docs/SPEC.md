# Surg Schedule Builder — Prototype Spec

A **static, no-server web app** (open `index.html` directly via `file://` in any modern browser) that helps the chief resident build the daily surgery schedule the evening before. Multiple EMRs mean case lists and patient counts are entered **manually**; everything derivable from the block schedules is **auto-filled**.

## Hard constraints

- Plain HTML/CSS/JS. **No build step, no ES modules, no external network requests** (hospital computers, `file://`). Scripts loaded via `<script>` tags define globals.
- Files: `index.html`, `css/style.css`, `js/data.js` (done — do not modify), `js/engine.js`, `js/assign.js`, `js/export.js`, `js/app.js`.
- All state persists to `localStorage`, keyed per date: `surgsched:v1:day:<YYYY-MM-DD>`.
- Also works when served over http (e.g. `python3 -m http.server`) — no path assumptions beyond relative paths.

## Globals / load order

```html
<script src="js/data.js"></script>   <!-- window.SCHED_DATA -->
<script src="js/engine.js"></script> <!-- window.Engine -->
<script src="js/assign.js"></script> <!-- window.Assign -->
<script src="js/export.js"></script> <!-- window.ExportFmt -->
<script src="js/app.js"></script>    <!-- window.App, boots on DOMContentLoaded -->
```

`engine.js`, `assign.js`, `export.js` must also be requireable from Node for tests:
`if (typeof module !== 'undefined' && module.exports) module.exports = Engine;` (data.js already does this). In Node, get data via `require('./data.js')`; in browser via `window.SCHED_DATA`. Engine functions take the data object as an explicit first argument OR fall back to the global — implement `Engine.resolveDay(dateISO, data?)`.

## engine.js — `window.Engine`

Date math: parse `'YYYY-MM-DD'` manually into `new Date(y, m-1, d)` (LOCAL time — never `new Date(str)`, which is UTC and shifts the weekday).

- `Engine.nthWeekdayOfMonth(date)` → 1–5 (occurrence index of that weekday in its month: `Math.floor((d-1)/7)+1`).
- `Engine.resolveDay(dateISO, data?)` → `DayRoster`:

```js
{
  date: '2026-07-22', weekdayKey: 'wed', weekdayLabel: 'Wednesday',
  nth: 4,                       // 4th Wednesday of July
  inYear: true,                 // within ayStart..ayEnd
  isWeekend: false,             // sat/sun → residents: [], everything empty
  residents: [                  // ALL residents, all 3 years
    { name: 'Cheng', year: 'pgy4', yearLabel: 'PGY-4 (Third Year)', block: 1,
      taskmaster: false,
      am: { text: 'Surg 1', notes: [] },   // notes: strings from matching override rules
      pm: { text: 'Surg 1', notes: [] } }, ...
  ],
  surg: {                       // derived from pgy4 rows whose am/pm text is 'Surg N'
    '1': { name: 'Cheng', am: true, pm: true, amText: 'Surg 1', pmText: 'Surg 1' },
    '3': { name: 'Aguwa', am: true, pm: false, amText: 'Surg 3', pmText: 'Cornea' }, ...
    // '6' may exist (pgy3 block 6 Thu)
  },
  wer: { am: ['Nahar','Hamou'], pm: ['Nahar','Hamou','Patel'] },  // residents with text 'ER'
  jeffConsults: ['Cotton'],
  cooperConsults: ['Illiano'],   // text 'Cooper Consults'
  dayFloat: ['Tang'],
  taskmasters: ['Hamou','Ransone'],  // pgy2 residents whose block ∈ taskmasterBlocks
  clinics: {                    // session rosters grouped by clinic-ish assignment text
    // key = normalized assignment text, e.g. 'Cornea', 'Glaucoma', 'Peds', 'Neuro',
    // 'Plastics', 'Retina', 'Uveitis', 'Path', 'Cooper Clinic', 'Glaucoma Lasers', ...
    'Cornea': { am: [{name,year}...], pm: [{name:'Momenaei',year:'pgy2'},{name:'Williamson',year:'pgy3'},{name:'Aguwa',year:'pgy4'}] }, ...
  },
  orBlocks: {                   // people on OR-type blocks (candidates for case help)
    'Peds OR': { am: [...], pm: [...] }, 'Plastics OR': {...}, 'Wills OR': {...},
    'Cooper OR': {...}, 'Retina OR': {...}, 'Stadium OR (Abendroth)': {...}, ...
  },
  specialClinicsToday: ['Bilyk Clinic (PM)'],   // from data.specialClinics matching day+nth
  blockRangeLabel: '7/20 – 8/30' // human label of active pgy4 range is NOT needed; skip
}
```

Rules:
- Resident block = the `blockRanges` entry containing the date (string compare on ISO works).
- Cell resolution: start from `grid[block][weekdayKey]`, then apply every matching override (`block`, `day`, `session` `'am'|'pm'` — a rule applies to exactly one session; match `nth` if present; match `months` if present using calendar month 1–12). Rules with `set` replace the text; ALL matching rules append their `note`. Apply in array order.
- `clinics` grouping: group by exact resolved text for every resident/session, excluding: 'CPEC', 'ER', 'PT', any 'Surg N', consult/float assignments ('Jeff Consults','Cooper Consults','Day Float'), and OR-type texts (anything containing 'OR' goes to `orBlocks` instead). Keep 'Cooper Clinic', 'Private Cornea', 'Private Glaucoma', 'Retina Private' etc. as their own keys.
- Weekend / out-of-year: return `{ isWeekend|inYear flags, residents: [], surg: {}, ... }` with empty collections — the UI shows a banner.

## assign.js — `window.Assign`

Case model (created by the UI):

```js
{
  id: 'c1',                    // stable string
  section: 'wills',            // 'wills' | 'private' | 'jhn' (JHN/TJUH/JSC) | 'other'
  surgeon: 'Huang',
  count: 7,                    // total cases
  serviceCount: 2,             // service cases (0..count); privates get serviceCount 0
  start: '0730',               // free text time
  category: 'cataract',        // 'cataract'|'cornea'|'glaucoma'|'plastics'|'peds'|'retina'|'trauma'|'other'
  addOn: false,
  notes: '',
  assigned: '',                // resident name or '' (manual or accepted suggestion)
  backup: ''                   // optional backup resident name
}
```

- `Assign.classify(caseObj)` → hierarchy key (`'peds'`, `'addOnGlaucoma'`, `'scheduledPlastics'`, `'traumaPlasticsAddOn'`, `'scheduledCataract'`, `'remaining'`, …): peds category → `peds`; cornea+addOn → `addOnCornea`; glaucoma+addOn → `addOnGlaucoma`; trauma, or plastics+addOn → `traumaPlasticsAddOn`; plastics → `scheduledPlastics`; cornea → `scheduledCornea`; glaucoma → `scheduledGlaucoma`; cataract → `scheduledCataract`; else `remaining`. Only cases with `serviceCount > 0` (or section `'wills'` service cases) need residents; private-only cases (`serviceCount === 0`) get no suggestion, reason "private — no resident needed" (still overridable manually).
- `Assign.suggest(cases, roster)` → `[{ caseId, name, reasons: ['Add-on cornea → Surg 3'], warnings: ['Aguwa is in Cornea clinic PM'], alternates: [names...] }]`.
  - Resolve chain tokens against the roster: `'Surg N'` → `roster.surg[N].name`; `PEDS_OR_JUNIOR` → pgy2/pgy3 in `orBlocks['Peds OR']`; `PLASTICS_OR_PGY2` → pgy2 in `orBlocks['Plastics OR']`; `FREE_JUNIOR` → skip (can't compute "willing"; surface as an *alternate* labeled "free junior — Surg 2's discretion"); `COOPER` → `roster.cooperConsults[0]`; `WILLS_OR` / `RETINA` → from orBlocks/clinics.
  - Load-balance: track per-resident total assigned case count within this suggest pass (including pre-existing manual `assigned`); if the chain's first choice already carries ≥2 more cases than the next chain member, still suggest the first but add a warning ("already has N cases — consider next in chain").
  - Session conflict warnings: if case start ≥ 1230 treat as PM, else AM (heuristic; also flag "spans day" for x≥4 counts starting 0730). If the suggested resident's roster text for that session is a clinic (not 'Surg N'/'CPEC'), warn.
  - Process order: peds & scheduled specialty & plastics first, then add-ons, then `remaining` in chronological `start` order (string sort works for 24h times).
- `Assign.clinicCoverage(roster)` → ordered list of `{name, source}` for PM clinic coverage per the `clinicCoverage` chain (for display on the Assign tab).

Suggestions NEVER auto-write `assigned`; the UI has "Accept" / "Accept all" actions.

## export.js — `window.ExportFmt`

- `ExportFmt.buildHTML(day)` → HTML string reproducing the current document format (see sample below). `day` = full app state for the date (see app.js) + roster.
- `ExportFmt.buildText(day)` → plain-text equivalent.
- `ExportFmt.copy(day)` → writes both flavors to the clipboard: try `navigator.clipboard.write([ClipboardItem {text/html, text/plain}])`; on failure fall back to a hidden contenteditable + `document.execCommand('copy')`. Returns a promise resolving true/false.

Target format (bold = `<b>`), sections in this exact order, skipping empty sections:

```
Lectures/Events
<lectures free text>

Assignments
Surg 1 - **Cheng**
Surg 2 - **Calotti**
Surg 3 - **Aguwa AM** | none PM
...

WER: **Nahar AM/PM, Hamou AM/PM, Patel PM**
Night Float: **Perez**
Jeff Consults: **Cotton**
Cooper Consults: **Illiano + buddy [Camacho AM | DeSimone PM]**

Wills/ASC
-Marous x7 (730 start), x1 service (915 start) - **Momenaei** (no Peds OR)
...

Privates
-Garg x5
...

JHN/TJUH/JSC
-none

Clinics
Cornea PM (29x3): **Momenaei, Williamson, Aguwa**
...

Vacation
<free text>

Add-ons
Tuesday night (7/21/26): **Djulbegovic**
...
```

Formatting rules: Surg line shows `**Name**` when am&pm, `**Name AM** | none PM` when AM-only (and vice versa). WER collapses per-resident sessions (AM/PM, AM, PM). Case lines: `-{surgeon} x{count} ({start} start){, x{serviceCount} service} - **{assigned}**{ (notes)}`; unassigned service cases show `- ⚠ UNASSIGNED`. Clinic lines: `{label} {AM|PM} ({counts}): **{names}**`.

## app.js + index.html — UI

Header: app title, **date picker** (defaults to tomorrow), weekday + "4th Wednesday" chip, taskmaster chip, special-clinics-today chips, buttons: **Create Surg Schedule** (recompute roster for date, keep manual data), **Start from yesterday** (copy nightFloat/vacation/lectures/addOns from the most recent saved earlier date), **Clear day**.

Tabs (keep the user's mental model — a blend of auto + manual):

1. **Day Roster** — auto-generated, read-only grid of all residents (grouped PGY-2/3/4) with AM/PM assignments and override notes; derived summary card (Surg 1–5, WER, Jeff/Cooper Consults, Day Float, Surg 6 if present). Manual inputs: Lectures/Events (textarea), Night Float (text), Cooper buddies AM/PM (selects of residents + free note e.g. "private glaucoma"), Vacation (textarea, default "24 strong"), Add-ons list (rows: label e.g. "Tuesday night (7/21/26)" auto-prefilled for tonight/tomorrow-day/tomorrow-night from the date, + resident select).
2. **Cases & Clinics** — manual entry tables: Wills/ASC cases, Privates, JHN/TJUH/JSC, Other (Stadium/Cherry Hill). Row fields per case model; add/remove/duplicate rows. Clinics sub-section: rows auto-created from `roster.clinics` (label like "Cornea PM", auto-staffed names shown as chips w/ remove + add-select) with a **manual patient-count text field** (e.g. "29x3", "13x2") and note field ("patient counts come from the EMRs — enter manually").
3. **Assign** — the algorithm tab: left = case list with suggestion chip (name + reason + warnings + alternates dropdown + Accept), "Suggest all" / "Accept all suggestions" buttons; right = per-resident load panel (name, block assignment AM/PM, # cases assigned, chips of their cases) + PM clinic-coverage chain display. Manual override always available via select on each case.
4. **Preview & Copy** — rendered schedule (from `ExportFmt.buildHTML`) in a white "document" card + **Copy formatted** button (success toast) + **Copy plain text**. Live-updates from state.
5. **Reference** — read-only: hierarchy chains, scheduling notes (from data), and the three block grids + block-dates tables rendered from data.js so nobody needs the PDF.

State shape (per date, all persisted on every change, debounced):

```js
{
  date, lectures: '', nightFloat: '', vacation: '24 strong',
  cooperBuddyAM: {name:'', note:''}, cooperBuddyPM: {name:'', note:''},
  addOns: [{label:'', name:''}, ...],
  cases: [CaseObj...],
  clinicCounts: { 'Cornea|pm': {count:'', extra:''}, ... },   // keyed label|session
  clinicStaffOverrides: { 'Cornea|pm': {removed:['..'], added:['..']} },
  suggestions: {},          // last computed, not persisted necessarily
  seq: 7                    // case id counter
}
```

Design: clean clinical tool. System font stack, 14px base, generous whitespace, subtle borders, sticky tab bar, AM/PM as small badges, PGY-year color accents (muted), warnings in amber, unassigned in red. Fully usable at 1280×800 and on a phone (single column). No frameworks, no icons fonts (inline SVG or unicode fine).

## Verification fixture (must pass)

`Engine.resolveDay('2026-07-22')` (4th Wednesday) must yield: Surg 1 Cheng (am+pm), Surg 2 Calotti (am+pm), Surg 3 Aguwa (AM only; PM 'Cornea'), Surg 4 Bair (AM only; PM 'Glaucoma'), Surg 5 Wibbelsman (am+pm); jeffConsults ['Cotton']; cooperConsults ['Illiano']; wer.am ['Nahar','Hamou'] (order free), wer.pm includes Patel; dayFloat ['Tang']; clinics: Cornea.pm = Momenaei+Williamson+Aguwa, Glaucoma.pm = Ransone+Bair, Peds.am/pm includes Parekh, Neuro.am = Teng+DeSimone, Plastics.pm includes Marshall; orBlocks['Plastics OR'].pm includes Camacho (4th-Wed override); Samuel Wed = Retina both sessions; taskmasters = Hamou & Ransone.

Also: `2026-07-20` pgy4 blocks {Bair:3,…}; `2026-08-10` block rollover (Bair:4); `2026-11-23`–`2027-01-17` winter range; `2027-06-30` last day valid; `2026-07-18` (Sat) → isWeekend; `2026-07-01` → inYear false.
