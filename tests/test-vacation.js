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
has(text, 'Uveitis AM: none', 'Patel (covering Ransone) is not listed in their own Uveitis AM — it prints none (the gap)');
text = ExportFmt.buildText(day({ absences: [{ name: 'Ransone', am: true, pm: true, coverAM: 'NC', coverPM: 'NC' }] }));
has(text, 'Plastics PM: none', 'NC: the absent resident drops off and the uncovered clinic prints none (as sent schedules do)');
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

/* ---------- audit 10/18/2026 ---------- */
// a session whose duty needs no cover (Retina / Uveitis, PT, Day Float) and
// has none picked says nothing — not "coverage TBD"
eq(line({ name: 'Patel', am: true, pm: true, coverAM: '', coverPM: '' }),
  'Patel (Uveitis/Glaucoma) PM coverage TBD', 'Uveitis AM needs no cover: only the Glaucoma PM is TBD');
eq(line({ name: 'Patel', am: true, pm: true, coverAM: '', coverPM: 'Hamou' }),
  'Patel (Uveitis/Glaucoma) c/b Hamou PM (CPEC)', '…and with the PM covered, just that');
var r1016 = Engine.resolveDay('2026-10-16', DATA);
eq(ExportFmt.absenceLine({ name: 'Calotti', am: true, pm: true, coverAM: '', coverPM: '' }, r1016), 'Calotti (Retina)', 'Retina all day, nobody picked: no "coverage TBD"');
eq(line({ name: 'Ransone', am: true, pm: true, coverAM: '', coverPM: '' }), 'Ransone (CPEC/Plastics) — coverage TBD', 'clinics that need cover still say TBD');
// Day Float out: nobody covers the Night Float resident — their clinic no
// longer prints "Camacho (for Cotton)" (Wed 10/21: Cotton NF, Camacho DF)
var r1021 = Engine.resolveDay('2026-10-21', DATA);
var d1021 = { date: '2026-10-21', nightFloat: 'Cotton', vacation: '', cases: [], clinicCounts: {}, clinicStaffOverrides: {}, addOns: [], roster: r1021,
  absences: [{ name: 'Camacho', am: true, pm: true, reason: 'vacation', coverAM: '', coverPM: '' }] };
text = ExportFmt.buildText(d1021);
lacks(text, 'Camacho (for Cotton)', 'Day Float on vacation: never printed standing in for the Night Float resident');
ok(/(^|\n)Camacho \(Day Float\)(\n|$)/.test(text), 'the Day Float line says no "coverage TBD" (Day Float needs no cover)');

console.log(checks + ' checks, ' + failures + ' failure(s)');
if (failures) process.exitCode = 1; else console.log('OK');
