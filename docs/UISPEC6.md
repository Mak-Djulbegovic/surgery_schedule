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

## The status model (js/status.js — pure, Node-tested)

Every resident, every 5 minutes from 7:00 to 17:00, is one of:

| Status | Source |
|---|---|
| out | typed absence; the Night Float resident (post-call, out all day) |
| case | assigned to a case whose busy span covers that minute |
| clinic | own block clinic, a clinic they were added to, an absent resident's clinic they cover, or a clinic they cover as a case backup |
| duty | ER, Jeff/Cooper consults, Day Float, off-site (Cooper Clinic / Cooper OR) |
| free | CPEC, PT, or a Surg role / OR block with nothing booked |

Rules and where they come from:

- **Available = CPEC, PT, idle OR block, idle Surg role** — chief, 9/2026.
  Configurable: `data.availability.freeTexts / dutyTexts / noCoverTexts`.
- **Day Float covers only the Night Float resident** — chief, 9/2026. The NF
  resident is an automatic all-day absence covered by Day Float; Day Float
  is never listed as free, even when standing in for a CPEC session.
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

## Assignment with availability (js/assign.js)

Unchanged without a board (old tests pass as before). With a board:

- A chain member is **skipped only if out or already in a case** then
  (how-to Step 6: "skip for now"). Being in clinic does not skip them — they
  are pulled and someone covers.
- Skipped cases fall through to the **remaining-cases chain** (Step 10), then
  **any free senior**, then **any free junior** ("the next available senior
  or resident").
- **free junior** resolves to actual free PGY-2/3s, with a "confirm with
  Surg 2" note (willingness can't be computed).
- **Globe**: Surg 2 takes it even from a clinic they were covering; that
  clinic passes down the clinic-coverage chain (chief, 9/2026). Coverers must
  be free (not out / in a case / in a clinic / on duty / off-site).
- **Off-site** residents (Cooper Clinic, Cooper OR) are skipped by every
  chain, with the reason shown.
- **Plastics add-ons**: new chain `plasticsAddOn` — junior on Plastics OR →
  free junior → Surg 2 → … (chief: "PGY-2 and PGY-3 go first to plastics").

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
- **Plastics junior in Plastics clinic stays in clinic**; with no free
  junior, plastics add-ons fall to the seniors (Surg 2 first). This is what
  the chains already do — pinned by tests.
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
