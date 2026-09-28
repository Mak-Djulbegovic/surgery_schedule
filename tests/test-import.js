#!/usr/bin/env node
/*
 * test-import.js — pasting a sent schedule back in (js/importer.js).
 * Plain Node, no dependencies. Run: node tests/test-import.js
 *
 * The contract: copy → paste → rebuild prints the same schedule, whether
 * the paste kept the **bold** markers (Copy plain text) or not (Copy
 * formatted, pasted out of an email), and after a mail client has turned
 * dashes into en dashes, lines into bullets and added blank lines.
 */
'use strict';

var path = require('path');
var Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
var ExportFmt = require(path.join(__dirname, '..', 'js', 'export.js'));
var ImportFmt = require(path.join(__dirname, '..', 'js', 'importer.js'));
var DATA = require(path.join(__dirname, '..', 'js', 'data.js'));

var failures = 0;
var checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.error('FAIL: ' + msg); } }
function eq(a, e, msg) { ok(a === e, msg + ' — expected ' + JSON.stringify(e) + ', got ' + JSON.stringify(a)); }

var DATE = '2026-09-28'; // Monday, 4th Monday
var roster = Engine.resolveDay(DATE, DATA);
var names = roster.residents.map(function (r) { return r.name; });
var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function addOnLabel(row) {
  if (!row.date) return row.label || '';
  var p = row.date.split('-');
  var d = new Date(+p[0], +p[1] - 1, +p[2]);
  return WEEKDAYS[d.getDay()] + ' ' + (row.period === 'day' ? 'daytime' : 'night') +
    ' (' + (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2) + ')';
}
function base() {
  var rows = [
    { date: '2026-09-28', period: 'day', name: '', auto: true },
    { date: '2026-09-28', period: 'night', name: '', auto: true },
    { date: '2026-09-29', period: 'day', name: '', auto: true }
  ];
  rows.forEach(function (r) { r.label = addOnLabel(r); });
  return {
    date: DATE, lectures: '', nightFloat: '', nfCleared: false, absences: [], outConfirmed: false,
    vacation: '', cooperBuddyAM: { name: '', note: '' }, cooperBuddyPM: { name: '', note: '' },
    addOns: rows, cases: [], clinicCounts: {}, clinicStaffOverrides: {}, suggestions: {}, seq: 1
  };
}
function withRoster(day) { var d = {}; for (var k in day) d[k] = day[k]; d.roster = roster; return d; }
function kase(o) {
  var c = { section: 'wills', surgeon: '', count: 1, serviceCount: 1, start: '', serviceTimes: '', category: 'cataract',
    addOn: false, notes: '', assigned: '', backup: '', backupNote: '', until: '' };
  for (var k in o) c[k] = o[k];
  return c;
}

/* ---------- a day with every kind of line ---------- */
var day = base();
day.lectures = 'Grand rounds 7am\nWet lab 5pm';
day.nightFloat = 'Perez';
day.absences = [
  { id: 'a1', name: 'Ransone', am: true, pm: true, reason: 'vacation', coverAM: 'Patel', coverPM: 'Hamou' },
  { id: 'a2', name: 'Tang', am: false, pm: true, reason: 'sick', coverAM: '', coverPM: 'NC' },
  { id: 'a3', name: 'Marshall', am: true, pm: true, reason: 'conference', coverAM: '', coverPM: '' }
];
day.vacation = 'Djulbegovic at AAO Fri';
day.cases = [
  kase({ surgeon: 'Abendroth', count: 5, serviceCount: 0, start: 'AM TF', assigned: 'Cheng' }),
  kase({ surgeon: 'DiDomenico', count: 4, serviceCount: 4, start: '7:30', assigned: 'Wibbelsman' }),
  kase({ surgeon: 'Marous', count: 7, serviceCount: 2, start: '730', serviceTimes: '1030 & 1300', assigned: 'Momenaei', notes: 'no Peds OR', category: 'peds' }),
  kase({ surgeon: 'Hark', count: 1, start: '1300', category: 'cornea', assigned: 'Bair', backup: 'Djulbegovic', backupNote: 'to cover cornea clinic during case, 2nd backup Calotti (Surg 4)' }),
  kase({ surgeon: 'Globe/trauma', count: 1, start: '1330', category: 'trauma', assigned: 'Djulbegovic', backup: 'Calotti', backupNote: 'to cover cornea clinic (for Bair) during case', notes: 'surgeon TBD' }),
  kase({ section: 'private', surgeon: 'Pericic', count: 14, serviceCount: 0, notes: 'Stadium' }),
  kase({ section: 'jhn', surgeon: 'Bilyk', count: 1, start: '0900', category: 'plastics', notes: 'confirm with Surg 2' }),
  kase({ section: 'jhn', surgeon: 'Sieber', count: 2, serviceCount: 2, category: 'plastics', backup: 'Shields', backupNote: 'if after 1 PM' }),
  kase({ section: 'other', surgeon: 'Gordon', count: 2, start: 'AM TF', assigned: 'Cheng', notes: 'Cherry Hill' })
];
day.clinicCounts = {
  'Cornea|pm': { count: '29x3', extra: '' },
  'Glaucoma|pm': { count: '', extra: 'late start' },
  'CPEC PO|day': { count: '12', extra: '' }
};
day.clinicStaffOverrides = {
  'Neuro|am': { removed: [], added: ['Samuel'] },
  'Path|am': { removed: ['Momenaei'], added: [] },
  'CPEC PO|day': { removed: [], added: ['Aguwa'] }
};
day.addOns[0].name = 'Djulbegovic';
day.addOns[1].name = 'Calotti';
day.addOns[2].name = 'Samuel';

var text = ExportFmt.buildText(withRoster(day));
var cpecSurgeons = Engine.cpecForDate(DATE, DATA).entries.map(function (e) { return e.attending; });
function surgRoleOf(n) {
  var s = roster.surg || {};
  for (var k in s) if (s[k] && s[k].name === n) return k;
  return '';
}
var OPTS = { addOnLabel: addOnLabel, cpecSurgeons: cpecSurgeons, surgRoleOf: surgRoleOf };
function roundTrip(pasted) {
  var parsed = ImportFmt.parse(pasted, { names: names });
  var d2 = ImportFmt.toDay(parsed, base(), roster, DATA, ExportFmt, OPTS);
  return { parsed: parsed, day: d2, text: ExportFmt.buildText(withRoster(d2)) };
}

// sanity: the fixture really exercises each form
[
  'Lectures/Events', 'Night Float: **Perez**', ', x2 service - 1030 & 1300 - **Momenaei**',
  '**Bair; Djulbegovic** to cover cornea clinic', '- ⚠ UNASSIGNED (confirm with Surg 2)',
  '(backup: Shields if after 1 PM)', 'Other (Stadium/Cherry Hill)', 'Cornea PM (29x3): ',
  'Glaucoma PM (late start): ', 'CPEC PO (12): **Aguwa**', 'Tang PM (Retina Private) — sick NC',
  'Marshall (Neuro) — conference — coverage TBD', 'Djulbegovic at AAO Fri',
  'Monday night (9/28/26): **Calotti**'
].forEach(function (needle) { ok(text.indexOf(needle) !== -1, 'fixture prints ' + JSON.stringify(needle) + '\n' + text); });
ok(text.indexOf('Path AM') === -1, 'fixture: Path AM emptied by an override is not printed');

/* ---------- 1. Copy plain text (with **) ---------- */
var r1 = roundTrip(text);
eq(r1.text, text, 'round trip — pasted with ** markers');
eq(r1.parsed.unknown.length, 0, 'nothing unread: ' + JSON.stringify(r1.parsed.unknown));
eq(r1.parsed.unknownNames.length, 0, 'every name is on the roster: ' + JSON.stringify(r1.parsed.unknownNames));
eq(r1.day.cases.length, 9, 'nine cases read');
eq(r1.day.absences.length, 3, 'three absences read');
eq(r1.day.absences[0].coverAM + '/' + r1.day.absences[0].coverPM, 'Patel/Hamou', 'split coverage read');
eq(r1.day.absences[1].pm && !r1.day.absences[1].am && r1.day.absences[1].reason === 'sick' && r1.day.absences[1].coverPM === 'NC', true, 'half-day sick NC read');
eq(r1.day.absences[2].reason, 'conference', 'reason read');
eq(r1.day.vacation, 'Djulbegovic at AAO Fri', 'free-text note kept as the note');
eq(r1.parsed.notedNotOut.join(), 'Djulbegovic at AAO Fri', 'a note that starts with a name is flagged');
eq(r1.day.nightFloat, 'Perez', 'Night Float read');
eq(r1.day.lectures, 'Grand rounds 7am\nWet lab 5pm', 'lectures read');
eq(JSON.stringify(r1.day.clinicStaffOverrides['Neuro|am']), JSON.stringify({ removed: [], added: ['Samuel'] }), 'clinic addition rebuilt');
eq(JSON.stringify(r1.day.clinicStaffOverrides['Path|am']), JSON.stringify({ removed: ['Momenaei'], added: [] }), 'clinic emptied → removal rebuilt');
eq(r1.day.clinicCounts['Glaucoma|pm'].extra, 'late start', 'clinic note read (no count)');
eq(r1.day.addOns.map(function (a) { return a.name; }).join(), 'Djulbegovic,Calotti,Samuel', 'add-on names land on their rows');
eq(r1.parsed.addOnDates[0], '2026-09-28', 'add-ons say which day it is');
eq(r1.parsed.surg['3'], 'Bair', 'Surg lines read');
var hark = r1.day.cases[3];
eq(hark.assigned + '|' + hark.backup, 'Bair|Djulbegovic', 'resident; backup split');
eq(hark.backupNote, 'to cover cornea clinic during case, 2nd backup Calotti (Surg 4)', 'backup note kept whole');
var marous = r1.day.cases[2];
eq(marous.serviceCount + '|' + marous.serviceTimes + '|' + marous.notes, '2|1030 & 1300|no Peds OR', 'service count, times and notes');
eq(r1.day.cases[6].assigned + '|' + r1.day.cases[6].serviceCount, '|1', 'UNASSIGNED service case stays open');
eq(r1.day.cases[7].backup + '|' + r1.day.cases[7].backupNote, 'Shields|if after 1 PM', 'backup of an unassigned case');
eq(r1.day.cases[5].serviceCount, 0, 'private list has no service case');

/* ---------- categories are guessed ---------- */
eq(r1.day.cases.map(function (c) { return c.category; }).join(),
  'cataract,cataract,other,cornea,trauma,cataract,plastics,plastics,cataract',
  'category guesses: CPEC surgeons cataract, backup note cornea, globe trauma, privates cataract, JHN plastics, Surg 1 cataract');

/* ---------- 2. Copy formatted, pasted out of an email (no **) ---------- */
var plain = text.replace(/\*\*/g, '');
eq(roundTrip(plain).text, text, 'round trip — pasted without ** markers');

/* ---------- 3. a mail client's mangling ---------- */
var mangled = 'Hi all — here is the schedule:\n\n' + plain
  .split('\n')
  .map(function (l) { return l.replace(/^-/, '• ').replace(/ - /g, ' – ').replace(/ /g, function () { return Math.random() < 0.05 ? '\u00a0' : ' '; }); })
  .join('\n\n') + '\n\nThanks!\n';
var r3 = roundTrip(mangled);
eq(r3.text, text, 'round trip — bullets, en dashes, blank lines, nbsp');
eq(r3.parsed.unknown.join(' | '), 'Hi all — here is the schedule: | Thanks!', 'greeting and sign-off reported as unread');

/* ---------- diffLines ---------- */
ok(ImportFmt.diffLines(mangled.replace(/Hi all.*\n|Thanks!/g, ''), r3.text).same, 'diffLines: equal modulo formatting');
var d = ImportFmt.diffLines(plain + '\n-Mystery x2 (7:30 start) - Nobody', text);
eq(d.missing.length, 1, 'diffLines: a line that did not come back is reported');

/* ---------- 4. a hand-typed schedule ---------- */
var hand = [
  'Assignments', 'Surg 1 – Cheng', 'Surg 2 - Djulbegovic', '', 'Wills/ASC',
  '-Hark x2 (7:30 start) – Bair; Calotti to cover cornea clinic',
  '- Smith x1 (1:00) - Wibbelsman', 'Vacation', 'Ransone c/b Patel', '24 strong'
].join('\n');
var r4 = ImportFmt.parse(hand, { names: names });
eq(r4.cases.length, 2, 'hand-typed case lines read');
eq(r4.cases[0].assigned + '|' + r4.cases[0].backup, 'Bair|Calotti', 'hand-typed en dash before the resident');
eq(r4.cases[1].start + '|' + r4.cases[1].assigned, '1:00|Wibbelsman', '"(1:00)" without "start" is the start time');
eq(r4.absences.length === 1 && r4.absences[0].coverAM === 'Patel' && r4.absences[0].coverPM === 'Patel', true, '"Ransone c/b Patel" = all day, one coverer');

/* ---------- unknown resident names are flagged ---------- */
var r5 = ImportFmt.parse('Wills/ASC\n-Hark x1 - Zorro', { names: names });
eq(r5.unknownNames.join(), 'Zorro', 'a resident not on the roster is flagged');

/* ---------- empty paste ---------- */
var r6 = ImportFmt.parse('', { names: names });
eq(r6.read + r6.unknown.length, 0, 'empty paste reads nothing');

if (failures) {
  console.error(failures + ' failure(s) of ' + checks);
  process.exit(1);
}
console.log('test-import: ' + checks + ' checks, 0 failure(s)');
