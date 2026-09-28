/*
 * importer.js — read a copied schedule back into a day.
 * window.ImportFmt in the browser; module.exports in Node. Pure (no DOM).
 *
 * Why: the Surg 2 who builds tomorrow's schedule is often not tomorrow's
 * Surg 2, and each browser keeps its own drafts. Pasting the schedule that
 * was sent gives the next person's app the day, so live coverage (who is
 * free, who backs up whom, clinic gaps) works for them too.
 *
 * parse(text, ctx)   → what the text says, line by line, plus the lines it
 *                      could not read (ctx.names = roster names)
 * toDay(parsed, base, roster, data, exportFmt, opts)
 *                    → a day state built on `base` (a fresh defaultState)
 * diffLines(a, b)    → lines of text `a` missing from `b` and vice versa,
 *                      compared the way a pasted copy would read
 *
 * Reads the app's own format (export.js), with or without the **bold**
 * markers, and tolerates bullets, en/em dashes and extra blank lines. The
 * case category is not in the text: it is inferred (see inferCategory) and
 * flagged as a guess.
 */
(function () {
  'use strict';

  function trim(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }

  // A pasted line as plain comparable text: no bold markers, no odd spaces.
  function clean(line) {
    return String(line == null ? '' : line)
      .replace(/\*\*/g, '')
      .replace(/[\u00a0\u2007\u202f\t]/g, ' ')
      .replace(/[\u200b\ufeff\ufe0f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  // For comparing: also fold dashes and bullets the way mail clients mangle them.
  function norm(line) {
    return clean(line)
      .replace(/^[•·*–—]\s*/, '-')
      .replace(/\s[–—]\s/g, ' - ')
      .replace(/^-\s+/, '-')
      .toLowerCase();
  }

  var HEADS = [
    [/^lectures?\s*(?:\/|&|and)\s*events?:?$/i, 'lectures'],
    [/^assignments:?$/i, 'assignments'],
    [/^wills\s*\/\s*asc:?$/i, 'wills'],
    [/^privates?:?$/i, 'private'],
    [/^jhn\s*\/\s*tjuh\s*\/\s*jsc:?$/i, 'jhn'],
    [/^other\s*\(\s*stadium\s*\/\s*cherry\s*hill\s*\):?$/i, 'other'],
    [/^(?:stadium\s*\/\s*cherry\s*hill|stadium|cherry\s*hill):?$/i, 'other'],
    [/^clinics:?$/i, 'clinics'],
    [/^vacations?:?$/i, 'vacation'],
    [/^add-?ons:?$/i, 'addons']
  ];
  var CASE_SECTIONS = { wills: true, private: true, jhn: true, other: true };
  var REASONS = { sick: 'sick', conference: 'conference', out: 'other' };

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
        if (!next || /[\s;,()|]/.test(next)) return n;
      }
    }
    return '';
  }

  // A name at the start of s: a roster name, else the first word (flagged).
  function whoAt(s, names, unknownNames) {
    var n = nameAt(s, names);
    if (n) return { name: n, len: n.length };
    var m = /^([A-Za-z][A-Za-z'’.-]*)/.exec(s);
    if (!m) return null;
    if (m[1].toUpperCase() !== 'NC' && unknownNames.indexOf(m[1]) === -1) unknownNames.push(m[1]);
    return { name: m[1].toUpperCase() === 'NC' ? 'NC' : m[1], len: m[1].length };
  }

  var TIME_ONLY = /^(?:\d{1,2}(?::?\d{2})?\s*(?:[ap]\.?m\.?)?|am\s*tf|pm)$/i;

  /* ------------------------------------------------------------------ */
  /* one case line: -Surgeon xN (start) , xS service - times - Res; Backup note (notes) */
  /* ------------------------------------------------------------------ */
  function parseCase(body, section, names, unknownNames) {
    if (/^none$/i.test(body)) return { none: true };
    var m = /^(.+?)\s+x\s*(\d+)\b(.*)$/i.exec(body);
    if (!m) return null;
    var c = {
      section: section, surgeon: trim(m[1]), count: parseInt(m[2], 10),
      start: '', serviceCount: null, serviceTimes: '',
      assigned: '', backup: '', backupNote: '', notes: ''
    };
    var rest = m[3];
    var sm = /^\s*\(([^()]*?)\s+start\)/i.exec(rest);
    if (sm) { c.start = trim(sm[1]); rest = rest.slice(sm[0].length); }
    var sv = /^\s*,\s*x\s*(\d+)\s+service\b/i.exec(rest);
    if (sv) { c.serviceCount = parseInt(sv[1], 10); rest = rest.slice(sv[0].length); }

    var segs = (' ' + rest).split(/\s[-–—]\s/);
    var lead = trim(segs.shift());
    if (sv && segs.length && /\d/.test(segs[0]) && /^[\d:.\s&,]+(?:\s*[ap]\.?m\.?)?$/i.test(trim(segs[0]))) {
      c.serviceTimes = trim(segs.shift());
    }
    var who = trim(segs.join(' - '));
    var notesText = '';
    var marked = false; // '⚠ UNASSIGNED' printed → it is a service case
    var tail = '';
    if (lead) {
      var lp = /^\(([^()]*)\)$/.exec(lead);
      if (lp && !c.start && TIME_ONLY.test(trim(lp[1]))) c.start = trim(lp[1]);
      else if (lp) notesText = lp[1];
      else return null; // text between the count and the assignee that is not ours
    }
    if (who) {
      var um = /^(?:⚠\s*)?unassigned\b\s*(.*)$/i.exec(who);
      if (um) {
        marked = true;
        tail = trim(um[1]);
      } else {
        var a = whoAt(who, names, unknownNames);
        if (!a) return null;
        c.assigned = a.name;
        var r = trim(who.slice(a.len));
        if (r.charAt(0) === ';') {
          r = trim(r.slice(1));
          var b = whoAt(r, names, unknownNames);
          if (b) { c.backup = b.name; r = trim(r.slice(b.len)); }
          c.backupNote = r; // everything after the backup (a trailing note rides along)
          r = '';
        }
        tail = r;
      }
      if (tail) {
        var pm = /^(.*?)\s*\(([^()]*)\)$/.exec(tail);
        if (pm) {
          if (trim(pm[1])) c.backupNote = trim(pm[1]);
          notesText = notesText ? notesText + '; ' + pm[2] : pm[2];
        } else {
          c.backupNote = tail;
        }
      }
    }
    // notes: '(no Peds OR; backup: Calotti to cover …)'
    if (notesText) {
      var keep = [];
      notesText.split(/\s*;\s*/).forEach(function (it) {
        var bm = /^backup:\s*(.*)$/i.exec(it);
        if (bm && !c.assigned) {
          var bw = whoAt(trim(bm[1]), names, unknownNames);
          if (bw) { c.backup = bw.name; c.backupNote = trim(trim(bm[1]).slice(bw.len)); return; }
        }
        if (trim(it)) keep.push(trim(it));
      });
      c.notes = keep.join('; ');
    }
    if (c.serviceCount == null) c.serviceCount = (c.assigned || marked) ? c.count : 0;
    return c;
  }

  /* ------------------------------------------------------------------ */
  /* one Vacation line: 'Ransone (CPEC/Plastics) c/b Patel AM (Uveitis) | Hamou PM (CPEC)' */
  /* ------------------------------------------------------------------ */
  function parseAbsence(line, names, unknownNames) {
    var name = nameAt(line, names);
    if (!name) return null;
    var rest = trim(line.slice(name.length));
    var a = { name: name, am: true, pm: true, reason: 'vacation', coverAM: '', coverPM: '' };
    var hm = /^(AM|PM)\b\s*/i.exec(rest);
    if (hm) { a.am = hm[1].toUpperCase() === 'AM'; a.pm = !a.am; rest = rest.slice(hm[0].length); }
    var dm = /^\(([^()]*)\)\s*/.exec(rest);
    if (dm) rest = rest.slice(dm[0].length);
    var rm = /^[-–—]\s*(sick|conference|out)\b\s*/i.exec(rest);
    if (rm) { a.reason = REASONS[rm[1].toLowerCase()]; rest = rest.slice(rm[0].length); }
    rest = trim(rest.replace(/\bd\/s\b/gi, ' ').replace(/\s+/g, ' '));
    var sess = [];
    if (a.am) sess.push('am');
    if (a.pm) sess.push('pm');
    function setAll(who) { if (a.am) a.coverAM = who; if (a.pm) a.coverPM = who; }
    if (!rest) return (dm || hm || rm) ? a : null; // a bare name is a note, not an absence
    if (/^NC$/i.test(rest) || /^not covered$/i.test(rest)) { setAll('NC'); return a; }
    if (/^[-–—]?\s*coverage tbd$/i.test(rest)) return a;
    var parts = rest.split(/\s*\|\s*/);
    var one = /^c\/b\s+(.*)$/i.exec(rest);
    if (parts.length === 1 && one) {
      // one coverer; a session tag after the name means a split with one side missing
      var w = whoAt(trim(one[1]), names, unknownNames);
      if (!w) return null;
      var after = trim(trim(one[1]).slice(w.len));
      var tag = /^(AM|PM)\b\s*(.*)$/i.exec(after);
      if (tag && sess.length === 2) {
        if (tag[1].toUpperCase() === 'AM') a.coverAM = w.name; else a.coverPM = w.name;
        after = trim(tag[2]);
      } else {
        setAll(w.name);
      }
      if (after && !/^\([^()]*\)$/.test(after)) return null;
      return a;
    }
    var okAll = true;
    parts.forEach(function (p) {
      p = trim(p.replace(/^c\/b\s+/i, ''));
      var m1 = /^NC\s+(AM|PM)\b/i.exec(p);
      var m2 = /^(AM|PM)\s+coverage tbd$/i.exec(p);
      if (m1) { if (m1[1].toUpperCase() === 'AM') a.coverAM = 'NC'; else a.coverPM = 'NC'; return; }
      if (m2) return;
      var ww = whoAt(p, names, unknownNames);
      if (!ww) { okAll = false; return; }
      var rs = trim(p.slice(ww.len));
      var t = /^(AM|PM)\b\s*(\([^()]*\))?$/i.exec(rs);
      if (!t) { okAll = false; return; }
      if (t[1].toUpperCase() === 'AM') a.coverAM = ww.name; else a.coverPM = ww.name;
    });
    return okAll ? a : null;
  }

  /* ------------------------------------------------------------------ */
  /* the whole paste                                                     */
  /* ------------------------------------------------------------------ */
  function parse(text, ctx) {
    ctx = ctx || {};
    var names = (ctx.names || []).slice().sort(function (x, y) { return y.length - x.length; });
    var out = {
      lectures: [], nightFloat: '', sawInfo: false, surg: {}, cases: [],
      absences: [], outConfirmed: false, vacationNote: [],
      clinics: [], sawClinics: false, addOns: [], addOnDates: [],
      unknown: [], unknownNames: [], notedNotOut: [], read: 0, sections: {}
    };
    function addUnknown(list) {
      list.forEach(function (n) { if (out.unknownNames.indexOf(n) === -1) out.unknownNames.push(n); });
    }
    var section = '';
    String(text == null ? '' : text).split(/\r\n|\r|\n/).forEach(function (raw) {
      var line = clean(raw);
      if (!line) return;
      var h = headOf(line);
      if (h) {
        section = h;
        out.sections[h] = true;
        if (h === 'clinics') out.sawClinics = true;
        out.read++;
        return;
      }
      var sg = /^surg\s*(\d+)\s*[-–—:]\s*(.*)$/i.exec(line);
      if (sg) {
        var nm = trim(sg[2].replace(/\bnone\s+(?:AM|PM)\b/gi, ' ').replace(/[|]/g, ' ').replace(/\b(?:AM|PM)\b/g, ' ').replace(/\s+/g, ' '));
        out.surg[sg[1]] = /^none$/i.test(nm) ? '' : nm;
        out.read++;
        return;
      }
      var nf = /^night\s*float\s*:\s*(.*)$/i.exec(line);
      if (nf) {
        var who = nameAt(trim(nf[1]), names) || trim(nf[1]).split(/[\s,]+/)[0] || '';
        out.nightFloat = who;
        out.sawInfo = true;
        out.read++;
        return;
      }
      if (/^(?:wer|jeff\s*consults|cooper\s*consults|day\s*float|taskmaster|cooper\s*buddies)\s*:/i.test(line)) {
        out.sawInfo = true;
        out.read++;
        return;
      }
      if (section === 'lectures') { out.lectures.push(line); out.read++; return; }
      if (CASE_SECTIONS[section]) {
        var body = /^(?:[-–—•·*])\s*(.*)$/.exec(line);
        var unkC = [];
        var c = body ? parseCase(body[1], section, names, unkC) : null;
        if (c && c.none) { out.read++; return; }
        if (c) { out.cases.push(c); addUnknown(unkC); out.read++; return; }
        out.unknown.push(line);
        return;
      }
      if (section === 'clinics') {
        var cm = /^(.+?)(?:\s+(AM|PM))?(?:\s+\(([^()]*)\))?\s*:\s*(.*)$/i.exec(line);
        if (!cm) { out.unknown.push(line); return; }
        var paren = cm[3] ? cm[3].split(/\s*,\s*/) : [];
        var count = '', extra = [];
        paren.forEach(function (p, i) {
          if (i === 0 && /^\d+(?:\s*x\s*\d+)?$/i.test(trim(p))) count = trim(p);
          else if (trim(p)) extra.push(trim(p));
        });
        var staffTxt = trim(cm[4]);
        out.clinics.push({
          label: trim(cm[1]),
          session: cm[2] ? cm[2].toLowerCase() : 'day',
          count: count, extra: extra.join(', '),
          staff: (!staffTxt || /^none$/i.test(staffTxt)) ? [] : staffTxt.split(/\s*,\s*/).map(trim).filter(Boolean)
        });
        out.read++;
        return;
      }
      if (section === 'vacation') {
        if (/^\d+\s+strong$/i.test(line)) { out.outConfirmed = true; out.read++; return; }
        var unkA = [];
        var a = parseAbsence(line, names, unkA);
        if (a) { out.absences.push(a); addUnknown(unkA); out.read++; return; }
        out.vacationNote.push(line); // free text is kept as the note
        // starts with a resident's name but did not read as an absence: say so
        if (nameAt(line, names)) out.notedNotOut.push(line);
        out.read++;
        return;
      }
      if (section === 'addons') {
        var am = /^(.*?)\s*:\s*(.+)$/.exec(line);
        // 'Monday night (9/28/26): Calotti'; a bare line only if it is a resident
        if (!am && !nameAt(line, names)) { out.unknown.push(line); return; }
        var label = am ? trim(am[1]) : '';
        var name = am ? trim(am[2]) : line;
        out.addOns.push({ label: label, name: name });
        var dm = /\((\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\)/.exec(label);
        if (dm) {
          var y = dm[3].length === 2 ? 2000 + parseInt(dm[3], 10) : parseInt(dm[3], 10);
          out.addOnDates.push(y + '-' + ('0' + dm[1]).slice(-2) + '-' + ('0' + dm[2]).slice(-2));
        }
        out.read++;
        return;
      }
      out.unknown.push(line);
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* case type — not in the text, so inferred                            */
  /* ------------------------------------------------------------------ */
  // Order: globe/trauma by name → privates and CPEC-sheet surgeons are
  // cataract lists → the clinic a backup covers (cornea/glaucoma) → the
  // assigned resident's Surg role (3 cornea, 4 glaucoma, 1/5 cataract) →
  // JHN/TJUH/JSC lists are plastics → other.
  function inferCategory(c, ctx) {
    var s = (c.surgeon || '').toLowerCase();
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

  function baseName(s) {
    var m = /^(.*?)\s*\(for\s+(.+)\)$/i.exec(s);
    return m ? trim(m[2]) : trim(s);
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
      var cat = inferCategory(c, opts);
      return {
        id: 'c' + (i + 1), section: c.section, surgeon: c.surgeon, count: c.count,
        serviceCount: c.serviceCount, start: c.start, serviceTimes: c.serviceTimes,
        category: cat, addOn: false, notes: c.notes, assigned: c.assigned,
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
    // Manual clinic edits: what the paste lists vs what the block schedule
    // (plus who is out) would print. 'X (for Y)' is a stand-in — the edit
    // is about Y being in that clinic.
    if (exportFmt && exportFmt.clinicStaff && roster) {
      var probe = {};
      for (var k in day) probe[k] = day[k];
      probe.roster = roster;
      var listedKeys = {};
      parsed.clinics.forEach(function (cl) {
        var key = cl.label + '|' + cl.session;
        listedKeys[key] = true;
        var computed = exportFmt.clinicStaff(probe, roster, cl.label, cl.session);
        var add = [], rem = [];
        cl.staff.forEach(function (s) {
          if (computed.indexOf(s) === -1) { var n = baseName(s); if (add.indexOf(n) === -1) add.push(n); }
        });
        computed.forEach(function (s) {
          if (cl.staff.indexOf(s) === -1) { var n = baseName(s); if (rem.indexOf(n) === -1 && add.indexOf(n) === -1) rem.push(n); }
        });
        if (add.length || rem.length) day.clinicStaffOverrides[key] = { removed: rem, added: add };
      });
      // A clinic the paste leaves out entirely had nobody in it.
      if (parsed.sawClinics) {
        Object.keys(roster.clinics || {}).forEach(function (label) {
          ['am', 'pm'].forEach(function (session) {
            var key = label + '|' + session;
            if (listedKeys[key]) return;
            var computed = exportFmt.clinicStaff(probe, roster, label, session);
            if (computed.length) day.clinicStaffOverrides[key] = { removed: computed.map(baseName), added: [] };
          });
        });
      }
    }

    // add-on call names onto the day's rows by label; anything else as its own row
    var labelOf = opts.addOnLabel || function (r) { return trim(r && r.label); };
    (day.addOns = day.addOns || []);
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
    clean: clean
  };

  if (typeof window !== 'undefined') window.ImportFmt = ImportFmt;
  if (typeof module !== 'undefined' && module.exports) module.exports = ImportFmt;
})();
