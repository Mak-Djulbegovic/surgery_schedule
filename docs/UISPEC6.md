# Iteration 6 — who is free, when: vacation, coverage, and a streamlined flow

Read docs/SPEC.md and UISPEC2/3/5 first. This iteration adds a time model
(who is doing what at any minute of the day) and rebuilds the UI around the
how-to's order. Status: **prototype on a branch — not deployed.**

## Flow (tabs follow "How to Surgical Schedule")

| Tab | How-to step | What happens |
|---|---|---|
| 1 Out today | Step 1 — vacation coverage | "No one out — 24 strong", or add who is out (all day / AM / PM, reason) and pick who covers each session, or **NC** |
| 2 Roster | Step 2 — Surg 1–5 | as before; Surg 3/4 shown as **all day** ("Cornea PM if no case") |
| 3 Surgery | Steps 3–10 — cases | CPEC-sheet cataracts (+ Add all), then the case list; the resident is picked **on each case** (one-click suggestion + availability-grouped dropdown); the old Assign tab is gone |
| 4 Clinics | Steps 11–12 — clinics | counts as before; each clinic shows who is out / pulled into a case and who covers; "Needs coverage" list on top |
| 5 Coverage | the new backup view | time control (Now / any time), who is free, "if a globe comes in at t", everyone's day on one timeline, add-on call names |
| 6 Preview & Copy | — | the document |

How-to, CPEC sheet, block schedules and Setup moved to a **Library** menu.
A **Free AM / Free PM** strip (and **Free now** on today's date) sits under
the tabs on every workflow tab; tab badges count what is still open.

## The status model (js/status.js — pure, Node-tested)

Every resident, every 5 minutes from 7:00 to 17:00, is one of:

| Status | Source |
|---|---|
| out | typed absence; the Night Float resident (post-call, out all day) |
| case | assigned to a case whose busy span covers that minute |
| clinic | own block clinic, a clinic they were added to, an absent resident's clinic they cover, or a clinic they cover as a case backup |
| duty | ER, Jeff/Cooper consults, Day Float |
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
  be free (not out / in a case / in a clinic); the Cooper resident may cover
  because the how-to names them.
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

## Open questions (not built — waiting on the chief)

1. PGY-4 Block 4 **Thursday AM**: the updated PDF says CPEC (YAG clinic, in
   red); data.js still says Retina OR. Not changed without sign-off.
2. Copied `Surg 3 - Bair AM | none PM` vs all-day `Surg 3 - Bair`.
3. `d/s` in "Hamou d/s PM" — meaning / whether it is a separate option.
4. `COOPER` in the chains resolves to the PGY-2 on Cooper consults; the
   how-to's chains are otherwise seniors — should it be the PGY-4 on the
   Cooper block?
5. "1st or 2nd year on plastics" for add-ons is coded as *on Plastics OR*;
   should the junior on the plastics block (e.g. in Plastics clinic) count?
6. Day-of use on other devices: data lives in one browser (localStorage).

## Tests

`node tests/test-status.js`, `test-coverage.js`, `test-vacation.js` (new),
plus the existing engine / assign / integration suites.
