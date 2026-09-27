/*
 * export.js — schedule document formatting.
 * window.ExportFmt in the browser; module.exports in Node.
 *
 * buildHTML(day) / buildText(day) are pure: they take a plain object
 * (the per-date app state plus `roster`, the Engine DayRoster) and return
 * a string. Only copy() touches browser APIs, and every browser API is
 * guarded so the module is requireable and callable from Node.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  function trim(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // A "line" is an array of segments { t: text, b: bold, cls?: 'unassigned' }
  // (or a plain string, meaning one non-bold segment).
  function seg(t, b) { return { t: String(t), b: !!b }; }

  function normLine(line) {
    if (typeof line === 'string') return [seg(line, false)];
    return line.map(function (s) {
      return typeof s === 'string' ? seg(s, false) : s;
    });
  }

  function num(v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }

  /* ------------------------------------------------------------------ */
  /* section builders                                                    */
  /* ------------------------------------------------------------------ */

  // WER collapses per-resident sessions: 'Nahar AM/PM, Hamou AM/PM, Patel PM'
  function collapseWer(wer) {
    wer = wer || {};
    var am = wer.am || [];
    var pm = wer.pm || [];
    var parts = [];
    am.forEach(function (n) {
      parts.push(n + (pm.indexOf(n) !== -1 ? ' AM/PM' : ' AM'));
    });
    pm.forEach(function (n) {
      if (am.indexOf(n) === -1) parts.push(n + ' PM');
    });
    return parts.join(', ');
  }

  function buddyPart(b, sess) {
    if (!b || !trim(b.name)) return '';
    var t = trim(b.name) + ' ' + sess;
    if (trim(b.note)) t += ' (' + trim(b.note) + ')';
    return t;
  }

  // 'Illiano + buddy [Camacho AM (private glaucoma) | DeSimone PM (retina)]'
  function cooperText(roster, day) {
    var cooper = (roster.cooperConsults || []);
    if (!cooper.length) return '';
    var t = cooper.join(', ');
    var a = buddyPart(day.cooperBuddyAM, 'AM');
    var p = buddyPart(day.cooperBuddyPM, 'PM');
    var buddies = [a, p].filter(function (x) { return !!x; });
    if (buddies.length) t += ' + buddy [' + buddies.join(' | ') + ']';
    return t;
  }

  /* ---------------- who is out (Out today tab) ---------------- */

  var REASON_SUFFIX = { sick: 'sick', conference: 'conference', other: 'out' };

  function residentMap(roster) {
    var m = {};
    ((roster && roster.residents) || []).forEach(function (r) { if (r && r.name) m[r.name] = r; });
    return m;
  }

  function cellText(res, s) {
    return trim(res && res[s] && res[s].text);
  }

  function uniq(list) {
    var out = [];
    list.forEach(function (x) { if (x && out.indexOf(x) === -1) out.push(x); });
    return out;
  }

  // The chief's format:
  //   'Ransone (CPEC/Plastics) c/b Patel AM (Uveitis) | Hamou PM (CPEC)'
  //   'Ransone (CPEC/Plastics) c/b Patel (Uveitis/Glaucoma)'   one coverer
  //   'Ransone (CPEC/Plastics) c/b Patel AM (Uveitis) | NC PM' not covered
  //   'Ransone AM (CPEC) c/b Patel (Uveitis)'                  half day
  // Parentheses hold the block assignment(s): the absent resident's, then
  // each coverer's own (what they leave to cover).
  function absenceLine(a, byName) {
    var name = trim(a && a.name);
    var res = byName[name];
    var sess = [];
    if (a.am) sess.push('am');
    if (a.pm) sess.push('pm');
    var duties = uniq(sess.map(function (s) { return cellText(res, s); }));
    var head = name + (sess.length === 1 ? ' ' + sess[0].toUpperCase() : '') +
      (duties.length ? ' (' + duties.join('/') + ')' : '');
    var reason = REASON_SUFFIX[a.reason];
    if (reason) head += ' — ' + reason;

    var parts = sess.map(function (s) {
      return { s: s, who: trim(s === 'am' ? a.coverAM : a.coverPM) };
    });
    function coverParen(who, sessions) {
      var own = uniq(sessions.map(function (s) { return cellText(byName[who], s); }));
      return own.length ? ' (' + own.join('/') + ')' : '';
    }
    if (parts.length === 2 && parts[0].who === parts[1].who) {
      var w = parts[0].who;
      if (w === 'NC') return head + ' NC';
      if (!w) return head + ' — coverage TBD';
      return head + ' c/b ' + w + coverParen(w, sess);
    }
    if (parts.length === 1) {
      var w1 = parts[0].who;
      if (w1 === 'NC') return head + ' NC';
      if (!w1) return head + ' — coverage TBD';
      return head + ' c/b ' + w1 + coverParen(w1, sess);
    }
    return head + ' ' + parts.map(function (p, i) {
      var S = p.s.toUpperCase();
      if (p.who === 'NC') return 'NC ' + S;
      if (!p.who) return S + ' coverage TBD';
      var prev = parts[i - 1];
      var prefix = (!prev || !prev.who || prev.who === 'NC') ? 'c/b ' : '';
      return prefix + p.who + ' ' + S + coverParen(p.who, [p.s]);
    }).join(' | ');
  }

  // Vacation section: one line per absence; with nobody out, the free-text
  // note if any, else 'N strong' (N = residents on today's roster).
  function vacationLines(day, roster) {
    var byName = residentMap(roster);
    var lines = [];
    var abs = (day.absences || []).filter(function (a) {
      return a && trim(a.name) && (a.am || a.pm);
    });
    abs.forEach(function (a) { lines.push(absenceLine(a, byName)); });
    var note = trim(day.vacation);
    var isStrength = /^\d+\s+strong$/i.test(note);
    if (note && !(abs.length && isStrength)) {
      note.split(/\r?\n/).forEach(function (ln) { lines.push(ln); });
    }
    var n = ((roster && roster.residents) || []).length;
    if (!lines.length && n) lines.push(n + ' strong');
    return lines;
  }

  // Who stands in for whom, per session: explicit absences plus the Night
  // Float resident (out for the day, covered by Day Float).
  // -> { out: { 'name|am': coverer|'' }, covering: { 'coverer|am': name } }
  function standIns(day, roster) {
    var byName = residentMap(roster);
    var out = {};
    var covering = {};
    var explicit = {};
    function add(name, s, who) {
      out[name + '|' + s] = (who && who !== 'NC' && byName[who]) ? who : '';
      if (out[name + '|' + s]) covering[who + '|' + s] = name;
    }
    (day.absences || []).forEach(function (a) {
      var name = trim(a && a.name);
      if (!name || !byName[name] || explicit[name]) return;
      explicit[name] = true;
      if (a.am) add(name, 'am', trim(a.coverAM));
      if (a.pm) add(name, 'pm', trim(a.coverPM));
    });
    var nf = trim(day.nightFloat);
    if (nf && byName[nf] && !explicit[nf]) {
      var df = ((roster && roster.dayFloat) || []).filter(function (n) { return n !== nf; })[0] || '';
      add(nf, 'am', df);
      add(nf, 'pm', df);
    }
    return { out: out, covering: covering };
  }

  // '-Marous x7 (730 start), x1 service - **Momenaei** (no Peds OR)'
  // With service times: '…, x2 service - 1030 & 1300 - **Momenaei**'.
  // The times belong to the ', x{svc} service' clause (UISPEC3 §B) — when that
  // clause is suppressed (all-service case, svc === count), the times are too,
  // so they never dangle unlabeled before the assignee.
  function caseLine(c) {
    var count = num(c.count);
    var svc = num(c.serviceCount);
    var t = '-' + (trim(c.surgeon) || '?') + ' x' + count;
    if (trim(c.start)) t += ' (' + trim(c.start) + ' start)';
    if (svc > 0 && svc !== count) {
      t += ', x' + svc + ' service';
      if (trim(c.serviceTimes)) t += ' - ' + trim(c.serviceTimes);
    }
    var line = [seg(t)];
    var assigned = trim(c.assigned);
    var backup = trim(c.backup);
    if (backup === 'NC') backup = ''; // clinic knowingly left uncovered
    var backupNote = trim(c.backupNote);
    if (assigned) {
      // '- **Bair; Calotti** to cover glaucoma clinic during case if after 1 PM, …'
      line.push(seg(' - '));
      line.push(seg(assigned + (backup ? '; ' + backup : ''), true));
      if (backupNote) line.push(seg(' ' + backupNote));
    } else if (svc > 0) {
      line.push({ t: ' - ⚠ UNASSIGNED', b: false, cls: 'unassigned' });
    }
    var extras = [];
    if (trim(c.notes)) extras.push(trim(c.notes));
    if (!assigned && backup) {
      extras.push('backup: ' + backup + (backupNote ? ' ' + backupNote : ''));
    }
    if (extras.length) line.push(seg(' (' + extras.join('; ') + ')'));
    return line;
  }

  // Roster clinic staff for label+session with manual add/remove overrides,
  // then who is out: an absent resident's coverer stands in
  // ('Hamou (for Ransone)'); with no coverer (NC / not set) the name drops;
  // and a coverer drops out of their own clinic (they are elsewhere).
  function clinicStaff(day, roster, label, session) {
    var grp = (roster.clinics || {})[label];
    var base = ((grp && grp[session]) || []).map(function (p) {
      return typeof p === 'string' ? p : (p && p.name) || '';
    }).filter(function (n) { return !!n; });
    var ov = (day.clinicStaffOverrides || {})[label + '|' + session] || {};
    var removed = ov.removed || [];
    var added = ov.added || [];
    var out = base.filter(function (n) { return removed.indexOf(n) === -1; });
    added.forEach(function (n) {
      if (n && out.indexOf(n) === -1) out.push(n);
    });
    if (session !== 'am' && session !== 'pm') return out;
    var si = standIns(day, roster);
    var final = [];
    out.forEach(function (n) {
      var key = n + '|' + session;
      if (Object.prototype.hasOwnProperty.call(si.out, key)) {
        var who = si.out[key];
        if (who) final.push(who + ' (for ' + n + ')');
        return;
      }
      if (si.covering[key] && added.indexOf(n) === -1) return;
      final.push(n);
    });
    return final;
  }

  // 'Cornea PM (29x3): **Momenaei, Williamson, Aguwa**'
  // Session 'day' (the CPEC PO standing clinic, UISPEC5 §C) renders with NO
  // session suffix: 'CPEC PO (…): **names**'. Labels are collected from the
  // roster clinics plus any count OR staff-override key, so a clinic that is
  // only staffed manually (no roster group, no count yet) still prints.
  function clinicLines(day, roster) {
    var clinics = roster.clinics || {};
    var counts = day.clinicCounts || {};
    var overrides = day.clinicStaffOverrides || {};
    var labels = Object.keys(clinics);
    Object.keys(counts).concat(Object.keys(overrides)).forEach(function (k) {
      var label = k.split('|')[0];
      if (label && labels.indexOf(label) === -1) labels.push(label);
    });
    labels.sort();
    var lines = [];
    labels.forEach(function (label) {
      ['day', 'am', 'pm'].forEach(function (session) {
        var staff = clinicStaff(day, roster, label, session);
        var cc = counts[label + '|' + session] || {};
        var count = trim(cc.count);
        var extra = trim(cc.extra);
        if (!staff.length && !count && !extra) return;
        var head = session === 'day' ? label : label + ' ' + session.toUpperCase();
        var paren = [];
        if (count) paren.push(count);
        if (extra) paren.push(extra);
        if (paren.length) head += ' (' + paren.join(', ') + ')';
        var line = [seg(head + ': ')];
        line.push(staff.length ? seg(staff.join(', '), true) : seg('none'));
        lines.push(line);
      });
    });
    return lines;
  }

  // -> array of sections; each section is an array of lines.
  function buildSections(day) {
    day = day || {};
    var roster = day.roster || {};
    var sections = [];

    // Lectures/Events
    var lectures = trim(day.lectures);
    if (lectures) {
      var lLines = ['Lectures/Events'];
      lectures.split(/\r?\n/).forEach(function (ln) { lLines.push(ln); });
      sections.push(lLines);
    }

    // Assignments (Surg 1..N)
    var surg = roster.surg || {};
    var surgKeys = Object.keys(surg).sort(function (a, b) { return (+a) - (+b); });
    if (surgKeys.length) {
      var aLines = ['Assignments'];
      surgKeys.forEach(function (n) {
        var s = surg[n] || {};
        var line = [seg('Surg ' + n + ' - ')];
        if (s.am && s.pm) {
          line.push(seg(s.name, true));
        } else if (s.am) {
          line.push(seg(s.name + ' AM', true));
          line.push(seg(' | none PM'));
        } else if (s.pm) {
          line.push(seg('none AM | '));
          line.push(seg(s.name + ' PM', true));
        } else {
          line.push(seg('none'));
        }
        aLines.push(line);
      });
      sections.push(aLines);
    }

    // WER / Night Float / Jeff Consults / Cooper Consults
    var cLines = [];
    var wer = collapseWer(roster.wer);
    if (wer) cLines.push([seg('WER: '), seg(wer, true)]);
    var nf = trim(day.nightFloat);
    if (nf) cLines.push([seg('Night Float: '), seg(nf, true)]);
    var jeff = roster.jeffConsults || [];
    if (jeff.length) cLines.push([seg('Jeff Consults: '), seg(jeff.join(', '), true)]);
    var cooper = cooperText(roster, day);
    if (cooper) cLines.push([seg('Cooper Consults: '), seg(cooper, true)]);
    if (cLines.length) sections.push(cLines);

    // Case sections. The three core sections always print (with '-none' when
    // empty, matching the target document); 'Other' only prints when used.
    var cases = day.cases || [];
    var defs = [
      { key: 'wills', label: 'Wills/ASC', always: true },
      { key: 'private', label: 'Privates', always: true },
      { key: 'jhn', label: 'JHN/TJUH/JSC', always: true },
      { key: 'other', label: 'Other (Stadium/Cherry Hill)', always: false }
    ];
    defs.forEach(function (def) {
      var list = cases.filter(function (c) { return c && c.section === def.key; });
      if (!list.length && !def.always) return;
      var lines = [def.label];
      if (!list.length) lines.push('-none');
      else list.forEach(function (c) { lines.push(caseLine(c)); });
      sections.push(lines);
    });

    // Clinics
    var clLines = clinicLines(day, roster);
    if (clLines.length) sections.push(['Clinics'].concat(clLines));

    // Vacation
    var vLines = vacationLines(day, roster);
    if (vLines.length) sections.push(['Vacation'].concat(vLines));

    // Add-ons
    var addLines = addOnLines(day);
    if (addLines.length) sections.push(['Add-ons'].concat(addLines));

    return sections;
  }

  // 'Tuesday night (7/21/26): **Djulbegovic**'
  function addOnLines(day) {
    var lines = [];
    ((day && day.addOns) || []).forEach(function (row) {
      if (!row || !trim(row.name)) return;
      var label = trim(row.label);
      if (label) lines.push([seg(label + ': '), seg(trim(row.name), true)]);
      else lines.push([seg(trim(row.name), true)]);
    });
    return lines;
  }

  // The Add-ons section alone, as sections (for paste-at-the-end copying).
  function addOnsSections(day) {
    var lines = addOnLines(day);
    return lines.length ? [['Add-ons'].concat(lines)] : [];
  }

  /* ------------------------------------------------------------------ */
  /* renderers                                                           */
  /* ------------------------------------------------------------------ */

  function buildText(day) {
    return sectionsToText(buildSections(day));
  }

  function sectionsToText(sections) {
    return sections.map(function (lines) {
      return lines.map(function (line) {
        return normLine(line).map(function (s) {
          return s.b ? '**' + s.t + '**' : s.t;
        }).join('');
      }).join('\n');
    }).join('\n\n');
  }

  function buildHTML(day) {
    return sectionsToHTML(buildSections(day));
  }

  function sectionsToHTML(sections) {
    var body = sections.map(function (lines) {
      return lines.map(function (line) {
        var inner = normLine(line).map(function (s) {
          var t = esc(s.t);
          if (s.cls === 'unassigned') {
            return '<span style="color:#b3261e;font-weight:700">' + t + '</span>';
          }
          return s.b ? '<b>' + t + '</b>' : t;
        }).join('');
        return '<div>' + (inner || '<br>') + '</div>';
      }).join('');
    }).join('<div><br></div>');
    return '<div style="font-family:Calibri,\'Segoe UI\',Arial,sans-serif;' +
      'font-size:11pt;line-height:1.35">' + body + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* clipboard                                                           */
  /* ------------------------------------------------------------------ */

  // Copies the rendered HTML via a hidden contenteditable + execCommand.
  function execCopyHTML(html) {
    if (typeof document === 'undefined' || typeof window === 'undefined' ||
        !document.body || !window.getSelection) return false;
    var host;
    try {
      host = document.createElement('div');
      host.setAttribute('contenteditable', 'true');
      host.style.position = 'fixed';
      host.style.left = '-9999px';
      host.style.top = '0';
      host.style.opacity = '0';
      host.innerHTML = html;
      document.body.appendChild(host);
      var range = document.createRange();
      range.selectNodeContents(host);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = !!document.execCommand('copy');
      sel.removeAllRanges();
      return ok;
    } catch (e) {
      return false;
    } finally {
      if (host && host.parentNode) host.parentNode.removeChild(host);
    }
  }

  // Writes both flavors to the clipboard. Resolves true/false, never rejects.
  function copy(day) {
    var html, text;
    try {
      html = buildHTML(day);
      text = buildText(day);
    } catch (e) {
      return Promise.resolve(false);
    }
    return copyPair(html, text);
  }

  // Copies just the Add-ons section, for pasting at the end of the schedule.
  function copyAddOns(day) {
    var html, text;
    try {
      var secs = addOnsSections(day);
      if (!secs.length) return Promise.resolve(false);
      html = sectionsToHTML(secs);
      text = sectionsToText(secs);
    } catch (e) {
      return Promise.resolve(false);
    }
    return copyPair(html, text);
  }

  function copyPair(html, text) {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') {
      return Promise.resolve(false); // Node — nothing to copy to
    }
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.write &&
          typeof ClipboardItem !== 'undefined' && typeof Blob !== 'undefined') {
        try {
          var item = new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' })
          });
          navigator.clipboard.write([item]).then(
            function () { resolve(true); },
            function () { resolve(execCopyHTML(html)); }
          );
          return;
        } catch (e) { /* fall through to execCommand */ }
      }
      resolve(execCopyHTML(html));
    });
  }

  // Plain-text-only copy (used by the "Copy plain text" button).
  function copyText(day) {
    var text;
    try {
      text = buildText(day);
    } catch (e) {
      return Promise.resolve(false);
    }
    if (typeof navigator === 'undefined' || typeof document === 'undefined') {
      return Promise.resolve(false);
    }
    function fallback() {
      if (!document.body) return false;
      var ta;
      try {
        ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        return !!document.execCommand('copy');
      } catch (e) {
        return false;
      } finally {
        if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
      }
    }
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { resolve(true); },
          function () { resolve(fallback()); }
        );
        return;
      }
      resolve(fallback());
    });
  }

  /* ------------------------------------------------------------------ */

  var ExportFmt = {
    absenceLine: function (a, roster) { return absenceLine(a || {}, residentMap(roster)); },
    vacationLines: vacationLines,
    clinicStaff: clinicStaff,
    buildSections: buildSections,
    buildText: buildText,
    buildHTML: buildHTML,
    copy: copy,
    copyText: copyText,
    copyAddOns: copyAddOns
  };

  if (typeof window !== 'undefined') window.ExportFmt = ExportFmt;
  if (typeof module !== 'undefined' && module.exports) module.exports = ExportFmt;
})();
