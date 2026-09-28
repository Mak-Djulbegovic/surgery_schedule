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
 * Assign.planAddOns([kinds], t, roster, data, board)
 *                                   -> several at once, nobody taking two
 *
 * `board` (optional) is a Status board (js/status.js). Without it, suggest /
 * backupPlan go by chain order only (suggest still in the how-to's step
 * order, with the remaining-cases chain as the fallback). With it they are
 * availability-aware and follow the how-to's steps in order (the doc is the
 * authority for who covers — chief, 9/28/2026): each case type is assigned
 * at its step from its own chain; anyone out or already in a case at that
 * time is skipped ("skip for now"), and a case nobody in its chain can take
 * waits for Step 10, the remaining-cases chain, in chronological order.
 * Nobody outside the chains is ever picked — past the end of a chain it is
 * Surg 2's call, and the result lists who else is free (`outside`).
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

  // Case type → hierarchy key, by the how-to's categories. Location does not
  // change the type: an add-on at JHN/Gibbon/JSC is typed like one at Wills.
  // Add-on cataracts and anything else untyped are "remaining cases".
  function classify(caseObj, data) {
    var cat = (caseObj && caseObj.category) || '';
    var addOn = !!(caseObj && caseObj.addOn);
    if (cat === 'peds') return 'peds';
    if (cat === 'cornea' && addOn) return 'addOnCornea';
    if (cat === 'glaucoma' && addOn) return 'addOnGlaucoma';
    if (cat === 'trauma' || (cat === 'plastics' && addOn)) return 'traumaPlasticsAddOn';
    if (cat === 'plastics') return 'scheduledPlastics';
    if (cat === 'cornea') return 'scheduledCornea';
    if (cat === 'glaucoma') return 'scheduledGlaucoma';
    if (cat === 'cataract' && !addOn) return 'scheduledCataract';
    return 'remaining';
  }

  /* ------------------------------------------------------------------ */
  /* the how-to's order of steps                                         */
  /* ------------------------------------------------------------------ */
  // Full "How to Surgical Schedule": Steps 3–4 scheduled cataracts, Step 5
  // scheduled cornea/glaucoma, Step 6 add-on glaucoma → Surg 4 and add-on
  // cornea → Surg 3, Step 7 scheduled plastics, Step 8 peds, Step 9 add-on
  // trauma and add-on plastics, Step 10 the remaining cases chronologically,
  // Step 12 PM clinic coverage. data.hierarchy[key].step overrides.
  var DOC_STEP = {
    scheduledCataract: 3, scheduledCornea: 5, scheduledGlaucoma: 5,
    addOnGlaucoma: 6, addOnCornea: 6, scheduledPlastics: 7, peds: 8,
    traumaPlasticsAddOn: 9, remaining: 10
  };

  function stepOf(key, hier) {
    if (hier && typeof hier.step === 'number') return hier.step;
    return DOC_STEP[key] || 10;
  }

  // Within a step the doc's own listing order: "Add on Glaucoma … Add on
  // Cornea" (Step 6), "add-on trauma and add on Plastics" (Step 9).
  function subRank(caseObj) {
    var cat = (caseObj && caseObj.category) || '';
    if (cat === 'glaucoma' || cat === 'trauma') return 0;
    return 1;
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

  // A resolved roster cell counts as a "clinic" unless it is Surg N / ER /
  // PT / an OR block / a consult-or-float assignment (mirrors the engine's
  // clinic-grouping exclusions; CPEC is a clinic).
  function isClinicText(text) {
    var t = String(text || '').trim();
    if (!t) return false;
    if (/^Surg \d/.test(t)) return false;
    if (t === 'ER' || t === 'PT') return false;
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

  function cooperSeniorFrom(roster) {
    var d = getData();
    var block = null;
    if (d && d.years && d.years.pgy4) {
      block = d.years.pgy4.cooperBlock;
      if (block == null && typeof require !== 'undefined') {
        try { block = require('./engine.js').cooperBlockOf(d); } catch (e) { block = null; }
      } else if (block == null && typeof window !== 'undefined' && window.Engine && window.Engine.cooperBlockOf) {
        block = window.Engine.cooperBlockOf(d);
      }
    }
    var list = (roster && roster.residents) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].year === 'pgy4' && list[i].block === block) return list[i].name;
    }
    return null;
  }

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
      // The how-to's "Cooper" is the PGY-4 on the Cooper block (chief,
      // 9/2026) — resolved by the engine; hand-built rosters fall back to
      // the resident list + data.
      var cs = roster ? roster.cooperSenior : null;
      if (cs === undefined) cs = cooperSeniorFrom(roster);
      return { label: 'Cooper (PGY-4)', names: cs ? [cs] : [] };
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

  // The OR-block tokens: the how-to's "1st year on Plastics OR", "1st or
  // 2nd year on Peds OR" … take a resident only while they are on that OR —
  // one in clinic at the time stays in clinic (chief, 9/2026: "if the
  // plastics resident is in clinic then they will stay in clinic as
  // default"). Surg roles and the Cooper senior ARE pulled from clinic
  // (Surg 3/4 "are all day even if they have clinic"; Surg 2 takes the
  // globe) and someone covers.
  var OR_TOKENS = { PEDS_OR_JUNIOR: true, PLASTICS_OR_PGY2: true, PLASTICS_OR_JUNIOR: true, WILLS_OR: true, RETINA: true };

  // One chain, in order, for one case. FREE_JUNIOR ("free and willing 1st
  // or 2nd year at the discretion of Surg 2") resolves to the juniors who
  // are actually free for the whole case (requireFree).
  function chainCandidates(chain, roster, board, spans, selfId, step) {
    var out = [];
    var seen = {};
    function push(name, via, token) {
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push({ name: name, via: via, token: token, step: step, requireFree: token === 'FREE_JUNIOR', orBlock: !!OR_TOKENS[token] });
    }
    (chain || []).forEach(function (token) {
      if (token === 'FREE_JUNIOR') {
        freeNames(board, spans, selfId, ['pgy2', 'pgy3']).forEach(function (n) { push(n, FREE_JUNIOR_LABEL, token); });
        return;
      }
      var r = resolveToken(token, roster);
      r.names.forEach(function (n) { push(n, r.label, token); });
    });
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

  // claims: name -> [{ start, end, what, by }] — residents already picked for
  // another case in this pass (`what` is the skip reason shown).
  function claimAt(list, spans) {
    for (var i = 0; i < (list || []).length; i++) {
      if (spansOverlap([list[i]], spans)) return list[i];
    }
    return null;
  }

  // One step of the how-to for one case: walk `chain` in order. A candidate
  // is skipped when out, already in a case, off-site, already picked for
  // another case then, not free when only a free resident qualifies, or in
  // clinic when drawn from an OR block. `tried`: names already walked for
  // this case at an earlier step — not repeated (nothing frees up between).
  function walkStep(c, chain, step, roster, board, claims, spans, tried) {
    var cands = chainCandidates(chain, roster, board, spans, c.id, step);
    var steps = [];
    var primary = null;
    var primaryStatus = null;
    var alternates = [];
    cands.forEach(function (cand) {
      if (tried && tried[cand.name]) return;
      var st = board.statusDuringSpans(cand.name, spans, { exclude: c.id });
      var cl = null;
      var why = null;
      if (st.kind === 'out') why = st.label;
      else if (st.kind === 'case') why = busyText(st);
      else if (st.cls === 'offsite') why = st.label; // at Cooper — not pulled to Wills
      else if ((cl = claimAt(claims[cand.name], spans))) why = cl.what;
      else if (cand.requireFree && st.kind !== 'free') why = st.label;
      else if (cand.orBlock && st.kind === 'clinic') why = st.label + ' — stays in clinic';
      var verdict = why ? 'skip' : (primary ? 'alt' : 'take');
      if (verdict === 'take') { primary = cand; primaryStatus = st; }
      else if (verdict === 'alt') alternates.push(cand.name);
      steps.push({
        name: cand.name, via: cand.via, step: step, token: cand.token, status: st,
        verdict: verdict, why: why, takenBy: cl ? (cl.by || null) : null
      });
    });
    return { primary: primary, primaryStatus: primaryStatus, steps: steps, alternates: alternates };
  }

  // Free for all of `spans`, in none of the chains walked and not already
  // picked: the how-to never reaches them, so they are listed for Surg 2 to
  // decide — never suggested. Seniors first.
  function outsideFree(board, spans, selfId, walked, claims) {
    var out = [];
    ['pgy4', 'pgy3', 'pgy2'].forEach(function (y) {
      board.order.forEach(function (n) {
        if (walked[n] || boardYear(board, n) !== y) return;
        if (claimAt((claims || {})[n], spans)) return;
        if (board.statusDuringSpans(n, spans, { exclude: selfId }).kind === 'free') out.push(n);
      });
    });
    return out;
  }

  function stepsOf(e) {
    var all = [];
    (e.stages || []).forEach(function (w) { all = all.concat(w.steps); });
    return all;
  }

  // The how-to, run over a set of cases against the board. entries:
  // [{ c, i, key, hier, chain, step, sub, spans, private }]. Steps before 10
  // go first, in step order (the doc's listing order within a step, then the
  // input order); a case nobody in its chain can take is skipped for now.
  // Then Step 10: the remaining cases and everything skipped, in
  // chronological order, down the remaining-cases chain. Sets e.stages,
  // e.pick, e.pickStatus, e.deferred; returns the entries in the order they
  // were settled, and the claims.
  function runSteps(entries, roster, data, board, claimOf) {
    var hierarchy = (data && data.hierarchy) || {};
    var remChain = (hierarchy.remaining && hierarchy.remaining.chain) || [];
    var claims = {};
    var settled = [];
    function take(e, w) {
      e.pick = w.primary;
      e.pickStatus = w.primaryStatus;
      if (!w.primary || trimStr(e.c.assigned)) return; // an assigned case is on the board already
      var cl = claimOf(e);
      claims[w.primary.name] = (claims[w.primary.name] || []).concat(e.spans.map(function (sp) {
        return { start: sp.start, end: sp.end, what: cl.what, by: cl.by || null };
      }));
    }
    var later = [];
    entries.slice().sort(function (a, b) {
      return a.step - b.step || a.sub - b.sub || a.i - b.i;
    }).forEach(function (e) {
      e.stages = [];
      e.pick = null;
      e.pickStatus = null;
      e.deferred = false;
      if (e.step >= 10) { later.push(e); return; }
      if (e.private) { settled.push(e); return; }
      var w = walkStep(e.c, e.chain, e.step, roster, board, claims, e.spans, null);
      e.stages.push(w);
      if (w.primary) { take(e, w); settled.push(e); } else later.push(e);
    });
    later.sort(function (a, b) {
      var ka = startKey(a.c);
      var kb = startKey(b.c);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return a.step - b.step || a.sub - b.sub || a.i - b.i;
    }).forEach(function (e) {
      if (e.private) { settled.push(e); return; }
      var tried = {};
      stepsOf(e).forEach(function (s) { tried[s.name] = true; });
      e.deferred = e.step < 10;
      var w = walkStep(e.c, e.deferred ? remChain : e.chain, 10, roster, board, claims, e.spans, tried);
      e.stages.push(w);
      take(e, w);
      settled.push(e);
    });
    return { settled: settled, claims: claims };
  }

  // Trauma skips the junior on Plastics OR — the doc gives them only TABs
  // and add-on outpatient plastics.
  function chainFor(key, c, hier) {
    var chain = (hier && hier.chain) || [];
    if (key === 'traumaPlasticsAddOn' && c && c.category === 'trauma') {
      chain = chain.filter(function (t) { return t !== 'PLASTICS_OR_JUNIOR'; });
    }
    return chain;
  }

  /* ------------------------------------------------------------------ */
  /* suggest                                                             */
  /* ------------------------------------------------------------------ */

  function trimStr(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  function privateResult(c) {
    return { caseId: c.id, name: '', reasons: ['private — no resident needed'], warnings: [], alternates: [] };
  }

  // One settled case, availability-aware (the board path of suggest()).
  function boardResult(e, board, load, claims) {
    var c = e.c;
    var hier = e.hier;
    var steps = stepsOf(e);
    var takeIdx = -1;
    steps.forEach(function (s, i) { if (takeIdx === -1 && s.verdict === 'take') takeIdx = i; });
    var skipped = steps.filter(function (s, i) {
      return s.verdict === 'skip' && (takeIdx === -1 || i < takeIdx);
    }).map(function (s) { return { name: s.name, via: s.via, why: s.why, step: s.step }; });
    var last = e.stages[e.stages.length - 1];

    if (!e.pick) {
      var walked = {};
      steps.forEach(function (s) { walked[s.name] = true; });
      var outside = outsideFree(board, e.spans, c.id, walked, claims);
      return {
        caseId: c.id, name: '', status: null, skipped: skipped, alternates: [], outside: outside,
        step: e.step, deferred: e.deferred,
        reasons: [hier.label + ' — nobody in the how-to chain is free then'],
        warnings: ['Surg 2’s call — ' + (outside.length
          ? 'free, but outside the how-to chain: ' + outside.join(', ')
          : 'nobody else is free then either')]
      };
    }
    var p = e.pick;
    var st = e.pickStatus;
    var reasons = [hier.label + ' → ' + p.via + (e.deferred ? ' (remaining-cases chain)' : '')];
    if (e.deferred) reasons.push('how-to Step ' + e.step + ': skipped for now → Step 10');
    var warnings = [];
    if (p.via === FREE_JUNIOR_LABEL) {
      warnings.push(p.name + ' is a free junior — confirm with Surg 2 (their discretion)');
    }
    if (st && st.kind === 'clinic') {
      warnings.push(p.name + ' leaves ' + (st.clinic || 'clinic') + (st.covering && st.covering !== p.name ? ' (covering for ' + st.covering + ')' : '') + ' — needs a backup');
    } else if (st && st.kind === 'duty') {
      warnings.push(p.name + ' is on ' + st.label);
    }
    var alternates = (last && last.alternates) || [];
    var nextName = alternates[0] || null;
    var primaryLoad = load[p.name] || 0;
    if (nextName !== null && primaryLoad >= (load[nextName] || 0) + 2) {
      warnings.push(p.name + ' already has ' + primaryLoad + ' cases — consider next in chain (' + nextName + ')');
    }
    if (board.caseSpansFor(c).unknownStart) warnings.push('No start time — assumed 7:30 AM');
    if (!trimStr(c.assigned)) load[p.name] = primaryLoad + 1;
    return {
      caseId: c.id, name: p.name, status: st, skipped: skipped, outside: [],
      step: e.step, deferred: e.deferred,
      reasons: reasons, warnings: warnings, alternates: alternates.slice(0, 6)
    };
  }

  // Without a board: chain order only — the case's own chain, then the
  // remaining-cases chain the how-to falls back to (Step 10).
  function legacyResult(e, roster, hierarchy, load) {
    var c = e.c;
    var hier = e.hier;
    var candidates = resolveChain(e.chain, roster);
    if (e.step < 10 && hierarchy.remaining) {
      var have = {};
      candidates.forEach(function (x) { if (x.name) have[x.name] = true; });
      resolveChain(hierarchy.remaining.chain, roster).forEach(function (x) {
        if (x.name && !have[x.name]) { have[x.name] = true; candidates.push(x); }
      });
    }

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
      return {
        caseId: c.id,
        name: '',
        reasons: [hier.label + ' — no one in the chain is available today'],
        warnings: ['No resident resolvable from the hierarchy chain'],
        alternates: alternates
      };
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
    // carries a manual assignment, which was pre-counted).
    if (!c.assigned) load[primary.name] = primaryLoad + 1;

    return {
      caseId: c.id,
      name: primary.name,
      reasons: reasons,
      warnings: warnings,
      alternates: alternates
    };
  }

  function suggest(cases, roster, data, board) {
    data = getData(data);
    var hierarchy = (data && data.hierarchy) || {};

    // Load = # of cases per resident this pass (pre-existing manual
    // assignments count from the start).
    var load = {};
    (cases || []).forEach(function (c) {
      if (c && c.assigned) load[c.assigned] = (load[c.assigned] || 0) + 1;
    });

    var entries = [];
    (cases || []).forEach(function (c, i) {
      if (!c) return;
      var key = classify(c, data);
      var hier = hierarchy[key] || { label: key, chain: [] };
      entries.push({
        c: c, i: i, key: key, hier: hier, chain: chainFor(key, c, hier),
        step: stepOf(key, hier), sub: subRank(c), private: !needsResident(c),
        spans: board ? board.caseSpansFor(c).spans : null
      });
    });

    if (board) {
      var run = runSteps(entries, roster, data, board, function (e) {
        return { what: 'suggested for ' + (trimStr(e.c.surgeon) || 'another case') + ' at this time' };
      });
      return run.settled.map(function (e) {
        return e.private ? privateResult(e.c) : boardResult(e, board, load, run.claims);
      });
    }

    // No board: the same step order, chronological within Step 10.
    entries.sort(function (a, b) {
      if (a.step !== b.step) return a.step - b.step;
      if (a.step >= 10) {
        var ka = startKey(a.c);
        var kb = startKey(b.c);
        if (ka !== kb) return ka < kb ? -1 : 1;
      }
      return a.sub - b.sub || a.i - b.i;
    });
    return entries.map(function (e) {
      return e.private ? privateResult(e.c) : legacyResult(e, roster, hierarchy, load);
    });
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

  // Who covers `pulled.clinic` over its window — Step 12, the clinic-
  // coverage chain only (Surg 2 → Surg 3 → Surg 4 → Cooper → Surg 1 →
  // Surg 5 → Wills OR → Retina). A coverer must be free — not out, in a
  // case, in a clinic, on fixed duty or off-site. When nobody on the chain
  // is, `outside` lists who else is free (Surg 2's call, never picked).
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
    var steps = [];
    var ok = [];
    cands.forEach(function (cand) {
      var st = board.statusDuring(cand.name, pulled.start, pulled.end, { exclude: excludeId });
      var fine = st.kind === 'free';
      steps.push({ name: cand.name, source: cand.source, status: st, verdict: fine ? (ok.length ? 'alt' : 'take') : 'skip', why: fine ? null : busyText(st) });
      if (fine) ok.push(cand);
    });
    return {
      primary: ok[0] ? { name: ok[0].name, source: ok[0].source } : null,
      second: ok[1] ? { name: ok[1].name, source: ok[1].source } : null,
      steps: steps,
      outside: ok.length ? [] : outsideFree(board, [{ start: pulled.start, end: pulled.end }], excludeId, seen, null)
    };
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

  // Backup plan per Step 12 of the how-to (Step 3 of the short version): when
  // the assigned resident staffs a PM clinic that this case could pull them
  // out of, the first free name in the clinic-coverage chain covers the
  // clinic; the next is the 2nd backup.
  // Returns { clinic, primary: {name, source}, second: {name, source}|null }
  // or null when no coverage is needed / nobody is free.
  // With a board: returns { clinic, owner, window: {start,end,session},
  // primary: {name, source}|null, second, steps, outside } — primary is null
  // when nobody on the chain is free to cover (the UI says so rather than
  // hiding the problem; `outside` lists who else is free — Surg 2's call).
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
        primary: cover.primary, second: cover.second, steps: cover.steps, outside: cover.outside
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
  /* planAddOns — "a globe comes in while an emergent glaucoma AND a     */
  /* cornea case also need someone" (rare); planAddOn — just one         */
  /* ------------------------------------------------------------------ */

  var ADDON_KINDS = [
    { key: 'globe', label: 'Globe / trauma', category: 'trauma' },
    { key: 'cornea', label: 'Cornea add-on (needs tissue)', category: 'cornea' },
    { key: 'glaucoma', label: 'Glaucoma add-on', category: 'glaucoma' },
    { key: 'plastics', label: 'Plastics / TAB add-on', category: 'plastics' },
    { key: 'cataract', label: 'Cataract add-on', category: 'cataract' },
    { key: 'other', label: 'Other add-on', category: 'other' }
  ];

  function kindDef(kind) {
    var def = ADDON_KINDS[0];
    ADDON_KINDS.forEach(function (k) { if (k.key === kind) def = k; });
    return def;
  }

  // Add-ons coming in at time t, assigned exactly as the how-to orders it:
  // Step 6 (add-on glaucoma → Surg 4, add-on cornea → Surg 3 — skip for now
  // if they are in a case), Step 9 (trauma, then plastics, down their
  // chain), then Step 10 for anything skipped or left (Surg 2 → Surg 3 →
  // Surg 4 → Cooper → Surg 1 → Surg 5). Nobody takes two at once. Then
  // Step 12: everyone pulled out of a clinic hands it down the clinic-
  // coverage chain — never to someone taking one of these cases, and never
  // one coverer for two clinics. Nobody in the chains free → no pick, and
  // `outside` lists who else is free (Surg 2's call).
  function planAddOns(kinds, t, roster, data, board) {
    data = getData(data);
    var S = getStatus();
    var hierarchy = (data && data.hierarchy) || {};
    var entries = (kinds || []).map(function (kind, i) {
      var def = kindDef(kind);
      var draft = {
        id: '__plan' + i + '__', section: 'wills', surgeon: '', category: def.category, addOn: true,
        count: 1, serviceCount: 1, start: S ? S.fmtHHMM(t) : '', assigned: '', backup: ''
      };
      var key = classify(draft, data);
      var hier = hierarchy[key] || { label: key, chain: [] };
      return {
        c: draft, i: i, def: def, key: key, hier: hier, chain: chainFor(key, draft, hier),
        step: stepOf(key, hier), sub: subRank(draft), private: false,
        spans: board.caseSpansFor(draft).spans
      };
    });
    var run = runSteps(entries, roster, data, board, function (e) {
      return { what: 'taking the ' + e.def.label.toLowerCase(), by: e.def.label };
    });

    var busy = entries.filter(function (e) { return e.pick; }).map(function (e) { return e.pick.name; });
    run.settled.forEach(function (e) {
      if (!e.pick || !e.pickStatus || e.pickStatus.kind !== 'clinic') return;
      var pulled = pulledClinic(board, e.pick.name, e.spans, null);
      if (!pulled) return;
      var cover = findClinicCover(pulled, roster, data, board, busy, null);
      e.handoff = {
        clinic: pulled.clinic, owner: pulled.owner, window: pulled,
        primary: cover.primary, second: cover.second, steps: cover.steps, outside: cover.outside
      };
      if (cover.primary) busy.push(cover.primary.name);
    });

    var items = entries.map(function (e) {
      var steps = stepsOf(e);
      var takeIdx = -1;
      steps.forEach(function (s, i) { if (takeIdx === -1 && s.verdict === 'take') takeIdx = i; });
      var skipped = steps.filter(function (s, i) { return s.verdict === 'skip' && (takeIdx === -1 || i < takeIdx); });
      var displaced = skipped.filter(function (s) { return s.takenBy; })[0] || null;
      var walked = {};
      steps.forEach(function (s) { walked[s.name] = true; });
      var last = e.stages[e.stages.length - 1];
      return {
        kind: e.def.key, label: e.def.label, key: e.key, hierLabel: e.hier.label,
        step: e.step, deferred: e.deferred, draft: e.c, spans: e.spans,
        pick: e.pick ? { name: e.pick.name, via: e.pick.via } : null,
        status: e.pickStatus || null,
        steps: steps,
        skipped: skipped.map(function (s) { return { name: s.name, via: s.via, why: s.why, step: s.step }; }),
        alternates: (last && last.alternates) || [],
        firstChoice: displaced ? displaced.name : null,
        displacedBy: displaced ? displaced.takenBy : null,
        outside: e.pick ? [] : outsideFree(board, e.spans, e.c.id, walked, run.claims),
        handoff: e.handoff || null
      };
    });
    return {
      time: t,
      items: items,
      unfilled: items.filter(function (it) { return !it.pick; }).length
    };
  }

  // "A globe comes in at 2 PM: who takes it?" — the same procedure for one
  // add-on. The first chain member who is not out or in a case takes it —
  // even from clinic (chief's rule, 9/2026: Surg 2 takes the globe) — and
  // whatever clinic they leave passes down the clinic-coverage chain.
  function planAddOn(kind, t, roster, data, board) {
    var it = planAddOns([kind], t, roster, data, board).items[0];
    return {
      kind: it.kind, label: it.label, time: t, key: it.key, hierLabel: it.hierLabel,
      step: it.step, deferred: it.deferred, draft: it.draft, spans: it.spans,
      pick: it.pick, pickStatus: it.status, steps: it.steps, skipped: it.skipped,
      alternates: it.alternates, outside: it.outside, handoff: it.handoff
    };
  }

  /* ------------------------------------------------------------------ */
  /* lateCover — "the morning OR runs past 12:30: who covers their PM    */
  /* clinic until they are out?"                                         */
  /* ------------------------------------------------------------------ */
  // The clinic-coverage chain (how-to Step 12; Surg 2 first — the AY legend:
  // "Surg 2 … Cover Cornea/Glaucoma if Surg 3/4 has PM cases") over
  // [start, end); the coverer must be free the whole time. `exclude`: names
  // to skip (the late resident is always skipped).
  function lateCover(name, clinic, start, end, roster, data, board, exclude, excludeId) {
    data = getData(data);
    var pulled = { clinic: clinic, owner: name, start: start, end: end, session: 'pm' };
    return findClinicCover(pulled, roster, data, board, [name].concat(exclude || []), excludeId || null);
  }

  /* ------------------------------------------------------------------ */

  var Assign = {
    classify: classify,
    suggest: suggest,
    clinicCoverage: clinicCoverage,
    backupPlan: backupPlan,
    planAddOn: planAddOn,
    planAddOns: planAddOns,
    lateCover: lateCover,
    stepOf: stepOf,
    ADDON_KINDS: ADDON_KINDS,
    FREE_JUNIOR_LABEL: FREE_JUNIOR_LABEL
  };

  if (typeof window !== 'undefined') window.Assign = Assign;
  if (typeof module !== 'undefined' && module.exports) module.exports = Assign;
})();
