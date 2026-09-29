/*
 * status.js — who is doing what, minute by minute (no DOM).
 * Exposes window.Status in the browser and module.exports in Node.
 *
 * Status.build(roster, day, data) -> Board for one schedule date, built from:
 *   - the resolved block roster (Engine.resolveDay),
 *   - who is out (day.absences) — plus the Night Float resident, who is out
 *     for the day and covered by Day Float (Day Float covers ONLY the Night
 *     Float resident; it is never a general floater),
 *   - clinic staffing edits (day.clinicStaffOverrides),
 *   - the case list: assigned resident, start, service-case times, 'until',
 *   - clinic coverage: a case's backup covers whatever clinic the assigned
 *     resident is pulled out of, for as long as the case runs.
 *
 * Status kinds (worst first):
 *   out    — vacation / sick / Night Float (post-call); never pulled
 *   case   — scrubbed in a case
 *   clinic — in a clinic (their own, or covering someone else's); can be
 *            pulled for a case, but then somebody has to cover the clinic
 *   duty   — fixed duty that is not pulled for cases (ER, consults, Day Float)
 *   free   — PT, or a Surg role / OR block with nothing booked
 *            (chief's rule, 9/2026; CPEC is a clinic — chief, 9/28/2026)
 *   off    — nothing scheduled (weekend / outside the academic year)
 *
 * Flags on a status: pullFirst — in a clinic to pull from first, that needs
 * no cover when they leave (Retina / Uveitis, data.availability.
 * pullFirstTexts); neverPull — never pulled for anything (Path).
 *
 * Times are minutes after midnight. The board's working day is 07:00–17:00
 * in 5-minute slots; AM is before 12:00, PM from 12:00.
 */
(function () {
  'use strict';

  var DAY_START = 7 * 60;
  var NOON = 12 * 60;
  var DAY_END = 17 * 60;
  var SLOT = 5;
  var NSLOTS = (DAY_END - DAY_START) / SLOT;

  // Minutes per case, turnover included — ESTIMATES used only when no
  // 'until' time is entered. Override per program in data.caseMinutes.
  var DEFAULT_CASE_MINUTES = {
    cataract: 30, cornea: 90, glaucoma: 90, plastics: 60,
    peds: 60, retina: 90, trauma: 120, other: 60
  };
  // Block-assignment texts that count as available / fixed duty / needing no
  // coverage when the resident is out. Override in data.availability.
  var DEFAULT_FREE = ['PT'];
  var DEFAULT_DUTY = ['ER', 'Jeff Consults', 'Cooper Consults'];
  var DEFAULT_OFFSITE = ['Cooper Clinic', 'Cooper OR'];
  var DEFAULT_NO_COVER = ['PT', 'Day Float'];
  var DEFAULT_PULL_FIRST = ['Retina', 'Retina Private', 'Uveitis'];
  var DEFAULT_NEVER_PULL = ['Path', 'ER', 'Jeff Consults', 'Cooper Consults'];

  var RANK = { off: 0, free: 1, duty: 2, clinic: 3, 'case': 4, out: 5 };

  function getData(data) {
    if (data) return data;
    if (typeof window !== 'undefined' && window.SCHED_DATA) return window.SCHED_DATA;
    if (typeof require !== 'undefined') return require('./data.js');
    return {};
  }

  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  /* ------------------------------------------------------------------ */
  /* clock parsing                                                       */
  /* ------------------------------------------------------------------ */

  // Every time token in a string, as minutes after midnight:
  //   '0730' '730' '7:30' '07:30' '13:00' '9:30 AM' '1pm' '1030 & 1300'.
  // Without an explicit am/pm, an hour of 1–6 written WITHOUT a leading zero
  // means the afternoon: a surgical day runs ~7:00–17:00 and the CPEC sheet
  // writes 1 PM as '1:00'. Zero-padded 24-hour times ('0600') keep their
  // literal meaning. 'AM TF', 'x2 service' and '7/28/26' yield nothing.
  function clockTokens(str) {
    var s = String(str == null ? '' : str);
    var re = /\b(\d{1,2}):(\d{2})(?:\s*([ap])\.?m?\b\.?)?|\b(\d{3,4})\b(?:\s*([ap])\.?m?\b\.?)?|\b(\d{1,2})\s*([ap])\.?m\b\.?/gi;
    var out = [];
    var m;
    while ((m = re.exec(s))) {
      var hs, mi, ap;
      if (m[1] != null) { hs = m[1]; mi = +m[2]; ap = m[3]; }
      else if (m[4] != null) { hs = m[4].slice(0, m[4].length - 2); mi = +m[4].slice(-2); ap = m[5]; }
      else { hs = m[6]; mi = 0; ap = m[7]; }
      var h = +hs;
      if (h > 23 || mi > 59) continue;
      ap = ap ? ap.toLowerCase() : '';
      if (ap === 'p' && h < 12) h += 12;
      else if (ap === 'a' && h === 12) h = 0;
      else if (!ap && h >= 1 && h <= 6 && hs.charAt(0) !== '0') h += 12;
      out.push(h * 60 + mi);
    }
    return out;
  }

  function parseClock(str) {
    var t = clockTokens(str);
    return t.length ? t[0] : null;
  }

  // 450 -> '7:30 AM', 780 -> '1:00 PM'
  function fmtClock(min) {
    if (min == null || isNaN(min)) return '';
    var h = Math.floor(min / 60) % 24;
    var m = Math.round(min % 60);
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  // 780 -> '1300' (the case form's start format)
  function fmtHHMM(min) {
    var h = Math.floor(min / 60) % 24;
    var m = min % 60;
    return (h < 10 ? '0' : '') + h + (m < 10 ? '0' : '') + m;
  }

  function sessionOf(t) { return t < NOON ? 'am' : 'pm'; }

  /* ------------------------------------------------------------------ */
  /* cases → busy spans                                                  */
  /* ------------------------------------------------------------------ */

  function perCaseMinutes(category, data) {
    var cm = (data && data.caseMinutes) || {};
    return cm[category] || DEFAULT_CASE_MINUTES[category] || cm.other || DEFAULT_CASE_MINUTES.other;
  }

  function mergeSpans(spans) {
    var list = spans.slice().sort(function (a, b) { return a.start - b.start; });
    var out = [];
    list.forEach(function (sp) {
      var last = out[out.length - 1];
      if (last && sp.start <= last.end) last.end = Math.max(last.end, sp.end);
      else out.push({ start: sp.start, end: sp.end });
    });
    return out;
  }

  // When the assigned resident is scrubbed for this case.
  //   - Cataracts: the whole list, service and private — the resident is
  //     part of that OR until it is done (chief, 9/28/2026: "when anyone is
  //     in cataract cases, they are part of that OR until they are done
  //     (both service and private cases)").
  //   - Any other list with private and service cases: the resident is
  //     needed only for the service cases (chief, 9/28/2026: "he is only
  //     responsible for his case when it is listed as a service case …
  //     available to leave for an emergent add-on after that case or to go
  //     to clinic"). One case-length block at each service time; extra
  //     service cases stack on the last. No service time: the service cases
  //     are assumed to open the list (flagged svcAssumed, so the row asks).
  //   - All service (or a private list someone was put on anyway): the
  //     whole list, start + count × minutes-per-case, flagged as an estimate.
  //   - 'until' (typed end time, or 'Done' day-of) replaces the last end.
  //   - No start ('AM TF', blank): assume 7:30, flagged unknownStart.
  function caseSpans(c, data) {
    c = c || {};
    var per = perCaseMinutes(c.category, data);
    var count = Math.max(1, parseInt(c.count, 10) || 1);
    var svc = Math.max(0, parseInt(c.serviceCount, 10) || 0);
    var starts = clockTokens(c.start);
    var unknownStart = !starts.length;
    var start = unknownStart ? DAY_START + 30 : starts[0];
    var svcTimes = clockTokens(c.serviceTimes).sort(function (a, b) { return a - b; });
    var spans = [];
    var svcAssumed = false;
    var partial = svc > 0 && svc < count && c.category !== 'cataract';
    if (partial && svcTimes.length) {
      svcTimes.forEach(function (t, i) {
        var n = i === svcTimes.length - 1 ? Math.max(1, svc - (svcTimes.length - 1)) : 1;
        spans.push({ start: t, end: t + n * per });
      });
    } else if (partial) {
      spans.push({ start: start, end: start + svc * per });
      svcAssumed = true;
    } else {
      spans.push({ start: start, end: start + count * per });
    }
    var estimated = true;
    var until = parseClock(c.until);
    if (until != null) {
      var last = spans[spans.length - 1];
      if (until > last.start) { last.end = until; estimated = false; }
    }
    spans = mergeSpans(spans);
    // Checked off as done at doneAt (chief, 9/29/2026: "check off when the
    // cases are done and who clears up"): the case is over then and the
    // resident is free from that minute, whatever the estimate said. Done
    // before it began (cancelled): no busy time at all.
    var doneAt = c.done ? parseClock(c.doneAt) : null;
    if (doneAt != null) {
      var kept = spans.filter(function (sp) { return sp.start < doneAt; });
      if (kept.length) kept[kept.length - 1].end = doneAt;
      spans = kept.length ? kept : [{ start: doneAt, end: doneAt }];
      estimated = false;
    }
    return {
      spans: spans,
      start: spans[0].start,
      end: spans[spans.length - 1].end,
      estimated: estimated,
      unknownStart: unknownStart,
      svcAssumed: svcAssumed,
      done: doneAt != null,
      perCase: per
    };
  }

  function overlaps(spans, start, end) {
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].start < end && start < spans[i].end) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* block-text classification                                           */
  /* ------------------------------------------------------------------ */

  // 'surg' | 'or' | 'free' | 'duty' | 'offsite' | 'dayfloat' | 'clinic' | 'off'
  function classifyText(text, data) {
    var t = trim(text);
    if (!t) return 'off';
    var av = (data && data.availability) || {};
    if (/^Surg \d+$/.test(t)) return 'surg';
    // at another hospital (Cooper) — checked before the OR rule
    if ((av.offsiteTexts || DEFAULT_OFFSITE).indexOf(t) !== -1) return 'offsite';
    // OR blocks, plus the PGY-4 attending cataract days (Tabas / Dunn)
    if (/\bOR\b/.test(t) || /\bCataracts\b/.test(t)) return 'or';
    if (t === 'Day Float') return 'dayfloat';
    if ((av.freeTexts || DEFAULT_FREE).indexOf(t) !== -1) return 'free';
    if ((av.dutyTexts || DEFAULT_DUTY).indexOf(t) !== -1) return 'duty';
    return 'clinic';
  }

  function kindOfClass(cls) {
    if (cls === 'surg' || cls === 'or' || cls === 'free') return 'free';
    if (cls === 'duty' || cls === 'dayfloat' || cls === 'offsite') return 'duty';
    if (cls === 'off') return 'off';
    return 'clinic';
  }

  function dutyLabel(cls, text) {
    if (cls === 'surg' || cls === 'or') return text + ', no case';
    if (cls === 'offsite') return text + ' (off-site)';
    return text;
  }

  var REASON_LABELS = {
    vacation: 'Vacation', sick: 'Sick', conference: 'Conference',
    nightfloat: 'Night Float (post-call)', other: 'Out'
  };
  function reasonLabel(r) { return REASON_LABELS[r] || REASON_LABELS.other; }

  function caseLabel(c) {
    if (c && c.late) return trim(c.surgeon);
    var who = trim(c && c.surgeon) || (c && c.category) || 'case';
    return who + ' x' + (Math.max(1, parseInt(c && c.count, 10) || 1));
  }

  /* ------------------------------------------------------------------ */
  /* the board                                                           */
  /* ------------------------------------------------------------------ */

  function build(roster, day, data) {
    data = getData(data);
    roster = roster || {};
    day = day || {};
    var av = data.availability || {};
    var pullFirst = av.pullFirstTexts || DEFAULT_PULL_FIRST;
    var neverPull = av.neverPullTexts || DEFAULT_NEVER_PULL;
    // pull-first clinics need no cover by definition
    var noCover = (av.noCoverTexts || DEFAULT_NO_COVER).concat(pullFirst);

    var byName = {};
    var order = [];
    (roster.residents || []).forEach(function (r) {
      if (r && r.name && !byName[r.name]) { byName[r.name] = r; order.push(r.name); }
    });
    var surgRole = {};
    Object.keys(roster.surg || {}).sort(function (a, b) { return (+a) - (+b); }).forEach(function (n) {
      var s = roster.surg[n];
      if (s && s.name && !surgRole[s.name]) surgRole[s.name] = n;
    });
    var dayFloats = (roster.dayFloat || []).filter(function (n) { return !!byName[n]; });
    var warnings = [];

    var nf = trim(day.nightFloat);
    if (nf && !byName[nf]) {
      warnings.push('Night Float "' + nf + '" is not a resident on this roster — Day Float coverage is not applied');
      nf = '';
    }

    /* who is out: typed absences + the Night Float resident (auto) */
    var absences = [];
    var explicit = {};
    (day.absences || []).forEach(function (a, idx) {
      var name = trim(a && a.name);
      if (!name || !byName[name] || !(a.am || a.pm) || explicit[name]) return;
      explicit[name] = true;
      absences.push({
        id: String((a && a.id) || 'abs' + idx), name: name, am: !!a.am, pm: !!a.pm,
        reason: (a && a.reason) || 'vacation',
        coverAM: trim(a.coverAM), coverPM: trim(a.coverPM), auto: false
      });
    });
    if (nf && !explicit[nf]) {
      var df = dayFloats.filter(function (n) { return n !== nf; })[0] || '';
      absences.push({ id: 'nf', name: nf, am: true, pm: true, reason: 'nightfloat', coverAM: df, coverPM: df, auto: true });
    }
    if (nf && dayFloats.indexOf(nf) !== -1 && dayFloats.length === 1) {
      warnings.push(nf + ' is both Day Float and Night Float this week — no Day Float today');
    }
    var outBy = {};
    absences.forEach(function (a) {
      var o = outBy[a.name] || (outBy[a.name] = {});
      if (a.am) o.am = a;
      if (a.pm) o.pm = a;
    });

    /* absence coverers take over the absent resident's duty that session */
    var coverDuty = {};
    absences.forEach(function (a) {
      ['am', 'pm'].forEach(function (s) {
        if (!a[s]) return;
        var who = s === 'am' ? a.coverAM : a.coverPM;
        if (!who || who === 'NC' || who === a.name || !byName[who]) return;
        var map = coverDuty[who] || (coverDuty[who] = {});
        if (map[s]) {
          warnings.push(who + ' is covering both ' + map[s].for + ' and ' + a.name + ' ' + s.toUpperCase());
          return;
        }
        map[s] = { for: a.name, text: byName[a.name][s].text, nf: a.reason === 'nightfloat' };
        if (outBy[who] && outBy[who][s]) {
          warnings.push(who + ' is covering ' + a.name + ' ' + s.toUpperCase() + ' but is out too');
        }
        if (!map[s].nf && dayFloats.indexOf(who) !== -1) {
          warnings.push(who + ' is Day Float — Day Float covers only the Night Float resident');
        }
      });
    });

    /* clinic staffing edits: added → there; removed from own clinic → not */
    var overrides = day.clinicStaffOverrides || {};
    var addedTo = {};   // name -> { am: label, pm: label }
    var removedFrom = {}; // 'label|session|name' -> true
    Object.keys(overrides).forEach(function (k) {
      var parts = k.split('|');
      var label = parts[0];
      var sess = parts[1];
      if (sess !== 'am' && sess !== 'pm') return; // CPEC PO 'day' row is a post-op check, not a session
      if (classifyText(label, data) !== 'clinic') return;
      var ov = overrides[k] || {};
      (ov.added || []).forEach(function (n) {
        if (!byName[n]) return;
        var m = addedTo[n] || (addedTo[n] = {});
        if (!m[sess]) m[sess] = label;
      });
      (ov.removed || []).forEach(function (n) { removedFrom[label + '|' + sess + '|' + n] = true; });
    });

    // pullFirst / neverPull ride on the status of whatever text they are on
    function flagged(bd) {
      if (bd.kind === 'clinic' && pullFirst.indexOf(bd.text) !== -1) bd.pullFirst = true;
      if (bd.kind !== 'out' && neverPull.indexOf(bd.text) !== -1) bd.neverPull = true;
      return bd;
    }

    function baseDutyOf(name, s) {
      return flagged(baseDutyRaw(name, s));
    }

    function baseDutyRaw(name, s) {
      var res = byName[name];
      var o = outBy[name] && outBy[name][s];
      if (o) {
        return { kind: 'out', text: res[s].text, label: reasonLabel(o.reason), absence: o };
      }
      var cd = coverDuty[name] && coverDuty[name][s];
      if (cd) {
        var ccls = classifyText(cd.text, data);
        var ck = kindOfClass(ccls);
        // Day Float stands in for the Night Float resident and is never
        // treated as available, even when that duty is PT.
        if (cd.nf && ck === 'free') ck = 'duty';
        return {
          kind: ck, cls: ccls, text: cd.text, covering: cd.for, nfCover: cd.nf,
          label: (cd.nf ? 'Day Float for ' : 'for ') + cd.for + ': ' + cd.text
        };
      }
      var added = addedTo[name] && addedTo[name][s];
      var text = res[s].text;
      if (added && added !== text) {
        return { kind: 'clinic', cls: 'clinic', text: added, label: added + ' (added)' };
      }
      var cls = classifyText(text, data);
      if (cls === 'dayfloat') {
        return { kind: 'duty', cls: cls, text: text, label: nf ? 'Day Float' : 'Day Float (Night Float not set)' };
      }
      if (cls === 'clinic' && removedFrom[text + '|' + s + '|' + name]) {
        return { kind: 'free', cls: 'free', text: text, label: 'removed from ' + text };
      }
      return { kind: kindOfClass(cls), cls: cls, text: text, label: dutyLabel(cls, text) };
    }

    var base = {};
    order.forEach(function (n) { base[n] = { am: baseDutyOf(n, 'am'), pm: baseDutyOf(n, 'pm') }; });

    /* A morning OR running late (live board only — never in the copied
       schedule): the resident stays in the OR from PM clinic start
       (data.pmClinicStart, 12:30) until `until`, and `cover` stands in at
       their clinic meanwhile. Modelled as a case whose backup is the cover,
       so gaps, cover and 'NC' work exactly as for any case. */
    var pmClinicStart = parseClock(data.pmClinicStart);
    if (pmClinicStart == null) pmClinicStart = NOON + 30;
    var lateCases = [];
    (day.overruns || []).forEach(function (o, idx) {
      var who = trim(o && o.name);
      var until = parseClock(o && o.until);
      if (!who || !byName[who] || until == null || until <= pmClinicStart) return;
      lateCases.push({
        id: 'late:' + String((o && o.id) || idx), late: true, overrunId: String((o && o.id) || idx),
        surgeon: (trim(o && o.label) || 'OR') + ' running late', count: 1, serviceCount: 1,
        start: fmtHHMM(pmClinicStart), until: fmtHHMM(until), category: 'other',
        assigned: who, backup: trim(o && o.cover)
      });
    });
    var allCases = (day.cases || []).concat(lateCases);

    /* cases → busy spans for the assigned resident */
    var caseInfo = {};
    var casesBy = {};
    allCases.forEach(function (c) {
      if (!c || !c.id) return;
      var cs = caseSpans(c, data);
      var a = trim(c.assigned);
      caseInfo[c.id] = {
        c: c, spans: cs.spans, start: cs.start, end: cs.end,
        estimated: cs.estimated, unknownStart: cs.unknownStart, svcAssumed: cs.svcAssumed,
        done: cs.done, assigned: a, backup: trim(c.backup)
      };
      if (a && byName[a]) {
        cs.spans.forEach(function (sp) {
          (casesBy[a] || (casesBy[a] = [])).push({ start: sp.start, end: sp.end, caseId: c.id });
        });
      }
    });

    function slotIdx(t) { return Math.floor((t - DAY_START) / SLOT); }
    function slotT(i) { return DAY_START + i * SLOT + SLOT / 2; }

    function caseAt(name, t, exclude) {
      var l = casesBy[name] || [];
      for (var i = 0; i < l.length; i++) {
        if (l[i].caseId !== exclude && l[i].start <= t && t < l[i].end) return l[i];
      }
      return null;
    }

    /* clinic coverage through case backups. If R is pulled into a case while
       due in a clinic (their own, or one they are covering), the case's
       backup B covers that clinic for the case's length. Chains resolve to
       the ORIGINAL owner: B covering for R who was covering for Bair means
       B is covering Bair's clinic. Iterate to a fixed point. */
    var coverRole = {};
    var changed = true;
    var guard = 0;
    while (changed && guard++ < 12) {
      changed = false;
      allCases.forEach(function (c) {
        var info = c && caseInfo[c.id];
        if (!info) return;
        var R = info.assigned;
        var B = info.backup;
        if (!R || !B || B === 'NC' || B === R || !byName[R] || !byName[B]) return;
        info.spans.forEach(function (sp) {
          var i0 = Math.max(0, slotIdx(sp.start));
          var i1 = Math.min(NSLOTS - 1, slotIdx(sp.end - 1));
          for (var i = i0; i <= i1; i++) {
            var bd = base[R][sessionOf(slotT(i))];
            var need = null;
            if (bd.kind === 'clinic') need = { clinic: bd.text, for: bd.covering || R };
            else if (coverRole[R] && coverRole[R][i]) need = { clinic: coverRole[R][i].clinic, for: coverRole[R][i].for };
            if (!need) continue;
            var map = coverRole[B] || (coverRole[B] = {});
            var cur = map[i];
            if (!cur || cur.clinic !== need.clinic || cur.for !== need.for) {
              map[i] = { clinic: need.clinic, for: need.for, pulled: R, caseId: c.id };
              changed = true;
            }
          }
        });
      });
    }

    // opts.exclude: ignore this case id (and coverage it creates) — used when
    // judging who could take / back up that very case.
    function statusAt(name, t, opts) {
      var exclude = opts && opts.exclude;
      if (!byName[name]) return { kind: 'off', label: '' };
      var s = sessionOf(t);
      var bd = base[name][s];
      if (bd.kind === 'out') return { kind: 'out', label: bd.label, session: s, absence: bd.absence };
      var ca = caseAt(name, t, exclude);
      if (ca) {
        var inf = caseInfo[ca.caseId];
        return {
          kind: 'case', label: caseLabel(inf.c), caseId: ca.caseId, session: s,
          start: ca.start, until: ca.end, estimated: inf.estimated
        };
      }
      var i = slotIdx(t);
      var cr = (i >= 0 && i < NSLOTS && coverRole[name]) ? coverRole[name][i] : null;
      if (cr && cr.caseId !== exclude) {
        return {
          kind: 'clinic', label: 'covering ' + cr.clinic + ' for ' + cr.for, clinic: cr.clinic,
          covering: cr.for, caseId: cr.caseId, session: s, viaCase: true,
          pullFirst: pullFirst.indexOf(cr.clinic) !== -1, neverPull: neverPull.indexOf(cr.clinic) !== -1
        };
      }
      return {
        kind: bd.kind, label: bd.label, text: bd.text, cls: bd.cls, covering: bd.covering || null,
        clinic: bd.kind === 'clinic' ? bd.text : null, session: s, nfCover: !!bd.nfCover,
        pullFirst: !!bd.pullFirst, neverPull: !!bd.neverPull
      };
    }

    /* per-slot grid, computed once */
    var grid = {};
    order.forEach(function (n) {
      var row = [];
      for (var i = 0; i < NSLOTS; i++) row.push(statusAt(n, slotT(i)));
      grid[n] = row;
    });

    function segments(name) {
      var row = grid[name] || [];
      var out = [];
      row.forEach(function (st, i) {
        var last = out[out.length - 1];
        if (last && last.kind === st.kind && last.label === st.label) {
          last.end = DAY_START + (i + 1) * SLOT;
        } else {
          out.push({ start: DAY_START + i * SLOT, end: DAY_START + (i + 1) * SLOT, kind: st.kind, label: st.label, status: st });
        }
      });
      return out;
    }

    // Worst status over a set of statuses. neverPull if ANY part is on a
    // never-pull duty; pullFirst only if EVERY clinic part is a pull-first
    // clinic (half an hour in Retina and half in Cornea still needs cover).
    function worstOf(list) {
      var worst = null;
      var anyNever = false;
      var allPull = true;
      list.forEach(function (st) {
        if (st.neverPull) anyNever = true;
        if (st.kind === 'clinic' && !st.pullFirst) allPull = false;
        // name the clinic that does need cover when a window spans both
        var coverFirst = worst && st.kind === 'clinic' && worst.kind === 'clinic' && worst.pullFirst && !st.pullFirst;
        if (!worst || RANK[st.kind] > RANK[worst.kind] || coverFirst) worst = st;
      });
      if (!worst) return null;
      var out = {};
      for (var k in worst) out[k] = worst[k];
      out.neverPull = anyNever;
      out.pullFirst = out.kind === 'clinic' && allPull;
      return out;
    }

    // Worst status over [start, end) — the answer to "can X do this?".
    // Samples every slot plus the last minute, so short cases are caught.
    function statusDuring(name, start, end, opts) {
      if (!byName[name]) return { kind: 'off', label: '' };
      var times = [];
      for (var t = start; t < end && times.length < 300; t += SLOT) times.push(t);
      if (end - 1 > start) times.push(end - 1);
      if (!times.length) times.push(start);
      return worstOf(times.map(function (tt) { return statusAt(name, tt, opts); }));
    }

    function statusDuringSpans(name, spans, opts) {
      var w = worstOf((spans || []).map(function (sp) { return statusDuring(name, sp.start, sp.end, opts); }));
      return w || { kind: 'off', label: '' };
    }

    function freeAt(t) {
      return order.filter(function (n) { return statusAt(n, t).kind === 'free'; });
    }

    // Session availability: fully free for the whole session, or free for
    // part of it (with the free ranges).
    function freeInSession(s) {
      var from = s === 'am' ? DAY_START : NOON;
      var to = s === 'am' ? NOON : DAY_END;
      var out = [];
      order.forEach(function (n) {
        var row = grid[n];
        var ranges = [];
        var all = true;
        for (var i = slotIdx(from); i < slotIdx(to); i++) {
          var st = row[i];
          if (st.kind === 'free') {
            var t0 = DAY_START + i * SLOT;
            var last = ranges[ranges.length - 1];
            if (last && last.end === t0) last.end = t0 + SLOT;
            else ranges.push({ start: t0, end: t0 + SLOT });
          } else {
            all = false;
          }
        }
        if (ranges.length) out.push({ name: n, full: all, ranges: ranges, label: base[n][s].label });
      });
      return out;
    }

    // Who can be given something to do in a session (chief, 9/28/2026: "a
    // place to say available in AM and then another part that says
    // available in PM … to be able to on the fly find assignments"): free
    // for all or part of it (PT, a Surg role / OR block with nothing booked,
    // done with their service case) → group 'free'; else in a pull-first
    // clinic (Retina / Uveitis — no cover needed) → group 'pull'. Stretches
    // shorter than minMinutes (default 30) are left out. Never anyone out,
    // in a case, on a fixed duty, off-site, on Path, or in another clinic.
    // `gaps`: what fills the rest of the session, for "except 10:15–10:45
    // (Henry x10)".
    function availableInSession(s, opts) {
      var min = (opts && opts.minMinutes) || 30;
      // the AM counts from 7:30, when the OR day starts — the half hour
      // before a 7:30 list is not time anyone can be given (ASSUMPTION)
      var from = s === 'am' ? DAY_START + 30 : NOON;
      var to = s === 'am' ? NOON : DAY_END;
      var out = [];
      function add(list, t0, extra) {
        var last = list[list.length - 1];
        if (last && last.end === t0 && (!extra || last.label === extra)) last.end = t0 + SLOT;
        else list.push(extra ? { start: t0, end: t0 + SLOT, label: extra } : { start: t0, end: t0 + SLOT });
      }
      order.forEach(function (n) {
        var row = grid[n];
        var free = [];
        var pull = [];
        var other = [];
        for (var i = slotIdx(from); i < slotIdx(to); i++) {
          var st = row[i];
          var t0 = DAY_START + i * SLOT;
          if (!st.neverPull && st.kind === 'free') add(free, t0);
          else if (!st.neverPull && st.kind === 'clinic' && st.pullFirst) add(pull, t0);
          else add(other, t0, st.label);
        }
        function keep(list) { return list.filter(function (r) { return r.end - r.start >= min; }); }
        free = keep(free);
        pull = keep(pull);
        var ranges = free.length ? free : pull;
        if (!ranges.length) return;
        var st0 = base[n][s];
        out.push({
          name: n, group: free.length ? 'free' : 'pull', ranges: ranges, from: from, to: to,
          full: ranges.length === 1 && ranges[0].start === from && ranges[0].end === to,
          label: st0.label, text: st0.text, gaps: other
        });
      });
      return out;
    }

    /* what still needs covering */
    var needs = [];
    absences.forEach(function (a) {
      ['am', 'pm'].forEach(function (s) {
        if (!a[s]) return;
        var who = s === 'am' ? a.coverAM : a.coverPM;
        var text = byName[a.name][s].text;
        if (!trim(text) || noCover.indexOf(text) !== -1 || who === 'NC' || who) return;
        needs.push({
          type: 'absence', name: a.name, session: s, duty: text,
          absenceId: a.id, auto: a.auto, reason: a.reason
        });
      });
    });

    // Clinic gaps: somebody due in a clinic (per the effective staffing, or
    // covering an absent resident's clinic) who is not there, with nobody
    // covering in their place. Absences without coverage are reported above;
    // a case backup of 'NC' acknowledges the gap.
    var expected = [];
    Object.keys(roster.clinics || {}).forEach(function (label) {
      if (classifyText(label, data) !== 'clinic') return;
      if (noCover.indexOf(label) !== -1) return; // Retina / Uveitis: nobody backfills
      ['am', 'pm'].forEach(function (s) {
        var grp = (roster.clinics[label] || {})[s] || [];
        var names = grp.map(function (p) { return typeof p === 'string' ? p : p && p.name; });
        var ov = overrides[label + '|' + s] || {};
        names = names.filter(function (n) { return (ov.removed || []).indexOf(n) === -1; });
        (ov.added || []).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
        names.forEach(function (n) { if (byName[n]) expected.push({ holder: n, owner: n, clinic: label, session: s }); });
      });
    });
    // added to a clinic that has no roster group today
    Object.keys(addedTo).forEach(function (n) {
      ['am', 'pm'].forEach(function (s) {
        var label = addedTo[n][s];
        if (!label || (roster.clinics || {})[label] || noCover.indexOf(label) !== -1) return;
        expected.push({ holder: n, owner: n, clinic: label, session: s });
      });
    });
    order.forEach(function (n) {
      ['am', 'pm'].forEach(function (s) {
        var bd = base[n][s];
        if (bd.kind === 'clinic' && bd.covering && noCover.indexOf(bd.text) === -1) expected.push({ holder: n, owner: bd.covering, clinic: bd.text, session: s });
      });
    });

    // A gap is acknowledged when the chain of cover ends in 'NC': the pulled
    // resident's case says NC, or its backup was pulled into a case that
    // says NC, and so on.
    function chainAcked(st, i, depth) {
      if (depth > 8 || !st || st.kind !== 'case') return false;
      var info = caseInfo[st.caseId];
      if (!info) return false;
      if (info.backup === 'NC') return true;
      if (!info.backup || !grid[info.backup]) return false;
      return chainAcked(grid[info.backup][i], i, depth + 1);
    }

    var seenExpected = {};
    expected.forEach(function (ex) {
      var exKey = ex.holder + '|' + ex.owner + '|' + ex.clinic + '|' + ex.session;
      if (seenExpected[exKey]) return;
      seenExpected[exKey] = true;
      var from = ex.session === 'am' ? DAY_START : NOON;
      var to = ex.session === 'am' ? NOON : DAY_END;
      if (base[ex.holder][ex.session].kind === 'out') return; // absence — reported above / NC
      var open = null;
      for (var i = slotIdx(from); i < slotIdx(to); i++) {
        var st = grid[ex.holder][i];
        var there = st.kind === 'clinic' && st.clinic === ex.clinic && (st.covering || ex.holder) === ex.owner;
        var coveredBy = null;
        for (var k = 0; k < order.length && !there && !coveredBy; k++) {
          var m = order[k];
          if (m === ex.holder) continue;
          var sm = grid[m][i];
          if (sm.kind === 'clinic' && sm.clinic === ex.clinic && sm.covering === ex.owner) coveredBy = m;
        }
        var acked = chainAcked(st, i, 0);
        if (there || coveredBy || acked) { open = null; continue; }
        var t0 = DAY_START + i * SLOT;
        var cause = st.caseId || st.label;
        if (open && open.end === t0 && open.cause === cause) { open.end = t0 + SLOT; continue; }
        open = {
          type: 'clinic', holder: ex.holder, owner: ex.owner, clinic: ex.clinic, session: ex.session,
          start: t0, end: t0 + SLOT,
          why: st.kind === 'case' ? 'in ' + st.label
            : st.covering ? 'covering ' + st.covering + ' (' + (st.clinic || st.text || '') + ')' : st.label,
          whyKind: st.kind, caseId: st.caseId || null, cause: cause
        };
        needs.push(open);
      }
    });

    // ER first (chief, 9/29/2026: "the ER is sacred, it is the first thing
    // that needs to be staffed by residents"); the order is otherwise kept.
    needs.forEach(function (n, i) { n.erFirst = n.type === 'absence' && n.duty === 'ER'; n._i = i; });
    needs.sort(function (a, b) { return (b.erFirst ? 1 : 0) - (a.erFirst ? 1 : 0) || a._i - b._i; });
    needs.forEach(function (n) { delete n._i; });

    return {
      date: roster.date,
      order: order,
      byName: byName,
      surgRole: surgRole,
      nightFloat: nf,
      dayFloats: dayFloats,
      absences: absences,
      base: base,
      caseInfo: caseInfo,
      warnings: warnings,
      needs: needs,
      statusAt: statusAt,
      statusDuring: statusDuring,
      statusDuringSpans: statusDuringSpans,
      segments: segments,
      freeAt: freeAt,
      freeInSession: freeInSession,
      availableInSession: availableInSession,
      pullFirstTexts: pullFirst,
      neverPullTexts: neverPull,
      isOut: function (name, s) { return !!(outBy[name] && outBy[name][s]); },
      caseSpansFor: function (c) { return caseSpans(c, data); },
      dayStart: DAY_START,
      noon: NOON,
      dayEnd: DAY_END,
      pmClinicStart: pmClinicStart,
      lateCases: lateCases
    };
  }

  var Status = {
    DAY_START: DAY_START,
    NOON: NOON,
    DAY_END: DAY_END,
    RANK: RANK,
    clockTokens: clockTokens,
    parseClock: parseClock,
    fmtClock: fmtClock,
    fmtHHMM: fmtHHMM,
    sessionOf: sessionOf,
    perCaseMinutes: perCaseMinutes,
    caseSpans: caseSpans,
    overlaps: overlaps,
    classifyText: classifyText,
    kindOfClass: kindOfClass,
    reasonLabel: reasonLabel,
    build: build
  };

  if (typeof window !== 'undefined') window.Status = Status;
  if (typeof module !== 'undefined' && module.exports) module.exports = Status;
})();
