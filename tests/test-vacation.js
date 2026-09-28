#!/usr/bin/env node
/*
 * test-vacation.js — the Vacation section and clinic stand-ins in the copied
 * schedule (js/export.js). Plain Node, no dependencies.
 * Run: node tests/test-vacation.js   (exits non-zero on any failure)
 *
 * Fixture: Mon 9/28/2026, the chief's example —
 *   "Ransone (CPEC/Plastics) c/b Patel AM (uveitis) | Hamou PM (CPEC)".
 */
'use strict';

var path = require('path');
var Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
var ExportFmt = require(path.join(__dirname, '..', 'js', 'export.js'));
var DATA = require(path.join(__dirname, '..', 'js', 'data.js'));

var failures = 0;
var checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.error('FAIL: ' + msg); } }
function eq(a, e, msg) { ok(a === e, msg + ' — expected ' + JSON.stringify(e) + ', got ' + JSON.stringify(a)); }
function has(text, needle, msg) { ok(text.indexOf(needle) !== -1, msg + ' — missing ' + JSON.stringify(needle)); }
function lacks(text, needle, msg) { ok(text.indexOf(needle) === -1, msg + ' — unexpected ' + JSON.stringify(needle)); }

var roster = Engine.resolveDay('2026-09-28', DATA);
function line(a) { return ExportFmt.absenceLine(a, roster); }

/* ---------- the line format ---------- */
eq(line({ name: 'Ransone', am: true, pm: true, coverAM: 'Patel', coverPM: 'Hamou' }),
  'Ransone (CPEC/Plastics) c/b Patel AM (Uveitis) | Hamou PM (CPEC)', "chief's example");
eq(line({ name: 'Ransone', am: true, pm: true, coverAM: 'Patel', coverPM: 'Patel' }),
  'Ransone (CPEC/Plastics) c/b Patel (Uveitis/Glaucoma)', 'one coverer all day');
eq(line({ name: 'Ransone', am: true, pm: true, coverAM: 'Patel', coverPM: 'NC' }),
  'Ransone (CPEC/Plastics) c/b Patel AM (Uveitis) | NC PM', 'NC for one session');
eq(line({ name: 'Ransone', am: true, pm: true, coverAM: 'NC', coverPM: 'NC' }),
  'Ransone (CPEC/Plastics) NC', 'not covered at all');
eq(line({ name: 'Ransone', am: true, pm: false, coverAM: 'Patel' }),
  'Ransone AM (CPEC) c/b Patel (Uveitis)', 'half day');
eq(line({ name: 'Bair', am: true, pm: true, reason: 'sick', coverAM: '', coverPM: '' }),
  'Bair (Surg 3/Cornea) — sick — coverage TBD', 'reason + undecided coverage');

/* ---------- the Vacation section ---------- */
function day(extra) {
  var d = {
    date: '2026-09-28', nightFloat: 'Perez', vacation: '', absences: [], cases: [],
    clinicCounts: {}, clinicStaffOverrides: {}, addOns: [], roster: roster
  };
  for (var k in extra) d[k] = extra[k];
  return d;
}
var text = ExportFmt.buildText(day({}));
has(text, 'Vacation\n24 strong', 'nobody out → 24 strong');
text = ExportFmt.buildText(day({ vacation: '24 strong' }));
has(text, 'Vacation\n24 strong', 'legacy saved text still prints');
text = ExportFmt.buildText(day({ absences: [{ name: 'Ransone', am: true, pm: true, coverAM: 'Patel', coverPM: 'Hamou' }], vacation: '24 strong' }));
has(text, 'Vacation\nRansone (CPEC/Plastics) c/b Patel AM (Uveitis) | Hamou PM (CPEC)', 'absence line printed');
lacks(text, '24 strong', "stale '24 strong' dropped once someone is out");
text = ExportFmt.buildText(day({ absences: [{ name: 'Ransone', am: true, pm: true, coverAM: 'NC', coverPM: 'NC' }], vacation: 'Djulbegovic at AAO Fri' }));
has(text, 'Ransone (CPEC/Plastics) NC\nDjulbegovic at AAO Fri', 'free-text note kept after the lines');

/* ---------- clinic lines follow who is out ---------- */
text = ExportFmt.buildText(day({ absences: [{ name: 'Ransone', am: true, pm: true, coverAM: 'Patel', coverPM: 'Hamou' }] }));
has(text, 'Plastics PM: **Hamou (for Ransone)**', 'coverer stands in on the absent resident’s clinic');
lacks(text, 'Uveitis AM', 'Patel (covering Ransone) is not listed in their own Uveitis AM');
text = ExportFmt.buildText(day({ absences: [{ name: 'Ransone', am: true, pm: true, coverAM: 'NC', coverPM: 'NC' }] }));
lacks(text, 'Plastics PM', 'NC: the absent resident simply drops off the clinic line');
has(text, 'Uveitis AM: **Patel**', 'Patel stays in Uveitis when not covering');

// Night Float week: the NF resident's clinic goes to Day Float.
// Mon 10/12: Williamson (NF) has Glaucoma PM; Camacho is Day Float.
var r1012 = Engine.resolveDay('2026-10-12', DATA);
var d1012 = { date: '2026-10-12', nightFloat: 'Williamson', vacation: '', absences: [], cases: [], clinicCounts: {}, clinicStaffOverrides: {}, addOns: [], roster: r1012 };
text = ExportFmt.buildText(d1012);
ok(/Glaucoma PM: \*\*[^\n]*Camacho \(for Williamson\)/.test(text), 'Day Float stands in for the NF resident in clinic');
ok(!/Glaucoma PM: \*\*[^\n]*Williamson,/.test(text) && !/Glaucoma PM: \*\*Williamson\*\*/.test(text), 'NF resident not listed in their clinic');

/* ---------- a case backup of NC prints no backup name ---------- */
text = ExportFmt.buildText(day({ cases: [
  { id: 'c1', section: 'wills', surgeon: 'Hark', count: 1, serviceCount: 1, start: '1300', category: 'cornea', addOn: false, notes: '', assigned: 'Bair', backup: 'NC', backupNote: '' }
] }));
has(text, '-Hark x1 (1300 start) - **Bair**', 'NC backup: just the resident');
lacks(text, 'NC', 'the literal NC never prints on a case line');

console.log(checks + ' checks, ' + failures + ' failure(s)');
if (failures) process.exitCode = 1; else console.log('OK');
