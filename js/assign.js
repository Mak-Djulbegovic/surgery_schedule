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
 * Assign.planAddOns([kinds | {kind, t}], t, roster, data, board)
 *                                   -> several add-ons, each at its own time
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
      // The doc's "Retina", with Uveitis beside it: the clinics to pull from
      // first, which need no cover (chief, 9/28/2026).
      var names = [];
      var seen = {};
      var d0 = getData();
      var pf = (d0 && d0.availability && d0.availability.pullFirstTexts) || ['Retina', 'Retina Private', 'Uveitis'];
      var people = orBlockPeople(roster, 'Retina OR', sessions);
      pf.forEach(function (label) { people = people.concat(clinicPeople(roster, label, sessions)); });
      people.forEach(function (p) {
        if (!seen[p.name]) { seen[p.name] = true; names.push(p.name); }
      });
      return { label: 'Retina / Uveitis', names: names };
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
        var st = board.statusDuringSpans(n, spans, { exclude: selfId });
        if (st.kind === 'free' && !st.neverPull) out.push(n);
      });
    });
    return out;
  }

  // …and those in a pull-first clinic (Retina / Uveitis) for all of `spans`
  // — pulled with no cover needed (chief, 9/28/2026: "the first to pull from
  // often times is retina/uveitis").
  function pullFirstNames(board, spans, selfId, years) {
    var out = [];
    years.forEach(function (y) {
      board.order.forEach(function (n) {
        if (boardYear(board, n) !== y) return;
        var st = board.statusDuringSpans(n, spans, { exclude: selfId });
        if (isPullFirst(st)) out.push({ name: n, clinic: st.clinic || st.text || '' });
      });
    });
    return out;
  }

  function isPullFirst(st) { return !!(st && st.kind === 'clinic' && st.pullFirst && !st.neverPull); }

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
        pullFirstNames(board, spans, selfId, ['pgy2', 'pgy3']).forEach(function (p) {
          push(p.name, 'junior in ' + p.clinic + ' — no cover needed, Surg 2’s discretion', token);
        });
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
  // is skipped when out, already in a case, on Path (never pulled), off-site,
  // already picked for another case then, not free when only a free resident
  // qualifies, or in clinic when drawn from an OR block — except a pull-first
  // clinic (Retina / Uveitis), which counts as available and needs no cover.
  // `tried`: names already walked for this case at an earlier step — not
  // repeated (nothing frees up between).
  // Why the board alone rules `cand` out for a case (null = they could).
  function boardWhy(cand, st) {
    if (st.kind === 'out') return st.label;
    if (st.kind === 'case') return busyText(st);
    if (st.neverPull) return (st.text || st.label) + ' — never pulled';
    if (st.cls === 'offsite') return st.label; // at Cooper — not pulled to Wills
    if (cand.requireFree && st.kind !== 'free' && !isPullFirst(st)) return st.label;
    if (cand.orBlock && st.kind === 'clinic' && !isPullFirst(st)) return st.label + ' — stays in clinic';
    return null;
  }

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
      var why = boardWhy(cand, st);
      if (!why && (cl = claimAt(claims[cand.name], spans))) why = cl.what;
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
  // decide — never suggested. Seniors first. `pullable`: the same for
  // residents in a pull-first clinic (Retina / Uveitis, no cover needed).
  function outsideFree(board, spans, selfId, walked, claims) {
    return outsideOf(board, spans, selfId, walked, claims).free;
  }

  function outsideOf(board, spans, selfId, walked, claims) {
    var free = [];
    var pullable = [];
    ['pgy4', 'pgy3', 'pgy2'].forEach(function (y) {
      board.order.forEach(function (n) {
        if (walked[n] || boardYear(board, n) !== y) return;
        if (claimAt((claims || {})[n], spans)) return;
        var st = board.statusDuringSpans(n, spans, { exclude: selfId });
        if (st.neverPull) return;
        if (st.kind === 'free') free.push(n);
        else if (isPullFirst(st)) pullable.push(n);
      });
    });
    return { free: free, pullable: pullable };
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

  // "free, but outside the how-to chain: A, B; or pull from Retina / Uveitis
  // (no cover needed): C" — who else there is, never an automatic pick.
  function outsideWords(free, pullable) {
    var bits = [];
    if ((free || []).length) bits.push('free, but outside the how-to chain: ' + free.join(', '));
    if ((pullable || []).length) bits.push((bits.length ? 'or ' : '') + 'pull from Retina / Uveitis (no cover needed): ' + pullable.join(', '));
    return bits.length ? bits.join('; ') : 'nobody else is free then either';
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
      var os = outsideOf(board, e.spans, c.id, walked, claims);
      return {
        caseId: c.id, name: '', status: null, skipped: skipped, alternates: [],
        outside: os.free, pullable: os.pullable,
        step: e.step, deferred: e.deferred,
        reasons: [hier.label + ' — nobody in the how-to chain is free then'],
        warnings: ['Surg 2’s call — ' + outsideWords(os.free, os.pullable)]
      };
    }
    var p = e.pick;
    var st = e.pickStatus;
    var reasons = [hier.label + ' → ' + p.via + (e.deferred ? ' (remaining-cases chain)' : '')];
    if (e.deferred) reasons.push('how-to Step ' + e.step + ': skipped for now → Step 10');
    var warnings = [];
    if (p.token === 'FREE_JUNIOR') {
      warnings.push(p.name + (isPullFirst(st) ? ' is a junior in ' + (st.clinic || 'clinic') : ' is a free junior') + ' — confirm with Surg 2 (their discretion)');
    }
    if (isPullFirst(st)) {
      warnings.push(p.name + ' leaves ' + (st.clinic || 'clinic') + ' — no cover needed');
    } else if (st && st.kind === 'clinic') {
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
  // A pull-first clinic (Retina / Uveitis) needs no cover, so it never counts.
  function pulledClinic(board, name, spans, excludeId) {
    var found = null;
    (spans || []).forEach(function (sp) {
      for (var t = sp.start; t < sp.end; t += 5) {
        var st = board.statusAt(name, t, { exclude: excludeId });
        if (st.kind !== 'clinic' || isPullFirst(st)) continue; // Retina / Uveitis: no cover needed
        if (!found) found = { clinic: st.clinic, owner: st.covering || name, start: t, end: t + 5, session: st.session };
        else if (st.clinic === found.clinic) found.end = Math.max(found.end, t + 5);
      }
    });
    return found;
  }

  // Who covers `pulled.clinic` over its window — Step 12, the clinic-
  // coverage chain only (Surg 2 → Surg 3 → Surg 4 → Cooper → Surg 1 →
  // Surg 5 → Wills OR → Retina, with Uveitis beside Retina). A coverer must
  // be free — not out, in a case, in a clinic, on fixed duty, off-site or on
  // Path — or in a pull-first clinic (Retina / Uveitis: leaving needs no
  // cover). When nobody on the chain can, `outside` / `pullable` list who
  // else could (Surg 2's call, never picked).
  // `lead` (optional): [{ name, source }] tried before the chain.
  function findClinicCover(pulled, roster, data, board, excludeNames, excludeId, lead) {
    var hierarchy = (data && data.hierarchy) || {};
    var chain = (hierarchy.clinicCoverage && hierarchy.clinicCoverage.chain) || [];
    var seen = {};
    (excludeNames || []).forEach(function (n) { seen[n] = true; });
    var cands = [];
    (lead || []).forEach(function (c) {
      if (!c.name || seen[c.name]) return;
      seen[c.name] = true;
      cands.push({ name: c.name, source: c.source, token: '' });
    });
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
      var fine = (st.kind === 'free' && !st.neverPull) || isPullFirst(st);
      var why = fine ? null : (st.neverPull ? (st.text || st.label) + ' — never pulled' : busyText(st));
      steps.push({ name: cand.name, source: cand.source, status: st, verdict: fine ? (ok.length ? 'alt' : 'take') : 'skip', why: why });
      if (fine) ok.push(cand);
    });
    var os = ok.length ? { free: [], pullable: [] } : outsideOf(board, [{ start: pulled.start, end: pulled.end }], excludeId, seen, null);
    return {
      primary: ok[0] ? { name: ok[0].name, source: ok[0].source } : null,
      second: ok[1] ? { name: ok[1].name, source: ok[1].source } : null,
      steps: steps,
      outside: os.free,
      pullable: os.pullable
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
        primary: cover.primary, second: cover.second, steps: cover.steps, outside: cover.outside, pullable: cover.pullable
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

  // One stage of one add-on's walk against the board alone — who is out, in
  // a case, on Path, off-site, not free when only a free resident
  // qualifies, or in clinic when drawn from an OR block. Picks for the other
  // add-ons are applied by the solver.
  function stageOptions(c, chain, step, roster, board, spans, tried) {
    return chainCandidates(chain, roster, board, spans, c.id, step).filter(function (cand) {
      return !(tried && tried[cand.name]);
    }).map(function (cand) {
      var st = board.statusDuringSpans(cand.name, spans, { exclude: c.id });
      return { cand: cand, status: st, why: boardWhy(cand, st) };
    });
  }

  // The how-to's order, searched exactly (entries: the add-ons, each with
  // stage1 = its own chain for Steps 6–9, stage2 = Step 10's chain).
  // Phase 1 walks the Step 6–9 add-ons in step order; each takes a free
  // person from its chain or is skipped for now. Phase 2 walks everything
  // skipped plus the Step 10 add-ons in time order. Nobody takes two add-ons
  // whose times overlap. Choices are tried in the doc's preference order, so
  // the first complete answer is exactly the doc's own; the search goes on
  // only while some add-on is left without anyone, and keeps the first
  // answer (in that same order) that leaves the fewest uncovered —
  // lexicographic: coverage first, then the doc's order. A depth-first
  // branch and bound; the node cap is a safety net, far above what a day of
  // add-ons needs.
  function solvePlan(entries) {
    var LIMIT = 50000;
    var nodes = 0;
    var claims = {};
    var pick = {};
    var best = null;
    var greedy = null; // the first complete answer = the doc's own order
    function chrono(a, b) { return a.time - b.time || a.step - b.step || a.sub - b.sub || a.i - b.i; }
    var p1 = entries.filter(function (e) { return e.step < 10; }).sort(function (a, b) {
      return a.step - b.step || a.sub - b.sub || a.time - b.time || a.i - b.i;
    });
    var native10 = entries.filter(function (e) { return e.step >= 10; });
    function free(name, e) { return !claimAt(claims[name], e.spans); }
    function claim(name, e) {
      claims[name] = (claims[name] || []).concat(e.spans.map(function (sp) { return { start: sp.start, end: sp.end, entry: e }; }));
    }
    function unclaim(name, e) {
      claims[name] = (claims[name] || []).filter(function (x) { return x.entry !== e; });
    }
    function copyPick() {
      var o = {};
      for (var k in pick) o[k] = pick[k];
      return o;
    }
    function done() { return best && best.uncovered === 0; }
    function phase2(list, k, uncovered) {
      if (done() || nodes > LIMIT) return;
      if (best && uncovered >= best.uncovered) return; // cannot beat the best so far
      nodes++;
      if (k === list.length) {
        best = { uncovered: uncovered, pick: copyPick() };
        if (!greedy) greedy = best;
        return;
      }
      var e = list[k];
      for (var r = 0; r < e.stage2.length; r++) {
        var o = e.stage2[r];
        if (o.why || !free(o.cand.name, e)) continue;
        claim(o.cand.name, e);
        pick[e.i] = { opt: o, stage: 2 };
        phase2(list, k + 1, uncovered);
        unclaim(o.cand.name, e);
        delete pick[e.i];
        if (done()) return;
      }
      pick[e.i] = null; // nobody on the chain can take it
      phase2(list, k + 1, uncovered + 1);
      delete pick[e.i];
    }
    function phase1(k, deferred) {
      if (done() || nodes > LIMIT) return;
      nodes++;
      if (k === p1.length) {
        phase2(deferred.concat(native10).sort(chrono), 0, 0);
        return;
      }
      var e = p1[k];
      for (var r = 0; r < e.stage1.length; r++) {
        var o = e.stage1[r];
        if (o.why || !free(o.cand.name, e)) continue;
        claim(o.cand.name, e);
        pick[e.i] = { opt: o, stage: 1 };
        phase1(k + 1, deferred);
        unclaim(o.cand.name, e);
        delete pick[e.i];
        if (done()) return;
      }
      phase1(k + 1, deferred.concat([e])); // skip for now
    }
    phase1(0, []);
    return {
      pick: best ? best.pick : {}, uncovered: best ? best.uncovered : entries.length,
      greedy: greedy ? greedy.pick : {}, greedyUncovered: greedy ? greedy.uncovered : entries.length,
      nodes: nodes, capped: nodes > LIMIT
    };
  }

  // Add-ons coming in during the day, each at its own time (chief,
  // 9/28/2026: "we need to be able to put in multiple surgeries that all may
  // have different times"). `items`: kind strings (all at `t`) or
  // { kind, t } objects. Assigned as the how-to orders it — Step 6 (add-on
  // glaucoma → Surg 4, add-on cornea → Surg 3, skip for now if they are in a
  // case), Step 9 (trauma, then plastics, down their chain), Step 10 for
  // anything skipped or left (Surg 2 → Surg 3 → Surg 4 → Cooper → Surg 1 →
  // Surg 5), in time order — with one change the doc cannot make by hand:
  // if following it leaves an add-on with nobody while another choice would
  // cover it, the plan takes the first such choice (solvePlan). Then Step
  // 12: everyone pulled out of a clinic hands it down the clinic-coverage
  // chain, never to someone taking an add-on at that time. Nobody in the
  // chains free → no pick, and `outside` / `pullable` list who else could
  // (Surg 2's call).
  function planAddOns(items, t, roster, data, board) {
    data = getData(data);
    var S = getStatus();
    var hierarchy = (data && data.hierarchy) || {};
    var remChain = (hierarchy.remaining && hierarchy.remaining.chain) || [];
    var entries = (items || []).map(function (item, i) {
      var kind = typeof item === 'string' ? item : item && item.kind;
      var at = (item && typeof item === 'object' && item.t != null) ? item.t : t;
      var def = kindDef(kind);
      var draft = {
        id: '__plan' + i + '__', section: 'wills', surgeon: '', category: def.category, addOn: true,
        count: 1, serviceCount: 1, start: S ? S.fmtHHMM(at) : '', assigned: '', backup: ''
      };
      var key = classify(draft, data);
      var hier = hierarchy[key] || { label: key, chain: [] };
      var e = {
        c: draft, i: i, def: def, key: key, hier: hier, chain: chainFor(key, draft, hier),
        step: stepOf(key, hier), sub: subRank(draft), time: at,
        spans: board.caseSpansFor(draft).spans
      };
      var tried = {};
      if (e.step < 10) {
        e.stage1 = stageOptions(draft, e.chain, e.step, roster, board, e.spans, null);
        e.stage1.forEach(function (o) { tried[o.cand.name] = true; });
      } else {
        e.stage1 = [];
      }
      e.stage2 = stageOptions(draft, e.step < 10 ? remChain : e.chain, 10, roster, board, e.spans, tried);
      return e;
    });
    var sol = solvePlan(entries);
    entries.forEach(function (e) {
      var p = sol.pick[e.i];
      var g = sol.greedy[e.i];
      e.pick = p ? p.opt.cand : null;
      e.pickStatus = p ? p.opt.status : null;
      e.pickStage = p ? p.stage : 0;
      e.deferred = e.step < 10 && e.pickStage !== 1;
      e.byOrder = g ? g.opt.cand.name : null; // who the doc's order alone gives it to
      e.changed = (e.byOrder || '') !== (e.pick ? e.pick.name : '');
    });
    function overlapsE(a, b) { return spansOverlap(a.spans, b.spans); }
    function takerOf(name, e) {
      return entries.filter(function (f) { return f !== e && f.pick && f.pick.name === name && overlapsE(e, f); })[0] || null;
    }

    // Step 12, earliest first: cover for everyone pulled out of a clinic —
    // never someone taking an add-on then, never one coverer for two
    // clinics at once.
    var covers = [];
    entries.slice().sort(function (a, b) { return a.time - b.time || a.i - b.i; }).forEach(function (e) {
      if (!e.pick || !e.pickStatus || e.pickStatus.kind !== 'clinic') return;
      var pulled = pulledClinic(board, e.pick.name, e.spans, null);
      if (!pulled) return;
      var win = [{ start: pulled.start, end: pulled.end }];
      var busy = [e.pick.name];
      entries.forEach(function (f) { if (f.pick && spansOverlap(f.spans, win)) busy.push(f.pick.name); });
      covers.forEach(function (cv) { if (spansOverlap(cv.win, win)) busy.push(cv.name); });
      var cover = findClinicCover(pulled, roster, data, board, busy, null);
      e.handoff = {
        clinic: pulled.clinic, owner: pulled.owner, window: pulled,
        primary: cover.primary, second: cover.second, steps: cover.steps, outside: cover.outside, pullable: cover.pullable
      };
      if (cover.primary) covers.push({ name: cover.primary.name, win: win });
    });

    var claimsFinal = {};
    entries.forEach(function (e) {
      if (!e.pick) return;
      claimsFinal[e.pick.name] = (claimsFinal[e.pick.name] || []).concat(e.spans.map(function (sp) { return { start: sp.start, end: sp.end }; }));
    });

    var out = entries.map(function (e) {
      // the walk as it played out: who was passed over, and why
      var steps = [];
      var adjusted = false;
      var stages = e.step < 10 ? [[e.stage1, e.step]] : [];
      if (e.step >= 10 || e.pickStage !== 1) stages.push([e.stage2, 10]);
      var seenPick = false;
      stages.forEach(function (sg) {
        sg[0].forEach(function (o) {
          var isPick = e.pick && o.cand === e.pick;
          var taker = !o.why ? takerOf(o.cand.name, e) : null;
          var why = o.why || (taker ? 'taking the ' + taker.def.label.toLowerCase() + (taker.time !== e.time && S ? ' at ' + S.fmtClock(taker.time) : '') : null);
          var verdict;
          if (isPick) { verdict = 'take'; seenPick = true; }
          else if (why) verdict = 'skip';
          else if (!seenPick) { verdict = 'skip'; why = 'kept for another add-on, so none is left without a resident'; adjusted = true; }
          else verdict = 'alt';
          steps.push({
            name: o.cand.name, via: o.cand.via, step: sg[1], token: o.cand.token, status: o.status,
            verdict: verdict, why: why, takenBy: taker ? taker.def.label : null
          });
        });
      });
      var takeIdx = -1;
      steps.forEach(function (s, i) { if (takeIdx === -1 && s.verdict === 'take') takeIdx = i; });
      var skipped = steps.filter(function (s, i) { return s.verdict === 'skip' && (takeIdx === -1 || i < takeIdx); });
      var displaced = skipped.filter(function (s) { return s.takenBy; })[0] || null;
      var walked = {};
      steps.forEach(function (s) { walked[s.name] = true; });
      var os = e.pick ? { free: [], pullable: [] } : outsideOf(board, e.spans, e.c.id, walked, claimsFinal);
      return {
        kind: e.def.key, label: e.def.label, key: e.key, hierLabel: e.hier.label, time: e.time,
        step: e.step, deferred: e.deferred, adjusted: adjusted || e.changed, byOrder: e.byOrder, draft: e.c, spans: e.spans,
        pick: e.pick ? { name: e.pick.name, via: e.pick.via } : null,
        status: e.pickStatus || null,
        steps: steps,
        skipped: skipped.map(function (s) { return { name: s.name, via: s.via, why: s.why, step: s.step }; }),
        alternates: steps.filter(function (s) { return s.verdict === 'alt'; }).map(function (s) { return s.name; }),
        firstChoice: displaced ? displaced.name : null,
        displacedBy: displaced ? displaced.takenBy : null,
        outside: os.free,
        pullable: os.pullable,
        handoff: e.handoff || null
      };
    });
    return {
      time: t,
      items: out,
      unfilled: out.filter(function (it) { return !it.pick; }).length,
      // the doc's order alone would leave this many with nobody
      unfilledByOrder: sol.greedyUncovered,
      searched: sol.nodes,
      capped: sol.capped
    };
  }

  // "A globe comes in at 2 PM: who takes it?" — the same procedure for one
  // add-on. The first chain member who is not out or in a case takes it —
  // even from clinic (chief's rule, 9/2026: Surg 2 takes the globe) — and
  // whatever clinic they leave passes down the clinic-coverage chain.
  function planAddOn(kind, t, roster, data, board) {
    var it = planAddOns([{ kind: kind, t: t }], t, roster, data, board).items[0];
    return {
      kind: it.kind, label: it.label, time: t, key: it.key, hierLabel: it.hierLabel,
      step: it.step, deferred: it.deferred, draft: it.draft, spans: it.spans,
      pick: it.pick, pickStatus: it.status, steps: it.steps, skipped: it.skipped,
      alternates: it.alternates, outside: it.outside, pullable: it.pullable, handoff: it.handoff
    };
  }

  /* ------------------------------------------------------------------ */
  /* lateCover — "the morning OR runs past 12:30: who covers their PM    */
  /* clinic until they are out?"                                         */
  /* ------------------------------------------------------------------ */
  // A junior running late: free juniors first (chief, 9/28/2026: "if there
  // are free juniors (PGY2 and 3), they can be the default to help take
  // over if the PGY2 is running later in the OR with Carrasco … will have
  // Parekh cover if Patel goes past 12:30"), PGY-3s before PGY-2s
  // (assumption). Then — and for a senior running late — the clinic-
  // coverage chain (how-to Step 12; Surg 2 first — the AY legend: "Surg 2
  // … Cover Cornea/Glaucoma if Surg 3/4 has PM cases"). The coverer must be
  // free the whole of [start, end). `exclude`: names to skip (the late
  // resident is always skipped).
  function lateCover(name, clinic, start, end, roster, data, board, exclude, excludeId) {
    data = getData(data);
    var pulled = { clinic: clinic, owner: name, start: start, end: end, session: 'pm' };
    var skip = [name].concat(exclude || []);
    var lead = [];
    var y = boardYear(board, name);
    if (y === 'pgy2' || y === 'pgy3') {
      freeNames(board, [{ start: start, end: end }], excludeId || null, ['pgy3', 'pgy2']).forEach(function (n) {
        if (skip.indexOf(n) === -1) lead.push({ name: n, source: 'free junior' });
      });
    }
    return findClinicCover(pulled, roster, data, board, skip, excludeId || null, lead);
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
    outsideWords: outsideWords,
    ADDON_KINDS: ADDON_KINDS,
    FREE_JUNIOR_LABEL: FREE_JUNIOR_LABEL
  };

  if (typeof window !== 'undefined') window.Assign = Assign;
  if (typeof module !== 'undefined' && module.exports) module.exports = Assign;
})();
