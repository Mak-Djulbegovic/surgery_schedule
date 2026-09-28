# Iteration 6 — who is free, when: vacation, coverage, and a streamlined flow

Read docs/SPEC.md and UISPEC2/3/5 first. This iteration adds a time model
(who is doing what at any minute of the day) and rebuilds the UI around the
how-to's order. Status: **released as v2 (9/2026)**; v1 is archived in `v1/`.

## Flow (tabs follow "How to Surgical Schedule")

| Tab | How-to step | What happens |
|---|---|---|
| 1 Out today | Step 1 — vacation coverage | "No one out — 24 strong", or add who is out (all day / AM / PM, reason) and pick who covers each session, or **NC** |
| 2 Roster | Step 2 — Surg 1–5 | as before; Surg 3/4 shown as **all day** ("Cornea PM if no case") |
| 3 Surgery | Steps 3–10 — cases | **one line per attending**, reading like the sent schedule: `Surgeon × # · start · category · svc → resident`. The suggested resident is a dashed pill (one click); an assigned one gets a status dot (green free, amber leaves a clinic, red out/double-booked); the backup line appears under the line only when the case pulls someone out of clinic. Service times / done by / notes / add-on / move / delete sit behind **⋯**. **Enter** adds the next line. The CPEC sheet is a prefill banner (Add all / Choose…) that shrinks to one line once added. The old Assign tab is gone |
| 4 Clinics | Steps 11–12 — clinics | counts as before; each clinic shows who is out / pulled into a case and who covers; "Needs coverage" list on top |
| 5 Coverage | the new backup view | time control (Now / any time), who is free, "if a globe comes in at t", everyone's day on one timeline, add-on call names |
| 6 Preview & Copy | — | the document |

How-to, CPEC sheet, block schedules and Setup moved to a **Library** menu.

**Landing page**: a short title only (no greeting, no tagline — the chief:
"unnecessary for people who have made the schedule before") over a blue
hero (inline-SVG iris, no external assets); date picker with Today / Tomorrow (/ next weekday)
chips; a live preview of the chosen day straight from the block schedule —
Surg 1–5 (all-day tags, anyone out flagged), Night Float, Day Float, the
Cooper senior, CPEC-sheet load, special clinics + dress code — and the saved
draft's progress; the six steps as cards that open that step for the chosen
date; recent days with their progress.
A **Free AM / Free PM** strip (and **Free now** on today's date) sits under
the tabs on every workflow tab; tab badges count what is still open.

**Look (9/28/2026)**: the workspace carries the landing page's gradient — an
app bar and folder tabs (the active tab runs into the page), a page head on
every tab (step icon, "Step n of 6", title, weekday + date), card titles
with their note on a second line, and quiet grey fields in the Surgery and
Clinics rows that turn white when edited. The brand mark is the landing
page's iris in miniature on a white tile (also the favicon). On phones the
app bar is two short rows, the free lists fold into one line ("Free AM 13 ·
PM 9 ▾"), clinic count and note sit side by side, and each timeline bar
runs full width under its name. Preview & Copy lists what is still open
(cases without a resident, gaps) with links to fix them.

## Saving and working at the same time (9/28/2026)

The chief: "I do not want my instance affecting someone else who may be
working on the surg schedule at the same time — but there should be an
automatic save in case they X out of the tab."

- **No shared state across people — by design.** The app makes no network
  calls; each browser keeps its own drafts in localStorage. Two people on
  two devices/browsers are fully isolated (browser-tested: two contexts).
- **Autosave**: 0.3 s after each edit, plus a flush on `visibilitychange`
  (hidden), `pagehide` and `beforeunload` — phones often skip
  `beforeunload`. Only real changes are written (`unsaved` flag), so a flush
  never rewrites an unchanged day. `savedAt` is stored with the day. Header
  marker: Saving… / ✓ Saved h:mm / ⚠ Not saved (storage blocked or full —
  previously a silent failure).
- **Resume**: the hash carries the day — `#/<tab>/<YYYY-MM-DD>` (old
  `#/<tab>` links still work) — so reload / restored tab / a phone reloading
  an evicted tab lands on the same day and step. `surgsched:v2:last`
  remembers {date, tab}; the landing's "Pick up where you left off" card
  appears for a day other than the one picked (within 7 days), and the big
  Continue button reopens a saved draft on the step it was left on.
- **Same browser, two tabs** share storage. A tab takes another tab's save
  of the open day (`storage` event) with a toast; if it has unsaved edits of
  its own it stops saving and asks — Keep mine / Use the other version.
  Shared workroom computers on one browser profile still share drafts —
  documented, not solved (would need sign-in or per-person keys).

## Coverage, dynamic (9/28/2026)

- **Add-ons: daytime = that day's Surg 2** (chief: "based on the AY schedule,
  should be able to determine who is on during the day for Add-ons, which is
  Surg 2"; AY legend: Surg 2 is block 5 Mon/Tue and block 8 Wed–Fri). Empty
  daytime rows are filled from the block schedule for the row's date; never
  a name someone chose, never a row they emptied (`row.cleared`), never
  someone out all day. Nights stay manual. Tagged "Surg 2".
- **Several emergencies at once** (chief: "what if we have a globe come in
  while there is an emergent glaucoma AND cornea case — very rare, but just
  need algorithmic help"). `Assign.planAddOns(kinds, t, …)` runs the how-to's
  own steps (below): Step 6 add-on glaucoma → Surg 4 and add-on cornea →
  Surg 3, skipped for now if they are in a case; Step 9 trauma, then plastics,
  down their chain; Step 10 anything skipped or left (Surg 2 → Surg 3 →
  Surg 4 → Cooper → Surg 1 → Surg 5). Nobody takes two at once. Then Step 12:
  everyone pulled from a clinic gets a coverer from the clinic-coverage chain
  — free, not already covering, never someone taking a case. Each row says
  who was passed over and why. Coverage tab: pick several kinds; "Add all as
  add-on cases". (The first version, 9/28, chose jointly by lowest total chain
  position with an urgency tie-break I made up — replaced by the doc's order.)
- **A morning OR running late** (chief: "if the morning plastics OR goes past
  12:30, who will cover the person until they get to glaucoma? … surg 2
  would cover in glaucoma clinic until the PGY2 is done in the OR"). Coverage
  lists everyone in an OR this morning (an OR block, or a case they are on)
  with a clinic this afternoon — e.g. Mon 9/28 Nahar: Glaucoma OR / Plastics
  OR → Glaucoma PM — with the suggested cover (clinic-coverage chain, Surg 2
  first; `Assign.lateCover`). "Running late until 1:30" stores
  `day.overruns = [{ name, until, cover }]`: the board keeps the resident in
  the OR from `data.pmClinicStart` (12:30) until then and the cover in their
  clinic meanwhile (modelled as a case whose backup is the cover, so gaps /
  NC / Needs coverage work as for any case; Needs coverage offers the fix).
  Live board only — never in the copied schedule. "Out now" ends it.

## Hand-off: paste a sent schedule (9/28/2026)

The chief: "if the person who is Surg 2 on a Wednesday is not the person on
Surg 2 on Tuesday, they may not have the schedule… the Surg 2 person makes
the schedule for the next day… this is necessary for the live coverage
part." Each browser keeps its own drafts, so the day's Surg 2 needs a way to
get the day into theirs.

- **Where**: the landing ("Built by someone else? Paste the schedule they
  sent"), Library → Paste a sent schedule, and callouts on Out today (blank
  day) and Coverage (no cases). Route `#/import/<date>`.
- **What it reads** (js/importer.js, pure): the hand-typed format in use and
  the app's own copied format, with or without `**`, tolerant of bullets,
  en/em dashes, blank lines, non-breaking spaces and the emoji ⚠. Tested on
  a real sent schedule (Mon 9/21/2026, `tests/test-import.js`):
  `- Abendroth x 7 (7:30AM start, service x 4 start @ 9:15AM): Cheng`
  (start; service count + start → the resident is busy from 9:15 for 4
  cases); `(all service, 7:30AM start)`; `- Marous x 2 (CC'd)` (cross-checked:
  no service cases); `Calotti + 1 add-on, timing TBD` (note);
  `-Cornea PM (Meghpara, 28 x 2): Parekh, Bair + 1 procedure @ 12:30 (Bair)`
  (attending + count; text after a name is a note); `-Neuro AM/PM (…)` (both
  sessions); `-CPEC: …` (assignments, not a clinic — skipped);
  `- Samuel (Wills OR AM) c/b n/c`; `c/b Patel AM (Uveitis)/NC d/s PM`
  (`/` or `|` between sessions; `d/s` ignored; `n/c` = NC).
- **Clinics**: only the clinics the paste lists change — hand-typed schedules
  list some clinics, and the rest keep the block schedule's staff (reading an
  unlisted clinic as empty would have shown its residents as free).
- **Case type is the schedulers' call** (chief, 9/28): the paste screen shows
  a type dropdown per case, pre-filled only from firm signals — the type last
  set for that attending in this browser (`surgsched:v2:surgeonTypes`, also
  learned from the Surgery tab), globe/trauma, privates and today's
  CPEC-sheet surgeons = cataract, the clinic a backup covers, the assigned
  resident's Surg role (3 cornea, 4 glaucoma, 1/5 cataract), JHN = plastics;
  otherwise `other`, highlighted. List size is not a signal (glaucoma
  attendings run long lists: Reza ×7, Schuman ×6).
- **Which day**: the add-on labels name it; otherwise the day (today or
  tomorrow) whose Surg 1–5 match the paste, preferring today. Shown and
  changeable; a Surg mismatch with the block schedule is flagged.
- **What the user sees**: "What the app read" — every case (times, service,
  resident, note, type), who is out and who covers, the clinic lines, Night
  Float and add-on call. Flags: lines that could not be read (not loaded),
  names not on the roster, Vacation notes that start with a name, clinic
  labels the app does not have. A line-by-line rebuild check is shown only
  when it matches exactly (the app's own format); for hand-typed pastes the
  wording differs by design, so no diff is shown.
- **Copied schedule change**: a clinic that normally has a resident but has
  nobody today (out and not covered, pulled to cover someone, or removed)
  prints `none` — as sent schedules do (`Plastics PM: None`) — so readers
  see the gap and a paste carries it.
- **Not carried**: "done by" times and add-on flags.
- **Load**: saves the day in this browser (confirm before replacing a draft),
  remembers the types per attending, opens Coverage if it is today, else
  Surgery.

## The status model (js/status.js — pure, Node-tested)

Every resident, every 5 minutes from 7:00 to 17:00, is one of:

| Status | Source |
|---|---|
| out | typed absence; the Night Float resident (post-call, out all day) |
| case | assigned to a case whose busy span covers that minute |
| clinic | own block clinic (CPEC included), a clinic they were added to, an absent resident's clinic they cover, a clinic they cover as a case backup or for a morning OR running late |
| duty | ER, Jeff/Cooper consults, Day Float, off-site (Cooper Clinic / Cooper OR) |
| free | PT, or a Surg role / OR block with nothing booked |

Rules and where they come from:

- **Available = PT, idle OR block, idle Surg role** — chief, 9/2026.
  **CPEC is a clinic, app-wide** — chief, 9/28/2026 ("if people are assigned
  CPEC, assume that they are in clinic — this goes for the whole app"): CPEC
  residents are not free, CPEC has AM/PM rows on Clinics and lines in the
  copied schedule (`CPEC AM: … Patel (for Ransone) …`), and pulling someone
  out of CPEC is a gap to cover (as the sent schedules do: "Patel (AM,
  covering Ransone)"). The engine's CPEC clinic for 9/21 matches the sent
  9/21 CPEC line exactly. Configurable: `data.availability.freeTexts /
  dutyTexts / noCoverTexts`.
- **Day Float covers only the Night Float resident** — chief, 9/2026. The NF
  resident is an automatic all-day absence covered by Day Float; Day Float
  is never listed as free, whatever session they stand in for.
- **Surg 3 and 4 are all day even with clinic** — how-to Step 2. Their
  clinic is where they are when they have no case.
- **A case's busy span**: service-case times if given (one case-length each),
  else the whole list: start + count × minutes-per-case. `Done by` (typed, or
  **Done now** on the day) replaces the estimate. No start ("AM TF") → 7:30.
- **Clinic backup**: a case's backup covers whatever clinic the assigned
  resident is pulled from, for the length of the case. Chains resolve to the
  original owner (Surg 2 covering Bair, then Surg 2 takes a globe and Surg 4
  covers → Surg 4 is covering *Bair's* clinic). `NC` acknowledges a gap.
- **Times**: bare `1:00`–`6:59` mean PM (the CPEC sheet writes 1 PM as
  `1:00`; the old parser read it as 1 AM — fixed). Zero-padded 24-h times
  (`0600`) are literal.

## Who covers: the how-to doc is the authority (chief, 9/28/2026)

"Defer to this for the rules of who to cover" — *How to Surgical Schedule*
(full version). `data.hierarchy[key].step` carries the doc's step number and
`Assign.suggest` / `Assign.planAddOns` assign in that order:

| Step | Cases | Chain |
|---|---|---|
| 3–4 | Scheduled cataracts | the doc: per the master cataract schedule (lounge wall); the app suggests Surg 1 → Surg 5 → Wills OR (Wills OR from the slide deck) |
| 5 | Scheduled cornea / glaucoma | Surg 3 / Surg 4 |
| 6 | Add-on glaucoma / cornea (incl. trauma needing tissue) | Surg 4 / Surg 3 — "if the respective resident is busy in a scheduled case at the time of the add on, skip for now" |
| 7 | Scheduled plastics (incl. Gibbon/JHN) | 1st year on Plastics OR → free and willing 1st/2nd year (Surg 2's discretion) → Surg 4; "if all … are in the OR, skip for now" |
| 8 | Peds | 1st/2nd year on Peds OR → free and willing 1st/2nd year → Surg 4 → Surg 3; skip for now |
| 9 | Add-on trauma and add-on plastics | 1st/2nd year on plastics (TABs and add-on outpatient plastics only) → Surg 2 → Surg 3 → Surg 4 → Cooper → Surg 1 → Surg 5 |
| 10 | Everything still unassigned, chronological | Surg 2 → Surg 3 → Surg 4 → Cooper → Surg 1 → Surg 5 |
| 12 | PM clinic coverage | Surg 2 → Surg 3 → Surg 4 → Cooper → Surg 1 → Surg 5 → Wills OR → Retina |

What changed to follow it (before → after):

- **Order.** Before: peds and all scheduled cases first, then every add-on in
  the order typed, then the rest. After: the doc's step order, so e.g. an
  add-on glaucoma gets Surg 4 before scheduled plastics can (Step 6 before 7),
  and a globe gets Surg 2 before a skipped add-on falls back to Surg 2
  (Step 9 before 10).
- **Skip for now.** Before: a skipped case walked the remaining chain at once.
  After: it waits for Step 10 and goes in chronological order with the rest.
- **Past the end of a chain.** Before: any free senior, then any free junior
  was suggested. After: no suggestion — "Surg 2's call" — and the free
  residents outside the chain are listed (`outside`), never picked. Same for
  clinic cover.
- **Plastics add-ons.** Before: an extra free-junior step (from the 9/27
  answer "PGY2 and PGY3 will be the ones to go first to plastics cases").
  After: the doc's Step 9 — only the junior on Plastics OR, then Surg 2.
  Scheduled plastics keep the doc's free-junior step.
- **Add-on cataracts.** Before: Surg 2 → Surg 1 → Surg 5 → Wills OR. After:
  a remaining case (Step 10). Surg 2 is still first.
- **Add-on cornea / glaucoma / scheduled plastics.** Before: Surg 2 written
  into each chain. After: the doc's chain; Surg 2 comes first at Step 10.
- **JHN/Gibbon/JSC add-ons.** Before: Surg 2 first whatever the case (slide
  deck). After: typed by kind like any add-on (the doc has no location rule):
  a plastics add-on there offers the junior on Plastics OR first, a cornea
  add-on goes to Surg 3.
- **Deck notes that contradicted the doc** were reworded: peds ("all peds
  cases should be covered by a resident"), enucleations/TABs to free juniors
  (scheduled plastics only). "JP Dunn cases are service at the START of the
  year" is left as the deck has it — not a who-covers rule; the doc just says
  "JP Dunn cases are service".

Mechanics, with a board:

- A chain member is **skipped only if out, already in a case, or off-site**
  then (Step 6's "skip for now"), or already picked for another case at that
  time. Surg roles and the Cooper senior in clinic are **not** skipped —
  pulled, and someone covers (Surg 3/4 "are all day even if they have
  clinic"; Surg 2 takes the globe).
- **OR-block tokens** ("1st year on Plastics OR", "on Peds OR", Wills OR)
  take a resident only while they are on that OR: one in clinic at the time
  stays there (chief, 9/27: "if the plastics resident is in clinic then they
  will stay in clinic as default"). This fixes Tue 9/29: Ransone (Plastics OR
  AM, Plastics clinic PM) was being pulled for a 2 PM TAB.
- **free junior** resolves to actual free PGY-2/3s, with a "confirm with
  Surg 2" note (willingness can't be computed).
- Within a step, the doc's listing order (glaucoma before cornea at Step 6,
  trauma before plastics at Step 9), then the order typed. Same-time ties at
  Step 10 keep the step order. The doc does not rank these — assumption.
- **Globe**: Surg 2 takes it even from a clinic they were covering; that
  clinic passes down the clinic-coverage chain (chief, 9/2026). Coverers must
  be free (not out / in a case / in a clinic / on duty / off-site).
- **Off-site** residents (Cooper Clinic, Cooper OR) are skipped by every
  chain, with the reason shown.

## Copied schedule changes (js/export.js)

- Vacation: one line per absence in the chief's format —
  `Ransone (CPEC/Plastics) c/b Patel AM (Uveitis) | Hamou PM (CPEC)`;
  `NC PM`; half days `Ransone AM (CPEC) c/b Patel (Uveitis)`; nobody out →
  `24 strong` (computed). Free-text notes print after the lines.
- Clinic lines follow who is out: `Plastics PM: Hamou (for Ransone)`; NC →
  the name drops; a coverer drops out of their own clinic. The Night Float
  resident's clinic shows the Day Float `(for …)`.
- A case backup of `NC` prints no backup name.

## Assumptions to calibrate

- `data.caseMinutes` (turnover included): cataract 30, cornea 90,
  glaucoma 90, plastics 60, peds 60, retina 90, trauma 120, other 60 —
  **estimates, not measured**.
- Part-private lists without service times are treated as busy for the whole
  list (conservative).
- Sessions: AM before 12:00, PM from 12:00; the board runs 7:00–17:00.

## Decided by the chief (9/27/2026)

- **Block 4 Thursday AM** is CPEC (YAG clinic), per the updated AY PDF —
  data.js fixed (PM stays Retina OR). The PGY-2 Block 2 Thursday AM "YAG
  Clinic" footnote was added as a note too.
- **Surg 3/4 print all day**: `Surg 3 - Bair`, never `AM | none PM`
  (`data.allDaySurg`, engine flag `surg[n].allDay`).
- **"Cooper" in the chains = the PGY-4 on the Cooper block** (block 7,
  `data.years.pgy4.cooperBlock`; engine `roster.cooperSenior`) — no longer
  the PGY-2 on Cooper consults.
- **Plastics junior in Plastics clinic stays in clinic**; plastics add-ons
  then fall to the seniors (Surg 2 first). (Said on 9/27 to be what the chains
  already did — true on Mondays, not on Tuesday afternoons; fixed 9/28, see
  "OR-block tokens" above.)
- `d/s` is ignored; no "send to phone" link.
- **Add-on call names are PGY-4s**: the add-on dropdowns list the seniors,
  with "Other…" opening every resident for the rare exception.
- **v2**: the app shows "v2"; v1 is kept as `v1/index.html` (one file; its
  saved days use separate storage keys) and its source is main @ `29d8fa0`
  (a `v1` tag could not be pushed from the build session — create it on
  GitHub at that commit).

## Still assumptions (say so if wrong)

- **Off-site**: Cooper Clinic / Cooper OR are at Cooper, so a chain never
  pulls those residents into a Wills case or clinic (they stay pickable by
  hand). `data.availability.offsiteTexts` — empty it to turn this off.
- Case lengths (`data.caseMinutes`) and the whole-list rule above.
- Day-of use on other devices: data lives in one browser (localStorage).

## Tests

`node tests/test-status.js`, `test-coverage.js`, `test-vacation.js` (new),
plus the existing engine / assign / integration suites.
