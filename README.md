# Surg Schedule Builder

A no-install web app that helps the chief resident build the daily surgery
schedule the evening before. Everything derivable from the AY block schedules
is auto-filled from just the date; case lists and patient counts (which live
in several EMRs) are entered manually and run through the case-assignment
hierarchy from the "How to Surgical Schedule" doc.

## Run it

Download/clone this folder and **double-click `index.html`** — it opens in any
modern browser. No server, no install, no internet needed; nothing leaves the
machine. Work-in-progress saves automatically in the browser, per date.

## Workflow

1. **Pick the date** (defaults to tomorrow) → the app computes every
   resident's block assignment: Surg 1–5, WER, Jeff/Cooper Consults, Day
   Float, clinic rosters, taskmasters, and the nth-weekday special rules
   (Peds OR 4th Tues, Plastics OR 4th Wed, Abendroth 3rd Wed, …).
2. **Day Roster tab** — review the auto-roster; type in Night Float,
   add-on call, vacation, lectures, and Cooper consult buddies.
   *Start from yesterday* carries those over from the previous day.
3. **Cases & Clinics tab** — enter the OR cases from Cerner/Nextgen
   (surgeon, count, start, category, service count, add-on) and the manual
   clinic patient counts (e.g. `29x3`).
4. **Assign tab** — *Suggest all* applies the hierarchy (add-on glaucoma →
   Surg 4, peds → junior on Peds OR → … , remaining chronologically through
   Surg 2 → 3 → 4 → Cooper → 1 → 5) with conflict and workload warnings.
   Nothing is auto-assigned: accept, pick an alternate, or override freely.
5. **Preview & Copy tab** — the finished schedule in the standard document
   format; *Copy formatted* pastes with bold into Google Docs/Word/email.
6. **Reference tab** — the hierarchy, scheduling notes, and all three block
   grids, so nobody needs the PDF.

## Sharing it with others

Three options, easiest first:

1. **Send the single file** — `dist/surg-schedule.html` is the whole app in
   one HTML file (rebuild with `node tools/bundle.js`). Email/Slack it;
   recipients just double-click it. Their entries stay in their own browser.
2. **Hosted page** — the app is also published as a private claude.ai page
   that can be shared from its share menu.
3. **GitHub Pages** — once this repository is made public, run the
   *Deploy to GitHub Pages* workflow from the Actions tab; the app then lives
   at `https://mak-djulbegovic.github.io/surgery_schedule/`. (Pages is not
   available on private repos on the free plan.)

Note: saved schedules live in each viewer's own browser (localStorage) —
sharing a link shares the app, not your entered data.

## Updating for a new academic year

All schedule knowledge lives in `js/data.js` (block grids, block date ranges,
footnote rules, hierarchy chains). Edit that one file when rotations or
residents change.

## Development

Plain HTML/CSS/JS — no build step. Tests (plain Node, no dependencies):

```
node tests/test-engine.js
node tests/test-assign.js
node tests/test-integration.js
```

`SPEC.md` documents the architecture and module contracts.
