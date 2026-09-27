/*
 * assign.js — case → resident suggestion engine.
 * Defines window.Assign (browser) / module.exports (Node).
 * Plain script, no ES modules. Loaded after js/data.js.
 *
 * Assign.classify(caseObj)          -> hierarchy key string
 * Assign.suggest(cases, roster, data, board)
 *                                   -> [{ caseId, name, reasons, warnings, alternates, skipped }]
 * Assign.clinicCoverage(roster)     -> [{ name, source }] PM clinic-coverage chain
 * Assign.backupPlan(case, roster, data, cases, board)
 *                                   -> who covers the clinic the case pulls someone from
 * Assign.planAddOn(kind, t, roster, data, board)
 *                                   -> "a globe comes in at t": who takes it, who covers
 *
 * `board` (optional) is a Status board (js/status.js). Without it, suggest /
 * backupPlan behave exactly as before (chain order only). With it they are
 * availability-aware, per the how-to: anyone out or already in a case at
 * that time is skipped ("skip for now"), skipped cases fall through to the
 * remaining-cases chain, then to any free senior, then any free junior;
 * "free junior" resolves to actual free PGY-2/3s.
 *
 * All functions accept an optional `data` argument (the SCHED_DATA
 * object); otherwise they fall back to window.SCHED_DATA / require('./data.js').
 */
(function () {
  'use strict';

  var FREE_JUNIOR_LABEL = "free junior — Surg 2's discretion";

  function getData(data) {
    if (data) return data;
    if (typeof window !== 'undefined' && window.SCHED_DATA) return window.SCHED_DATA;
    if (typeof require !== 'undefined') return require('./data.js');
    return null;
  }

  function getStatus() {
    if (typeof window !== 'undefined' && window.Status) return window.Status;
    if (typeof require !== 'undefined') {
      try { return require('./status.js'); } catch (e) { return null; }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* classify                                                            */
  /* ------------------------------------------------------------------ */

  function classify(caseObj, data) {
    var cat = (caseObj && caseObj.category) || '';
    var addOn = !!(caseObj && caseObj.addOn);
    if (cat === 'peds') return 'peds';
    // Add-ons at JHN/Gibbon/Jeff Surgicenter go to Surg 2 first.
    if (addOn && caseObj && caseObj.section === 'jhn') return 'jhnAddOn';
    if (cat === 'cornea' && addOn) return 'addOnCornea';
    if (cat === 'glaucoma' && addOn) return 'addOnGlaucoma';
    if (cat === 'cataract' && addOn) return 'addOnCataract';
    // Plastics add-ons get their own chain (juniors first) when the data
    // carries one; older/imported configurations keep the combined chain.
    if (cat === 'plastics' && addOn) {
      var d = getData(data);
      return (d && d.hierarchy && d.hierarchy.plasticsAddOn) ? 'plasticsAddOn' : 'traumaPlasticsAddOn';
    }
    if (cat === 'trauma') return 'traumaPlasticsAddOn';
    if (cat === 'plastics') return 'scheduledPlastics';
    if (cat === 'cornea') return 'scheduledCornea';
    if (cat === 'glaucoma') return 'scheduledGlaucoma';
    if (cat === 'cataract') return 'scheduledCataract';
    return 'remaining';
  }

  function needsResident(caseObj) {
    return ((caseObj && caseObj.serviceCount) | 0) > 0;
  }

  /* ------------------------------------------------------------------ */
  /* small helpers                                                       */
  /* ------------------------------------------------------------------ */

  // First time token in the start text -> HHMM number:
  // '0730' / '7:30' / '730' -> 730; '730, 915 (x1 service)' -> 730;
  // '0730-0900' -> 730; the CPEC sheet's '1:00' -> 1300 (afternoon — see
  // Status.clockTokens). No time token -> null.
  function startNum(caseObj) {
    var S = getStatus();
    var start = String((caseObj && caseObj.start) || '');
    if (S) {
      var t = S.parseClock(start);
      return t === null ? null : Math.floor(t / 60) * 100 + (t % 60);
    }
    var m = /(\d{1,2}):?(\d{2})/.exec(start);
    if (!m) return null;
    var h = +m[1];
    if (h >= 1 && h <= 6 && m[1].charAt(0) !== '0') h += 12;
    return h * 100 + (+m[2]);
  }

  // normalized 4-char start string (from the same first-token parse) for
  // chronological string sort; unknown last
  function startKey(caseObj) {
    var n = startNum(caseObj);
    if (n === null) return '9999';
    return ('0000' + n).slice(-4);
  }

  function sessionOf(caseObj) {
    var n = startNum(caseObj);
    if (n === null) return 'am';
    return n >= 1230 ? 'pm' : 'am';
  }

  function spansDay(caseObj) {
    var n = startNum(caseObj);
    return n !== null && n <= 730 && ((caseObj.count | 0) >= 4);
  }

  // A resolved roster cell counts as a "clinic" unless it is Surg N / CPEC /
  // ER / PT / an OR block / a consult-or-float assignment (mirrors the
  // engine's clinic-grouping exclusions).
  function isClinicText(text) {
    var t = String(text || '').trim();
    if (!t) return false;
    if (/^Surg \d/.test(t)) return false;
    if (t === 'CPEC' || t === 'ER' || t === 'PT') return false;
    if (t.indexOf('OR') !== -1) return false;
    if (t === 'Jeff Consults' || t === 'Cooper Consults' || t === 'Day Float') return false;
    return true;
  }

  function findResident(roster, name) {
    var list = (roster && roster.residents) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].name === name) return list[i];
    }
    return null;
  }

  // People on an OR block (am+pm union by default, dedup, order preserved).
  function orBlockPeople(roster, key, sessions) {
    var blk = roster && roster.orBlocks && roster.orBlocks[key];
    if (!blk) return [];
    var out = [];
    var seen = {};
    (sessions || ['am', 'pm']).forEach(function (sess) {
      (blk[sess] || []).forEach(function (p) {
        var name = typeof p === 'string' ? p : p && p.name;
        if (name && !seen[name]) {
          seen[name] = true;
          out.push({ name: name, year: (p && p.year) || '' });
        }
      });
    });
    return out;
  }

  function clinicPeople(roster, key, sessions) {
    var grp = roster && roster.clinics && roster.clinics[key];
    if (!grp) return [];
    var out = [];
    var seen = {};
    (sessions || ['am', 'pm']).forEach(function (sess) {
      (grp[sess] || []).forEach(function (p) {
        var name = typeof p === 'string' ? p : p && p.name;
        if (name && !seen[name]) {
          seen[name] = true;
          out.push({ name: name, year: (p && p.year) || '' });
        }
      });
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* chain token resolution                                              */
  /* ------------------------------------------------------------------ */

  // -> { label, names: [..], freeJunior?: true }
  // `sessions` (optional, e.g. ['pm']) restricts which roster sessions the
  // OR-block / clinic tokens draw from; case chains use both sessions.
  function resolveToken(token, roster, sessions) {
    var m = /^Surg (\d)$/.exec(token);
    if (m) {
      var slot = roster && roster.surg && roster.surg[m[1]];
      return { label: token, names: slot && slot.name ? [slot.name] : [] };
    }
    if (token === 'PEDS_OR_JUNIOR') {
      var juniors = orBlockPeople(roster, 'Peds OR').filter(function (p) {
        return p.year === 'pgy2' || p.year === 'pgy3';
      });
      return { label: 'junior on Peds OR', names: juniors.map(function (p) { return p.name; }) };
    }
    if (token === 'PLASTICS_OR_PGY2') {
      var firsts = orBlockPeople(roster, 'Plastics OR').filter(function (p) {
        return p.year === 'pgy2';
      });
      return { label: 'PGY-2 on Plastics OR', names: firsts.map(function (p) { return p.name; }) };
    }
    if (token === 'PLASTICS_OR_JUNIOR') {
      var pj = orBlockPeople(roster, 'Plastics OR').filter(function (p) {
        return p.year === 'pgy2' || p.year === 'pgy3';
      });
      return { label: 'junior on Plastics OR (TABs / outpatient plastics only)', names: pj.map(function (p) { return p.name; }) };
    }
    if (token === 'FREE_JUNIOR') {
      // Can't compute "willing" — never a primary suggestion, only an alternate.
      return { label: FREE_JUNIOR_LABEL, names: [], freeJunior: true };
    }
    if (token === 'COOPER') {
      var cooper = (roster && roster.cooperConsults) || [];
      return { label: 'Cooper Consults', names: cooper.length ? [cooper[0]] : [] };
    }
    if (token === 'WILLS_OR') {
      return { label: 'Wills OR', names: orBlockPeople(roster, 'Wills OR', sessions).map(function (p) { return p.name; }) };
    }
    if (token === 'RETINA') {
      var names = [];
      var seen = {};
      orBlockPeople(roster, 'Retina OR', sessions).concat(clinicPeople(roster, 'Retina', sessions)).forEach(function (p) {
        if (!seen[p.name]) { seen[p.name] = true; names.push(p.name); }
      });
      return { label: 'Retina', names: names };
    }
    return { label: token, names: [] };
  }

  // Resolve a whole chain into an ordered candidate list.
  // -> [{ name, via }] real candidates + { freeJunior: true, via } markers.
  function resolveChain(chain, roster) {
    var out = [];
    var seen = {};
    (chain || []).forEach(function (token) {
      var r = resolveToken(token, roster);
      if (r.freeJunior) {
        out.push({ freeJunior: true, via: r.label });
        return;
      }
      r.names.forEach(function (name) {
        if (!seen[name]) {
          seen[name] = true;
          out.push({ name: name, via: r.label });
        }
      });
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* suggest                                                             */
  /* ------------------------------------------------------------------ */

  function processGroup(key) {
    if (key === 'remaining') return 2;
    if (key === 'addOnCornea' || key === 'addOnGlaucoma' || key === 'addOnCataract' ||
        key === 'jhnAddOn' || key === 'traumaPlasticsAddOn' || key === 'plasticsAddOn') return 1;
    return 0; // peds + scheduled specialty + plastics + cataract
  }

  /* ------------------------------------------------------------------ */
  /* availability-aware chain walk (needs a Status board)                */
  /* ------------------------------------------------------------------ */

  function boardYear(board, name) {
    var r = board && board.byName && board.byName[name];
    return (r && r.year) || '';
  }

  function spansOverlap(a, b) {
    for (var i = 0; i < (a || []).length; i++) {
      for (var j = 0; j < (b || []).length; j++) {
        if (a[i].start < b[j].end && b[j].start < a[i].end) return true;
      }
    }
    return false;
  }

  // Residents of the given years who are free for all of `spans`.
  function freeNames(board, spans, selfId, years) {
    var out = [];
    years.forEach(function (y) {
      board.order.forEach(function (n) {
        if (boardYear(board, n) !== y) return;
        if (board.statusDuringSpans(n, spans, { exclude: selfId }).kind === 'free') out.push(n);
      });
    });
    return out;
  }

  // Ordered candidates for one case: its own chain, then (unless it IS the
  // remaining chain) the remaining-cases chain — the how-to's "skip for now,
  // then assign the remaining cases" — then any free senior, then any free
  // junior. requireFree marks people who qualify only by being free right
  // then (free juniors, fall-through).
  function availCandidates(chain, key, roster, data, board, spans, selfId) {
    var hierarchy = (data && data.hierarchy) || {};
    var out = [];
    var seen = {};
    function push(name, via, requireFree, stage, token) {
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push({ name: name, via: via, requireFree: !!requireFree, stage: stage, token: token || '' });
    }
    function addChain(ch, stage) {
      (ch || []).forEach(function (token) {
        if (token === 'FREE_JUNIOR') {
          freeNames(board, spans, selfId, ['pgy2', 'pgy3']).forEach(function (n) {
            push(n, FREE_JUNIOR_LABEL, true, stage, token);
          });
          return;
        }
        var r = resolveToken(token, roster);
        r.names.forEach(function (n) { push(n, r.label, false, stage, token); });
      });
    }
    addChain(chain, 'chain');
    if (key !== 'remaining' && hierarchy.remaining) addChain(hierarchy.remaining.chain, 'remaining');
    freeNames(board, spans, selfId, ['pgy4']).forEach(function (n) { push(n, 'free senior', true, 'fallthrough'); });
    freeNames(board, spans, selfId, ['pgy2', 'pgy3']).forEach(function (n) { push(n, 'free junior', true, 'fallthrough'); });
    return out;
  }

  function busyText(st) {
    var S = getStatus();
    if (!st) return '';
    if (st.kind === 'case' && S && st.until != null) {
      return 'in ' + st.label + ' until ' + S.fmtClock(st.until) + (st.estimated ? ' (est.)' : '');
    }
    if (st.kind === 'case') return 'in ' + st.label;
    return st.label;
  }

  // Walk one case's candidates against the board plus this pass's own
  // suggestions (`extra`: name -> spans). A candidate is skipped only when
  // out, already in a case, or (for requireFree people) not free. Being in
  // clinic does NOT skip a chain member — they are pulled and someone covers
  // (e.g. Surg 2 leaves the clinic they were covering to take a globe).
  function walkCase(c, key, chain, roster, data, board, extra) {
    var spans = board.caseSpansFor(c).spans;
    var cands = availCandidates(chain, key, roster, data, board, spans, c.id);
    var steps = [];
    var primary = null;
    var primaryStatus = null;
    var alternates = [];
    cands.forEach(function (cand) {
      var st = board.statusDuringSpans(cand.name, spans, { exclude: c.id });
      var why = null;
      if (st.kind === 'out') why = st.label;
      else if (st.kind === 'case') why = busyText(st);
      else if (spansOverlap(extra[cand.name], spans)) why = 'suggested for another case at this time';
      else if (cand.requireFree && st.kind !== 'free') why = st.label;
      if (!why && !primary) { primary = cand; primaryStatus = st; }
      else if (!why) alternates.push(cand.name);
      steps.push({
        name: cand.name, via: cand.via, stage: cand.stage, token: cand.token, status: st,
        verdict: why ? 'skip' : (primary === cand ? 'take' : 'alt'), why: why
      });
    });
    return { primary: primary, primaryStatus: primaryStatus, steps: steps, alternates: alternates, spans: spans };
  }

  // Where would `name` have been during `spans` — which clinic (theirs, or
  // one they are covering) this case pulls them out of, and for how long.
  function pulledClinic(board, name, spans, excludeId) {
    var found = null;
    (spans || []).forEach(function (sp) {
      for (var t = sp.start; t < sp.end; t += 5) {
        var st = board.statusAt(name, t, { exclude: excludeId });
        if (st.kind !== 'clinic') continue;
        if (!found) found = { clinic: st.clinic, owner: st.covering || name, start: t, end: t + 5, session: st.session };
        else if (st.clinic === found.clinic) found.end = Math.max(found.end, t + 5);
      }
    });
    return found;
  }

  // Who covers `pulled.clinic` over its window: the clinic-coverage chain
  // (Surg 2 → Surg 3 → Surg 4 → Cooper → Surg 1 → Surg 5 → Wills OR →
  // Retina), then any free senior, then any free junior. A coverer must be
  // free (not out, in a case, or already in a clinic); the Cooper resident on
  // consults may cover because the how-to names them.
  function findClinicCover(pulled, roster, data, board, excludeNames, excludeId) {
    var hierarchy = (data && data.hierarchy) || {};
    var chain = (hierarchy.clinicCoverage && hierarchy.clinicCoverage.chain) || [];
    var seen = {};
    (excludeNames || []).forEach(function (n) { seen[n] = true; });
    var cands = [];
    chain.forEach(function (token) {
      if (token === 'FREE_JUNIOR') return;
      var r = resolveToken(token, roster, [pulled.session || 'pm']);
      r.names.forEach(function (n) {
        if (seen[n]) return;
        seen[n] = true;
        cands.push({ name: n, source: r.label, token: token });
      });
    });
    var spans = [{ start: pulled.start, end: pulled.end }];
    freeNames(board, spans, excludeId, ['pgy4']).forEach(function (n) {
      if (!seen[n]) { seen[n] = true; cands.push({ name: n, source: 'free senior', token: '' }); }
    });
    freeNames(board, spans, excludeId, ['pgy2', 'pgy3']).forEach(function (n) {
      if (!seen[n]) { seen[n] = true; cands.push({ name: n, source: 'free junior', token: '' }); }
    });
    var steps = [];
    var ok = [];
    cands.forEach(function (cand) {
      var st = board.statusDuring(cand.name, pulled.start, pulled.end, { exclude: excludeId });
      var fine = st.kind === 'free' || (st.kind === 'duty' && cand.token === 'COOPER');
      steps.push({ name: cand.name, source: cand.source, status: st, verdict: fine ? (ok.length ? 'alt' : 'take') : 'skip', why: fine ? null : busyText(st) });
      if (fine) ok.push(cand);
    });
    return {
      primary: ok[0] ? { name: ok[0].name, source: ok[0].source } : null,
      second: ok[1] ? { name: ok[1].name, source: ok[1].source } : null,
      steps: steps
    };
  }

  // One case, availability-aware (the board path of suggest()).
  function suggestWithBoard(c, key, hier, chain, roster, data, board, extra, load) {
    var w = walkCase(c, key, chain, roster, data, board, extra);
    var takeIdx = -1;
    w.steps.forEach(function (s, i) { if (takeIdx === -1 && s.verdict === 'take') takeIdx = i; });
    var skipped = w.steps.filter(function (s, i) {
      return s.verdict === 'skip' && (takeIdx === -1 ? s.stage === 'chain' : i < takeIdx);
    }).map(function (s) { return { name: s.name, via: s.via, why: s.why }; });

    if (!w.primary) {
      return {
        caseId: c.id, name: '', status: null, skipped: skipped, alternates: [],
        reasons: [hier.label + ' — nobody in the chain is free then'],
        warnings: ['Everyone in the chain is out or already in a case at this time — and nobody else is free']
      };
    }
    var p = w.primary;
    var st = w.primaryStatus;
    var reasons = [hier.label + ' → ' + p.via + (p.stage === 'remaining' ? ' (remaining-cases chain)' : '')];
    var warnings = [];
    if (p.via === FREE_JUNIOR_LABEL || p.via === 'free junior') {
      warnings.push(p.name + ' is a free junior — confirm with Surg 2 (their discretion)');
    }
    if (st && st.kind === 'clinic') {
      warnings.push(p.name + ' leaves ' + (st.clinic || 'clinic') + (st.covering && st.covering !== p.name ? ' (covering for ' + st.covering + ')' : '') + ' — needs a backup');
    } else if (st && st.kind === 'duty') {
      warnings.push(p.name + ' is on ' + st.label);
    }
    var nextName = w.alternates[0] || null;
    var primaryLoad = load[p.name] || 0;
    if (nextName !== null && primaryLoad >= (load[nextName] || 0) + 2) {
      warnings.push(p.name + ' already has ' + primaryLoad + ' cases — consider next in chain (' + nextName + ')');
    }
    if (board.caseSpansFor(c).unknownStart) warnings.push('No start time — assumed 7:30 AM');
    if (!trimStr(c.assigned)) {
      extra[p.name] = (extra[p.name] || []).concat(w.spans);
      load[p.name] = primaryLoad + 1;
    }
    return {
      caseId: c.id, name: p.name, status: st, skipped: skipped,
      reasons: reasons, warnings: warnings, alternates: w.alternates.slice(0, 6)
    };
  }

  function trimStr(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  function suggest(cases, roster, data, board) {
    data = getData(data);
    var hierarchy = (data && data.hierarchy) || {};
    var results = [];
    var extra = {}; // board path: name -> spans suggested earlier in this pass

    // Load = # of cases per resident this pass (pre-existing manual
    // assignments count from the start).
    var load = {};
    (cases || []).forEach(function (c) {
      if (c && c.assigned) load[c.assigned] = (load[c.assigned] || 0) + 1;
    });

    // Process order: peds & scheduled first, then add-ons, then remaining
    // chronologically (string sort on normalized 24h start).
    var entries = (cases || []).map(function (c, i) {
      return { c: c, i: i, key: classify(c, data) };
    });
    entries.sort(function (a, b) {
      var ga = processGroup(a.key);
      var gb = processGroup(b.key);
      if (ga !== gb) return ga - gb;
      if (ga === 2) {
        var ka = startKey(a.c);
        var kb = startKey(b.c);
        if (ka !== kb) return ka < kb ? -1 : 1;
      }
      return a.i - b.i; // stable
    });

    entries.forEach(function (entry) {
      var c = entry.c;
      if (!c) return;

      if (!needsResident(c)) {
        results.push({
          caseId: c.id,
          name: '',
          reasons: ['private — no resident needed'],
          warnings: [],
          alternates: []
        });
        return;
      }

      var hier = hierarchy[entry.key] || { label: entry.key, chain: [] };
      var chain = hier.chain || [];
      // The junior on Plastics OR takes only TABs / outpatient plastics
      // add-ons — real trauma skips them and starts at Surg 2.
      if (entry.key === 'traumaPlasticsAddOn' && c.category === 'trauma') {
        chain = chain.filter(function (t) { return t !== 'PLASTICS_OR_JUNIOR'; });
      }

      if (board) {
        results.push(suggestWithBoard(c, entry.key, hier, chain, roster, data, board, extra, load));
        return;
      }

      var candidates = resolveChain(chain, roster);

      var primary = null;
      var alternates = [];
      var nextName = null;
      for (var i = 0; i < candidates.length; i++) {
        var cand = candidates[i];
        if (cand.freeJunior) {
          alternates.push(cand.via);
          continue;
        }
        if (!primary) {
          primary = cand;
        } else {
          if (nextName === null) nextName = cand.name;
          alternates.push(cand.name);
        }
      }

      if (!primary) {
        results.push({
          caseId: c.id,
          name: '',
          reasons: [hier.label + ' — no one in the chain is available today'],
          warnings: ['No resident resolvable from the hierarchy chain'],
          alternates: alternates
        });
        return;
      }

      var reasons = [hier.label + ' → ' + primary.via];
      var warnings = [];

      // Load-balance: still suggest the first choice, but warn.
      var primaryLoad = load[primary.name] || 0;
      if (nextName !== null && primaryLoad >= (load[nextName] || 0) + 2) {
        warnings.push(primary.name + ' already has ' + primaryLoad +
          ' cases — consider next in chain (' + nextName + ')');
      }

      // Session conflicts.
      var sess = sessionOf(c);
      var spans = spansDay(c);
      if (spans) {
        warnings.push('x' + c.count + ' starting ' + c.start + ' — likely spans AM and PM');
      }
      var sessions = spans ? ['am', 'pm'] : [sess];
      var resident = findResident(roster, primary.name);
      if (resident) {
        sessions.forEach(function (s) {
          var cell = resident[s];
          var text = cell && cell.text;
          if (isClinicText(text)) {
            warnings.push(primary.name + ' is in ' + text + ' clinic ' + s.toUpperCase());
          }
        });
      }

      // Count the suggestion toward this pass's load (unless the case already
      // carries a manual assignment, which was pre-counted above).
      if (!c.assigned) load[primary.name] = primaryLoad + 1;

      results.push({
        caseId: c.id,
        name: primary.name,
        reasons: reasons,
        warnings: warnings,
        alternates: alternates
      });
    });

    return results;
  }

  /* ------------------------------------------------------------------ */
  /* clinicCoverage                                                      */
  /* ------------------------------------------------------------------ */

  function clinicCoverage(roster, data) {
    data = getData(data);
    var chain = (data && data.hierarchy && data.hierarchy.clinicCoverage &&
      data.hierarchy.clinicCoverage.chain) || [];
    var out = [];
    var seen = {};
    chain.forEach(function (token) {
      // PM clinic coverage: draw OR-block / clinic tokens from the PM session.
      var r = resolveToken(token, roster, ['pm']);
      if (r.freeJunior) return;
      r.names.forEach(function (name) {
        if (!seen[name]) {
          seen[name] = true;
          out.push({ name: name, source: r.label });
        }
      });
    });
    return out;
  }

  // Backup plan per Step 3 of the how-to: when the assigned resident staffs a
  // PM clinic that this case could pull them out of, the first free name in
  // the clinic-coverage chain covers the clinic; the next is the 2nd backup.
  // Returns { clinic, primary: {name, source}, second: {name, source}|null }
  // or null when no coverage is needed / nobody is free.
  // With a board: returns { clinic, owner, window: {start,end,session},
  // primary: {name, source}|null, second, steps } — primary is null when
  // nobody is free to cover (the UI says so rather than hiding the problem).
  function backupPlan(caseObj, roster, data, allCases, board) {
    var assigned = String((caseObj && caseObj.assigned) || '').replace(/^\s+|\s+$/g, '');
    if (!assigned) return null;
    if (board) {
      data = getData(data);
      if (!board.byName[assigned]) return null;
      var spans = board.caseSpansFor(caseObj).spans;
      var pulled = pulledClinic(board, assigned, spans, caseObj.id);
      if (!pulled) return null;
      var cover = findClinicCover(pulled, roster, data, board, [assigned], caseObj.id);
      return {
        clinic: pulled.clinic, owner: pulled.owner, window: pulled,
        primary: cover.primary, second: cover.second, steps: cover.steps
      };
    }
    var res = findResident(roster, assigned);
    if (!res) return null;
    var pmText = (res.pm && res.pm.text) || '';
    if (!isClinicText(pmText)) return null;
    // An AM-only case that won't span the day doesn't threaten the PM clinic.
    if (sessionOf(caseObj) === 'am' && !spansDay(caseObj)) return null;
    var busy = {};
    busy[assigned] = true;
    (allCases || []).forEach(function (c) {
      var a = String((c && c.assigned) || '').replace(/^\s+|\s+$/g, '');
      if (a) busy[a] = true;
    });
    var chain = clinicCoverage(roster, data).filter(function (item) {
      if (busy[item.name]) return false;
      var other = findResident(roster, item.name);
      if (other && other.pm && other.pm.text === pmText) return false; // already staffing it
      return true;
    });
    if (!chain.length) return null;
    return { clinic: pmText, primary: chain[0], second: chain[1] || null };
  }

  /* ------------------------------------------------------------------ */
  /* planAddOn — "a globe comes in at 2 PM: who takes it?"               */
  /* ------------------------------------------------------------------ */

  var ADDON_KINDS = [
    { key: 'globe', label: 'Globe / trauma', category: 'trauma' },
    { key: 'cornea', label: 'Cornea add-on (needs tissue)', category: 'cornea' },
    { key: 'glaucoma', label: 'Glaucoma add-on', category: 'glaucoma' },
    { key: 'plastics', label: 'Plastics / TAB add-on', category: 'plastics' },
    { key: 'cataract', label: 'Cataract add-on', category: 'cataract' },
    { key: 'other', label: 'Other add-on', category: 'other' }
  ];

  // Walks the add-on's chain at time t against the board. The first chain
  // member who is not out or in a case takes it — even from clinic (chief's
  // rule, 9/2026: Surg 2 takes the globe) — and whatever clinic they leave
  // passes down the clinic-coverage chain (`handoff`).
  function planAddOn(kind, t, roster, data, board) {
    data = getData(data);
    var S = getStatus();
    var def = ADDON_KINDS[0];
    ADDON_KINDS.forEach(function (k) { if (k.key === kind) def = k; });
    var hierarchy = (data && data.hierarchy) || {};
    var draft = {
      id: '__plan__', section: 'wills', surgeon: '', category: def.category, addOn: true,
      count: 1, serviceCount: 1, start: S ? S.fmtHHMM(t) : '', assigned: '', backup: ''
    };
    var key = classify(draft, data);
    var hier = hierarchy[key] || { label: key, chain: [] };
    var chain = hier.chain || [];
    if (key === 'traumaPlasticsAddOn' && def.category === 'trauma') {
      chain = chain.filter(function (tok) { return tok !== 'PLASTICS_OR_JUNIOR'; });
    }
    var w = walkCase(draft, key, chain, roster, data, board, {});
    var handoff = null;
    if (w.primary && w.primaryStatus && w.primaryStatus.kind === 'clinic') {
      var pulled = pulledClinic(board, w.primary.name, w.spans, null);
      if (pulled) {
        var cover = findClinicCover(pulled, roster, data, board, [w.primary.name], null);
        handoff = { clinic: pulled.clinic, owner: pulled.owner, window: pulled, primary: cover.primary, second: cover.second, steps: cover.steps };
      }
    }
    return {
      kind: def.key, label: def.label, time: t, key: key, hierLabel: hier.label,
      draft: draft, spans: w.spans, pick: w.primary, pickStatus: w.primaryStatus,
      steps: w.steps, alternates: w.alternates, handoff: handoff
    };
  }

  /* ------------------------------------------------------------------ */

  var Assign = {
    classify: classify,
    suggest: suggest,
    clinicCoverage: clinicCoverage,
    backupPlan: backupPlan,
    planAddOn: planAddOn,
    ADDON_KINDS: ADDON_KINDS,
    FREE_JUNIOR_LABEL: FREE_JUNIOR_LABEL
  };

  if (typeof window !== 'undefined') window.Assign = Assign;
  if (typeof module !== 'undefined' && module.exports) module.exports = Assign;
})();
