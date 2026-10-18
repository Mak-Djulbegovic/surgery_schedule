# Audit — 10/18/2026

The request: the Coverage tab did not follow changes made on earlier tabs
("if Surg 2 is out on vacation, it does not account for that in the coverage
tab"), a flow chart people can refer to, and an audit for inconsistencies.
This note lists what was found, what changed, and what is still open. Each
finding was reproduced (in the browser, or with the Node modules) before it
was changed, and has a test where the logic is testable in Node.

## The reported problem, reproduced

Mon 10/19/2026: Surg 2 is Cheng. Out today: Cheng on vacation, covered by
Wibbelsman (CPEC) all day. Cheng had been given Tyson × 3 at 1 PM the night
before. What Coverage showed:

| Coverage showed | Why |
|---|---|
| A 1 PM globe → Djulbegovic (Surg 3), pulled out of Cornea clinic | "Surg 2" in the chain was Cheng from the block schedule → out → skipped; Wibbelsman was in no chain |
| Running late from the morning OR → Shields (Surg 4) covers | same, in the clinic-coverage chain |
| Daytime add-on call: **Cheng**, tagged "Surg 2" | filled in when the day was opened, never revisited when Cheng was marked out |
| Tyson × 3 on the check-off list as Cheng's; nothing under Needs coverage | the board ignored Cheng's case (out wins) but nothing listed it as open |

**Root cause**: a coverer took over the absent resident's clinic slot on the
board, never their role in the how-to's chains.

**The rule now**: covering someone is doing their job for that session —
their duty and their place in every chain. Surg 2 c/b Wibbelsman makes
Wibbelsman Surg 2 for that session on every tab and in the copied schedule.
NC leaves nobody in the role, and the chains move on as before. Day Float
covering the Night Float resident is the exception (Day Float is never
available, chief 9/2026).

## Findings and what changed

**Coverage vs the earlier tabs**

1. Chains ignored the coverer (above). Fixed in `status.js` (`standIn`,
   `actingSurg`) and `assign.js` (tokens resolve through stand-ins for the
   session(s) a case touches) — suggestions, add-ons, clinic cover and late
   cover all follow. Tests: `test-coverage.js` (covered all day, half day,
   split AM/PM, NC, Day Float).
2. A case already assigned to someone later marked out was red on Surgery
   but invisible everywhere else: still on Coverage's check-off list, not in
   Needs coverage, not counted in "N need a resident", skipped by **Assign
   all**, not mentioned by Preview's send-check; and its replacement was not
   claimed, so another case could be offered the same person at the same
   time. Now it is a need ("Cheng is out: needs a new resident", with the
   how-to's pick one click away), counted everywhere, and its replacement is
   claimed. Tests: `test-status.js`, `test-coverage.js`.
3. Daytime add-on call kept Surg 2's name after they were marked out. Now a
   row the app filled follows the acting Surg 2 (the coverer, or empty with a
   prompt when nobody covers); a name someone picked stays but is flagged
   "out that day".
4. Out today's warning for a Surg role said their cases "go to the next
   person in each chain" even after a coverer was picked. It now says who
   becomes Surg *n*, or what NC means.
5. Roster's Surg tile said "OUT today — see Out today" (all-day only; a
   half-day absence showed nothing) and never who covers. It now says "Out
   today — Wibbelsman covers", "Out AM — NC", etc.
6. The copied schedule disagreed with itself: its Assignments, WER and
   consult lines printed the block-schedule names even when that person was
   out, while its Vacation lines said who covers — and the Night Float
   resident was printed on WER during an ER week. They now use the clinic
   lines' notation: `Surg 2 - **Wibbelsman (for Cheng)**`, `none (Cheng
   out)` for NC, `TBD (Cheng out)` while undecided. The paste reader reads
   these back. Tests: `test-import.js`.
7. A CPEC-sheet list whose cover (Surg 1/5, Wills OR, Retina) was out was
   left unassigned even when someone covered them. It now goes to the coverer.

**Two ways of saying the same thing**

8. "Done now" on Surgery wrote the end time into "Done by"; Coverage's check-off
   set `done`. A case finished on one tab was still running on the other.
   Both now check the case off.
9. Out today decided "no cover needed" from `noCoverTexts` alone; the board
   also counts the pull-first clinics (Retina / Uveitis). Same answer with the
   built-in data, different with an imported configuration. Unified.
10. The Roster glance had its own WER formatting; it now uses the copied
    schedule's, stand-ins included.
11. "Wills/ASC" and "Other (Stadium / Cherry Hill)" contradicted each other —
    the ASC is Stadium — and CPEC-sheet lists at Stadium were filed under
    Wills/ASC. Now **Wills** and **Stadium / Cherry Hill (ASC)**; Stadium and
    Cherry Hill lists from the CPEC sheet go there. Saved days keep their
    cases (same keys); old pastes with "Wills/ASC" are read as Wills unless
    the line or that day's CPEC sheet says Stadium / Cherry Hill.

**Stale text**

12. How-to described Coverage as showing "every resident's day on one screen"
    at "any time you pick" (both removed in an earlier version), and listed
    Night Float and add-ons as typed by hand (both fill in now).
13. The CPEC reference pointed to "Cases & Clinics" and the add-on copy toast
    to "Day Roster or Cases & Clinics" — tabs that no longer exist.
14. The README screenshots showed the old Coverage tab (timeline, "As of"
    picker). Regenerated.
15. Roster's empty state told users to press "Create Surg Schedule", which is
    not in the workspace.

**Smaller**

16. A case's backup showed green whatever their status. It now shows red
    ("out" / "in a case") or amber (leaving their own clinic).
17. **Start from yesterday** copied add-on names row by row, so Monday
    night's name landed on Tuesday night and Tuesday daytime's on Wednesday.
    Rows now match by date and period.
18. The landing page's Surg tiles said "out" but not who covers.

## Still open — questions for the chief

- **Cooper buddies are not on the board.** The buddy (pulled from, e.g.,
  Retina) shows as available / pull-first that session. Moot since Labor Day
  for this year; matters next July. Is the buddy at Cooper for the session?
- **Absences are entered per day.** A week of vacation is entered each day
  (Start from yesterday carries who is out, not who covers — coverers depend
  on that weekday). The next day's add-on row only knows tomorrow's absences
  once tomorrow is saved.
- **The copied schedule's format changed** (Surg / WER / consult "(for X)",
  a Stadium/Cherry Hill section after Wills). Worth a look before it goes
  out.
- **Needs coverage suggests one fix at a time**: two open gaps can suggest
  the same coverer for overlapping windows; after the first click the second
  updates.
- Assumptions, as listed in docs/UISPEC6.md (10/18/2026): a coverer inherits
  every chain place whatever their year; Surg 2 out all day → the AM coverer
  takes daytime add-ons; after the ER, a case without its resident is the
  most urgent need.
