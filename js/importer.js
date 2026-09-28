/*
 * importer.js — read a sent schedule back into a day.
 * window.ImportFmt in the browser; module.exports in Node. Pure (no DOM).
 *
 * Why: the Surg 2 who builds tomorrow's schedule is often not tomorrow's
 * Surg 2, and each browser keeps its own drafts. Pasting the schedule that
 * was sent gives the next person's app the day, so live coverage (who is
 * free, who backs up whom, clinic gaps) works for them too.
 *
 * Reads both the app's own copied format and the hand-typed one in use,
 * e.g. (9/21/2026):
 *   - Abendroth x 7 (7:30AM start, service x 4 start @ 9:15AM): Cheng
 *   - Bedrossian x 3 (all service, 7:30AM start): Nahar
 *   - Marous x 2 (CC'd)                       CC'd = cross-checked, no service cases
 *   -Cornea PM (Meghpara, 28 x 2): Parekh, Bair + 1 procedure @ 12:30 (Bair)
 *   -Neuro AM/PM (Sergott): Marshall
 *   - Samuel (Wills OR AM) c/b n/c
 *   - Ransone (CPEC/Plastics) c/b Patel AM (Uveitis)/NC d/s PM
 * with or without **bold** markers, bullets, en/em dashes, blank lines.
 *
 * parse(text, ctx)  → what the text says, plus the lines it could not read.
 *                     ctx.names = roster names; ctx.clinics = { label: { am, pm } }
 * toDay(parsed, base, roster, data, exportFmt, opts) → a day state on `base`
 * diffLines(a, b)   → lines of `a` missing from `b` and vice versa
 *
 * The case type is not in the text: inferCategory guesses it (listed to the
 * user before loading).
 */
(function () {
  'use strict';

  function trim(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }

  // A pasted line as plain text: no bold markers, no odd spaces.
  function clean(line) {
    return String(line == null ? '' : line)
      .replace(/\*\*/g, '')
      .replace(/[   \t]/g, ' ')
      .replace(/[​﻿️]/g, '')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  // For comparing: also fold dashes, bullets and 'x 7' spacing.
  function norm(line) {
    return clean(line)
      .replace(/^[•·*–—]\s*/, '-')
      .replace(/\s[–—]\s/g, ' - ')
      .replace(/^-\s+/, '-')
      .replace(/\sx\s+(\d)/gi, ' x$1')
      .toLowerCase();
  }

  var HEADS = [
    [/^lectures?\s*(?:\/|&|and)\s*events?:?$/i, 'lectures'],
    [/^(?:lectures?|events?):?$/i, 'lectures'],
    [/^assignments:?$/i, 'assignments'],
    [/^wills\s*\/\s*asc:?$/i, 'wills'],
    [/^(?:wills|asc):?$/i, 'wills'],
    [/^privates?:?$/i, 'private'],
    [/^jhn\s*\/\s*tjuh\s*\/\s*jsc:?$/i, 'jhn'],
    [/^other\s*\(\s*stadium\s*\/\s*cherry\s*hill\s*\):?$/i, 'other'],
    [/^(?:stadium\s*\/\s*cherry\s*hill|stadium|cherry\s*hill):?$/i, 'other'],
    [/^clinics?:?$/i, 'clinics'],
    [/^(?:vacations?|vacation\s*\/\s*out|who'?s\s+out|out):?$/i, 'vacation'],
    [/^add[-\s]?ons?(?:\s*call)?:?$/i, 'addons']
  ];
  var CASE_SECTIONS = { wills: true, private: true, jhn: true, other: true };
  var REASONS = { sick: 'sick', conference: 'conference', out: 'other' };
  // Lines that belong to the schedule but hold nothing the app stores
  // (computed from the block schedule, or informational).
  var INFO_RE = /^(?:wer|jeff\s*consults?|cooper\s*consults?|day\s*float|taskmaster|cooper\s*buddies?|er|pt)\s*:/i;
  // Assignments that are not clinics (PT is free; ER/consults are duty).
  // CPEC is a clinic (chief, 9/28/2026).
  var NOT_CLINICS = { pt: true, er: true, wer: true, 'jeff consults': true, 'cooper consults': true, 'day float': true };

  function headOf(line) {
    for (var i = 0; i < HEADS.length; i++) if (HEADS[i][0].test(line)) return HEADS[i][1];
    return '';
  }

  // Longest roster name at the start of s (case-insensitive, whole word).
  function nameAt(s, names) {
    var low = s.toLowerCase();
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (low.slice(0, n.length) === n.toLowerCase()) {
        var next = s.charAt(n.length);
        if (!next || /[\s;,()|+/&:.]/.test(next)) return n;
      }
    }
    return '';
  }

  // A name at the start of s: a roster name, else the first word (flagged).
  function whoAt(s, names, unknownNames) {
    var n = nameAt(s, names);
    if (n) return { name: n, len: n.length };
    var m = /^([A-Za-z][A-Za-z'.-]*)/.exec(s);
    if (!m) return null;
    if (/^nc$/i.test(m[1])) return { name: 'NC', len: m[1].length };
    if (unknownNames.indexOf(m[1]) === -1) unknownNames.push(m[1]);
    return { name: m[1], len: m[1].length };
  }

  var TIME_ONLY = /^(?:\d{1,2}(?::?\d{2})?\s*(?:[ap]\.?m\.?)?|am\s*tf|pm)$/i;

  // how many times are listed: '1030 & 1300' → 2
  function timeCount(str) {
    return Math.max(1, (String(str).match(/\d{1,2}(?::?\d{2})?\s*(?:[ap]\.?m\.?)?/gi) || []).length);
  }
  var TIMES = /^(?:\d{1,2}(?::?\d{2})?\s*(?:[ap]\.?m\.?)?)(?:\s*(?:&|,|and)\s*\d{1,2}(?::?\d{2})?\s*(?:[ap]\.?m\.?)?)*$/i;

  /* ------------------------------------------------------------------ */
  /* one case line                                                       */
  /*   app:   Hark x1 (1300 start), x1 service - 1030 - Bair; Djulbegovic note (notes) */
  /*   typed: Abendroth x 7 (7:30AM start, service x 4 start @ 9:15AM): Cheng + note  */
  /* ------------------------------------------------------------------ */
  function parseCase(body, section, names, unknownNames) {
    if (/^none\.?$/i.test(body)) return { none: true };
    var c = {
      section: section, surgeon: '', count: 1, start: '', serviceCount: null, serviceTimes: '',
      assigned: '', backup: '', backupNote: '', notes: ''
    };
    var notes = [];
    var rest;
    var m = /^(.+?)\s+x\s*(\d+)\b(.*)$/i.exec(body);
    if (m) {
      c.surgeon = trim(m[1]);
      c.count = parseInt(m[2], 10);
      rest = m[3];
    } else {
      // no count ('Hark (1:00 start): Bair') — one case; needs a bracket or a resident
      var m2 = /^([^():]+?)\s*(\(.*|:.*|\s[-–—]\s.*)$/.exec(body);
      if (!m2) return null;
      c.surgeon = trim(m2[1]);
      rest = ' ' + m2[2];
    }
    // the bracket after the count: comma-separated facts
    var bm = /^\s*\(([^()]*)\)/.exec(rest);
    if (bm) {
      rest = rest.slice(bm[0].length);
      var svcNoTime = false; // '1 service' just read — a bare time next is its time
      bm[1].split(/\s*,\s*/).forEach(function (part) {
        part = trim(part);
        if (!part) return;
        var x;
        var afterSvc = svcNoTime;
        svcNoTime = false;
        if (/^all\s+service(?:\s+cases?)?$/i.test(part)) { c.serviceCount = c.count; return; }
        // 'service x 4 start @ 9:15AM', '4 service', 'x1 service at 1015' — a
        // count is one or two digits; '1015 service' is a time (below)
        if ((x = /^(?:service\s*x\s*(\d{1,2})|x?\s*(\d{1,2})\s+service(?:\s+cases?)?)(?:\s+start(?:s|ing)?)?(?:\s*(?:@|at)\s*(.+))?$/i.exec(part))) {
          c.serviceCount = parseInt(x[1] || x[2], 10);
          if (x[3]) c.serviceTimes = trim(x[3]);
          else svcNoTime = true;
          return;
        }
        // 'service case at 10:15AM', 'service @ 1030 & 1300' — one service
        // case per time
        if ((x = /^service(?:\s+cases?)?(?:\s+start(?:s|ing)?)?\s*(?:@|at)\s*(.+)$/i.exec(part)) && TIMES.test(trim(x[1]))) {
          c.serviceTimes = trim(x[1]);
          if (c.serviceCount == null) c.serviceCount = timeCount(x[1]);
          return;
        }
        // '10:15 service', '1015 service case' — service at that time
        if ((x = /^(.+?)\s+service(?:\s+cases?)?$/i.exec(part)) && TIMES.test(trim(x[1])) && !/^\d{1,2}$/.test(trim(x[1]))) {
          c.serviceTimes = trim(x[1]);
          if (c.serviceCount == null) c.serviceCount = timeCount(x[1]);
          return;
        }
        // '(1 service, 10:15AM)': a bare time right after the service count
        if (afterSvc && TIME_ONLY.test(part) && !/^(?:am\s*tf|pm)$/i.test(part)) { c.serviceTimes = part; return; }
        if ((x = /^(\d+)\s*private\s*\/\s*(\d+)\s*service$/i.exec(part))) { c.serviceCount = parseInt(x[2], 10); notes.push(part); return; }
        if (/^(?:cc'?d|cross[-\s]?checked|all\s+private|no\s+service(?:\s+cases?)?)$/i.test(part)) { c.serviceCount = 0; notes.push(part); return; }
        if ((x = /^(.+?)\s+start$/i.exec(part)) && !c.start) { c.start = trim(x[1]); return; }
        if (TIME_ONLY.test(part) && !c.start) { c.start = part; return; }
        notes.push(part);
      });
    }
    // app format: ', x1 service' outside the bracket
    var appSvc = /^\s*,\s*x\s*(\d+)\s+service\b/i.exec(rest);
    if (appSvc) { c.serviceCount = parseInt(appSvc[1], 10); rest = rest.slice(appSvc[0].length); }

    // who: after ':' (typed) or ' - ' (app); app format may put service times first
    rest = trim(rest);
    var who = '';
    if (rest.charAt(0) === ':') {
      who = trim(rest.slice(1));
    } else if (/^[-–—](?:\s|$)/.test(rest)) {
      var segs = (' ' + rest).split(/\s[-–—](?:\s|$)/);
      segs.shift();
      if (appSvc && segs.length > 1 && TIMES.test(trim(segs[0]))) c.serviceTimes = trim(segs.shift());
      who = trim(segs.join(' - '));
    } else if (rest) {
      var extra = /^\(([^()]*)\)$/.exec(rest);
      if (!extra) return null; // text we cannot place
      notes.push(extra[1]);
    }
    if (!c.surgeon) return null;

    var marked = false; // '⚠ UNASSIGNED' / 'TBD' printed → a service case with nobody yet
    if (who) {
      var um = /^(?:⚠\s*)?(?:unassigned|tbd|none|\?+)\b\s*(.*)$/i.exec(who);
      var tail = '';
      if (um) {
        marked = true;
        tail = trim(um[1]);
      } else {
        var a = whoAt(who, names, unknownNames);
        if (!a) return null;
        c.assigned = a.name;
        var r = trim(who.slice(a.len));
        if (r.charAt(0) === ';') { // app format: 'Bair; Djulbegovic to cover cornea clinic …'
          r = trim(r.slice(1));
          var b = whoAt(r, names, unknownNames);
          if (b) { c.backup = b.name; r = trim(r.slice(b.len)); }
          c.backupNote = r;
          r = '';
        } else if (/^[+,&/]/.test(r)) { // '+ 1 add-on, timing TBD'
          notes.push(r);
          r = '';
        }
        tail = r;
      }
      if (tail) {
        var pm = /^(.*?)\s*\(([^()]*)\)$/.exec(tail);
        if (pm) {
          if (trim(pm[1])) {
            if (c.assigned) c.backupNote = trim(pm[1]);
            else notes.push(trim(pm[1]));
          }
          notes.push(pm[2]);
        } else if (c.assigned) {
          c.backupNote = tail;
        } else {
          notes.push(tail);
        }
      }
    }
    // '(no Peds OR; backup: Calotti if after 1 PM)'
    var keep = [];
    notes.join('; ').split(/\s*;\s*/).forEach(function (it) {
      it = trim(it);
      if (!it) return;
      var bk = /^backup:\s*(.*)$/i.exec(it);
      if (bk && !c.backup) {
        var bw = whoAt(trim(bk[1]), names, unknownNames);
        if (bw) { c.backup = bw.name; c.backupNote = trim(trim(bk[1]).slice(bw.len)); return; }
      }
      keep.push(it);
    });
    c.notes = keep.join('; ');
    if (c.serviceCount == null) c.serviceCount = (c.assigned || marked) ? c.count : 0;
    return c;
  }

  /* ------------------------------------------------------------------ */
  /* one Vacation line                                                   */
  /*   Ransone (CPEC/Plastics) c/b Patel AM (Uveitis) | Hamou PM (CPEC)  */
  /*   Ransone (CPEC/Plastics) c/b Patel AM (Uveitis)/NC d/s PM          */
  /*   Samuel (Wills OR AM) c/b n/c · Tang PM (Retina) — sick NC         */
  /* ------------------------------------------------------------------ */
  function parseAbsence(line, names) {
    var name = nameAt(line, names);
    if (!name) return null;
    var rest = trim(line.slice(name.length));
    var a = { name: name, am: true, pm: true, reason: 'vacation', coverAM: '', coverPM: '' };
    var marked = false;
    var hm = /^(AM|PM)\b\s*/i.exec(rest);
    if (hm) { a.am = hm[1].toUpperCase() === 'AM'; a.pm = !a.am; rest = rest.slice(hm[0].length); marked = true; }
    var dm = /^\(([^()]*)\)\s*/.exec(rest); // what they would have been doing
    if (dm) { rest = rest.slice(dm[0].length); marked = true; }
    var rm = /^[-–—:,]?\s*(sick|conference|out)\b\s*[-–—,:]?\s*/i.exec(rest);
    if (rm) { a.reason = REASONS[rm[1].toLowerCase()]; rest = rest.slice(rm[0].length); marked = true; }
    rest = trim(rest);
    var clause;
    var cb = /^(?:c\/b|covered\s+by|cov\.?\s+by)\s*:?\s*(.*)$/i.exec(rest);
    if (cb) clause = cb[1];
    else if (/^(?:nc|n\/c|not\s+covered|no\s+coverage)$/i.test(rest)) clause = 'NC';
    else if (/^(?:[-–—]\s*)?(?:coverage\s+)?tbd$/i.test(rest)) return a;
    else if (!rest) return marked ? a : null; // a bare name is a note, not an absence
    else return null;                          // free text: a note
    clause = clause
      .replace(/\bd\/s\b/gi, ' ')
      .replace(/\bn\/c\b/gi, 'NC')
      .replace(/\bnot\s+covered\b/gi, 'NC')
      .replace(/\([^()]*\)/g, ' ');
    var parts = clause.split(/\s*(?:[|/;,&]|\band\b)\s*/i).map(trim).filter(Boolean);
    if (!parts.length) return null;
    var sessions = [];
    if (a.am) sessions.push('am');
    if (a.pm) sessions.push('pm');
    var got = {};
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var sm = /\b(AM|PM)\b/i.exec(p);
      var sess = sm ? sm[1].toLowerCase() : '';
      var bare = trim(p.replace(/\b(?:AM|PM)\b/gi, ' ').replace(/\s+/g, ' '));
      var who;
      if (/^nc$/i.test(bare)) who = 'NC';
      else if (!bare || /^(?:coverage\s+)?tbd$/i.test(bare)) who = '';
      else {
        var w = nameAt(bare, names);
        if (!w || trim(bare.slice(w.length))) return null;
        who = w;
      }
      if (sess) { if (sessions.indexOf(sess) !== -1) got[sess] = who; }
      else sessions.forEach(function (s) { if (!(s in got)) got[s] = who; });
    }
    if ('am' in got) a.coverAM = got.am;
    if ('pm' in got) a.coverPM = got.pm;
    return a;
  }

  /* ------------------------------------------------------------------ */
  /* one Clinics line                                                    */
  /*   Cornea PM (Meghpara, 28 x 2): Parekh, Bair + 1 procedure @ 12:30  */
  /*   Neuro AM/PM (Sergott): Marshall · CPEC PO: … · app: 'Cornea PM (29x3): X' */
  /* ------------------------------------------------------------------ */
  function clinicLabelOf(label, clinics) {
    var low = label.toLowerCase();
    if (low === 'cpec po') return 'CPEC PO';
    if (!clinics) return label; // no clinic list given: take the label as typed
    var keys = Object.keys(clinics);
    for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === low) return keys[i];
    return '';
  }

  function parseClinic(line, names, clinics) {
    var ci = -1;
    for (var i = 0; i < line.length; i++) {
      if (line.charAt(i) === ':' && !(/\d/.test(line.charAt(i - 1)) && /\d/.test(line.charAt(i + 1)))) { ci = i; break; }
    }
    if (ci === -1) return null;
    var head = line.slice(0, ci);
    var staffTxt = trim(line.slice(ci + 1));
    var parens = [];
    head = head.replace(/\(([^()]*)\)/g, function (all, p) { parens.push(p); return ' '; });
    var sessions = [];
    var sm = /\b(AM\s*(?:\/|&|and)\s*PM|all\s*day|AM|PM)\b/i.exec(head);
    if (sm) {
      var t = sm[1].toLowerCase();
      sessions = /am/.test(t) && /pm/.test(t) || /all/.test(t) ? ['am', 'pm'] : [t];
      head = head.replace(sm[0], ' ');
    }
    var rawLabel = trim(head.replace(/\s+/g, ' '));
    if (NOT_CLINICS[rawLabel.toLowerCase()]) return { info: true };
    var label = clinicLabelOf(rawLabel, clinics);
    if (!label) return { notClinic: rawLabel };
    if (!sessions.length) {
      if (label === 'CPEC PO') sessions = ['day'];
      else {
        var grp = (clinics && clinics[label]) || {};
        sessions = ['am', 'pm'].filter(function (s) { return (grp[s] || []).length; });
        if (!sessions.length) sessions = ['am', 'pm'];
      }
    }
    var count = '';
    var extra = [];
    parens.join(', ').split(/\s*,\s*/).forEach(function (p) {
      p = trim(p);
      if (!p) return;
      if (!count && /^\d+(?:\s*x\s*\d+)?(?:\s|$)/i.test(p)) count = p;
      else extra.push(p);
    });
    // staff; a name may carry its own session — 'Patel (AM, covering
    // Ransone)', 'Hamou (PM)' — as the one-line CPEC list does
    var staff = [];
    if (staffTxt && !/^none\.?$/i.test(staffTxt)) {
      staffTxt.replace(/\(([^()]*)\)/g, function (all) { return all.replace(/,/g, '\u0001'); })
        .split(/\s*,\s*/).forEach(function (item) {
          item = trim(item.replace(/\u0001/g, ','));
          if (!item) return;
          var st = /^(.*?)\s*\(for\s+(.+)\)$/i.exec(item); // app format 'Hamou (for Ransone)'
          var n = nameAt(st ? st[1] : item, names);
          if (!n) { extra.push(item); return; }
          var only = null;
          var left = trim(st ? '' : item.slice(n.length));
          var tag = /^\(\s*(AM|PM)\b[^()]*\)\s*(.*)$/i.exec(left);
          if (tag) { only = tag[1].toLowerCase(); left = trim(tag[2]); }
          staff.push({ name: st ? n + ' (for ' + trim(st[2]) + ')' : n, only: only });
          if (left) extra.push(left.replace(/^\+\s*/, '+'));
        });
    }
    return { label: label, sessions: sessions, count: count, extra: extra.join('; '), staff: staff };
  }

  /* ------------------------------------------------------------------ */
  /* the whole paste                                                     */
  /* ------------------------------------------------------------------ */
  function parse(text, ctx) {
    ctx = ctx || {};
    var names = (ctx.names || []).slice().sort(function (x, y) { return y.length - x.length; });
    var clinics = ctx.clinics || null;
    var out = {
      lectures: [], nightFloat: '', sawInfo: false, surg: {}, cases: [],
      absences: [], outConfirmed: false, vacationNote: [],
      clinics: [], notClinics: [], addOns: [], addOnDates: [],
      unknown: [], unknownNames: [], notedNotOut: [], read: 0, sections: {}
    };
    function addUnknown(list) {
      list.forEach(function (n) { if (out.unknownNames.indexOf(n) === -1) out.unknownNames.push(n); });
    }
    var section = '';
    String(text == null ? '' : text).split(/\r\n|\r|\n/).forEach(function (rawLine) {
      var raw = clean(rawLine);
      if (!raw) return;
      var bullet = /^(?:[-–—•·*]|\d{1,2}[.)])\s*/.exec(raw);
      var line = bullet ? trim(raw.slice(bullet[0].length)) : raw;
      var h = headOf(raw) || (bullet ? '' : headOf(line));
      if (h) {
        section = h;
        out.sections[h] = true;
        out.read++;
        return;
      }
      if (!line) return;
      var sg = /^surg\s*(\d+)\s*[-–—:]\s*(.*)$/i.exec(line);
      if (sg) {
        var nm = trim(sg[2].replace(/\bnone\s+(?:AM|PM)\b/gi, ' ').replace(/[|]/g, ' ').replace(/\b(?:AM|PM)\b/g, ' ').replace(/\s+/g, ' '));
        out.surg[sg[1]] = /^none$/i.test(nm) ? '' : (nameAt(nm, names) || nm);
        out.read++;
        return;
      }
      var nf = /^night\s*float\s*:\s*(.*)$/i.exec(line);
      if (nf) {
        var v = trim(nf[1]);
        out.nightFloat = /^none$/i.test(v) ? '' : (nameAt(v, names) || v.split(/[\s,]+/)[0] || '');
        out.sawInfo = true;
        out.read++;
        return;
      }
      if (INFO_RE.test(line)) { out.sawInfo = true; out.read++; return; }
      if (section === 'lectures') { out.lectures.push(raw); out.read++; return; }
      if (CASE_SECTIONS[section]) {
        var unkC = [];
        var c = parseCase(line, section, names, unkC);
        if (c && c.none) { out.read++; return; }
        if (c) { out.cases.push(c); addUnknown(unkC); out.read++; return; }
        out.unknown.push(raw);
        return;
      }
      if (section === 'clinics') {
        var cl = parseClinic(line, names, clinics);
        if (!cl) { out.unknown.push(raw); return; }
        out.read++;
        if (cl.info) return;
        if (cl.notClinic) { out.notClinics.push(raw); return; }
        cl.sessions.forEach(function (s) {
          out.clinics.push({
            label: cl.label, session: s, count: cl.count, extra: cl.extra,
            staff: cl.staff.filter(function (p) { return !p.only || p.only === s || s === 'day'; }).map(function (p) { return p.name; })
          });
        });
        return;
      }
      if (section === 'vacation') {
        if (/^\d+\s+strong$/i.test(line)) { out.outConfirmed = true; out.read++; return; }
        var a = parseAbsence(line, names);
        if (a) { out.absences.push(a); out.read++; return; }
        out.vacationNote.push(line); // free text is kept as the note
        // starts with a resident's name but did not read as an absence: say so
        if (nameAt(line, names)) out.notedNotOut.push(line);
        out.read++;
        return;
      }
      if (section === 'addons') {
        var am = /^(.*?)\s*:\s*(.+)$/.exec(line);
        // 'Monday night (9/28/26): Calotti'; a bare line only if it is a resident
        if (!am && !nameAt(line, names)) { out.unknown.push(raw); return; }
        var label = am ? trim(am[1]) : '';
        var name = am ? trim(am[2]) : line;
        out.addOns.push({ label: label, name: nameAt(name, names) || name });
        var dmt = /\((\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\)/.exec(label);
        if (dmt) {
          var y = dmt[3].length === 2 ? 2000 + parseInt(dmt[3], 10) : parseInt(dmt[3], 10);
          out.addOnDates.push(y + '-' + ('0' + dmt[1]).slice(-2) + '-' + ('0' + dmt[2]).slice(-2));
        }
        out.read++;
        return;
      }
      out.unknown.push(raw);
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* case type — not in the text, so inferred                            */
  /* ------------------------------------------------------------------ */
  // The schedulers set the type; this only pre-fills it from firm signals,
  // in order: the type they last chose for this attending (ctx.knownTypes)
  // → globe/trauma by name → privates and today's CPEC-sheet surgeons are
  // cataract → the clinic a backup covers (cornea/glaucoma) → the resident's
  // Surg role (3 cornea, 4 glaucoma, 1/5 cataract) → JHN/TJUH/JSC plastics →
  // 'other' (flagged for them to choose). List size is NOT a signal: glaucoma
  // attendings run long lists too.
  function surgeonKey(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  function inferCategory(c, ctx) {
    var s = (c.surgeon || '').toLowerCase();
    var known = ctx && ctx.knownTypes && ctx.knownTypes[surgeonKey(c.surgeon)];
    if (known) return known;
    var text = ((c.notes || '') + ' ' + (c.backupNote || '')).toLowerCase();
    if (/globe|trauma|rupture/.test(s) || /\b(?:globe|trauma)\b/.test(text)) return 'trauma';
    if (c.section === 'private') return 'cataract';
    var cpec = (ctx && ctx.cpecSurgeons) || [];
    for (var i = 0; i < cpec.length; i++) {
      if (cpec[i] && s.indexOf(String(cpec[i]).toLowerCase()) === 0) return 'cataract';
    }
    if (/cornea/.test(text)) return 'cornea';
    if (/glaucoma/.test(text)) return 'glaucoma';
    var role = ctx && ctx.surgRoleOf ? ctx.surgRoleOf(c.assigned) : '';
    if (role === '3') return 'cornea';
    if (role === '4') return 'glaucoma';
    if (role === '1' || role === '5') return 'cataract';
    if (c.section === 'jhn') return 'plastics';
    return 'other';
  }

  // 'Hamou (for Ransone)' → { shown: 'Hamou', base: 'Ransone' }
  function person(s) {
    var m = /^(.*?)\s*\(for\s+(.+)\)$/i.exec(s);
    return m ? { shown: trim(m[1]), base: trim(m[2]) } : { shown: trim(s), base: trim(s) };
  }

  /* ------------------------------------------------------------------ */
  /* parsed → day state                                                  */
  /* ------------------------------------------------------------------ */
  function toDay(parsed, base, roster, data, exportFmt, opts) {
    opts = opts || {};
    var day = JSON.parse(JSON.stringify(base || {}));
    day.lectures = parsed.lectures.join('\n');
    if (parsed.nightFloat) day.nightFloat = parsed.nightFloat;
    else if (parsed.sawInfo) { day.nightFloat = ''; day.nfCleared = true; }
    day.absences = parsed.absences.map(function (a, i) {
      return { id: 'imp' + (i + 1), name: a.name, am: a.am, pm: a.pm, reason: a.reason, coverAM: a.coverAM, coverPM: a.coverPM };
    });
    day.outConfirmed = !!parsed.outConfirmed && !day.absences.length;
    day.vacation = parsed.vacationNote.join('\n');
    day.cases = parsed.cases.map(function (c, i) {
      return {
        id: 'c' + (i + 1), section: c.section, surgeon: c.surgeon, count: c.count,
        serviceCount: c.serviceCount, start: c.start, serviceTimes: c.serviceTimes,
        category: inferCategory(c, opts), addOn: false, notes: c.notes, assigned: c.assigned,
        backup: c.backup, backupNote: c.backupNote, until: ''
      };
    });
    day.seq = day.cases.length + 1;
    day.suggestions = {};

    day.clinicCounts = {};
    day.clinicStaffOverrides = {};
    parsed.clinics.forEach(function (cl) {
      if (cl.count || cl.extra) day.clinicCounts[cl.label + '|' + cl.session] = { count: cl.count, extra: cl.extra };
    });
    // Clinic staff: who the paste lists vs who the block schedule (plus who is
    // out) would put there. Only listed clinics change — a hand-typed schedule
    // lists some clinics, and the rest keep the block schedule's staff.
    if (exportFmt && exportFmt.clinicStaff && roster) {
      var probe = {};
      for (var k in day) probe[k] = day[k];
      probe.roster = roster;
      parsed.clinics.forEach(function (cl) {
        var key = cl.label + '|' + cl.session;
        var computed = exportFmt.clinicStaff(probe, roster, cl.label, cl.session).map(person);
        var listed = cl.staff.map(person);
        var shownComputed = computed.map(function (p) { return p.shown; });
        var shownListed = listed.map(function (p) { return p.shown; });
        var add = [], rem = [];
        listed.forEach(function (p) {
          if (shownComputed.indexOf(p.shown) === -1 && add.indexOf(p.base) === -1) add.push(p.base);
        });
        computed.forEach(function (p) {
          if (shownListed.indexOf(p.shown) === -1 && rem.indexOf(p.base) === -1 && add.indexOf(p.base) === -1) rem.push(p.base);
        });
        if (add.length || rem.length) day.clinicStaffOverrides[key] = { removed: rem, added: add };
      });
    }

    // add-on call names onto the day's rows by label; anything else as its own row
    var labelOf = opts.addOnLabel || function (r) { return trim(r && r.label); };
    day.addOns = day.addOns || [];
    parsed.addOns.forEach(function (a) {
      var row = null;
      for (var i = 0; i < day.addOns.length; i++) {
        if (a.label && labelOf(day.addOns[i]) === a.label && !trim(day.addOns[i].name)) { row = day.addOns[i]; break; }
      }
      if (row) { row.name = a.name; row.auto = false; }
      else day.addOns.push({ date: '', period: 'night', label: a.label, name: a.name, auto: false });
    });
    return day;
  }

  // Lines of `a` not in `b` (and the reverse), compared as pasted text.
  function diffLines(a, b) {
    function lines(t) {
      return String(t || '').split(/\r\n|\r|\n/).map(norm).filter(Boolean);
    }
    var la = lines(a), lb = lines(b);
    var countB = {};
    lb.forEach(function (l) { countB[l] = (countB[l] || 0) + 1; });
    var missing = [];
    la.forEach(function (l) {
      if (countB[l]) countB[l]--;
      else missing.push(l);
    });
    var countA = {};
    la.forEach(function (l) { countA[l] = (countA[l] || 0) + 1; });
    var extra = [];
    lb.forEach(function (l) {
      if (countA[l]) countA[l]--;
      else extra.push(l);
    });
    return { missing: missing, extra: extra, same: !missing.length && !extra.length };
  }

  var ImportFmt = {
    parse: parse,
    toDay: toDay,
    diffLines: diffLines,
    inferCategory: inferCategory,
    surgeonKey: surgeonKey,
    clean: clean
  };

  if (typeof window !== 'undefined') window.ImportFmt = ImportFmt;
  if (typeof module !== 'undefined' && module.exports) module.exports = ImportFmt;
})();
