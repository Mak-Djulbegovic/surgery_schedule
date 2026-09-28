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
ok(/suggested for Wisner at this time/.test(res[1].skipped[0] && res[1].skipped[0].why), 'skip reason names the case Surg 1 is already suggested for');

// Surg 1 out: scheduled cataracts go to Surg 5
x = board({ absences: [{ id: 'a1', name: 'Cheng', am: true, pm: true, reason: 'sick', coverAM: 'NC', coverPM: 'NC' }] });
res = Assign.suggest([cases[0]], roster, DATA, x.b);
eq(res[0].name, 'Wibbelsman', 'Surg 1 out → Surg 5');

// scheduled plastics with nobody on Plastics OR → an actual free junior
x = board({});
res = Assign.suggest([{ id: 'p1', section: 'wills', surgeon: 'Bilyk', count: 1, serviceCount: 1, start: '0900', category: 'plastics', addOn: false, assigned: '' }], roster, DATA, x.b);
eq(res[0].name, 'Nahar', 'free junior resolves to a really free junior (Nahar: Glaucoma/Plastics OR block, nothing booked — CPEC is clinic, 9/28)');
ok(res[0].warnings.some(function (w) { return /confirm with Surg 2/.test(w); }), 'free junior suggestion asks to confirm with Surg 2');

// plastics add-on (TAB): how-to Step 9 — the junior on Plastics OR (TABs /
// outpatient plastics only), then Surg 2; no free-junior step for add-ons
res = Assign.suggest([{ id: 'p2', section: 'wills', surgeon: 'Bilyk', count: 1, serviceCount: 1, start: '1400', category: 'plastics', addOn: true, assigned: '' }], roster, DATA, x.b);
eq(Assign.classify({ category: 'plastics', addOn: true }, DATA), 'traumaPlasticsAddOn', 'plastics add-on uses the Step 9 chain');
eq(res[0].name, 'Djulbegovic', 'plastics add-on at 2 PM: nobody on Plastics OR Monday → Surg 2');
res = Assign.suggest([{ id: 'p3', section: 'wills', surgeon: 'Bilyk', count: 1, serviceCount: 1, start: '0900', category: 'plastics', addOn: true, assigned: '' }], roster, DATA, x.b);
eq(res[0].name, 'Djulbegovic', 'plastics add-on at 9 AM: Surg 2 — a free junior (Nahar) is not in the Step 9 chain');
// chief 9/2026: the plastics junior in Plastics clinic stays in clinic
ok(res[0].name !== 'Ransone', 'Ransone (in Plastics clinic PM) is not pulled for the add-on');
// Tue 9/29: Ransone (PGY-2) is on Plastics OR AM, in Plastics clinic PM
var r929 = Engine.resolveDay('2026-09-29', DATA);
var b929 = Status.build(r929, { nightFloat: 'Perez', absences: [], cases: [], clinicStaffOverrides: {} }, DATA);
plan = Assign.planAddOn('plastics', 600, r929, DATA, b929);
eq(plan.pick && plan.pick.name + ' / ' + plan.pick.via, 'Ransone / junior on Plastics OR (TABs / outpatient plastics only)', 'Tue 10 AM TAB → Ransone, on Plastics OR');
plan = Assign.planAddOn('plastics', 840, r929, DATA, b929);
eq(plan.pick && plan.pick.name, 'Djulbegovic', 'Tue 2 PM TAB → Surg 2: Ransone is in Plastics clinic and stays there');
var rs = plan.steps.filter(function (s) { return s.name === 'Ransone'; })[0];
ok(rs && rs.verdict === 'skip' && /stays in clinic/.test(rs.why), 'skip reason says she stays in clinic — got ' + (rs && rs.why));
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

/* ---------- several at once: a globe while an emergent glaucoma AND cornea come in ---------- */
function names(res) { return res.items.map(function (it) { return it.label.split(' ')[0] + ':' + (it.pick ? it.pick.name : '-'); }).join(' '); }
var jx = board({});
var j = Assign.planAddOns(['globe', 'glaucoma', 'cornea'], 600, roster, DATA, jx.b);
eq(names(j), 'Globe:Djulbegovic Glaucoma:Calotti Cornea:Bair', '10 AM: each to its own Surg role (2 globe, 4 glaucoma, 3 cornea)');
eq(j.unfilled, 0, 'nobody left without a resident');
j = Assign.planAddOns(['globe', 'glaucoma', 'cornea'], 810, roster, DATA, jx.b);
var corn = j.items[2];
eq(corn.pick && corn.pick.name, 'Bair', '1:30 PM: Bair (Surg 3) takes the cornea case from Cornea clinic');
eq(corn.handoff && corn.handoff.primary && corn.handoff.primary.name, 'Samuel',
  '…and Cornea clinic goes to the Cooper senior — Surg 2 (globe) and Surg 4 (glaucoma) are taken');
jx = board({ cases: [hark('')] });
j = Assign.planAddOns(['cornea', 'glaucoma', 'globe'], 810, roster, DATA, jx.b);
eq(names(j), 'Cornea:Samuel Glaucoma:Calotti Globe:Djulbegovic', 'Surg 3 in Hark: the cornea add-on is skipped at Step 6; the globe takes Surg 2 at Step 9; at Step 10 Surg 2 and 4 are taken → the Cooper senior');
eq(j.items[0].displacedBy, 'Globe / trauma', '…and says why: Surg 2 is taking the globe');
var picked = j.items.map(function (it) { return it.pick && it.pick.name; });
ok(picked.filter(function (n, i) { return n && picked.indexOf(n) === i; }).length === picked.length, 'nobody takes two cases at once');
var coverers = j.items.map(function (it) { return it.handoff && it.handoff.primary && it.handoff.primary.name; }).filter(Boolean);
ok(coverers.every(function (n) { return picked.indexOf(n) === -1; }), 'clinic cover never uses someone taking a case');
var single = Assign.planAddOn('globe', 810, roster, DATA, jx.b);
eq(Assign.planAddOns(['globe'], 810, roster, DATA, jx.b).items[0].pick.name, single.pick.name, 'one kind = the single-case plan');

/* ---------- the how-to's step order decides who gets whom ---------- */
// Step 6 before Step 7: with every junior out, an add-on glaucoma and a
// scheduled plastics case at 10 AM — Surg 4 takes the glaucoma (Step 6), the
// plastics case finds Surg 4 taken and waits for Step 10 (Surg 2).
var juniorsOut = { absences: roster.residents.filter(function (r) { return r.year !== 'pgy4'; }).map(function (r, i) {
  return { id: 'j' + i, name: r.name, am: true, pm: true, reason: 'other', coverAM: 'NC', coverPM: 'NC' };
}) };
x = board(juniorsOut);
res = Assign.suggest([
  { id: 'sp', section: 'wills', surgeon: 'Bilyk', count: 1, serviceCount: 1, start: '1000', category: 'plastics', addOn: false, assigned: '' },
  { id: 'ag', section: 'wills', surgeon: 'Moster', count: 1, serviceCount: 1, start: '1000', category: 'glaucoma', addOn: true, assigned: '' }
], roster, DATA, x.b);
function byId(list, id) { return list.filter(function (r) { return r.caseId === id; })[0] || {}; }
eq(byId(res, 'ag').name, 'Calotti', 'Step 6: add-on glaucoma → Surg 4, though listed second');
eq(byId(res, 'sp').name, 'Djulbegovic', 'Step 7 finds Surg 4 taken → skipped for now → Step 10: Surg 2');
eq(byId(res, 'sp').deferred, true, '…marked as picked up at Step 10');
ok(/Step 7: skipped for now → Step 10/.test(byId(res, 'sp').reasons.join(' · ')), 'reason names the step it was skipped at');
// Step 9 before Step 10: Surg 4 in a scheduled case; an add-on glaucoma
// (listed first) and a globe both at 1:30 — the globe keeps Surg 2 (Step 9),
// the glaucoma waits for Step 10 and gets Surg 3.
x = board({ cases: [{ id: 'g0', section: 'wills', surgeon: 'Moster', count: 2, serviceCount: 2, start: '1300', category: 'glaucoma', addOn: false, assigned: 'Calotti', backup: '' }] });
res = Assign.suggest(x.day.cases.concat([
  { id: 'ag', section: 'wills', surgeon: 'Lee', count: 1, serviceCount: 1, start: '1330', category: 'glaucoma', addOn: true, assigned: '' },
  { id: 'gl', section: 'wills', surgeon: 'Globe', count: 1, serviceCount: 1, start: '1330', category: 'trauma', addOn: true, assigned: '' }
]), roster, DATA, x.b);
eq(byId(res, 'gl').name, 'Djulbegovic', 'Step 9: the globe → Surg 2');
eq(byId(res, 'ag').name, 'Bair', 'Step 6 skipped (Surg 4 in Moster) → Step 10: Surg 2 taken → Surg 3');
eq(res.map(function (r) { return r.caseId; }).join(' '), 'g0 gl ag', 'settled in step order: scheduled glaucoma (5), globe (9), then the skipped add-on (10)');
j = Assign.planAddOns(['glaucoma', 'globe'], 810, roster, DATA, x.b);
eq(names(j), 'Glaucoma:Bair Globe:Djulbegovic', 'the Coverage planner runs the same steps');
eq(j.items[0].deferred && j.items[0].step, 6, 'the glaucoma add-on was skipped at Step 6');
eq(j.items[0].displacedBy, 'Globe / trauma', '…and Surg 2 is taking the globe');
eq(j.items[0].handoff && j.items[0].handoff.primary && j.items[0].handoff.primary.name, 'Samuel', 'Bair leaves Cornea → Cooper senior covers (Surg 2 and 4 are busy)');

/* ---------- past the end of the chain: Surg 2's call, never an automatic pick ---------- */
var seniorsOut = { absences: roster.residents.filter(function (r) { return r.year === 'pgy4'; }).map(function (r, i) {
  return { id: 's' + i, name: r.name, am: true, pm: true, reason: 'other', coverAM: 'NC', coverPM: 'NC' };
}) };
x = board(seniorsOut);
res = Assign.suggest([{ id: 'r1', section: 'wills', surgeon: 'X', count: 1, serviceCount: 1, start: '1000', category: 'other', addOn: false, assigned: '' }], roster, DATA, x.b);
eq(res[0].name, '', 'every senior out: no suggestion — a free junior is outside the chain');
eq(JSON.stringify(res[0].outside), '["Nahar"]', '…but the free junior is listed');
ok(/Surg 2’s call/.test(res[0].warnings.join(' ')), '…as Surg 2’s call');
plan = Assign.planAddOn('globe', 600, roster, DATA, x.b);
eq(plan.pick, null, 'globe with every senior out: no pick');
eq(JSON.stringify(plan.outside), '["Nahar"]', '…the free junior is listed, not picked');
var lc0 = Assign.lateCover('Nahar', 'Glaucoma', 750, 810, roster, DATA, x.b, [], null);
eq(lc0.primary && lc0.primary.name + ' / ' + lc0.primary.source, 'Tang / Retina / Uveitis',
  'clinic cover with every senior out: the doc\'s last step, Retina — Tang is pulled from Retina Private, no cover needed');
var lcNone = Assign.lateCover('Nahar', 'Glaucoma', 750, 810, roster, DATA, x.b, ['Tang', 'Momenaei', 'Hamou', 'Patel'], null);
ok(lcNone.primary === null || /Retina/.test(lcNone.primary.source), 'with the Retina / Uveitis residents taken too, no senior is invented');
ok(Array.isArray(lcNone.outside) && Array.isArray(lcNone.pullable), 'clinic cover lists who else could (outside / pullable)');

/* ---------- Retina / Uveitis first, no cover; never Path (chief, 9/28/2026) ---------- */
x = board({ absences: [{ id: 'n', name: 'Nahar', am: true, pm: true, reason: 'other', coverAM: 'NC', coverPM: 'NC' }] });
res = Assign.suggest([{ id: 'p1', section: 'wills', surgeon: 'Bilyk', count: 1, serviceCount: 1, start: '0900', category: 'plastics', addOn: false, assigned: '' }], roster, DATA, x.b);
eq(res[0].name, 'Patel', 'scheduled plastics, no free junior: the junior in Uveitis (Patel) before Surg 4');
ok(res[0].warnings.some(function (w) { return /Patel leaves Uveitis — no cover needed/.test(w); }), '…no cover needed');
ok(!res[0].warnings.some(function (w) { return /needs a backup/.test(w); }), '…so no backup is asked for');
x = board({ cases: [{ id: 't1', section: 'wills', surgeon: 'X', count: 1, serviceCount: 1, start: '1300', category: 'other', addOn: false, assigned: 'Tang', backup: '' }] });
eq(Assign.backupPlan(x.day.cases[0], roster, DATA, x.day.cases, x.b), null, 'Tang pulled from Retina Private: no backup plan needed');
// Path never pulled — even when a configuration would call it free
var D2 = JSON.parse(JSON.stringify(DATA));
D2.availability.freeTexts = ['PT', 'Path'];
var bPath = Status.build(roster, { nightFloat: 'Perez', absences: roster.residents.filter(function (r) { return r.year !== 'pgy2' || r.name === 'Momenaei'; }).filter(function (r) { return r.name !== 'Momenaei'; }).map(function (r, i) {
  return { id: 'o' + i, name: r.name, am: true, pm: true, reason: 'other', coverAM: 'NC', coverPM: 'NC' };
}), cases: [], clinicStaffOverrides: {} }, D2);
res = Assign.suggest([{ id: 'pp', section: 'wills', surgeon: 'Bilyk', count: 1, serviceCount: 1, start: '0900', category: 'plastics', addOn: false, assigned: '' }], roster, D2, bPath);
ok(res[0].name !== 'Momenaei', 'Momenaei (Path) is never suggested — got ' + JSON.stringify(res[0].name));
ok((res[0].outside || []).indexOf('Momenaei') === -1 && (res[0].pullable || []).indexOf('Momenaei') === -1, '…nor listed as someone to pull');
// past the chain, Retina / Uveitis residents are listed to pull first
x = board(seniorsOut);
res = Assign.suggest([{ id: 'r2', section: 'wills', surgeon: 'X', count: 1, serviceCount: 1, start: '1000', category: 'other', addOn: false, assigned: '' }], roster, DATA, x.b);
eq(JSON.stringify(res[0].pullable), '["Tang","Patel"]', 'Surg 2’s call lists Retina / Uveitis to pull first (Tang, Patel)');
ok(/pull from Retina \/ Uveitis \(no cover needed\): Tang, Patel/.test(res[0].warnings.join(' ')), '…in the warning text');

/* ---------- a morning OR running late into a PM clinic ---------- */
// Mon 9/28: Nahar (2nd year, block 5) — Glaucoma OR / Plastics OR AM, Glaucoma PM.
eq(roster.residents.filter(function (r) { return r.name === 'Nahar'; })[0].pm.text, 'Glaucoma', 'fixture: Nahar has Glaucoma PM');
var lx = board({ overruns: [{ id: 'o1', name: 'Nahar', until: '13:30', label: 'Glaucoma OR / Plastics OR', cover: '' }] });
eq(lx.b.pmClinicStart, 750, 'PM clinics start 12:30 (data.pmClinicStart)');
eq(lx.b.statusAt('Nahar', 765).kind, 'case', 'running late: Nahar is still in the OR at 12:45');
eq(lx.b.statusAt('Nahar', 825).kind, 'clinic', '…and in Glaucoma clinic again at 1:45');
var ln = lx.b.needs.filter(function (n) { return n.type === 'clinic'; });
eq(ln.length === 1 && ln[0].clinic + ' ' + Status.fmtClock(ln[0].start) + '–' + Status.fmtClock(ln[0].end), 'Glaucoma 12:30 PM–1:30 PM', 'the gap is Glaucoma from 12:30 until Nahar is out');
var lc = Assign.lateCover('Nahar', 'Glaucoma', 750, 810, roster, DATA, lx.b, [], 'late:o1');
eq(lc.primary && lc.primary.name + ' (' + lc.primary.source + ')', 'Djulbegovic (Surg 2)', 'suggested: Surg 2 covers Glaucoma until Nahar is done');
lx = board({ overruns: [{ id: 'o1', name: 'Nahar', until: '13:30', cover: 'Djulbegovic' }] });
eq(lx.b.needs.length, 0, 'with Surg 2 covering, no gap');
eq(lx.b.statusAt('Djulbegovic', 765).label, 'covering Glaucoma for Nahar', 'Surg 2 is in Glaucoma 12:30–1:30…');
eq(lx.b.statusAt('Djulbegovic', 825).kind, 'free', '…and free again after');
lx = board({ overruns: [{ id: 'o1', name: 'Nahar', until: '13:30', cover: 'NC' }] });
eq(lx.b.needs.length, 0, 'NC acknowledges the gap');
lx = board({ overruns: [{ id: 'o1', name: 'Nahar', until: '12:15', cover: '' }] });
eq(lx.b.needs.length + (lx.b.lateCases.length), 0, 'done before 12:30 = not late (ignored)');
var ExportFmt = require(path.join(__dirname, '..', 'js', 'export.js'));
var ltxt = ExportFmt.buildText({ date: '2026-09-28', nightFloat: 'Perez', absences: [], cases: [], clinicCounts: {}, clinicStaffOverrides: {}, addOns: [],
  overruns: [{ id: 'o1', name: 'Nahar', until: '13:30', cover: 'Djulbegovic' }], roster: roster });
ok(!/running late|Djulbegovic.*Glaucoma/.test(ltxt), 'running late never appears in the copied schedule');

/* ---------- a junior running late: free juniors first (chief, 9/28/2026) ---------- */
var r929b = Engine.resolveDay('2026-09-29', DATA);
var b929b = Status.build(r929b, { nightFloat: 'Perez', absences: [], cases: [], clinicStaffOverrides: {} }, DATA);
var lj = Assign.lateCover('Ransone', 'Plastics', 750, 810, r929b, DATA, b929b, [], null);
eq(lj.primary && lj.primary.name + ' (' + lj.primary.source + ')', 'Parekh (free junior)', 'Tue: Ransone late from Plastics OR → Parekh, a free junior, covers Plastics (the chief’s Parekh-for-Patel example)');
eq(lj.second && lj.second.name, 'Djulbegovic', '…Surg 2 next');
var ls = Assign.lateCover('Calotti', 'Glaucoma', 750, 810, r929b, DATA, b929b, [], null);
eq(ls.primary && ls.primary.name, 'Djulbegovic', 'a senior running late: the clinic-coverage chain as before (Surg 2)');
eq(Assign.lateCover('Nahar', 'Glaucoma', 750, 810, roster, DATA, board({}).b, [], null).primary.name, 'Djulbegovic', 'Mon: no junior free 12:30–1:30 → Surg 2');

/* ---------- add-ons at different times (chief, 9/28/2026) ---------- */
var jt = Assign.planAddOns([{ kind: 'globe', t: 540 }, { kind: 'plastics', t: 840 }], null, roster, DATA, board({}).b);
eq(jt.items.map(function (it) { return it.pick && it.pick.name; }).join(' '), 'Djulbegovic Djulbegovic', 'a 9 AM globe and a 2 PM TAB can both go to Surg 2 — the times do not overlap');
jt = Assign.planAddOns([{ kind: 'globe', t: 540 }, { kind: 'cornea', t: 840 }], null, roster, DATA, board({}).b);
eq(jt.items[1].handoff && jt.items[1].handoff.primary && jt.items[1].handoff.primary.name, 'Djulbegovic', '2 PM cornea pulls Bair from Cornea; Surg 2 (done with the 9 AM globe) covers');
jt = Assign.planAddOns([{ kind: 'globe', t: 840 }, { kind: 'cornea', t: 840 }], null, roster, DATA, board({}).b);
eq(jt.items[1].handoff && jt.items[1].handoff.primary && jt.items[1].handoff.primary.name, 'Calotti', '…at the same time Surg 2 is taking the globe, so Surg 4 covers');
// the doc's order alone would leave the globe with nobody; the plan covers both
var busyCase = function (id, who, start, count, cat) {
  return { id: id, section: 'wills', surgeon: 'X' + id, count: count, serviceCount: count, start: start, category: cat, addOn: false, assigned: who, backup: '' };
};
x = board({ cases: [busyCase('a', 'Djulbegovic', '1230', 4, 'other'), busyCase('b', 'Bair', '1230', 4, 'other'),
  busyCase('c', 'Samuel', '1230', 4, 'other'), busyCase('d', 'Wibbelsman', '1230', 4, 'other'), busyCase('e', 'Cheng', '1200', 3, 'cataract')] });
jt = Assign.planAddOns([{ kind: 'globe', t: 780 }, { kind: 'glaucoma', t: 810 }], null, roster, DATA, x.b);
eq(jt.unfilledByOrder + ' → ' + jt.unfilled, '1 → 0', 'the doc’s order alone leaves one add-on with nobody; the plan covers both');
eq(jt.items.map(function (it) { return it.label.split(' ')[0] + ':' + (it.pick ? it.pick.name : '-'); }).join(' '), 'Globe:Calotti Glaucoma:Cheng',
  'globe 1:00 → Surg 4 (the only one free); glaucoma 1:30 → skipped for now → Step 10 → Surg 1, whose list ends at 1:30');
eq(jt.items[1].adjusted && jt.items[1].byOrder, 'Calotti', '…and it says the order alone would give the glaucoma to Calotti');
ok(jt.searched < 100, 'the search is tiny (' + jt.searched + ' nodes)');
// with nothing in the way the plan is exactly the doc's order
jt = Assign.planAddOns([{ kind: 'globe', t: 600 }, { kind: 'glaucoma', t: 600 }, { kind: 'cornea', t: 600 }], null, roster, DATA, board({}).b);
ok(jt.items.every(function (it) { return !it.adjusted; }) && jt.unfilledByOrder === 0, 'no conflict: nothing changed from the doc’s order');

console.log(checks + ' checks, ' + failures + ' failure(s)');
if (failures) process.exitCode = 1; else console.log('OK');
