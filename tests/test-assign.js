/*
 * tests/test-assign.js — plain Node test script for js/assign.js.
 * No dependencies. Exits non-zero on any failure.
 *
 * Deliberately does NOT require js/engine.js — the DayRoster fixture below is
 * hand-built to the SPEC shape, modeled on the 2026-07-22 verification day:
 * Surg 1 Cheng, Surg 2 Calotti, Surg 3 Aguwa (AM only, Cornea PM),
 * Surg 4 Bair (AM only, Glaucoma PM), Surg 5 Wibbelsman,
 * cooperConsults [Illiano], Plastics OR pm Camacho, Peds OR empty.
 */
'use strict';

var Assign = require('../js/assign.js');

var failures = 0;
var passes = 0;

function ok(cond, label) {
  if (cond) {
    passes++;
    console.log('  ok - ' + label);
  } else {
    failures++;
    console.error('  FAIL - ' + label);
  }
}

function eq(actual, expected, label) {
  var cond = actual === expected;
  if (!cond) label += ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')';
  ok(cond, label);
}

function deepEq(actual, expected, label) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  var cond = a === b;
  if (!cond) label += ' (expected ' + b + ', got ' + a + ')';
  ok(cond, label);
}

function section(name) {
  console.log('\n# ' + name);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ------------------------------------------------------------------ */
/* Fixture: DayRoster for Wednesday 2026-07-22 (4th Wednesday)         */
/* ------------------------------------------------------------------ */

function cell(text) {
  return { text: text, notes: [] };
}

var ROSTER = {
  date: '2026-07-22',
  weekdayKey: 'wed',
  weekdayLabel: 'Wednesday',
  nth: 4,
  inYear: true,
  isWeekend: false,
  residents: [
    { name: 'Cheng', year: 'pgy4', yearLabel: 'PGY-4 (Third Year)', block: 1, taskmaster: false, am: cell('Surg 1'), pm: cell('Surg 1') },
    { name: 'Djulbegovic', year: 'pgy4', yearLabel: 'PGY-4 (Third Year)', block: 2, taskmaster: false, am: cell('CPEC'), pm: cell('CPEC') },
    { name: 'Bair', year: 'pgy4', yearLabel: 'PGY-4 (Third Year)', block: 3, taskmaster: false, am: cell('Surg 4'), pm: cell('Glaucoma') },
    { name: 'Samuel', year: 'pgy4', yearLabel: 'PGY-4 (Third Year)', block: 4, taskmaster: false, am: cell('Retina'), pm: cell('Retina') },
    { name: 'Wibbelsman', year: 'pgy4', yearLabel: 'PGY-4 (Third Year)', block: 5, taskmaster: false, am: cell('Surg 5'), pm: cell('Surg 5') },
    { name: 'Aguwa', year: 'pgy4', yearLabel: 'PGY-4 (Third Year)', block: 6, taskmaster: false, am: cell('Surg 3'), pm: cell('Cornea') },
    { name: 'Shields', year: 'pgy4', yearLabel: 'PGY-4 (Third Year)', block: 7, taskmaster: false, am: cell('CPEC'), pm: cell('CPEC') },
    { name: 'Calotti', year: 'pgy4', yearLabel: 'PGY-4 (Third Year)', block: 8, taskmaster: false, am: cell('Surg 2'), pm: cell('Surg 2') },
    { name: 'Camacho', year: 'pgy3', yearLabel: 'PGY-3 (Second Year)', block: 5, taskmaster: false, am: cell('Private Glaucoma'), pm: cell('Plastics OR') },
    { name: 'Williamson', year: 'pgy3', yearLabel: 'PGY-3 (Second Year)', block: 3, taskmaster: false, am: cell('Private Cornea'), pm: cell('Cornea') },
    { name: 'Cotton', year: 'pgy3', yearLabel: 'PGY-3 (Second Year)', block: 1, taskmaster: false, am: cell('Jeff Consults'), pm: cell('Jeff Consults') },
    { name: 'Tang', year: 'pgy3', yearLabel: 'PGY-3 (Second Year)', block: 7, taskmaster: false, am: cell('Day Float'), pm: cell('Day Float') },
    { name: 'Illiano', year: 'pgy2', yearLabel: 'PGY-2 (First Year)', block: 1, taskmaster: false, am: cell('Cooper Consults'), pm: cell('Cooper Consults') },
    { name: 'Momenaei', year: 'pgy2', yearLabel: 'PGY-2 (First Year)', block: 3, taskmaster: false, am: cell('Peds'), pm: cell('Cornea') },
    { name: 'Ransone', year: 'pgy2', yearLabel: 'PGY-2 (First Year)', block: 5, taskmaster: true, am: cell('Retina'), pm: cell('Glaucoma') },
    { name: 'Hamou', year: 'pgy2', yearLabel: 'PGY-2 (First Year)', block: 2, taskmaster: true, am: cell('ER'), pm: cell('ER') }
  ],
  surg: {
    '1': { name: 'Cheng', am: true, pm: true, amText: 'Surg 1', pmText: 'Surg 1' },
    '2': { name: 'Calotti', am: true, pm: true, amText: 'Surg 2', pmText: 'Surg 2' },
    '3': { name: 'Aguwa', am: true, pm: false, amText: 'Surg 3', pmText: 'Cornea' },
    '4': { name: 'Bair', am: true, pm: false, amText: 'Surg 4', pmText: 'Glaucoma' },
    '5': { name: 'Wibbelsman', am: true, pm: true, amText: 'Surg 5', pmText: 'Surg 5' }
  },
  wer: { am: ['Nahar', 'Hamou'], pm: ['Nahar', 'Hamou', 'Patel'] },
  jeffConsults: ['Cotton'],
  cooperConsults: ['Illiano'],
  dayFloat: ['Tang'],
  taskmasters: ['Hamou', 'Ransone'],
  clinics: {
    'Cornea': { am: [], pm: [{ name: 'Momenaei', year: 'pgy2' }, { name: 'Williamson', year: 'pgy3' }, { name: 'Aguwa', year: 'pgy4' }] },
    'Glaucoma': { am: [], pm: [{ name: 'Ransone', year: 'pgy2' }, { name: 'Bair', year: 'pgy4' }] },
    'Peds': { am: [{ name: 'Momenaei', year: 'pgy2' }], pm: [] },
    'Retina': { am: [{ name: 'Samuel', year: 'pgy4' }, { name: 'Ransone', year: 'pgy2' }], pm: [{ name: 'Samuel', year: 'pgy4' }] }
  },
  orBlocks: {
    'Peds OR': { am: [], pm: [] },
    'Plastics OR': { am: [], pm: [{ name: 'Camacho', year: 'pgy3' }] }
  },
  specialClinicsToday: ['Bilyk Clinic (PM)']
};

function findByCase(results, id) {
  for (var i = 0; i < results.length; i++) {
    if (results[i].caseId === id) return results[i];
  }
  return null;
}

function hasWarning(res, re) {
  return (res.warnings || []).some(function (w) { return re.test(w); });
}

/* ------------------------------------------------------------------ */
section('classify()');

eq(Assign.classify({ category: 'peds' }), 'peds', 'peds -> peds');
eq(Assign.classify({ category: 'peds', addOn: true }), 'peds', 'peds add-on -> peds');
eq(Assign.classify({ category: 'cornea', addOn: true }), 'addOnCornea', 'cornea add-on -> addOnCornea');
eq(Assign.classify({ category: 'glaucoma', addOn: true }), 'addOnGlaucoma', 'glaucoma add-on -> addOnGlaucoma');
eq(Assign.classify({ category: 'trauma' }), 'traumaPlasticsAddOn', 'trauma -> traumaPlasticsAddOn');
eq(Assign.classify({ category: 'trauma', addOn: true }), 'traumaPlasticsAddOn', 'trauma add-on -> traumaPlasticsAddOn');
eq(Assign.classify({ category: 'plastics', addOn: true }), 'traumaPlasticsAddOn', 'plastics add-on -> traumaPlasticsAddOn');
eq(Assign.classify({ category: 'plastics' }), 'scheduledPlastics', 'plastics -> scheduledPlastics');
eq(Assign.classify({ category: 'cornea' }), 'scheduledCornea', 'cornea -> scheduledCornea');
eq(Assign.classify({ category: 'glaucoma' }), 'scheduledGlaucoma', 'glaucoma -> scheduledGlaucoma');
eq(Assign.classify({ category: 'cataract' }), 'scheduledCataract', 'cataract -> scheduledCataract');
eq(Assign.classify({ category: 'retina' }), 'remaining', 'retina -> remaining');
eq(Assign.classify({ category: 'other' }), 'remaining', 'other -> remaining');

/* ------------------------------------------------------------------ */
section('add-on glaucoma -> Bair (Surg 4)');

var res = Assign.suggest([
  { id: 'g1', section: 'wills', surgeon: 'Lee', count: 1, serviceCount: 1, start: '0800', category: 'glaucoma', addOn: true, assigned: '' }
], ROSTER);
eq(res.length, 1, 'one suggestion returned');
eq(res[0].caseId, 'g1', 'caseId echoed');
eq(res[0].name, 'Bair', 'add-on glaucoma suggests Bair');
ok(/→ Surg 4/.test(res[0].reasons.join(' ')), 'reason cites Surg 4');
eq(res[0].warnings.length, 0, 'AM start: no conflict warnings');

/* ------------------------------------------------------------------ */
section('add-on cornea -> Aguwa with PM clinic conflict');

res = Assign.suggest([
  { id: 'k1', section: 'wills', surgeon: 'Ayres', count: 1, serviceCount: 1, start: '1300', category: 'cornea', addOn: true, assigned: '' }
], ROSTER);
eq(res[0].name, 'Aguwa', 'add-on cornea suggests Aguwa');
ok(/→ Surg 3/.test(res[0].reasons.join(' ')), 'reason cites Surg 3');
ok(hasWarning(res[0], /Aguwa is in Cornea clinic PM/), 'warns Aguwa is in Cornea clinic PM');

/* ------------------------------------------------------------------ */
section('peds: no junior on Peds OR -> Surg 4 then Surg 3');

res = Assign.suggest([
  { id: 'p1', section: 'wills', surgeon: 'Levin', count: 1, serviceCount: 1, start: '0900', category: 'peds', addOn: false, assigned: '' }
], ROSTER);
eq(res[0].name, 'Bair', 'peds falls to Surg 4 (Bair) when Peds OR is empty');
ok(/→ Surg 4/.test(res[0].reasons.join(' ')), 'reason cites Surg 4');
ok(res[0].alternates.indexOf('Aguwa') !== -1, 'Surg 3 (Aguwa) offered as alternate');
ok(res[0].alternates.some(function (a) { return /free junior/.test(a); }),
  'free-junior discretion alternate surfaced');
ok(res[0].alternates.indexOf("free junior — Surg 2's discretion") <
   res[0].alternates.indexOf('Aguwa'),
  'free-junior alternate keeps its chain position ahead of Surg 3');

// Same case, but with a junior actually on Peds OR.
var rosterWithPedsJunior = clone(ROSTER);
rosterWithPedsJunior.orBlocks['Peds OR'].am.push({ name: 'Momenaei', year: 'pgy2' });
res = Assign.suggest([
  { id: 'p2', section: 'wills', surgeon: 'Levin', count: 1, serviceCount: 1, start: '0900', category: 'peds', addOn: false, assigned: '' }
], rosterWithPedsJunior);
eq(res[0].name, 'Momenaei', 'peds goes to the junior on Peds OR when present');
ok(/junior on Peds OR/.test(res[0].reasons.join(' ')), 'reason cites the Peds OR junior');
deepEq(res[0].alternates.filter(function (a) { return !/free junior/.test(a); }),
  ['Bair', 'Aguwa'], 'Surg 4 then Surg 3 remain as alternates');

/* ------------------------------------------------------------------ */
section('trauma add-on -> Calotti (Surg 2)');

res = Assign.suggest([
  { id: 't1', section: 'wills', surgeon: 'ER', count: 1, serviceCount: 1, start: '1500', category: 'trauma', addOn: true, assigned: '' }
], ROSTER);
eq(res[0].name, 'Calotti', 'trauma add-on suggests Calotti');
ok(/→ Surg 2/.test(res[0].reasons.join(' ')), 'reason cites Surg 2');
deepEq(res[0].alternates, ['Aguwa', 'Bair', 'Illiano', 'Cheng', 'Wibbelsman'],
  'alternates follow Surg 3 -> Surg 4 -> Cooper -> Surg 1 -> Surg 5');
eq(res[0].warnings.length, 0, 'Calotti is Surg 2 PM: no clinic conflict');

/* ------------------------------------------------------------------ */
section('remaining: chronological order + chain + load balance');

var remainingCases = [
  { id: 'r1', section: 'jhn', surgeon: 'A', count: 1, serviceCount: 1, start: '1100', category: 'other', addOn: false, assigned: '' },
  { id: 'r2', section: 'jhn', surgeon: 'B', count: 1, serviceCount: 1, start: '0730', category: 'other', addOn: false, assigned: '' },
  { id: 'r3', section: 'jhn', surgeon: 'C', count: 1, serviceCount: 1, start: '0900', category: 'other', addOn: false, assigned: '' }
];
res = Assign.suggest(remainingCases, ROSTER);
deepEq(res.map(function (r) { return r.caseId; }), ['r2', 'r3', 'r1'],
  'remaining cases processed in chronological start order');
deepEq(res.map(function (r) { return r.name; }), ['Calotti', 'Calotti', 'Calotti'],
  'chain first choice (Surg 2 / Calotti) suggested each time');
deepEq(res[0].alternates, ['Aguwa', 'Bair', 'Illiano', 'Cheng', 'Wibbelsman'],
  'remaining chain alternates: Surg 3 -> Surg 4 -> Cooper -> Surg 1 -> Surg 5');
eq(res[0].warnings.length, 0, '1st case: no load warning (0 vs 0)');
eq(res[1].warnings.length, 0, '2nd case: no load warning (1 vs 0)');
ok(hasWarning(res[2], /already has 2 cases — consider next in chain/),
  '3rd case: load-balance warning once Calotti leads by 2');
eq(res[2].name, 'Calotti', 'still suggests the chain first choice despite the warning');

// Pre-existing manual assignments count toward load from the start.
var preassigned = [
  { id: 'm1', section: 'jhn', surgeon: 'A', count: 1, serviceCount: 1, start: '0700', category: 'other', addOn: false, assigned: 'Calotti' },
  { id: 'm2', section: 'jhn', surgeon: 'B', count: 1, serviceCount: 1, start: '0800', category: 'other', addOn: false, assigned: 'Calotti' },
  { id: 'm3', section: 'jhn', surgeon: 'C', count: 1, serviceCount: 1, start: '0900', category: 'other', addOn: false, assigned: '' }
];
res = Assign.suggest(preassigned, ROSTER);
ok(hasWarning(findByCase(res, 'm3'), /already has 2 cases/),
  'manual assignments pre-count into the load balance');

/* ------------------------------------------------------------------ */
section('private-only case (serviceCount 0) -> no suggestion');

res = Assign.suggest([
  { id: 'pv1', section: 'private', surgeon: 'Garg', count: 5, serviceCount: 0, start: '0730', category: 'cataract', addOn: false, assigned: '' }
], ROSTER);
eq(res[0].name, '', 'no resident suggested');
eq(res[0].reasons[0], 'private — no resident needed', 'reason explains why');
eq(res[0].warnings.length, 0, 'no warnings');
eq(res[0].alternates.length, 0, 'no alternates');

/* ------------------------------------------------------------------ */
section('process order across groups + spans-day flag');

var mixed = [
  { id: 'x1', section: 'jhn', surgeon: 'A', count: 1, serviceCount: 1, start: '1100', category: 'other', addOn: false, assigned: '' },
  { id: 'x2', section: 'wills', surgeon: 'Ayres', count: 1, serviceCount: 1, start: '1300', category: 'cornea', addOn: true, assigned: '' },
  { id: 'x3', section: 'wills', surgeon: 'Levin', count: 1, serviceCount: 1, start: '0900', category: 'peds', addOn: false, assigned: '' },
  { id: 'x4', section: 'jhn', surgeon: 'B', count: 1, serviceCount: 1, start: '0730', category: 'other', addOn: false, assigned: '' },
  { id: 'x5', section: 'wills', surgeon: 'Marous', count: 7, serviceCount: 2, start: '0730', category: 'cataract', addOn: false, assigned: '' }
];
res = Assign.suggest(mixed, ROSTER);
deepEq(res.map(function (r) { return r.caseId; }), ['x3', 'x5', 'x2', 'x4', 'x1'],
  'peds & scheduled first, then add-ons, then remaining chronologically');
var x5 = findByCase(res, 'x5');
eq(x5.name, 'Cheng', 'scheduled cataract -> Surg 1 (Cheng)');
ok(hasWarning(x5, /spans AM and PM/), 'x7 at 0730 flagged as likely spanning the day');

/* ------------------------------------------------------------------ */
section('clinicCoverage()');

var cov = Assign.clinicCoverage(ROSTER);
deepEq(cov.map(function (e) { return e.name; }),
  ['Calotti', 'Aguwa', 'Bair', 'Illiano', 'Cheng', 'Wibbelsman', 'Samuel'],
  'coverage order: Surg 2,3,4, Cooper, Surg 1,5, then Retina (no Wills OR today)');
deepEq(cov.map(function (e) { return e.source; }),
  ['Surg 2', 'Surg 3', 'Surg 4', 'Cooper Consults', 'Surg 1', 'Surg 5', 'Retina'],
  'each entry labels its chain source');
ok(cov.map(function (e) { return e.name; }).indexOf('Ransone') === -1 ||
   cov.filter(function (e) { return e.name === 'Ransone'; }).length <= 1,
  'names deduped');

/* ------------------------------------------------------------------ */
section('empty roster (weekend) does not crash');

var emptyRoster = {
  date: '2026-07-18', weekdayKey: 'sat', isWeekend: true, inYear: true,
  residents: [], surg: {}, wer: { am: [], pm: [] }, jeffConsults: [],
  cooperConsults: [], dayFloat: [], taskmasters: [], clinics: {}, orBlocks: {},
  specialClinicsToday: []
};
res = Assign.suggest([
  { id: 'w1', section: 'wills', surgeon: 'X', count: 1, serviceCount: 1, start: '0800', category: 'trauma', addOn: true, assigned: '' }
], emptyRoster);
eq(res[0].name, '', 'no suggestion when nothing in the chain resolves');
ok(res[0].warnings.length > 0, 'unresolvable chain carries a warning');
deepEq(Assign.clinicCoverage(emptyRoster), [], 'clinicCoverage empty on weekend roster');

/* ------------------------------------------------------------------ */
console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures > 0) process.exit(1);
