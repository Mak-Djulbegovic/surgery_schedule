#!/usr/bin/env node
/*
 * test-engine.js — plain Node test script for js/engine.js. No dependencies.
 * Run: node tests/test-engine.js   (exits non-zero on any failure)
 */
'use strict';

var path = require('path');
var Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
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

function sameMembers(actual, expected, msg) {
  var a = (actual || []).slice().sort();
  var e = (expected || []).slice().sort();
  ok(JSON.stringify(a) === JSON.stringify(e),
    msg + ' — expected members ' + JSON.stringify(e) + ', got ' + JSON.stringify(a));
}

function includes(arr, v, msg) {
  ok((arr || []).indexOf(v) !== -1, msg + ' — ' + JSON.stringify(v) + ' not in ' + JSON.stringify(arr));
}

function names(entries) {
  return (entries || []).map(function (e) { return e.name; });
}

function byName(day, name) {
  for (var i = 0; i < day.residents.length; i++) {
    if (day.residents[i].name === name) return day.residents[i];
  }
  return null;
}

/* ---------- module contract ---------- */
ok(typeof Engine === 'object' && Engine !== null, 'Engine exports an object');
ok(typeof Engine.resolveDay === 'function', 'Engine.resolveDay is a function');
ok(typeof Engine.nthWeekdayOfMonth === 'function', 'Engine.nthWeekdayOfMonth is a function');

/* ---------- nth-weekday math (local-date parsing) ---------- */
eq(Engine.nthWeekdayOfMonth(new Date(2026, 6, 1)), 1, 'nth: Jul 1 2026 is 1st of its weekday');
eq(Engine.nthWeekdayOfMonth(new Date(2026, 6, 7)), 1, 'nth: Jul 7 2026 still 1st');
eq(Engine.nthWeekdayOfMonth(new Date(2026, 6, 8)), 2, 'nth: Jul 8 2026 is 2nd');
eq(Engine.nthWeekdayOfMonth(new Date(2026, 6, 22)), 4, 'nth: Jul 22 2026 is 4th');
eq(Engine.nthWeekdayOfMonth(new Date(2026, 6, 29)), 5, 'nth: Jul 29 2026 is 5th');
eq(Engine.nthWeekdayOfMonth(new Date(2026, 6, 31)), 5, 'nth: Jul 31 2026 is 5th');
eq(Engine.nthWeekdayOfMonth('2026-07-22'), 4, 'nth: accepts ISO string, parsed LOCAL');
// Local parsing check: '2026-07-22' must be a Wednesday (UTC parsing would break in west-of-GMT zones)
eq(Engine.parseISO('2026-07-22').getDay(), 3, 'parseISO gives local Wednesday for 2026-07-22');

/* ---------- 2026-07-22: 4th Wednesday fixture ---------- */
var day = Engine.resolveDay('2026-07-22', DATA);

eq(day.date, '2026-07-22', '7/22 date');
eq(day.weekdayKey, 'wed', '7/22 weekdayKey');
eq(day.weekdayLabel, 'Wednesday', '7/22 weekdayLabel');
eq(day.nth, 4, '7/22 is the 4th Wednesday');
eq(day.inYear, true, '7/22 inYear');
eq(day.isWeekend, false, '7/22 not weekend');
eq(day.residents.length, 24, '7/22 all 24 residents present');

// Surg 1–5
eq(day.surg['1'] && day.surg['1'].name, 'Cheng', 'Surg 1 = Cheng');
eq(day.surg['1'].am, true, 'Surg 1 am');
eq(day.surg['1'].pm, true, 'Surg 1 pm');
eq(day.surg['2'] && day.surg['2'].name, 'Calotti', 'Surg 2 = Calotti');
eq(day.surg['2'].am, true, 'Surg 2 am');
eq(day.surg['2'].pm, true, 'Surg 2 pm');
eq(day.surg['3'] && day.surg['3'].name, 'Aguwa', 'Surg 3 = Aguwa');
eq(day.surg['3'].am, true, 'Surg 3 AM only: am');
eq(day.surg['3'].pm, false, 'Surg 3 AM only: pm false');
eq(day.surg['3'].amText, 'Surg 3', 'Surg 3 amText');
eq(day.surg['3'].pmText, 'Cornea', 'Surg 3 pmText = Cornea');
eq(day.surg['4'] && day.surg['4'].name, 'Bair', 'Surg 4 = Bair');
eq(day.surg['4'].am, true, 'Surg 4 AM only: am');
eq(day.surg['4'].pm, false, 'Surg 4 AM only: pm false');
eq(day.surg['4'].pmText, 'Glaucoma', 'Surg 4 pmText = Glaucoma');
eq(day.surg['5'] && day.surg['5'].name, 'Wibbelsman', 'Surg 5 = Wibbelsman');
eq(day.surg['5'].am, true, 'Surg 5 am');
eq(day.surg['5'].pm, true, 'Surg 5 pm');
ok(!day.surg['6'], 'no Surg 6 on a Wednesday');

// Consults / float / WER
sameMembers(day.jeffConsults, ['Cotton'], 'jeffConsults');
sameMembers(day.cooperConsults, ['Illiano'], 'cooperConsults');
sameMembers(day.dayFloat, ['Tang'], 'dayFloat');
sameMembers(day.wer.am, ['Nahar', 'Hamou'], 'wer.am = Nahar+Hamou (order free)');
includes(day.wer.pm, 'Patel', 'wer.pm includes Patel');
sameMembers(day.wer.pm, ['Nahar', 'Hamou', 'Patel'], 'wer.pm full membership');

// Clinics
sameMembers(names(day.clinics['Cornea'] && day.clinics['Cornea'].pm),
  ['Momenaei', 'Williamson', 'Aguwa'], 'Cornea PM = Momenaei+Williamson+Aguwa');
sameMembers(names(day.clinics['Glaucoma'] && day.clinics['Glaucoma'].pm),
  ['Ransone', 'Bair'], 'Glaucoma PM = Ransone+Bair');
includes(names(day.clinics['Peds'] && day.clinics['Peds'].am), 'Parekh', 'Peds AM includes Parekh');
includes(names(day.clinics['Peds'] && day.clinics['Peds'].pm), 'Parekh', 'Peds PM includes Parekh');
sameMembers(names(day.clinics['Neuro'] && day.clinics['Neuro'].am),
  ['Teng', 'DeSimone'], 'Neuro AM = Teng+DeSimone');
includes(names(day.clinics['Plastics'] && day.clinics['Plastics'].pm), 'Marshall', 'Plastics PM includes Marshall');

// Clinic entries carry {name, year}
var corneaPM = day.clinics['Cornea'].pm;
ok(corneaPM.every(function (e) { return e.name && e.year; }), 'clinic entries are {name, year} objects');
eq(corneaPM.filter(function (e) { return e.name === 'Momenaei'; })[0].year, 'pgy2', 'Momenaei is pgy2 in Cornea PM');

// Exclusions from clinics
ok(!day.clinics['CPEC'], 'clinics excludes CPEC');
ok(!day.clinics['ER'], 'clinics excludes ER');
ok(!day.clinics['Jeff Consults'], 'clinics excludes Jeff Consults');
ok(!day.clinics['Cooper Consults'], 'clinics excludes Cooper Consults');
ok(!day.clinics['Day Float'], 'clinics excludes Day Float');
ok(!day.clinics['Surg 1'], 'clinics excludes Surg N');
ok(!Object.keys(day.clinics).some(function (k) { return /\bOR\b/.test(k); }), 'no OR-type keys in clinics');
ok(day.clinics['Private Cornea'] && names(day.clinics['Private Cornea'].am).indexOf('Williamson') !== -1,
  'Private Cornea kept as its own clinic key (Williamson AM)');

// OR blocks: Camacho (pgy3 block 5) Wed PM → Plastics OR only because it is the 4th Wednesday
includes(names(day.orBlocks['Plastics OR'] && day.orBlocks['Plastics OR'].pm), 'Camacho',
  'orBlocks[Plastics OR].pm includes Camacho (4th-Wed override)');
includes(names(day.orBlocks['Peds OR'] && day.orBlocks['Peds OR'].am), 'Momenaei',
  'orBlocks[Peds OR].am includes Momenaei');
var camacho = byName(day, 'Camacho');
eq(camacho.pm.text, 'Plastics OR', 'Camacho pm text = Plastics OR on 4th Wed');
includes(camacho.pm.notes, 'Plastics OR the 4th Wednesday', 'Camacho pm note from override');
ok(names(day.clinics['Plastics'] && day.clinics['Plastics'].pm).indexOf('Camacho') === -1,
  'Camacho not in Plastics clinic when overridden to OR');

// Samuel (pgy4 block 4) Wed = Retina both sessions
var samuel = byName(day, 'Samuel');
eq(samuel.am.text, 'Retina', 'Samuel Wed AM = Retina');
eq(samuel.pm.text, 'Retina', 'Samuel Wed PM = Retina');

// Taskmasters (pgy2 blocks 2 & 5)
sameMembers(day.taskmasters, ['Hamou', 'Ransone'], 'taskmasters = Hamou & Ransone');
var hamou = byName(day, 'Hamou');
eq(hamou.taskmaster, true, 'Hamou flagged taskmaster');
eq(byName(day, 'Cheng').taskmaster, false, 'Cheng not taskmaster');

// Note-only override still applies (pgy2 block 1 Wed AM: Benson note, no set on non-1st Wed)
var illiano = byName(day, 'Illiano');
eq(illiano.am.text, 'Cooper Consults', 'Illiano Wed AM base text kept (nth 4 ≠ 1st Wed)');
includes(illiano.am.notes, 'Benson if not seeing consults', 'Illiano note-only override applied');

// Special clinics: Bilyk Wed PM on 1st/3rd/4th → matches nth 4
includes(day.specialClinicsToday, 'Bilyk Clinic (PM)', 'specialClinicsToday has Bilyk Clinic (PM)');

// Resident row shape
var cheng = byName(day, 'Cheng');
eq(cheng.year, 'pgy4', 'Cheng year');
eq(cheng.yearLabel, 'PGY-4 (Third Year)', 'Cheng yearLabel');
eq(cheng.block, 1, 'Cheng block 1 on 7/22');
eq(cheng.am.text, 'Surg 1', 'Cheng am text');
ok(Array.isArray(cheng.am.notes), 'am.notes is an array');

/* ---------- override nth negatives: 3rd Wednesday 2026-08-19 (in year) ---------- */
var wed3 = Engine.resolveDay('2026-08-19', DATA);
eq(wed3.weekdayKey, 'wed', '8/19 is a Wednesday');
eq(wed3.nth, 3, '8/19 is the 3rd Wednesday');
eq(byName(wed3, 'Camacho').pm.text, 'Plastics', 'pgy3 block 5 Wed PM stays Plastics on non-4th Wed');
eq(byName(wed3, 'Momenaei').am.text, 'Stadium OR (Abendroth)', 'pgy2 block 3 Wed AM = Abendroth on 3rd Wed');
// pgy4 block 4 (Bair after 8/10 rollover): Tabas cataracts 3rd Wednesday
eq(byName(wed3, 'Bair').am.text, 'Tabas Cataracts', 'Bair (pgy4 block 4) Wed AM = Tabas Cataracts on 3rd Wed');
eq(byName(wed3, 'Bair').pm.text, 'Tabas Cataracts', 'Bair Wed PM = Tabas Cataracts on 3rd Wed');

/* ---------- pgy2 block 4 Mon AM Oncology 1st/3rd/5th Mondays ---------- */
var mon3 = Engine.resolveDay('2026-07-20', DATA); // 3rd Monday
eq(mon3.weekdayKey, 'mon', '7/20 is a Monday');
eq(mon3.nth, 3, '7/20 is the 3rd Monday');
var patel3 = byName(mon3, 'Patel'); // pgy2 block 4
eq(patel3.block, 4, 'Patel is pgy2 block 4 on 7/20');
eq(patel3.am.text, 'Oncology', 'Patel Mon AM = Oncology on 3rd Monday');
includes(patel3.am.notes, 'Oncology 1st, 3rd, 5th Monday', 'Oncology override note attached');
eq(patel3.pm.text, 'ER', 'Patel Mon PM stays ER');

var mon4 = Engine.resolveDay('2026-07-27', DATA); // 4th Monday
eq(mon4.nth, 4, '7/27 is the 4th Monday');
eq(byName(mon4, 'Patel').am.text, 'Path', 'Patel Mon AM stays Path on 4th Monday');

/* ---------- pgy2 block 1: Cooper Clinic 1st Wednesday AM ---------- */
var wed1 = Engine.resolveDay('2026-08-05', DATA); // 1st Wednesday of August
eq(wed1.nth, 1, '8/5 is the 1st Wednesday');
var illiano1 = byName(wed1, 'Illiano'); // still block 1 through 8/30
eq(illiano1.am.text, 'Cooper Clinic', 'Illiano Wed AM = Cooper Clinic on 1st Wed');
includes(illiano1.am.notes, 'Cooper clinic 1st Wednesday AM', '1st-Wed override note');
includes(illiano1.am.notes, 'Benson if not seeing consults', 'note-only rule also appended');

/* ---------- months-restricted overrides (pgy2 block 6 Thu) ---------- */
var decThu3 = Engine.resolveDay('2026-12-17', DATA); // 3rd Thu of December; pgy2 block 6 = Momenaei
eq(decThu3.nth, 3, '12/17 is the 3rd Thursday');
var momDec = byName(decThu3, 'Momenaei');
eq(momDec.block, 6, 'Momenaei is pgy2 block 6 in winter range');
eq(momDec.am.text, 'Carrasco Clinic', 'block 6 Thu AM = Carrasco Clinic 3rd Thu of Dec (months [12,2,4,6])');
ok(momDec.am.text !== 'Stadium OR (Marous)', 'Jan/Mar/May/Jul Marous rule does NOT fire in December');
includes(momDec.am.notes, 'Bilyk Clinic when not in OR', 'unconditional Thu AM note still appended');

var marThu3 = Engine.resolveDay('2027-03-18', DATA); // 3rd Thu of March; pgy2 block 6 = Illiano
eq(marThu3.nth, 3, '3/18/27 is the 3rd Thursday');
var illMar = byName(marThu3, 'Illiano');
eq(illMar.block, 6, 'Illiano is pgy2 block 6 in Mar range');
eq(illMar.am.text, 'Stadium OR (Marous)', 'block 6 Thu AM = Marous 3rd Thu of March (months [1,3,5,7])');
eq(illMar.pm.text, 'Stadium OR (Marous)', 'block 6 Thu PM = Marous 3rd Thu of March');

/* ---------- Surg 6: pgy3 block 6 Thursday ---------- */
// 2026-07-23 is a Thursday; pgy3 block 6 = Perez in the first range
var thu = Engine.resolveDay('2026-07-23', DATA);
eq(thu.weekdayKey, 'thu', '7/23 is a Thursday');
eq(thu.surg['6'] && thu.surg['6'].name, 'Perez', 'Surg 6 = Perez (pgy3 block 6 Thu)');
eq(thu.surg['6'].am, true, 'Surg 6 am');
eq(thu.surg['6'].pm, true, 'Surg 6 pm');

/* ---------- block boundary: 2026-07-20 (first day) ---------- */
var d0720 = Engine.resolveDay('2026-07-20', DATA);
eq(d0720.inYear, true, '7/20 inYear');
eq(byName(d0720, 'Bair').block, 3, '7/20 Bair block 3');
eq(byName(d0720, 'Aguwa').block, 6, '7/20 Aguwa block 6');
eq(byName(d0720, 'Cheng').block, 1, '7/20 Cheng block 1');
eq(byName(d0720, 'Calotti').block, 8, '7/20 Calotti block 8');
eq(byName(d0720, 'Ransone').block, 5, '7/20 Ransone block 5 (pgy2)');
eq(byName(d0720, 'DeSimone').block, 8, '7/20 DeSimone block 8 (pgy3)');

/* ---------- block boundary: 2026-08-10 pgy4 rollover ---------- */
var d0810 = Engine.resolveDay('2026-08-10', DATA);
eq(byName(d0810, 'Bair').block, 4, '8/10 Bair rolled to block 4');
eq(byName(d0810, 'Calotti').block, 1, '8/10 Calotti block 1');
eq(byName(d0810, 'Cheng').block, 2, '8/10 Cheng block 2');
eq(byName(d0810, 'Ransone').block, 5, '8/10 Ransone unchanged (pgy2 range runs to 8/30)');
// Day before the rollover still uses the old range
var d0809 = Engine.resolveDay('2026-08-07', DATA); // Friday before 8/10
eq(byName(d0809, 'Bair').block, 3, '8/7 Bair still block 3');

/* ---------- winter range 2026-11-23 .. 2027-01-17 ---------- */
var w1 = Engine.resolveDay('2026-11-23', DATA); // Monday, start of winter range
eq(w1.weekdayKey, 'mon', '11/23 is a Monday');
eq(byName(w1, 'Ransone').block, 8, '11/23 Ransone block 8 (pgy2 winter)');
eq(byName(w1, 'Hamou').block, 5, '11/23 Hamou block 5');
eq(byName(w1, 'Perez').block, 1, '11/23 Perez block 1 (pgy3 winter)');
eq(byName(w1, 'Bair').block, 1, '11/23 Bair block 1 (pgy4 winter first half)');
sameMembers(w1.taskmasters, ['Teng', 'Hamou'], '11/23 taskmasters: Teng (block 2) + Hamou (block 5)');

var w2 = Engine.resolveDay('2026-12-16', DATA); // Wednesday, pgy4 second winter sub-range
eq(byName(w2, 'Ransone').block, 8, '12/16 pgy2 range spans whole winter');
eq(byName(w2, 'Bair').block, 2, '12/16 Bair block 2 (pgy4 rolled 12/14)');
eq(byName(w2, 'Djulbegovic').block, 1, '12/16 Djulbegovic block 1');

var w3 = Engine.resolveDay('2027-01-15', DATA); // Friday, near end of winter range
eq(w3.inYear, true, '1/15/27 inYear');
eq(byName(w3, 'Ransone').block, 8, '1/15 Ransone still block 8');
eq(byName(w3, 'Bair').block, 2, '1/15 Bair still block 2 (range ends 1/17)');
// First weekday after the winter range
var w4 = Engine.resolveDay('2027-01-18', DATA); // Monday, new ranges begin
eq(byName(w4, 'Ransone').block, 1, '1/18 Ransone rolled to block 1');
eq(byName(w4, 'Bair').block, 3, '1/18 Bair rolled to block 3');

/* ---------- 2027-06-30: last day of the academic year ---------- */
var last = Engine.resolveDay('2027-06-30', DATA);
eq(last.inYear, true, '6/30/27 inYear (last day)');
eq(last.isWeekend, false, '6/30/27 is a weekday (Wed)');
eq(last.weekdayKey, 'wed', '6/30/27 weekdayKey');
eq(last.residents.length, 24, '6/30/27 full roster resolves');
eq(byName(last, 'Bair').block, 2, '6/30/27 Bair block 2 (final pgy4 range)');
eq(byName(last, 'Cheng').block, 8, '6/30/27 Cheng block 8');
eq(byName(last, 'Hamou').block, 1, '6/30/27 Hamou block 1 (final pgy2 range)');
// Day after the year ends
eq(Engine.resolveDay('2027-07-01', DATA).inYear, false, '7/1/27 out of year');

/* ---------- weekend: 2026-07-18 (Saturday) ---------- */
var sat = Engine.resolveDay('2026-07-18', DATA);
eq(sat.isWeekend, true, '7/18 isWeekend');
eq(sat.weekdayKey, 'sat', '7/18 weekdayKey sat');
eq(sat.residents.length, 0, 'weekend: residents empty');
eq(Object.keys(sat.surg).length, 0, 'weekend: surg empty');
eq(sat.wer.am.length + sat.wer.pm.length, 0, 'weekend: wer empty');
eq(sat.jeffConsults.length, 0, 'weekend: jeffConsults empty');
eq(sat.cooperConsults.length, 0, 'weekend: cooperConsults empty');
eq(sat.dayFloat.length, 0, 'weekend: dayFloat empty');
eq(sat.taskmasters.length, 0, 'weekend: taskmasters empty');
eq(Object.keys(sat.clinics).length, 0, 'weekend: clinics empty');
eq(Object.keys(sat.orBlocks).length, 0, 'weekend: orBlocks empty');
eq(sat.specialClinicsToday.length, 0, 'weekend: specialClinicsToday empty');

/* ---------- out of year: 2026-07-01 ---------- */
var pre = Engine.resolveDay('2026-07-01', DATA);
eq(pre.inYear, false, '7/1/26 inYear false');
eq(pre.isWeekend, false, '7/1/26 is a weekday (Wed)');
eq(pre.residents.length, 0, 'out-of-year: residents empty');
eq(Object.keys(pre.surg).length, 0, 'out-of-year: surg empty');
eq(Object.keys(pre.clinics).length, 0, 'out-of-year: clinics empty');

/* ---------- data fallback: resolveDay without explicit data (Node require) ---------- */
var fb = Engine.resolveDay('2026-07-22');
eq(fb.surg['1'] && fb.surg['1'].name, 'Cheng', 'data fallback works in Node (require ./data.js)');

/* ---------- Cooper buddy call (UISPEC2 section A) ---------- */
// 2026-07-22 (Wed, named range 1)
var bd1 = Engine.resolveDay('2026-07-22', DATA);
ok(bd1.cooperBuddies && typeof bd1.cooperBuddies === 'object', 'buddy: cooperBuddies present on 7/22');
eq(bd1.cooperBuddies.am, 'Camacho', 'buddy 7/22: am = Camacho (range 1 Wed)');
eq(bd1.cooperBuddies.pm, 'DeSimone', 'buddy 7/22: pm = DeSimone (range 1 Wed)');
eq(bd1.cooperBuddies.templateAM, 'Private Glaucoma', 'buddy 7/22: templateAM = Private Glaucoma');
eq(bd1.cooperBuddies.templatePM, 'Retina', 'buddy 7/22: templatePM = Retina');

// 2026-08-13 (Thu, named range 2 — Thu PM differs from range 1)
var bd2 = Engine.resolveDay('2026-08-13', DATA);
eq(bd2.weekdayKey, 'thu', 'buddy 8/13: is a Thursday');
eq(bd2.cooperBuddies.am, 'Nahar', 'buddy 8/13: am = Nahar (range 2 Thu)');
eq(bd2.cooperBuddies.pm, 'Aguwa', 'buddy 8/13: pm = Aguwa (range 2 Thu PM differs)');
eq(bd2.cooperBuddies.templateAM, 'Cooper', 'buddy 8/13: templateAM = Cooper');
eq(bd2.cooperBuddies.templatePM, 'Cooper (PGY-4)', 'buddy 8/13: templatePM = Cooper (PGY-4)');

// 2026-09-02 (Wed, in year but after the last named range): names null, templates populated
var bd3 = Engine.resolveDay('2026-09-02', DATA);
eq(bd3.weekdayKey, 'wed', 'buddy 9/2: is a Wednesday');
eq(bd3.inYear, true, 'buddy 9/2: inYear');
eq(bd3.cooperBuddies.am, null, 'buddy 9/2: am null (no named range)');
eq(bd3.cooperBuddies.pm, null, 'buddy 9/2: pm null (no named range)');
eq(bd3.cooperBuddies.templateAM, 'Private Glaucoma', 'buddy 9/2: templateAM still populated');
eq(bd3.cooperBuddies.templatePM, 'Retina', 'buddy 9/2: templatePM still populated');

// Weekend: all null
var bdSat = Engine.resolveDay('2026-07-18', DATA);
ok(bdSat.cooperBuddies && typeof bdSat.cooperBuddies === 'object', 'buddy weekend: cooperBuddies key exists');
eq(bdSat.cooperBuddies.am, null, 'buddy weekend: am null');
eq(bdSat.cooperBuddies.pm, null, 'buddy weekend: pm null');
eq(bdSat.cooperBuddies.templateAM, null, 'buddy weekend: templateAM null');
eq(bdSat.cooperBuddies.templatePM, null, 'buddy weekend: templatePM null');

// Out of year: all null
var bdPre = Engine.resolveDay('2026-07-01', DATA);
eq(bdPre.cooperBuddies.am, null, 'buddy out-of-year: am null');
eq(bdPre.cooperBuddies.pm, null, 'buddy out-of-year: pm null');
eq(bdPre.cooperBuddies.templateAM, null, 'buddy out-of-year: templateAM null');
eq(bdPre.cooperBuddies.templatePM, null, 'buddy out-of-year: templatePM null');

/* ---------- CPEC surgical block sheet (UISPEC3 section A) ---------- */
ok(typeof Engine.cpecForDate === 'function', 'Engine.cpecForDate is a function');
ok(DATA.cpecSheet && typeof DATA.cpecSheet === 'object', 'data has cpecSheet');
eq(DATA.cpecSheet.label, 'CPEC Surgical Block Schedule', 'cpecSheet label');
eq(DATA.cpecSheet.effective, '2026-05-01', 'cpecSheet effective 2026-05-01');
eq(DATA.cpecSheet.legend && DATA.cpecSheet.legend.surg1, 'Surg 1', 'cpecSheet legend surg1');
eq(DATA.cpecSheet.legend && DATA.cpecSheet.legend.retina, 'Retina Resident', 'cpecSheet legend retina');
ok(DATA.cpecSheet.entries && [1, 2, 3, 4, 5].every(function (n) { return DATA.cpecSheet.entries[n]; }),
  'cpecSheet entries has rows 1..5');

function cpecAttendings(res) {
  return (res.entries || []).map(function (e) { return e.attending; });
}
function cpecEntry(res, attending) {
  for (var i = 0; i < res.entries.length; i++) {
    if (res.entries[i].attending === attending) return res.entries[i];
  }
  return null;
}

// 2026-07-22 — 4th Wednesday: Markovitz 1:00 surg1 + Ang private-only, NOT Pyfer
var cp1 = Engine.cpecForDate('2026-07-22', DATA);
eq(cp1.nth, 4, 'cpec 7/22: nth 4');
eq(cp1.weekdayKey, 'wed', 'cpec 7/22: weekdayKey wed');
eq(cp1.entries.length, 2, 'cpec 7/22: exactly 2 entries (4th Wed)');
var cpMark = cpecEntry(cp1, 'Markovitz');
ok(cpMark, 'cpec 7/22: Markovitz present');
eq(cpMark && cpMark.time, '1:00', 'cpec 7/22: Markovitz time 1:00');
eq(cpMark && cpMark.count, 3, 'cpec 7/22: Markovitz count 3');
eq(cpMark && cpMark.cover, 'surg1', 'cpec 7/22: Markovitz cover surg1');
eq(cpMark && cpMark.privateOnly, false, 'cpec 7/22: Markovitz not private-only');
var cpAng = cpecEntry(cp1, 'Ang');
ok(cpAng, 'cpec 7/22: Ang present');
eq(cpAng && cpAng.privateOnly, true, 'cpec 7/22: Ang private-only');
eq(cpAng && cpAng.cover, null, 'cpec 7/22: Ang cover null (private only)');
eq(cpAng && cpAng.site, 'SP', 'cpec 7/22: Ang site SP (Stadium)');
eq(cpAng && cpAng.time, '7:30', 'cpec 7/22: Ang time 7:30');
eq(cpAng && cpAng.count, 12, 'cpec 7/22: Ang count 12');
ok(cpecAttendings(cp1).indexOf('Pyfer') === -1, 'cpec 7/22: NOT Pyfer (Pyfer is 4th Thu, not 4th Wed)');

// 2026-07-15 — 3rd Wednesday, July (month 7, odd): Brown + Galiani + Tabas (retina)
// + Derham; Williams excluded (even months only)
var cp2 = Engine.cpecForDate('2026-07-15', DATA);
eq(cp2.nth, 3, 'cpec 7/15: nth 3');
eq(cp2.weekdayKey, 'wed', 'cpec 7/15: weekdayKey wed');
sameMembers(cpecAttendings(cp2), ['Brown', 'Galiani', 'Tabas', 'Derham'],
  'cpec 7/15: Brown+Galiani+Tabas+Derham (Williams excluded in odd month)');
ok(cpecAttendings(cp2).indexOf('Williams') === -1, 'cpec 7/15: Williams excluded (even months only)');
var cpGal = cpecEntry(cp2, 'Galiani');
eq(cpGal && cpGal.cover, 'surg1', 'cpec 7/15: Galiani cover surg1');
eq(cpGal && cpGal.time, '1:00', 'cpec 7/15: Galiani time 1:00');
var cpTabas = cpecEntry(cp2, 'Tabas');
eq(cpTabas && cpTabas.cover, 'retina', 'cpec 7/15: Tabas cover retina');
eq(cpTabas && cpTabas.time, 'AM TF', 'cpec 7/15: Tabas time AM TF');
var cpDerham = cpecEntry(cp2, 'Derham');
eq(cpDerham && cpDerham.cover, 'surg5', 'cpec 7/15: Derham cover surg5');
eq(cpDerham && cpDerham.time, '9:30', 'cpec 7/15: Derham time 9:30');
eq(cpDerham && cpDerham.site, 'SP', 'cpec 7/15: Derham site SP');
eq(cpDerham && cpDerham.count, 11, 'cpec 7/15: Derham count 11');

// 2026-08-19 — 3rd Wednesday, August (month 8, even): Williams yes, Galiani no
var cp3 = Engine.cpecForDate('2026-08-19', DATA);
eq(cp3.nth, 3, 'cpec 8/19: nth 3');
ok(cpecAttendings(cp3).indexOf('Williams') !== -1, 'cpec 8/19: Williams included (even month)');
ok(cpecAttendings(cp3).indexOf('Galiani') === -1, 'cpec 8/19: Galiani excluded (odd months only)');
sameMembers(cpecAttendings(cp3), ['Brown', 'Williams', 'Tabas', 'Derham'],
  'cpec 8/19: Brown+Williams+Tabas+Derham');

// 2026-07-06 — 1st Monday: Harris surg5 + Davis willsOR
var cp4 = Engine.cpecForDate('2026-07-06', DATA);
eq(cp4.nth, 1, 'cpec 7/6: nth 1');
eq(cp4.weekdayKey, 'mon', 'cpec 7/6: weekdayKey mon');
eq(cp4.entries.length, 2, 'cpec 7/6: exactly 2 entries (1st Mon)');
var cpHarris = cpecEntry(cp4, 'Harris');
eq(cpHarris && cpHarris.cover, 'surg5', 'cpec 7/6: Harris cover surg5');
eq(cpHarris && cpHarris.site, 'SP', 'cpec 7/6: Harris site SP');
eq(cpHarris && cpHarris.count, 2, 'cpec 7/6: Harris count 2');
var cpDavis = cpecEntry(cp4, 'Davis');
eq(cpDavis && cpDavis.cover, 'willsOR', 'cpec 7/6: Davis cover willsOR');
eq(cpDavis && cpDavis.note, '2 private / 6 service', 'cpec 7/6: Davis note 2 private / 6 service');
eq(cpDavis && cpDavis.count, 8, 'cpec 7/6: Davis count 8 (2 prvt + 6 svc)');

// Weekend → empty entries
var cpSat = Engine.cpecForDate('2026-07-18', DATA); // Saturday
eq(cpSat.weekdayKey, 'sat', 'cpec weekend: weekdayKey sat');
eq(cpSat.entries.length, 0, 'cpec weekend: entries empty');
eq(Engine.cpecForDate('2026-07-19', DATA).entries.length, 0, 'cpec Sunday: entries empty');

// Before the sheet's effective date (2026-05-01) → empty entries
var cpPre = Engine.cpecForDate('2026-04-29', DATA); // Wednesday before effective
eq(cpPre.weekdayKey, 'wed', 'cpec pre-effective: weekdayKey wed');
eq(cpPre.entries.length, 0, 'cpec pre-effective: entries empty before 2026-05-01');

// After the academic year ends (ayEnd 2027-06-30) → empty entries: the sheet
// prints no end date, so its window closes with the year (§A "out-of-year").
eq(Engine.cpecForDate('2027-06-30', DATA).entries.length, 2,
  'cpec ayEnd itself (2027-06-30, 5th Wed): still applies — Cutney + Markovitz');
var cpPost = Engine.cpecForDate('2027-07-07', DATA); // Wednesday after ayEnd
eq(cpPost.weekdayKey, 'wed', 'cpec post-ayEnd: weekdayKey wed');
eq(cpPost.entries.length, 0, 'cpec post-ayEnd: entries empty after 2027-06-30');
eq(Engine.cpecForDate('2030-01-02', DATA).entries.length, 0,
  'cpec far future: entries empty');

// Data fallback (no explicit data argument) works in Node
eq(Engine.cpecForDate('2026-07-22').entries.length, 2, 'cpec data fallback works in Node');

/* ---------- CPEC cover → covering resident (UISPEC3 section D) ---------- */
ok(typeof Engine.cpecCoverName === 'function', 'Engine.cpecCoverName is a function');

var cov0722 = Engine.resolveDay('2026-07-22', DATA); // 4th Wednesday
eq(Engine.cpecCoverName(cov0722, 'surg1'), 'Cheng', 'cover 7/22: surg1 → Cheng');
eq(Engine.cpecCoverName(cov0722, 'surg5'), 'Wibbelsman', 'cover 7/22: surg5 → Wibbelsman');
eq(Engine.cpecCoverName(cov0722, 'retina'), 'Samuel',
  'cover 7/22: retina → Samuel (pgy4 on Retina, normal Wednesday)');

// willsOR: first person on the Wills OR block (1st Monday, pgy4 block 7)
eq(Engine.cpecCoverName(Engine.resolveDay('2026-08-03', DATA), 'willsOR'), 'Shields',
  'cover 8/3 (Mon): willsOR → Shields');

// 3rd Wednesday — the ONLY day the sheet uses the retina cover (Tabas AM TF).
// The pgy4 block-4 override moves the retina resident to 'Tabas Cataracts'
// that day, so clinics['Retina'] holds no pgy4 — the cover must resolve from
// the block's actual grouping, not the clinic label.
var cov0819 = Engine.resolveDay('2026-08-19', DATA);
ok(!((cov0819.clinics['Retina'] || {}).am || [])
  .concat((cov0819.clinics['Retina'] || {}).pm || [])
  .some(function (p) { return p.year === 'pgy4'; }),
  'cover 8/19 (3rd Wed): clinics.Retina has no pgy4 (moved to Tabas Cataracts)');
eq(Engine.cpecCoverName(cov0819, 'retina'), 'Bair',
  'cover 8/19 (3rd Wed): retina → Bair via Tabas Cataracts');

// Unknown cover / empty roster stay safe
eq(Engine.cpecCoverName(cov0722, null), '', 'cover: null cover → empty string');
eq(Engine.cpecCoverName({}, 'retina'), '', 'cover: empty roster → empty string');

/* ---------- Night Float + day-float coverage (UISPEC5 section A) ---------- */
ok(DATA.nfSchedule && typeof DATA.nfSchedule === 'object', 'data has nfSchedule');
ok(Array.isArray(DATA.nfSchedule.ranges), 'nfSchedule.ranges is an array');
eq(DATA.nfSchedule.ranges.length, 14, 'nfSchedule has 14 weekly ranges');
eq(DATA.nfSchedule.ranges[0].start, '2026-07-13', 'nfSchedule first range starts 7/13');
eq(DATA.nfSchedule.ranges[0].name, 'Cotton', 'nfSchedule first range = Cotton');
eq(DATA.nfSchedule.ranges[13].end, '2026-10-25', 'nfSchedule last range ends 10/25');

// 2026-07-22 (Wed): Perez on NF (7/20–7/26 week); Perez = pgy3 block 6 →
// Wed cells CPEC/CPEC; Tang is the Day Float covering the daytime duties.
var nf1 = Engine.resolveDay('2026-07-22', DATA);
eq(nf1.nightFloat, 'Perez', 'NF 7/22: nightFloat = Perez');
ok(nf1.dayFloatCoverage && typeof nf1.dayFloatCoverage === 'object', 'NF 7/22: dayFloatCoverage present');
eq(nf1.dayFloatCoverage.nf, 'Perez', 'NF 7/22: dayFloatCoverage.nf = Perez');
eq(nf1.dayFloatCoverage.nfDuties.am, 'CPEC', 'NF 7/22: nfDuties.am = CPEC (Perez pgy3 block 6 Wed)');
eq(nf1.dayFloatCoverage.nfDuties.pm, 'CPEC', 'NF 7/22: nfDuties.pm = CPEC');
sameMembers(nf1.dayFloatCoverage.coveredBy, ['Tang'], 'NF 7/22: coveredBy = [Tang]');

// 2026-08-10 (Mon): Tang on NF — who IS the Day Float that block; coveredBy
// [Tang] still fine, nfDuties are Tang's own cells (Day Float / Day Float).
var nf2 = Engine.resolveDay('2026-08-10', DATA);
eq(nf2.nightFloat, 'Tang', 'NF 8/10: nightFloat = Tang');
ok(nf2.dayFloatCoverage && typeof nf2.dayFloatCoverage === 'object', 'NF 8/10: dayFloatCoverage present');
eq(nf2.dayFloatCoverage.nf, 'Tang', 'NF 8/10: dayFloatCoverage.nf = Tang');
eq(nf2.dayFloatCoverage.nfDuties.am, 'Day Float', 'NF 8/10: nfDuties.am = Day Float (Tang pgy3 block 7 Mon)');
eq(nf2.dayFloatCoverage.nfDuties.pm, 'Day Float', 'NF 8/10: nfDuties.pm = Day Float');
sameMembers(nf2.dayFloatCoverage.coveredBy, ['Tang'], 'NF 8/10: coveredBy = [Tang] (NF is the day float)');

// 2026-09-02 (Wed, in year): the 8/31–9/6 week is not filled in the sheet.
var nf3 = Engine.resolveDay('2026-09-02', DATA);
eq(nf3.inYear, true, 'NF 9/2: inYear');
eq(nf3.nightFloat, null, 'NF 9/2: nightFloat null (week not filled)');
eq(nf3.dayFloatCoverage, null, 'NF 9/2: dayFloatCoverage null (week not filled)');

// 2026-11-04 (Wed, in year): past the last listed range (later weeks TBD).
var nf4 = Engine.resolveDay('2026-11-04', DATA);
eq(nf4.inYear, true, 'NF 11/4: inYear');
eq(nf4.nightFloat, null, 'NF 11/4: nightFloat null (week TBD)');
eq(nf4.dayFloatCoverage, null, 'NF 11/4: dayFloatCoverage null (week TBD)');

// Weekend: 2026-07-25 (Sat) falls inside the Perez range but stays null.
var nfSat = Engine.resolveDay('2026-07-25', DATA);
eq(nfSat.isWeekend, true, 'NF weekend: 7/25 isWeekend');
eq(nfSat.nightFloat, null, 'NF weekend: nightFloat null');
eq(nfSat.dayFloatCoverage, null, 'NF weekend: dayFloatCoverage null');

// Out-of-year: 2026-07-15 (Wed) sits inside the 7/13–7/19 Cotton range but
// precedes ayStart, so both stay null.
var nfPre = Engine.resolveDay('2026-07-15', DATA);
eq(nfPre.inYear, false, 'NF out-of-year: 7/15 inYear false');
eq(nfPre.nightFloat, null, 'NF out-of-year: nightFloat null');
eq(nfPre.dayFloatCoverage, null, 'NF out-of-year: dayFloatCoverage null');

// Null-safe when nfSchedule is absent from the data object entirely.
var noNfData = {};
Object.keys(DATA).forEach(function (k) { if (k !== 'nfSchedule') noNfData[k] = DATA[k]; });
var nf5 = Engine.resolveDay('2026-07-22', noNfData);
eq(nf5.nightFloat, null, 'NF absent nfSchedule: nightFloat null');
eq(nf5.dayFloatCoverage, null, 'NF absent nfSchedule: dayFloatCoverage null');
eq(nf5.surg['1'] && nf5.surg['1'].name, 'Cheng', 'NF absent nfSchedule: rest of resolveDay unaffected');

/* ---------- summary ---------- */
console.log(checks + ' checks, ' + failures + ' failure(s)');
if (failures > 0) {
  process.exit(1);
}
console.log('OK');
