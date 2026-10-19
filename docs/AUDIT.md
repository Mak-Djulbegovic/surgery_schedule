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

## Second pass — an independent read-only audit

A second, independent audit of the code (after the fixes above) reported
ten more. Each was reproduced again before changing anything; nine were
real and are fixed, one is a deliberate format rule (last item).

19. **The paste reader could not read the app's own Vacation line** when its
    first session was NC or undecided — `Ransone (CPEC/Plastics) NC AM | c/b
    Hamou PM (CPEC)`, `AM coverage TBD | NC PM` — so it became a note and
    Ransone looked free after the paste. Fixed; a 7,500-day random copy →
    paste → copy test now comes back identical every time (it also caught
    block names with brackets of their own, "Stadium OR (Abendroth)", and
    resident-less lines with a bracketed note — both fixed).
20. **Day Float out**: the Night Float resident's duties were still shown as
    covered by the Day Float — the copied schedule printed "Camacho (for
    Cotton)" next to "Camacho (Day Float) — coverage TBD", and nothing was
    under Needs coverage. Now it is an open need ("Day Float Camacho is out")
    and the copied schedule no longer prints the stand-in.
21. **A CPEC-sheet list added while its cover was out became a private list**
    (service count 0), so nobody was asked to fill it. Sheet lists now start
    as all service (how a pasted schedule reads them back anyway).
22. **"Under Needs coverage" claimed for cases that were not**, and a case
    already checked off counted as open on Surgery once its resident was
    marked out. One rule now everywhere: a service case, not checked off,
    with nobody or with its resident out.
23. **Clinics-tab notes were stricter than the board**: red "nobody covering"
    for Retina / Uveitis (no cover needed) and for labels the board does not
    count as a clinic (an attending's cataract day, Cooper Clinic).
24. **Roster's Day Float line used the call schedule's Night Float**, not the
    field — after a swap it named the wrong resident (the landing page also
    showed a Night Float that had been blanked on purpose).
25. **Two Vacation lines for one resident** (possible in a paste) — the copied
    schedule printed both, the board used only the first. Merged into one
    row on paste and on load.
26. **A case across noon that pulls someone from two clinics** (CPEC AM,
    Cornea PM) got a backup checked for the first only, shown green, while
    the board had them cover both. The backup is now checked for the whole
    window ("CPEC / Cornea").
27. **The copied schedule said "— coverage TBD" for absences that need no
    cover** (Retina, Uveitis, PT, Day Float). Now `Calotti (Retina)`, and a
    half-and-half line names only the session that needs a decision.
28. Small: a resident pulled from Retina / Uveitis showed an amber dot (green
    for a backup); a note with brackets gained a pair on every paste; the
    landing page's "needs a resident" ignored cases whose resident is out;
    the flow chart's "no cover" list is now read from the configuration.

Not changed: **a case backup of NC is not printed** on the case line — a
deliberate rule ("the literal NC never prints on a case line", tested). The
consequence is that a pasted schedule shows that clinic gap as open again;
the receiver marks NC once more.

## Third pass — Surg 2 and the globe

After the rule "surg 2 is ALWAYS going to take a globe" (and, with no
globe, Surg 2 free for the Surg 3 / Surg 4 PM clinics), a run of the week of
10/19 showed what the app did with it. Details and the day-by-day result:
docs/UISPEC6.md, "Surg 2 and the globe".

29. **A scrubbed Surg 2 was passed over for a globe** — it went down the
    trauma chain: Surg 4 on Mon, Surg 3 on Tue, the Cooper senior pulled out
    of CPEC on Wed, Surg 1 on Thu. Now Surg 2 (or whoever covers them)
    always takes it — operating, it follows their cases, with no estimated
    start — on Coverage and on Surgery. Tests: `test-coverage.js`.
30. **The Coverage planner could not say "no globe"** — it always held one,
    and the last row could not be removed. It now starts empty, and with no
    globe shows Surg 2 free, what Surg 2 already has, and the Surg 3 /
    Surg 4 PM clinics with their backups.
31. **After "Add it as an add-on case" the planner kept the globe**, ready to
    be added a second time, and planned add-ons carried over to the next
    date. Both now reset; a globe on Surgery shows as "Globe today".
32. **The rules were only in the Library.** The flow chart's cards are now
    at the foot of Coverage too, with a Surg 2 and the globe chart whose
    weekdays come from the block schedule.
33. **Coverage showed estimated case times as if known** ("7:30 AM–12:30 PM
    (est.) · clears 12:30 PM", "until 2:30 PM (est.)"). Fixed at the root in
    the fourth pass: no estimates at all.

## Fourth pass — the Coverage revamp

34. **Case lengths were guessed** (30 minutes a cataract, 90 a cornea …)
    and drove who looked free, clinic gaps and backups. Now a list counts for
    the session it starts in until it is checked off ("Done by" or "All
    day" override; one resident's lists run back to back). Tests rewritten
    in `test-status.js` / `test-coverage.js`.
35. **The running-late card** asked for an "until" time to plan cover. It is
    gone (and saved overruns are dropped); Coverage lists everyone who goes
    from a morning OR to an afternoon clinic — every year, from the block
    schedule and that morning's lists — to be aware of.
36. **Coverage was seven cards of explanation.** It is now one AM | PM board
    (operating with check-off, free, pull first, out) under that list, with
    the globe planner and the add-on call; rules that are understood (the
    CPEC urgent-case line, the Surg 3 / Surg 4 clinic list, the "both
    clinics" warning) are built in, not spelled out.

## Fifth pass — eight reviewers (10/19/2026)

The merged change, the whole app, each page, design and usability, each
reproduced in Node or the browser. Fixed (regression tests in
test-status / test-coverage / test-import / test-vacation):

37. **A list checked off before it began** took the check-off time as its
    start and cut short the resident's running list — they showed free while
    scrubbed and were offered for other cases. It keeps its start now and
    ends nothing.
38. **The back-to-back rule dropped a partly private list's later service
    time** when another list came between; it clips span by span.
39. **Adding the Night Float resident on Out today** (what the Day-Float-out
    need asks) replaced the automatic absence: the post-call resident could
    be put in a morning clinic, the Day Float counted as free. Merged now.
40. **A cover picked twice, or a cover who is out too, was dropped
    silently** — the ER could go unstaffed with no need raised, and the
    copied schedule still named the cover. Both are open needs now; every
    tab and the copy read covers from the board (`board.coverOf`).
41. **A later globe took Surg 2 from an earlier add-on** (lists run to the
    end of their session, so they all overlapped); the globe follows it.
42. **The planner dropped the clinic hand-off** when Surg 2 also had a later
    list, and **two globes handed one clinic to two people**.
43. **Reassigning a case kept its backup** — "Cheng; Cheng" in the copy.
44. **A blank line** (Enter after the last case) was suggested a resident,
    counted as open and copied as "-? x1".
45. **Svc stayed 1 when # changed** ("Hark x4 … x1 service").
46. **"OK / Take X off CPEC"** edited who staffs the clinic and outlived the
    absence (the coverer then showed free); it is an acknowledgment now.
47. **× on a struck clinic chip** silently removed the cover from the copy.
48. **The paste screen went blank** on a clinic line with no label.
49. **Odd starts:** "PM TF" counted for the morning; a 5:30 PM start ended
    before it began; two lists at one start were "double-booked".
50. **Smaller:** the coverer's own clinic gap listed twice; a checked-off
    case reopened when its resident was later marked out; Coverage badge on
    weekends; impossible URL dates; the CPEC sheet's highlight did not follow
    the date; the add-on call kept an old configuration's Surg 2; "until X is
    back" for an owner out all day; send-check green over contradictions.

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
- **A case backup of NC does not survive a paste** (see above). Printing it
  as "; NC" would carry it — say if that is wanted on the sent schedule.
- **Engine vs board on two labels**: the engine lists an attending's cataract
  day (Tabas / Dunn) and Cooper Clinic as clinics (Clinics tab, copied
  schedule); the board treats them as an OR day and off-site. The Clinics
  tab no longer claims a gap there, but the two views still differ.
- **Needs coverage suggests one fix at a time**: two open gaps can suggest
  the same coverer for overlapping windows; after the first click the second
  updates.
- **A morning list counts for the morning only.** One that runs all day
  needs "All day" in its start or a Done by time; otherwise the resident
  looks free (and back in clinic) from noon. The morning OR → afternoon
  clinic list is the reminder. Should a big list (say 6+ cataracts at 7:30)
  count as all day without being told?
- **Deferred from the 10/19/2026 review round** (parked by the chief, not
  decided; the app keeps today's behaviour until then):
  - **A coverer's own clinic seat.** When someone covers an absent resident,
    their own clinic is flagged "one short" even if others are still in it
    (one click acknowledges it, keyed to that cover). The Clinics reviewer
    suggests flagging only a clinic left empty; that reverses a test.
  - **Bigger workflow changes proposed:** Night Float picked from a list on
    Out today (not typed on Roster); one tap to carry yesterday's absences
    over; a Roster with nothing to type (lectures move to Out today); an
    add-on chosen as a case type on Surgery instead of a checkbox behind ⋯.
  - **Smaller held items:** the copied CPEC line as one line with (AM)/(PM)
    tags, as sent on 9/21; a note typed after a clinic's names (e.g. "+ 1
    procedure @ 12:30") kept after the names, not folded into the
    parenthesis; removing assign.js's board-less path, which only tests use.
  - **Release:** these changes are on the branch; a new pull request and
    deploy wait for the go-ahead.
- Assumptions, as listed in docs/UISPEC6.md (10/18/2026): a coverer inherits
  every chain place whatever their year; Surg 2 out all day → the AM coverer
  takes daytime add-ons; after the ER, a case without its resident is the
  most urgent need.
