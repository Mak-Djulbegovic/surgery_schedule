#!/usr/bin/env node
/*
 * tests/test-integration.js — plain Node integration test. No dependencies.
 * Run: node tests/test-integration.js   (exits non-zero on any failure)
 *
 * Requires js/data.js + js/engine.js + js/assign.js + js/export.js together
 * and checks:
 *   (1) the full SPEC "Verification fixture" for Engine.resolveDay('2026-07-22')
 *       (plus the SPEC "Also:" boundary dates);
 *   (2) Assign.suggest on a realistic 7/22 case list against the REAL engine
 *       roster (not a hand-built fixture);
 *   (3) ExportFmt.buildText / buildHTML on the combined state.
 *
 * NOTE on the peds case: the task brief expected "(no Peds OR junior on Wed)
 * -> Surg 4 chain", but per data.js the pgy2 block-3 Wednesday AM cell IS
 * 'Peds OR' and no 4th-Wednesday override changes it — the SPEC verification
 * fixture itself requires orBlocks['Peds OR'].am to include Momenaei on
 * 2026-07-22. So per the SPEC peds chain
 * ['PEDS_OR_JUNIOR','FREE_JUNIOR','Surg 4','Surg 3'] the correct primary
 * suggestion is Momenaei, with Bair (Surg 4) then Aguwa (Surg 3) as chain
 * alternates. This test asserts the SPEC-correct behavior.
 *
 * NOTE on the export text check: SPEC's target format renders bold as
 * '**Name**' in the plain-text flavor (sample block literally shows
 * 'Surg 1 - **Cheng**'), so the raw buildText output contains
 * 'Surg 1 - **Cheng**' and only the bold-stripped text contains the literal
 * 'Surg 1 - Cheng'. Both are asserted below.
 */
'use strict';

var path = require('path');
var DATA = require(path.join(__dirname, '..', 'js', 'data.js'));
var Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
var Assign = require(path.join(__dirname, '..', 'js', 'assign.js'));
var ExportFmt = require(path.join(__dirname, '..', 'js', 'export.js'));

var failures = 0;
var checks = 0;

function ok(cond, msg) {
  checks++;
  if (cond) return;
  failures++;
  console.error('FAIL: ' + msg);
}

function eq(actual, expected, msg) {
  ok(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function sameMembers(actual, expected, msg) {
  var a = (actual || []).slice().sort();
  var e = (expected || []).slice().sort();
  ok(JSON.stringify(a) === JSON.stringify(e),
    msg + ' — expected members ' + JSON.stringify(e) + ', got ' + JSON.stringify(a));
}

function includes(arr, v, msg) {
  ok((arr || []).indexOf(v) !== -1, msg + ' — ' + JSON.stringify(v) + ' not in ' + JSON.stringify(arr));
}

function contains(haystack, needle, msg) {
  ok(String(haystack).indexOf(needle) !== -1, msg + ' — missing ' + JSON.stringify(needle));
}

function names(entries) {
  return (entries || []).map(function (e) { return typeof e === 'string' ? e : e.name; });
}

function byName(day, name) {
  for (var i = 0; i < day.residents.length; i++) {
    if (day.residents[i].name === name) return day.residents[i];
  }
  return null;
}

function findByCase(results, id) {
  for (var i = 0; i < results.length; i++) {
    if (results[i].caseId === id) return results[i];
  }
  return null;
}

function hasWarning(res, re) {
  return !!res && (res.warnings || []).some(function (w) { return re.test(w); });
}

/* ================================================================== */
/* module contract: all four requireable together                      */
/* ================================================================== */

ok(DATA && typeof DATA === 'object' && DATA.years, 'data.js exports SCHED_DATA');
ok(Engine && typeof Engine.resolveDay === 'function', 'engine.js exports Engine.resolveDay');
ok(Assign && typeof Assign.suggest === 'function', 'assign.js exports Assign.suggest');
ok(Assign && typeof Assign.classify === 'function', 'assign.js exports Assign.classify');
ok(ExportFmt && typeof ExportFmt.buildText === 'function', 'export.js exports ExportFmt.buildText');
ok(ExportFmt && typeof ExportFmt.buildHTML === 'function', 'export.js exports ExportFmt.buildHTML');

/* ================================================================== */
/* (1) SPEC Verification fixture — Engine.resolveDay('2026-07-22')     */
/* ================================================================== */

var roster = Engine.resolveDay('2026-07-22', DATA);

eq(roster.date, '2026-07-22', 'fixture: date');
eq(roster.weekdayKey, 'wed', 'fixture: weekdayKey wed');
eq(roster.nth, 4, 'fixture: 4th Wednesday');
eq(roster.inYear, true, 'fixture: inYear');
eq(roster.isWeekend, false, 'fixture: not weekend');

// Surg 1 Cheng (am+pm)
eq(roster.surg['1'] && roster.surg['1'].name, 'Cheng', 'fixture: Surg 1 = Cheng');
eq(roster.surg['1'] && roster.surg['1'].am, true, 'fixture: Surg 1 am');
eq(roster.surg['1'] && roster.surg['1'].pm, true, 'fixture: Surg 1 pm');
// Surg 2 Calotti (am+pm)
eq(roster.surg['2'] && roster.surg['2'].name, 'Calotti', 'fixture: Surg 2 = Calotti');
eq(roster.surg['2'] && roster.surg['2'].am, true, 'fixture: Surg 2 am');
eq(roster.surg['2'] && roster.surg['2'].pm, true, 'fixture: Surg 2 pm');
// Surg 3 Aguwa (AM only; PM 'Cornea')
eq(roster.surg['3'] && roster.surg['3'].name, 'Aguwa', 'fixture: Surg 3 = Aguwa');
eq(roster.surg['3'] && roster.surg['3'].am, true, 'fixture: Surg 3 AM only — am true');
eq(roster.surg['3'] && roster.surg['3'].pm, false, 'fixture: Surg 3 AM only — pm false');
eq(roster.surg['3'] && roster.surg['3'].pmText, 'Cornea', 'fixture: Surg 3 pmText = Cornea');
// Surg 4 Bair (AM only; PM 'Glaucoma')
eq(roster.surg['4'] && roster.surg['4'].name, 'Bair', 'fixture: Surg 4 = Bair');
eq(roster.surg['4'] && roster.surg['4'].am, true, 'fixture: Surg 4 AM only — am true');
eq(roster.surg['4'] && roster.surg['4'].pm, false, 'fixture: Surg 4 AM only — pm false');
eq(roster.surg['4'] && roster.surg['4'].pmText, 'Glaucoma', 'fixture: Surg 4 pmText = Glaucoma');
// Surg 5 Wibbelsman (am+pm)
eq(roster.surg['5'] && roster.surg['5'].name, 'Wibbelsman', 'fixture: Surg 5 = Wibbelsman');
eq(roster.surg['5'] && roster.surg['5'].am, true, 'fixture: Surg 5 am');
eq(roster.surg['5'] && roster.surg['5'].pm, true, 'fixture: Surg 5 pm');

// Consults / float / WER
sameMembers(roster.jeffConsults, ['Cotton'], 'fixture: jeffConsults = [Cotton]');
sameMembers(roster.cooperConsults, ['Illiano'], 'fixture: cooperConsults = [Illiano]');
sameMembers(roster.wer.am, ['Nahar', 'Hamou'], 'fixture: wer.am = Nahar+Hamou (order free)');
includes(roster.wer.pm, 'Patel', 'fixture: wer.pm includes Patel');
sameMembers(roster.dayFloat, ['Tang'], 'fixture: dayFloat = [Tang]');

// Clinics
sameMembers(names(roster.clinics['Cornea'] && roster.clinics['Cornea'].pm),
  ['Momenaei', 'Williamson', 'Aguwa'], 'fixture: Cornea.pm = Momenaei+Williamson+Aguwa');
sameMembers(names(roster.clinics['Glaucoma'] && roster.clinics['Glaucoma'].pm),
  ['Ransone', 'Bair'], 'fixture: Glaucoma.pm = Ransone+Bair');
includes(names(roster.clinics['Peds'] && roster.clinics['Peds'].am), 'Parekh', 'fixture: Peds.am includes Parekh');
includes(names(roster.clinics['Peds'] && roster.clinics['Peds'].pm), 'Parekh', 'fixture: Peds.pm includes Parekh');
sameMembers(names(roster.clinics['Neuro'] && roster.clinics['Neuro'].am),
  ['Teng', 'DeSimone'], 'fixture: Neuro.am = Teng+DeSimone');
includes(names(roster.clinics['Plastics'] && roster.clinics['Plastics'].pm), 'Marshall',
  'fixture: Plastics.pm includes Marshall');

// OR blocks: Camacho pgy3 block 5 → Plastics OR on the 4th Wednesday
includes(names(roster.orBlocks['Plastics OR'] && roster.orBlocks['Plastics OR'].pm), 'Camacho',
  'fixture: orBlocks[Plastics OR].pm includes Camacho (4th-Wed override)');

// Samuel Wed = Retina both sessions
eq(byName(roster, 'Samuel') && byName(roster, 'Samuel').am.text, 'Retina', 'fixture: Samuel Wed AM = Retina');
eq(byName(roster, 'Samuel') && byName(roster, 'Samuel').pm.text, 'Retina', 'fixture: Samuel Wed PM = Retina');

// Taskmasters
sameMembers(roster.taskmasters, ['Hamou', 'Ransone'], 'fixture: taskmasters = Hamou & Ransone');

/* ---- SPEC "Also:" boundary dates ---- */
var d0720 = Engine.resolveDay('2026-07-20', DATA);
eq(byName(d0720, 'Bair') && byName(d0720, 'Bair').block, 3, 'also: 7/20 pgy4 Bair block 3');
eq(byName(d0720, 'Cheng') && byName(d0720, 'Cheng').block, 1, 'also: 7/20 pgy4 Cheng block 1');
eq(byName(d0720, 'Calotti') && byName(d0720, 'Calotti').block, 8, 'also: 7/20 pgy4 Calotti block 8');

var d0810 = Engine.resolveDay('2026-08-10', DATA);
eq(byName(d0810, 'Bair') && byName(d0810, 'Bair').block, 4, 'also: 8/10 rollover Bair block 4');

var w1 = Engine.resolveDay('2026-11-23', DATA); // Monday — winter range start
eq(byName(w1, 'Bair') && byName(w1, 'Bair').block, 1, 'also: 11/23 winter Bair block 1');
eq(byName(w1, 'Ransone') && byName(w1, 'Ransone').block, 8, 'also: 11/23 winter pgy2 Ransone block 8');
var w2 = Engine.resolveDay('2027-01-15', DATA); // Friday — winter range last weekday
eq(byName(w2, 'Ransone') && byName(w2, 'Ransone').block, 8, 'also: 1/15/27 pgy2 winter range still active');
eq(byName(w2, 'Bair') && byName(w2, 'Bair').block, 2, 'also: 1/15/27 Bair block 2 (rolled 12/14)');
var w3 = Engine.resolveDay('2027-01-18', DATA); // Monday after winter range
eq(byName(w3, 'Bair') && byName(w3, 'Bair').block, 3, 'also: 1/18/27 Bair rolled to block 3');

var last = Engine.resolveDay('2027-06-30', DATA);
eq(last.inYear, true, 'also: 6/30/27 last day valid');
eq(last.residents.length, 24, 'also: 6/30/27 full roster resolves');

var sat = Engine.resolveDay('2026-07-18', DATA);
eq(sat.isWeekend, true, 'also: 7/18 Saturday isWeekend');
eq(sat.residents.length, 0, 'also: weekend roster empty');

var pre = Engine.resolveDay('2026-07-01', DATA);
eq(pre.inYear, false, 'also: 7/1/26 inYear false');
eq(pre.residents.length, 0, 'also: out-of-year roster empty');

/* ================================================================== */
/* (2) Assign.suggest on a realistic 7/22 case list (real roster)      */
/* ================================================================== */

var CASES = [
  { id: 'c1', section: 'wills', surgeon: 'Huang', count: 7, serviceCount: 2, start: '0730', category: 'cataract', addOn: false, notes: '', assigned: '', backup: '' },
  { id: 'c2', section: 'wills', surgeon: 'Ayres', count: 1, serviceCount: 1, start: '1400', category: 'cornea', addOn: true, notes: '', assigned: '', backup: '' },
  { id: 'c3', section: 'wills', surgeon: 'Lee', count: 1, serviceCount: 1, start: '1500', category: 'glaucoma', addOn: true, notes: '', assigned: '', backup: '' },
  { id: 'c4', section: 'wills', surgeon: 'Levin', count: 1, serviceCount: 1, start: '0800', category: 'peds', addOn: false, notes: 'strabismus', assigned: '', backup: '' },
  { id: 'c5', section: 'wills', surgeon: 'ER', count: 1, serviceCount: 1, start: '1600', category: 'trauma', addOn: true, notes: 'open globe', assigned: '', backup: '' },
  { id: 'c6', section: 'private', surgeon: 'Garg', count: 5, serviceCount: 0, start: '0800', category: 'cataract', addOn: false, notes: '', assigned: '', backup: '' }
];

var res = Assign.suggest(CASES, roster, DATA);
eq(res.length, 6, 'suggest: one result per case');

// Process order: peds & scheduled first (original order), then add-ons.
sameMembers(res.slice(0, 3).map(function (r) { return r.caseId; }), ['c1', 'c4', 'c6'],
  'suggest: peds/scheduled/private group processed first');
sameMembers(res.slice(3).map(function (r) { return r.caseId; }), ['c2', 'c3', 'c5'],
  'suggest: add-ons processed after scheduled group');

// c1: Huang cataracts x7 0730 → Surg 1 (Cheng), Surg 5 (Wibbelsman) next in chain
var c1 = findByCase(res, 'c1');
eq(c1 && c1.name, 'Cheng', 'Huang cataracts → Surg 1 (Cheng)');
ok(c1 && /→ Surg 1/.test(c1.reasons.join(' ')), 'Huang: reason cites Surg 1');
includes(c1 && c1.alternates, 'Wibbelsman', 'Huang: Surg 5 (Wibbelsman) is the chain alternate');
ok(hasWarning(c1, /spans AM and PM/), 'Huang: x7 at 0730 flagged as spanning the day');

// c2: add-on cornea 1400 → Aguwa with PM clinic conflict (Aguwa PM = Cornea)
var c2 = findByCase(res, 'c2');
eq(c2 && c2.name, 'Aguwa', 'add-on cornea 1400 → Aguwa (Surg 3)');
ok(c2 && /→ Surg 3/.test(c2.reasons.join(' ')), 'add-on cornea: reason cites Surg 3');
ok(hasWarning(c2, /Aguwa is in Cornea clinic PM/), 'add-on cornea: warns Aguwa is in Cornea clinic PM');

// c3: add-on glaucoma → Bair (Surg 4); Bair PM = Glaucoma clinic ⇒ PM warning per SPEC
var c3 = findByCase(res, 'c3');
eq(c3 && c3.name, 'Bair', 'add-on glaucoma → Bair (Surg 4)');
ok(c3 && /→ Surg 4/.test(c3.reasons.join(' ')), 'add-on glaucoma: reason cites Surg 4');
ok(hasWarning(c3, /Bair is in Glaucoma clinic PM/), 'add-on glaucoma PM: warns Bair is in Glaucoma clinic PM');

// c4: peds strabismus. On Wed 7/22 the pgy2 block-3 resident (Momenaei) IS on
// Peds OR AM (SPEC fixture requires it), so PEDS_OR_JUNIOR resolves and the
// SPEC chain gives Momenaei primary with Surg 4 (Bair) then Surg 3 (Aguwa)
// as alternates. (The task brief's "(no Peds OR junior on Wed) → Surg 4"
// premise is wrong for this date — reported as a finding, not asserted.)
var c4 = findByCase(res, 'c4');
eq(c4 && c4.name, 'Momenaei', 'peds strabismus → Momenaei (junior on Peds OR per SPEC chain)');
ok(c4 && /junior on Peds OR/.test(c4.reasons.join(' ')), 'peds: reason cites the Peds OR junior');
includes(c4 && c4.alternates, 'Bair', 'peds: Surg 4 (Bair) remains in the chain as alternate');
includes(c4 && c4.alternates, 'Aguwa', 'peds: Surg 3 (Aguwa) remains in the chain as alternate');
ok(c4 && (c4.alternates || []).indexOf('Bair') < (c4.alternates || []).indexOf('Aguwa'),
  'peds: Surg 4 ahead of Surg 3 in the alternates');
ok(c4 && (c4.alternates || []).some(function (a) { return /free junior/.test(a); }),
  'peds: free-junior discretion alternate surfaced');

// c5: trauma add-on → Calotti (Surg 2), full trauma chain as alternates
var c5 = findByCase(res, 'c5');
eq(c5 && c5.name, 'Calotti', 'trauma add-on → Calotti (Surg 2)');
ok(c5 && /→ Surg 2/.test(c5.reasons.join(' ')), 'trauma: reason cites Surg 2');
ok(c5 && JSON.stringify(c5.alternates) === JSON.stringify(['Aguwa', 'Bair', 'Illiano', 'Cheng', 'Wibbelsman']),
  'trauma: alternates = Surg 3, Surg 4, Cooper, Surg 1, Surg 5 — got ' + JSON.stringify(c5 && c5.alternates));

// c6: private Garg x5, serviceCount 0 → no suggestion
var c6 = findByCase(res, 'c6');
eq(c6 && c6.name, '', 'private Garg x5 (serviceCount 0): no resident suggested');
eq(c6 && c6.reasons[0], 'private — no resident needed', 'private Garg: reason explains why');
eq(c6 && c6.warnings.length, 0, 'private Garg: no warnings');

// Suggestions never auto-write `assigned`
ok(CASES.every(function (c) { return c.assigned === ''; }),
  'suggest never mutates case.assigned');

/* ================================================================== */
/* (3) ExportFmt.buildText / buildHTML on the combined state           */
/* ================================================================== */

// Accept the suggestions into a copy of the case list (as the UI would),
// plus one unassigned JHN service case to exercise the UNASSIGNED marker.
var exportCases = JSON.parse(JSON.stringify(CASES));
res.forEach(function (r) {
  if (!r.name) return;
  var c = exportCases.filter(function (x) { return x.id === r.caseId; })[0];
  if (c) c.assigned = r.name;
});
exportCases.push({ id: 'c7', section: 'jhn', surgeon: 'Zhang', count: 1, serviceCount: 1, start: '1000', category: 'other', addOn: false, notes: '', assigned: '', backup: '' });

var day = {
  date: '2026-07-22',
  lectures: 'Grand Rounds 7am',
  nightFloat: 'Perez',
  vacation: '24 strong',
  cooperBuddyAM: { name: 'Camacho', note: '' },
  cooperBuddyPM: { name: 'DeSimone', note: '' },
  addOns: [{ label: 'Tuesday night (7/21/26)', name: 'Djulbegovic' }],
  cases: exportCases,
  clinicCounts: { 'Cornea|pm': { count: '29x3', extra: '' } },
  clinicStaffOverrides: {},
  roster: roster
};

var text = ExportFmt.buildText(day);
var html = ExportFmt.buildHTML(day);
var textStripped = text.replace(/\*\*/g, '');

// Surg line rendering. Text flavor bolds with ** (matches the SPEC sample
// 'Surg 1 - **Cheng**'); the literal 'Surg 1 - Cheng' appears bold-stripped.
contains(text, 'Surg 1 - **Cheng**', 'text: Surg 1 line bolded per SPEC sample');
contains(textStripped, 'Surg 1 - Cheng', 'text (bold-stripped): contains "Surg 1 - Cheng"');
contains(html, '<b>Cheng</b>', 'html: contains <b>Cheng</b>');

// AM-only rendering for Surg 3/4
contains(text, 'Surg 3 - **Aguwa AM** | none PM', 'text: Surg 3 AM-only rendering');
contains(text, 'Surg 4 - **Bair AM** | none PM', 'text: Surg 4 AM-only rendering');
contains(textStripped, 'Aguwa AM', 'text (stripped): contains "Aguwa AM"');
contains(html, '<b>Aguwa AM</b> | none PM', 'html: Surg 3 AM-only rendering');
contains(html, '<b>Bair AM</b> | none PM', 'html: Surg 4 AM-only rendering');

// Section headers in SPEC order
var headers = ['Lectures/Events', 'Assignments', 'WER: ', 'Wills/ASC', 'Privates',
  'JHN/TJUH/JSC', 'Clinics', 'Vacation', 'Add-ons'];
var lastIdx = -1;
var orderOK = true;
for (var h = 0; h < headers.length; h++) {
  var idx = text.indexOf(headers[h]);
  if (idx === -1 || idx <= lastIdx) { orderOK = false; break; }
  lastIdx = idx;
}
ok(orderOK, 'text: section headers present in SPEC order (' + headers.join(' < ') + ')' +
  (orderOK ? '' : ' — broke at ' + JSON.stringify(headers[h])));
var htmlOrderOK = true;
var lastH = -1;
for (var h2 = 0; h2 < headers.length; h2++) {
  var hIdx = html.indexOf(headers[h2] === 'WER: ' ? 'WER: ' : '<div>' + headers[h2] + '</div>');
  if (hIdx === -1 || hIdx <= lastH) { htmlOrderOK = false; break; }
  lastH = hIdx;
}
ok(htmlOrderOK, 'html: section headers present in SPEC order' +
  (htmlOrderOK ? '' : ' — broke at ' + JSON.stringify(headers[h2])));

// WER collapse + consult lines
contains(text, 'WER: **', 'text: WER line bolded');
ok(/WER: \*\*[^\n]*Nahar AM\/PM/.test(text), 'text: WER collapses Nahar to AM/PM');
ok(/WER: \*\*[^\n]*Hamou AM\/PM/.test(text), 'text: WER collapses Hamou to AM/PM');
ok(/WER: \*\*[^\n]*Patel PM/.test(text), 'text: WER shows Patel PM only');
contains(text, 'Night Float: **Perez**', 'text: Night Float line');
contains(text, 'Jeff Consults: **Cotton**', 'text: Jeff Consults line');
contains(text, 'Cooper Consults: **Illiano + buddy [Camacho AM | DeSimone PM]**',
  'text: Cooper Consults + buddy formatting');

// Case lines
contains(text, '-Huang x7 (0730 start), x2 service - **Cheng**', 'text: Huang case line');
contains(text, '-Garg x5 (0800 start)', 'text: private Garg case line');
ok(text.indexOf('-Garg x5 (0800 start) - ') === -1 &&
   !/Garg[^\n]*UNASSIGNED/.test(text), 'text: private (serviceCount 0) never marked UNASSIGNED');
ok(/-Zhang x1 \(1000 start\)[^\n]*UNASSIGNED/.test(text), 'text: unassigned JHN service case shows UNASSIGNED');

// Clinic lines
contains(text, 'Cornea PM (29x3): **Momenaei, Williamson, Aguwa**',
  'text: Cornea PM clinic line with manual count');
contains(html, 'Cornea PM (29x3): <b>Momenaei, Williamson, Aguwa</b>',
  'html: Cornea PM clinic line');

// Add-ons
contains(text, 'Tuesday night (7/21/26): **Djulbegovic**', 'text: add-on line');
contains(html, 'Tuesday night (7/21/26): <b>Djulbegovic</b>', 'html: add-on line');

// Empty JHN section renders '-none'
var day2 = JSON.parse(JSON.stringify(day));
day2.roster = roster; // keep live roster reference shape
day2.cases = exportCases.filter(function (c) { return c.section !== 'jhn'; });
var text2 = ExportFmt.buildText(day2);
ok(/JHN\/TJUH\/JSC\n-none/.test(text2), 'text: empty JHN/TJUH/JSC section renders -none');

/* ================================================================== */
/* (4) Backups — Assign.backupPlan + the '**Assigned; Backup** note' render  */

// Huang x7 0730 assigned to Bair (Surg 4; Glaucoma clinic PM on Wednesdays):
// the case spans the day, so the clinic needs coverage — first free name in
// the coverage chain is Calotti (Surg 2).
var huang = {
  id: 'b1', section: 'wills', surgeon: 'Huang', count: 7, serviceCount: 2,
  start: '0730', category: 'cataract', addOn: false, notes: '',
  assigned: 'Bair', backup: '', backupNote: ''
};
var plan = Assign.backupPlan(huang, roster, DATA, [huang]);
ok(!!plan, 'backupPlan: returns a plan for Bair (PM Glaucoma clinic) on a day-spanning case');
ok(plan && plan.clinic === 'Glaucoma', 'backupPlan: clinic is Glaucoma');
ok(plan && plan.primary && plan.primary.name === 'Calotti', 'backupPlan: primary is Calotti (first free in chain)');
ok(plan && plan.primary && plan.primary.source === 'Surg 2', 'backupPlan: primary source is Surg 2');
ok(plan && plan.second && !!plan.second.name, 'backupPlan: offers a 2nd backup');

// Short AM-only case for the same resident -> no coverage needed.
var shortAm = Object.assign({}, huang, { count: 2, start: '0800' });
ok(Assign.backupPlan(shortAm, roster, DATA, [shortAm]) === null,
  'backupPlan: null for a short AM-only case');

// A resident with no PM clinic (Cheng, Surg 1 all day) -> null.
var chengCase = Object.assign({}, huang, { assigned: 'Cheng' });
ok(Assign.backupPlan(chengCase, roster, DATA, [chengCase]) === null,
  'backupPlan: null when the assignee has no PM clinic');

// Render: '- **Bair; Calotti** to cover glaucoma clinic …' (example format)
var day3 = JSON.parse(JSON.stringify(day));
day3.roster = roster;
day3.cases = [Object.assign({}, huang, {
  backup: 'Calotti',
  backupNote: 'to cover glaucoma clinic during case if after 1 PM, 2nd backup Samuel (Retina)'
})];
var text3 = ExportFmt.buildText(day3);
contains(text3,
  '-Huang x7 (0730 start), x2 service - **Bair; Calotti** to cover glaucoma clinic during case if after 1 PM, 2nd backup Samuel (Retina)',
  'text: assigned+backup line matches the example document format');
var html3 = ExportFmt.buildHTML(day3);
contains(html3, '<b>Bair; Calotti</b> to cover glaucoma clinic',
  'html: assigned+backup bolded together, note plain');

/* ================================================================== */
/* (5) PowerPoint how-to refinements                                         */

function firstSuggestion(caseObj) {
  var res = Assign.suggest([caseObj], roster, DATA);
  return res && res[0];
}

// Overflow / add-on cataract -> Surg 2 (Calotti) first.
var ovfl = { id: 'p1', section: 'wills', surgeon: 'X', count: 1, serviceCount: 1,
  start: '1400', category: 'cataract', addOn: true, notes: '', assigned: '', backup: '', backupNote: '' };
var s1 = firstSuggestion(ovfl);
ok(s1 && s1.name === 'Calotti', 'pptx: overflow/add-on cataract goes to Surg 2 (Calotti) first');

// Add-on at JHN/Gibbon/JSC -> Surg 2 first regardless of category.
var jhnAdd = Object.assign({}, ovfl, { id: 'p2', section: 'jhn', category: 'plastics' });
ok(Assign.classify(jhnAdd) === 'jhnAddOn', 'pptx: JHN add-on classifies as jhnAddOn');
var s2 = firstSuggestion(jhnAdd);
ok(s2 && s2.name === 'Calotti', 'pptx: JHN/Gibbon/JSC add-on goes to Surg 2 (Calotti) first');

// Plastics add-on AT WILLS -> junior on Plastics OR first (Camacho, 4th-Wed
// Plastics OR); real trauma skips the junior and starts at Surg 2.
var plAdd = Object.assign({}, ovfl, { id: 'p3', section: 'wills', category: 'plastics' });
var s3 = firstSuggestion(plAdd);
ok(s3 && s3.name === 'Camacho', 'pptx: plastics add-on (TAB/outpatient) goes to the junior on Plastics OR');
var trAdd = Object.assign({}, ovfl, { id: 'p4', section: 'wills', category: 'trauma' });
var s4 = firstSuggestion(trAdd);
ok(s4 && s4.name === 'Calotti', 'pptx: trauma add-on skips the Plastics OR junior and goes to Surg 2');

// Add-on cornea/glaucoma now fall back to Surg 2 in the chain.
var agAdd = Object.assign({}, ovfl, { id: 'p5', category: 'glaucoma' });
var s5 = firstSuggestion(agAdd);
ok(s5 && s5.name === 'Bair' && s5.alternates.indexOf('Calotti') !== -1,
  'pptx: add-on glaucoma -> Surg 4 with Surg 2 as fallback alternate');

// Scheduled plastics chain now ends at Surg 2.
ok((DATA.hierarchy.scheduledPlastics.chain || []).slice(-1)[0] === 'Surg 2',
  'pptx: scheduled plastics chain ends at Surg 2');
// Scheduled cataracts include Wills OR.
ok((DATA.hierarchy.scheduledCataract.chain || []).indexOf('WILLS_OR') !== -1,
  'pptx: scheduled cataract chain includes Wills OR');

/* ================================================================== */
/* (6) Cooper buddy call — UISPEC2 §A engine contract + §F export line */

// 2026-07-22 (Wed, range 1): named buddies + weekday template.
var bud0722 = Engine.resolveDay('2026-07-22', DATA).cooperBuddies;
ok(bud0722 && typeof bud0722 === 'object', 'buddy: 7/22 roster has cooperBuddies');
eq(bud0722 && bud0722.am, 'Camacho', 'buddy: 7/22 am = Camacho');
eq(bud0722 && bud0722.pm, 'DeSimone', 'buddy: 7/22 pm = DeSimone');
eq(bud0722 && bud0722.templateAM, 'Private Glaucoma', 'buddy: 7/22 templateAM = Private Glaucoma');
eq(bud0722 && bud0722.templatePM, 'Retina', 'buddy: 7/22 templatePM = Retina');

// 2026-08-13 (Thu, range 2): the Thu PM buddy flips to Aguwa.
var bud0813 = Engine.resolveDay('2026-08-13', DATA).cooperBuddies;
eq(bud0813 && bud0813.pm, 'Aguwa', 'buddy: 8/13 (Thu, range 2) pm = Aguwa');

// 2026-09-02 (Wed, after both ranges): no named buddy.
var bud0902 = Engine.resolveDay('2026-09-02', DATA).cooperBuddies;
eq(bud0902 && bud0902.am, null, 'buddy: 9/2 (no range) am = null');

// Export: buddy names + notes render inside the Cooper Consults line
// exactly as the real 7/22 document.
var dayBuddy = {
  date: '2026-07-22',
  cooperBuddyAM: { name: 'Camacho', note: 'private glaucoma' },
  cooperBuddyPM: { name: 'DeSimone', note: 'retina' },
  cases: [],
  addOns: [],
  clinicCounts: {},
  clinicStaffOverrides: {},
  roster: roster
};
contains(ExportFmt.buildText(dayBuddy),
  'Cooper Consults: **Illiano + buddy [Camacho AM (private glaucoma) | DeSimone PM (retina)]**',
  'buddy: buildText Cooper Consults line with noted buddies matches the 7/22 document');

/* ================================================================== */
console.log(checks + ' checks, ' + failures + ' failure(s)');
if (failures > 0) process.exit(1);
console.log('OK');
