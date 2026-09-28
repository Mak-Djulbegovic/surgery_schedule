#!/usr/bin/env node
/*
 * test-status.js — plain Node test script for js/status.js. No dependencies.
 * Run: node tests/test-status.js   (exits non-zero on any failure)
 *
 * Fixture day: Mon 9/28/2026 (4th Monday). From the block schedule:
 *   Surg 1 Cheng, Surg 2 Djulbegovic, Surg 3 Bair (AM Surg 3 / PM Cornea),
 *   Surg 4 Calotti, Surg 5 Wibbelsman; Ransone CPEC/Plastics, Patel
 *   Uveitis/Glaucoma, Hamou Peds/CPEC; Perez is Day Float AND on Night Float.
 * The vacation example is the chief's own: "Ransone (CPEC/Plastics) c/b
 * Patel AM (uveitis) | Hamou PM (CPEC)".
 */
'use strict';

var path = require('path');
var Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
var Status = require(path.join(__dirname, '..', 'js', 'status.js'));
var DATA = require(path.join(__dirname, '..', 'js', 'data.js'));

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

function same(actual, expected, msg) {
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

var T = Status.parseClock;

/* ---------- clock parsing ---------- */
eq(T('0730'), 450, "'0730' -> 7:30");
eq(T('730'), 450, "'730' -> 7:30");
eq(T('7:30'), 450, "'7:30' -> 7:30");
eq(T('12:30'), 750, "'12:30' -> 12:30 PM");
eq(T('1:00'), 780, "'1:00' (CPEC sheet) -> 1 PM, not 1 AM");
eq(T('130'), 810, "'130' -> 1:30 PM");
eq(T('1300'), 780, "'1300' -> 1 PM");
eq(T('9:30 AM'), 570, "'9:30 AM' explicit");
eq(T('1pm'), 780, "'1pm'");
eq(T('12:15 am'), 15, "'12:15 am' -> just after midnight");
eq(T('0600'), 360, "zero-padded '0600' stays 6 AM");
eq(T('06:30'), 390, "zero-padded '06:30' stays 6:30 AM");
eq(T('AM TF'), null, "'AM TF' has no time");
eq(T('x2 service'), null, "'x2 service' is not a time");
eq(T('7/28/26'), null, 'dates are not times');
eq(T('All day 7:30'), 450, "'All day 7:30' -> 7:30");
same(Status.clockTokens('1030 & 1300'), [630, 780], 'service times list');
eq(Status.fmtClock(780), '1:00 PM', 'fmtClock 1 PM');
eq(Status.fmtClock(450), '7:30 AM', 'fmtClock 7:30 AM');
eq(Status.fmtClock(720), '12:00 PM', 'fmtClock noon');
eq(Status.fmtHHMM(810), '1330', 'fmtHHMM');

/* ---------- case spans ---------- */
var sp = Status.caseSpans({ category: 'cataract', count: 4, serviceCount: 4, start: '0730' }, DATA);
same(sp.spans, [{ start: 450, end: 570 }], 'x4 cataracts at 7:30 -> 7:30–9:30 (30 min each)');
eq(sp.estimated, true, 'no until -> estimated');
sp = Status.caseSpans({ category: 'cataract', count: 7, serviceCount: 2, start: '0730', serviceTimes: '1030 & 1300' }, DATA);
same(sp.spans, [{ start: 630, end: 660 }, { start: 780, end: 810 }], 'service times -> busy only for the service cases');
sp = Status.caseSpans({ category: 'cornea', count: 1, serviceCount: 1, start: '1300', until: '1500' }, DATA);
same(sp.spans, [{ start: 780, end: 900 }], "'until' replaces the estimated end");
eq(sp.estimated, false, 'typed until -> not estimated');
sp = Status.caseSpans({ category: 'cataract', count: 2, serviceCount: 2, start: 'AM TF' }, DATA);
eq(sp.unknownStart, true, "'AM TF' -> unknown start");
eq(sp.start, 450, "'AM TF' assumed 7:30");
sp = Status.caseSpans({ category: 'cataract', count: 3, serviceCount: 3, start: '1:00' }, DATA);
same(sp.spans, [{ start: 780, end: 870 }], "CPEC sheet '1:00' x3 -> 1:00–2:30 PM");

/* ---------- classification (chief's rule: CPEC, PT, idle OR/Surg = free) ---------- */
eq(Status.kindOfClass(Status.classifyText('CPEC', DATA)), 'free', 'CPEC counts as available');
eq(Status.kindOfClass(Status.classifyText('PT', DATA)), 'free', 'PT counts as available');
eq(Status.kindOfClass(Status.classifyText('Wills OR', DATA)), 'free', 'OR block with no case is available');
eq(Status.kindOfClass(Status.classifyText('Surg 4', DATA)), 'free', 'Surg role with no case is available');
eq(Status.kindOfClass(Status.classifyText('Tabas Cataracts', DATA)), 'free', 'attending cataract day is an OR-type block');
eq(Status.kindOfClass(Status.classifyText('ER', DATA)), 'duty', 'ER is fixed duty');
eq(Status.kindOfClass(Status.classifyText('Cooper Consults', DATA)), 'duty', 'consults are fixed duty');
eq(Status.kindOfClass(Status.classifyText('Day Float', DATA)), 'duty', 'Day Float is never "available"');
eq(Status.kindOfClass(Status.classifyText('Cornea', DATA)), 'clinic', 'Cornea is clinic');
eq(Status.kindOfClass(Status.classifyText('Private Glaucoma', DATA)), 'clinic', 'private attending clinic is clinic');

/* ---------- the board: 9/28 ---------- */
var roster = Engine.resolveDay('2026-09-28', DATA);
function day(extra) {
  var d = { nightFloat: 'Perez', absences: [], cases: [], clinicStaffOverrides: {} };
  for (var k in extra) d[k] = extra[k];
  return d;
}
function kinds(board, t) {
  var out = {};
  board.order.forEach(function (n) { out[n] = board.statusAt(n, t).kind; });
  return out;
}

var b = Status.build(roster, day({}), DATA);
var k1330 = kinds(b, 810);
eq(k1330.Bair, 'clinic', 'Bair (Surg 3, no case) is in Cornea clinic PM');
eq(k1330.Calotti, 'free', 'Calotti (Surg 4 all day) is free PM with no case');
eq(k1330.Aguwa, 'free', 'Aguwa in CPEC is free');
eq(k1330.Samuel, 'free', 'Samuel on Wills OR with no case is free');
eq(k1330.Teng, 'duty', 'Teng in ER is on duty');
eq(k1330.Perez, 'out', 'Perez on Night Float is out for the day');
eq(kinds(b, 540).Bair, 'free', 'Bair AM (Surg 3, no case) is free');
ok(b.warnings.some(function (w) { return /Perez is both Day Float and Night Float/.test(w); }), 'warns: Day Float is on Night Float');
eq(b.needs.length, 0, 'nothing to cover before any case or absence');

// Surg 3 pulled into a 1 PM cornea case: Cornea clinic needs a cover
b = Status.build(roster, day({ cases: [
  { id: 'c1', surgeon: 'Hark', count: 1, serviceCount: 1, start: '1300', category: 'cornea', assigned: 'Bair', backup: '' }
] }), DATA);
eq(b.statusAt('Bair', 810).kind, 'case', 'Bair in the case at 1:30');
eq(b.statusAt('Bair', 900).kind, 'clinic', 'Bair back in Cornea clinic at 3:00 (case est. 1:00–2:30)');
var gaps = b.needs.filter(function (n) { return n.type === 'clinic'; });
eq(gaps.length, 1, 'one clinic gap');
eq(gaps[0] && gaps[0].clinic, 'Cornea', 'gap is Cornea');
eq(gaps[0] && gaps[0].start, 780, 'gap from 1:00');
eq(gaps[0] && gaps[0].end, 870, 'gap to 2:30');

// Surg 2 backs up: covering Cornea for Bair, gap closed
var cases = [
  { id: 'c1', surgeon: 'Hark', count: 1, serviceCount: 1, start: '1300', category: 'cornea', assigned: 'Bair', backup: 'Djulbegovic' }
];
b = Status.build(roster, day({ cases: cases }), DATA);
var dj = b.statusAt('Djulbegovic', 810);
eq(dj.kind, 'clinic', 'Surg 2 is in clinic while covering');
eq(dj.covering, 'Bair', 'Surg 2 is covering Bair');
eq(dj.clinic, 'Cornea', 'Surg 2 is covering Cornea');
eq(b.statusAt('Djulbegovic', 900).kind, 'free', 'Surg 2 free again after the case');
eq(b.needs.length, 0, 'no needs once Surg 2 covers');

// A globe at 1:30 goes to Surg 2 (who leaves clinic): gap until a new cover
cases.push({ id: 'g1', surgeon: 'Globe', count: 1, serviceCount: 1, start: '1330', category: 'trauma', addOn: true, assigned: 'Djulbegovic', backup: '' });
b = Status.build(roster, day({ cases: cases }), DATA);
gaps = b.needs.filter(function (n) { return n.type === 'clinic'; });
eq(gaps.length, 1, 'globe on Surg 2 re-opens the Cornea gap');
eq(gaps[0] && gaps[0].start, 810, 'gap starts when Surg 2 leaves (1:30)');
eq(gaps[0] && gaps[0].end, 870, 'gap ends when Bair is back (2:30)');
eq(gaps[0] && gaps[0].owner, 'Bair', "it is Bair's clinic");
// …and the globe's backup covers Bair's clinic (chain resolves to the owner)
cases[1].backup = 'Calotti';
b = Status.build(roster, day({ cases: cases }), DATA);
var ca = b.statusAt('Calotti', 825);
eq(ca.kind, 'clinic', 'Calotti in clinic at 1:45');
eq(ca.covering, 'Bair', 'Calotti covers for Bair (not "for Djulbegovic")');
eq(b.needs.length, 0, 'all covered');
// 'NC' on the globe acknowledges the gap instead
cases[1].backup = 'NC';
b = Status.build(roster, day({ cases: cases }), DATA);
eq(b.needs.length, 0, "backup 'NC' acknowledges the gap");

// statusDuring / exclude: judging the globe itself
b = Status.build(roster, day({ cases: cases }), DATA);
eq(b.statusDuring('Djulbegovic', 810, 930).kind, 'case', 'Surg 2 busy during the globe');
eq(b.statusDuring('Djulbegovic', 810, 930, { exclude: 'g1' }).kind, 'clinic', 'excluding the globe, Surg 2 would be covering clinic');

/* ---------- absences: the chief's vacation example ---------- */
b = Status.build(roster, day({ absences: [
  { id: 'a1', name: 'Ransone', am: true, pm: true, reason: 'vacation', coverAM: 'Patel', coverPM: 'Hamou' }
] }), DATA);
eq(b.statusAt('Ransone', 540).kind, 'out', 'Ransone out AM');
var pa = b.statusAt('Patel', 540);
eq(pa.covering, 'Ransone', 'Patel covers Ransone AM');
eq(pa.text, 'CPEC', "Patel takes Ransone's CPEC");
eq(pa.kind, 'free', 'covering CPEC still counts as available');
var ha = b.statusAt('Hamou', 810);
eq(ha.kind, 'clinic', "Hamou takes Ransone's Plastics clinic PM");
eq(b.statusAt('Hamou', 540).kind, 'clinic', 'Hamou keeps their own AM (Peds)');
var uv = b.needs.filter(function (n) { return n.type === 'clinic' && n.clinic === 'Uveitis'; });
eq(uv.length, 1, 'flags that Uveitis AM loses Patel');
// taking Patel off Uveitis AM clears it
b = Status.build(roster, day({
  absences: [{ id: 'a1', name: 'Ransone', am: true, pm: true, reason: 'vacation', coverAM: 'Patel', coverPM: 'Hamou' }],
  clinicStaffOverrides: { 'Uveitis|am': { removed: ['Patel'], added: [] } }
}), DATA);
eq(b.needs.length, 0, 'removing Patel from Uveitis AM acknowledges it');

// NC and unset coverage
b = Status.build(roster, day({ absences: [
  { id: 'a1', name: 'Ransone', am: true, pm: true, reason: 'vacation', coverAM: 'NC', coverPM: '' }
] }), DATA);
var ab = b.needs.filter(function (n) { return n.type === 'absence'; });
eq(ab.length, 1, 'only the uncovered, non-NC session is a need');
eq(ab[0] && ab[0].session, 'pm', 'PM still needs a decision');

// AM-only absence leaves the PM alone
b = Status.build(roster, day({ absences: [{ id: 'a1', name: 'Cheng', am: true, pm: false, reason: 'sick', coverAM: 'NC', coverPM: '' }] }), DATA);
eq(b.statusAt('Cheng', 540).kind, 'out', 'Cheng out AM');
eq(b.statusAt('Cheng', 810).kind, 'free', 'Cheng back PM');

/* ---------- Day Float covers ONLY the Night Float resident ---------- */
// Week of 10/5: Camacho on NF (CPEC that Monday); Perez is Day Float.
var r105 = Engine.resolveDay('2026-10-05', DATA);
b = Status.build(r105, day({ nightFloat: 'Camacho' }), DATA);
var pz = b.statusAt('Perez', 540);
eq(b.statusAt('Camacho', 540).kind, 'out', 'NF resident out for the day');
eq(pz.covering, 'Camacho', 'Day Float stands in for the NF resident');
eq(pz.kind, 'duty', 'Day Float covering CPEC is still not "available"');
ok(b.freeAt(540).indexOf('Perez') === -1, 'Day Float never listed as free');

/* ---------- clinic staffing edits drive status ---------- */
b = Status.build(roster, day({ clinicStaffOverrides: { 'Cornea|pm': { removed: [], added: ['Cheng'] } } }), DATA);
eq(b.statusAt('Cheng', 810).kind, 'clinic', 'resident added to a clinic is in that clinic');
b = Status.build(roster, day({ clinicStaffOverrides: { 'Cornea|pm': { removed: ['Parekh'], added: [] } } }), DATA);
eq(b.statusAt('Parekh', 810).kind, 'free', 'resident taken off their clinic is free');

/* ---------- session availability ---------- */
b = Status.build(roster, day({ cases: [
  { id: 'c1', surgeon: 'Wisner', count: 2, serviceCount: 2, start: '0730', category: 'cataract', assigned: 'Cheng', backup: '' }
] }), DATA);
var am = b.freeInSession('am');
var ch = am.filter(function (x) { return x.name === 'Cheng'; })[0];
ok(!!ch, 'Cheng is partly free AM');
eq(ch && ch.full, false, 'not the whole AM');
eq(ch && ch.ranges[0].start, 420, 'free from 7:00…');
eq(ch && ch.ranges[0].end, 450, '…until the 7:30 list');
eq(ch && ch.ranges[1] && ch.ranges[1].start, 510, 'free again at 8:30 (x2 est. 30 min each)');
ok(am.some(function (x) { return x.name === 'Aguwa' && x.full; }), 'Aguwa free the whole AM');

/* ---------- weekend ---------- */
b = Status.build(Engine.resolveDay('2026-09-26', DATA), day({}), DATA);
eq(b.order.length, 0, 'weekend: nobody on the board');
eq(b.needs.length, 0, 'weekend: no needs');

console.log(checks + ' checks, ' + failures + ' failure(s)');
if (failures) {
  process.exitCode = 1;
} else {
  console.log('OK');
}
