# Iteration 3 — CPEC surgical block sheet, assignments panel, add-ons timing

Read docs/SPEC.md + docs/UISPEC2.md for existing architecture. Keep everything
working (tests, persistence, routing, output format except where stated).

## A. CPEC surgical block sheet (js/data.js + js/engine.js + tests)

New master data: the CPEC SURGICAL BLOCK SCHEDULE (effective 05/01/2026) — a
grid of attending cataract blocks by **nth weekday of the calendar month**
(rows 1st–5th × Mon–Fri). Cell highlight = which resident covers the cases:
white/none = **Surg 1**, yellow = **Surg 5**, green = **Wills OR**, tan =
**Retina Resident**. `*private only` = no resident; listed on the schedule
only as who is doing private cases. `(SP)` = Stadium, `(CH)` = Cherry Hill.
`AM TF` = AM, to-follow (no fixed start). Starred times carry month lists
(attending operates only those months). `(n)` = case count from the sheet
(used as an editable prefill).

Encode as:

```js
cpecSheet: {
  label: 'CPEC Surgical Block Schedule',
  effective: '2026-05-01',
  legend: { surg1: 'Surg 1', surg5: 'Surg 5', willsOR: 'Wills OR', retina: 'Retina Resident' },
  // entries[nth][weekday] = [ { attending, time, count, cover, site, months, privateOnly, note } ]
  // time: '7:30' | '1:00' | '12:30' | '9:30' | 'AM TF' | 'All day 7:30' ; count: number|null
  // cover: 'surg1'|'surg5'|'willsOR'|'retina'|null (null when privateOnly)
  // site: 'SP'|'CH'|null ; months: [1..12] or null ; privateOnly: bool
  entries: { 1: { mon: [...], tue: [...], ... }, 2: {...}, ... 5: {...} }
}
```

Full transcription (verify each against this table; colors after `—`):

**1st Mon**: Harris (SP) (2) — surg5 · Davis (SP) (2 prvt + 6 svc) — willsOR, note '2 private / 6 service'
**1st Tue**: Wisner 7:30 (4) — surg1 · Bailey 1:00 (3) — surg1 · Markovitz (SP) 7:30 (7) — surg5 · Pericic 7:30 (5) — private only · Anhalt 12:30 (4) — private only · Ang (SP) 7:30 (12) — private only
**1st Wed**: Brown 7:30 (4) — surg1 · Siliquini 1:00 (3) months Feb,Apr,Jun,Aug,Oct,Dec — surg1 · Pyfer Jr 1:00 (3) months Jan,Mar,May,Jul,Sep,Nov — surg1 · Abendroth (SP) AM TF (2) — surg5 · Lamson (SP) (12) — private only
**1st Thu**: Shafer 7:30 (4) — surg1 · Ang 12:30 (3) — surg1 · McGowan (SP) 7:30 (10) — surg5 · Anhalt (SP) (15) — private only
**1st Fri**: Witherell 7:30 (4) months Feb,Apr,Jun,Aug,Oct,Dec — surg1 · Pyfer 7:30 (4) months Jan,Mar,May,Jul,Sep,Nov — surg1 · Negrey 1:00 (3) — surg1 · Pericic (SP) (14) — private only · Lamson (SP) (12) — private only

**2nd Mon**: Markovitz 7:30 All day (7) — surg5 · Abendroth AM TF (2-3, use count 3, note '2–3 cases') — surg1 · Ang 12:30 (3) — surg1
**2nd Tue**: Davis AM TF (2) — surg1 · Tyson 1:00 (3) — surg1 · Gordon (CH) AM TF (2) — surg5 · Anhalt (SP) (15) — private only
**2nd Wed**: Tabas AM TF (1) — surg1
**2nd Thu**: Pyfer AM TF (1) — surg1 · Ang 12:30 (4) — private only · Harris (SP) 7:30 (2) — surg5
**2nd Fri**: Anhalt 7:30 (4) — surg1 · Epstein/Solarte 1:00 (3) — surg1

**3rd Mon**: McGowan 7:30 All day (10) — surg1
**3rd Tue**: Lamson 7:30 (4) — private only · Markovitz (SP) 7:30 (7) — surg5 · Pericic 7:30 (5) — private only
**3rd Wed**: Brown 7:30 (4) — surg1 · Galiani 1:00 (3) months Jan,Mar,May,Jul,Sep,Nov — surg1 · Williams 1:00 (3) months Feb,Apr,Jun,Aug,Oct,Dec — surg1 · Tabas AM TF (1) — retina · Derham (SP) 9:30 (11) — surg5
**3rd Thu**: Lamson 7:30 (4) — surg1 · Anhalt (SP) (15) — private only
**3rd Fri**: Anhalt 7:30 (3 svc + 1 prvt, count 4, note '3 service / 1 private') — surg1 · Weinstock 1:00 (3) — surg1 · Ang (SP) 7:30 (12) — private only

**4th Mon**: Abendroth AM TF (5) — surg1 · Intili 7:30 (4) months Feb,Apr,Jun,Aug,Oct,Dec — surg5 · DiDomenico 7:30 (4) months Jan,Mar,May,Jul,Sep,Nov — surg5 · Pendse 1:00 (3) — surg5 · Pericic (SP) (14) — private only · Anhalt 12:30 (4) — private only
**4th Tue**: Wisner AM TF (3) — surg1
**4th Wed**: Markovitz 1:00 (3) — surg1 · Ang (SP) 7:30 (12) — private only
**4th Thu**: Pyfer 7:30 (4) — surg1 · Lehman 1:00 (2) — surg1 · McGowan 7:30 (5) — surg5 · Derham 12:30 (4) — surg5 · Anhalt (SP) (15) — private only
**4th Fri**: Sieber 7:30 (4) months Jan,Mar,May,Jul,Sep,Nov — surg1 · Chatterjee 7:30 (4) months Feb,Apr,Jun,Aug,Oct,Dec — surg1 · Sieber 1:00 (3) — surg1

**5th Mon**: McMahon AM TF (2) — surg1 · Pericic (SP) (14) — private only · Lamson (SP) (12) — private only
**5th Tue**: Davis AM TF (2) — surg1 · Ang (SP) 7:30 (12) — private only
**5th Wed**: Cutney 7:30 (4) — surg1 · Markovitz 12:30 (3) — surg5
**5th Thu**: Chronister 7:30 (4) — surg1 · Lamson (SP) (12) — private only
**5th Fri**: Harris 7:30 (4) — surg1 · Halfpenny 1:00 (3) — surg1 · Anhalt 12:30 (4) — private only · Pericic (SP) (14) — private only

Engine: `Engine.cpecForDate(dateISO, data?)` → `{ nth, weekdayKey, entries: [...] }`
filtered by month lists (entry applies when `!months || months.includes(calendarMonth)`),
empty for weekends/out-of-year. Note in data that the transcription colors were
read from a photo — flag `unverified: true` on any entry you can't be sure of
(none expected; the spec table above is authoritative).

Tests (extend test-engine.js): 2026-07-22 (4th Wed) → Markovitz 1:00 surg1 +
Ang private-only, NOT Pyfer; 2026-07-15 (3rd Wed, July=7 odd) → includes Brown,
Galiani (Jul), Tabas (retina), Derham; excludes Williams (even months);
2026-08-19 (3rd Wed, Aug) → Williams yes, Galiani no; 2026-07-06 (1st Mon) →
Harris surg5 + Davis willsOR; weekend → empty.

## B. Case model: service-case times (js/app.js, js/export.js, assign chips)

- Case field `serviceTimes: ''` (free text, e.g. `9:30 AM` or `1030 & 1300`).
  Add to normCase, to the case card UI (row 2, labeled "Service case time(s)",
  placeholder "when the resident/service cases are — e.g. 9:30 AM"), persisted.
- export.js caseLine: after `, x{svc} service` append ` - {serviceTimes}` when
  present → matches the real document ("x2 service - 1030 & 1300 service cases").
- caseTitle / assignment chips show it: `Wisner x6 (0730 start; svc 0930)`.

## C. "Assignments" panel redesign (Assign tab right column, js/app.js)

- Rename "Resident load" → **"Assignments"**. Drop the "N case(s)" count pill.
- Split into two labeled groups: **Surgical** (Surg 1..6 + anyone on Wills
  OR/OR blocks) and **Clinic / Consults** (Cooper Consults + any other
  assigned resident not in the first group).
- Every listed resident keeps their AM/PM line; case chips render as
  `Huang x7 (0730; svc 1030 & 1300)`.
- Residents with no cases still show, with a small **"+ case"** button that
  creates a new Wills case pre-assigned to them and switches to the Cases tab
  focused on it (or simply adds it and toasts "Case added — fill in surgeon
  and counts on Cases & Clinics"). Everyone gets the option, nobody shows a
  count pill.

## D. CPEC lineup card on Cases & Clinics (js/app.js, index.html, css)

New card at the TOP of Cases & Clinics: **"CPEC surgical block sheet — 4th
Wednesday"** (from Engine.cpecForDate):
- Grouped list: Surg 1 / Surg 5 / Wills OR / Retina resident / Private only.
  Each entry: `Markovitz 1:00 (3) · Stadium` etc., shown verbatim-ish.
- Non-private entries get **"+ Add as case"**: creates a Wills case prefilled
  {surgeon, start (sheet time; 'AM TF' goes in start as text), count (sheet
  n), serviceCount 0 (unknown — user fills), category 'cataract', notes:
  site ('Stadium'/'Cherry Hill') and any note, assigned: the covering
  resident from TODAY'S roster per `cover` (surg1→roster.surg['1'].name,
  surg5→surg['5'], willsOR→first orBlocks['Wills OR'] person, retina→pgy4 on
  Retina)} — everything editable afterwards. Button disabled→"added" once a
  case with same surgeon+start exists that day.
- Private-only entries get **"+ Add to Privates"**: prefilled private-section
  case {surgeon, count: sheet n, serviceCount 0}.
- Card note: "From the CPEC sheet effective 5/1/2026 — nth weekday of the
  month; confirm against Cerner/NextGen. (n) = sheet case count, editable."

## E. Add-ons prefill timing (js/app.js)

Anchor the three prefilled add-on rows to the REAL current date (not the
schedule date): "<today> night (M/D/YY)", "<tomorrow> day", "<tomorrow>
night" — i.e. tonight, then the next day+night: "what is to come" at the
moment the schedule is being built. defaultAddOns() takes today from the
clock; keep rows fully editable. Update the existing add-on prefill tests if
any assert the old D-1 pattern (check tests/).

## F. Verification

All three Node suites green; extend per section A. Browser QA: 2026-07-22 →
Cases tab shows the CPEC card with Markovitz (Surg 1 → prefills assigned
Cheng) + Ang private-only; Add-as-case creates the prefilled case; Assignments
panel shows Surgical vs Clinic/Consults groups, no count pills, + case buttons;
serviceTimes flows into the preview line; add-on labels = tonight/tomorrow.
No console errors, no mobile horizontal scroll.
