/*
 * app.js — UI controller. Defines window.App and boots on DOMContentLoaded.
 * Browser-only (guarded so the file parses/requires harmlessly in Node).
 *
 * Per-date state persists to localStorage under surgsched:v1:day:<YYYY-MM-DD>,
 * debounced ~300ms after every manual input.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // v2 (9/2026) keeps v1's storage keys, so days saved in v1 open here.
  // The archived v1 copy (v1/index.html) uses its own keys.
  var APP_VERSION = 'v2';
  // The build, shown in the header and on Home, so an old copy held in the
  // browser's cache is plain to see. Bump it with the ?v= numbers in
  // index.html on every release.
  var BUILD = '24';
  var BUILD_DATE = '10/19/26';
  var LS_PREFIX = 'surgsched:v1:day:';
  var DATA_OVERRIDE_KEY = 'surgsched:v1:dataOverride';
  // Where this browser last was (date + tab) — for "Pick up where you left off".
  var LAST_KEY = 'surgsched:v2:last';
  var SAVE_DEBOUNCE_MS = 300;
  var WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var CATEGORIES = ['cataract', 'cornea', 'glaucoma', 'plastics', 'peds', 'retina', 'trauma', 'other'];
  var YEAR_ORDER = ['pgy2', 'pgy3', 'pgy4'];
  // Wills is its own section; the ASC is Stadium, so it sits with Cherry
  // Hill (10/18/2026: "ASC/stadium are the same thing … Wills as one and
  // Stadium/Cherry Hill as the other"). The keys stay 'wills' / 'other' so
  // saved days keep their cases where they were.
  var CASE_SECTIONS = [
    { key: 'wills', label: 'Wills' },
    { key: 'other', label: 'Stadium / Cherry Hill (ASC)' },
    { key: 'jhn', label: 'JHN/TJUH/JSC' },
    { key: 'private', label: 'Privates' }
  ];
  // Surgery-tab order follows the how-to: Wills, then Stadium/Cherry Hill,
  // then JHN/Gibbon; privates (no resident) last. The copied schedule keeps
  // its own order (export.js).
  var SURGERY_ORDER = ['wills', 'other', 'jhn', 'private'];
  // CPEC-sheet sites that are not Wills: SP = Stadium (the ASC), CH = Cherry Hill
  var ASC_SITES = { SP: true, CH: true };
  var WORKFLOW_TABS = ['out', 'roster', 'surgery', 'clinics', 'coverage', 'preview'];
  var TAB_TITLES = {
    out: 'Out today', roster: 'Roster', surgery: 'Surgery', clinics: 'Clinics',
    coverage: 'Coverage', preview: 'Preview & Copy'
  };
  var REASONS = [
    { key: 'vacation', label: 'Vacation' },
    { key: 'sick', label: 'Sick' },
    { key: 'conference', label: 'Conference' },
    { key: 'other', label: 'Other' }
  ];

  var App = {
    state: null,     // per-date persisted state (SPEC state shape)
    roster: null,    // Engine DayRoster for state.date
    board: null,     // Status board (who is doing what, when) for state.date
    activeTab: 'out'
  };

  // Local UI state — never persisted.
  var caseSectionOpen = { wills: true, private: true, jhn: true, other: true };
  var coverageTime = null;   // minutes; null = default (now if today, else 1 PM)
  var coverageFollowNow = true;
  // Coverage: add-ons to place, each with its own time (null = the planner's
  // default time: now if today, else 1 PM). Starts empty — no globe until
  // one is entered (10/18/2026: with no globe, Surg 2 is free for clinic
  // cover).
  var planItems = [];

  // New-year setup (UISPEC5 §E): the built-in data object is captured at boot
  // so 'Remove imported configuration' can always revert to it; usingOverride
  // tracks whether window.SCHED_DATA currently comes from localStorage.
  var BUILTIN_DATA = null;
  var usingOverride = false;
  // Why the stored override is NOT active (parse/validation/render failure at
  // boot) — renderSetup surfaces it with a Remove button so the dead blob is
  // visible and removable in-app instead of silently re-warning every boot.
  var overrideBootError = null;

  function data() { return window.SCHED_DATA; }

  // Weekday keys from the active data object; imported configurations pass
  // only minimal validation, so a missing list falls back to Mon–Fri.
  function dataWeekdays() {
    return (data() && data().weekdays) || ['mon', 'tue', 'wed', 'thu', 'fri'];
  }

  /* ------------------------------------------------------------------ */
  /* date helpers (all LOCAL — never new Date('YYYY-MM-DD'))             */
  /* ------------------------------------------------------------------ */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function isoOf(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function parseISO(iso) {
    var p = String(iso).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function fmtMDYY(d) {
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(-2);
  }
  function weekdayName(d) { return WEEKDAY_NAMES[d.getDay()]; }
  function ordinal(n) {
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    return n + 'th';
  }
  function tomorrowISO() {
    var now = new Date();
    return isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  }
  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  /* ------------------------------------------------------------------ */
  /* localStorage (guarded — file:// / private mode can throw)           */
  /* ------------------------------------------------------------------ */

  function lsGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) { try { window.localStorage.setItem(key, val); return true; } catch (e) { return false; } }
  function lsRemove(key) { try { window.localStorage.removeItem(key); } catch (e) { } }
  function lsKeys() {
    var out = [];
    try {
      for (var i = 0; i < window.localStorage.length; i++) out.push(window.localStorage.key(i));
    } catch (e) { }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */

  // Add-on prefill rows are anchored to the REAL current date (the clock),
  // not the schedule date — "what is to come" at the moment the schedule is
  // being built: tonight, then tomorrow day + night. Rows stay fully editable.
  // Add-on call coverage rows carry a real date + period:
  //   { date: 'YYYY-MM-DD', period: 'night'|'day', name, auto }
  // `auto` marks a row the app generated; it clears the moment the user
  // changes that row, and only auto rows re-anchor when the date changes.
  // Defaults for a schedule date D: D night, D+1 day, D+1 night — where D+1
  // skips the weekend (Friday's next coverage day is Monday).
  function nextCoverageDay(day) {
    var next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    while (next.getDay() === 0 || next.getDay() === 6) {
      next = new Date(next.getFullYear(), next.getMonth(), next.getDate() + 1);
    }
    return next;
  }

  // Matches the sent schedule for Tue 7/28/26:
  //   Tuesday daytime (7/28/26) / Tuesday night (7/28/26) /
  //   Wednesday daytime (7/29/26)
  function defaultAddOns(dateISO) {
    var day = dateISO ? parseISO(dateISO) : new Date();
    var dayISO = dateISO || isoOf(day);
    var nextISO = isoOf(nextCoverageDay(day));
    return [
      { date: dayISO, period: 'day', name: '', auto: true },
      { date: dayISO, period: 'night', name: '', auto: true },
      { date: nextISO, period: 'day', name: '', auto: true }
    ];
  }

  // 'Tuesday daytime (7/28/26)' — derived from date+period; a legacy/custom
  // row with no date keeps whatever label it carries.
  function addOnLabel(row) {
    if (!row) return '';
    if (!row.date) return trim(row.label);
    var d = parseISO(row.date);
    if (!d || isNaN(d.getTime())) return trim(row.label);
    return weekdayName(d) + ' ' + (row.period === 'day' ? 'daytime' : 'night') +
      ' (' + fmtMDYY(d) + ')';
  }

  // export.js reads row.label, so keep it in sync with date+period.
  function syncAddOnLabels() {
    (App.state && App.state.addOns || []).forEach(function (r) {
      if (r && r.date) r.label = addOnLabel(r);
    });
  }

  // Re-anchor auto-generated rows when the schedule date changes.
  function refreshAddOnsForDate() {
    var st = App.state;
    if (!st || !Array.isArray(st.addOns)) return;
    var fresh = defaultAddOns(st.date);
    var changed = false;
    st.addOns.forEach(function (row, i) {
      if (!row || !row.auto || trim(row.name) || i >= fresh.length) return;
      if (row.date !== fresh[i].date || row.period !== fresh[i].period) {
        row.date = fresh[i].date;
        row.period = fresh[i].period;
        changed = true;
      }
    });
    syncAddOnLabels();
    if (changed) saveNow();
  }

  function defaultState(dateISO) {
    return {
      date: dateISO,
      lectures: '',
      nightFloat: '',
      nfCleared: false, // user explicitly blanked Night Float — never re-prefill
      // Who is out (Out today tab): [{ id, name, am, pm, reason, coverAM,
      // coverPM }] — cover is a resident, 'NC' (not covered) or '' (undecided).
      absences: [],
      outConfirmed: false, // pressed "No one out" — nobody is on vacation
      vacation: '',        // extra notes for the Vacation section (legacy text)
      cooperBuddyAM: { name: '', note: '' },
      cooperBuddyPM: { name: '', note: '' },
      addOns: defaultAddOns(dateISO),
      cases: [],
      clinicCounts: {},
      clinicStaffOverrides: {},
      // "OK — CPEC runs one short": acknowledged clinic gaps, keyed to their
      // cause ('CPEC|am|Wibbelsman|Cheng') so they lapse when it changes
      shortOk: {},
      suggestions: {},
      seq: 1
    };
  }

  function normBuddy(b) {
    return { name: trim(b && b.name), note: String((b && b.note) || '') };
  }

  function normCase(c) {
    if (!c || typeof c !== 'object') return null;
    return {
      id: String(c.id || ''),
      section: CASE_SECTIONS.some(function (s) { return s.key === c.section; }) ? c.section : 'wills',
      surgeon: String(c.surgeon || ''),
      count: Math.max(0, parseInt(c.count, 10) || 0),
      serviceCount: Math.max(0, parseInt(c.serviceCount, 10) || 0),
      start: String(c.start || ''),
      serviceTimes: String(c.serviceTimes || ''),
      category: CATEGORIES.indexOf(c.category) !== -1 ? c.category : 'other',
      addOn: !!c.addOn,
      notes: String(c.notes || ''),
      assigned: String(c.assigned || ''),
      backup: String(c.backup || ''),
      backupNote: String(c.backupNote || ''),
      until: String(c.until || ''),   // typed end time, or set by "Done" day-of
      // checked off on Coverage: the case is over at doneAt ('HHMM') and the
      // resident is free from then (chief, 9/29/2026)
      done: !!c.done,
      doneAt: String(c.doneAt || '')
    };
  }

  var absSeq = 0;
  function normAbsence(a) {
    if (!a || typeof a !== 'object' || !trim(a.name)) return null;
    var reason = REASONS.some(function (r) { return r.key === a.reason; }) ? a.reason : 'vacation';
    return {
      id: String(a.id || ('a' + Date.now().toString(36) + (absSeq++))),
      name: trim(a.name),
      am: a.am !== false,
      pm: a.pm !== false,
      reason: reason,
      coverAM: trim(a.coverAM),
      coverPM: trim(a.coverPM)
    };
  }

  function normalizeState(raw, dateISO) {
    var st = (raw && typeof raw === 'object') ? raw : {};
    var out = defaultState(dateISO);
    if (typeof st.lectures === 'string') out.lectures = st.lectures;
    if (typeof st.nightFloat === 'string') out.nightFloat = st.nightFloat;
    out.nfCleared = !!st.nfCleared;
    if (typeof st.vacation === 'string') out.vacation = st.vacation;
    // Days saved before the Out today tab carry the old default '24 strong'
    // as typed text; it now computes itself, so drop the stale default.
    if (!Array.isArray(st.absences) && /^\s*24 strong\s*$/i.test(out.vacation)) out.vacation = '';
    if (Array.isArray(st.absences)) {
      // one row per resident — Out today allows no second row, but a paste
      // saved before 10/2026 could hold two ('… AM c/b NC', '… PM c/b Hamou')
      var absBy = {};
      out.absences = [];
      st.absences.map(normAbsence).filter(function (a) { return !!a; }).forEach(function (a) {
        var m = absBy[a.name];
        if (!m) { absBy[a.name] = a; out.absences.push(a); return; }
        if (a.am && !m.am) { m.am = true; m.coverAM = a.coverAM; }
        if (a.pm && !m.pm) { m.pm = true; m.coverPM = a.coverPM; }
      });
    }
    out.outConfirmed = !!st.outConfirmed;
    if (st.cooperBuddyAM) out.cooperBuddyAM = normBuddy(st.cooperBuddyAM);
    if (st.cooperBuddyPM) out.cooperBuddyPM = normBuddy(st.cooperBuddyPM);
    if (Array.isArray(st.addOns)) {
      // Saves from before add-on rows carried dates hold only a text label —
      // treat those as auto rows so they re-anchor to the schedule date.
      out.addOns = st.addOns.map(function (a) {
        var date = /^\d{4}-\d{2}-\d{2}$/.test(String(a && a.date)) ? a.date : '';
        var legacy = !date && !!trim(a && a.label);
        return {
          date: date,
          period: (a && a.period === 'day') ? 'day' : 'night',
          label: String((a && a.label) || ''),
          name: String((a && a.name) || ''),
          auto: date ? !!(a && a.auto) : legacy,
          cleared: !!(a && a.cleared),
          // the name was filled in by the app as that day's Surg 2 (true), or
          // picked by someone (false); absent on days saved before 10/2026
          s2: (a && typeof a.s2 === 'boolean') ? a.s2 : undefined
        };
      });
    }
    if (Array.isArray(st.cases)) {
      out.cases = st.cases.map(normCase).filter(function (c) { return !!c; });
    }
    if (st.clinicCounts && typeof st.clinicCounts === 'object') {
      Object.keys(st.clinicCounts).forEach(function (k) {
        var v = st.clinicCounts[k];
        out.clinicCounts[k] = {
          count: String((v && v.count) || ''),
          extra: String((v && v.extra) || '')
        };
      });
    }
    if (st.clinicStaffOverrides && typeof st.clinicStaffOverrides === 'object') {
      Object.keys(st.clinicStaffOverrides).forEach(function (k) {
        var v = st.clinicStaffOverrides[k];
        out.clinicStaffOverrides[k] = {
          removed: (v && Array.isArray(v.removed)) ? v.removed.map(String) : [],
          added: (v && Array.isArray(v.added)) ? v.added.map(String) : []
        };
      });
    }
    if (st.shortOk && typeof st.shortOk === 'object') {
      Object.keys(st.shortOk).forEach(function (k) { if (st.shortOk[k]) out.shortOk[String(k)] = true; });
    }
    if (st.suggestions && typeof st.suggestions === 'object') out.suggestions = st.suggestions;
    var maxId = 0;
    out.cases.forEach(function (c, i) {
      if (!c.id) c.id = 'c_' + (i + 1);
      var m = /^c(\d+)$/.exec(c.id);
      if (m) maxId = Math.max(maxId, +m[1]);
    });
    out.seq = (typeof st.seq === 'number' && st.seq > maxId) ? st.seq : maxId + 1;
    if (typeof st.savedAt === 'number') out.savedAt = st.savedAt;
    out.date = dateISO;
    return out;
  }

  function loadState(dateISO) {
    var raw = lsGet(LS_PREFIX + dateISO);
    if (raw) {
      try { return normalizeState(JSON.parse(raw), dateISO); } catch (e) { }
    }
    return defaultState(dateISO);
  }

  // Everything is saved in this browser's localStorage and nowhere else:
  // nobody on another device or browser can see or change it.
  var saveTimer = null;
  // True only once the user has actually edited the loaded day. saveNow() is a
  // no-op while false, so merely visiting a date (or closing the tab) never
  // fabricates a "saved draft" for a day the user never touched — the Home
  // draft-detection and Recent-days chips rely on keys meaning real edits.
  var stateDirty = false;
  // Edits not yet written. Only real changes are written, so flushing on
  // tab-hide never rewrites an unchanged day (which would ping other tabs).
  var unsaved = false;
  var saveFailed = false;   // localStorage refused the write (blocked / full)
  var syncConflict = false; // another tab saved this day while we had unsaved edits
  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!App.state || !stateDirty || !unsaved || syncConflict) return;
    App.state.savedAt = Date.now();
    var ok = lsSet(LS_PREFIX + App.state.date, JSON.stringify(App.state));
    unsaved = !ok;
    saveFailed = !ok;
    renderSaveState();
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }

  function clockOf(ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
  }
  function savedWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return isoOf(d) === isoOf(new Date()) ? clockOf(ts) : WEEKDAY_NAMES[d.getDay()].slice(0, 3) + ' ' + fmtMDYY(d) + ' ' + clockOf(ts);
  }

  // Header: "Saving…" / "✓ Saved 12:41 PM" / "⚠ Not saved".
  function renderSaveState() {
    var n = $('saveState');
    if (!n || !App.state) return;
    var cls = 'save-state', text = '';
    if (syncConflict) { cls += ' bad'; text = '⚠ Not saved — pick a version above'; }
    else if (saveFailed) { cls += ' bad'; text = '⚠ Not saved — this browser is blocking storage'; }
    else if (unsaved) { cls += ' busy'; text = 'Saving…'; }
    else if (App.state.savedAt) { cls += ' ok'; text = '✓ Saved ' + savedWhen(App.state.savedAt); }
    n.className = cls;
    n.textContent = text;
  }

  // Call after every manual input: debounced persist, live preview refresh,
  // and a debounced recompute of who-is-where (strip + tab badges).
  function touch() {
    stateDirty = true;
    unsaved = true;
    scheduleSave();
    renderSaveState();
    if (App.activeTab === 'preview') renderPreview();
    scheduleLive();
  }

  var liveTimer = null;
  function scheduleLive() {
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { liveTimer = null; refreshLive(); }, 120);
  }

  // Rebuild the status board from the current state.
  function computeBoard() {
    App.board = null;
    try {
      if (window.Status && window.Status.build && App.roster) {
        App.board = window.Status.build(App.roster, App.state, data());
      }
    } catch (e) {
      if (window.console) console.error('Status.build failed', e);
    }
  }

  function refreshLive() {
    computeBoard();
    renderAvailStrip();
    renderBadges();
  }

  function exportDay() {
    var day = {};
    for (var k in App.state) day[k] = App.state[k];
    day.roster = App.roster;
    return day;
  }

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'checked') node.checked = true;
        else if (k === 'disabled') node.disabled = true;
        else if (k === 'value') node.value = v;
        else node.setAttribute(k, v);
      }
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function chipEl(text, cls) { return el('span', { class: 'chip ' + (cls || ''), text: text }); }

  var toastTimer = null;
  function toast(msg, ok) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (ok === false ? ' toast-err' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  /* residents */

  var residentYearMap = null;
  function yearOf(name) {
    if (!residentYearMap) {
      residentYearMap = {};
      YEAR_ORDER.forEach(function (yk) {
        var y = data().years[yk];
        if (y) y.residents.forEach(function (n) { residentYearMap[n] = yk; });
      });
    }
    return residentYearMap[name] || '';
  }

  function residentSelect(value, onChange, emptyLabel) {
    var sel = el('select', { class: 'sel' });
    sel.appendChild(el('option', { value: '', text: emptyLabel || '—' }));
    YEAR_ORDER.forEach(function (yk) {
      var y = data().years[yk];
      if (!y) return;
      var og = el('optgroup', { label: y.short });
      y.residents.forEach(function (n) { og.appendChild(el('option', { value: n, text: n })); });
      sel.appendChild(og);
    });
    sel.value = value || '';
    if (value && sel.value !== value) { // stale/custom name — keep it selectable
      sel.appendChild(el('option', { value: value, text: value }));
      sel.value = value;
    }
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }

  /* Availability-aware resident picker ("when should someone stop appearing
     in a dropdown"). Residents are grouped by what they are doing over
     opts.spans (a case's busy spans) or opts.session ('am'/'pm'): free first,
     then in clinic (would need a backup), fixed duty, already in a case.
     Anyone OUT is not offered at all — unless already the value, so a stale
     pick stays visible. Everyone else stays pickable: the chief can always
     override, and back-to-back cases for one attending are normal.
     opts: { spans, session, exclude (case id), suggested, emptyLabel,
             extra: [{ value, text }], hideNames: [names] } */
  // Covering an absence (Out today): the chief's covers come from clinics
  // and Retina / Uveitis, same year first ("Ransone c/b Patel AM (Uveitis)
  // | Hamou PM (CPEC)"); a Surg role or OR block with no case yet is listed
  // after them — at step 1 no cases are in, so they read "free" but are the
  // ones about to operate (review 10/19/2026)
  var ABSENCE_GROUPS = [
    { kind: 'free', label: 'Free' },
    { kind: 'pull', label: 'Retina / Uveitis — no cover needed' },
    { kind: 'clinic', label: 'Clinic — leaves a gap' },
    { kind: 'surgor', label: 'Surg / OR — likely operating' },
    { kind: 'case', label: 'In a case then' },
    { kind: 'duty', label: 'Day Float or off-site (Cooper)' },
    { kind: 'never', label: 'Never pulled (ER, consults, Path)' },
    { kind: 'out', label: 'Out' },
    { kind: 'off', label: 'Residents' }
  ];
  var KIND_GROUPS = [
    { kind: 'free', label: 'Free' },
    { kind: 'pull', label: 'Pull first — Retina / Uveitis, no cover needed' },
    { kind: 'clinic', label: 'In clinic — would need a backup' },
    { kind: 'duty', label: 'Day Float or off-site (Cooper)' },
    { kind: 'case', label: 'Already in a case then' },
    { kind: 'never', label: 'Never pulled (ER, consults, Path)' },
    { kind: 'out', label: 'Out' },
    { kind: 'off', label: 'Residents' }
  ];

  // Picker group for a status: Retina / Uveitis residents are the first to
  // pull from and Path is never pulled (chief, 9/28/2026).
  function pickKind(st) {
    if (!st) return 'off';
    if (st.neverPull && st.kind !== 'out') return 'never';
    if (st.kind === 'clinic' && st.pullFirst) return 'pull';
    return st.kind;
  }
  var PICK_YEAR_ORDER = ['pgy4', 'pgy3', 'pgy2'];

  function statusFor(name, opts) {
    var b = App.board;
    if (!b || !b.byName[name]) return null;
    if (opts.spans && opts.spans.length) return b.statusDuringSpans(name, opts.spans, { exclude: opts.exclude });
    if (opts.session === 'am' || opts.session === 'pm' || opts.session === 'day') {
      var from = opts.session === 'pm' ? b.noon : b.dayStart;
      var to = opts.session === 'am' ? b.noon : b.dayEnd;
      return b.statusDuring(name, from, to, { exclude: opts.exclude });
    }
    return null;
  }

  function statusShort(st) {
    if (!st) return '';
    if (st.kind === 'case') {
      // an end only when typed or checked off — never the session's edge
      var S = window.Status;
      return 'in ' + st.label + (S && st.until != null && !st.openEnded ? ' until ' + S.fmtClock(st.until) : '');
    }
    return st.label || '';
  }

  // When a list holds its resident, in words: 'from 7:30 AM, for the
  // morning' · 'from 1:00 PM, for the afternoon' · '7:30 AM–3:00 PM' (typed)
  function operatingWhen(info) {
    var S = window.Status;
    var b = App.board;
    if (!S || !info || !info.spans.length) return '';
    if (!info.openEnded) return spanText(info.spans);
    var am = info.spans.some(function (sp) { return sp.start < b.noon; });
    var pm = info.spans.some(function (sp) { return sp.end > b.noon; });
    return 'from ' + S.fmtClock(info.spans[0].start) + ', for ' + (am && pm ? 'the day' : am ? 'the morning' : 'the afternoon');
  }

  // Shorter still, for places that already name the role: a Surg role or
  // OR block with nothing booked is just "free".
  function statusBrief(st) {
    if (!st) return '';
    // a stand-in with nothing booked too: 'Surg 2 for Cheng' is named beside it
    if (st.kind === 'free' && (/, no case$/.test(st.label || '') || st.covering)) return 'free';
    if (st.kind === 'free') return 'free (' + st.label + ')';
    if (st.kind === 'clinic' && !st.covering) return 'in ' + (st.clinic || st.label);
    return statusShort(st);
  }

  // Who covers `name`, for each session they are out, as the board has it ->
  // [{ s, who, blocked }] — who: the coverer, 'NC', or '' (nobody yet);
  // blocked: why the cover picked on Out today cannot (out too, or
  // covering someone else then) — every tab says the same (review 10/19/2026)
  function outCovers(name) {
    var b = App.board;
    if (!b || !b.byName[name]) return [];
    return ['am', 'pm'].filter(function (s) { return b.isOut(name, s); }).map(function (s) {
      var abs = (b.base[name][s] && b.base[name][s].absence) || {};
      var raw = trim(s === 'am' ? abs.coverAM : abs.coverPM);
      var who = b.coverOf ? b.coverOf(name, s) : raw;
      var blocked = '';
      if (!who && raw && raw !== 'NC' && b.byName[raw]) {
        var other = (b.absences || []).filter(function (x) { return x.name !== name && b.coverOf(x.name, s) === raw; })[0];
        blocked = b.isOut(raw, s) ? raw + ' is out too' : other ? raw + ' is covering ' + other.name : raw + ' cannot';
      }
      return { s: s, who: who || (raw === 'NC' ? 'NC' : ''), blocked: blocked };
    });
  }

  // 'Out today — Wibbelsman covers' · 'Out AM — not covered (NC)' ·
  // 'Out today — AM Wibbelsman · PM Aguwa' · 'Out today — cover not picked yet'
  function outCoverText(name) {
    var oc = outCovers(name);
    if (!oc.length) return '';
    var head = oc.length === 2 ? 'Out today' : 'Out ' + oc[0].s.toUpperCase();
    if (oc.length === 2 && (oc[0].who !== oc[1].who || oc[0].blocked !== oc[1].blocked)) {
      return head + ' — AM ' + (oc[0].who || 'TBD') + ' · PM ' + (oc[1].who || 'TBD');
    }
    var w = oc[0].who;
    if (!w && oc[0].blocked) return head + ' — TBD (' + oc[0].blocked + ')';
    return head + ' — ' + (w === 'NC' ? 'NC' : w ? w + ' covers' : 'TBD');
  }

  // ' (out today — Wibbelsman covers)' after a name, or ''
  function outCoverSuffix(name) {
    var t = outCoverText(name);
    return t ? ' (' + t.charAt(0).toLowerCase() + t.slice(1) + ')' : '';
  }

  function residentPicker(value, onChange, opts) {
    opts = opts || {};
    var sel = el('select', { class: 'sel picker' });
    sel.appendChild(el('option', { value: '', text: opts.emptyLabel || '—' }));
    (opts.extra || []).forEach(function (x) { sel.appendChild(el('option', { value: x.value, text: x.text })); });
    var names = [];
    PICK_YEAR_ORDER.forEach(function (yk) {
      var y = data().years[yk];
      if (y) y.residents.forEach(function (n) { names.push({ name: n, year: y.short || yk }); });
    });
    var hide = opts.hideNames || [];
    var dis = opts.disable || null; // { name: why } — listed, not pickable
    var sugg = opts.suggested || '';
    var groups = {};
    names.forEach(function (x) {
      var n = x.name;
      if (n === sugg) return;
      if (hide.indexOf(n) !== -1 && n !== value) return;
      var st = statusFor(n, opts);
      var kind = pickKind(st);
      if (kind === 'out' && n !== value) return; // out → not offered
      if (opts.forAbsence && kind === 'free' && st && (st.cls === 'surg' || st.cls === 'or')) kind = 'surgor';
      (groups[kind] || (groups[kind] = [])).push({ name: n, year: x.year, st: st });
    });
    // their own duty that session ('CPEC', 'Surg 2') — not what picking them
    // would make it ('for Cheng: Surg 2')
    function ownDuty(n) {
      var ss = opts.session === 'day' ? ['am', 'pm'] : [opts.session];
      var d = ss.map(function (s) { return dutyOf(n, s); }).filter(Boolean);
      return d.length === 2 && d[0] === d[1] ? d[0] : d.join('/');
    }
    var absentYear = opts.forAbsence ? yearOf(opts.forAbsence) : '';
    if (sugg) {
      var og0 = el('optgroup', { label: 'Suggested' });
      var sst = statusFor(sugg, opts);
      og0.appendChild(el('option', { value: sugg, text: sugg + (sst && sst.label ? ' — ' + statusShort(sst) : '') }));
      sel.appendChild(og0);
    }
    (opts.forAbsence ? ABSENCE_GROUPS : KIND_GROUPS).forEach(function (g) {
      var list = groups[g.kind];
      if (!list || !list.length) return;
      if (absentYear) {
        list = list.filter(function (x) { return yearOf(x.name) === absentYear; })
          .concat(list.filter(function (x) { return yearOf(x.name) !== absentYear; }));
      }
      var og = el('optgroup', { label: g.label });
      list.forEach(function (x) {
        var off = dis && dis[x.name];
        var own = opts.forAbsence ? ownDuty(x.name) : '';
        var detail = off ? ' — ' + off : opts.forAbsence ? (own ? ' — ' + own : '') : x.st && x.st.label ? ' — ' + statusShort(x.st) : '';
        var o = el('option', { value: x.name, text: x.name + ' (' + x.year + ')' + detail });
        if ((g.kind === 'never' || off) && x.name !== value) o.disabled = true; // never pulled from Path
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.value = value || '';
    if (value && sel.value !== value) {
      sel.appendChild(el('option', { value: value, text: value }));
      sel.value = value;
    }
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }

  function nameChip(name, onRemove) {
    var chip = el('span', { class: 'name-chip ' + yearOf(name) + (onRemove ? '' : ' no-x') }, [name]);
    if (onRemove) {
      chip.appendChild(el('button', {
        type: 'button', class: 'btn-icon danger', title: 'Remove ' + name, 'aria-label': 'Remove ' + name,
        text: '×', onclick: onRemove
      }));
    }
    return chip;
  }

  /* ------------------------------------------------------------------ */
  /* roster computation                                                  */
  /* ------------------------------------------------------------------ */

  function emptyRoster(dateISO) {
    var d = parseISO(dateISO);
    return {
      date: dateISO, weekdayKey: '', weekdayLabel: weekdayName(d),
      nth: Math.floor((d.getDate() - 1) / 7) + 1,
      inYear: false, isWeekend: d.getDay() === 0 || d.getDay() === 6,
      residents: [], surg: {}, wer: { am: [], pm: [] },
      jeffConsults: [], cooperConsults: [], dayFloat: [], taskmasters: [],
      clinics: {}, orBlocks: {}, specialClinicsToday: []
    };
  }

  function computeRoster() {
    App.roster = null;
    try {
      if (window.Engine && window.Engine.resolveDay) {
        App.roster = window.Engine.resolveDay(App.state.date, data());
      }
    } catch (e) {
      if (window.console) console.error('resolveDay failed', e);
    }
    if (!App.roster) App.roster = emptyRoster(App.state.date);
    prefillBuddies();
    prefillNightFloat();
    prefillAddOns();
    computeBoard();
  }

  // Daytime add-on call is that day's Surg 2 (the AY schedule decides who
  // that is) — or whoever covers Surg 2 when they are out all day (Out
  // today). A row the app filled (row.s2) follows any change: Surg 2 marked
  // out after the row was filled now hands it to the coverer, or empties it
  // when nobody covers. Never a name someone chose, never a row they
  // cleared. Nights stay manual.
  var surg2Cache = {};
  function surg2On(iso) {
    if (!iso) return '';
    if (!(iso in surg2Cache)) {
      var r = null;
      try { r = window.Engine.resolveDay(iso, data()); } catch (e) { r = null; }
      surg2Cache[iso] = (r && r.surg && r.surg['2'] && r.surg['2'].name) || '';
    }
    return surg2Cache[iso];
  }

  // Who is out on `iso`: the open day's absences, else that day's saved draft.
  function absencesOn(iso) {
    if (App.state && iso === App.state.date) return App.state.absences || [];
    var st = null;
    try { st = JSON.parse(lsGet(LS_PREFIX + iso) || 'null'); } catch (e) { st = null; }
    return (st && Array.isArray(st.absences)) ? st.absences : [];
  }

  // Out all day on `iso` (vacation, sick … on Out today)?
  function outAllDayOn(iso, name) {
    return absencesOn(iso).some(function (a) { return a && trim(a.name) === name && a.am && a.pm; });
  }

  // That day's daytime add-on call -> { name, holder }: the block
  // schedule's Surg 2 (holder), or — out all day — whoever covers them (the
  // AM coverer first); name '' when they are out and nobody covers (NC or
  // not decided yet). Out for half the day: still the holder.
  function addOnSurg2(iso) {
    var holder = surg2On(iso);
    if (!holder) return { name: '', holder: '' };
    var a = absencesOn(iso).filter(function (x) { return x && trim(x.name) === holder; })[0];
    if (!a || !(a.am && a.pm)) return { name: holder, holder: holder };
    function real(w) {
      w = trim(w);
      return w && w !== 'NC' && w !== holder && yearOf(w) && !outAllDayOn(iso, w) ? w : '';
    }
    return { name: real(a.coverAM) || real(a.coverPM), holder: holder };
  }

  function prefillAddOns() {
    var st = App.state;
    if (!st || !Array.isArray(st.addOns)) return;
    st.addOns.forEach(function (row) {
      if (!row || row.period !== 'day' || !row.date || row.cleared) return;
      var name = trim(row.name);
      var s2 = addOnSurg2(row.date);
      // app-filled: flagged, empty, or (days saved before the flag) still
      // holding the block schedule's Surg 2
      var appFilled = row.s2 === true || !name || (row.s2 === undefined && name === s2.holder);
      if (!appFilled) return;
      row.name = s2.name;
      row.s2 = true;
    });
  }

  /* Cooper buddy prefill (buddy call schedule) — roster.cooperBuddies may be
     absent (older engine.js); guard everything. Never overwrite a non-empty
     user value: prefill only when BOTH name and note are empty. */

  function prefillBuddies() {
    var st = App.state;
    var r = App.roster;
    if (!st || !r || !r.cooperBuddies) return;
    var cb = r.cooperBuddies;
    var am = st.cooperBuddyAM || (st.cooperBuddyAM = { name: '', note: '' });
    var pm = st.cooperBuddyPM || (st.cooperBuddyPM = { name: '', note: '' });
    if (cb.am && !trim(am.name) && !trim(am.note)) {
      st.cooperBuddyAM = { name: String(cb.am), note: String(cb.templateAM || '').toLowerCase() };
    }
    if (cb.pm && !trim(pm.name) && !trim(pm.note)) {
      st.cooperBuddyPM = { name: String(cb.pm), note: String(cb.templatePM || '').toLowerCase() };
    }
  }

  function buddyMatchesPrefill(b, name, template) {
    return !!name && !!b && trim(b.name) === String(name) &&
      trim(b.note) === trim(String(template || '').toLowerCase());
  }

  // True while the buddy fields still hold exactly the buddy-call values —
  // survives reloads, disappears as soon as the user edits either field.
  function buddiesAutoFilled() {
    var st = App.state;
    var r = App.roster;
    if (!st || !r || !r.cooperBuddies) return false;
    var cb = r.cooperBuddies;
    return buddyMatchesPrefill(st.cooperBuddyAM, cb.am, cb.templateAM) ||
      buddyMatchesPrefill(st.cooperBuddyPM, cb.pm, cb.templatePM);
  }

  /* Night Float prefill (UISPEC5 §B) — roster.nightFloat may be absent while
     the nfSchedule lands; guard everything. NEVER overwrite a user-typed
     value: prefill only when the field is empty AND the user has not
     deliberately blanked it (st.nfCleared) — otherwise every Update/Create
     recompute would resurrect the call-schedule name and an intentional
     blank (NF swap/vacancy night) would be unrepresentable. */

  function prefillNightFloat() {
    var st = App.state;
    var r = App.roster;
    if (!st || !r || !r.nightFloat) return;
    if (st.nfCleared) return;
    if (!trim(st.nightFloat)) st.nightFloat = String(r.nightFloat);
  }

  // True while the Night Float field still holds exactly the call-schedule
  // value — survives reloads, disappears the moment the user edits it.
  function nfAutoFilled() {
    var st = App.state;
    var r = App.roster;
    return !!(st && r && r.nightFloat && trim(st.nightFloat) === String(r.nightFloat));
  }

  // 'CPEC' when the NF resident's am/pm duties match, else 'CPEC AM / Peds PM'.
  // Duties may arrive as plain strings or resolved cells ({ text, notes }).
  function nfDutyText(duties) {
    function s(v) {
      if (v == null) return '';
      return trim(typeof v === 'string' ? v : v.text);
    }
    if (!duties) return '';
    var am = s(duties.am);
    var pm = s(duties.pm);
    if (am && am === pm) return am;
    var bits = [];
    if (am) bits.push(am + ' AM');
    if (pm) bits.push(pm + ' PM');
    return bits.join(' / ');
  }

  /* ------------------------------------------------------------------ */
  /* header                                                              */
  /* ------------------------------------------------------------------ */

  function renderHeader() {
    $('ayLabel').textContent = (data().ayLabel || '') + ' · ' + APP_VERSION + ' · build ' + BUILD;
    $('ayLabel').title = 'Build ' + BUILD + ' (' + BUILD_DATE + ')';
    renderPageHeads();
    var chips = $('dayChips');
    clearNode(chips);
    var r = App.roster;
    if (!r) return;
    chips.appendChild(chipEl(ordinal(r.nth) + ' ' + r.weekdayLabel, 'chip-day'));

    var banner = $('dayBanner');
    if (r.isWeekend) {
      banner.textContent = r.weekdayLabel + ' is a weekend — no block assignments. Manual entries and cases still work.';
      banner.classList.remove('hidden');
    } else if (!r.inYear) {
      banner.textContent = 'Date is outside ' + data().ayLabel + ' (' + data().ayStart + ' – ' + data().ayEnd + ') — no block data for this day.';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  // Page head on every tab: the step's icon (same as the landing cards),
  // "Step n of 6", the title and the weekday + date. Library pages get a
  // book icon and "Library".
  var LIB_TITLES = { howto: 'How-to', flow: 'Flow chart', cpec: 'CPEC sheet', reference: 'Block schedules', setup: 'Setup', 'import': 'Paste a sent schedule' };
  var LIB_ICON = '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>';
  var IMPORT_ICON = '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="12" y1="10" x2="12" y2="17"/><polyline points="9 14 12 17 15 14"/>';

  function iconSvg(inner, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }

  function pageHead(tab, actions) {
    var i = WORKFLOW_TABS.indexOf(tab);
    var step = i !== -1 ? HOME_STEPS[i] : null;
    var icon = el('span', { class: 'ph-icon', 'aria-hidden': 'true' });
    icon.innerHTML = iconSvg(step ? step.icon : (tab === 'import' ? IMPORT_ICON : LIB_ICON), 20);
    var d = App.state ? parseISO(App.state.date) : null;
    var head = el('div', { class: 'page-head' + (step ? ' workflow' : '') }, [
      icon,
      el('div', { class: 'ph-text' }, [
        el('span', { class: 'ph-eyebrow', text: step ? 'Step ' + (i + 1) + ' of ' + WORKFLOW_TABS.length : (tab === 'import' ? 'Hand-off' : 'Library') }),
        el('h1', { class: 'ph-title' }, [
          TAB_TITLES[tab] || LIB_TITLES[tab] || '',
          step && d ? el('span', { class: 'ph-date', text: weekdayName(d) + ' ' + fmtMDYY(d) }) : null
        ])
      ])
    ]);
    if (actions && actions.length) head.appendChild(el('div', { class: 'ph-actions' }, actions));
    return head;
  }

  function renderPageHeads() {
    var hosts = document.querySelectorAll('[data-head]');
    for (var k = 0; k < hosts.length; k++) {
      clearNode(hosts[k]);
      hosts[k].appendChild(pageHead(hosts[k].getAttribute('data-head')));
    }
  }

  /* ------------------------------------------------------------------ */
  /* tab 2 — Roster                                                      */
  /* ------------------------------------------------------------------ */

  function cellDiv(cell, extraNote) {
    var isSurg = /^Surg \d+$/.test(cell.text || '');
    var wrap = el('div', {}, [
      el('div', { class: 'cell-text' + (isSurg ? ' is-surg' : ''), text: cell.text || '—' })
    ]);
    (cell.notes || []).forEach(function (n) {
      wrap.appendChild(el('div', { class: 'cell-note', text: n }));
    });
    if (extraNote) wrap.appendChild(el('div', { class: 'cell-note nf-note', text: extraNote }));
    return wrap;
  }

  function renderRosterGrid() {
    var host = $('rosterGrid');
    clearNode(host);
    var r = App.roster;
    if (!r.residents.length) {
      host.appendChild(el('p', {
        class: 'empty-note',
        text: r.isWeekend ? 'Weekend — no scheduled block assignments.' : 'No block data for this date.'
      }));
      return;
    }
    var tbl = el('table', { class: 'tbl' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Resident' }), el('th', { text: 'Block' }),
      el('th', { text: 'AM' }), el('th', { text: 'PM' })
    ])]));
    var tbody = el('tbody');
    YEAR_ORDER.forEach(function (yk) {
      var group = r.residents.filter(function (res) { return res.year === yk; });
      if (!group.length) return;
      var gr = el('tr', { class: 'group-row ' + yk });
      var td = el('td', { colspan: '4', text: group[0].yearLabel });
      gr.appendChild(td);
      tbody.appendChild(gr);
      group.slice().sort(function (a, b) { return a.block - b.block; }).forEach(function (res) {
        var nameTd = el('td', {}, [el('span', { class: 'res-name ' + yk, text: res.name })]);
        if (res.taskmaster) {
          nameTd.appendChild(document.createTextNode(' '));
          nameTd.appendChild(el('span', { class: 'badge badge-tm', text: 'TM' }));
        }
        // The NF resident's daytime duties are covered by Day Float this week
        // (UISPEC5 §B) — amber note on both sessions. r.nightFloat may be
        // absent (older engine.js).
        var nfNow = App.board ? App.board.nightFloat : r.nightFloat;
        var nfNote = (nfNow && res.name === nfNow)
          ? 'Night Float this week — daytime covered by Day Float' : null;
        tbody.appendChild(el('tr', {}, [
          nameTd,
          el('td', {}, [el('span', { class: 'res-block', text: 'B' + res.block })]),
          el('td', {}, [cellDiv(res.am, nfNote)]),
          el('td', {}, [cellDiv(res.pm, nfNote)])
        ]));
      });
    });
    tbl.appendChild(tbody);
    host.appendChild(el('div', { class: 'table-scroll' }, [tbl]));
  }

  function glanceKV(k, v) {
    return el('span', { class: 'glance-kv' }, [
      el('span', { class: 'k', text: k }),
      el('b', { text: v })
    ]);
  }

  function renderSummary() {
    var host = $('rosterSummary');
    clearNode(host);
    var r = App.roster;
    var meta = data().surgRoleMeta || {};

    var chips = $('glanceChips');
    if (chips) {
      clearNode(chips);
      (r.specialClinicsToday || []).forEach(function (sc) {
        chips.appendChild(chipEl(sc, 'chip-special'));
      });
      // Dress code (UISPEC5 §D): Bilyk or Sergott in clinic → amber chip.
      var dressNames = dressCodeNames();
      if (dressNames.length) {
        chips.appendChild(chipEl(dressNames.join(' & ') + ' — business casual + white coat', 'chip-dress'));
      }
    }

    var surgKeys = Object.keys(r.surg || {}).sort(function (a, b) { return (+a) - (+b); });
    if (!surgKeys.length) {
      host.appendChild(el('p', { class: 'empty-note', text: 'Nothing derived for this date — pick a weekday inside the academic year.' }));
      return;
    }

    var grid = el('div', { class: 'glance-grid' });
    surgKeys.forEach(function (n) {
      var s = r.surg[n];
      // out (Out today): the tile names whoever does the job, as the copied
      // schedule prints it — 'Bair', for Cheng; 'AM Wibbelsman · PM Aguwa'
      var oc = outCovers(s.name);
      var by = { am: s.name, pm: s.name };
      oc.forEach(function (x) { by[x.s] = x.who === 'NC' ? 'NC' : x.who || 'TBD'; });
      var shown = by.am === by.pm ? by.am : 'AM ' + by.am + ' · PM ' + by.pm;
      var tile = el('div', { class: 'glance-tile' + (!oc.length ? '' : oc.some(function (x) { return !x.who; }) ? ' glance-tbd' : oc.some(function (x) { return x.who === 'NC'; }) ? ' glance-nc' : '') }, [
        el('div', { class: 'glance-role', text: 'Surg ' + n }),
        el('div', { class: 'glance-name', text: shown })
      ]);
      // How-to Step 2: Surg 3 and 4 are all day even when the grid shows a
      // clinic — the clinic is where they go when they have no case.
      var allDay = !!s.allDay;
      if (s.am && !s.pm) {
        tile.appendChild(el('div', {
          class: 'glance-sess' + (allDay ? ' glance-allday' : ''),
          text: allDay ? 'All day · ' + (s.pmText || '—') + ' PM if no case' : 'AM only · PM: ' + (s.pmText || '—')
        }));
      } else if (s.pm && !s.am) {
        tile.appendChild(el('div', {
          class: 'glance-sess' + (allDay ? ' glance-allday' : ''),
          text: allDay ? 'All day · ' + (s.amText || '—') + ' AM if no case' : 'PM only · AM: ' + (s.amText || '—')
        }));
      }
      if (oc.length) {
        var blocked = oc.filter(function (x) { return x.blocked; })[0];
        tile.appendChild(el('div', { class: 'glance-for', text: (oc.length === 1 ? oc[0].s.toUpperCase() + ' ' : '') + 'for ' + s.name + (blocked ? ' — ' + blocked.blocked : '') }));
      }
      grid.appendChild(tile);
    });
    host.appendChild(grid);

    var row = el('div', { class: 'glance-row' });
    // as the copied schedule writes them — whoever covers anyone out
    // (Out today) stands in: 'Djulbegovic AM/PM (for Teng)'
    var X = window.ExportFmt;
    var wer = X.werText(App.state, r);
    if (wer) row.appendChild(glanceKV('WER', wer));
    row.appendChild(glanceKV('Night Float', trim(App.state && App.state.nightFloat) || '—'));
    if ((r.jeffConsults || []).length) row.appendChild(glanceKV('Jeff Consults', X.consultText(App.state, r, r.jeffConsults)));
    if ((r.cooperConsults || []).length) {
      // 'Illiano + Camacho AM / DeSimone PM' when buddies are set (from state)
      var cooperVal = X.consultText(App.state, r, r.cooperConsults);
      var st = App.state || {};
      var buddyBits = [];
      var amName = trim(st.cooperBuddyAM && st.cooperBuddyAM.name);
      var pmName = trim(st.cooperBuddyPM && st.cooperBuddyPM.name);
      if (amName) buddyBits.push(amName + ' AM');
      if (pmName) buddyBits.push(pmName + ' PM');
      if (buddyBits.length) cooperVal += ' + ' + buddyBits.join(' / ');
      row.appendChild(glanceKV('Cooper Consults', cooperVal));
    }
    if ((r.dayFloat || []).length) {
      // 'Tang — covering Perez’s daytime (CPEC)' while the NF resident's
      // daytime duties fall to Day Float (UISPEC5 §B). Just the name when the
      // NF resident IS the day float, or when no coverage info exists.
      var dfVal = r.dayFloat.join(', ');
      var cov = r.dayFloatCoverage;
      var dfConflict = false;
      // the Night Float in use (the field above — a swap counts, a blank
      // means none), as on the board and in the copied schedule
      var nfName = App.board ? App.board.nightFloat : ((cov && cov.nf) || '');
      if (nfName) {
        if (r.dayFloat.indexOf(nfName) === -1) {
          var nfr = rosterRes(nfName);
          var duty = nfr ? nfDutyText({ am: nfr.am, pm: nfr.pm }) : '';
          dfVal += ' — covering ' + nfName + '’s daytime' + (duty ? ' (' + duty + ')' : '');
          if (App.board && r.dayFloat.some(function (n) { return App.board.isOut(n, 'am') || App.board.isOut(n, 'pm'); })) {
            dfVal += ' — but out today (Out today), so ' + nfName + '’s daytime is uncovered then';
            dfConflict = true;
          }
        } else {
          // The day-float-block resident is themselves on Night Float this
          // week — just note it.
          dfVal += ' (on Night Float)';
          dfConflict = true;
        }
      }
      var dfKV = glanceKV('Day Float', dfVal);
      if (dfConflict) dfKV.classList.add('glance-warn');
      row.appendChild(dfKV);
    }
    if ((r.taskmasters || []).length) row.appendChild(glanceKV('Taskmaster', r.taskmasters.join(' & ')));
    host.appendChild(row);
  }

  // a single input, select or textarea is labelled by its caption; a group
  // of controls keeps a plain container
  function labeledField(labelText, control, hint) {
    var single = /^(INPUT|SELECT|TEXTAREA)$/.test(control && control.tagName);
    var f = el(single ? 'label' : 'div', { class: 'field' }, [
      el('span', { class: 'field-label', text: labelText }), control
    ]);
    if (hint) f.appendChild(el('span', { class: 'field-hint', text: hint }));
    return f;
  }

  function buddyRow(sess, buddy) {
    var row = el('div', { class: 'buddy-row' });
    row.appendChild(el('span', { class: 'buddy-session', text: sess }));
    row.appendChild(residentSelect(buddy.name, function (v) {
      buddy.name = v;
      touch();
      renderSummary();
      updateBuddyHint();
    }, 'buddy…'));
    var note = el('input', { type: 'text', placeholder: 'note (e.g. private glaucoma)', value: buddy.note });
    note.addEventListener('input', function () { buddy.note = note.value; touch(); updateBuddyHint(); });
    row.appendChild(note);
    return row;
  }

  function updateBuddyHint() {
    var n = $('buddyHint');
    if (!n) return;
    var on = buddiesAutoFilled();
    n.textContent = on ? 'auto-filled from the buddy call schedule — edit freely' : '';
    n.classList.toggle('hidden', !on);
  }

  function updateNfHint() {
    var n = $('nfHint');
    if (!n) return;
    var txt = '';
    if (nfAutoFilled()) {
      txt = 'from the call schedule — edit freely';
    } else {
      // Field holds something other than the call-schedule name (manual swap,
      // stale copy…) — say so instead of hiding the mismatch.
      var st = App.state;
      var r = App.roster;
      if (st && r && r.nightFloat && trim(st.nightFloat) &&
          trim(st.nightFloat) !== String(r.nightFloat)) {
        txt = 'call schedule has ' + r.nightFloat + ' for this week';
      }
    }
    n.textContent = txt;
    n.classList.toggle('hidden', !txt);
  }

  function renderManualInputs() {
    var host = $('manualInputs');
    clearNode(host);
    var st = App.state;

    var lectures = el('textarea', { rows: '3', placeholder: 'Grand rounds, wet lab, journal club…' });
    lectures.value = st.lectures;
    lectures.addEventListener('input', function () { st.lectures = lectures.value; touch(); });
    host.appendChild(labeledField('Lectures / Events', lectures));

    var nf = el('input', { type: 'text', placeholder: 'resident name', value: st.nightFloat });
    nf.addEventListener('input', function () {
      st.nightFloat = nf.value;
      // Emptying the field is an explicit choice — remember it so recomputes
      // (Update/Create/date revisits) don't resurrect the call-schedule name.
      st.nfCleared = !trim(nf.value);
      touch();
      renderSummary();
      updateNfHint();
    });
    var nfField = labeledField('Night Float', nf);
    nfField.appendChild(el('span', { class: 'field-hint hidden', id: 'nfHint' }));
    host.appendChild(nfField);
    updateNfHint();

    // The Cooper buddy system runs only through Labor Day weekend — once the
    // roster carries no buddy info (and nothing was typed), drop the field.
    var cb = (App.roster && App.roster.cooperBuddies) || {};
    var buddySystemActive = !!(cb.am || cb.pm || cb.templateAM || cb.templatePM);
    var buddyTyped = !!(trim(st.cooperBuddyAM && st.cooperBuddyAM.name) ||
      trim(st.cooperBuddyPM && st.cooperBuddyPM.name) ||
      trim(st.cooperBuddyAM && st.cooperBuddyAM.note) ||
      trim(st.cooperBuddyPM && st.cooperBuddyPM.note));
    if (buddySystemActive || buddyTyped) {
      var buddies = el('div', {}, [
        buddyRow('AM', st.cooperBuddyAM),
        buddyRow('PM', st.cooperBuddyPM)
      ]);
      var buddiesField = labeledField('Cooper buddies', buddies);
      buddiesField.appendChild(el('span', { class: 'field-hint hidden', id: 'buddyHint' }));
      host.appendChild(buddiesField);
      updateBuddyHint();
    }

  }

  // The add-on call editor (Coverage tab).
  function addOnsEditor() {
    var st = App.state;
    var wrap = el('div');
    var d = data();
    st.addOns.forEach(function (row, idx) {
      var line = el('div', { class: 'addon-row' + (row.auto && row.date ? ' auto' : '') });

      // The three standard rows follow the schedule date, so they need no
      // controls — just the label and who is covering. Rows the user adds
      // carry their own date + night/day pickers.
      if (row.auto && row.date) {
        line.appendChild(el('span', { class: 'addon-label', text: addOnLabel(row) }));
      } else {
        var dateIn = el('input', { type: 'date', class: 'addon-date', value: row.date || '' });
        if (d.ayStart && d.ayEnd) { dateIn.min = d.ayStart; dateIn.max = d.ayEnd; }
        dateIn.addEventListener('change', function () {
          row.date = dateIn.value;
          row.label = addOnLabel(row);
          touch();
          renderAddOnsEverywhere();
        });
        line.appendChild(dateIn);

        var period = el('select', { class: 'addon-period' });
        [['day', 'daytime'], ['night', 'night']].forEach(function (p) {
          var o = el('option', { value: p[0], text: p[1] });
          if ((row.period || 'night') === p[0]) o.selected = true;
          period.appendChild(o);
        });
        period.addEventListener('change', function () {
          row.period = period.value;
          row.label = addOnLabel(row);
          touch();
          renderAddOnsEverywhere();
        });
        line.appendChild(period);
        line.appendChild(el('span', { class: 'addon-preview', text: addOnLabel(row) || '—' }));
      }

      // Anyone on vacation/sick that day (Out today — this day, or that
      // day's saved draft) is not offered for that day's rows. (Not the
      // Night Float resident — nights are exactly when they work.)
      var outThatDay = row.date
        ? absencesOn(row.date).filter(function (a) { return a && a.am && a.pm; }).map(function (a) { return trim(a.name); })
        : [];
      line.appendChild(addOnSelect(row, idx, outThatDay));
      var nm = trim(row.name);
      var s2 = row.period === 'day' && row.date ? addOnSurg2(row.date) : null;
      if (s2 && nm && nm === s2.name) {
        line.appendChild(el('span', {
          class: 'addon-hint', text: s2.name === s2.holder ? 'Surg 2' : 'Surg 2 for ' + s2.holder,
          title: s2.name === s2.holder ? 'Daytime add-ons are that day’s Surg 2 (from the block schedule)'
            : s2.holder + ' (Surg 2) is out — ' + s2.name + ' covers them, so takes daytime add-ons'
        }));
      } else if (s2 && !nm && s2.holder && !s2.name && !row.cleared) {
        line.appendChild(el('span', { class: 'addon-hint warn', text: s2.holder + ' (Surg 2) is out with nobody covering — pick who takes daytime add-ons' }));
      }
      if (nm && outThatDay.indexOf(nm) !== -1) {
        line.appendChild(el('span', { class: 'addon-hint bad', text: nm + ' is out that day' }));
      }
      line.appendChild(el('button', {
        type: 'button', class: 'btn-icon danger', title: 'Remove row', 'aria-label': 'Remove ' + (addOnLabel(row) || 'row'), text: '×',
        onclick: function () {
          st.addOns.splice(idx, 1);
          touch();
          renderAddOnsEverywhere();
        }
      }));
      wrap.appendChild(line);
    });
    wrap.appendChild(el('button', {
      type: 'button', class: 'btn btn-small', text: '+ Add add-on row',
      onclick: function () {
        var last = st.addOns[st.addOns.length - 1];
        st.addOns.push({
          date: (last && last.date) || st.date,
          period: 'night', label: '', name: '', auto: false
        });
        syncAddOnLabels();
        touch();
        renderAddOnsEverywhere();
      }
    }));
    return wrap;
  }

  // Add-on call is taken by PGY-4s (chief, 9/2026): the dropdown lists the
  // seniors, plus "Other…" for the rare exception, which opens the full list.
  var addOnOther = {}; // row index -> showing every resident (UI only)
  function addOnSelect(row, idx, hide) {
    var name = trim(row.name);
    var nonSenior = name && yearOf(name) !== 'pgy4';
    var sel = el('select', { class: 'sel addon-sel' });
    sel.appendChild(el('option', { value: '', text: 'resident…' }));
    if (addOnOther[idx] || nonSenior) {
      YEAR_ORDER.slice().reverse().forEach(function (yk) {
        var y = data().years[yk];
        if (!y) return;
        var og = el('optgroup', { label: y.short });
        y.residents.forEach(function (n) {
          if (hide.indexOf(n) !== -1 && n !== name) return;
          og.appendChild(el('option', { value: n, text: n }));
        });
        sel.appendChild(og);
      });
      sel.appendChild(el('option', { value: '__seniors__', text: '← third years only' }));
    } else {
      var y4 = data().years.pgy4;
      ((y4 && y4.residents) || []).forEach(function (n) {
        if (hide.indexOf(n) !== -1 && n !== name) return;
        sel.appendChild(el('option', { value: n, text: n }));
      });
      sel.appendChild(el('option', { value: '__other__', text: 'Other…' }));
    }
    sel.value = name;
    if (name && sel.value !== name) {
      sel.appendChild(el('option', { value: name, text: name }));
      sel.value = name;
    }
    sel.addEventListener('change', function () {
      if (sel.value === '__other__' || sel.value === '__seniors__') {
        addOnOther[idx] = sel.value === '__other__';
        if (!addOnOther[idx] && nonSenior) { row.name = ''; touch(); }
        renderAddOnsCard();
        var again = document.querySelectorAll('#addOnsCoverage .addon-sel')[idx];
        if (again) { try { again.focus(); } catch (e) { } }
        return;
      }
      row.name = sel.value;
      row.cleared = !sel.value; // an emptied daytime row stays empty (no Surg 2 refill)
      row.s2 = false;           // someone's choice — the app never swaps it
      touch();
      renderAddOnsCard();       // tags (Surg 2, out that day) follow the pick
    });
    return sel;
  }

  function renderAddOnsCard() {
    var host = $('addOnsCoverage');
    if (!host) return;
    clearNode(host);
    host.appendChild(addOnsEditor());
  }

  function renderAddOnsEverywhere() {
    renderAddOnsCard();
  }

  function renderRosterTab() {
    renderRosterGrid();
    renderSummary();
    renderManualInputs();
  }

  /* ------------------------------------------------------------------ */
  /* tab 3 — Surgery: one line per attending, the resident on the line   */
  /* ------------------------------------------------------------------ */
  // Reads like the schedule that gets sent: "Hark x1 · 1300 · cornea →
  // Bair". The suggested resident is a one-click pill on the line; the
  // backup appears under the line only when a case pulls someone out of
  // clinic; rarely used fields (service times, done by, notes) live behind
  // "⋯". Enter on a line adds the next one.

  var rowOpen = {};         // caseId -> details open (UI only)
  var resPicking = {};      // caseId -> 'res' | 'backup' while the full picker shows
  var focusAfterRender = null;

  function newCase(section) {
    var id = 'c' + App.state.seq;
    App.state.seq += 1;
    return {
      id: id, section: section, surgeon: '', count: 1,
      serviceCount: section === 'private' ? 0 : 1,
      start: '', serviceTimes: '', category: 'cataract', addOn: false,
      notes: '', assigned: '', backup: '', backupNote: '', until: ''
    };
  }

  // New line in `section`, right after `afterId` when given; focus lands on
  // its surgeon field.
  // New lines whose type still follows the attending typed (UI only): a
  // remembered type, globe/trauma, a CPEC-sheet attending → cataract, JHN →
  // plastics (review 10/19/2026: every other line needed a manual pick, and
  // a forgotten one silently got the cataract chain)
  var catFollows = {};

  function addCase(section, afterId) {
    var c = newCase(section);
    catFollows[c.id] = true;
    var idx = -1;
    if (afterId) App.state.cases.forEach(function (x, i) { if (x.id === afterId) idx = i; });
    if (idx === -1) App.state.cases.push(c);
    else App.state.cases.splice(idx + 1, 0, c);
    focusAfterRender = c.id;
    touch();
    computeBoard();
    renderSurgeryTab();
  }

  function removeCase(id) {
    App.state.cases = App.state.cases.filter(function (c) { return c.id !== id; });
    if (App.state.suggestions) delete App.state.suggestions[id];
    delete rowOpen[id];
    touch();
    computeBoard();
    renderSurgeryTab();
  }

  function duplicateCase(id) {
    var idx = -1;
    App.state.cases.forEach(function (c, i) { if (c.id === id) idx = i; });
    if (idx === -1) return;
    var copy = normCase(App.state.cases[idx]);
    copy.id = 'c' + App.state.seq;
    App.state.seq += 1;
    copy.assigned = '';
    copy.backup = '';
    copy.backupNote = '';
    App.state.cases.splice(idx + 1, 0, copy);
    touch();
    computeBoard();
    renderSurgeryTab();
  }

  function textInput(value, placeholder, onInput) {
    var inp = el('input', { type: 'text', value: value, placeholder: placeholder || '' });
    inp.addEventListener('input', function () { onInput(inp.value); });
    return inp;
  }

  function numInput(value, onInput) {
    var inp = el('input', { type: 'number', min: '0', step: '1', value: String(value) });
    inp.addEventListener('input', function () {
      onInput(Math.max(0, parseInt(inp.value, 10) || 0));
    });
    return inp;
  }

  // Fields that change WHEN someone is busy re-check availability a moment
  // after typing stops — never on blur ('change'), which fires in the middle
  // of a click on a pill and would swallow it. Only the live parts of each
  // line re-render, never the inputs, so typing keeps its focus.
  var assignRefreshTimer = null;
  function scheduleAssignRefresh() {
    if (assignRefreshTimer) clearTimeout(assignRefreshTimer);
    assignRefreshTimer = setTimeout(function () { assignRefreshTimer = null; refreshAssignAreas(); }, 350);
  }
  function onTimingChange(input) {
    input.addEventListener('input', scheduleAssignRefresh);
  }

  /* live suggestions — recomputed from the board on every refresh */

  var suggMap = {};
  function computeSuggestions() {
    suggMap = {};
    if (!window.Assign || !window.Assign.suggest) return;
    try {
      // a blank line (no surgeon, no resident) is a draft: it neither gets
      // a suggestion nor takes one from another line
      window.Assign.suggest(App.state.cases.filter(function (c) { return !isDraftCase(c); }), App.roster, data(), App.board).forEach(function (s) {
        suggMap[s.caseId] = s;
      });
    } catch (e) {
      if (window.console) console.error('suggest failed', e);
    }
  }

  function needsResident(c) { return c.serviceCount > 0 && !trim(c.assigned); }

  // Enter after the last line leaves a blank one (review 10/19/2026: it was
  // suggested a resident, counted as open and copied out as '-? x1')
  function isDraftCase(c) { return !trim(c.surgeon) && !trim(c.assigned); }

  // The case's resident is out while it runs (marked out on Out today after
  // the case was assigned) — the case needs someone new.
  // A checked-off case is over — whoever was on it, nothing more to do.
  function assignedOutCase(c) {
    var b = App.board;
    var a = trim(c.assigned);
    var info = b && b.caseInfo[c.id];
    if (!info || info.done || !a || !b.byName[a]) return false;
    return b.statusDuringSpans(a, info.spans, { exclude: c.id }).kind === 'out';
  }

  function caseDone(c) {
    var info = App.board && App.board.caseInfo[c.id];
    return info ? !!info.done : !!c.done;
  }

  // Still open on the open day — the board's rule (board.needs type 'case'):
  // a service case, not checked off, with nobody on it or whose resident is
  // out. (needsResident alone is for days without a board, e.g. a pasted
  // schedule.)
  function caseOpen(c) { return c.serviceCount > 0 && !caseDone(c) && !isDraftCase(c) && (!trim(c.assigned) || assignedOutCase(c)); }

  // 'Surg 2', or 'Surg 2 for Cheng' while standing in for an absent Surg 2,
  // in the session(s) `spans` touch.
  function roleTag(name, spans) {
    var b = App.board;
    if (!b) return '';
    var sess = (window.Assign && window.Assign.sessionsOfSpans && spans) ? window.Assign.sessionsOfSpans(spans) : [];
    for (var i = 0; i < sess.length; i++) {
      var roles = b.surgRolesAt ? b.surgRolesAt(name, sess[i]) : [];
      if (roles.length) return 'Surg ' + roles[0].n + (roles[0].for ? ' for ' + roles[0].for : '');
    }
    // out then: someone else holds their role — no tag
    if (sess.length && sess.every(function (s) { return b.isOut(name, s); })) return '';
    return b.surgRole[name] ? 'Surg ' + b.surgRole[name] : '';
  }

  // 'cornea' · 'CPEC' · 'CPEC / cornea' — a clinic in running text, acronyms kept
  function clinicWord(name) {
    return String(name || '').split(' / ').map(function (w) { return /^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase(); }).join(' / ');
  }

  function spanText(spans) {
    var S = window.Status;
    if (!S || !spans || !spans.length) return '';
    return spans.map(function (sp) { return S.fmtClock(sp.start) + '–' + S.fmtClock(sp.end); }).join(', ');
  }

  function shortClock(t) {
    var S = window.Status;
    return S ? S.fmtClock(t).replace(/ [AP]M$/, '') : '';
  }

  function isToday() { return App.state && App.state.date === isoOf(new Date()); }
  function nowMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  // How the assigned resident is doing for this case -> { tone, text }
  function assignedCheck(c, info) {
    var b = App.board;
    var name = trim(c.assigned);
    if (!b || !name || !b.byName[name] || !info) return null;
    if (info.done) return { tone: 'ok', text: name + ' — checked off as done' };
    var st = b.statusDuringSpans(name, info.spans, { exclude: c.id });
    if (st.kind === 'out') return { tone: 'bad', out: true, text: name + ' is out (' + st.label + ') — pick someone else' };
    if (st.kind === 'case') {
      // the role that always takes a globe takes it while operating: it
      // follows their cases (no estimated start — check in with them)
      if (holdsAlwaysRole(c, name, info.spans[0] && info.spans[0].start)) {
        return { tone: 'amber', follows: true, text: name + ' is operating (' + st.label + ') — ' + window.Assign.alwaysRole(c, data()) + ' always takes the globe: it follows their cases; check in with them' };
      }
      // …and that globe is no conflict for the list it follows
      var other = st.caseId && caseById(st.caseId);
      var oi = other && b.caseInfo[other.id];
      if (other && other.addOn && trim(other.assigned) === name && oi && oi.start > info.start) {
        return { tone: 'ok', text: name + ' is operating — ' + caseLabelOf(other) + ' follows this list' };
      }
      // their other list has no known end and starts first (or at the same
      // time, listed first; or this one has no start): this one follows it
      // — no guessed time, so check in (review 10/19/2026). Red stays for
      // a typed "Done by" that runs into this list.
      if (oi && trim(other.assigned) === name && oi.openEnded) {
        var otherFirst = oi.start < info.start || (oi.start === info.start &&
          ((info.unknownStart && !oi.unknownStart) || (!!info.unknownStart === !!oi.unknownStart && oi.order < info.order)));
        if (otherFirst) return { tone: 'amber', follows: true, text: 'Follows ' + caseLabelOf(other) + ' — check in with ' + name };
        return { tone: 'ok', text: name + ' is operating — ' + caseLabelOf(other) + ' follows this list' };
      }
      return { tone: 'bad', text: name + ' is double-booked — ' + statusShort(st) };
    }
    // their earlier list ends where this one starts (back to back): it follows
    var prevList = null;
    Object.keys(b.caseInfo).forEach(function (id) {
      var o = b.caseInfo[id];
      if (!prevList && o.endsAtNext === c.id && o.assigned === name && !o.done) prevList = o;
    });
    if (prevList) return { tone: 'amber', follows: true, text: 'Follows ' + caseLabelOf(prevList.c) + ' — check in with ' + name };
    // Retina / Uveitis: pulled first, no cover needed — as the backup pill shows it
    if (st.kind === 'clinic' && st.pullFirst) return { tone: 'ok', text: name + ' leaves ' + (st.clinic || 'clinic') + ' — no cover needed' };
    if (st.kind === 'clinic') return { tone: 'amber', kind: 'clinic', text: name + ' leaves ' + (st.clinic || 'clinic') + ' for this case' };
    if (st.kind === 'duty') return { tone: 'neutral', text: name + ' is on ' + st.label };
    return { tone: 'ok', text: name + ' is free then (' + st.label + ')' };
  }

  // `name` holds the role that always takes `c`'s kind (Surg 2 for a globe)
  // at minute t
  function holdsAlwaysRole(c, name, t) {
    var role = window.Assign && window.Assign.alwaysRole ? window.Assign.alwaysRole(c, data()) : '';
    var m = /^Surg (\d)$/.exec(role);
    if (!m || t == null || !App.board) return false;
    var a = App.board.actingSurg(m[1], t < App.board.noon ? 'am' : 'pm');
    return !!a && a.name === name;
  }

  // The pill's role, short: 'Surg 2' · 'Surg 2 for Cheng' · 'Retina, no
  // cover' · 'Cooper' — the full reason is the pill's title
  function suggVia(s) {
    var r = (s.reasons && s.reasons[0]) || '';
    var i = r.lastIndexOf('→ ');
    var via = i === -1 ? r : r.slice(i + 2);
    return via.replace(/ \(remaining-cases chain\)$/, '')
      .replace(/ — Surg \d always takes it$/, '')
      .replace(/^junior in (.+?) — no cover needed, Surg 2['’]s discretion$/, '$1, no cover')
      .replace(/ — Surg 2['’]s discretion$/, '')
      .replace(/ \(TABs \/ outpatient plastics only\)/, '')
      .replace(/^Cooper \(third year\)$/, 'Cooper');
  }

  function backupNoteFor(c, plan) {
    var S = window.Status;
    var t = 'to cover ' + clinicWord(plan.clinic || 'clinic') + ' clinic';
    if (plan.owner && plan.owner !== trim(c.assigned)) t += ' (for ' + plan.owner + ')';
    t += ' during case';
    var info = App.board && App.board.caseInfo[c.id];
    if (S && info && plan.window && info.start < plan.window.start) t += ' if it runs past ' + S.fmtClock(plan.window.start);
    if (plan.second) t += ', 2nd backup ' + plan.second.name + ' (' + plan.second.source + ')';
    return t;
  }

  // Give case c to `name`. Another resident leaves another clinic, so the
  // old backup and its note no longer apply (review 10/19/2026: a case
  // handed on printed "Cheng; Cheng").
  function setAssigned(c, name) {
    if (trim(c.assigned) !== trim(name)) {
      c.backup = '';
      c.backupNote = '';
    }
    c.assigned = name;
  }

  function lineOf(id) { return document.querySelector('.srow[data-case-id="' + id + '"]'); }

  function rerenderLine(c) {
    var row = lineOf(c.id);
    if (row) renderLineLive(c, row);
  }

  // The resident cell: suggested pill (one click) / assigned pill with a
  // status dot / the availability-grouped picker.
  function renderResCell(c, host) {
    clearNode(host);
    var b = App.board;
    var info = b && b.caseInfo[c.id];
    var sugg = suggMap[c.id];
    var assigned = trim(c.assigned);
    var service = c.serviceCount > 0;
    var picking = resPicking[c.id] === 'res';
    if (isDraftCase(c) && !picking) return; // a blank line: nothing until a surgeon is typed

    if (!service && !assigned && !picking) {
      host.appendChild(el('button', {
        type: 'button', class: 'res-quiet', text: 'private',
        title: 'No resident needed — click to assign one anyway',
        onclick: function () { resPicking[c.id] = 'res'; rerenderLine(c); }
      }));
      return;
    }
    if (picking || (!assigned && !(sugg && sugg.name))) {
      var pick = residentPicker(assigned, function (v) {
        setAssigned(c, v);
        delete resPicking[c.id];
        touch();
        refreshAssignAreas();
      }, {
        spans: info && info.spans, exclude: c.id,
        suggested: !assigned && sugg ? sugg.name : '',
        emptyLabel: assigned ? '— nobody —' : (service ? 'pick resident…' : 'no resident')
      });
      pick.classList.add('s-pick');
      if (picking) {
        pick.addEventListener('blur', function () {
          setTimeout(function () {
            if (resPicking[c.id] === 'res' && document.activeElement !== pick) {
              delete resPicking[c.id];
              rerenderLine(c);
            }
          }, 150);
        });
      }
      host.appendChild(pick);
      if (picking) setTimeout(function () { try { pick.focus(); } catch (e) { } }, 0);
      return;
    }
    if (!assigned) {
      var passed = (sugg.skipped || []).slice(0, 4).map(function (s) { return s.name + ' (' + s.why + ')'; });
      host.appendChild(el('button', {
        type: 'button', class: 'res-pill suggested',
        title: (sugg.reasons || []).join(' · ') + (passed.length ? ' · passed over ' + passed.join(', ') : ''),
        onclick: function () { setAssigned(c, sugg.name); touch(); refreshAssignAreas(); }
      }, [
        el('span', { class: 'res-mark', text: '+' }),
        el('b', { text: sugg.name }),
        el('span', { class: 'res-via', text: suggVia(sugg) })
      ]));
      host.appendChild(el('button', {
        type: 'button', class: 'res-other', text: 'other…', title: 'Pick someone else',
        onclick: function () { resPicking[c.id] = 'res'; rerenderLine(c); }
      }));
      return;
    }
    var chk = assignedCheck(c, info);
    var role = roleTag(assigned, info && info.spans);
    host.appendChild(el('button', {
      type: 'button', class: 'res-pill assigned ' + ((chk && chk.tone) || 'neutral'),
      title: (chk ? chk.text : '') + ' — click to change',
      onclick: function () { resPicking[c.id] = 'res'; rerenderLine(c); }
    }, [
      el('span', { class: 'res-dot', 'aria-hidden': 'true' }),
      el('b', { text: assigned }),
      role ? el('span', { class: 'res-via', text: role }) : null
    ]));
  }

  function backupPill(c, plan) {
    var wrap = el('span', { class: 'backup-cell' });
    var picking = resPicking[c.id] === 'backup';
    var cur = trim(c.backup);
    if (picking || (!cur && !(plan && plan.primary))) {
      var spans = plan && plan.window ? [{ start: plan.window.start, end: plan.window.end }] : null;
      var pick = residentPicker(cur, function (v) {
        c.backup = v;
        if (v && v !== 'NC' && plan && !trim(c.backupNote)) c.backupNote = backupNoteFor(c, plan);
        delete resPicking[c.id];
        touch();
        refreshAssignAreas();
      }, {
        spans: spans, exclude: c.id, emptyLabel: 'backup…', hideNames: [trim(c.assigned)],
        suggested: plan && plan.primary && !cur ? plan.primary.name : '',
        extra: [{ value: 'NC', text: 'NC — clinic not covered' }]
      });
      pick.classList.add('s-pick');
      if (picking) {
        pick.addEventListener('blur', function () {
          setTimeout(function () {
            if (resPicking[c.id] === 'backup' && document.activeElement !== pick) {
              delete resPicking[c.id];
              rerenderLine(c);
            }
          }, 150);
        });
        setTimeout(function () { try { pick.focus(); } catch (e) { } }, 0);
      }
      wrap.appendChild(pick);
      return wrap;
    }
    if (!cur) {
      wrap.appendChild(el('button', {
        type: 'button', class: 'res-pill suggested small',
        title: 'Suggested backup (' + plan.primary.source + ') — click to use',
        onclick: function () {
          c.backup = plan.primary.name;
          c.backupNote = backupNoteFor(c, plan);
          touch();
          refreshAssignAreas();
        }
      }, [el('span', { class: 'res-mark', text: '+' }), el('b', { text: plan.primary.name }), el('span', { class: 'res-via', text: plan.primary.source })]));
    } else {
      // can the backup actually cover then? (out, or in a case → red;
      // leaving their own clinic → amber) — it used to show green whatever
      var tone = cur === 'NC' ? 'neutral' : 'ok';
      var tip = 'Click to change';
      var flag = '';
      var bd = App.board;
      var info = bd && bd.caseInfo[c.id];
      var win = plan && plan.window ? plan.window : info;
      if (cur !== 'NC' && bd && bd.byName[cur] && win && win.end > win.start) {
        var bst = bd.statusDuring(cur, win.start, win.end, { exclude: c.id });
        // in a case of their own whose backup covers on (a chain — Surg 2
        // backs up a PKP, then takes a globe, whose backup covers the clinic):
        // amber; red only when the board really has the clinic uncovered
        var chainGap = bst.kind === 'case' && plan && (bd.needs || []).some(function (n) {
          return n.type === 'clinic' && n.clinic === plan.clinic && n.owner === plan.owner && n.start < win.end && win.start < n.end;
        });
        if (bst.kind === 'case' && plan && !chainGap) {
          tone = 'amber';
          flag = 'in a case';
          tip = cur + ' is ' + statusShort(bst) + ' — that case’s backup covers ' + plan.clinic + ' — click to change';
        } else if (bst.kind === 'out' || bst.kind === 'case') {
          tone = 'bad';
          flag = bst.kind === 'out' ? 'out' : 'in a case';
          tip = cur + ' cannot cover — ' + statusShort(bst) + ' — click to change';
        } else if (bst.kind === 'clinic' && !bst.pullFirst) {
          tone = 'amber';
          tip = cur + ' leaves ' + (bst.clinic || 'clinic') + ' to cover — click to change';
        }
      }
      wrap.appendChild(el('button', {
        type: 'button', class: 'res-pill assigned small ' + tone, title: tip,
        onclick: function () { resPicking[c.id] = 'backup'; rerenderLine(c); }
      }, [
        el('span', { class: 'res-dot', 'aria-hidden': 'true' }),
        el('b', { text: cur === 'NC' ? 'NC — not covered' : cur }),
        flag ? el('span', { class: 'res-via', text: flag }) : null
      ]));
      return wrap;
    }
    wrap.appendChild(el('button', {
      type: 'button', class: 'res-other', text: 'other…',
      onclick: function () { resPicking[c.id] = 'backup'; rerenderLine(c); }
    }));
    return wrap;
  }

  // Everything on a line that depends on who is where: resident cell,
  // the note line under it (backup / warning / why), and the timing text
  // inside the details.
  function partPrivate(c) {
    var svc = parseInt(c.serviceCount, 10) || 0;
    return svc > 0 && svc < (parseInt(c.count, 10) || 1);
  }

  function renderLineLive(c, row) {
    var b = App.board;
    var info = b && b.caseInfo[c.id];
    var res = row.querySelector('.s-res');
    if (res) {
      // rebuilding the pill under the keyboard keeps the focus on it
      var hadFocus = res.contains(document.activeElement) && document.activeElement !== document.body;
      renderResCell(c, res);
      if (hadFocus) {
        var again = res.querySelector('button, select');
        if (again) again.focus();
      }
    }
    var svcTWrap = row.querySelector('.s-svct-wrap');
    if (svcTWrap) {
      svcTWrap.classList.toggle('hidden', c.section === 'private' || !(partPrivate(c) || trim(c.serviceTimes)));
      // part private with no service time: the field asks (amber), not a sentence
      var svcIn = svcTWrap.querySelector('.s-svct');
      if (svcIn) svcIn.classList.toggle('s-ask', !!(info && info.svcAssumed));
    }

    var sub = row.querySelector('.s-sub');
    if (sub) {
      clearNode(sub);
      var assigned = trim(c.assigned);
      var sugg = suggMap[c.id];
      if (assigned) {
        var chk = assignedCheck(c, info);
        if (chk && chk.tone === 'bad') {
          var badLine = el('div', { class: 's-note bad' }, ['⚠ ' + chk.text + ' ']);
          // out: the how-to's pick in their place, one click
          if (chk.out && sugg && sugg.name && sugg.name !== assigned) {
            badLine.appendChild(el('button', {
              type: 'button', class: 'res-pill suggested small',
              title: 'In their place: ' + (sugg.reasons || []).join(' · ') + ' — click to assign',
              onclick: function () {
                setAssigned(c, sugg.name);
                touch();
                refreshAssignAreas();
                toast(sugg.name + ' takes ' + caseLabelOf(c) + ' in place of ' + assigned);
              }
            }, [el('span', { class: 'res-mark', text: '+' }), el('b', { text: sugg.name }), el('span', { class: 'res-via', text: suggVia(sugg) })]));
          }
          sub.appendChild(badLine);
        }
        // a globe goes to Surg 2 even while they are operating: it follows their cases
        if (chk && chk.follows) sub.appendChild(el('div', { class: 's-note amber', text: chk.text }));
        if (c.done && info && info.done) {
          sub.appendChild(el('div', { class: 's-note done-note', text: '✓ Done ' + window.Status.fmtClock(info.end) }));
        }

        var plan = null;
        if (window.Assign && window.Assign.backupPlan && b) {
          try { plan = window.Assign.backupPlan(c, App.roster, data(), App.state.cases, b); } catch (e) { plan = null; }
        }
        if (plan || trim(c.backup)) {
          var S = window.Status;
          var line = el('div', { class: 's-note backup' + (plan && !trim(c.backup) ? ' needs' : '') });
          // '↳ Glaucoma from 1:00 — backup' (an end only when typed)
          line.appendChild(el('span', {
            class: 's-note-text',
            text: plan
              ? '↳ ' + plan.clinic + (plan.owner !== assigned ? ' (for ' + plan.owner + ')' : '') +
                (S && plan.window ? ' ' + (info && !info.openEnded ? shortClock(plan.window.start) + '–' + shortClock(plan.window.end) : 'from ' + shortClock(plan.window.start)) : '') + ' — backup'
              : '↳ backup'
          }));
          if (plan && !plan.primary && !trim(c.backup)) {
            var freeOther = (plan.outside || []).concat((plan.pullable || []).map(function (n) { return n + ' (no cover)'; }));
            line.appendChild(el('span', {
              class: 's-note-warn',
              text: 'no one free on the chain' + (freeOther.length ? ' · free: ' + freeOther.join(', ') : '')
            }));
          }
          line.appendChild(backupPill(c, plan));
          sub.appendChild(line);
        }
      } else if (sugg && c.serviceCount > 0) {
        // one short line at most: nobody free (and who else is), what a
        // globe follows, a heavy load or a missing start — the rest is in
        // the pill's title (review 10/19/2026: 1–3 grey lines on 9 of 16 rows)
        if (!sugg.name) {
          var others = (sugg.outside || []).concat((sugg.pullable || []).map(function (n) { return n + ' (no cover)'; }));
          sub.appendChild(el('div', { class: 's-note', text: 'No one free on the chain — Surg 2’s call' + (others.length ? ' · free: ' + others.join(', ') : '') }));
        } else if (sugg.follows) {
          sub.appendChild(el('div', { class: 's-note amber', text: 'Follows ' + sugg.follows + ' — check in with ' + sugg.name }));
        } else {
          var keep = (sugg.warnings || []).filter(function (w) { return /already has \d+ cases|^No start time/.test(w); })[0];
          if (keep) sub.appendChild(el('div', { class: 's-note', text: keep }));
        }
      }
      sub.classList.toggle('hidden', !sub.firstChild);
    }

    var timing = row.querySelector('.s-timing');
    if (timing) {
      clearNode(timing);
      if (info && info.done) {
        // the same check-off as on Coverage ("Operating today")
        timing.appendChild(document.createTextNode('Done at ' + window.Status.fmtClock(info.end) + (trim(c.assigned) ? ' — ' + trim(c.assigned) + ' is free from then' : '') + ' '));
        timing.appendChild(el('button', {
          type: 'button', class: 'btn btn-small', text: 'Not done',
          title: 'Uncheck — the case is open again',
          onclick: function () { c.done = false; c.doneAt = ''; touch(); refreshAssignAreas(); }
        }));
      } else if (info && (c.serviceCount > 0 || trim(c.assigned))) {
        // only what was typed: a "Done by" end or All day
        if (!info.openEnded || info.allDay) timing.appendChild(document.createTextNode('Operating ' + operatingWhen(info)));
        if (isToday() && trim(c.assigned) && info.spans.length) {
          var now = nowMinutes();
          var last = info.spans[info.spans.length - 1];
          if (now >= info.spans[0].start && now < last.end) {
            // Checks the case off, exactly as Coverage does — one way to say
            // "done", so both tabs agree (it used to type over "Done by").
            timing.appendChild(el('button', {
              type: 'button', class: 'btn btn-small', text: 'Done now',
              title: 'Check the case off — ' + trim(c.assigned) + ' is free from now',
              onclick: function () {
                c.done = true;
                c.doneAt = window.Status.fmtHHMM(Math.round(nowMinutes() / 5) * 5);
                touch();
                refreshAssignAreas();
                toast('Checked off — ' + trim(c.assigned) + ' is free from now');
              }
            }));
          }
        }
      }
    }
  }

  function lineKeydown(c) {
    return function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (isDraftCase(c)) return; // already a blank line to type into
        addCase(c.section, c.id);
      }
      // Tab out of a field: settle the pending refresh now, so focus lands
      // on the rebuilt suggestion, not a pill about to be replaced
      if (ev.key === 'Tab' && assignRefreshTimer) refreshAssignAreas();
    };
  }

  function surgeryLine(c) {
    var row = el('div', { class: 'srow' + (rowOpen[c.id] ? ' open' : ''), 'data-case-id': c.id });
    var main = el('div', { class: 'srow-main' });

    var sur = textInput(c.surgeon, 'Surgeon', function (v) {
      var was = trim(c.surgeon);
      c.surgeon = v;
      var refresh = !was !== !trim(v); // a draft line becomes a case (or back)
      if (catFollows[c.id] && window.ImportFmt && window.ImportFmt.inferCategory) {
        var entries = [];
        try { entries = (cpecInfo() || {}).entries || []; } catch (e) { entries = []; }
        var t = window.ImportFmt.inferCategory({ surgeon: v, section: c.section }, {
          knownTypes: knownSurgeonTypes(),
          cpecSurgeons: entries.map(function (e) { return e.attending; })
        });
        if (t !== 'other' && t !== c.category) { c.category = t; cat.value = t; refresh = true; }
      }
      touch();
      if (refresh) scheduleAssignRefresh();
    });
    sur.className = 's-surgeon';
    sur.setAttribute('aria-label', 'Surgeon');
    // the service count follows the count until it is edited (review
    // 10/19/2026: 'Hark x4' copied out as '…, x1 service')
    var cnt = numInput(c.count, function (v) {
      if (c.section !== 'private' && (parseInt(c.serviceCount, 10) || 0) === (parseInt(c.count, 10) || 0)) {
        c.serviceCount = v;
        svc.value = String(v);
      }
      c.count = v;
      touch();
    });
    cnt.className = 's-count';
    cnt.setAttribute('aria-label', 'Number of cases');
    cnt.title = 'Number of cases';
    onTimingChange(cnt);
    var st = textInput(c.start, 'start', function (v) { c.start = v; touch(); });
    st.className = 's-start';
    st.setAttribute('aria-label', 'Start time');
    onTimingChange(st);
    var cat = el('select', { class: 's-cat', 'aria-label': 'Category' });
    CATEGORIES.forEach(function (k) { cat.appendChild(el('option', { value: k, text: k })); });
    cat.value = c.category;
    cat.addEventListener('change', function () { delete catFollows[c.id]; c.category = cat.value; rememberSurgeonType(c.surgeon, c.section, c.category); touch(); refreshAssignAreas(); });
    var svc = numInput(c.serviceCount, function (v) { c.serviceCount = v; touch(); });
    svc.className = 's-svc';
    svc.setAttribute('aria-label', 'Service cases');
    svc.title = 'Service cases — 0 means private, no resident';
    onTimingChange(svc);
    // When the service case(s) start — for a list with private cases the
    // resident is busy only then (chief, 9/28/2026). Shown for part-private
    // lists (or once a time is set).
    var svcT = textInput(c.serviceTimes, 'time', function (v) { c.serviceTimes = v; touch(); });
    svcT.className = 's-svct';
    svcT.setAttribute('aria-label', 'Service case time(s)');
    svcT.title = 'When the service case(s) start, e.g. 1015 or 1030 & 1300 — the resident is busy only then';
    onTimingChange(svcT);
    [sur, cnt, st, svc, svcT].forEach(function (inp) { inp.addEventListener('keydown', lineKeydown(c)); });

    main.appendChild(el('span', { class: 's-sur-wrap' }, [
      sur,
      c.addOn ? el('span', { class: 'badge badge-addon', text: 'ADD-ON' }) : null
    ]));
    main.appendChild(el('span', { class: 's-x', text: '×', 'aria-hidden': 'true' }));
    main.appendChild(cnt);
    main.appendChild(st);
    main.appendChild(cat);
    var svcWrap = el('label', { class: 's-svc-wrap' + (c.section === 'private' ? ' hidden' : ''), title: svc.title }, [svc, el('span', { class: 's-svc-label', text: 'svc' })]);
    main.appendChild(svcWrap);
    main.appendChild(el('label', { class: 's-svct-wrap hidden', title: svcT.title }, [el('span', { class: 's-at', text: '@' }), svcT]));
    main.appendChild(el('span', { class: 's-arrow', text: '→', 'aria-hidden': 'true' }));
    main.appendChild(el('div', { class: 's-res' }));
    var more = el('button', {
      type: 'button', class: 's-more', text: '⋯', title: 'Done by, notes, add-on, move, delete', 'aria-label': 'Case details',
      'aria-expanded': rowOpen[c.id] ? 'true' : 'false',
      onclick: function () {
        rowOpen[c.id] = !rowOpen[c.id];
        row.classList.toggle('open', !!rowOpen[c.id]);
        more.setAttribute('aria-expanded', rowOpen[c.id] ? 'true' : 'false');
      }
    });
    main.appendChild(more);
    row.appendChild(main);
    row.appendChild(el('div', { class: 's-sub hidden' }));
    row.appendChild(lineDetails(c));
    renderLineLive(c, row);
    return row;
  }

  function lineDetails(c) {
    var d = el('div', { class: 's-details' });
    var grid = el('div', { class: 's-details-grid' });

    var box = el('input', { type: 'checkbox' });
    box.checked = c.addOn;
    var pill = el('label', { class: 'pill-check' + (c.addOn ? ' on' : '') }, [box, 'Add-on']);
    box.addEventListener('change', function () {
      c.addOn = box.checked;
      touch();
      computeBoard();
      renderSurgeryTab();
    });
    grid.appendChild(el('div', { class: 's-d-pill' }, [pill]));

    var until = textInput(c.until, 'e.g. 1430', function (v) { c.until = v; touch(); });
    until.classList.add('s-until');
    onTimingChange(until);
    grid.appendChild(miniField('Done by', until));
    grid.appendChild(miniField('Notes', textInput(c.notes, 'no Peds OR…', function (v) { c.notes = v; touch(); })));
    grid.appendChild(miniField('Backup note', textInput(c.backupNote, '', function (v) { c.backupNote = v; touch(); })));
    d.appendChild(grid);

    var foot = el('div', { class: 's-details-foot' });
    foot.appendChild(el('span', { class: 's-timing' }));
    var move = el('select', { class: 'sel s-move', 'aria-label': 'Move to section' });
    CASE_SECTIONS.forEach(function (sd) { move.appendChild(el('option', { value: sd.key, text: 'In: ' + sd.label })); });
    move.value = c.section;
    move.addEventListener('change', function () {
      c.section = move.value;
      if (c.section === 'private' && !trim(c.assigned)) c.serviceCount = 0;
      caseSectionOpen[c.section] = true;
      touch();
      computeBoard();
      renderSurgeryTab();
    });
    foot.appendChild(move);
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-small', text: 'Duplicate', onclick: function () { duplicateCase(c.id); } }));
    foot.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-danger', text: 'Delete', onclick: function () { removeCase(c.id); } }));
    d.appendChild(foot);
    return d;
  }

  function miniField(labelText, control, cls) {
    return el('label', { class: 'mini-field' + (cls ? ' ' + cls : '') }, [
      el('span', { class: 'mini-label', text: labelText }),
      control
    ]);
  }

  // Re-render the live parts of every line (and the counters) against a
  // fresh board — inputs are never rebuilt, so focus is kept.
  function refreshAssignAreas() {
    if (assignRefreshTimer) { clearTimeout(assignRefreshTimer); assignRefreshTimer = null; }
    computeBoard();
    computeSuggestions();
    (App.state.cases || []).forEach(function (c) {
      var row = lineOf(c.id);
      if (row) renderLineLive(c, row);
    });
    renderSurgeryToolbar();
    renderSectionCounts();
    renderAvailStrip();
    renderBadges();
  }

  // Every suggested resident, then every suggested clinic backup — one at a
  // time against a fresh board, so two cases never take the same backup
  // (review 10/19/2026: each backup still needed a click)
  function acceptAllSuggestions() {
    computeBoard();
    computeSuggestions();
    var n = 0;
    App.state.cases.forEach(function (c) {
      var s = suggMap[c.id];
      if (s && s.name && caseOpen(c) && s.name !== trim(c.assigned)) { setAssigned(c, s.name); n++; }
    });
    computeBoard();
    var nb = 0;
    App.state.cases.forEach(function (c) {
      if (!trim(c.assigned) || trim(c.backup) || caseDone(c) || !window.Assign || !window.Assign.backupPlan) return;
      var plan = null;
      try { plan = window.Assign.backupPlan(c, App.roster, data(), App.state.cases, App.board); } catch (e) { plan = null; }
      if (!plan || !plan.primary) return;
      c.backup = plan.primary.name;
      c.backupNote = backupNoteFor(c, plan);
      nb++;
      computeBoard();
    });
    touch();
    computeBoard();
    renderSurgeryTab();
    toast(n || nb ? 'Assigned ' + n + (nb ? ' · ' + nb + ' backup' + (nb === 1 ? '' : 's') : '') : 'Nothing to assign');
  }

  function renderSurgeryToolbar() {
    var host = $('surgeryToolbar');
    if (!host) return;
    clearNode(host);
    var cases = App.state.cases || [];
    var needs = cases.filter(caseOpen);
    var acceptable = needs.filter(function (c) { return suggMap[c.id] && suggMap[c.id].name; }).length;
    var stat = el('div', { class: 'surg-stat' });
    if (!cases.length) stat.appendChild(el('span', { class: 'field-hint', text: 'No cases yet' }));
    else if (!needs.length) stat.appendChild(el('span', { class: 'stat-ok', text: '✓ every service case has a resident' }));
    else stat.appendChild(el('span', { class: 'stat-warn', text: needs.length + ' need' + (needs.length === 1 ? 's' : '') + ' a resident' }));
    var actions = [stat];
    if (acceptable) {
      actions.push(el('button', {
        type: 'button', class: 'btn btn-primary', text: 'Assign all (' + acceptable + ')',
        onclick: acceptAllSuggestions
      }));
    }
    host.appendChild(pageHead('surgery', actions));
  }

  function renderSectionCounts() {
    SURGERY_ORDER.forEach(function (key) {
      var n = document.querySelector('.ssec[data-sec="' + key + '"] .ssec-need');
      if (!n) return;
      var k = (App.state.cases || []).filter(function (c) { return c.section === key && caseOpen(c); }).length;
      n.textContent = k ? k + ' need' + (k === 1 ? 's' : '') + ' a resident' : '';
      n.classList.toggle('hidden', !k);
    });
  }

  var SECTION_SHORT = { wills: 'Wills', other: 'Stadium / Cherry Hill (ASC)', jhn: 'JHN / TJUH / JSC', private: 'Privates' };

  function renderCaseSections() {
    var wrap = $('caseSections');
    clearNode(wrap);
    SURGERY_ORDER.forEach(function (key) {
      var list = App.state.cases.filter(function (c) { return c.section === key; });
      var sec = el('section', { class: 'ssec' + (list.length ? '' : ' empty'), 'data-sec': key });
      var head = el('div', { class: 'ssec-head' }, [
        el('h3', { class: 'ssec-title', text: SECTION_SHORT[key] || key }),
        list.length ? el('span', { class: 'count-badge', text: list.length + (list.length === 1 ? ' line' : ' lines') }) : null,
        el('span', { class: 'count-badge count-badge-warn ssec-need hidden' }),
        el('button', {
          type: 'button', class: 'btn btn-small ssec-add', text: '+ Add',
          title: 'Add a line to ' + (SECTION_SHORT[key] || key),
          onclick: function () { addCase(key); }
        })
      ]);
      sec.appendChild(head);
      if (list.length) {
        sec.appendChild(el('div', { class: 'scols', 'aria-hidden': 'true' }, [
          el('span', { text: 'Surgeon' }), el('span'), el('span', { text: '#' }), el('span', { text: 'Start' }),
          el('span', { text: 'Category' }), el('span', { class: key === 'private' ? 'invisible' : '', text: 'Svc' }),
          el('span'), el('span', { text: 'Resident' }), el('span')
        ]));
        list.forEach(function (c) { sec.appendChild(surgeryLine(c)); });
      }
      wrap.appendChild(sec);
    });
    renderSectionCounts();
    if (focusAfterRender) {
      var inp = document.querySelector('.srow[data-case-id="' + focusAfterRender + '"] .s-surgeon');
      focusAfterRender = null;
      if (inp) { try { inp.focus(); } catch (e) { } }
    }
  }

  /* clinics sub-section */

  function clinicOverride(key, create) {
    var ov = App.state.clinicStaffOverrides[key];
    if (!ov && create) {
      ov = App.state.clinicStaffOverrides[key] = { removed: [], added: [] };
    }
    return ov;
  }

  function effectiveClinicStaff(label, session) {
    var grp = (App.roster.clinics || {})[label];
    var base = ((grp && grp[session]) || []).map(function (p) { return p.name; });
    var ov = clinicOverride(label + '|' + session, false) || {};
    var removed = ov.removed || [];
    var out = base.filter(function (n) { return removed.indexOf(n) === -1; });
    (ov.added || []).forEach(function (n) { if (out.indexOf(n) === -1) out.push(n); });
    return { base: base, staff: out };
  }

  function removeClinicStaff(label, session, name) {
    var key = label + '|' + session;
    var ov = clinicOverride(key, true);
    var ai = ov.added.indexOf(name);
    if (ai !== -1) ov.added.splice(ai, 1);
    else if (ov.removed.indexOf(name) === -1) ov.removed.push(name);
    touch();
    computeBoard();
    renderClinicsTab();
  }

  function addClinicStaff(label, session, name) {
    if (!name) return;
    var key = label + '|' + session;
    var ov = clinicOverride(key, true);
    var ri = ov.removed.indexOf(name);
    if (ri !== -1) ov.removed.splice(ri, 1);
    else if (ov.added.indexOf(name) === -1) ov.added.push(name);
    touch();
    computeBoard();
    renderClinicsTab();
  }

  function clinicCountEntry(key) {
    var cc = App.state.clinicCounts[key];
    if (!cc) cc = App.state.clinicCounts[key] = { count: '', extra: '' };
    return cc;
  }

  /* Dress code (UISPEC5 §D): Bilyk or Sergott in clinic → business casual +
     white coat. Detected from roster.specialClinicsToday plus any clinic
     label / count / note text; the Clinics-card banner re-evaluates as the
     user types into count/note fields, the glance chip on every summary
     render (Update/Create). */

  function dressCodeNames() {
    var found = [];
    function scan(s) {
      s = String(s == null ? '' : s);
      if (found.indexOf('Bilyk') === -1 && /bilyk/i.test(s)) found.push('Bilyk');
      if (found.indexOf('Sergott') === -1 && /sergott/i.test(s)) found.push('Sergott');
    }
    var r = App.roster || {};
    (r.specialClinicsToday || []).forEach(scan);
    Object.keys(r.clinics || {}).forEach(scan);
    var counts = (App.state && App.state.clinicCounts) || {};
    Object.keys(counts).forEach(function (k) {
      scan(k.split('|')[0]);
      var v = counts[k] || {};
      scan(v.count);
      scan(v.extra);
    });
    return found;
  }

  function updateDressBanner() {
    var n = $('clinicDressBanner');
    if (!n) return;
    var names = dressCodeNames();
    n.textContent = names.length
      ? names.join(' & ') + ' clinic today — business casual + white coat' : '';
    n.classList.toggle('hidden', !names.length);
  }

  // Who is actually standing in for `owner` in `clinic` over [from, to) —
  // follows chains (Surg 2 covers, then Surg 2 takes a globe and Surg 4
  // covers). -> [{ name|'' , start, end }]
  function coveredBySegments(owner, clinic, from, to) {
    var b = App.board;
    var out = [];
    for (var t = from; t < to; t += 5) {
      var who = '';
      for (var i = 0; i < b.order.length && !who; i++) {
        var m = b.order[i];
        if (m === owner) continue;
        var st = b.statusAt(m, t + 1);
        if (st.kind === 'clinic' && st.clinic === clinic && st.covering === owner) who = m;
      }
      var last = out[out.length - 1];
      if (last && last.name === who && last.end === t) last.end = Math.min(t + 5, to);
      else out.push({ name: who, start: t, end: Math.min(t + 5, to) });
    }
    return out;
  }

  // What is actually happening to a clinic session's staff: who is out (and
  // who covers), who is covering someone elsewhere, who is pulled into a case
  // (and who covers during it). -> { lines: [{text, bad}], away: {name: true} }
  function clinicStatusNotes(label, session, staff) {
    var out = { lines: [], away: {} };
    var b = App.board;
    var S = window.Status;
    if (!b || !S || (session !== 'am' && session !== 'pm')) return out;
    // as the board decides it: Retina / Uveitis, PT … need no backfill, nor
    // does a label the board does not count as a clinic (an attending's
    // cataract day, Cooper Clinic) — never a red "nobody covering" there
    var av = data().availability || {};
    var noCoverHere = (av.noCoverTexts || ['PT', 'Day Float']).concat(av.pullFirstTexts || ['Retina', 'Retina Private', 'Uveitis']).indexOf(label) !== -1 ||
      S.classifyText(label, data()) !== 'clinic';
    var from = session === 'am' ? b.dayStart : b.noon;
    var to = session === 'am' ? b.noon : b.dayEnd;
    staff.forEach(function (name) {
      if (!b.byName[name]) return;
      var base = b.base[name][session];
      if (base.kind === 'out') {
        // covered: the chip already reads 'Samuel (for Nahar)'; no cover
        // needed here: nothing to say
        out.away[name] = true;
        var oc = outCovers(name).filter(function (x) { return x.s === session; })[0] || {};
        if (oc.who && oc.who !== 'NC') return;
        if (noCoverHere && oc.who !== 'NC') return;
        out.lines.push({
          text: name + ' out — ' + (oc.who === 'NC' ? 'NC' : oc.blocked ? 'TBD (' + oc.blocked + ')' : 'no cover yet'),
          bad: oc.who !== 'NC'
        });
        return;
      }
      if (base.covering && base.text !== label) {
        out.away[name] = true;
        out.lines.push({ text: name + ' → ' + base.text + ' (for ' + base.covering + ')', bad: false });
        return;
      }
      // pulled into a case during the session?
      var segs = b.segments(name).filter(function (sg) {
        return sg.kind === 'case' && sg.start < to && from < sg.end;
      });
      segs.forEach(function (sg) {
        var caseId = sg.status && sg.status.caseId;
        var info = caseId && b.caseInfo[caseId];
        var s0 = Math.max(sg.start, from);
        var s1 = Math.min(sg.end, to);
        var who = coveredBySegments(name, label, s0, s1);
        var gap = who.some(function (w) { return !w.name; });
        // only times someone typed: the list's start when it starts in this
        // session ('AM TF' as typed); never the board's edges (7:00, noon,
        // 5:00) nor a guessed end (review 10/19/2026)
        var when = sg.start < from ? ' (since the morning)'
          : info && info.unknownStart ? (trim(info.c.start) ? ' (' + trim(info.c.start) + ')' : '')
          : ' from ' + S.fmtClock(s0);
        var txt = name + ' in ' + sg.label + when;
        if (noCoverHere && !who.some(function (w) { return w.name; })) {
          gap = false;
        } else if (info && info.backup === 'NC' && !who.some(function (w) { return w.name; })) {
          txt += ' — NC';
          gap = false;
        } else if (who.length === 1) {
          txt += who[0].name ? ' → ' + who[0].name : ', no cover';
        } else {
          txt += ' → ' + who.map(function (w, i) {
            return (w.name || 'nobody') + (i ? ' from ' + S.fmtClock(w.start) : '');
          }).join(', then ');
        }
        out.lines.push({ text: txt, bad: gap });
      });
    });
    return out;
  }

  // One Clinics-card row. session 'am'/'pm' gets the usual badge; the
  // standing 'day' session (CPEC PO, UISPEC5 §C) renders no badge — its
  // export line carries no session suffix either.
  function clinicRowEl(label, session, opts) {
    opts = opts || {};
    var eff = effectiveClinicStaff(label, session);
    var key = label + '|' + session;
    var cc = App.state.clinicCounts[key];

    var row = el('div', { class: 'clinic-row' + (opts.standing ? ' clinic-standing' : '') });
    var labelSpan = el('span', { class: 'clinic-label' }, [label + ' ']);
    if (session === 'am' || session === 'pm') {
      labelSpan.appendChild(el('span', {
        class: 'badge ' + (session === 'am' ? 'badge-am' : 'badge-pm'),
        text: session.toUpperCase()
      }));
    }
    if (opts.subLabel) labelSpan.appendChild(el('span', { class: 'clinic-sub', text: opts.subLabel }));
    row.appendChild(labelSpan);

    var chips = el('span', { class: 'clinic-chips' });
    var notes = clinicStatusNotes(label, session, eff.staff);
    var bd = App.board;
    var shown = eff.staff.slice();
    eff.staff.forEach(function (name) {
      // out with a cover: the chip is the cover, as the copied line prints
      // it ('Samuel (for Nahar)'); away otherwise: struck. Neither gets ×
      // (review 10/19/2026: × on a struck chip silently dropped the cover
      // from the copied schedule) — the cover is changed on Out today.
      var si = (session === 'am' || session === 'pm') && bd && bd.isOut(name, session) ? bd.standIn(name, session) : '';
      if (si) {
        shown.push(si);
        chips.appendChild(el('span', { class: 'name-chip no-x ' + yearOf(si), title: name + ' is out — ' + si + ' covers (Out today)' }, [si + ' (for ' + name + ')']));
        return;
      }
      var away = !!notes.away[name];
      var chip = nameChip(name, away ? null : function () { removeClinicStaff(label, session, name); });
      if (away) chip.classList.add('chip-away');
      chips.appendChild(chip);
    });
    var addSel = residentPicker('', function (v) {
      addClinicStaff(label, session, v);
    }, {
      session: (session === 'am' || session === 'pm') ? session : null,
      emptyLabel: '+ add…', hideNames: shown
    });
    addSel.className = 'clinic-add';
    chips.appendChild(addSel);
    if (notes.lines.length) {
      var sl = el('span', { class: 'clinic-status' });
      notes.lines.forEach(function (ln) {
        sl.appendChild(el('span', { class: 'clinic-status-line' + (ln.bad ? ' bad' : ''), text: ln.text }));
      });
      chips.appendChild(sl);
    }
    row.appendChild(chips);

    var sessName = session === 'day' ? '' : ' ' + session.toUpperCase();
    var countIn = el('input', {
      type: 'text', class: 'clinic-count', placeholder: 'count', autocomplete: 'off', enterkeyhint: 'next',
      'aria-label': label + sessName + ' count',
      value: (cc && cc.count) || ''
    });
    // Enter or ↓ goes to the next clinic's count, ↑ back — the counts are
    // typed one after another from the EMRs
    countIn.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      var all = Array.prototype.slice.call(document.querySelectorAll('.clinic-count'));
      var i = all.indexOf(countIn) + (ev.key === 'ArrowUp' ? -1 : 1);
      if (i < 0 || i >= all.length) return;
      ev.preventDefault();
      all[i].focus();
      all[i].select();
    });
    countIn.addEventListener('input', function () {
      clinicCountEntry(key).count = countIn.value;
      touch();
      updateDressBanner();
    });
    row.appendChild(countIn);

    // the attending — the sent line names them first: 'Glaucoma PM (Amarasekera, 20 x 2)'
    var extraIn = el('input', {
      type: 'text', class: 'clinic-extra', placeholder: 'attending', autocomplete: 'off',
      'aria-label': label + sessName + ' attending or note',
      value: (cc && cc.extra) || ''
    });
    extraIn.addEventListener('input', function () {
      clinicCountEntry(key).extra = extraIn.value;
      touch();
      updateDressBanner();
    });
    row.appendChild(extraIn);

    return row;
  }

  function renderClinicRows() {
    var host = $('clinicRows');
    clearNode(host);
    updateDressBanner();

    // Standing CPEC PO row (UISPEC5 §C) — always shown, staffed manually
    // (typically the operating PGY-4s); it reaches the output only once
    // staffed or counted. Stored under 'CPEC PO|day' end-to-end.
    host.appendChild(clinicRowEl('CPEC PO', 'day', {
      standing: true
    }));

    var clinics = App.roster.clinics || {};
    var labels = Object.keys(clinics).sort();
    var any = false;
    labels.forEach(function (label) {
      ['am', 'pm'].forEach(function (session) {
        var eff = effectiveClinicStaff(label, session);
        var key = label + '|' + session;
        var hasOverride = !!App.state.clinicStaffOverrides[key];
        var cc = App.state.clinicCounts[key];
        if (!eff.base.length && !hasOverride && !cc) return;
        any = true;
        host.appendChild(clinicRowEl(label, session));
      });
    });
    if (!any) host.appendChild(el('p', { class: 'empty-note', text: 'No block-schedule clinic sessions on this date.' }));
  }

  /* CPEC surgical block sheet lineup card (UISPEC3 §D). Engine.cpecForDate /
     SCHED_DATA.cpecSheet may be absent while section A lands — guard
     everything; the card simply shows nothing without them. */

  var CPEC_SITE_LABELS = { SP: 'Stadium', CH: 'Cherry Hill' };
  var CPEC_GROUPS = [
    { key: 'surg1', label: 'Surg 1' },
    { key: 'surg5', label: 'Surg 5' },
    { key: 'willsOR', label: 'Wills OR' },
    { key: 'retina', label: 'Retina resident' },
    { key: 'private', label: 'Private only' }
  ];

  function cpecInfo() {
    if (!window.Engine || typeof window.Engine.cpecForDate !== 'function') return null;
    try {
      return window.Engine.cpecForDate(App.state.date, data());
    } catch (e) {
      if (window.console) console.error('cpecForDate failed', e);
      return null;
    }
  }

  // Covering resident from TODAY'S roster for a sheet `cover` key. The
  // resolution itself lives in Engine.cpecCoverName (pure + Node-testable);
  // in particular the retina cover must NOT come from clinics['Retina'] alone:
  // on 3rd Wednesdays — the only day the sheet uses it — the pgy4 retina
  // resident is moved to 'Tabas Cataracts' by the block-4 override.
  function cpecCoverName(cover) {
    if (!window.Engine || typeof window.Engine.cpecCoverName !== 'function') return '';
    return window.Engine.cpecCoverName(App.roster || {}, cover) || '';
  }

  // 'Markovitz 1:00 (3) · Stadium' — shown verbatim-ish from the sheet.
  function cpecEntryText(e) {
    var t = e.attending || '?';
    if (e.time) t += ' ' + e.time;
    if (e.count != null) t += ' (' + e.count + ')';
    var site = CPEC_SITE_LABELS[e.site];
    if (site) t += ' · ' + site;
    if (e.note) t += ' · ' + e.note;
    return t;
  }

  function cpecAlreadyAdded(surgeon, start) {
    return (App.state.cases || []).some(function (c) {
      return trim(c.surgeon) === trim(surgeon) && trim(c.start) === trim(start);
    });
  }

  // Private sheet entries drop their sheet time on add (addCpecPrivate leaves
  // start empty), so 'added' means: a Privates-section case for this surgeon
  // already exists. Never match other sections — a blank-start Wills/JHN case
  // for the same surgeon must not disable '+ Add to Privates'.
  function cpecPrivateAdded(surgeon) {
    return (App.state.cases || []).some(function (c) {
      return c.section === 'private' && trim(c.surgeon) === trim(surgeon);
    });
  }

  // Whoever stands in for `name` while they are out during `spans` (Out
  // today) — the first session's coverer the busy time touches; '' if none.
  function standInDuring(name, spans) {
    var b = App.board;
    if (!b || !b.standIn || !window.Assign || !window.Assign.sessionsOfSpans) return '';
    var sess = window.Assign.sessionsOfSpans(spans);
    for (var i = 0; i < sess.length; i++) {
      var si = b.standIn(name, sess[i]);
      if (si) return si;
    }
    return '';
  }

  // Who takes a CPEC-sheet list today: the sheet's cover (Surg 1 / Surg 5 /
  // Wills OR / Retina), or whoever stands in for them while they are out.
  // -> { name, for, out } — out: the cover is out and nobody stands in.
  function cpecActing(e) {
    var cover = cpecCoverName(e.cover);
    if (!cover || !App.board || !window.Status) return { name: cover, for: '', out: false };
    var draft = { start: e.time || '', count: e.count || 1, serviceCount: e.count || 1, category: 'cataract' };
    var spans = window.Status.caseSpans(draft, data()).spans;
    if (App.board.statusDuringSpans(cover, spans).kind !== 'out') return { name: cover, for: '', out: false };
    var si = standInDuring(cover, spans);
    return si ? { name: si, for: cover, out: false } : { name: '', for: cover, out: true };
  }

  function addCpecCase(e, opts) {
    // Stadium (the ASC) and Cherry Hill lists go in their own section
    var section = ASC_SITES[e.site] ? 'other' : 'wills';
    var c = newCase(section);
    c.surgeon = e.attending || '';
    c.start = e.time || '';           // 'AM TF' goes in start as text
    if (e.count != null) c.count = e.count;
    // The sheet's lists are resident lists (its colours say who covers), so
    // all service until someone lowers it from NextGen / Cerner — which is
    // also how a pasted schedule reads them back. (It was 0, which made a
    // list whose cover is out a "private" list nobody was asked to fill.)
    c.serviceCount = c.count;
    c.category = 'cataract';
    var noteBits = [];
    var site = CPEC_SITE_LABELS[e.site];
    if (site) noteBits.push(site);
    if (e.note) noteBits.push(e.note);
    c.notes = noteBits.join('; ');
    // The sheet says who covers. If that resident is out today, whoever
    // covers them takes the list; out with nobody covering → left open so
    // the suggestion walks the chain instead.
    var act = cpecActing(e);
    var outNote = act.out ? act.for : '';
    c.assigned = act.name;
    App.state.cases.push(c);
    caseSectionOpen[section] = true;
    if (!opts || !opts.batch) {
      touch();
      computeBoard();
      renderSurgeryTab();
      toast(outNote ? 'Case added — ' + outNote + ' is out today, so it is left unassigned'
        : 'Case added from the CPEC sheet — everything stays editable', !outNote);
    }
    return outNote;
  }

  function addAllCpec(entries) {
    var n = 0;
    var outs = [];
    entries.forEach(function (e) {
      if (e.privateOnly || !e.cover) {
        if (!cpecPrivateAdded(e.attending || '')) { addCpecPrivate(e, { batch: true }); n++; }
        return;
      }
      if (cpecAlreadyAdded(e.attending || '', e.time || '')) return;
      var o = addCpecCase(e, { batch: true });
      if (o && outs.indexOf(o) === -1) outs.push(o);
      n++;
    });
    touch();
    computeBoard();
    renderSurgeryTab();
    toast(n ? 'Added ' + n + ' from the CPEC sheet' + (outs.length ? ' — ' + outs.join(', ') + ' out, left unassigned' : '')
      : 'Everything on the sheet is already added');
  }

  function addCpecPrivate(e, opts) {
    var c = newCase('private');
    c.surgeon = e.attending || '';
    if (e.count != null) c.count = e.count;
    c.serviceCount = 0;
    App.state.cases.push(c);
    caseSectionOpen.private = true;
    if (opts && opts.batch) return;
    touch();
    computeBoard();
    renderSurgeryTab();
    toast('Added to Privates from the CPEC sheet');
  }

  // The CPEC sheet as a prefill banner: what the sheet has for this date,
  // "Add all" in one click, per-attending picks behind "Choose…". Once
  // everything is on the list it shrinks to one quiet line.
  var cpecChooseOpen = false;
  function renderCpecCard() {
    var host = $('cpecCard');
    if (!host) return;
    clearNode(host);
    var info = cpecInfo();
    var entries = (info && info.entries) || [];
    if (!entries.length) return; // weekend / out-of-year / sheet not loaded

    var r = App.roster || {};
    var when = (r.nth && r.weekdayLabel) ? ordinal(r.nth) + ' ' + r.weekdayLabel : '';
    function isAdded(e) {
      return (e.privateOnly || !e.cover) ? cpecPrivateAdded(e.attending || '') : cpecAlreadyAdded(e.attending || '', e.time || '');
    }
    var pending = entries.filter(function (e) { return !isAdded(e); });

    if (!pending.length) {
      host.appendChild(el('div', { class: 'cpec-banner done' }, [
        el('span', { text: '✓ CPEC sheet' + (when ? ' (' + when + ')' : '') + ' — all ' + entries.length + ' on the list below' })
      ]));
      return;
    }

    var banner = el('div', { class: 'cpec-banner' });
    var summary = el('div', { class: 'cpec-banner-text' });
    summary.appendChild(el('b', { text: 'CPEC sheet' + (when ? ' · ' + when : '') }));
    var svc = pending.filter(function (e) { return !e.privateOnly && e.cover; });
    var prv = pending.length - svc.length;
    var parts = svc.map(function (e) {
      var act = cpecActing(e);
      var cov = act.name ? act.name + (act.for ? ' (for ' + act.for + ')' : '') : (act.out ? act.for + ' (out — left open)' : '');
      return (e.attending || '?') + (e.time ? ' ' + e.time : '') + (e.count != null ? ' ×' + e.count : '') + (cov ? ' → ' + cov : '');
    });
    if (prv) parts.push(prv + ' private');
    summary.appendChild(el('span', { class: 'cpec-banner-list', text: parts.join(' · ') }));
    banner.appendChild(summary);
    var actions = el('div', { class: 'cpec-banner-actions' }, [
      el('button', {
        type: 'button', class: 'btn btn-primary btn-small', text: 'Add all ' + pending.length,
        onclick: function () { addAllCpec(entries); }
      })
    ]);
    var choose = el('details', { class: 'cpec-choose', open: cpecChooseOpen });
    choose.addEventListener('toggle', function () { cpecChooseOpen = choose.open; });
    choose.appendChild(el('summary', { class: 'btn btn-small', text: 'Choose…' }));
    var pop = el('div', { class: 'cpec-choose-list' });
    CPEC_GROUPS.forEach(function (g) {
      var list = entries.filter(function (e) {
        if (g.key === 'private') return !!e.privateOnly || !e.cover;
        return !e.privateOnly && e.cover === g.key;
      });
      if (!list.length) return;
      var head = el('div', { class: 'cpec-group-title', text: g.label });
      if (g.key !== 'private') {
        var cov = cpecCoverName(g.key);
        if (cov) head.appendChild(el('span', { class: 'cpec-cover', text: '→ ' + cov + outCoverSuffix(cov) }));
      }
      pop.appendChild(head);
      list.forEach(function (e) {
        var isPrivate = g.key === 'private';
        var added = isAdded(e);
        pop.appendChild(el('div', { class: 'cpec-row' }, [
          el('span', { class: 'cpec-entry', text: cpecEntryText(e) }),
          el('button', {
            type: 'button', class: 'btn btn-small cpec-add', disabled: added,
            text: added ? 'added' : '+ Add',
            onclick: function () { if (isPrivate) addCpecPrivate(e); else addCpecCase(e); }
          })
        ]));
      });
    });
    pop.appendChild(el('p', {
      class: 'field-hint cpec-note',
      text: 'From the CPEC sheet effective 5/1/2026 (nth weekday of the month) — confirm against Cerner/NextGen. Counts are the sheet’s and stay editable.'
    }));
    choose.appendChild(pop);
    actions.appendChild(choose);
    banner.appendChild(actions);
    host.appendChild(banner);
  }

  function renderSurgeryTab() {
    computeSuggestions();
    renderSurgeryToolbar();
    renderCpecCard();
    renderCaseSections();
  }

  function renderClinicsTab() {
    renderClinicNeeds();
    renderClinicRows();
  }

  /* ------------------------------------------------------------------ */
  /* coverage needs — shared by the Clinics and Coverage tabs            */
  /* ------------------------------------------------------------------ */

  // Follow a gap's chain of cover to the case that is missing a backup:
  // Bair's case → backup Djulbegovic → Djulbegovic's globe (no backup).
  function chainEndCase(caseId, t) {
    var b = App.board;
    var guard = 0;
    while (b && caseId && guard++ < 8) {
      var info = b.caseInfo[caseId];
      if (!info || !info.backup || info.backup === 'NC' || !b.byName[info.backup]) return caseId;
      var st = b.statusAt(info.backup, t);
      if (st.kind !== 'case' || !st.caseId) return caseId;
      caseId = st.caseId;
    }
    return caseId;
  }

  // Surgery, scrolled to the case's line with its resident picker open
  function pickOnSurgery(c) {
    if (c) {
      resPicking[c.id] = 'res';
      if (c.section) caseSectionOpen[c.section] = true;
    }
    setTab('surgery');
    var line = c && lineOf(c.id);
    if (line && line.scrollIntoView) line.scrollIntoView({ block: 'center' });
  }

  function caseById(id) {
    var found = null;
    (App.state.cases || []).forEach(function (c) { if (c.id === id) found = c; });
    return found;
  }

  function needItem(n) {
    var S = window.Status;
    var b = App.board;
    var row = el('div', { class: 'need-row' });
    var actions = el('div', { class: 'need-actions' });
    if (n.type === 'case') {
      // a service case with nobody, or whose resident is out (Out today)
      var kc = caseById(n.caseId);
      var sg = suggMap[n.caseId];
      // its start; the end only when typed ("Done by") or checked off
      var when = !S ? '' : n.openEnded || !(n.end > n.start) ? '(' + S.fmtClock(n.start) + ')' : S.fmtClock(n.start) + '–' + S.fmtClock(n.end);
      row.classList.add('case-need');
      row.appendChild(el('div', { class: 'need-text' }, [
        el('b', { text: (kc ? caseListLabel(kc) : n.label) + ' ' + when }),
        n.why === 'out'
          ? ' — ' + n.holder + ' is out (' + n.outLabel + '): needs a new resident'
          : ' — no resident yet'
      ]));
      if (kc && sg && sg.name && sg.name !== trim(kc.assigned)) {
        actions.appendChild(el('button', {
          type: 'button', class: 'btn btn-small btn-fix',
          title: (sg.reasons || []).join(' · '),
          onclick: function () {
            setAssigned(kc, sg.name);
            touch();
            refreshEverything();
            toast(sg.name + ' takes ' + n.label + (n.why === 'out' ? ' in place of ' + n.holder : ''));
          }
        }, ['✓ ' + sg.name + ' takes it ', el('span', { class: 'btn-why', text: suggVia(sg) })]));
      } else if (kc && sg && !sg.name) {
        actions.appendChild(el('span', { class: 'field-hint', text: 'Nobody in the how-to chain is free then — Surg 2’s call; ' + outsideText(sg.outside, sg.pullable) }));
      }
      actions.appendChild(el('button', {
        type: 'button', class: 'btn btn-small need-sec', text: 'Pick on Surgery',
        onclick: function () { pickOnSurgery(kc); }
      }));
    } else if (n.type === 'absence') {
      if (n.erFirst) row.classList.add('er-first');
      row.appendChild(el('div', { class: 'need-text' }, [
        el('b', { text: n.name + ' out ' + n.session.toUpperCase() }),
        ' — ' + n.duty + ': ' + (n.blocked ? 'TBD (' + n.blocked + ')' : 'TBD') + (!n.auto || n.blocked ? '' : n.dayFloat
          ? ' (Night Float — Day Float ' + n.dayFloat + ' is out; add ' + n.name + ' on Out today to pick a cover)'
          : ' (Night Float — no Day Float to cover)'),
        n.erFirst ? el('span', { class: 'er-flag', text: ' ER is staffed first' }) : null
      ]));
      if (!n.auto || n.dayFloat) {
        actions.appendChild(el('button', {
          type: 'button', class: 'btn btn-small', text: 'Pick cover on Out today',
          onclick: function () { setTab('out'); }
        }));
      }
    } else if (n.type === 'clinic') {
      // a gap that lasts as long as an open-ended list: from its start only;
      // a whole session (or the whole day): no clock at all
      var gci = n.whyKind === 'case' && n.caseId && b && b.caseInfo[n.caseId];
      var estEnd = gci && gci.openEnded && Math.abs(n.end - gci.end) <= 5;
      var whole = b && (n.session === 'day' || (n.start === (n.session === 'am' ? b.dayStart : b.noon) && n.end === (n.session === 'am' ? b.noon : b.dayEnd)));
      var when = !S || whole ? '' : estEnd ? ' from ' + S.fmtClock(n.start) : ' ' + S.fmtClock(n.start) + '–' + S.fmtClock(n.end);
      var who = n.owner !== n.holder ? ' (covering for ' + n.owner + ')' : '';
      var sessWord = n.session === 'day' ? ' all day' : ' ' + n.session.toUpperCase();
      // 'Wibbelsman is Surg 2 for Cheng, so CPEC is one short'
      var doing = n.awayFor ? n.awayAs + ' for ' + n.awayFor : n.whyKind === 'clinic' && n.awayAs ? 'in ' + n.awayAs : n.why;
      row.appendChild(el('div', { class: 'need-text' }, [
        el('b', { text: n.clinic + sessWord + when }),
        n.whyKind === 'case'
          ? ' — ' + n.holder + who + ' is ' + n.why + ' and nobody is covering'
          : ' — ' + n.holder + who + ' is ' + doing + ', so ' + n.clinic + ' is one short'
      ]));
      if (n.whyKind === 'case' && n.caseId) {
        var target = caseById(chainEndCase(n.caseId, n.start + 1));
        var plan = null;
        if (target && window.Assign && window.Assign.backupPlan && b) {
          try { plan = window.Assign.backupPlan(target, App.roster, data(), App.state.cases, b); } catch (e) { plan = null; }
        }
        if (target && plan && plan.primary) {
          actions.appendChild(el('button', {
            type: 'button', class: 'btn btn-small btn-fix',
            onclick: function () {
              target.backup = plan.primary.name;
              target.backupNote = backupNoteFor(target, plan);
              touch();
              refreshEverything();
              toast(plan.primary.name + ' covers ' + plan.clinic + ' during ' + caseListLabel(target));
            }
          }, ['✓ ' + plan.primary.name + ' covers ', el('span', { class: 'btn-why', text: plan.primary.source })]));
        }
        if (target && plan && !plan.primary) actions.appendChild(el('span', { class: 'field-hint', text: 'Nobody on the coverage chain is free — Surg 2’s call; ' + outsideText(plan.outside, plan.pullable) }));
        if (target) {
          actions.appendChild(el('button', {
            type: 'button', class: 'btn btn-small need-sec', text: 'NC — leave uncovered',
            onclick: function () {
              target.backup = 'NC';
              touch();
              refreshEverything();
              toast(n.clinic + ' left uncovered during ' + caseListLabel(target) + ' (NC)');
            }
          }));
        }
      } else {
        // The clinic runs one short: acknowledged, keyed to its cause, so it
        // lapses when the cover changes. Not a staffing edit — taking them
        // off the list outlived the absence and left them "free" (review
        // 10/19/2026); the copied schedule already lists a coverer only
        // where they are.
        if (n.ackKey) {
          actions.appendChild(el('button', {
            type: 'button', class: 'btn btn-small',
            text: 'OK — ' + n.clinic + ' runs one short',
            onclick: function () {
              var keys = n.session === 'day' ? [n.ackKey, n.ackKeyPM] : [n.ackKey];
              keys.forEach(function (k) { if (k) App.state.shortOk[k] = true; });
              touch();
              refreshEverything();
              toast(n.clinic + sessWord + ' runs one short — noted');
            }
          }));
        } else {
          actions.appendChild(el('button', {
            type: 'button', class: 'btn btn-small',
            text: 'Take ' + n.holder + ' off ' + n.clinic + sessWord,
            onclick: function () {
              (n.session === 'day' ? ['am', 'pm'] : [n.session]).forEach(function (s) { removeClinicStaff(n.clinic, s, n.holder); });
              refreshEverything();
            }
          }));
        }
      }
    }
    row.appendChild(actions);
    return row;
  }

  // `types` (optional): only these kinds of need — the Clinics tab shows
  // absences and clinic gaps; Coverage shows everything still open.
  function mergeDayNeeds(needs) {
    var b = App.board;
    var out = [];
    var byKey = {};
    needs.forEach(function (n) {
      var whole = b && n.type === 'clinic' && n.whyKind !== 'case' &&
        n.start === (n.session === 'am' ? b.dayStart : b.noon) && n.end === (n.session === 'am' ? b.noon : b.dayEnd);
      var key = whole ? [n.holder, n.owner, n.clinic, n.why].join('|') : null;
      var prev = key && byKey[key];
      if (prev && prev.session !== n.session) {
        var day = {};
        for (var k in prev) day[k] = prev[k];
        day.ackKeyPM = n.ackKey;
        day.session = 'day';
        day.start = b.dayStart;
        day.end = b.dayEnd;
        out[out.indexOf(prev)] = day;
        byKey[key] = day;
        return;
      }
      if (key) byKey[key] = n;
      out.push(n);
    });
    return out;
  }

  function renderNeedsCard(host, title, note, types) {
    var b = App.board;
    var needs = mergeDayNeeds(((b && b.needs) || []).filter(function (n) { return !types || types.indexOf(n.type) !== -1; }));
    var warns = (b && b.warnings) || [];
    var noCases = !types && !(App.state.cases || []).some(function (c) { return !isDraftCase(c); });
    if (!needs.length && !warns.length && noCases) {
      host.appendChild(el('div', { class: 'card card-lite empty-card', text: 'No cases yet.' }));
      return;
    }
    if (!needs.length && !warns.length) {
      host.appendChild(el('div', { class: 'card ok-card ok-slim' }, [
        el('span', { class: 'ok-mark', text: '✓' }),
        types ? ' Clinics covered.'
          : ' Nothing open — every case, clinic and absence is covered.'
      ]));
      return;
    }
    var card = el('div', { class: 'card needs-card' + (needs.length ? '' : ' heads-up') });
    card.appendChild(el('h2', {}, needs.length
      ? [title + ' ', note ? el('span', { class: 'h-note', text: note }) : null]
      : ['Heads-up ', el('span', { class: 'h-note', text: 'Nothing uncovered — just worth knowing' })]));
    needs.forEach(function (n) { card.appendChild(needItem(n)); });
    warns.forEach(function (w) { card.appendChild(el('div', { class: 'warn-line', text: '⚠ ' + w })); });
    host.appendChild(card);
  }

  function renderClinicNeeds() {
    var host = $('clinicNeeds');
    if (!host) return;
    clearNode(host);
    if (!App.board || !App.board.order.length) return;
    renderNeedsCard(host, 'Needs coverage', '', ['absence', 'clinic']);
  }

  /* ------------------------------------------------------------------ */
  /* tab 1 — Out today (how-to Step 1: look up vacation coverage)        */
  /* ------------------------------------------------------------------ */

  function rosterRes(name) {
    var list = (App.roster && App.roster.residents) || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  function dutyOf(name, s) {
    var r = rosterRes(name);
    return r ? trim(r[s] && r[s].text) : '';
  }

  function strengthCount() { return ((App.roster && App.roster.residents) || []).length; }

  // Year-grouped select of residents, minus `hide`.
  function yearSelect(value, onChange, emptyLabel, hide) {
    var sel = el('select', { class: 'sel' });
    sel.appendChild(el('option', { value: '', text: emptyLabel || '—' }));
    YEAR_ORDER.forEach(function (yk) {
      var y = data().years[yk];
      if (!y) return;
      var og = el('optgroup', { label: y.short });
      y.residents.forEach(function (n) {
        if ((hide || []).indexOf(n) !== -1 && n !== value) return;
        var am = dutyOf(n, 'am');
        var pm = dutyOf(n, 'pm');
        var d = am && am === pm ? am : [am, pm].filter(Boolean).join(' / ');
        og.appendChild(el('option', { value: n, text: n + (d ? ' — ' + d : '') }));
      });
      sel.appendChild(og);
    });
    sel.value = value || '';
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }

  function segmented(options, value, onPick) {
    var wrap = el('span', { class: 'seg' });
    options.forEach(function (o) {
      wrap.appendChild(el('button', {
        type: 'button', class: 'seg-btn' + (o[0] === value ? ' on' : ''), text: o[1],
        'aria-pressed': o[0] === value ? 'true' : 'false',
        onclick: function () { onPick(o[0]); }
      }));
    });
    return wrap;
  }

  function outChanged() {
    touch();
    computeBoard();
    prefillAddOns(); // Surg 2 out / covered → the daytime add-on call follows
    renderOutTab();
    renderAvailStrip();
    renderBadges();
  }

  function addAbsence() {
    var st = App.state;
    st.absences.push({
      id: 'a' + Date.now().toString(36) + (absSeq++), name: '', am: true, pm: true,
      reason: 'vacation', coverAM: '', coverPM: ''
    });
    st.outConfirmed = false;
    touch();
    renderOutTab();
  }

  // Absence cards whose AM and PM covers are picked separately (UI only)
  var absSplit = {};

  // Who cannot take the cover for `a` in session s (each, or both for
  // 'day') -> { name: why }: listed, not pickable — Surg 2 for the ER
  // (10/18/2026: "surg 2 would never cover the ER" — the globe is theirs),
  // the Day Float (only ever the Night Float resident), and anyone already
  // covering someone else then (review 10/19/2026: the second cover was
  // dropped silently).
  function coverBlocks(a, sessions) {
    var st = App.state;
    var bd = App.board;
    var disable = {};
    sessions.forEach(function (s) {
      var duty = dutyOf(a.name, s);
      var s2 = duty === 'ER' && bd ? bd.actingSurg('2', s) : null;
      if (s2 && s2.name !== a.name) disable[s2.name] = 'Surg 2 — never the ER';
      // an earlier line keeps its cover, as on the board (the first wins)
      st.absences.slice(0, st.absences.indexOf(a)).forEach(function (x) {
        if (!x[s]) return;
        var w = trim(s === 'am' ? x.coverAM : x.coverPM);
        if (w && w !== 'NC' && !disable[w]) disable[w] = 'covering ' + x.name;
      });
    });
    if (bd && a.name !== bd.nightFloat) (bd.dayFloats || []).forEach(function (n) { if (n !== bd.nightFloat) disable[n] = 'Day Float — Night Float only'; });
    return disable;
  }

  function absenceCard(a, idx) {
    var st = App.state;
    var card = el('div', { class: 'abs-card' });
    var others = st.absences.filter(function (x) { return x !== a; }).map(function (x) { return x.name; });

    var top = el('div', { class: 'abs-top' });
    top.appendChild(yearSelect(a.name, function (v) { a.name = v; outChanged(); }, 'who is out…', others));
    var which = a.am && a.pm ? 'day' : (a.am ? 'am' : 'pm');
    top.appendChild(segmented([['day', 'All day'], ['am', 'AM'], ['pm', 'PM']], which, function (v) {
      a.am = v !== 'pm';
      a.pm = v !== 'am';
      if (!a.am) a.coverAM = '';
      if (!a.pm) a.coverPM = '';
      outChanged();
    }));
    var reason = el('select', { class: 'sel abs-reason', 'aria-label': 'Reason' });
    REASONS.forEach(function (r) { reason.appendChild(el('option', { value: r.key, text: r.label })); });
    reason.value = a.reason;
    reason.addEventListener('change', function () { a.reason = reason.value; outChanged(); });
    top.appendChild(reason);
    top.appendChild(el('button', {
      type: 'button', class: 'btn-icon danger', title: 'Remove', 'aria-label': 'Remove ' + (a.name || 'this absence'), text: '×',
      onclick: function () { st.absences.splice(idx, 1); outChanged(); }
    }));
    card.appendChild(top);

    if (!a.name) {
      card.appendChild(el('p', { class: 'field-hint', text: 'Pick the resident — their assignments and a coverage picker appear here.' }));
      return card;
    }

    // A Surg role out: whoever covers is that Surg for the session, in
    // every chain — said in one line, as Coverage and the copy say it
    var role = App.board && App.board.surgRole[a.name];
    if (role) {
      card.appendChild(el('div', { class: 'abs-role' }, [el('span', { class: 'abs-role-k', text: 'Surg ' + role + ' today' }), ' ' + roleWho(a.name, function (sess) { return App.board.actingSurg(role, sess); }).replace(/cover not picked/g, 'TBD')]));
    }

    var av = data().availability || {};
    var noCoverList = (av.noCoverTexts || ['PT', 'Day Float']).concat(av.pullFirstTexts || ['Retina', 'Retina Private', 'Uveitis']);
    // all day with one cover (the usual): one pick for both sessions
    var both = a.am && a.pm;
    var oneRow = both && !absSplit[a.id] && trim(a.coverAM) === trim(a.coverPM);
    var rows = oneRow ? [['am', 'pm']] : ['am', 'pm'].filter(function (s) { return a[s]; }).map(function (s) { return [s]; });
    rows.forEach(function (ss) {
      var duties = ss.map(function (s) { return dutyOf(a.name, s) || '—'; });
      var duty = duties[0] === duties[duties.length - 1] ? duties[0] : duties.join('/');
      var noCover = ss.every(function (s) { return noCoverList.indexOf(dutyOf(a.name, s)) !== -1; });
      var er = ss.some(function (s) { return dutyOf(a.name, s) === 'ER'; });
      var cur = trim(ss[0] === 'am' ? a.coverAM : a.coverPM);
      var line = el('div', { class: 'abs-sess' });
      if (!oneRow) line.appendChild(el('span', { class: 'badge ' + (ss[0] === 'am' ? 'badge-am' : 'badge-pm'), text: ss[0].toUpperCase() }));
      line.appendChild(el('span', { class: 'abs-duty' }, [el('b', { text: duty })]));
      line.appendChild(el('span', { class: 'abs-arrow', text: 'c/b' }));
      var disable = coverBlocks(a, ss);
      var pick = residentPicker(cur, function (v) {
        ss.forEach(function (s) { a[s === 'am' ? 'coverAM' : 'coverPM'] = v; });
        outChanged();
      }, {
        session: oneRow ? 'day' : ss[0], hideNames: [a.name].concat(others),
        emptyLabel: noCover ? 'no cover needed' : er ? 'TBD — ER first' : 'TBD',
        extra: [{ value: 'NC', text: 'NC' }],
        disable: disable, forAbsence: a.name
      });
      if (!cur && !noCover) pick.classList.add('tbd');
      line.appendChild(pick);
      if (oneRow) {
        line.appendChild(el('button', {
          type: 'button', class: 'btn-link abs-split', text: 'Split AM / PM',
          onclick: function () { absSplit[a.id] = true; renderOutTab(); }
        }));
      }
      if (cur && disable[cur]) {
        line.appendChild(el('span', { class: 'unassigned-text', text: cur + ': ' + disable[cur] + ' — pick someone else' }));
      }
      card.appendChild(line);
    });

    if (window.ExportFmt && window.ExportFmt.absenceLine) {
      card.appendChild(el('div', { class: 'abs-preview' }, [
        el('span', { class: 'mini-label', text: 'Copied schedule' }),
        el('span', { class: 'abs-preview-text', text: window.ExportFmt.absenceLine(a, App.roster) })
      ]));
    }
    return card;
  }

  function renderOutTab() {
    var host = $('outBody');
    if (!host) return;
    clearNode(host);
    var st = App.state;
    var r = App.roster || {};
    var n = strengthCount();

    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', { text: 'Who’s out' }));
    if (!(r.residents || []).length) {
      card.appendChild(el('p', { class: 'empty-note', text: 'No block schedule for this date — pick a weekday inside the academic year.' }));
      host.appendChild(card);
      return;
    }

    // what the covers picked here contradict (a cover out too, covering two)
    ((App.board && App.board.warnings) || []).forEach(function (w) {
      card.appendChild(el('div', { class: 'warn-line bad', text: '⚠ ' + w }));
    });
    var named = st.absences.filter(function (a) { return trim(a.name); });
    if (!st.absences.length) {
      if (st.outConfirmed) {
        card.appendChild(el('div', { class: 'ok-banner' }, [
          el('span', { text: '✓ No one out — ' + n + ' strong' }),
          el('button', {
            type: 'button', class: 'btn btn-small', text: 'Undo',
            onclick: function () { st.outConfirmed = false; outChanged(); }
          }),
          el('button', { type: 'button', class: 'btn btn-small', text: '+ Someone’s out', onclick: addAbsence })
        ]));
      } else {
        card.appendChild(el('div', { class: 'out-choice' }, [
          el('button', {
            type: 'button', class: 'btn btn-primary out-big', text: '✓ No one out — ' + n + ' strong',
            onclick: function () { st.outConfirmed = true; outChanged(); }
          }),
          el('button', { type: 'button', class: 'btn out-big', text: '+ Someone’s out', onclick: addAbsence })
        ]));
      }
    } else {
      st.absences.forEach(function (a, i) { card.appendChild(absenceCard(a, i)); });
      card.appendChild(el('div', { class: 'abs-foot' }, [
        el('button', { type: 'button', class: 'btn btn-small', text: '+ Add another', onclick: addAbsence }),
        el('span', { class: 'field-hint', text: (n - named.length) + ' strong' })
      ]));
    }

    // Night Float — automatic: one line in the list (post-call, and who
    // covers their daytime)
    var b = App.board;
    var nf = b && b.nightFloat;
    if (nf) {
      var nfAbs = b.absences.filter(function (x) { return x.name === nf && x.reason === 'nightfloat'; })[0];
      var duty = [dutyOf(nf, 'am'), dutyOf(nf, 'pm')];
      var dutyStr = duty[0] === duty[1] ? duty[0] : duty.filter(Boolean).join('/');
      var txt;
      var bad = false;
      var dfOut = nfAbs && nfAbs.dayFloat && (b.isOut(nfAbs.dayFloat, 'am') || b.isOut(nfAbs.dayFloat, 'pm'));
      if (nfAbs && nfAbs.nfByHand) {
        txt = 'covers on ' + nf + '’s line above' + (nfAbs.dayFloat ? ' (Day Float ' + nfAbs.dayFloat + ' where blank)' : '');
      } else if (dfOut) {
        txt = 'Day Float ' + nfAbs.dayFloat + ' is out' + (nfAbs.coverAM || nfAbs.coverPM ? ' part of the day' : '') + ' — add ' + nf + ' above to pick who covers ' + (dutyStr || 'their daytime');
        bad = true;
      } else if (nfAbs && nfAbs.coverAM) txt = 'Day Float ' + nfAbs.coverAM + ' covers ' + (dutyStr || 'their daytime');
      else if ((b.dayFloats || []).indexOf(nf) !== -1) txt = 'also the Day Float — nothing to cover';
      else { txt = 'no Day Float today — ' + (dutyStr || 'their daytime') + ' is uncovered'; bad = true; }
      card.appendChild(el('div', { class: 'abs-auto' + (bad ? ' bad' : '') }, [
        el('span', { class: 'abs-auto-k', text: 'Night Float' }), el('b', { text: nf }), ' post-call · ' + txt
      ]));
    }

    // a note for the Vacation section — a link until there is one
    var noteOpen = !!trim(st.vacation) || vacationNoteOpen;
    if (noteOpen) {
      var ta = el('textarea', { rows: '2', placeholder: 'Vacation note, e.g. Djulbegovic at AAO Fri', 'aria-label': 'Vacation note' });
      ta.value = st.vacation;
      ta.addEventListener('input', function () { st.vacation = ta.value; touch(); });
      card.appendChild(ta);
    } else {
      card.appendChild(el('button', { type: 'button', class: 'btn-link abs-note-link', text: '+ Vacation note', onclick: function () { vacationNoteOpen = true; renderOutTab(); } }));
    }
    host.appendChild(card);
    if (dayIsBlank()) host.appendChild(importCallout('Running a day someone else built?'));

    host.appendChild(stepFoot('roster'));
  }
  var vacationNoteOpen = false;

  /* ------------------------------------------------------------------ */
  /* tab 5 — Coverage: who is free, who backs up whom, what if a globe   */
  /* ------------------------------------------------------------------ */

  function coverageNow() {
    var S = window.Status;
    if (coverageFollowNow && isToday()) {
      var n = nowMinutes();
      if (S && n >= S.DAY_START && n < S.DAY_END) return n;
    }
    if (coverageTime != null) return coverageTime;
    return 13 * 60;
  }

  // 'Surg 2', 'PT', 'Wills OR', 'Retina Private' (under "Pull first",
  // which already says leaving it needs no cover)
  function availWhat(x) {
    return String(x.label || x.text || '').replace(/, no case$/, '');
  }

  // The open-ended list (no typed end) whose session end opens a free
  // window at `t` -> its label, or '' — the window says 'after Henry ×10',
  // never a guessed time (10/18/2026: "no need to estimate how long it will
  // take").
  function estCaseEndingAt(name, t) {
    var st = App.board.statusAt(name, t - 1);
    return st.kind === 'case' && st.openEnded && st.until != null && Math.abs(st.until - t) <= 5 ? st.label : '';
  }

  // 'after Henry ×10', 'until 10:15', 'except during Henry ×10 (from 10:15)',
  // 'from 10:45' (a typed end), '8:00–9:30'
  function availWhen(x, s) {
    var S = window.Status;
    var b = App.board;
    var from = x.from != null ? x.from : (s === 'am' ? b.dayStart : b.noon);
    var to = x.to != null ? x.to : (s === 'am' ? b.noon : b.dayEnd);
    var c = function (m) { return S.fmtClock(m).replace(/ [AP]M$/, ''); };
    var r = x.ranges;
    function opens(w) { var a = estCaseEndingAt(x.name, w.start); return a ? 'after ' + a : ''; }
    if (r.length === 1) {
      if (r[0].start === from) return 'until ' + c(r[0].end);
      var after = opens(r[0]);
      if (r[0].end === to) return after || 'from ' + c(r[0].start);
      return after ? after + ', until ' + c(r[0].end) : c(r[0].start) + '–' + c(r[0].end);
    }
    if (r.length === 2 && r[0].start === from && r[1].end === to) {
      var gap = (x.gaps || []).filter(function (g) { return g.start < r[1].start && r[0].end < g.end; })[0];
      if (estCaseEndingAt(x.name, r[1].start)) return 'except during ' + estCaseEndingAt(x.name, r[1].start) + ' (from ' + c(r[0].end) + ')';
      return 'except ' + c(r[0].end) + '–' + c(r[1].start) + (gap && gap.label ? ' (' + gap.label + ')' : '');
    }
    return r.map(function (w) { var a = opens(w); return a ? a + ', until ' + c(w.end) : c(w.start) + '–' + c(w.end); }).join('; ');
  }

  // One add-on case from a plan: named by its kind (the surgeon is rarely
  // known yet), assigned, and with the clinic cover as its backup.
  function addPlannedCase(kindKey, t, pickName, ho) {
    var S = window.Status;
    var def = (window.Assign.ADDON_KINDS || []).filter(function (k) { return k.key === kindKey; })[0] || {};
    var c = newCase('wills');
    c.category = def.category || 'trauma';
    c.addOn = true;
    c.count = 1;
    c.serviceCount = 1;
    // '-Globe/trauma x1 (1330 start) - …', never '-? x1'
    c.surgeon = def.key === 'globe' ? 'Globe/trauma' : (def.label || 'Add-on');
    c.notes = 'surgeon TBD';
    c.start = S.fmtHHMM(t);
    c.assigned = pickName;
    if (ho && ho.primary) {
      c.backup = ho.primary.name;
      c.backupNote = 'to cover ' + clinicWord(ho.clinic) + ' clinic' + (ho.owner !== pickName ? ' (for ' + ho.owner + ')' : '') + ' during case';
    }
    App.state.cases.push(c);
    caseSectionOpen.wills = true;
    return def;
  }

  // Free, but not on the how-to chain — listed for Surg 2, never picked;
  // then anyone in Retina / Uveitis (pull first, no cover needed).
  function outsideText(list, pullable) {
    return window.Assign.outsideWords(list, pullable);
  }

  // Who the plan passed over on the way to its pick, and why.
  function skipSummary(it) {
    var bits = (it.skipped || []).slice(0, 3).map(function (s) { return s.name + ' — ' + s.why; });
    if ((it.skipped || []).length > 3) bits.push('+' + (it.skipped.length - 3) + ' more');
    return (it.deferred ? 'Step ' + it.step + ': skipped for now → Step 10. ' : '') + (bits.length ? 'Passed over ' + bits.join('; ') : '');
  }

  function handoffLine(pickName, ho) {
    var S = window.Status;
    // 'Glaucoma (Shields) → Aguwa (Surg 1) from 1:00 PM until Shields is
    // back' — with the owner out all day, until whoever was covering is back
    var b = App.board;
    var sess = ho.window.start < (b ? b.noon : 720) ? 'am' : 'pm';
    var back = b && b.isOut(ho.owner, sess) ? pickName : ho.owner;
    return el('div', { class: 'handoff ' + (ho.primary ? '' : 'bad') }, [
      ho.clinic + ' (' + ho.owner + ') → ',
      ho.primary ? el('b', { text: ho.primary.name }) : el('b', { text: 'nobody on the coverage chain is free' }),
      ho.primary
        ? ' (' + ho.primary.source + ') from ' + S.fmtClock(ho.window.start) + ' until ' + back + ' is back'
        : ' — Surg 2’s call; ' + outsideText(ho.outside, ho.pullable)
    ]);
  }

  function planTimeOf(item, t) { return item.t != null ? item.t : t; }

  // Tonight's add-on call (the Add-on call card) — '' when not set
  function tonightCall() {
    var d = App.state && App.state.date;
    var row = (App.state.addOns || []).filter(function (x) { return x.date === d && (x.period || 'night') === 'night' && trim(x.name); })[0];
    return row ? trim(row.name) : '';
  }

  // One row per add-on: what it is, when it comes in, remove.
  function planRow(item, idx, t) {
    var S = window.Status;
    var row = el('div', { class: 'plan-row' });
    var sel = el('select', { class: 'sel plan-kind', 'aria-label': 'Kind of add-on' });
    (window.Assign.ADDON_KINDS || []).forEach(function (k) { sel.appendChild(el('option', { value: k.key, text: k.label })); });
    sel.value = item.kind;
    sel.addEventListener('change', function () { item.kind = sel.value; renderCoverageBody(); });
    var inp = el('input', {
      type: 'time', class: 'plan-when', step: '300', 'aria-label': 'Comes in at',
      value: S.fmtHHMM(planTimeOf(item, t)).replace(/^(\d\d)(\d\d)$/, '$1:$2')
    });
    inp.addEventListener('change', function () {
      var m = /^(\d{1,2}):(\d{2})/.exec(inp.value);
      if (m) { item.t = (+m[1]) * 60 + (+m[2]); renderCoverageBody(); }
    });
    row.appendChild(el('span', { class: 'plan-n', text: String(idx + 1) }));
    row.appendChild(sel);
    row.appendChild(el('label', { class: 'plan-at' }, ['at ', inp]));
    row.appendChild(el('button', {
      type: 'button', class: 'btn-icon danger', title: 'Remove this add-on', 'aria-label': 'Remove add-on ' + (idx + 1), text: '×',
      onclick: function () { planItems.splice(idx, 1); renderCoverageBody(); }
    }));
    return row;
  }


  // The role that always takes a globe (data.alwaysTakes — Surg 2), or ''
  function globeRole() {
    return window.Assign && window.Assign.alwaysRole ? window.Assign.alwaysRole({ category: 'trauma' }, data()) : '';
  }

  // What Surg n's holder already has today, without estimated times: a duty
  // that is not free time (a clinic they cover for someone out, the ER),
  // their lists, and the clinics they cover as a backup ->
  // ['ER for Marshall all day', 'operating — Tyson ×3 (1:00 PM)',
  //  'covering Glaucoma for Shields from 1:00 PM']
  function roleCommitments(n) {
    var b = App.board;
    var S = window.Status;
    var out = [];
    var names = [];
    var sessOf = {};
    ['am', 'pm'].forEach(function (sess) {
      var a = b.actingSurg(n, sess);
      if (!a) return;
      if (names.indexOf(a.name) === -1) names.push(a.name);
      (sessOf[a.name] = sessOf[a.name] || []).push(sess);
    });
    names.forEach(function (who) {
      var pre = names.length > 1 ? who + ': ' : '';
      var duty = {};
      var dutyOrder = [];
      sessOf[who].forEach(function (sess) {
        var st = b.base[who][sess];
        if (st.kind === 'free' || st.kind === 'out') return;
        if (!duty[st.label]) { duty[st.label] = []; dutyOrder.push(st.label); }
        duty[st.label].push(sess);
      });
      dutyOrder.forEach(function (lab) {
        out.push(pre + lab + (duty[lab].length === 2 ? ' all day' : ' ' + duty[lab][0].toUpperCase()));
      });
      var op = operatingToday(who);
      if (op.cases.length) {
        out.push(pre + 'operating — ' + op.cases.map(function (c) {
          var st = caseStartText(c);
          return caseListLabel(c) + (st ? ' (' + st + ')' : '');
        }).join(', '));
      }
      (App.state.cases || []).forEach(function (c) {
        if (trim(c.backup) !== who || caseDone(c) || assignedOutCase(c)) return;
        var plan = null;
        try { plan = window.Assign.backupPlan(c, App.roster, data(), App.state.cases, b); } catch (e) { plan = null; }
        if (plan) out.push(pre + 'covering ' + plan.clinic + ' for ' + plan.owner + (S && plan.window ? ' from ' + S.fmtClock(plan.window.start) : ''));
      });
    });
    return out;
  }

  // Surg 2 in one line (10/18/2026: "if there is no globe selected in the
  // coverage tab then surg 2 should be available for clinic to cover other
  // surgery service … they may be the one to take over the OR if needed"):
  // a globe already on Surgery, or Surg 2 free — and what they already have.
  function surg2Line() {
    var b = App.board;
    var r = App.roster || {};
    var s2 = (r.surg || {})['2'];
    if (!s2 || !s2.name || !b.byName[s2.name]) return null;
    var who = roleWho(s2.name, function (sess) { return b.actingSurg('2', sess); });
    var globes = (App.state.cases || []).filter(function (c) {
      return c.category === 'trauma' && c.serviceCount > 0 && !caseDone(c) && b.caseInfo[c.id];
    });
    if (globes.length) {
      return el('p', { class: 'surg2-lede' }, [el('b', { text: 'Globe today' }), ' — ' + globes.map(function (c) {
        var st = caseStartText(c);
        return caseListLabel(c) + (st ? ' (' + st + ')' : '') + ' → ' + (trim(c.assigned) || 'no resident yet');
      }).join(' · ')]);
    }
    if (!b.actingSurg('2', 'am') && !b.actingSurg('2', 'pm')) {
      return el('p', { class: 'warn-line bad' }, ['Surg 2 is out with nobody covering (' + who + ') — a globe goes down the trauma chain.']);
    }
    // 'No globe — Surg 2, Bair (for Cheng), is free.' or what they have:
    // 'No globe — Surg 2, Samuel: covering Glaucoma for Shields from 1:00 PM.'
    var busy = roleCommitments('2');
    return el('p', { class: 'surg2-lede' }, [
      el('b', { text: 'No globe' }), ' — Surg 2, ' + who + (busy.length ? ': ' + busy.join(' · ') + '.' : ', is free.')
    ]);
  }

  function planCard(t) {
    var S = window.Status;
    var b = App.board;
    var many = planItems.length > 1;
    var card = el('div', { class: 'card plan-card' });
    card.appendChild(el('h2', {}, ['If a globe or add-on comes in ', el('span', {
      class: 'h-note',
      text: 'Each at its own time, in the how-to’s order' + (globeRole() ? ' — a globe always goes to ' + globeRole() : '') + '.'
    })]));
    var hasGlobe = planItems.some(function (it) { return it.kind === 'globe'; });
    var s2line = hasGlobe ? null : surg2Line();
    if (s2line) card.appendChild(s2line);

    function addButtons() {
      var last = planItems[planItems.length - 1];
      var at = last ? planTimeOf(last, t) : null;
      return el('div', { class: 'plan-add' }, [
        hasGlobe ? null : el('button', {
          type: 'button', class: 'btn btn-small' + (planItems.length ? '' : ' btn-primary'), text: '+ A globe comes in',
          onclick: function () { planItems.push({ kind: 'globe', t: at }); renderCoverageBody(); }
        }),
        el('button', {
          type: 'button', class: 'btn btn-small', text: planItems.length ? '+ Add another add-on' : '+ Other add-on',
          onclick: function () { planItems.push({ kind: 'cornea', t: at }); renderCoverageBody(); }
        }),
        isToday() && planItems.length ? el('button', {
          type: 'button', class: 'btn btn-small', text: 'Set to now',
          title: 'Set every add-on to the current time',
          onclick: function () { planItems.forEach(function (it) { it.t = null; }); coverageFollowNow = true; coverageTime = null; renderCoverageBody(); }
        }) : null
      ]);
    }
    if (!planItems.length) {
      card.appendChild(addButtons());
      return card;
    }
    var rows = el('div', { class: 'plan-rows' });
    planItems.forEach(function (item, idx) { rows.appendChild(planRow(item, idx, t)); });
    card.appendChild(rows);
    card.appendChild(addButtons());

    var list = planItems.map(function (it) { return { kind: it.kind, t: planTimeOf(it, t) }; });
    var callAfter = S.parseClock(data().callAfter || '16:30');
    // 'Samuel is operating today — Tyson ×3 (3 cases): the globe follows
    // their cases' and the 4:30 note — no estimated times (10/18/2026: "no
    // need to estimate how long it will take … check in on them manually")
    function waitNotes(it, who) {
      var out = [];
      if (it.follows) {
        out.push(/^the /.test(it.follows) ? 'It follows ' + it.follows + '.' : who + ' is operating (' + operatingToday(who).lists.join(', ') + ') — the globe follows their cases; check in with them.');
      }
      if (it.overlap) out.push(who + ' also has ' + it.overlap + ' — check in with them.');
      if (it.always && callAfter != null && (it.follows || it.overlap || it.time >= callAfter)) {
        var call = tonightCall();
        out.push('Not rolled back by ' + S.fmtClock(callAfter) + ': it can go to the call person' + (call ? ' (' + call + ')' : '') + '.');
      }
      return out;
    }
    if (many) {
      var joint = window.Assign.planAddOns(list, t, App.roster, data(), b);
      if (joint.unfilledByOrder > joint.unfilled) {
        var moved = joint.items.filter(function (it) { return it.adjusted; });
        card.appendChild(el('div', { class: 'warn-line plan-changed' }, [
          el('b', { text: 'Changed from the how-to’s plain order: ' }),
          'by the order alone ' + joint.unfilledByOrder + ' add-on' + (joint.unfilledByOrder === 1 ? '' : 's') +
            ' would have nobody; this plan covers ' + (joint.unfilled ? 'more' : 'all') + '. ' +
            moved.slice().sort(function (x, y) { return x.time - y.time; }).map(function (it) {
              return it.label + ' at ' + S.fmtClock(it.time) + ': ' + (it.pick ? it.pick.name : 'nobody') + ' (the order alone: ' + (it.byOrder || 'nobody') + ')';
            }).join('; ') + '.'
        ]));
      }
      var box = el('div', { class: 'plan-joint' });
      joint.items.slice().sort(function (x, y) { return x.time - y.time; }).forEach(function (it) {
        var row = el('div', { class: 'plan-joint-row' + (it.pick ? '' : ' bad') });
        row.appendChild(el('span', { class: 'plan-joint-kind' }, [
          el('span', { class: 'plan-joint-time', text: S.fmtClock(it.time) }), ' ', it.label
        ]));
        var skips = skipSummary(it);
        var notes = it.pick ? waitNotes(it, it.pick.name) : [];
        if (it.pick && skips) row.title = skips;
        row.appendChild(el('span', { class: 'plan-joint-who' }, it.pick ? [
          '→ ', el('b', { text: it.pick.name }), el('span', { class: 'plan-via', text: ' ' + it.pick.via }),
          el('span', { class: 'plan-why', text: ' — ' + (it.follows ? 'operating — follows ' + it.follows : statusBrief(it.status)) }),
          notes.length ? el('span', { class: 'plan-why plan-skips', text: notes.join(' ') }) : null
        ] : [
          '⚠ nobody in the how-to chain is free — Surg 2’s call',
          el('span', { class: 'plan-why plan-skips', text: outsideText(it.outside, it.pullable) + (skips ? '. ' + skips : '') })
        ]));
        box.appendChild(row);
        if (it.pick && it.handoff) box.appendChild(handoffLine(it.pick.name, it.handoff));
      });
      card.appendChild(box);
      var filled = joint.items.filter(function (it) { return it.pick; });
      if (filled.length) {
        card.appendChild(el('div', { class: 'plan-actions' }, [
          el('button', {
            type: 'button', class: 'btn btn-primary',
            text: 'Add ' + (filled.length === 1 ? 'it' : 'all ' + filled.length) + ' as add-on cases',
            onclick: function () {
              filled.forEach(function (it) { addPlannedCase(it.kind, it.time, it.pick.name, it.handoff); });
              planItems = [];
              touch();
              refreshEverything();
              toast(filled.length + ' add-on case' + (filled.length === 1 ? '' : 's') + ' added — fill in the surgeons on Surgery');
            }
          }),
          el('span', { class: 'field-hint', text: 'Adds them to Surgery (Wills).' })
        ]));
      }
      return card;
    }

    var one = list[0];
    var plan = window.Assign.planAddOn(one.kind, one.t, App.roster, data(), b);
    if (plan.always && plan.pick) {
      // the role that always takes it (a globe → Surg 2): one line, no chain
      card.appendChild(el('div', { class: 'plan-one' }, [
        '→ ', el('b', { text: plan.pick.name }),
        el('span', { class: 'plan-via', text: ' ' + plan.pick.via }),
        el('span', { class: 'plan-why', text: ' — ' + (plan.follows ? 'operating — follows ' + plan.follows : statusBrief(plan.pickStatus)) })
      ]));
    } else {
      card.appendChild(el('div', {
        class: 'field-hint plan-chain',
        text: 'How-to Step ' + plan.step + ': ' + plan.hierLabel + (plan.step < 10 ? ' — nobody on it: the remaining-cases chain (Step 10)' : '') + '.'
      }));
      var ol = el('ol', { class: 'plan-steps' });
      var shownAlt = 0;
      var lastStep = null;
      plan.steps.some(function (st) {
        if (st.verdict === 'alt') { if (shownAlt >= 2) return true; shownAlt++; }
        if (lastStep !== null && st.step !== lastStep) {
          ol.appendChild(el('li', { class: 'plan-stage', text: 'Skipped for now → Step 10, remaining cases' }));
        }
        lastStep = st.step;
        ol.appendChild(el('li', { class: 'plan-step ' + st.verdict }, [
          el('span', { class: 'plan-verdict', text: st.verdict === 'take' ? '✓ takes it' : st.verdict === 'skip' ? 'skip' : 'next' }),
          el('b', { text: st.name }),
          el('span', { class: 'plan-via', text: ' ' + st.via }),
          el('span', { class: 'plan-why', text: ' — ' + (st.why || (st.always && plan.follows ? 'operating — follows ' + plan.follows : statusBrief(st.status))) })
        ]));
        return false;
      });
      card.appendChild(ol);
    }

    if (!plan.pick) {
      card.appendChild(el('div', { class: 'warn-line bad', text: '⚠ Nobody in the how-to chain is free — Surg 2’s call: ' + outsideText(plan.outside, plan.pullable) + '.' }));
      return card;
    }
    waitNotes(plan, plan.pick.name).forEach(function (n) {
      card.appendChild(el('div', { class: 'warn-line plan-wait', text: n }));
    });
    var ho = plan.handoff;
    if (ho) card.appendChild(handoffLine(plan.pick.name, ho));
    card.appendChild(el('div', { class: 'plan-actions' }, [
      el('button', {
        type: 'button', class: 'btn btn-primary',
        text: (one.kind === 'globe' ? 'Add the globe → ' : 'Add the add-on → ') + plan.pick.name + (ho && ho.primary ? ' (backup ' + ho.primary.name + ')' : ''),
        onclick: function () {
          var def = addPlannedCase(one.kind, one.t, plan.pick.name, ho);
          planItems = [];
          touch();
          refreshEverything();
          toast(def.label + ' added at ' + S.fmtClock(one.t) + ' → ' + plan.pick.name + ' — fill in the surgeon on Surgery');
        }
      }),
      el('span', { class: 'field-hint', text: 'Adds to Surgery (Wills).' })
    ]));
    return card;
  }

  function caseLabelOf(c) { return (trim(c.surgeon) || c.category || 'case') + ' ×' + (parseInt(c.count, 10) || 1); }

  // Who holds each chain role today, as every plan on this tab uses it: the
  // block schedule's Surg 1–5 and Cooper senior — or whoever covers them
  // while they are out (Out today). 'Wibbelsman (for Cheng)',
  // 'AM Wibbelsman (for Cheng) · PM Cheng', 'Cheng out — NC'.
  function roleWho(name, acting) {
    var b = App.board;
    function one(sess) {
      var a = acting(sess);
      if (a) return a.name + (a.for ? ' (for ' + a.for + ')' : '');
      var oc = outCovers(name).filter(function (x) { return x.s === sess; })[0];
      return name + ' out — ' + (oc && oc.who === 'NC' ? 'NC' : oc && oc.blocked ? 'TBD (' + oc.blocked + ')' : 'TBD');
    }
    if (!b) return name;
    var am = one('am');
    var pm = one('pm');
    return am === pm ? am : 'AM ' + am + ' · PM ' + pm;
  }

  // The roles row at the top of the day board
  function rolesRow() {
    var b = App.board;
    var r = App.roster || {};
    var wrap = el('div', { class: 'roles-card' });
    wrap.appendChild(el('span', { class: 'roles-key', text: 'Today’s roles' }));
    var list = el('span', { class: 'roles-list' });
    Object.keys(r.surg || {}).sort(function (x, y) { return (+x) - (+y); }).forEach(function (n) {
      var s = r.surg[n];
      if (!s || !s.name || n === '6') return; // Surg 6 is in no chain
      var who = roleWho(s.name, function (sess) { return b.actingSurg(n, sess); });
      var changed = b.isOut(s.name, 'am') || b.isOut(s.name, 'pm');
      list.appendChild(el('span', { class: 'role-chip' + (changed ? ' changed' : '') }, [
        el('span', { class: 'role-k', text: 'Surg ' + n }), el('b', { text: who })
      ]));
    });
    var cs = r.cooperSenior;
    if (cs && b.byName[cs]) {
      var cw = roleWho(cs, function (sess) {
        if (!b.isOut(cs, sess)) return { name: cs, for: '' };
        var si = b.standIn(cs, sess);
        return si ? { name: si, for: cs } : null;
      });
      list.appendChild(el('span', { class: 'role-chip' + (b.isOut(cs, 'am') || b.isOut(cs, 'pm') ? ' changed' : '') }, [
        el('span', { class: 'role-k', text: 'Cooper' }), el('b', { text: cw })
      ]));
    }
    wrap.appendChild(list);
    wrap.appendChild(el('button', { type: 'button', class: 'btn-link roles-rules', text: 'The rules ↓', onclick: showCoverageRules }));
    return wrap;
  }

  function renderCoverageTab() {
    renderCoverageBody();
    renderAddOnsCard();
    renderCoverageRules();
  }

  function renderCoverageBody() {
    var host = $('coverageBody');
    if (!host) return;
    clearNode(host);
    var b = App.board;
    if (!b || !b.order.length || !window.Status || !window.Assign) {
      host.appendChild(el('div', { class: 'card' }, [el('p', { class: 'empty-note', text: 'No block schedule for this date — nothing to cover.' })]));
      return;
    }
    var t = coverageNow();
    if (!(App.state.cases || []).length) host.appendChild(importCallout('No cases for this day in this browser. If someone else built it —'));
    // what is open, then Surg 2 and a globe, then the day
    var needsHost = el('div');
    renderNeedsCard(needsHost, 'Needs coverage', '');
    host.appendChild(needsHost);
    host.appendChild(planCard(t));
    host.appendChild(dayBoard());
  }

  /* ---- the day at a glance ------------------------------------------- */
  // 10/18/2026: "just have it listed who is operating that day so there can
  // be a birds eye view"; "we need to be aware of the people on any day that
  // they go from OR in the morning and are in clinic in PM". AM | PM: who is
  // operating (their lists, to check off as they finish), who is free, whom
  // to pull first, who is out — and, across both, who goes from a morning
  // OR to an afternoon clinic. No times are guessed: a list counts for its
  // session until it is checked off (Status.caseSpans).

  // Year words as the program uses them: PGY-2 = first year (PGY-1s are
  // interns and on none of this), PGY-3 = second year, PGY-4 = third year
  var YEAR_WORD = { pgy4: 'third year', pgy3: 'second year', pgy2: 'first year' };
  var OP_YEAR_RANK = { pgy4: 0, pgy3: 1, pgy2: 2 };
  function yearRank(name) {
    var y = App.board && App.board.byName[name] && App.board.byName[name].year;
    return OP_YEAR_RANK[y] == null ? 9 : OP_YEAR_RANK[y];
  }

  // 'Surg 2 for Cheng' · 'Surg 1' · 'first year'
  function whoTag(name, sessions) {
    var b = App.board;
    var roles = [];
    (sessions || ['am', 'pm']).forEach(function (sess) {
      b.surgRolesAt(name, sess).forEach(function (r) {
        var t = 'Surg ' + r.n + (r.for ? ' for ' + r.for : '');
        if (roles.indexOf(t) === -1) roles.push(t);
      });
    });
    return roles.length ? roles.join(' · ') : (YEAR_WORD[(b.byName[name] || {}).year] || '');
  }

  // 'Tyson ×3' · 'Pericic ×14 (4 service)' — a list as the resident does it
  function caseListLabel(c) {
    var n = parseInt(c.count, 10) || 1;
    var svc = c.serviceCount > 0 ? c.serviceCount : n;
    return (trim(c.surgeon) || c.category || 'case') + ' ×' + n + (svc < n ? ' (' + svc + ' service)' : '');
  }
  function caseCountOf(c) { return c.serviceCount > 0 ? c.serviceCount : (parseInt(c.count, 10) || 1); }

  // The typed start ('1:00 PM'); '' when none
  function caseStartText(c) {
    var info = App.board && App.board.caseInfo[c.id];
    return info && !info.unknownStart && info.spans.length ? window.Status.fmtClock(info.spans[0].start) : '';
  }

  // What `name` is operating on today, not checked off -> { lists, count, cases }
  function operatingToday(name) {
    var cases = (App.state.cases || []).filter(function (c) {
      return trim(c.assigned) === name && !caseDone(c) && !assignedOutCase(c) && App.board && App.board.caseInfo[c.id];
    }).sort(function (x, y) { return App.board.caseInfo[x.id].start - App.board.caseInfo[y.id].start; });
    var count = 0;
    cases.forEach(function (c) { count += caseCountOf(c); });
    return { lists: cases.map(caseListLabel), count: count, cases: cases };
  }

  // Each resident's lists in session s -> [{ name, cases }], third years
  // first. A list belongs to every session its time touches (an all-day list
  // to both); a list whose resident is out is under Needs coverage instead.
  function operatingIn(s) {
    var b = App.board;
    var lo = s === 'am' ? b.dayStart : b.noon;
    var hi = s === 'am' ? b.noon : b.dayEnd;
    var by = {};
    var names = [];
    (App.state.cases || []).forEach(function (c) {
      var a = trim(c.assigned);
      var info = b.caseInfo[c.id];
      if (!a || a === 'NC' || !b.byName[a] || !info || assignedOutCase(c)) return;
      var touches = info.spans.some(function (sp) { return sp.start < hi && sp.end > lo; }) ||
        (info.start >= lo && info.start < hi) || // checked off before it began
        (s === 'pm' && info.start >= hi); // typed after the board's day
      if (!touches) return;
      if (!by[a]) { by[a] = []; names.push(a); }
      by[a].push(c);
    });
    names.forEach(function (n) { by[n].sort(function (x, y) { return b.caseInfo[x.id].start - b.caseInfo[y.id].start; }); });
    names.sort(function (x, y) {
      return yearRank(x) - yearRank(y) || b.caseInfo[by[x][0].id].start - b.caseInfo[by[y][0].id].start;
    });
    return names.map(function (n) { return { name: n, cases: by[n] }; });
  }

  // The clinic(s) a list pulls its resident out of in session s, and who
  // covers each meanwhile, as the board has it (chains included: Surg 2
  // covers, then takes a globe, and Surg 4 covers) ->
  // [{ clinic, owner, names: ['Bair'] | ['Bair', ''] }] ('' = nobody)
  function listCovers(c, s) {
    var b = App.board;
    var info = b && b.caseInfo[c.id];
    var a = trim(c.assigned);
    if (c.done || !info || !a || !b.byName[a] || assignedOutCase(c)) return [];
    var lo = s === 'am' ? b.dayStart : b.noon;
    var hi = s === 'am' ? b.noon : b.dayEnd;
    var parts = [];
    info.spans.forEach(function (sp) {
      for (var t = Math.max(sp.start, lo); t < Math.min(sp.end, hi); t += 5) {
        var st = b.statusAt(a, t + 1, { exclude: c.id });
        if (st.kind !== 'clinic' || st.pullFirst) continue; // Retina / Uveitis: no cover needed
        var owner = st.covering || a;
        var who = '';
        for (var i = 0; i < b.order.length && !who; i++) {
          var m = b.order[i];
          if (m === a || m === owner) continue;
          var ms = b.statusAt(m, t + 1);
          if (ms.kind === 'clinic' && ms.clinic === st.clinic && ms.covering === owner) who = m;
        }
        var last = parts[parts.length - 1];
        if (!last || last.clinic !== st.clinic || last.owner !== owner) parts.push(last = { clinic: st.clinic, owner: owner, names: [] });
        if (!last.names.length || last.names[last.names.length - 1] !== who) last.names.push(who);
      }
    });
    return parts;
  }

  // listCovers in words -> [{ text, bad }]: 'Glaucoma → Bair' ·
  // 'Glaucoma → Bair, then nobody' · 'Glaucoma: NC' · 'Glaucoma: nobody covering'
  function coverWords(c, s) {
    var a = trim(c.assigned);
    return listCovers(c, s).map(function (p) {
      var what = p.clinic + (p.owner !== a ? ' (for ' + p.owner + ')' : '');
      var none = p.names.every(function (n) { return !n; });
      if (none && trim(c.backup) === 'NC') return { text: what + ': NC', bad: false };
      if (none) return { text: what + ': nobody covering', bad: true };
      return { text: what + ' → ' + p.names.map(function (n) { return n || 'nobody'; }).join(', then '), bad: p.names.indexOf('') !== -1 };
    });
  }

  function coverNodes(words) {
    return words.map(function (w) { return el('span', { class: 'db-cover' + (w.bad ? ' bad-text' : ''), text: ' · ' + w.text }); });
  }

  // One list with its check-off box — the whole line is the box's label, so
  // a tap on the text checks it off. Checking it off ends it then — now,
  // today; the end of its session on another day — and the time can be
  // corrected; the resident is free from that minute (chief, 9/29/2026:
  // "check off when the cases are done and who clears up"). A list that
  // pulls its resident out of a clinic says who covers it: '· Glaucoma → Bair'.
  function checkoffItem(c, who, s) {
    var S = window.Status;
    var b = App.board;
    var info = b.caseInfo[c.id];
    var item = el('div', { class: 'db-list' + (c.done ? ' done' : '') });
    var box = el('input', { type: 'checkbox', 'aria-label': 'Done: ' + caseListLabel(c) + ' (' + who + ')' });
    box.checked = !!c.done;
    box.addEventListener('change', function () {
      if (box.checked) {
        var at = info.end;
        if (isToday()) at = Math.min(Math.max(nowMinutes(), b.dayStart), b.dayEnd);
        at = Math.round(at / 5) * 5;
        c.done = true;
        c.doneAt = S.fmtHHMM(at);
        toast(who + ' is free from ' + S.fmtClock(at));
      } else {
        c.done = false;
        c.doneAt = '';
      }
      touch();
      refreshEverything();
    });
    var start = caseStartText(c);
    var since = s === 'pm' && info.start < b.noon;
    item.appendChild(el('label', { class: 'done-check' }, [
      box,
      el('span', { class: 'db-list-text' }, [
        caseListLabel(c),
        el('span', { class: 'plan-via', text: (since ? ' · since the morning' : start ? ' · ' + start : '') + (c.addOn ? ' · add-on' : '') })
      ])
    ]));
    coverNodes(coverWords(c, s)).forEach(function (n) { item.appendChild(n); });
    if (c.done) {
      var tin = el('input', {
        type: 'time', class: 'done-time', step: '300', 'aria-label': 'Done at',
        value: String(c.doneAt || '').replace(/^(\d\d)(\d\d)$/, '$1:$2')
      });
      tin.addEventListener('change', function () {
        var m = /^(\d{1,2}):(\d{2})/.exec(tin.value);
        if (!m) return;
        c.doneAt = ('0' + m[1]).slice(-2) + m[2];
        touch();
        refreshEverything();
      });
      item.appendChild(el('span', { class: 'done-when' }, ['done ', tin]));
    }
    return item;
  }

  // Who goes from a morning OR — their OR block, or a list of theirs that
  // morning — to an afternoon clinic (Retina / Uveitis aside: no cover
  // needed) -> [{ name, from, clinic, covering, pmLists, allDay, done }].
  // pmLists: afternoon lists that keep them out of that clinic (who covers
  // it rides with them); allDay: a morning list that runs on into the
  // afternoon; done ('11:40 AM'): every morning list is checked off.
  function orToClinic() {
    var b = App.board;
    var S = window.Status;
    var rows = [];
    b.order.forEach(function (n) {
      var am = b.base[n].am;
      var pm = b.base[n].pm;
      if (am.kind === 'out' || pm.kind === 'out' || pm.kind !== 'clinic' || pm.pullFirst) return;
      var mine = (App.state.cases || []).filter(function (c) {
        return trim(c.assigned) === n && b.caseInfo[c.id] && !assignedOutCase(c);
      }).sort(function (x, y) { return b.caseInfo[x.id].start - b.caseInfo[y.id].start; });
      var amLists = mine.filter(function (c) { return b.caseInfo[c.id].start < b.noon; });
      if (am.cls !== 'or' && !amLists.length) return;
      function intoPm(c) { return !c.done && b.caseInfo[c.id].spans.some(function (sp) { return sp.end > b.noon; }); }
      var doneAt = null;
      if (amLists.length && amLists.every(function (c) { return c.done; })) {
        amLists.forEach(function (c) { var e = b.caseInfo[c.id].end; if (doneAt == null || e > doneAt) doneAt = e; });
      }
      rows.push({
        name: n, from: amLists.length ? amLists.map(caseListLabel).join(', ') : am.text,
        clinic: pm.text, covering: pm.covering && pm.covering !== n ? pm.covering : '',
        pmLists: mine.filter(function (c) { return b.caseInfo[c.id].start >= b.noon && intoPm(c); }),
        allDay: amLists.filter(intoPm),
        done: doneAt != null && S ? S.fmtClock(doneAt) : ''
      });
    });
    return rows.sort(function (x, y) { return (x.done ? 1 : 0) - (y.done ? 1 : 0) || yearRank(x.name) - yearRank(y.name); });
  }

  function dayChip(name, sub, extra) {
    return el('span', { class: 'free-chip ' + yearOf(name) + (extra || '') }, [
      el('b', { text: name }),
      sub ? el('span', { class: 'free-sub', text: sub }) : null
    ]);
  }

  // why someone is out, as the board's Out line says it
  var OUT_WORD = { vacation: 'vacation', sick: 'sick', conference: 'conference', nightfloat: 'post-call', other: 'out' };

  // Everyone out today, once: 'Cheng (vacation) → Bair' · 'Cotton (post-call)
  // → Camacho' · 'Hamou (sick) PM → NC' · 'Calotti (vacation) — no cover needed'
  function outLine() {
    var b = App.board;
    var noCover = b.noCoverTexts || [];
    var outs = b.order.filter(function (n) { return b.isOut(n, 'am') || b.isOut(n, 'pm'); });
    if (!outs.length) return null;
    var line = el('div', { class: 'db-line db-outline' }, [el('span', { class: 'db-k', text: 'Out' })]);
    outs.forEach(function (n, i) {
      var oc = outCovers(n);
      var abs = b.base[n][oc[0].s].absence || {};
      function whoNode(x) {
        if (!x.who && noCover.indexOf(b.base[n][x.s].text) !== -1) return el('span', { class: 'plan-via', text: 'no cover needed' });
        if (x.who === 'NC') return el('span', { class: 'plan-via', text: 'NC' });
        if (x.blocked) return el('span', { class: 'bad-text', text: 'TBD (' + x.blocked + ')' });
        return x.who ? el('b', { text: x.who }) : el('span', { class: 'bad-text', text: 'TBD' });
      }
      var half = oc.length === 1 ? ' ' + oc[0].s.toUpperCase() : '';
      var covers = oc.length === 2 && (oc[0].who !== oc[1].who || oc[0].blocked !== oc[1].blocked)
        ? ['AM ', whoNode(oc[0]), ' · PM ', whoNode(oc[1])]
        : [whoNode(oc[0])];
      line.appendChild(el('span', { class: 'db-out' }, [
        el('b', { class: 'res-name ' + yearOf(n), text: n }),
        el('span', { class: 'plan-via', text: ' (' + (OUT_WORD[abs.reason] || 'out') + ')' + half + ' → ' })
      ].concat(covers, i < outs.length - 1 ? [el('span', { class: 'db-sep', text: ' · ' })] : [])));
    });
    return line;
  }

  // Today, during the day: who is free this minute -> the line, or null
  function freeNowLine(now) {
    var b = App.board;
    var S = window.Status;
    var names = b.freeAt(now).filter(function (n) { return !b.statusAt(n, now).neverPull; })
      .sort(function (x, y) { return yearRank(x) - yearRank(y); });
    return el('div', { class: 'db-line db-now' }, [el('span', { class: 'db-k', text: 'Free now · ' + S.fmtClock(now) })].concat(
      names.length ? names.map(function (n, i) {
        return el('span', { class: 'db-now-name', title: b.statusAt(n, now).label || '' }, [
          el('b', { class: 'res-name ' + yearOf(n), text: n }), i < names.length - 1 ? ', ' : null
        ]);
      }) : [el('span', { class: 'empty-note', text: 'nobody' })]));
  }

  // A free entry with only the windows worth showing: not one that just runs
  // until the resident's own list starts (the list already says when), and
  // today not one that is over. -> the entry (copied) or null
  function freeWorthShowing(x, s, now) {
    var b = App.board;
    var kept = x.ranges.filter(function (r) {
      if (r.end < x.to && b.statusAt(x.name, r.end + 1).kind === 'case') return false;
      return now == null || r.end > now;
    });
    if (!kept.length) return null;
    var y = {};
    for (var k in x) y[k] = x[k];
    y.ranges = kept;
    y.full = kept.length === 1 && kept[0].start === x.from && kept[0].end === x.to;
    return y;
  }

  function dayBoard() {
    var b = App.board;
    var S = window.Status;
    var card = el('div', { class: 'card day-board' });
    card.appendChild(el('h2', {}, ['The day ', el('span', {
      class: 'h-note', text: 'Check off each list when it finishes — they are free from then.'
    })]));
    card.appendChild(rolesRow());
    var out = outLine();
    if (out) card.appendChild(out);
    var now = isToday() ? nowMinutes() : null;
    var live = now != null && now >= b.dayStart && now < b.dayEnd;
    if (live) card.appendChild(freeNowLine(now));
    var amOver = live && now >= b.noon;

    var moves = orToClinic();
    if (moves.length) {
      var band = el('div', { class: 'db-band' });
      band.appendChild(el('div', { class: 'db-h', text: 'Morning OR → afternoon clinic' + (S ? ' (' + S.fmtClock(b.pmClinicStart) + ')' : '') }));
      var ul = el('ul', { class: 'db-moves' });
      moves.forEach(function (m) {
        var li = el('li', { class: m.done ? 'done' : '' }, [
          el('b', { class: 'res-name ' + yearOf(m.name), text: m.name }),
          el('span', { class: 'db-tag', text: whoTag(m.name) }),
          ' ' + m.from,
          m.done ? el('span', { class: 'db-done', text: ' ✓ ' + m.done }) : null
        ]);
        if (m.pmLists.length || m.allDay.length) {
          // an afternoon list keeps them out of the clinic: who covers it
          var lists = m.pmLists.length ? m.pmLists : m.allDay;
          li.appendChild(document.createTextNode(m.pmLists.length ? ' → ' + m.pmLists.map(caseListLabel).join(', ') : ', all day'));
          var words = [];
          lists.forEach(function (c) { words = words.concat(coverWords(c, 'pm')); });
          coverNodes(words).forEach(function (n) { li.appendChild(n); });
        } else {
          li.appendChild(document.createTextNode(' → '));
          li.appendChild(el('b', { text: m.clinic }));
          if (m.covering) li.appendChild(el('span', { class: 'plan-via', text: ' (covering ' + m.covering + ')' }));
        }
        ul.appendChild(li);
      });
      band.appendChild(ul);
      card.appendChild(band);
    }

    // after noon today the afternoon comes first on a phone, and the morning
    // keeps only its lists (to check off)
    var cols = el('div', { class: 'db-cols' + (amOver ? ' pm-first' : '') });
    [['am', 'AM'], ['pm', 'PM']].forEach(function (p) {
      var s = p[0];
      var past = s === 'am' && amOver;
      var nowCol = live && ((s === 'am') === (now < b.noon));
      var col = el('div', { class: 'db-col db-col-' + s + (past ? ' past' : '') + (nowCol ? ' now' : '') });
      col.appendChild(el('h3', { class: 'avail-h' }, [p[1], past ? el('span', { class: 'h-note', text: ' over' }) : null]));

      // operating
      var ops = operatingIn(s);
      var opBox = el('div', { class: 'db-sec' }, [el('div', { class: 'db-h', text: 'Operating' })]);
      if (!ops.length) opBox.appendChild(el('p', { class: 'empty-note', text: 'Nobody has a list' }));
      ops.forEach(function (o) {
        var left = o.cases.filter(function (c) { return !c.done; });
        var count = 0;
        left.forEach(function (c) { count += caseCountOf(c); });
        var row = el('div', { class: 'db-op' + (left.length ? '' : ' done') });
        // a count only when it adds something: more than one list
        var countText = !left.length ? 'done' : o.cases.length > 1 ? count + ' case' + (count === 1 ? '' : 's') + (left.length < o.cases.length ? ' left' : '') : '';
        row.appendChild(el('div', { class: 'db-who' }, [
          el('b', { class: 'res-name ' + yearOf(o.name), text: o.name }),
          el('span', { class: 'db-tag', text: whoTag(o.name, [s]) }),
          countText ? el('span', { class: 'db-count', text: countText }) : null
        ]));
        var lists = el('div', { class: 'db-lists' });
        o.cases.forEach(function (c) { lists.appendChild(checkoffItem(c, o.name, s)); });
        row.appendChild(lists);
        opBox.appendChild(row);
      });
      col.appendChild(opBox);
      if (past) {
        cols.appendChild(col);
        return;
      }

      // free, then pull first (Retina / Uveitis — leaving needs no cover)
      var nowHere = live && (s === 'am' ? now < b.noon : true) ? now : null;
      var av = b.availableInSession(s);
      var free = av.filter(function (x) { return x.group === 'free'; }).map(function (x) { return freeWorthShowing(x, s, nowHere); })
        .filter(Boolean).sort(function (x, y) { return yearRank(x.name) - yearRank(y.name) || (x.full ? 0 : 1) - (y.full ? 0 : 1); });
      var pull = av.filter(function (x) { return x.group === 'pull'; }).sort(function (x, y) { return yearRank(x.name) - yearRank(y.name); });
      var freeBox = el('div', { class: 'db-sec' }, [el('div', { class: 'db-h', text: 'Free' })]);
      var fr = el('div', { class: 'free-row' });
      if (!free.length) fr.appendChild(el('span', { class: 'empty-note', text: 'nobody' }));
      free.forEach(function (x) { fr.appendChild(dayChip(x.name, availWhat(x) + (x.full ? '' : ' · ' + availWhen(x, s)), x.full ? '' : ' partial')); });
      freeBox.appendChild(fr);
      col.appendChild(freeBox);
      if (pull.length) {
        var pullBox = el('div', { class: 'db-sec' }, [el('div', { class: 'db-h', text: 'Pull first' })]);
        var pr = el('div', { class: 'free-row' });
        pull.forEach(function (x) { pr.appendChild(dayChip(x.name, availWhat(x), ' pull')); });
        pullBox.appendChild(pr);
        col.appendChild(pullBox);
      }
      cols.appendChild(col);
    });
    card.appendChild(cols);
    return card;
  }

  /* ------------------------------------------------------------------ */
  /* availability strip + tab badges (visible on every workflow tab)     */
  /* ------------------------------------------------------------------ */

  var stripOpen = false; // phones: the free lists fold into one line until opened

  function renderAvailStrip() {
    var host = $('availStrip');
    if (!host) return;
    clearNode(host);
    var b = App.board;
    var S = window.Status;
    // Coverage shows the day itself (Free now, Free AM | PM) — no strip there
    // …nor on Out today / Roster before any case is in: everyone in a Surg
    // role or OR block reads "free" then, though they are the ones operating
    var early = (App.activeTab === 'out' || App.activeTab === 'roster') && !(App.state.cases || []).some(function (c) { return !isDraftCase(c); });
    var show = WORKFLOW_TABS.indexOf(App.activeTab) !== -1 && App.activeTab !== 'coverage' && !early && b && b.order.length && S;
    host.classList.toggle('hidden', !show);
    if (!show) return;
    function list(items) {
      if (!items.length) return [el('span', { class: 'strip-none', text: 'nobody' })];
      return items.map(function (x, i) {
        return el('span', { class: 'strip-name ' + yearOf(x.name) + (x.partial ? ' partial' : ''), title: x.title || '' }, [
          x.name,
          x.partial ? el('span', { class: 'strip-when', text: x.partial }) : null,
          i < items.length - 1 ? ',' : null
        ]);
      });
    }
    function sessionItems(s) {
      return b.availableInSession(s).filter(function (x) { return x.group === 'free'; }).map(function (x) {
        var partial = '';
        if (!x.full) {
          partial = x.ranges.map(function (r) {
            return S.fmtClock(r.start).replace(/ [AP]M$/, '') + '–' + S.fmtClock(r.end).replace(/ [AP]M$/, '');
          }).join(', ');
          partial = '(' + partial + ')';
        }
        return { name: x.name, partial: partial, title: x.label };
      }).sort(function (p, q) { return (p.partial ? 1 : 0) - (q.partial ? 1 : 0); });
    }
    var inner = el('div', { class: 'strip-inner' });
    var amItems = sessionItems('am');
    var pmItems = sessionItems('pm');
    host.classList.toggle('open', stripOpen);
    inner.appendChild(el('button', {
      type: 'button', class: 'strip-toggle', 'aria-expanded': stripOpen ? 'true' : 'false',
      onclick: function () { stripOpen = !stripOpen; renderAvailStrip(); }
    }, [
      el('span', { class: 'strip-key', text: 'Free' }),
      el('b', { text: 'AM ' + amItems.length }), ' · ', el('b', { text: 'PM ' + pmItems.length }),
      el('span', { class: 'strip-caret', text: stripOpen ? '▴' : '▾' })
    ]));
    if (isToday()) {
      var now = nowMinutes();
      if (now >= S.DAY_START && now < S.DAY_END) {
        inner.appendChild(el('span', { class: 'strip-part' }, [el('b', { class: 'strip-key', text: 'Free now · ' + S.fmtClock(now) })].concat(
          list(b.freeAt(now).map(function (n) { return { name: n, title: b.statusAt(n, now).label }; })))));
      }
    }
    inner.appendChild(el('span', { class: 'strip-part' }, [el('b', { class: 'strip-key', text: 'Free AM' })].concat(list(amItems))));
    inner.appendChild(el('span', { class: 'strip-part' }, [el('b', { class: 'strip-key', text: 'Free PM' })].concat(list(pmItems))));
    var nNeeds = b.needs.length;
    inner.appendChild(el('button', {
      type: 'button', class: 'strip-link' + (nNeeds ? ' warn' : ''),
      text: nNeeds ? '⚠ ' + nNeeds + (nNeeds === 1 ? ' needs' : ' need') + ' coverage →' : 'Coverage →',
      onclick: function () { setTab('coverage'); }
    }));
    host.appendChild(inner);
  }

  function setBadge(id, text, cls) {
    var n = $(id);
    if (!n) return;
    n.textContent = text || '';
    n.className = 'tab-badge' + (text ? ' on ' + (cls || '') : '');
  }

  function renderBadges() {
    var st = App.state;
    var b = App.board;
    if (!st) return;
    var named = (st.absences || []).filter(function (a) { return trim(a.name); }).length;
    var absNeeds = b ? b.needs.filter(function (n) { return n.type === 'absence' && !n.auto; }).length : 0;
    if (named) setBadge('badge-out', String(named), absNeeds ? 'warn' : '');
    else setBadge('badge-out', st.outConfirmed ? '✓' : '', 'ok');
    var needRes = (st.cases || []).filter(caseOpen).length;
    setBadge('badge-surgery', needRes ? String(needRes) : '', 'warn');
    // the Clinics card lists absences and clinic gaps, so its badge counts
    // both; a day with no roster (weekend, out of year) has nothing to cover
    var live = b && b.order.length;
    var clinicGaps = live ? b.needs.filter(function (n) { return n.type === 'clinic' || n.type === 'absence'; }).length : 0;
    setBadge('badge-clinics', clinicGaps ? String(clinicGaps) : '', 'warn');
    var all = live ? b.needs.length : 0;
    setBadge('badge-coverage', all ? String(all) : '', 'warn');
  }

  function stepFoot(next) {
    var wrap = el('div', { class: 'step-foot-inner' });
    if (next && TAB_TITLES[next]) {
      wrap.appendChild(el('button', {
        type: 'button', class: 'btn', text: 'Next: ' + TAB_TITLES[next] + ' →',
        onclick: function () { setTab(next); window.scrollTo(0, 0); }
      }));
    }
    return wrap;
  }

  function renderStepFoots() {
    var nodes = document.querySelectorAll('.step-foot[data-next]');
    for (var i = 0; i < nodes.length; i++) {
      clearNode(nodes[i]);
      nodes[i].appendChild(stepFoot(nodes[i].getAttribute('data-next')));
    }
  }

  // After a change that can affect several tabs at once.
  function refreshEverything() {
    computeBoard();
    prefillAddOns();
    computeSuggestions();
    if (App.activeTab === 'out') renderOutTab();
    if (App.activeTab === 'roster') renderRosterTab();
    if (App.activeTab === 'surgery') renderSurgeryTab();
    if (App.activeTab === 'clinics') renderClinicsTab();
    if (App.activeTab === 'coverage') renderCoverageTab();
    if (App.activeTab === 'preview') renderPreview();
    renderAvailStrip();
    renderBadges();
  }

  /* ------------------------------------------------------------------ */
  /* tab 6 — Preview & Copy                                              */
  /* ------------------------------------------------------------------ */

  // Before sending: everything still open, each with its fix — what the
  // board needs, what contradicts itself (a cover out too, one cover for
  // two), add-on call rows with no name (left out of the copy), and an Out
  // today not looked at. Green only when none of that is left (review
  // 10/19/2026: it went green over a self-contradicting copy).
  function renderSendCheck() {
    var host = $('sendCheck');
    if (!host) return;
    clearNode(host);
    var st = App.state;
    var b = App.board;
    if (!b || !b.order.length) { host.className = 'send-check'; return; }
    var needs = mergeDayNeeds(b.needs || []);
    var warns = b.warnings || [];
    var blankCall = (st.addOns || []).filter(function (a) { return a && a.date && !trim(a.name) && !a.cleared; });
    var outOpen = !st.outConfirmed && !(st.absences || []).some(function (a) { return trim(a.name); });
    var noCases = !(st.cases || []).some(function (c) { return !isDraftCase(c); });
    if (!needs.length && !warns.length && !blankCall.length && !outOpen) {
      host.className = 'send-check' + (noCases ? '' : ' ok');
      host.appendChild(document.createTextNode(noCases ? 'No cases yet.' : '✓ Nothing open'));
      return;
    }
    host.className = 'send-check warn';
    host.appendChild(el('div', { class: 'send-check-h', text: '⚠ Still open' }));
    if (outOpen) {
      host.appendChild(el('div', { class: 'need-row' }, [
        el('div', { class: 'need-text' }, [el('b', { text: 'Out today' }), ' — not filled in (or “No one out”)']),
        el('div', { class: 'need-actions' }, [el('button', { type: 'button', class: 'btn btn-small', text: 'Out today', onclick: function () { setTab('out'); window.scrollTo(0, 0); } })])
      ]));
    }
    needs.forEach(function (n) { host.appendChild(needItem(n)); });
    warns.forEach(function (w) { host.appendChild(el('div', { class: 'warn-line bad', text: '⚠ ' + w })); });
    blankCall.forEach(function (a) {
      host.appendChild(el('div', { class: 'need-row' }, [
        el('div', { class: 'need-text' }, [el('b', { text: addOnLabel(a) }), ' — add-on call: no name yet (left out of the copy)']),
        el('div', { class: 'need-actions' }, [el('button', { type: 'button', class: 'btn btn-small', text: 'Add-on call', onclick: function () { setTab('coverage'); var c = $('addOnsCoverage'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center' }); } })])
      ]));
    });
  }

  function renderPreview() {
    renderSendCheck();
    var host = $('previewDoc');
    if (window.ExportFmt && window.ExportFmt.buildHTML) {
      host.innerHTML = window.ExportFmt.buildHTML(exportDay());
      if (!host.textContent.replace(/\s/g, '')) {
        host.innerHTML = '<p class="empty-note">Nothing to show yet — the schedule builds up as you fill in the other tabs.</p>';
      }
    } else {
      host.textContent = 'Export module not loaded.';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Paste a sent schedule — the hand-off to the next Surg 2              */
  /* ------------------------------------------------------------------ */
  // The Surg 2 who builds tomorrow is often not tomorrow's Surg 2, and each
  // browser keeps its own drafts. Pasting the schedule that was sent gives
  // this browser the day, so Coverage works live here too; the day is saved,
  // so "Start from yesterday" can build the next one from it.

  var importText = '';   // what is in the paste box (not saved)
  var importDate = '';   // the day it will be loaded into ('' = guess)
  var importTimer = null;
  var importTypes = {};  // case signature -> type chosen on the paste screen

  // The case type is the schedulers' call. The app remembers, per browser,
  // the type last set for each attending (paste screen or Surgery tab) and
  // pre-fills it next time.
  var SURGEON_TYPES_KEY = 'surgsched:v2:surgeonTypes';
  function knownSurgeonTypes() {
    try { return JSON.parse(lsGet(SURGEON_TYPES_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function rememberSurgeonType(surgeon, section, type) {
    var key = window.ImportFmt ? window.ImportFmt.surgeonKey(surgeon) : '';
    if (!key || section === 'private' || !type || type === 'other' || /globe|trauma/.test(key)) return;
    var all = knownSurgeonTypes();
    if (all[key] === type) return;
    all[key] = type;
    lsSet(SURGEON_TYPES_KEY, JSON.stringify(all));
  }
  function caseSig(c) { return [c.section, c.surgeon, c.count, c.start].join('|').toLowerCase(); }

  function todayISO() { return isoOf(new Date()); }

  function importNames(iso) {
    var r = null;
    try { r = window.Engine.resolveDay(iso, data()); } catch (e) { r = null; }
    var names = ((r && r.residents) || []).map(function (x) { return x.name; });
    return { roster: r, names: names };
  }

  // Which day is this? The add-ons name it ("Monday daytime (9/28/26)");
  // otherwise the day whose Surg 1–5 match the paste, preferring today.
  function guessImportDate(parsed) {
    var cands = [];
    if (parsed.addOnDates.length) cands.push(parsed.addOnDates.slice().sort()[0]);
    [todayISO(), tomorrowISO()].forEach(function (d) { if (cands.indexOf(d) === -1) cands.push(d); });
    var keys = Object.keys(parsed.surg);
    if (!keys.length) return cands[0];
    var best = cands[0], bestScore = -1;
    cands.forEach(function (iso) {
      var r = importNames(iso).roster;
      var surg = (r && r.surg) || {};
      var score = keys.filter(function (k) { return surg[k] && surg[k].name === parsed.surg[k]; }).length;
      if (score > bestScore) { best = iso; bestScore = score; }
    });
    return best;
  }

  // parse → a day for `iso`, rebuilt text, and how it compares to the paste
  function readImport(text, iso) {
    var info = importNames(iso);
    var roster = info.roster || emptyRoster(iso);
    var parsed = window.ImportFmt.parse(text, { names: info.names, clinics: roster.clinics || {} });
    var base = defaultState(iso);
    base.addOns.forEach(function (r) { r.label = addOnLabel(r); });
    var cb = roster.cooperBuddies; // as computeRoster would pre-fill them
    if (cb && cb.am) base.cooperBuddyAM = { name: String(cb.am), note: String(cb.templateAM || '').toLowerCase() };
    if (cb && cb.pm) base.cooperBuddyPM = { name: String(cb.pm), note: String(cb.templatePM || '').toLowerCase() };
    var entries = [];
    try { entries = window.Engine.cpecForDate(iso, data()).entries; } catch (e) { entries = []; }
    var cpec = entries.map(function (e) { return e.attending; });
    // where the sheet has each attending that day — a case under the old
    // 'Wills/ASC' heading moves to Stadium / Cherry Hill when it is only there
    var cpecSites = {};
    entries.forEach(function (e) {
      var k = window.ImportFmt.surgeonKey(e.attending);
      if (k) (cpecSites[k] || (cpecSites[k] = [])).push(ASC_SITES[e.site] ? e.site : 'W');
    });
    var surg = roster.surg || {};
    var day = window.ImportFmt.toDay(parsed, base, roster, data(), window.ExportFmt, {
      addOnLabel: addOnLabel,
      knownTypes: knownSurgeonTypes(),
      cpecSurgeons: cpec,
      cpecSites: cpecSites,
      surgRoleOf: function (n) { for (var k in surg) if (surg[k] && surg[k].name === n) return k; return ''; }
    });
    var probe = {};
    for (var k in day) probe[k] = day[k];
    probe.roster = roster;
    var rebuilt = window.ExportFmt.buildText(probe);
    var skipped = {};
    parsed.unknown.forEach(function (l) { skipped[window.ImportFmt.clean(l)] = true; });
    var kept = String(text).split(/\r\n|\r|\n/).filter(function (l) { return !skipped[window.ImportFmt.clean(l)]; }).join('\n');
    return { parsed: parsed, day: day, roster: roster, rebuilt: rebuilt, diff: window.ImportFmt.diffLines(kept, rebuilt) };
  }

  function renderImportTab() {
    var host = $('importBody');
    if (!host) return;
    clearNode(host);
    var card = el('div', { class: 'card import-card' });
    card.appendChild(el('h2', {}, ['Paste the schedule you were sent ', el('span', {
      class: 'h-note',
      text: 'The whole message, as sent. Nothing leaves this browser.'
    })]));
    var ta = el('textarea', {
      class: 'import-text', rows: '12', spellcheck: 'false',
      placeholder: 'Assignments\nSurg 1 - …\n\nWills\n-Hark x1 (1300 start) - Bair; Djulbegovic to cover cornea clinic during case\n…\n\nClinics\n…\n\nVacation\n…'
    });
    ta.value = importText;
    ta.addEventListener('input', function () {
      importText = ta.value;
      if (importTimer) clearTimeout(importTimer);
      importTimer = setTimeout(renderImportPreview, 250);
    });
    card.appendChild(ta);
    host.appendChild(card);
    host.appendChild(el('div', { id: 'importPreview' }));
    renderImportPreview();
  }

  function importSummaryBits(day, parsed) {
    var cases = day.cases || [];
    var staffed = cases.filter(function (c) { return trim(c.assigned); }).length;
    var open = cases.filter(needsResident).length;
    var bits = [];
    bits.push(cases.length + ' case' + (cases.length === 1 ? '' : 's') + (cases.length ? ' (' + staffed + ' with a resident' + (open ? ', ' + open + ' open' : '') + ')' : ''));
    if (day.absences.length) bits.push(day.absences.length + ' out');
    else if (day.outConfirmed) bits.push('no one out');
    if (day.nightFloat) bits.push('Night Float ' + day.nightFloat);
    if (parsed.clinics.length) bits.push(parsed.clinics.length + ' clinic line' + (parsed.clinics.length === 1 ? '' : 's'));
    var named = parsed.addOns.length;
    if (named) bits.push(named + ' add-on name' + (named === 1 ? '' : 's'));
    return bits;
  }

  function renderImportPreview() {
    var host = $('importPreview');
    if (!host) return;
    clearNode(host);
    if (!trim(importText) || !window.ImportFmt) return;
    var t0 = importNames(todayISO());
    var first = window.ImportFmt.parse(importText, { names: t0.names, clinics: (t0.roster && t0.roster.clinics) || {} });
    if (!first.read) {
      host.appendChild(el('div', { class: 'card needs-card' }, [el('p', { class: 'ref-para', text: 'This does not look like a surgery schedule — no Assignments, case or Vacation lines were found.' })]));
      return;
    }
    var guess = guessImportDate(first);
    var iso = importDate || guess;
    var res = readImport(importText, iso);
    var day = res.day, parsed = res.parsed;
    var d = parseISO(iso);
    var card = el('div', { class: 'card import-result' });
    card.appendChild(el('h2', {}, ['What the app read ', el('span', { class: 'h-note', text: importSummaryBits(day, parsed).join(' · ') })]));

    // which day
    var when = el('div', { class: 'import-when' });
    when.appendChild(el('span', { class: 'mini-label', text: 'This is the schedule for' }));
    var dIn = el('input', { type: 'date', value: iso });
    dIn.addEventListener('change', function () { if (dIn.value) { importDate = dIn.value; renderImportPreview(); } });
    when.appendChild(dIn);
    when.appendChild(el('b', { text: weekdayName(d) + ' ' + fmtMDYY(d) }));
    if (iso === todayISO()) when.appendChild(chipEl('Today', 'chip-day'));
    else if (iso === tomorrowISO()) when.appendChild(chipEl('Tomorrow', 'chip-day'));
    if (guess !== iso) {
      when.appendChild(el('button', {
        type: 'button', class: 'btn-link', text: 'The schedule points to ' + weekdayName(parseISO(guess)) + ' ' + fmtMDYY(parseISO(guess)) + ' — use it',
        onclick: function () { importDate = guess; renderImportPreview(); }
      }));
    }
    card.appendChild(when);

    // what will be loaded — cases first, each with its type (the schedulers' call)
    var SEC = SECTION_SHORT;
    if (day.cases.length) {
      var list = el('div', { class: 'imp-block' });
      list.appendChild(el('div', { class: 'imp-block-head' }, [
        el('b', { text: 'Cases' }),
        el('span', { class: 'field-hint', text: 'Set each case’s type — it picks the chain. Remembered for each attending.' })
      ]));
      day.cases.forEach(function (c) {
        var sig = caseSig(c);
        if (importTypes[sig]) c.category = importTypes[sig];
        var bits = [];
        if (c.start) bits.push(c.start);
        if (c.serviceCount > 0 && c.serviceCount < c.count) bits.push(c.serviceCount + ' service' + (c.serviceTimes ? ' from ' + c.serviceTimes : ''));
        else if (c.serviceCount > 0 && c.serviceCount === c.count && c.section !== 'private') bits.push('all service');
        else if (c.section !== 'private' && !c.serviceCount) bits.push('no service cases');
        var who = c.assigned ? '→ ' + c.assigned + (c.backup ? ' (backup ' + c.backup + ')' : '') : (c.serviceCount > 0 ? '→ no resident yet' : '');
        var sel = el('select', { class: 'imp-type', 'aria-label': 'Type for ' + c.surgeon });
        CATEGORIES.forEach(function (k) { sel.appendChild(el('option', { value: k, text: k })); });
        sel.value = c.category;
        var unset = c.category === 'other' && !importTypes[sig];
        if (unset) sel.classList.add('unset');
        sel.addEventListener('change', function () { importTypes[sig] = sel.value; c.category = sel.value; sel.classList.remove('unset'); });
        list.appendChild(el('div', { class: 'imp-case' }, [
          el('span', { class: 'imp-sec', text: SEC[c.section] || c.section }),
          el('span', { class: 'imp-main' }, [
            el('b', { text: c.surgeon + ' ×' + c.count }),
            bits.length ? el('span', { class: 'imp-meta', text: ' · ' + bits.join(' · ') }) : null,
            who ? el('span', { class: 'imp-who' + (c.assigned ? '' : ' open'), text: ' ' + who }) : null,
            c.notes ? el('span', { class: 'imp-note', text: ' — ' + c.notes + (/cc'?d/i.test(c.notes) ? ' (cross-checked: no service cases)' : '') }) : null
          ]),
          sel
        ]));
      });
      card.appendChild(list);
    }
    function sessWho(a, s) {
      var w = s === 'am' ? a.coverAM : a.coverPM;
      return w === 'NC' ? 'not covered ' + s.toUpperCase() : (w ? w + ' ' + s.toUpperCase() : s.toUpperCase() + ' coverage not set');
    }
    if (day.absences.length || day.outConfirmed || day.vacation) {
      var outB = el('div', { class: 'imp-block' }, [el('div', { class: 'imp-block-head' }, [el('b', { text: 'Out' })])]);
      if (!day.absences.length && day.outConfirmed) outB.appendChild(el('div', { class: 'imp-line', text: 'No one out' }));
      day.absences.forEach(function (a) {
        var span = a.am && a.pm ? 'all day' : (a.am ? 'AM' : 'PM');
        var cov;
        if (a.am && a.pm && a.coverAM === a.coverPM) cov = a.coverAM === 'NC' ? 'not covered' : (a.coverAM ? 'covered by ' + a.coverAM : 'coverage not set');
        else cov = [a.am ? sessWho(a, 'am') : '', a.pm ? sessWho(a, 'pm') : ''].filter(Boolean).join(' · ');
        outB.appendChild(el('div', { class: 'imp-line' }, [el('b', { text: a.name }), ' — ' + span + (a.reason && a.reason !== 'vacation' ? ' (' + (a.reason === 'other' ? 'out' : a.reason) + ')' : '') + ' · ' + cov]));
      });
      if (day.vacation) day.vacation.split('\n').forEach(function (l) { outB.appendChild(el('div', { class: 'imp-line muted', text: 'Note: ' + l })); });
      card.appendChild(outB);
    }
    if (parsed.clinics.length) {
      var clB = el('div', { class: 'imp-block' }, [el('div', { class: 'imp-block-head' }, [
        el('b', { text: 'Clinics' }),
        el('span', { class: 'field-hint', text: 'Clinics not listed keep the block schedule’s staff.' })
      ])]);
      parsed.clinics.forEach(function (cl) {
        var head = cl.label + (cl.session === 'day' ? '' : ' ' + cl.session.toUpperCase());
        var paren = [cl.count, cl.extra].filter(Boolean).join(' · ');
        clB.appendChild(el('div', { class: 'imp-line' }, [
          el('b', { text: head }), paren ? el('span', { class: 'imp-meta', text: ' (' + paren + ')' }) : null,
          ': ' + (cl.staff.length ? cl.staff.join(', ') : 'none')
        ]));
      });
      card.appendChild(clB);
    }
    var also = [];
    if (day.nightFloat) also.push('Night Float ' + day.nightFloat);
    if (day.lectures) also.push(day.lectures.split('\n').length + ' lecture line' + (day.lectures.split('\n').length === 1 ? '' : 's'));
    if (parsed.addOns.length) also.push('Add-on call: ' + parsed.addOns.map(function (a) { return (a.label ? a.label.replace(/\s*\(.*\)$/, '') + ' ' : '') + a.name; }).join(', '));
    if (also.length) card.appendChild(el('div', { class: 'imp-block' }, [el('div', { class: 'imp-line' }, [el('b', { text: 'Also: ' }), also.join(' · ')])]));

    // things to check
    var notes = [];
    var surg = res.roster.surg || {};
    Object.keys(parsed.surg).forEach(function (k) {
      var want = (surg[k] && surg[k].name) || '';
      if (parsed.surg[k] && want && parsed.surg[k] !== want) {
        notes.push({ bad: true, text: 'Surg ' + k + ' is ' + parsed.surg[k] + ' in the paste but ' + want + ' on the block schedule for this day — check the date (the app always uses the block schedule).' });
      }
    });
    if (parsed.unknownNames.length) notes.push({ bad: true, text: 'Not on this year’s roster, kept as typed: ' + parsed.unknownNames.join(', ') + '.' });
    parsed.notedNotOut.forEach(function (l) { notes.push({ text: 'Read as a Vacation note, not as someone out: “' + l + '”.' }); });
    if (parsed.notClinics.length) notes.push({ text: 'Not a clinic in the app, so not loaded: ' + parsed.notClinics.map(function (l) { return '“' + l + '”'; }).join(', ') + '.' });
    if (parsed.unknown.length) notes.push({ bad: true, text: 'Could not read ' + parsed.unknown.length + ' line' + (parsed.unknown.length === 1 ? '' : 's') + ' — they are not loaded; add them by hand: ' + parsed.unknown.map(function (l) { return '“' + l + '”'; }).join(', ') });
    notes.forEach(function (n) { card.appendChild(el('div', { class: 'warn-line' + (n.bad ? ' bad' : '') + ' import-note', text: n.text })); });
    if (res.diff.same) card.appendChild(el('div', { class: 'import-check ok', text: '✓ Rebuilt from what was read, it matches your paste line for line.' }));

    // load
    var existing = lsGet(LS_PREFIX + iso);
    var foot = el('div', { class: 'import-foot' });
    if (existing) {
      foot.appendChild(el('span', { class: 'field-hint', text: 'Replaces the saved draft for ' + weekdayName(d) + ' ' + fmtMDYY(d) + ' in this browser (' + (draftText(draftSummary(iso)) || 'saved') + ').' }));
    }
    foot.appendChild(el('button', {
      type: 'button', class: 'btn btn-primary', text: 'Load into ' + weekdayName(d) + ' ' + fmtMDYY(d) + ' →',
      onclick: function () {
        if (existing && !window.confirm('Replace the saved draft for ' + weekdayName(d) + ' ' + fmtMDYY(d) + ' with the pasted schedule?')) return;
        loadImported(res, iso);
      }
    }));
    card.appendChild(foot);
    host.appendChild(card);
  }

  function loadImported(res, iso) {
    saveNow(); // flush whatever day is open
    var day = res.day;
    day.cases.forEach(function (c) {
      var t = importTypes[caseSig(c)];
      if (t) c.category = t;
      rememberSurgeonType(c.surgeon, c.section, c.category);
    });
    importTypes = {};
    day.date = iso;
    day.savedAt = Date.now();
    if (!lsSet(LS_PREFIX + iso, JSON.stringify(day))) {
      toast('Could not save — this browser is blocking storage', false);
      return;
    }
    importText = '';
    importDate = '';
    var n = day.cases.length;
    setDate(iso);
    var live = iso === todayISO();
    setTab(live ? 'coverage' : 'surgery');
    window.scrollTo(0, 0);
    toast('Loaded ' + n + ' case' + (n === 1 ? '' : 's') + (day.absences.length ? ', ' + day.absences.length + ' out' : '') +
      (live ? ' — live coverage is ready' : ''));
  }

  function importCallout(text) {
    return el('div', { class: 'import-callout' }, [
      el('span', { text: text + ' ' }),
      el('button', {
        type: 'button', class: 'btn-link', text: 'Paste the schedule they sent →',
        onclick: function () { setTab('import'); window.scrollTo(0, 0); }
      })
    ]);
  }

  function dayIsBlank() {
    var st = App.state;
    return !!st && !(st.cases || []).length && !(st.absences || []).length && !st.outConfirmed;
  }

  /* ------------------------------------------------------------------ */
  /* How-to view — friendly onboarding cards (static)                    */
  /* ------------------------------------------------------------------ */

  function bulletList(items, cls) {
    var u = el('ul', { class: 'ref-note-list' + (cls ? ' ' + cls : '') });
    items.forEach(function (t) { u.appendChild(el('li', { text: t })); });
    return u;
  }

  var CHAIN_TOKEN_LABELS = {
    COOPER: 'Cooper (third year)',
    WILLS_OR: 'Wills OR',
    RETINA: 'Retina / Uveitis',
    PEDS_OR_JUNIOR: 'junior on Peds OR',
    FREE_JUNIOR: 'free junior at Surg 2’s discretion',
    PLASTICS_OR_PGY2: 'first year on Plastics OR',
    PLASTICS_OR_JUNIOR: 'junior on Plastics OR'
  };

  // `skip`: tokens to leave out
  /* ------------------------------------------------------------------ */
  /* Library — Flow chart                                                */
  /* ------------------------------------------------------------------ */
  // One page to refer to, or print for the lounge wall: the rules only —
  // Surg 2 and the globe, someone out, who takes a case (the how-to's steps
  // 3–10) and who covers a clinic (step 12); the steps are on Home and How-to. The
  // chains come straight from the active configuration (data.hierarchy), so
  // a new year's chains show up here with no code change.

  function fcNode(kind, title, body) {
    var n = el('div', { class: 'fc-node fc-' + kind });
    if (title) n.appendChild(el('div', { class: 'fc-title', text: title }));
    (Array.isArray(body) ? body : body ? [body] : []).forEach(function (b) {
      n.appendChild(typeof b === 'string' ? el('div', { class: 'fc-text', text: b }) : b);
    });
    return n;
  }

  function fcArrow(label) {
    return el('div', { class: 'fc-arrow' }, [label ? el('span', { class: 'fc-arrow-label', text: label }) : null]);
  }

  // A question with a side exit: [question] —sideLabel→ [side], and the
  // main line carries on below it (downLabel).
  function fcDecision(question, sideLabel, side, downLabel) {
    var row = el('div', { class: 'fc-decision' }, [
      fcNode('q', question),
      el('div', { class: 'fc-side' }, [el('span', { class: 'fc-side-label', text: sideLabel }), side])
    ]);
    return [row, fcArrow(downLabel)];
  }

  function fcFlow(items) {
    var wrap = el('div', { class: 'fc' });
    items.forEach(function (it) {
      (Array.isArray(it) ? it : [it]).forEach(function (n) { wrap.appendChild(n); });
    });
    return wrap;
  }

  function fcList(items) {
    var ul = el('ul', { class: 'fc-list' });
    items.forEach(function (t) { ul.appendChild(el('li', {}, Array.isArray(t) ? t : [t])); });
    return ul;
  }

  // A chain as chips: Surg 2 → Surg 3 → … (`skip`: tokens to leave out)
  function chainChips(key, skip) {
    var h = (data().hierarchy || {})[key];
    var wrap = el('span', { class: 'fc-chain' });
    ((h && h.chain) || []).filter(function (tok) { return (skip || []).indexOf(tok) === -1; }).forEach(function (tok, i) {
      if (i) wrap.appendChild(el('span', { class: 'fc-chain-sep', 'aria-hidden': 'true', text: '→' }));
      wrap.appendChild(el('span', { class: 'fc-chip', text: CHAIN_TOKEN_LABELS[tok] || tok }));
    });
    return wrap;
  }

  // 'Retina, Retina Private, Uveitis or PT' — duties that need no cover,
  // from the active configuration (Day Float aside: it never covers others)
  function noCoverWords() {
    var av = data().availability || {};
    var list = [];
    (av.pullFirstTexts || ['Retina', 'Retina Private', 'Uveitis']).concat(av.noCoverTexts || ['PT']).forEach(function (t) {
      if (t !== 'Day Float' && list.indexOf(t) === -1) list.push(t);
    });
    return list.length > 1 ? list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1] : list.join('');
  }

  function renderFlow() {
    var host = $('flowBody');
    if (!host) return;
    clearNode(host);

    host.appendChild(el('div', { class: 'flow-tools' }, [
      el('button', { type: 'button', class: 'btn btn-small', text: 'Print / save as PDF', onclick: function () { window.print(); } })
    ]));
    var cards = flowCards();
    [cards.surg2, cards.out, cards.cases, cards.clinic].forEach(function (c) { host.appendChild(c); });
  }

  // The rule cards, for Library → Flow chart and the foot of Coverage.
  function flowCards() {
    return { surg2: surg2FlowCard(), out: outFlowCard(), cases: casesFlowCard(), clinic: clinicFlowCard() };
  }

  function outFlowCard() {
    var out = refCard('Someone is out');
    out.appendChild(fcFlow([
      fcNode('start', 'Out today: who is out — all day, AM or PM'),
      fcArrow(),
      fcDecision('On Night Float this week?', 'Yes',
        fcNode('auto', 'Automatic', 'Out for the day (post-call). Day Float covers them — and only them.'),
        'No'),
      fcNode('q', 'Who covers each session?'),
      el('div', { class: 'fc-branches' }, [
        el('div', { class: 'fc-branch' }, [el('div', { class: 'fc-branch-label', text: 'A resident' }),
          fcNode('ok', 'They do that resident’s job for the session', [
            'Their duty, and their place in every chain. Cover Surg 2 and you are Surg 2: every globe, first for the remaining cases and clinic cover — and the daytime add-on call.',
            'Your own clinic is then a gap to cover (unless ' + noCoverWords() + ').'
          ])]),
        el('div', { class: 'fc-branch' }, [el('div', { class: 'fc-branch-label', text: 'NC' }),
          fcNode('warn', 'Not covered', 'The duty runs short. A Surg role’s cases go to the next person in each chain.')])
      ]),
      fcArrow(),
      fcNode('end', 'Their cases go back down each chain')
    ]));
    return out;
  }

  function casesFlowCard() {
    var cases = refCard('Who takes a case');
    var tbl = el('div', { class: 'flow-chains' });
    var hier = data().hierarchy || {};
    Object.keys(hier).filter(function (k) { return k !== 'clinicCoverage'; }).sort(function (a, b) {
      return (hier[a].step || 99) - (hier[b].step || 99);
    }).forEach(function (k) {
      tbl.appendChild(el('div', { class: 'flow-chain-row' }, [
        el('span', { class: 'flow-chain-step', text: 'Step ' + (hier[k].step != null ? hier[k].step : '—') }),
        el('span', { class: 'flow-chain-label', text: hier[k].label }),
        chainChips(k),
        // the exception, where the chain is read
        k === 'traumaPlasticsAddOn' && globeRole() ? el('span', { class: 'fc-text flow-chain-note', text: 'A globe: ' + globeRole() + ', always.' }) : null
      ]));
    });
    cases.appendChild(tbl);
    cases.appendChild(fcFlow([
      fcNode('start', 'Walk the case’s chain, in order'),
      fcArrow(),
      fcNode('check', 'Skip anyone who is', fcList([
        'out — unless someone covers them: then the coverer is in their place',
        'already in a case then',
        'on Path, ER or consults — never pulled',
        'at Cooper (off-site)',
        'an OR-block slot (e.g. “first year on Plastics OR”) who is in clinic then — they stay in clinic',
        '“free junior”: only juniors who are really free, or in Retina / Uveitis — confirm with Surg 2'
      ])),
      fcArrow(),
      fcDecision('Anyone left on the chain?', 'No',
        fcNode('warn', 'Skip for now → Step 10', 'Remaining-cases chain, in time order; then Surg 2’s call.'),
        'Yes'),
      fcNode('ok', 'The first one takes it'),
      fcArrow(),
      fcDecision('Were they in a clinic then?', 'Yes',
        fcNode('warn', 'The clinic needs a backup', 'Retina / Uveitis: no cover needed. Any other clinic: see Who covers a clinic.'),
        'No'),
      fcNode('end', 'Done')
    ]));
    return cases;
  }

  // Surg 2 and the globe (10/18/2026: "surg 2 is ALWAYS going to take a
  // globe. where we get into issues is when Surg 2 is in a globe then the
  // surg 3 person may have a corneal transplant (PKP) while they have
  // clinic on M, W, or F afternoon … glaucoma cases going during the PM
  // clinic on T, W, Th"; "if there is no globe … surg 2 should be
  // available for clinic to cover other surgery service … least
  // redundancy is on Wednesdays"). The days come from the block schedule.
  function surg2FlowCard() {
    var S = window.Status;
    var role = globeRole();
    var card = refCard((role || 'Surg 2') + ' and the globe');
    var callAfter = S ? S.parseClock(data().callAfter || '16:30') : null;
    var freeBody = ['First for clinic cover and for any case left over.'];
    if (!role) {
      card.appendChild(el('p', { class: 'field-hint flow-lede', text: 'No role always takes a globe in this configuration — a globe walks the trauma chain like any add-on (Who takes a case).' }));
      card.appendChild(fcFlow([fcNode('ok', 'With no globe, Surg 2 is free', freeBody)]));
      return card;
    }
    card.appendChild(fcFlow([
      fcDecision('A globe today?', 'No', fcNode('ok', role + ' is free', freeBody), 'Yes'),
      fcNode('ok', role + ' takes it — always', [
        'Whoever covers ' + role + ' is ' + role + '. Operating? The globe follows their cases — check in with them. A second globe follows the first.',
        el('div', { class: 'fc-text' }, ['Only out with nobody covering: down the trauma chain — ', chainChips('traumaPlasticsAddOn', ['PLASTICS_OR_JUNIOR', role])])
      ]),
      fcArrow(),
      fcDecision('Was ' + role + ' covering a clinic then?', 'No', fcNode('end', 'Nothing to hand off'), 'Yes'),
      fcNode('check', 'The next free on the clinic-coverage chain covers it', [
        chainChips('clinicCoverage', [role])
      ]),
      fcArrow('later in the day'),
      fcNode('end', callAfter != null ? 'Not rolled back by ' + S.fmtClock(callAfter) : 'Late in the day', 'It can be passed to the call person.')
    ]));
    return card;
  }

  // The rules on Coverage (10/18/2026: "make the flow chart on the
  // coverage page to allow the user to know what the rules are"): the
  // same cards as Library → Flow chart, the ones used on the day first.
  // Open unless this browser closed it.
  // Folded until opened (review 10/19/2026: open, the chart was most of the
  // page). A new key: the old one stored 'open' on every render, whoever
  // opened it.
  var COVERAGE_RULES_KEY = 'surgsched:v1:ui:coverageRulesOpen';

  function renderCoverageRules() {
    var host = $('coverageRules');
    if (!host) return;
    clearNode(host);
    if (!App.board || !App.board.order.length) return;
    var det = el('details', { class: 'cov-rules' });
    var wasOpen = lsGet(COVERAGE_RULES_KEY) === 'open';
    det.open = wasOpen;
    det.appendChild(el('summary', { class: 'cov-rules-sum' }, [
      el('span', { class: 'cov-rules-title', text: 'The rules — flow chart' }),
      el('span', { class: 'h-note', text: 'Who takes a globe, who covers a clinic, who takes a case — the same as Library → Flow chart.' })
    ]));
    // only a reader's own open / close is remembered — not this render's
    var touched = false;
    det.addEventListener('toggle', function () {
      if (!touched && det.open === wasOpen) return;
      touched = true;
      lsSet(COVERAGE_RULES_KEY, det.open ? 'open' : 'closed');
    });
    var cards = flowCards();
    [cards.surg2, cards.clinic, cards.cases, cards.out].forEach(function (c) { det.appendChild(c); });
    host.appendChild(det);
  }

  function showCoverageRules() {
    var host = $('coverageRules');
    var det = host && host.querySelector('details');
    if (!det) return;
    det.open = true;
    lsSet(COVERAGE_RULES_KEY, 'open');
    det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function clinicFlowCard() {
    var cl = refCard('Who covers a clinic');
    cl.appendChild(fcFlow([
      fcNode('start', 'Someone leaves a clinic', 'Pulled into a case, or covering someone who is out.'),
      fcArrow(),
      fcDecision('Retina or Uveitis?', 'Yes', fcNode('ok', 'No cover needed', 'Pull from them first.'), 'No'),
      fcNode('check', 'Step 12 — the clinic-coverage chain', [chainChips('clinicCoverage')]),
      fcArrow(),
      fcDecision('Anyone free for the whole time?', 'No',
        fcNode('warn', 'Surg 2’s call', 'Or NC.'),
        'Yes'),
      fcNode('end', 'They cover')
    ]));
    return cl;
  }

  /* ------------------------------------------------------------------ */
  /* Library — CPEC block schedule (full sheet reference)               */
  /* ------------------------------------------------------------------ */

  var CPEC_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CPEC_DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };

  function cpecRefEntry(e) {
    var cls = 'cpec-ref-entry ';
    cls += (e.privateOnly || !e.cover) ? 'cpec-c-private' : 'cpec-c-' + e.cover;
    var wrap = el('div', { class: cls });
    wrap.appendChild(el('span', {
      class: 'cpec-ref-main',
      text: cpecEntryText(e) + (e.privateOnly ? ' · private only' : '')
    }));
    if (e.months && e.months.length) {
      wrap.appendChild(el('span', {
        class: 'cpec-ref-months',
        text: '*(' + e.months.map(function (m) { return CPEC_MONTH_ABBR[m - 1] || m; }).join(', ') + ')'
      }));
    }
    return wrap;
  }

  function renderCpecReference() {
    var host = $('cpecBody');
    if (!host) return;
    clearNode(host);
    var sheet = data().cpecSheet;
    if (!sheet || !sheet.entries) {
      host.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'empty-note', text: 'No CPEC sheet loaded.' })
      ]));
      return;
    }

    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', {}, [
      (sheet.label || 'CPEC Surgical Block Schedule') + ' ',
      el('span', { class: 'h-note', text: 'Effective ' + fmtMDYY(parseISO(sheet.effective)) })
    ]));

    var legend = el('div', { class: 'cpec-legend' });
    [['surg1', 'Surg 1'], ['surg5', 'Surg 5'], ['willsOR', 'Wills OR'],
     ['retina', 'Retina resident'], ['private', 'Private only — no resident']].forEach(function (p) {
      legend.appendChild(el('span', { class: 'cpec-ref-entry cpec-c-' + p[0] + ' cpec-legend-chip', text: p[1] }));
    });
    card.appendChild(legend);

    var r = App.roster || {};
    var tbl = el('table', { class: 'tbl cpec-ref-tbl' });
    tbl.appendChild(el('thead', {}, [el('tr', {},
      [el('th', { text: '' })].concat(dataWeekdays().map(function (d) {
        return el('th', { text: CPEC_DAY_LABELS[d] || d });
      }))
    )]));
    var body = el('tbody');
    [1, 2, 3, 4, 5].forEach(function (nth) {
      var row = el('tr', {}, [el('td', { class: 'cpec-ref-nth', text: ordinal(nth) })]);
      dataWeekdays().forEach(function (d) {
        var entries = (sheet.entries[nth] || {})[d] || [];
        var isToday = !r.isWeekend && r.inYear && r.nth === nth && r.weekdayKey === d;
        var td = el('td', { class: isToday ? 'cpec-today' : null });
        if (!entries.length) td.appendChild(el('span', { class: 'empty-note', text: '—' }));
        entries.forEach(function (e) { td.appendChild(cpecRefEntry(e)); });
        row.appendChild(td);
      });
      body.appendChild(row);
    });
    tbl.appendChild(body);
    var scroller = el('div', { class: 'table-scroll' }, [tbl]);
    card.appendChild(scroller);
    card.appendChild(el('p', { class: 'field-hint', text: 'Starred: those months only.' }));
    host.appendChild(card);
    // phones: bring the selected day's column into view
    setTimeout(function () {
      var cell = scroller.querySelector('.cpec-today');
      if (cell && scroller.scrollWidth > scroller.clientWidth) {
        scroller.scrollLeft = Math.max(0, cell.offsetLeft - (scroller.clientWidth - cell.offsetWidth) / 2);
      }
    }, 0);
  }

  // How-to: the steps and the tips — the rules live on the Flow chart, the
  // block data on Block schedules (review 10/19/2026: one home per topic)
  function renderHowto() {
    var host = $('howtoBody');
    if (!host) return;
    clearNode(host);

    // The flow — the six numbered tabs, in the how-to's order
    var flow = refCard('The flow');
    [
      { tab: 'out', num: '1', title: 'Out today', text: 'Check the Google Calendar first. Add who is out (all day / AM / PM) and who covers each session, or NC — or press “No one out”.' },
      { tab: 'roster', num: '2', title: 'Roster', text: 'Fills in from the block schedule. Check Night Float; add lectures.' },
      { tab: 'surgery', num: '3', title: 'Surgery', text: 'Add the CPEC-sheet lists, then the cases from Cerner / NextGen. Accept or change the suggested resident.' },
      { tab: 'clinics', num: '4', title: 'Clinics', text: 'Type the patient counts.' },
      { tab: 'coverage', num: '5', title: 'Coverage', text: 'On the day: what is still open, who is operating (check lists off), who is free. Plan a globe or add-ons; name the add-on call.' },
      { tab: 'preview', num: '6', title: 'Preview & Copy', text: 'Copy and paste.' },
      { tab: 'import', num: '↩', title: 'Taking over a day someone else built', text: 'Paste the schedule you were sent — Coverage then runs live for you.' }
    ].forEach(function (s) {
      flow.appendChild(el('div', { class: 'howto-step' }, [
        el('span', { class: 'howto-num', text: s.num }),
        el('div', { class: 'howto-step-body' }, [
          el('div', { class: 'howto-step-title', text: s.title }),
          el('div', { class: 'howto-step-text', text: s.text })
        ]),
        el('button', {
          type: 'button', class: 'btn btn-small', text: 'Go →',
          onclick: function () { setTab(s.tab); }
        })
      ]));
    });
    flow.appendChild(el('div', { class: 'howto-foot' }, [
      el('button', { type: 'button', class: 'btn btn-small', text: 'Flow chart', onclick: function () { setTab('flow'); } }),
      el('button', { type: 'button', class: 'btn btn-small', text: 'Block schedules', onclick: function () { setTab('reference'); } })
    ]));
    host.appendChild(flow);

    // Tips for new schedulers — from the how-to deck
    var tips = refCard('Tips for new schedulers');
    tips.appendChild(bulletList([
      'Surg 3 and Surg 4 should reach out to the attendings about their scheduled cases beforehand.',
      'The schedule is built the evening before — expect late changes and add-ons.'
    ]));
    host.appendChild(tips);
  }

  /* ------------------------------------------------------------------ */
  /* Library — block schedules & rules                                  */
  /* ------------------------------------------------------------------ */

  function refCard(title) {
    var c = el('div', { class: 'card' });
    c.appendChild(el('h2', { text: title }));
    return c;
  }

  function renderReference() {
    var host = $('referenceBody');
    clearNode(host);
    var d = data();

    if (d.quote) {
      host.appendChild(el('p', { class: 'ref-quote', text: d.quote }));
    }

    // Hierarchy chains
    var hCard = refCard('Case-assignment hierarchy');
    hCard.appendChild(el('p', {
      class: 'field-hint',
      text: 'From “How to Surgical Schedule”, assigned step by step in this order. A case nobody on its chain can take is skipped for now and picked up at Step 10.'
    }));
    var hTbl = el('table', { class: 'tbl' });
    hTbl.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Step' }), el('th', { text: 'Case type' }), el('th', { text: 'Chain' }), el('th', { text: 'Note' })
    ])]));
    var hBody = el('tbody');
    Object.keys(d.hierarchy || {}).forEach(function (key) {
      var h = d.hierarchy[key];
      hBody.appendChild(el('tr', {}, [
        el('td', { text: h.step != null ? String(h.step) : '' }),
        el('td', {}, [el('strong', { text: h.label })]),
        el('td', { text: (h.chain || []).map(function (tok) { return CHAIN_TOKEN_LABELS[tok] || tok; }).join(' → ') }),
        el('td', {}, [
          // the 10/18/2026 rule beside the how-to's note (data.js keeps the doc's words)
          key === 'traumaPlasticsAddOn' && globeRole() ? el('b', { class: 'ref-rule', text: 'A globe: ' + globeRole() + ', always — operating, it follows their cases. ' }) : null,
          el('span', { class: 'field-hint', text: h.note || '' })
        ])
      ]));
    });
    hTbl.appendChild(hBody);
    hCard.appendChild(el('div', { class: 'table-scroll' }, [hTbl]));
    host.appendChild(hCard);

    // Surg roles
    var sCard = refCard('Surg roles');
    var sTbl = el('table', { class: 'tbl' });
    var sBody = el('tbody');
    Object.keys(d.surgRoleMeta || {}).forEach(function (role) {
      sBody.appendChild(el('tr', {}, [
        el('td', {}, [el('strong', { text: role })]),
        el('td', { text: d.surgRoleMeta[role] })
      ]));
    });
    sTbl.appendChild(sBody);
    sCard.appendChild(el('div', { class: 'table-scroll' }, [sTbl]));
    host.appendChild(sCard);

    // Scheduling notes
    var nCard = refCard('Things to keep in mind');
    var ul = el('ul', { class: 'ref-note-list' });
    (d.schedulingNotes || []).forEach(function (n) { ul.appendChild(el('li', { text: n })); });
    nCard.appendChild(ul);
    host.appendChild(nCard);

    // Post-ops
    if ((d.postOpNotes || []).length) {
      var pCard = refCard('Post-ops');
      var pUl = el('ul', { class: 'ref-note-list' });
      d.postOpNotes.forEach(function (n) { pUl.appendChild(el('li', { text: n })); });
      pCard.appendChild(pUl);
      host.appendChild(pCard);
    }

    // Which cases am I actually doing?
    if (d.caseSourcesNote) {
      var csCard = refCard('Finding your case list');
      csCard.appendChild(el('p', { class: 'ref-para', text: d.caseSourcesNote }));
      host.appendChild(csCard);
    }

    // PGY-4 cataract prep checklist
    if ((d.cataractPrep || []).length) {
      var cpCard = refCard('PGY-4 cataract prep checklist');
      var cpUl = el('ul', { class: 'ref-note-list' });
      d.cataractPrep.forEach(function (n) { cpUl.appendChild(el('li', { text: n })); });
      cpCard.appendChild(cpUl);
      host.appendChild(cpCard);
    }

    // Special clinics
    var scCard = refCard('Attending clinic patterns');
    var scTbl = el('table', { class: 'tbl' });
    scTbl.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Clinic' }), el('th', { text: 'Day' }), el('th', { text: 'Session' }), el('th', { text: 'Weeks' })
    ])]));
    var scBody = el('tbody');
    var dayLabel = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
    (d.specialClinics || []).forEach(function (sc) {
      scBody.appendChild(el('tr', {}, [
        el('td', {}, [el('strong', { text: sc.label })]),
        el('td', { text: dayLabel[sc.day] || sc.day }),
        el('td', { text: sc.session === 'all' ? 'AM/PM' : sc.session.toUpperCase() }),
        el('td', { text: (sc.nth || []).map(ordinal).join(', ') })
      ]));
    });
    scTbl.appendChild(scBody);
    scCard.appendChild(el('div', { class: 'table-scroll' }, [scTbl]));
    host.appendChild(scCard);

    // Per-year block grids + block-dates tables
    YEAR_ORDER.forEach(function (yk) {
      var y = d.years[yk];
      if (!y) return;

      var gCard = refCard(y.label + ' — block grid');
      var gTbl = el('table', { class: 'tbl grid-tbl' });
      gTbl.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: 'Block' })].concat(
        dataWeekdays().map(function (wk) { return el('th', { text: dayLabel[wk] || wk }); })
      ))]));
      var gBody = el('tbody');
      Object.keys(y.grid).sort(function (a, b) { return (+a) - (+b); }).forEach(function (block) {
        var cells = [el('td', {}, [el('strong', { text: block }),
          (y.taskmasterBlocks || []).indexOf(+block) !== -1 ? el('span', { class: 'badge badge-tm', text: ' TM' }) : null])];
        dataWeekdays().forEach(function (wk) {
          var cell = y.grid[block][wk] || {};
          cells.push(el('td', {}, [
            el('div', { class: 'g-line' }, [el('span', { class: 'badge badge-am', text: 'AM' }), ' ' + (cell.am || '—')]),
            el('div', { class: 'g-line' }, [el('span', { class: 'badge badge-pm', text: 'PM' }), ' ' + (cell.pm || '—')])
          ]));
        });
        gBody.appendChild(el('tr', {}, cells));
      });
      gTbl.appendChild(gBody);
      gCard.appendChild(el('div', { class: 'table-scroll' }, [gTbl]));
      if ((y.gridNotes || []).length) {
        var gn = el('ul', { class: 'grid-notes' });
        y.gridNotes.forEach(function (n) { gn.appendChild(el('li', { text: n })); });
        gCard.appendChild(gn);
      }
      host.appendChild(gCard);

      var bCard = refCard(y.label + ' — block dates');
      var bTbl = el('table', { class: 'tbl blocks-tbl' });
      bTbl.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: 'Dates' })].concat(
        y.residents.map(function (n) { return el('th', { text: n }); })
      ))]));
      var bBody = el('tbody');
      (y.blockRanges || []).forEach(function (range) {
        var label = fmtMDYY(parseISO(range.start)) + ' – ' + fmtMDYY(parseISO(range.end));
        var cells = [el('td', { text: label })];
        y.residents.forEach(function (n) {
          var block = (range.blocks || {})[n];
          var tm = (y.taskmasterBlocks || []).indexOf(block) !== -1;
          cells.push(el('td', { class: tm ? 'tm' : null, text: block == null ? '—' : String(block) }));
        });
        bBody.appendChild(el('tr', {}, cells));
      });
      bTbl.appendChild(bBody);
      bCard.appendChild(el('div', { class: 'table-scroll' }, [bTbl]));
      host.appendChild(bCard);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Setup / new-year import-export (UISPEC5 §E)                         */
  /* ------------------------------------------------------------------ */

  // Minimal validation for an uploaded configuration object. Returns an
  // error string, or null when the object is usable.
  function validateConfig(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'not a JSON object';
    if (typeof obj.ayStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.ayStart)) {
      return 'missing or invalid ayStart (want YYYY-MM-DD)';
    }
    if (typeof obj.ayEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.ayEnd)) {
      return 'missing or invalid ayEnd (want YYYY-MM-DD)';
    }
    if (!obj.years || typeof obj.years !== 'object') return 'missing years';
    var yks = ['pgy2', 'pgy3', 'pgy4'];
    for (var i = 0; i < yks.length; i++) {
      var y = obj.years[yks[i]];
      if (!y || typeof y !== 'object') return 'missing years.' + yks[i];
      if (!Array.isArray(y.residents)) return 'years.' + yks[i] + '.residents must be an array';
      if (!Array.isArray(y.blockRanges)) return 'years.' + yks[i] + '.blockRanges must be an array';
      if (!y.grid || typeof y.grid !== 'object') return 'missing years.' + yks[i] + '.grid';
      // The renderers/engine dereference every grid row (grid[block][wk]) —
      // a null/non-object row would crash them AFTER validation passed.
      var blocks = Object.keys(y.grid);
      for (var b = 0; b < blocks.length; b++) {
        var row = y.grid[blocks[b]];
        if (!row || typeof row !== 'object') {
          return 'years.' + yks[i] + '.grid["' + blocks[b] + '"] must be an object of weekday cells';
        }
      }
    }
    // Optional sections that the renderers dereference when present.
    if (obj.specialClinics != null) {
      if (!Array.isArray(obj.specialClinics)) return 'specialClinics must be an array';
      for (var s = 0; s < obj.specialClinics.length; s++) {
        var sc = obj.specialClinics[s];
        if (!sc || typeof sc !== 'object' || typeof sc.session !== 'string') {
          return 'specialClinics[' + s + '] needs a session string (\'am\'/\'pm\'/\'all\')';
        }
        if (sc.nth != null && !Array.isArray(sc.nth)) {
          return 'specialClinics[' + s + '].nth must be an array of week numbers';
        }
      }
    }
    return null;
  }

  // Boot-time: apply a stored override BEFORE any render. A corrupt or
  // invalid override must never brick the app — ignore it (with a warning).
  function applyStoredOverrideAtBoot() {
    var raw = lsGet(DATA_OVERRIDE_KEY);
    if (!raw) return;
    try {
      var obj = JSON.parse(raw);
      var err = validateConfig(obj);
      if (err) throw new Error(err);
      window.SCHED_DATA = obj;
      usingOverride = true;
      overrideBootError = null;
    } catch (e) {
      overrideBootError = (e && e.message) || String(e);
      if (window.console) {
        console.warn('Stored configuration override ignored: ' + overrideBootError);
      }
    }
  }

  // After the active data object changes at runtime, EVERYTHING derived from
  // it must be rebuilt — including the static tabs (reference/howto/cpec),
  // the header ayLabel, and the date pickers' min/max.
  function rerenderEverything() {
    residentYearMap = null; // yearOf() caches resident→year from the old data
    surg2Cache = {};        // …and the daytime add-on call, each day's Surg 2
    var d = data();
    [$('datePicker'), $('homeDate')].forEach(function (inp) {
      if (inp && d.ayStart && d.ayEnd) {
        inp.min = d.ayStart;
        inp.max = d.ayEnd;
      }
    });
    computeRoster();
    renderHeader();
    renderReference();
    renderHowto();
    renderFlow();
    renderCpecReference();
    renderRosterTab();
    renderOutTab();
    renderSurgeryTab();
    renderClinicsTab();
    renderCoverageTab();
    renderPreview();
    renderAvailStrip();
    renderBadges();
    renderHome();
    renderSetup();
  }

  function importConfigText(text) {
    var obj;
    try {
      obj = JSON.parse(String(text));
    } catch (e) {
      toast('Not valid JSON — ' + ((e && e.message) || e), false);
      return false;
    }
    var err = validateConfig(obj);
    if (err) {
      toast('Configuration rejected — ' + err, false);
      return false;
    }
    // Trial-render BEFORE persisting: a config that passes the minimal
    // validation can still crash a renderer, and a stored crasher would
    // re-break every subsequent boot (with Setup — the only in-app way to
    // remove it — unreachable). Persist only after a full successful render;
    // on a throw, revert to the previous data and repair the DOM with it.
    var prevData = window.SCHED_DATA;
    var prevUsing = usingOverride;
    window.SCHED_DATA = obj;
    usingOverride = true;
    try {
      rerenderEverything();
    } catch (e2) {
      window.SCHED_DATA = prevData;
      usingOverride = prevUsing;
      try { rerenderEverything(); } catch (e3) { }
      if (window.console) console.error('Imported configuration crashed rendering — not stored', e2);
      toast('Configuration rejected — it breaks the app (' + ((e2 && e2.message) || e2) + '). Nothing was stored.', false);
      return false;
    }
    lsSet(DATA_OVERRIDE_KEY, JSON.stringify(obj));
    overrideBootError = null;
    renderSetup(); // the status card may still show a stale failed-load notice
    toast('Configuration imported — now using ' + (obj.ayLabel || 'the uploaded data') + ' (this browser only)');
    return true;
  }

  function removeOverride() {
    lsRemove(DATA_OVERRIDE_KEY);
    window.SCHED_DATA = BUILTIN_DATA;
    usingOverride = false;
    overrideBootError = null;
    rerenderEverything();
    toast('Imported configuration removed — back to the built-in ' + (BUILTIN_DATA && BUILTIN_DATA.ayLabel || 'data'));
  }

  function downloadConfig() {
    try {
      var json = JSON.stringify(data(), null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: 'surg-schedule-config.json' });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Downloaded surg-schedule-config.json');
    } catch (e) {
      toast('Download failed — ' + ((e && e.message) || e), false);
    }
  }

  function deleteAllSavedDays() {
    var keys = lsKeys().filter(function (k) { return k.indexOf(LS_PREFIX) === 0; });
    if (!keys.length) {
      toast('No saved schedule days in this browser', false);
      return;
    }
    if (!window.confirm('Delete all ' + keys.length + ' saved schedule day(s) from this browser? This cannot be undone.')) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    keys.forEach(lsRemove);
    App.state = defaultState(App.state.date);
    stateDirty = false; // fresh defaults — don't resurrect a key on next save
    unsaved = false;
    syncConflict = false;
    hideSyncBanner();
    computeRoster();
    renderAll();
    renderHome();
    renderSetup();
    toast('Deleted ' + keys.length + ' saved day(s) — the app starts fresh');
  }

  function renderSetup() {
    var host = $('setupBody');
    if (!host) return;
    clearNode(host);
    var d = data();

    // 1. How it works
    var intro = refCard('Set up a new academic year');
    intro.appendChild(el('p', {
      class: 'ref-para',
      text: 'Download the configuration, edit it for the new year, upload it back. It stays in this browser.'
    }));
    host.appendChild(intro);

    // 2. Download
    var dl = refCard('Download current configuration');
    dl.appendChild(el('button', {
      type: 'button', class: 'btn btn-primary', text: 'Download configuration (JSON)',
      onclick: downloadConfig
    }));
    host.appendChild(dl);

    // 3. Upload (file input + paste alternative)
    var up = refCard('Upload configuration');
    var fileIn = el('input', { type: 'file', accept: '.json,application/json' });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      if (typeof FileReader === 'undefined') {
        toast('This browser cannot read files — paste the JSON instead', false);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        importConfigText(reader.result);
        fileIn.value = '';
      };
      reader.onerror = function () { toast('Could not read the file', false); };
      reader.readAsText(f);
    });
    up.appendChild(labeledField('Configuration file', fileIn));
    var ta = el('textarea', { rows: '6', class: 'setup-paste', placeholder: '…or paste the configuration JSON here' });
    up.appendChild(labeledField('Paste JSON', ta));
    up.appendChild(el('button', {
      type: 'button', class: 'btn', text: 'Apply pasted JSON',
      onclick: function () {
        if (!trim(ta.value)) {
          toast('Paste the configuration JSON first', false);
          return;
        }
        importConfigText(ta.value);
      }
    }));
    host.appendChild(up);

    // 4. Active configuration status
    var status = refCard('Active configuration');
    var line = el('div', { class: 'setup-status' });
    line.appendChild(el('span', {
      class: 'chip ' + (usingOverride ? 'chip-special' : 'chip-day'),
      text: usingOverride
        ? 'Imported (' + (d.ayLabel || 'no ayLabel') + ') — stored in this browser'
        : 'Built-in ' + (d.ayLabel || '')
    }));
    if (usingOverride) {
      line.appendChild(el('button', {
        type: 'button', class: 'btn btn-small', text: 'Remove imported configuration',
        onclick: removeOverride
      }));
    }
    status.appendChild(line);
    // A stored override that failed to load at boot (corrupt JSON, failed
    // validation, or a render crash) is otherwise invisible: the status says
    // "Built-in" while the dead blob persists and re-warns on every boot.
    // Surface it here with the only in-app way to remove it.
    if (!usingOverride && lsGet(DATA_OVERRIDE_KEY) != null) {
      status.appendChild(el('p', {
        class: 'field-hint setup-hint',
        text: 'A stored configuration could not be loaded' +
          (overrideBootError ? ' — ' + overrideBootError : '') +
          '. The built-in data is in use; remove the stored copy or upload a fixed file above.'
      }));
      status.appendChild(el('button', {
        type: 'button', class: 'btn btn-small', text: 'Remove stored configuration',
        onclick: removeOverride
      }));
    }
    host.appendChild(status);

    // 5. Danger zone — hand the app to the next class fresh
    var dz = refCard('Danger zone');
    dz.classList.add('danger-zone');
    var nDays = savedDayISOs().length;
    dz.appendChild(el('p', {
      class: 'field-hint setup-hint',
      text: nDays + ' saved schedule day(s) in this browser. Delete them all to hand the app to the next class fresh — the configuration above is untouched.'
    }));
    dz.appendChild(el('button', {
      type: 'button', class: 'btn btn-danger', text: 'Delete all saved schedule days',
      onclick: deleteAllSavedDays
    }));
    host.appendChild(dz);
  }

  /* ------------------------------------------------------------------ */
  /* header actions                                                      */
  /* ------------------------------------------------------------------ */

  function setDate(dateISO) {
    var dp = $('datePicker');
    if (dp && dp.value !== dateISO) dp.value = dateISO; // header shows the day being edited
    saveNow(); // flush pending edits for the old date
    App.state = loadState(dateISO);
    stateDirty = false;   // freshly loaded — nothing user-edited yet
    unsaved = false;
    saveFailed = false;
    syncConflict = false;
    hideSyncBanner();
    refreshAddOnsForDate(); // untouched add-on rows follow the schedule date
    coverageTime = null;
    coverageFollowNow = true;
    planItems = [];
    addOnOther = {};
    computeRoster();
    renderAll();
    renderSaveState();
    // Changing the date inside the app: the URL follows (so a reload or a
    // restored tab reopens this day) and so does "where you left off".
    if (!document.body.classList.contains('home-active') && App.currentRoute && App.currentRoute !== 'home') {
      syncHash(App.currentRoute, true);
    }
    rememberPlace();
  }

  function rememberPlace() {
    if (!App.state || document.body.classList.contains('home-active')) return;
    if (WORKFLOW_TABS.indexOf(App.activeTab) === -1) return;
    lsSet(LAST_KEY, JSON.stringify({ date: App.state.date, tab: App.activeTab, at: Date.now() }));
  }

  /* Two tabs (or windows) of this app in the SAME browser share storage.
     When another one saves the day open here, take its version — so a tab
     left open never later writes an old copy over newer work. If this tab
     has unsaved edits too, stop and ask which version to keep. */
  function onStorage(e) {
    if (e.storageArea && e.storageArea !== window.localStorage) return;
    var key = e.key;
    if (key !== null && key.indexOf(LS_PREFIX) !== 0) return;
    if (document.body.classList.contains('home-active')) {
      updateHomeCreate();
      renderHomeRecent();
      renderHomeResume();
      return;
    }
    if (!App.state || (key !== null && key !== LS_PREFIX + App.state.date)) return;
    if (unsaved) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      showSyncConflict();
      return;
    }
    takeStoredDay('Updated — this day was changed in another tab or window');
  }

  function takeStoredDay(msg) {
    App.state = loadState(App.state.date);
    stateDirty = false;
    unsaved = false;
    syncConflict = false;
    hideSyncBanner();
    computeRoster();
    renderAll();
    renderSaveState();
    if (msg) toast(msg);
  }

  function showSyncConflict() {
    syncConflict = true;
    var bn = $('syncBanner');
    if (bn) {
      clearNode(bn);
      bn.appendChild(el('span', { class: 'sync-text', text: 'This day was also changed in another tab or window, and your latest edits here are not saved yet.' }));
      bn.appendChild(el('button', {
        type: 'button', class: 'btn btn-small btn-primary', text: 'Keep mine',
        onclick: function () { syncConflict = false; hideSyncBanner(); unsaved = true; stateDirty = true; saveNow(); toast('Saved your version'); }
      }));
      bn.appendChild(el('button', {
        type: 'button', class: 'btn btn-small', text: 'Use the other version',
        onclick: function () { takeStoredDay('Loaded the version from the other tab'); }
      }));
      bn.classList.remove('hidden');
    }
    renderSaveState();
  }

  function hideSyncBanner() {
    var bn = $('syncBanner');
    if (bn) { bn.classList.add('hidden'); clearNode(bn); }
  }

  function startFromYesterday() {
    var dates = lsKeys()
      .filter(function (k) { return k.indexOf(LS_PREFIX) === 0; })
      .map(function (k) { return k.slice(LS_PREFIX.length); })
      .filter(function (dd) { return /^\d{4}-\d{2}-\d{2}$/.test(dd) && dd < App.state.date; })
      .sort();
    if (!dates.length) {
      toast('No earlier saved day to copy from', false);
      return;
    }
    var src = dates[dates.length - 1];
    var raw = lsGet(LS_PREFIX + src);
    var prev = null;
    try { prev = raw ? JSON.parse(raw) : null; } catch (e) { }
    if (!prev) {
      toast('Could not read the saved day ' + src, false);
      return;
    }
    // Night Float rotates weekly (Sun–Thu). Blindly copying yesterday's value
    // across the rotation boundary would install LAST week's resident (e.g.
    // copy Fri 7/24 'Perez' onto Mon 7/27 when the call schedule says
    // 'Camacho'). When the call schedule knows both days and the week rolled
    // over in between, take the current week's name; otherwise copy as before
    // (preserving intentional within-week swaps).
    var prevNF = String(prev.nightFloat || '');
    var curRosterNF = (App.roster && App.roster.nightFloat) ? String(App.roster.nightFloat) : '';
    var srcRosterNF = '';
    try {
      if (curRosterNF && window.Engine && window.Engine.resolveDay) {
        var srcRoster = window.Engine.resolveDay(src, data());
        srcRosterNF = (srcRoster && srcRoster.nightFloat) ? String(srcRoster.nightFloat) : '';
      }
    } catch (e2) { }
    if (curRosterNF && srcRosterNF !== curRosterNF) {
      App.state.nightFloat = curRosterNF;
      App.state.nfCleared = false;
    } else {
      App.state.nightFloat = prevNF;
      App.state.nfCleared = !!prev.nfCleared;
    }
    App.state.vacation = String(prev.vacation || '');
    // Vacations usually run several days — carry who is out, but not who
    // covers: the covering picks depend on that weekday's assignments.
    var carried = Array.isArray(prev.absences) ? prev.absences.map(normAbsence).filter(function (a) { return !!a; }) : [];
    carried.forEach(function (a) { a.coverAM = ''; a.coverPM = ''; });
    App.state.absences = carried;
    App.state.outConfirmed = !carried.length && !!prev.outConfirmed;
    App.state.lectures = String(prev.lectures || '');
    // Carry over who is on call by date + period: yesterday's "Tuesday
    // daytime (10/20)" row is today's "Tuesday daytime (10/20)" row. (It used
    // to copy row by row, which put Monday night's name on Tuesday night and
    // Tuesday daytime's on Wednesday.) Rows still to come that the user added
    // come along; past ones do not. Empty daytime rows refill with Surg 2.
    var fresh = defaultAddOns(App.state.date);
    var prevRows = (Array.isArray(prev.addOns) ? prev.addOns : []).filter(function (a) {
      return a && /^\d{4}-\d{2}-\d{2}$/.test(String(a.date)) && trim(a.name);
    });
    var used = [];
    fresh.forEach(function (row) {
      var m = prevRows.filter(function (a) {
        return used.indexOf(a) === -1 && a.date === row.date && (a.period === 'day' ? 'day' : 'night') === row.period;
      })[0];
      if (!m) return;
      used.push(m);
      row.name = trim(m.name);
      row.auto = false;
      if (typeof m.s2 === 'boolean') row.s2 = m.s2;
    });
    prevRows.forEach(function (a) {
      if (used.indexOf(a) !== -1 || a.date < App.state.date) return;
      fresh.push({ date: a.date, period: a.period === 'day' ? 'day' : 'night', label: '', name: trim(a.name), auto: false, s2: false });
    });
    App.state.addOns = fresh;
    prefillAddOns();
    syncAddOnLabels();
    stateDirty = true; // explicit user action — this day now really has content
    unsaved = true;
    saveNow();
    renderAll();
    toast('Copied night float, who’s out, lectures & add-ons from ' + src + (App.state.absences.length ? ' — pick today’s coverers on Out today' : ''));
  }

  function clearDay() {
    if (!window.confirm('Clear everything saved for ' + App.state.date + '? This cannot be undone.')) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    lsRemove(LS_PREFIX + App.state.date);
    App.state = defaultState(App.state.date);
    stateDirty = false; // back to untouched — don't resurrect the key on next save
    unsaved = false;
    syncConflict = false;
    hideSyncBanner();
    computeRoster(); // re-prefill Night Float / buddies and rebuild the board
    renderAll();
    renderSaveState();
    toast('Cleared ' + App.state.date);
  }

  /* ------------------------------------------------------------------ */
  /* Home landing view                                                   */
  /* ------------------------------------------------------------------ */

  function savedDayISOs() {
    return lsKeys()
      .filter(function (k) { return k.indexOf(LS_PREFIX) === 0; })
      .map(function (k) { return k.slice(LS_PREFIX.length); })
      .filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); })
      .sort();
  }

  // The landing page: what it is for, the date picker with quick dates, a live
  // preview of the chosen day (straight from the block schedule, plus the
  // saved draft's progress), the six steps, and recent days.

  function isoPlus(iso, n) {
    var d = parseISO(iso);
    return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }

  function relDayLabel(iso) {
    var today = isoOf(new Date());
    if (iso === today) return 'Today';
    if (iso === isoPlus(today, 1)) return 'Tomorrow';
    if (iso === isoPlus(today, -1)) return 'Yesterday';
    return iso < today ? 'Past day' : 'Coming up';
  }

  // What a saved day already holds — for the preview and the recent cards.
  function draftSummary(iso) {
    var raw = lsGet(LS_PREFIX + iso);
    if (!raw) return null;
    var st;
    try { st = JSON.parse(raw); } catch (e) { return null; }
    var cases = Array.isArray(st.cases) ? st.cases : [];
    // as the Surgery tab counts them: a service case with nobody on it, or
    // whose resident is out while it runs (Out today, or Night Float)
    function outFor(c) {
      var a = trim(c.assigned);
      if (!a || c.done || !window.Status || !window.Assign) return false;
      if (a === trim(st.nightFloat)) return true;
      var abs = (Array.isArray(st.absences) ? st.absences : []).filter(function (x) { return x && trim(x.name) === a; })[0];
      if (!abs) return false;
      var sess = window.Assign.sessionsOfSpans(window.Status.caseSpans(c, data()).spans);
      return sess.some(function (s) { return !!abs[s]; });
    }
    var open = cases.filter(function (c) {
      return c && (parseInt(c.serviceCount, 10) || 0) > 0 && (!trim(c.assigned) || outFor(c));
    }).length;
    var out = (Array.isArray(st.absences) ? st.absences : []).filter(function (a) { return a && trim(a.name); }).length;
    return { cases: cases.length, open: open, out: out, noneOut: !!st.outConfirmed };
  }

  function draftText(s) {
    if (!s) return '';
    var bits = [];
    bits.push(s.cases ? s.cases + ' case' + (s.cases === 1 ? '' : 's') : 'no cases yet');
    if (s.open) bits.push(s.open + ' need' + (s.open === 1 ? 's' : '') + ' a resident');
    if (s.out) bits.push(s.out + ' out');
    else if (s.noneOut) bits.push('no one out');
    return bits.join(' · ');
  }

  var irisBuilt = false;
  function buildIris() {
    var svg = $('homeIris');
    if (!svg || irisBuilt || !document.createElementNS) return;
    irisBuilt = true;
    var NS = 'http://www.w3.org/2000/svg';
    function mk(tag, attrs) {
      var n = document.createElementNS(NS, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
      return n;
    }
    mk('circle', { cx: 0, cy: 0, r: 122, fill: 'none', stroke: 'rgba(255,255,255,0.10)', 'stroke-width': 1 });
    mk('circle', { cx: 0, cy: 0, r: 102, fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.32)', 'stroke-width': 2 });
    // iris fibres — deterministic jitter so the drawing never changes
    for (var i = 0; i < 108; i++) {
      var a = i / 108 * Math.PI * 2;
      var wob = Math.sin(i * 12.9898) * 0.06;
      var r0 = 38 + (i % 3) * 2;
      var r1 = 95 - (i % 5) * 5;
      mk('line', {
        x1: (Math.cos(a) * r0).toFixed(1), y1: (Math.sin(a) * r0).toFixed(1),
        x2: (Math.cos(a + wob) * r1).toFixed(1), y2: (Math.sin(a + wob) * r1).toFixed(1),
        stroke: 'rgba(255,255,255,' + (0.10 + (i % 4) * 0.05).toFixed(2) + ')',
        'stroke-width': 1.2, 'stroke-linecap': 'round'
      });
    }
    mk('circle', { cx: 0, cy: 0, r: 60, fill: 'none', stroke: 'rgba(255,255,255,0.24)', 'stroke-width': 1.5, 'stroke-dasharray': '3 5' });
    mk('circle', { cx: 0, cy: 0, r: 34, fill: 'rgba(5,28,50,0.62)' });
    mk('circle', { cx: -12, cy: -14, r: 9, fill: 'rgba(255,255,255,0.6)' });
    mk('circle', { cx: 9, cy: 10, r: 3, fill: 'rgba(255,255,255,0.35)' });
  }

  // Today / Tomorrow / (next weekday when tomorrow is a weekend)
  function renderHomeQuick() {
    var host = $('homeQuick');
    var hd = $('homeDate');
    if (!host || !hd) return;
    clearNode(host);
    var today = isoOf(new Date());
    var opts = [[today, 'Today'], [isoPlus(today, 1), 'Tomorrow']];
    var t1 = parseISO(opts[1][0]);
    if (t1.getDay() === 0 || t1.getDay() === 6) {
      var next = isoOf(nextCoverageDay(parseISO(today)));
      opts.push([next, weekdayName(parseISO(next))]);
    }
    opts.forEach(function (o) {
      host.appendChild(el('button', {
        type: 'button', class: 'quick-chip' + (hd.value === o[0] ? ' on' : ''), text: o[1],
        'aria-pressed': hd.value === o[0] ? 'true' : 'false',
        onclick: function () { hd.value = o[0]; updateHomeCreate(); }
      }));
    });
  }

  function renderHomePreview(iso) {
    var host = $('homePreview');
    if (!host) return;
    clearNode(host);
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    var d = parseISO(iso);
    var r = null;
    try { r = window.Engine.resolveDay(iso, data()); } catch (e) { r = null; }
    var head = el('div', { class: 'pv-head' }, [
      el('span', { class: 'pv-when', text: relDayLabel(iso) }),
      el('span', { class: 'pv-date', text: weekdayName(d) + ' ' + fmtMDYY(d) })
    ]);
    if (r && r.inYear && !r.isWeekend) head.appendChild(chipEl(ordinal(r.nth) + ' ' + r.weekdayLabel, 'chip-day'));
    host.appendChild(head);

    if (!r || r.isWeekend) {
      host.appendChild(el('p', { class: 'pv-empty', text: 'Weekend — no block assignments. Pick a weekday to build a schedule.' }));
      return;
    }
    if (!r.inYear) {
      host.appendChild(el('p', { class: 'pv-empty', text: 'Outside ' + (data().ayLabel || 'the academic year') + ' — no block schedule for this date.' }));
      return;
    }

    var saved = null;
    try { saved = JSON.parse(lsGet(LS_PREFIX + iso) || 'null'); } catch (e) { saved = null; }
    var outs = ((saved && saved.absences) || []).filter(function (a) { return a && trim(a.name); })
      .map(function (a) { return trim(a.name); });

    var grid = el('div', { class: 'pv-surg' });
    ['1', '2', '3', '4', '5'].forEach(function (n) {
      var s = r.surg[n];
      var isOut = s && outs.indexOf(s.name) !== -1;
      var ab = isOut ? ((saved && saved.absences) || []).filter(function (a) { return a && trim(a.name) === s.name; })[0] || {} : {};
      // who covers takes the role (Out today): named, when it is one person
      var cov = ab.am && ab.pm && trim(ab.coverAM) === trim(ab.coverPM) ? trim(ab.coverAM) : '';
      var tone = !isOut ? '' : !cov ? ' pv-tbd' : cov === 'NC' ? ' pv-nc' : '';
      var tile = el('div', { class: 'pv-tile' + tone }, [
        el('div', { class: 'pv-role', text: 'Surg ' + n }),
        el('div', { class: 'pv-name', text: s ? (isOut && cov && cov !== 'NC' ? cov : s.name) : '—', title: s ? s.name : '' })
      ]);
      if (isOut) tile.appendChild(el('div', { class: 'pv-tag', text: cov && cov !== 'NC' ? 'for ' + s.name : (ab.am && !ab.pm ? s.name + ' out AM' : !ab.am && ab.pm ? s.name + ' out PM' : s.name + ' out' + (cov === 'NC' ? ' — NC' : '')) }));
      grid.appendChild(tile);
    });
    host.appendChild(grid);

    var facts = el('div', { class: 'pv-facts' });
    function fact(k, v) { facts.appendChild(el('span', { class: 'pv-fact' }, [el('span', { class: 'k', text: k }), el('b', { text: v })])); }
    // a Night Float blanked on purpose stays blank (nfCleared)
    fact('Night Float', saved && saved.nfCleared ? '—' : (trim(saved && saved.nightFloat) || r.nightFloat || '—'));
    if ((r.dayFloat || []).length) fact('Day Float', r.dayFloat.join(', '));
    if (r.cooperSenior) fact('Cooper', r.cooperSenior);
    var cpec = null;
    try { cpec = window.Engine.cpecForDate(iso, data()); } catch (e) { cpec = null; }
    var lists = ((cpec && cpec.entries) || []);
    if (lists.length) {
      var svc = lists.filter(function (e) { return !e.privateOnly && e.cover; }).length;
      fact('CPEC sheet', svc + ' list' + (svc === 1 ? '' : 's') + ' + ' + (lists.length - svc) + ' private');
    }
    host.appendChild(facts);

    var chips = el('div', { class: 'pv-chips' });
    (r.specialClinicsToday || []).forEach(function (sc) {
      chips.appendChild(chipEl(sc, /bilyk|sergott/i.test(sc) ? 'chip-dress' : 'chip-special'));
    });
    if ((r.specialClinicsToday || []).some(function (sc) { return /bilyk|sergott/i.test(sc); })) {
      chips.appendChild(chipEl('business casual + white coat', 'chip-dress'));
    }
    if (chips.firstChild) host.appendChild(chips);

    var sum = draftSummary(iso);
    var dr = el('div', { class: 'pv-draft' });
    if (sum) {
      dr.appendChild(el('b', { text: 'Saved draft' }));
      dr.appendChild(document.createTextNode(draftText(sum)));
      if (!sum.open && sum.cases) dr.appendChild(el('span', { class: 'pv-pill ok', text: 'all assigned' }));
    } else {
      dr.appendChild(document.createTextNode('Not started.'));
    }
    host.appendChild(dr);
  }

  var HOME_STEPS = [
    { tab: 'out', title: 'Out today', text: 'Who’s out, who covers',
      icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    { tab: 'roster', title: 'Roster', text: 'Surg 1–5, consults, NF',
      icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { tab: 'surgery', title: 'Surgery', text: 'Cases + the resident on each',
      icon: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>' },
    { tab: 'clinics', title: 'Clinics', text: 'Counts, and who covers',
      icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>' },
    { tab: 'coverage', title: 'Coverage', text: 'Who’s free, globe plan',
      icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    { tab: 'preview', title: 'Preview & Copy', text: 'The schedule, formatted',
      icon: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' }
  ];

  function renderHomeSteps() {
    var host = $('homeSteps');
    if (!host || host.firstChild) return; // static — built once
    HOME_STEPS.forEach(function (s, i) {
      var icon = el('span', { class: 'step-icon', 'aria-hidden': 'true' });
      icon.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + s.icon + '</svg>';
      host.appendChild(el('li', {}, [el('button', {
        type: 'button', class: 'step-btn', title: 'Open step ' + (i + 1) + ' for the chosen date',
        onclick: function () { var hd = $('homeDate'); enterApp((hd && hd.value) || tomorrowISO(), s.tab); }
      }, [
        icon,
        el('span', { class: 'step-num', text: 'Step ' + (i + 1) }),
        el('span', { class: 'step-title', text: s.title }),
        el('span', { class: 'step-text', text: s.text })
      ])]));
    });
  }

  // "Pick up where you left off": the day and step this browser was last on,
  // when that day has a saved draft (closing the tab loses nothing).
  function lastPlace() {
    var last = null;
    try { last = JSON.parse(lsGet(LAST_KEY) || 'null'); } catch (e) { last = null; }
    if (!last || !/^\d{4}-\d{2}-\d{2}$/.test(String(last.date)) || WORKFLOW_TABS.indexOf(last.tab) === -1) return null;
    return last;
  }

  // The card shows only for a day other than the one picked below — for the
  // picked day the big button already continues it (on the step you left).
  function renderHomeResume() {
    var btn = $('homeResume');
    if (!btn) return;
    var last = lastPlace();
    var hd = $('homeDate');
    var raw = last ? lsGet(LS_PREFIX + last.date) : null;
    var recent = last && typeof last.at === 'number' && Date.now() - last.at < 7 * 86400000;
    var ok = !!(raw && recent && !(hd && hd.value === last.date));
    btn.classList.toggle('hidden', !ok);
    clearNode(btn);
    btn.onclick = null;
    if (!ok) return;
    var savedAt = 0;
    try { savedAt = JSON.parse(raw).savedAt || 0; } catch (e) { savedAt = 0; }
    var d = parseISO(last.date);
    btn.appendChild(el('span', { class: 'resume-k', text: '↩ Pick up where you left off' }));
    btn.appendChild(el('b', { class: 'resume-what', text: weekdayName(d) + ' ' + fmtMDYY(d) + ' · ' + TAB_TITLES[last.tab] }));
    var sub = [draftText(draftSummary(last.date)), savedAt ? 'saved ' + savedWhen(savedAt) : ''].filter(Boolean).join(' · ');
    if (sub) btn.appendChild(el('span', { class: 'resume-sub', text: sub }));
    btn.onclick = function () { enterApp(last.date, last.tab); };
  }

  function renderHomeRecent() {
    var host = $('homeRecent');
    if (!host) return;
    clearNode(host);
    var dates = savedDayISOs().reverse().slice(0, 4);
    if (!dates.length) {
      host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
    host.appendChild(el('div', { class: 'home-recent-label', text: 'Recent days' }));
    var grid = el('div', { class: 'recent-grid' });
    dates.forEach(function (dISO) {
      var d = parseISO(dISO);
      grid.appendChild(el('button', {
        type: 'button', class: 'recent-card',
        onclick: function () { var l = lastPlace(); enterApp(dISO, l && l.date === dISO ? l.tab : undefined); }
      }, [
        el('b', { text: WEEKDAY_NAMES[d.getDay()].slice(0, 3) + ' ' + fmtMDYY(d) }),
        el('span', { text: draftText(draftSummary(dISO)) || 'saved' })
      ]));
    });
    host.appendChild(grid);
  }

  // Big button + preview follow the chosen date: 'Start Monday 9/28/26 →',
  // or 'Continue Monday 9/28/26 →' when a draft exists for it.
  function updateHomeCreate() {
    var hd = $('homeDate');
    var btn = $('btnHomeCreate');
    var hint = $('homeDraftHint');
    if (!hd || !btn) return;
    var v = hd.value;
    var valid = /^\d{4}-\d{2}-\d{2}$/.test(v);
    var raw = valid ? lsGet(LS_PREFIX + v) : null;
    var hasDraft = !!raw;
    var label = valid ? weekdayName(parseISO(v)) + ' ' + fmtMDYY(parseISO(v)) : '';
    btn.textContent = !valid ? 'Create Surg Schedule →' : (hasDraft ? 'Continue ' : 'Start ') + label + ' →';
    if (hint) {
      var last = lastPlace();
      var savedAt = 0;
      try { savedAt = (raw && JSON.parse(raw).savedAt) || 0; } catch (e) { savedAt = 0; }
      var bits = [last && last.date === v ? 'Saved draft — reopens on ' + TAB_TITLES[last.tab] : 'Saved draft'];
      if (savedAt) bits.push('saved ' + savedWhen(savedAt));
      hint.textContent = hasDraft ? bits.join(' · ') : '';
      hint.classList.toggle('hidden', !hasDraft);
    }
    renderHomeResume();
    renderHomeQuick();
    renderHomePreview(valid ? v : '');
  }

  function renderHome() {
    var hd = $('homeDate');
    if (hd && !hd.value) hd.value = tomorrowISO();
    var ay = $('homeAy');
    if (ay) ay.textContent = (data().ayLabel || '') + ' · ' + APP_VERSION + ' · build ' + BUILD + ' (' + BUILD_DATE + ')';
    var q = $('homeQuote');
    if (q) q.textContent = data().quote || '';
    buildIris();
    renderHomeSteps();
    updateHomeCreate();
    renderHomeRecent();
    renderHomeResume();
  }

  function enterApp(dateISO, tab) {
    var dp = $('datePicker');
    if (dp) dp.value = dateISO;
    document.body.classList.remove('home-active');
    setDate(dateISO);
    // Step 1 of the how-to is vacation coverage — start there.
    setTab(tab || 'out');
    if (!tab) {
      toast('Schedule for ' + App.roster.weekdayLabel + ' ' + fmtMDYY(parseISO(dateISO)) + ' — start with who’s out');
    }
  }

  // Brand click in the header — back to Home. Nothing is lost: state saved.
  function goHome() {
    saveNow();
    var hd = $('homeDate');
    if (hd && App.state) hd.value = App.state.date;
    document.body.classList.add('home-active');
    renderHome();
    syncHash('home');
  }

  /* ------------------------------------------------------------------ */
  /* hash routing — every view is a history entry so the browser Back    */
  /* button walks Home ↔ tabs instead of leaving the site               */
  /* ------------------------------------------------------------------ */

  var VALID_ROUTES = ['home', 'out', 'roster', 'surgery', 'clinics', 'coverage', 'preview', 'import', 'howto', 'flow', 'cpec', 'reference', 'setup'];
  // Links saved before the Surgery/Clinics split keep working.
  var ROUTE_ALIASES = { cases: 'surgery', assign: 'surgery' };

  function routeFromHash() {
    var h = String(window.location.hash || '').replace(/^#\/?/, '').split('/')[0];
    if (ROUTE_ALIASES[h]) h = ROUTE_ALIASES[h];
    return VALID_ROUTES.indexOf(h) !== -1 ? h : null;
  }

  // #/surgery/2026-09-28 — the day rides in the URL so a reload, a restored
  // tab or a phone reopening a tab lands on the same day and step.
  function dateFromHash() {
    var d = String(window.location.hash || '').replace(/^#\/?/, '').split('/')[1] || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && isoOf(parseISO(d)) === d ? d : null;
  }

  // Record the applied route and mirror it into the URL. Writing
  // location.hash pushes a history entry; when the change came FROM the
  // hash (Back/Forward), the hash already matches and nothing is written.
  function syncHash(route, replace) {
    App.currentRoute = route;
    var target = '#/' + route + (route !== 'home' && App.state ? '/' + App.state.date : '');
    if (window.location.hash === target) return;
    try {
      if (replace && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', target);
      } else {
        window.location.hash = target;
      }
    } catch (e) { /* very old browsers / exotic file:// — routing stays internal */ }
  }

  function onHashChange() {
    var route = routeFromHash();
    var day = dateFromHash();
    if (!route) return;
    var sameDay = !day || (App.state && day === App.state.date);
    if (route === App.currentRoute && sameDay) return;
    if (route === 'home') {
      goHome();
    } else if (document.body.classList.contains('home-active')) {
      // Deep link / Forward into a tab while sitting on Home.
      var hd = $('homeDate');
      enterApp(day || (hd && hd.value) || tomorrowISO(), route);
    } else {
      if (!sameDay) setDate(day);
      setTab(route);
    }
  }

  /* ------------------------------------------------------------------ */
  /* tabs + boot                                                         */
  /* ------------------------------------------------------------------ */

  function setTab(tab) {
    if (ROUTE_ALIASES[tab]) tab = ROUTE_ALIASES[tab];
    App.activeTab = tab;
    var tabs = document.querySelectorAll('.tabbar .tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-tab') === tab;
      tabs[i].classList.toggle('active', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        // phones: the tab bar scrolls sideways — bring the active tab into view
        var bar = tabs[i].parentNode;
        if (bar && bar.scrollWidth > bar.clientWidth) {
          bar.scrollLeft = Math.max(0, tabs[i].offsetLeft - (bar.clientWidth - tabs[i].offsetWidth) / 2);
        }
      }
    }
    var lib = $('libMenu');
    if (lib) {
      lib.classList.toggle('active', WORKFLOW_TABS.indexOf(tab) === -1);
      lib.removeAttribute('open');
    }
    var panels = document.querySelectorAll('.panel');
    for (var j = 0; j < panels.length; j++) {
      panels[j].classList.toggle('active', panels[j].id === 'panel-' + tab);
    }
    // Every workflow tab renders against a fresh board, so what one tab
    // changed (an absence, a case, a clinic edit) shows up in the next —
    // the daytime add-on call included.
    if (WORKFLOW_TABS.indexOf(tab) !== -1) { computeBoard(); prefillAddOns(); computeSuggestions(); }
    if (tab === 'out') renderOutTab();
    if (tab === 'roster') renderRosterTab();
    if (tab === 'surgery') renderSurgeryTab();
    if (tab === 'clinics') renderClinicsTab();
    if (tab === 'coverage') renderCoverageTab();
    if (tab === 'preview') renderPreview();
    if (tab === 'cpec') renderCpecReference(); // re-render so the selected date's cell is highlighted
    if (tab === 'flow') renderFlow(); // chains from the active configuration
    if (tab === 'setup') renderSetup(); // status line + saved-day count stay fresh
    if (tab === 'import') renderImportTab();
    // 'howto' and 'reference' are static — rendered once at boot.
    renderAvailStrip();
    renderBadges();
    syncHash(tab);
    rememberPlace();
  }

  function renderAll() {
    computeBoard();
    renderHeader();
    computeSuggestions();
    if (App.activeTab === 'out') renderOutTab();
    renderRosterTab();
    if (App.activeTab === 'surgery') renderSurgeryTab();
    if (App.activeTab === 'clinics') renderClinicsTab();
    if (App.activeTab === 'coverage') renderCoverageTab();
    if (App.activeTab === 'preview') renderPreview();
    if (App.activeTab === 'cpec') renderCpecReference(); // the day's column follows the date
    renderAvailStrip();
    renderBadges();
  }

  function boot() {
    if (!window.SCHED_DATA) {
      document.body.insertBefore(
        el('div', { class: 'banner', text: 'js/data.js failed to load — the app cannot start.' }),
        document.body.firstChild
      );
      return;
    }

    // Capture the built-in data object (for 'Remove imported configuration'),
    // then apply any stored override BEFORE the first render (UISPEC5 §E).
    BUILTIN_DATA = window.SCHED_DATA;
    applyStoredOverrideAtBoot();

    var dp = $('datePicker');
    var initial = tomorrowISO();
    dp.value = initial;
    dp.addEventListener('change', function () { if (dp.value) setDate(dp.value); });

    // Steer both date pickers to the academic year (defaults stay "tomorrow"
    // from the real clock — nothing is pinned to any particular month).
    function applyPickerRange() {
      var d = data();
      [dp, $('homeDate')].forEach(function (inp) {
        if (inp && d.ayStart && d.ayEnd) {
          inp.min = d.ayStart;
          inp.max = d.ayEnd;
        }
      });
    }
    applyPickerRange();

    var tabs = document.querySelectorAll('.tabbar .tab');
    for (var i = 0; i < tabs.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { setTab(btn.getAttribute('data-tab')); });
      })(tabs[i]);
    }

    // Library pages (How-to, Flow chart, CPEC sheet, Block schedules, Setup)
    // and Paste a sent schedule (⋯)
    var libBtns = document.querySelectorAll('#libMenu [data-lib], #moreMenu [data-lib]');
    for (var li = 0; li < libBtns.length; li++) {
      (function (btn) {
        btn.addEventListener('click', function () { closeMoreMenu(); setTab(btn.getAttribute('data-lib')); });
      })(libBtns[li]);
    }
    renderStepFoots();
    function closeMoreMenu() {
      var m = $('moreMenu');
      if (m) m.removeAttribute('open');
    }
    $('btnYesterday').addEventListener('click', function () { closeMoreMenu(); startFromYesterday(); });
    $('btnClear').addEventListener('click', function () { closeMoreMenu(); clearDay(); });
    // Escape closes an open menu
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      ['libMenu', 'moreMenu'].forEach(function (id) {
        var m = $(id);
        if (m && m.hasAttribute('open')) { m.removeAttribute('open'); var s = m.querySelector('summary'); if (s) s.focus(); }
      });
    });
    document.addEventListener('click', function (ev) {
      ['moreMenu', 'libMenu'].forEach(function (id) {
        var m = $(id);
        if (m && m.hasAttribute('open') && !m.contains(ev.target)) m.removeAttribute('open');
      });
    });
    // Keep "Free now" and the Coverage tab's clock honest on today's schedule.
    setInterval(function () {
      if (!App.state || !isToday()) return;
      renderAvailStrip();
      // Never yank a control out from under the user: skip the tick while
      // something inside the coverage view has focus.
      var body = $('coverageBody');
      var busy = body && document.activeElement && body.contains(document.activeElement);
      if (App.activeTab === 'coverage' && coverageFollowNow && !busy) renderCoverageBody();
    }, 60000);

    $('btnCopyHTML').addEventListener('click', function () {
      renderPreview();
      window.ExportFmt.copy(exportDay()).then(function (ok) {
        toast(ok ? 'Schedule copied — bold in email, plain in a text' : 'Copy failed — select the preview text and copy manually', ok);
      });
    });
    $('btnCopyAddons').addEventListener('click', function () {
      var any = (App.state.addOns || []).some(function (a) { return a && trim(a.name); });
      if (!any) { toast('No add-on call names yet — fill them in on Coverage', false); return; }
      window.ExportFmt.copyAddOns(exportDay()).then(function (ok) {
        toast(ok ? 'Add-ons copied — paste at the end of the schedule' : 'Copy failed', ok);
      });
    });

    // Home view + brand-click-returns-home
    var brand = $('btnBrandHome');
    if (brand) brand.addEventListener('click', goHome);
    var homeDate = $('homeDate');
    if (homeDate) {
      homeDate.addEventListener('change', updateHomeCreate);
      homeDate.addEventListener('input', updateHomeCreate);
    }
    var btnHomeCreate = $('btnHomeCreate');
    if (btnHomeCreate) {
      btnHomeCreate.addEventListener('click', function () {
        var v = (homeDate && homeDate.value) || tomorrowISO();
        var last = lastPlace();
        // a saved draft reopens on the step it was left on
        enterApp(v, last && last.date === v && lsGet(LS_PREFIX + v) ? last.tab : undefined);
      });
    }
    var btnHomePaste = $('btnHomePaste');
    if (btnHomePaste) {
      btnHomePaste.addEventListener('click', function () {
        enterApp((homeDate && homeDate.value) || tomorrowISO(), 'import');
      });
    }
    var btnHomeHowto = $('btnHomeHowto');
    if (btnHomeHowto) {
      btnHomeHowto.addEventListener('click', function () {
        enterApp((homeDate && homeDate.value) || tomorrowISO(), 'howto');
      });
    }
    var btnHomeFlow = $('btnHomeFlow');
    if (btnHomeFlow) {
      btnHomeFlow.addEventListener('click', function () {
        enterApp((homeDate && homeDate.value) || tomorrowISO(), 'flow');
      });
    }
    var btnHomeReference = $('btnHomeReference');
    if (btnHomeReference) {
      btnHomeReference.addEventListener('click', function () {
        enterApp((homeDate && homeDate.value) || tomorrowISO(), 'reference');
      });
    }
    var btnHomeSetup = $('btnHomeSetup');
    if (btnHomeSetup) {
      btnHomeSetup.addEventListener('click', function () {
        enterApp((homeDate && homeDate.value) || tomorrowISO(), 'setup');
      });
    }

    // Autosave already runs 0.3 s after each edit; also flush when the page
    // is hidden or closed (phones often skip beforeunload).
    window.addEventListener('beforeunload', saveNow);
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveNow();
    });
    window.addEventListener('storage', onStorage);

    // First render. A stored override that passed validation can still crash
    // a renderer — that must never brick the boot (Reference/Howto/CPEC empty,
    // routing dead, Setup unreachable), so fall back to the built-in data and
    // surface the problem instead. The dead blob stays in localStorage;
    // renderSetup shows it with a Remove button.
    function firstRender() {
      renderReference();
      renderHowto();
      renderFlow();
      renderCpecReference();
      setDate(initial);
    }
    try {
      firstRender();
    } catch (bootErr) {
      if (!usingOverride) throw bootErr; // built-in data — a real bug, don't hide it
      overrideBootError = 'it breaks rendering (' + ((bootErr && bootErr.message) || bootErr) + ')';
      if (window.console) console.error('Stored configuration crashed rendering — using built-in data', bootErr);
      window.SCHED_DATA = BUILTIN_DATA;
      usingOverride = false;
      residentYearMap = null; // cached from the bad data
      applyPickerRange();
      firstRender();
      toast('Stored configuration could not be loaded — using the built-in data. Remove or replace it on the Setup page.', false);
    }

    // Land on Home (body starts with .home-active from the markup) — unless
    // the URL deep-links a tab (#/cases etc.), then go straight there.
    if (homeDate) homeDate.value = initial;
    renderHome();
    window.addEventListener('hashchange', onHashChange);
    var initialRoute = routeFromHash();
    if (initialRoute && initialRoute !== 'home') {
      enterApp(dateFromHash() || initial, initialRoute);
    } else {
      App.currentRoute = 'home';
      syncHash('home', true); // replaceState: Back from the landing leaves the site
    }
  }

  App.setDate = setDate;
  App.setTab = setTab;
  App.saveNow = saveNow;
  App.exportDay = exportDay;
  App.enterApp = enterApp;
  App.goHome = goHome;
  window.App = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
