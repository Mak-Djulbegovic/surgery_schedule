/*
 * engine.js — pure schedule-resolution logic (no DOM).
 * Exposes window.Engine in the browser and module.exports in Node.
 *
 * All date parsing is LOCAL: 'YYYY-MM-DD' is split manually into
 * new Date(y, m-1, d). Never new Date('YYYY-MM-DD') (UTC, shifts weekday).
 */
(function () {
  'use strict';

  var WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var WEEKDAY_LABELS = {
    sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
    thu: 'Thursday', fri: 'Friday', sat: 'Saturday'
  };
  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var SURG_RE = /^Surg (\d+)$/;
  var OR_RE = /\bOR\b/; // case-sensitive word 'OR' → OR-type block
  var NON_CLINIC = { 'CPEC': true, 'ER': true, 'PT': true, 'Jeff Consults': true, 'Cooper Consults': true, 'Day Float': true };

  function getData(data) {
    if (data) return data;
    if (typeof window !== 'undefined' && window.SCHED_DATA) return window.SCHED_DATA;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      return require('./data.js');
    }
    throw new Error('Engine: SCHED_DATA not available');
  }

  // 'YYYY-MM-DD' → local Date
  function parseISO(iso) {
    var m = ISO_RE.exec(String(iso));
    if (!m) throw new Error('Engine: bad ISO date "' + iso + '" (want YYYY-MM-DD)');
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  // Occurrence index (1–5) of this date's weekday within its month.
  function nthWeekdayOfMonth(date) {
    var d = (date instanceof Date) ? date : parseISO(date);
    return Math.floor((d.getDate() - 1) / 7) + 1;
  }

  // The blockRanges entry containing dateISO (ISO string compare works).
  function findBlockRange(yearData, dateISO) {
    var ranges = yearData.blockRanges;
    for (var i = 0; i < ranges.length; i++) {
      if (ranges[i].start <= dateISO && dateISO <= ranges[i].end) return ranges[i];
    }
    return null;
  }

  function ruleMatches(rule, block, weekdayKey, session, nth, month) {
    if (rule.block !== block) return false;
    if (rule.day !== weekdayKey) return false;
    if (rule.session !== session) return false;
    if (rule.nth && rule.nth.indexOf(nth) === -1) return false;
    if (rule.months && rule.months.indexOf(month) === -1) return false;
    return true;
  }

  // Base grid text + overrides (applied in array order) → { text, notes }
  function resolveCell(yearData, block, weekdayKey, session, nth, month) {
    var row = yearData.grid[block];
    var base = row && row[weekdayKey];
    var text = base ? base[session] : '';
    var notes = [];
    var rules = yearData.overrides || [];
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!ruleMatches(rule, block, weekdayKey, session, nth, month)) continue;
      if (rule.set) text = rule.set;
      if (rule.note) notes.push(rule.note);
    }
    return { text: text, notes: notes };
  }

  function emptyDay(dateISO, weekdayKey, nth, inYear, isWeekend) {
    return {
      date: dateISO,
      weekdayKey: weekdayKey,
      weekdayLabel: WEEKDAY_LABELS[weekdayKey],
      nth: nth,
      inYear: inYear,
      isWeekend: isWeekend,
      residents: [],
      surg: {},
      wer: { am: [], pm: [] },
      jeffConsults: [],
      cooperConsults: [],
      dayFloat: [],
      taskmasters: [],
      clinics: {},
      orBlocks: {},
      specialClinicsToday: [],
      cooperBuddies: { am: null, pm: null, templateAM: null, templatePM: null }
    };
  }

  function pushUnique(arr, v) {
    if (arr.indexOf(v) === -1) arr.push(v);
  }

  function sessionSuffix(session) {
    if (session === 'am') return ' (AM)';
    if (session === 'pm') return ' (PM)';
    return ' (AM/PM)';
  }

  function resolveDay(dateISO, data) {
    data = getData(data);
    var d = parseISO(dateISO);
    var weekdayKey = WEEKDAY_KEYS[d.getDay()];
    var nth = nthWeekdayOfMonth(d);
    var month = d.getMonth() + 1;
    var inYear = data.ayStart <= dateISO && dateISO <= data.ayEnd;
    var isWeekend = weekdayKey === 'sat' || weekdayKey === 'sun';

    var day = emptyDay(dateISO, weekdayKey, nth, inYear, isWeekend);
    if (isWeekend || !inYear) return day;

    var taskmasterEntries = [];
    var yearKeys = Object.keys(data.years);

    for (var y = 0; y < yearKeys.length; y++) {
      var yearKey = yearKeys[y];
      var yearData = data.years[yearKey];
      var range = findBlockRange(yearData, dateISO);
      var tmBlocks = yearData.taskmasterBlocks || [];

      for (var r = 0; r < yearData.residents.length; r++) {
        var name = yearData.residents[r];
        var block = range && range.blocks ? range.blocks[name] : undefined;
        if (block === undefined || block === null) continue;

        var am = resolveCell(yearData, block, weekdayKey, 'am', nth, month);
        var pm = resolveCell(yearData, block, weekdayKey, 'pm', nth, month);
        var taskmaster = tmBlocks.indexOf(block) !== -1;

        var res = {
          name: name,
          year: yearKey,
          yearLabel: yearData.label,
          block: block,
          taskmaster: taskmaster,
          am: am,
          pm: pm
        };
        day.residents.push(res);
        if (taskmaster) taskmasterEntries.push({ name: name, block: block });

        // Surg map (any 'Surg N' text — pgy4 gives 1–5, pgy3 block 6 Thu gives 6)
        var mAm = SURG_RE.exec(am.text);
        var mPm = SURG_RE.exec(pm.text);
        if (mAm || mPm) {
          var n = (mAm || mPm)[1];
          var entry = day.surg[n];
          if (!entry || entry.name === name) {
            if (!entry) entry = day.surg[n] = { name: name, am: false, pm: false, amText: am.text, pmText: pm.text };
            if (mAm) entry.am = true;
            if (mPm && (!mAm || mAm[1] === mPm[1])) entry.pm = true;
          }
          // odd case: am and pm are different Surg N's
          if (mAm && mPm && mAm[1] !== mPm[1]) {
            var n2 = mPm[1];
            var e2 = day.surg[n2] || (day.surg[n2] = { name: name, am: false, pm: false, amText: am.text, pmText: pm.text });
            e2.pm = true;
          }
        }

        // Session-level groupings
        var sessions = ['am', 'pm'];
        for (var s = 0; s < sessions.length; s++) {
          var session = sessions[s];
          var text = (session === 'am' ? am : pm).text;
          if (!text) continue;

          if (text === 'ER') { pushUnique(day.wer[session], name); continue; }
          if (text === 'Jeff Consults') { pushUnique(day.jeffConsults, name); continue; }
          if (text === 'Cooper Consults') { pushUnique(day.cooperConsults, name); continue; }
          if (text === 'Day Float') { pushUnique(day.dayFloat, name); continue; }
          if (SURG_RE.test(text)) continue; // captured in day.surg
          if (OR_RE.test(text)) {
            var ob = day.orBlocks[text] || (day.orBlocks[text] = { am: [], pm: [] });
            ob[session].push({ name: name, year: yearKey });
            continue;
          }
          if (NON_CLINIC[text]) continue; // CPEC / PT (ER etc. handled above)
          var cl = day.clinics[text] || (day.clinics[text] = { am: [], pm: [] });
          cl[session].push({ name: name, year: yearKey });
        }
      }
    }

    // Taskmasters ordered by block number (block 2 before block 5)
    taskmasterEntries.sort(function (a, b) { return a.block - b.block; });
    day.taskmasters = taskmasterEntries.map(function (t) { return t.name; });

    // Special clinics matching today's weekday + nth
    var specials = data.specialClinics || [];
    for (var i = 0; i < specials.length; i++) {
      var sc = specials[i];
      if (sc.day !== weekdayKey) continue;
      if (sc.nth && sc.nth.indexOf(nth) === -1) continue;
      day.specialClinicsToday.push(sc.label + sessionSuffix(sc.session));
    }

    // Cooper buddy call: template rotation by weekday; named buddy from the
    // range containing this date (ISO string compare), if any. Weekend /
    // out-of-year days never reach this point and keep all-null values.
    var bc = data.buddyCall;
    if (bc) {
      var tmpl = bc.template || {};
      day.cooperBuddies.templateAM = (tmpl.am && tmpl.am[weekdayKey]) || null;
      day.cooperBuddies.templatePM = (tmpl.pm && tmpl.pm[weekdayKey]) || null;
      var bcRanges = bc.ranges || [];
      for (var bi = 0; bi < bcRanges.length; bi++) {
        var br = bcRanges[bi];
        if (br.start <= dateISO && dateISO <= br.end) {
          day.cooperBuddies.am = (br.am && br.am[weekdayKey]) || null;
          day.cooperBuddies.pm = (br.pm && br.pm[weekdayKey]) || null;
          break;
        }
      }
    }

    return day;
  }

  var Engine = {
    parseISO: parseISO,
    nthWeekdayOfMonth: nthWeekdayOfMonth,
    findBlockRange: findBlockRange,
    resolveCell: resolveCell,
    resolveDay: resolveDay
  };

  if (typeof window !== 'undefined') window.Engine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})();
