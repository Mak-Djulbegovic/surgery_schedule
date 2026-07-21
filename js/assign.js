/*
 * assign.js — case → resident suggestion engine.
 * Defines window.Assign (browser) / module.exports (Node).
 * Plain script, no ES modules. Loaded after js/data.js.
 *
 * Assign.classify(caseObj)          -> hierarchy key string
 * Assign.suggest(cases, roster)     -> [{ caseId, name, reasons, warnings, alternates }]
 * Assign.clinicCoverage(roster)     -> [{ name, source }] PM clinic-coverage chain
 *
 * All functions accept an optional trailing `data` argument (the SCHED_DATA
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

  /* ------------------------------------------------------------------ */
  /* classify                                                            */
  /* ------------------------------------------------------------------ */

  function classify(caseObj) {
    var cat = (caseObj && caseObj.category) || '';
    var addOn = !!(caseObj && caseObj.addOn);
    if (cat === 'peds') return 'peds';
    if (cat === 'cornea' && addOn) return 'addOnCornea';
    if (cat === 'glaucoma' && addOn) return 'addOnGlaucoma';
    if (cat === 'trauma' || (cat === 'plastics' && addOn)) return 'traumaPlasticsAddOn';
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

  // First time token in the start text -> number:
  // '0730' / '7:30' / '730' -> 730; '730, 915 (x1 service)' -> 730;
  // '0730-0900' -> 730. No H:MM/HMM token -> null.
  function startNum(caseObj) {
    var m = /(\d{1,2}):?(\d{2})/.exec(String((caseObj && caseObj.start) || ''));
    if (!m) return null;
    return (+m[1]) * 100 + (+m[2]);
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
    if (key === 'addOnCornea' || key === 'addOnGlaucoma' || key === 'traumaPlasticsAddOn') return 1;
    return 0; // peds + scheduled specialty + plastics + cataract
  }

  function suggest(cases, roster, data) {
    data = getData(data);
    var hierarchy = (data && data.hierarchy) || {};
    var results = [];

    // Load = # of cases per resident this pass (pre-existing manual
    // assignments count from the start).
    var load = {};
    (cases || []).forEach(function (c) {
      if (c && c.assigned) load[c.assigned] = (load[c.assigned] || 0) + 1;
    });

    // Process order: peds & scheduled first, then add-ons, then remaining
    // chronologically (string sort on normalized 24h start).
    var entries = (cases || []).map(function (c, i) {
      return { c: c, i: i, key: classify(c) };
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
      var candidates = resolveChain(hier.chain, roster);

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

  /* ------------------------------------------------------------------ */

  var Assign = {
    classify: classify,
    suggest: suggest,
    clinicCoverage: clinicCoverage
  };

  if (typeof window !== 'undefined') window.Assign = Assign;
  if (typeof module !== 'undefined' && module.exports) module.exports = Assign;
})();
