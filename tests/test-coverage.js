#!/usr/bin/env node
/*
 * test-coverage.js — availability-aware assignment (js/assign.js with a
 * js/status.js board). Plain Node, no dependencies.
 * Run: node tests/test-coverage.js   (exits non-zero on any failure)
 *
 * Fixture day: Mon 9/28/2026 — Surg 1 Cheng, Surg 2 Djulbegovic, Surg 3
 * Bair (Cornea clinic PM), Surg 4 Calotti, Surg 5 Wibbelsman; Cooper
 * consults Alvarez; Perez on Night Float (and Day Float).
 */
'use strict';

var path = require('path');
var Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
var Status = require(path.join(__dirname, '..', 'js', 'status.js'));
var Assign = require(path.join(__dirname, '..', 'js', 'assign.js'));
var DATA = require(path.join(__dirname, '..', 'js', 'data.js'));

var failures = 0;
var checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.error('FAIL: ' + msg); } }
function eq(a, e, msg) { ok(a === e, msg + ' — expected ' + JSON.stringify(e) + ', got ' + JSON.stringify(a)); }

var roster = Engine.resolveDay('2026-09-28', DATA);
function board(extra) {
  var d = { nightFloat: 'Perez', absences: [], cases: [], clinicStaffOverrides: {} };
  for (var k in extra) d[k] = extra[k];
  return { day: d, b: Status.build(roster, d, DATA) };
}
function hark(backup) {
  return { id: 'c1', section: 'wills', surgeon: 'Hark', count: 1, serviceCount: 1, start: '1300', category: 'cornea', addOn: false, assigned: 'Bair', backup: backup || '' };
}

/* ---------- a globe at 1:30 while Surg 3 is in a cornea case ---------- */
var x = board({ cases: [hark('Djulbegovic')] });
var plan = Assign.planAddOn('globe', 810, roster, DATA, x.b);
eq(plan.pick && plan.pick.name, 'Djulbegovic', 'Surg 2 takes the globe (chief’s rule) even while covering clinic');
eq(plan.pickStatus && plan.pickStatus.kind, 'clinic', 'Surg 2 was in clinic (covering)');
ok(!!plan.handoff, 'the clinic Surg 2 leaves is handed off');
eq(plan.handoff && plan.handoff.clinic, 'Cornea', 'handoff is Cornea clinic');
eq(plan.handoff && plan.handoff.owner, 'Bair', "…Bair's clinic");
eq(plan.handoff && plan.handoff.primary && plan.handoff.primary.name, 'Calotti', 'next free on the clinic chain: Surg 4 Calotti (Surg 3 is in a case)');
var skipBair = plan.handoff && plan.handoff.steps.filter(function (s) { return s.name === 'Bair'; })[0];
eq(skipBair && skipBair.verdict, 'skip', 'Bair skipped for clinic cover (in a case)');

/* ---------- same, but Surg 2 is scrubbed in a case ---------- */
x = board({ cases: [hark('Djulbegovic'),
  { id: 'c2', section: 'wills', surgeon: 'Tyson', count: 3, serviceCount: 3, start: '1300', category: 'cataract', addOn: false, assigned: 'Djulbegovic', backup: '' }] });
plan = Assign.planAddOn('globe', 810, roster, DATA, x.b);
eq(plan.pick && plan.pick.name, 'Calotti', 'Surg 2 and Surg 3 in cases → Surg 4 takes the globe');
eq(plan.handoff, null, 'Surg 4 was free — nothing to hand off');
var s2 = plan.steps.filter(function (s) { return s.name === 'Djulbegovic'; })[0];
eq(s2 && s2.verdict, 'skip', 'Surg 2 skipped');
ok(s2 && /in Tyson x3 until 2:30 PM/.test(s2.why), 'skip reason names the case and the estimated end — got ' + (s2 && s2.why));

/* ---------- cornea add-on (needs tissue) while Surg 3 is scrubbed ---------- */
x = board({ cases: [hark('Djulbegovic')] });
plan = Assign.planAddOn('cornea', 810, roster, DATA, x.b);
eq(plan.pick && plan.pick.name, 'Djulbegovic', 'add-on cornea: Surg 3 busy → Surg 2');

/* ---------- Surg 2 out: the globe goes to Surg 3 from clinic ---------- */
x = board({ absences: [{ id: 'a1', name: 'Djulbegovic', am: true, pm: true, reason: 'vacation', coverAM: 'NC', coverPM: 'NC' }] });
plan = Assign.planAddOn('globe', 870, roster, DATA, x.b);
eq(plan.pick && plan.pick.name, 'Bair', 'Surg 2 out → Surg 3 takes the globe from Cornea clinic');
eq(plan.handoff && plan.handoff.primary && plan.handoff.primary.name, 'Calotti', 'Cornea passes to Surg 4');

/* ---------- suggest(): skip for now, then the remaining chain ---------- */
x = board({ absences: [{ id: 'a1', name: 'Bair', am: true, pm: true, reason: 'vacation', coverAM: 'NC', coverPM: 'NC' }] });
var cases = [{ id: 'k1', section: 'wills', surgeon: 'Hark', count: 1, serviceCount: 1, start: '1300', category: 'cornea', addOn: false, assigned: '' }];
var res = Assign.suggest(cases, roster, DATA, x.b);
eq(res[0].name, 'Djulbegovic', 'scheduled cornea with Surg 3 out → remaining chain → Surg 2');
ok(/remaining-cases chain/.test(res[0].reasons[0]), 'reason says it came from the remaining chain');
eq(res[0].skipped[0] && res[0].skipped[0].name, 'Bair', 'Bair listed as skipped');

// two cataract lists at 7:30: Surg 1 takes the first, Surg 5 the second
x = board({});
cases = [
  { id: 'w1', section: 'wills', surgeon: 'Wisner', count: 4, serviceCount: 4, start: '0730', category: 'cataract', addOn: false, assigned: '' },
  { id: 'w2', section: 'wills', surgeon: 'Markovitz', count: 7, serviceCount: 7, start: '0730', category: 'cataract', addOn: false, assigned: '' }
];
res = Assign.suggest(cases, roster, DATA, x.b);
eq(res[0].name, 'Cheng', 'first 7:30 list → Surg 1');
eq(res[1].name, 'Wibbelsman', 'second 7:30 list → Surg 1 busy → Surg 5');
ok(/suggested for another case/.test(res[1].skipped[0] && res[1].skipped[0].why), 'skip reason: already suggested at that time');

// Surg 1 out: scheduled cataracts go to Surg 5
x = board({ absences: [{ id: 'a1', name: 'Cheng', am: true, pm: true, reason: 'sick', coverAM: 'NC', coverPM: 'NC' }] });
res = Assign.suggest([cases[0]], roster, DATA, x.b);
eq(res[0].name, 'Wibbelsman', 'Surg 1 out → Surg 5');

// scheduled plastics with nobody on Plastics OR → an actual free junior
x = board({});
res = Assign.suggest([{ id: 'p1', section: 'wills', surgeon: 'Bilyk', count: 1, serviceCount: 1, start: '0900', category: 'plastics', addOn: false, assigned: '' }], roster, DATA, x.b);
eq(res[0].name, 'Ransone', 'free junior resolves to a real free PGY-2 (Ransone, in CPEC)');
ok(res[0].warnings.some(function (w) { return /confirm with Surg 2/.test(w); }), 'free junior suggestion asks to confirm with Surg 2');

// plastics add-on (TAB): Plastics OR junior → free junior before Surg 2
res = Assign.suggest([{ id: 'p2', section: 'wills', surgeon: 'Bilyk', count: 1, serviceCount: 1, start: '1400', category: 'plastics', addOn: true, assigned: '' }], roster, DATA, x.b);
eq(Assign.classify({ category: 'plastics', addOn: true }, DATA), 'plasticsAddOn', 'plastics add-on uses the juniors-first chain');
ok(res[0].name && res[0].name !== 'Djulbegovic', 'plastics add-on goes to a free junior before Surg 2 — got ' + res[0].name);
// chief 9/2026: the plastics junior in Plastics clinic stays in clinic
ok(res[0].name !== 'Ransone', 'Ransone (in Plastics clinic PM) is not pulled for the add-on');
// …and with every junior busy it falls to the seniors (Surg 2 first)
var allJuniorsBusy = { absences: roster.residents.filter(function (r) { return r.year !== 'pgy4'; }).map(function (r, i) {
  return { id: 'j' + i, name: r.name, am: true, pm: true, reason: 'other', coverAM: 'NC', coverPM: 'NC' };
}) };
x = board(allJuniorsBusy);
res = Assign.suggest([{ id: 'p3', section: 'wills', surgeon: 'Bilyk', count: 1, serviceCount: 1, start: '1400', category: 'plastics', addOn: true, assigned: '' }], roster, DATA, x.b);
eq(res[0].name, 'Djulbegovic', 'no free junior → senior coverage, Surg 2 first');

// a pulled-from-clinic pick carries a backup warning
x = board({});
res = Assign.suggest([{ id: 'k2', section: 'wills', surgeon: 'Hark', count: 1, serviceCount: 1, start: '1300', category: 'cornea', addOn: false, assigned: '' }], roster, DATA, x.b);
eq(res[0].name, 'Bair', 'scheduled cornea → Surg 3');
ok(res[0].warnings.some(function (w) { return /leaves Cornea — needs a backup/.test(w); }), 'warns Bair leaves Cornea clinic');

/* ---------- backupPlan with the board ---------- */
x = board({ cases: [hark('')] });
var bp = Assign.backupPlan(x.day.cases[0], roster, DATA, x.day.cases, x.b);
eq(bp && bp.clinic, 'Cornea', 'backup plan: Cornea clinic');
eq(bp && bp.primary && bp.primary.name, 'Djulbegovic', 'Surg 2 covers Cornea while Surg 3 operates');
eq(bp && bp.window && bp.window.start, 780, 'coverage needed from 1:00…');
eq(bp && bp.window && bp.window.end, 870, '…to 2:30 (est.)');
// an AM case never threatens the PM clinic
x = board({ cases: [{ id: 'c9', section: 'wills', surgeon: 'Hark', count: 1, serviceCount: 1, start: '0800', category: 'cornea', addOn: false, assigned: 'Bair', backup: '' }] });
eq(Assign.backupPlan(x.day.cases[0], roster, DATA, x.day.cases, x.b), null, 'AM cornea case: no clinic to cover');

/* ---------- legacy path unchanged without a board ---------- */
res = Assign.suggest([{ id: 'k3', section: 'wills', surgeon: 'Hark', count: 1, serviceCount: 1, start: '1300', category: 'cornea', addOn: false, assigned: '' }], roster, DATA);
eq(res[0].name, 'Bair', 'no board: chain order only');
eq(res[0].skipped, undefined, 'no board: no availability fields');

/* ---------- "Cooper" = PGY-4 on the Cooper block; off-site is skipped ---------- */
// Mon 9/28: Samuel (Cooper block) is on Wills OR with no case → a chain member
x = board({ cases: [
  { id: 'b1', section: 'wills', surgeon: 'Hark', count: 1, serviceCount: 1, start: '1300', category: 'cornea', assigned: 'Bair', backup: '' },
  { id: 'b2', section: 'wills', surgeon: 'Tyson', count: 3, serviceCount: 3, start: '1300', category: 'cataract', assigned: 'Djulbegovic', backup: '' },
  { id: 'b3', section: 'wills', surgeon: 'Moster', count: 2, serviceCount: 2, start: '1300', category: 'glaucoma', assigned: 'Calotti', backup: '' }
] });
plan = Assign.planAddOn('globe', 810, roster, DATA, x.b);
eq(plan.pick && plan.pick.name, 'Samuel', 'Surg 2/3/4 in cases → the Cooper-block senior (Samuel) takes the globe');
eq(plan.pick && plan.pick.via, 'Cooper (PGY-4)', '…via the Cooper (PGY-4) chain step');
// Thu 10/1: Samuel is at Cooper Clinic — off-site, skipped
var r101 = Engine.resolveDay('2026-10-01', DATA);
var b101 = Status.build(r101, { nightFloat: 'Perez', absences: [], clinicStaffOverrides: {}, cases: [
  { id: 'b1', section: 'wills', surgeon: 'A', count: 1, serviceCount: 1, start: '1300', category: 'cornea', assigned: r101.surg['2'].name, backup: '' },
  { id: 'b2', section: 'wills', surgeon: 'B', count: 1, serviceCount: 1, start: '1300', category: 'cornea', assigned: r101.surg['3'].name, backup: '' },
  { id: 'b3', section: 'wills', surgeon: 'C', count: 1, serviceCount: 1, start: '1300', category: 'glaucoma', assigned: r101.surg['4'].name, backup: '' }
] }, DATA);
eq(b101.statusAt('Samuel', 810).cls, 'offsite', 'Thu: Samuel at Cooper Clinic is off-site');
ok(b101.freeAt(810).indexOf('Samuel') === -1, 'off-site is never listed as free');
plan = Assign.planAddOn('globe', 810, r101, DATA, b101);
var sam = plan.steps.filter(function (s) { return s.name === 'Samuel'; })[0];
eq(sam && sam.verdict, 'skip', 'Thu: the Cooper senior is skipped for a Wills globe');
ok(sam && /off-site/.test(sam.why || ''), 'skip reason says off-site — got ' + (sam && sam.why));
ok(plan.pick && plan.pick.name !== 'Samuel', 'the globe goes past Cooper to the next in chain');

console.log(checks + ' checks, ' + failures + ' failure(s)');
if (failures) process.exitCode = 1; else console.log('OK');
