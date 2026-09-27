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

  var LS_PREFIX = 'surgsched:v1:day:';
  var DATA_OVERRIDE_KEY = 'surgsched:v1:dataOverride';
  var SAVE_DEBOUNCE_MS = 300;
  var WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var CATEGORIES = ['cataract', 'cornea', 'glaucoma', 'plastics', 'peds', 'retina', 'trauma', 'other'];
  var YEAR_ORDER = ['pgy2', 'pgy3', 'pgy4'];
  var CASE_SECTIONS = [
    { key: 'wills', label: 'Wills/ASC' },
    { key: 'private', label: 'Privates' },
    { key: 'jhn', label: 'JHN/TJUH/JSC' },
    { key: 'other', label: 'Other (Stadium / Cherry Hill)' }
  ];
  // Surgery-tab order follows the how-to: Wills, then Stadium/Cherry Hill,
  // then JHN/Gibbon; privates (no resident) last. The copied schedule keeps
  // its own order (export.js).
  var SURGERY_ORDER = ['wills', 'other', 'jhn', 'private'];
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
  var planKind = 'globe';

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
      until: String(c.until || '')   // typed end time, or set by "Done" day-of
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
      out.absences = st.absences.map(normAbsence).filter(function (a) { return !!a; });
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
          auto: date ? !!(a && a.auto) : legacy
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
    if (st.suggestions && typeof st.suggestions === 'object') out.suggestions = st.suggestions;
    var maxId = 0;
    out.cases.forEach(function (c, i) {
      if (!c.id) c.id = 'c_' + (i + 1);
      var m = /^c(\d+)$/.exec(c.id);
      if (m) maxId = Math.max(maxId, +m[1]);
    });
    out.seq = (typeof st.seq === 'number' && st.seq > maxId) ? st.seq : maxId + 1;
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

  var saveTimer = null;
  // True only once the user has actually edited the loaded day. saveNow() is a
  // no-op while false, so merely visiting a date (or closing the tab) never
  // fabricates a "saved draft" for a day the user never touched — the Home
  // draft-detection and Recent-days chips rely on keys meaning real edits.
  var stateDirty = false;
  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (App.state && stateDirty) lsSet(LS_PREFIX + App.state.date, JSON.stringify(App.state));
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }

  // Call after every manual input: debounced persist, live preview refresh,
  // and a debounced recompute of who-is-where (strip + tab badges).
  function touch() {
    stateDirty = true;
    scheduleSave();
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
  function isResidentName(name) { return !!yearOf(name); }

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
  var KIND_GROUPS = [
    { kind: 'free', label: 'Free' },
    { kind: 'clinic', label: 'In clinic — would need a backup' },
    { kind: 'duty', label: 'On duty (ER / consults / Day Float)' },
    { kind: 'case', label: 'Already in a case then' },
    { kind: 'out', label: 'Out' },
    { kind: 'off', label: 'Residents' }
  ];
  var PICK_YEAR_ORDER = ['pgy4', 'pgy3', 'pgy2'];

  function statusFor(name, opts) {
    var b = App.board;
    if (!b || !b.byName[name]) return null;
    if (opts.spans && opts.spans.length) return b.statusDuringSpans(name, opts.spans, { exclude: opts.exclude });
    if (opts.session === 'am' || opts.session === 'pm') {
      var from = opts.session === 'am' ? b.dayStart : b.noon;
      var to = opts.session === 'am' ? b.noon : b.dayEnd;
      return b.statusDuring(name, from, to, { exclude: opts.exclude });
    }
    return null;
  }

  function statusShort(st) {
    if (!st) return '';
    if (st.kind === 'case') {
      var S = window.Status;
      return 'in ' + st.label + (S && st.until != null ? ' until ' + S.fmtClock(st.until) : '');
    }
    return st.label || '';
  }

  // Shorter still, for places that already name the role: a Surg role or
  // OR block with nothing booked is just "free".
  function statusBrief(st) {
    if (!st) return '';
    if (st.kind === 'free' && /, no case$/.test(st.label || '')) return 'free';
    if (st.kind === 'free') return 'free (' + st.label + ')';
    if (st.kind === 'clinic' && !st.covering) return 'in ' + (st.clinic || st.label);
    return statusShort(st);
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
    var sugg = opts.suggested || '';
    var groups = {};
    names.forEach(function (x) {
      var n = x.name;
      if (n === sugg) return;
      if (hide.indexOf(n) !== -1 && n !== value) return;
      var st = statusFor(n, opts);
      var kind = st ? st.kind : 'off';
      if (kind === 'out' && n !== value) return; // out → not offered
      (groups[kind] || (groups[kind] = [])).push({ name: n, year: x.year, st: st });
    });
    if (sugg) {
      var og0 = el('optgroup', { label: 'Suggested' });
      var sst = statusFor(sugg, opts);
      og0.appendChild(el('option', { value: sugg, text: sugg + (sst && sst.label ? ' — ' + statusShort(sst) : '') }));
      sel.appendChild(og0);
    }
    KIND_GROUPS.forEach(function (g) {
      var list = groups[g.kind];
      if (!list || !list.length) return;
      var og = el('optgroup', { label: g.label });
      list.forEach(function (x) {
        var detail = x.st && x.st.label ? ' — ' + statusShort(x.st) : '';
        og.appendChild(el('option', { value: x.name, text: x.name + ' (' + x.year + ')' + detail }));
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
        type: 'button', class: 'btn-icon danger', title: 'Remove ' + name,
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
    computeBoard();
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
    $('ayLabel').textContent = data().ayLabel || '';
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

  /* ------------------------------------------------------------------ */
  /* tab 1 — Day Roster                                                  */
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
        var nfNote = (r.nightFloat && res.name === r.nightFloat)
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

  function summaryItem(key, valNode) {
    return el('div', { class: 'summary-item' }, [
      el('span', { class: 'summary-key', text: key }),
      el('span', { class: 'summary-val' }, [valNode])
    ]);
  }

  function collapseWerLocal(wer) {
    var am = (wer && wer.am) || [];
    var pm = (wer && wer.pm) || [];
    var parts = [];
    am.forEach(function (n) { parts.push(n + (pm.indexOf(n) !== -1 ? ' AM/PM' : ' AM')); });
    pm.forEach(function (n) { if (am.indexOf(n) === -1) parts.push(n + ' PM'); });
    return parts.join(', ');
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
      host.appendChild(el('p', { class: 'empty-note', text: 'Nothing derived for this date — pick a weekday inside the academic year, then press Create Surg Schedule.' }));
      return;
    }

    var grid = el('div', { class: 'glance-grid' });
    surgKeys.forEach(function (n) {
      var s = r.surg[n];
      var tile = el('div', { class: 'glance-tile' }, [
        el('div', { class: 'glance-role', text: 'Surg ' + n }),
        el('div', { class: 'glance-name', text: s.name })
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
      if (App.board && App.board.isOut(s.name, 'am') && App.board.isOut(s.name, 'pm')) {
        tile.classList.add('glance-out');
        tile.appendChild(el('div', { class: 'glance-sess', text: 'OUT today — see Out today' }));
      }
      var m = meta['Surg ' + n];
      if (m) tile.appendChild(el('div', { class: 'glance-sub', text: m.split(';')[0] }));
      grid.appendChild(tile);
    });
    host.appendChild(grid);

    var row = el('div', { class: 'glance-row' });
    var wer = collapseWerLocal(r.wer);
    if (wer) row.appendChild(glanceKV('WER', wer));
    row.appendChild(glanceKV('Night Float', trim(App.state && App.state.nightFloat) || '—'));
    if ((r.jeffConsults || []).length) row.appendChild(glanceKV('Jeff Consults', r.jeffConsults.join(', ')));
    if ((r.cooperConsults || []).length) {
      // 'Illiano + Camacho AM / DeSimone PM' when buddies are set (from state)
      var cooperVal = r.cooperConsults.join(', ');
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
      if (cov && cov.nf) {
        if (r.dayFloat.indexOf(cov.nf) === -1) {
          var duty = nfDutyText(cov.nfDuties);
          dfVal += ' — covering ' + cov.nf + '’s daytime' + (duty ? ' (' + duty + ')' : '');
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

  function labeledField(labelText, control, hint) {
    var f = el('div', { class: 'field' }, [
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

  // Shared add-ons editor — rendered on both the Day Roster tab and the
  // Cases & Clinics tab; both views edit the same rows.
  function addOnsEditor() {
    var st = App.state;
    var wrap = el('div');
    var d = data();
    st.addOns.forEach(function (row, idx) {
      var line = el('div', { class: 'addon-row' });

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

      // Anyone on vacation/sick that day is not offered for that day's rows.
      // (Not the Night Float resident — nights are exactly when they work.)
      var outToday = row.date === st.date
        ? (st.absences || []).filter(function (a) { return a.am && a.pm; }).map(function (a) { return a.name; })
        : [];
      line.appendChild(residentPicker(row.name, function (v) {
        row.name = v;
        touch();
      }, { emptyLabel: 'resident…', hideNames: outToday }));
      line.appendChild(el('button', {
        type: 'button', class: 'btn-icon danger', title: 'Remove row', text: '×',
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
  /* tab 3 — Surgery (cases + the resident on each, in one place)        */
  /* ------------------------------------------------------------------ */

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

  function addCase(section) {
    App.state.cases.push(newCase(section));
    touch();
    computeBoard();
    renderSurgeryTab();
  }

  function removeCase(id) {
    App.state.cases = App.state.cases.filter(function (c) { return c.id !== id; });
    if (App.state.suggestions) delete App.state.suggestions[id];
    touch();
    computeBoard();
    renderSurgeryTab();
  }

  function duplicateCase(id) {
    var idx = -1;
    App.state.cases.forEach(function (c, i) { if (c.id === id) idx = i; });
    if (idx === -1) return;
    var src = App.state.cases[idx];
    var copy = normCase(src);
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

  function miniField(labelText, control, cls) {
    return el('label', { class: 'mini-field' + (cls ? ' ' + cls : '') }, [
      el('span', { class: 'mini-label', text: labelText }),
      control
    ]);
  }

  // Fields that change WHEN someone is busy re-run the availability check a
  // moment after typing stops. Deliberately NOT on 'change': that fires on
  // blur, i.e. in the middle of a click on a suggestion chip, and the
  // re-render would swallow the click. Only the resident areas re-render —
  // never the inputs — so typing keeps its focus.
  var assignRefreshTimer = null;
  function scheduleAssignRefresh() {
    if (assignRefreshTimer) clearTimeout(assignRefreshTimer);
    assignRefreshTimer = setTimeout(function () { assignRefreshTimer = null; refreshAssignAreas(); }, 350);
  }
  function onTimingChange(input) {
    input.addEventListener('input', scheduleAssignRefresh);
  }

  function caseCard(c) {
    var card = el('div', { class: 'case-card', 'data-case-id': c.id });

    card.appendChild(miniField('Surgeon',
      textInput(c.surgeon, 'Surgeon', function (v) { c.surgeon = v; touch(); }), 'cf-surgeon'));
    var cnt = numInput(c.count, function (v) { c.count = v; touch(); });
    onTimingChange(cnt);
    card.appendChild(miniField('Cases', cnt, 'cf-num'));
    var svc = numInput(c.serviceCount, function (v) { c.serviceCount = v; touch(); });
    onTimingChange(svc);
    card.appendChild(miniField('Service', svc, 'cf-num'));
    var start = textInput(c.start, '0730', function (v) { c.start = v; touch(); });
    onTimingChange(start);
    card.appendChild(miniField('Start', start, 'cf-start'));

    var cat = el('select');
    CATEGORIES.forEach(function (k) { cat.appendChild(el('option', { value: k, text: k })); });
    cat.value = c.category;
    cat.addEventListener('change', function () { c.category = cat.value; touch(); refreshAssignAreas(); });
    card.appendChild(miniField('Category', cat, 'cf-cat'));

    var box = el('input', { type: 'checkbox' });
    box.checked = c.addOn;
    var pill = el('label', { class: 'pill-check' + (c.addOn ? ' on' : '') }, [box, 'Add-on']);
    box.addEventListener('change', function () {
      c.addOn = box.checked;
      pill.classList.toggle('on', box.checked);
      touch();
      refreshAssignAreas();
    });
    card.appendChild(el('div', { class: 'cf-pill' }, [pill]));

    card.appendChild(el('div', { class: 'case-actions' }, [
      el('button', { type: 'button', class: 'btn-icon', title: 'Duplicate case', text: '⧉', onclick: function () { duplicateCase(c.id); } }),
      el('button', { type: 'button', class: 'btn-icon danger', title: 'Remove case', text: '×', onclick: function () { removeCase(c.id); } })
    ]));

    var svcT = textInput(c.serviceTimes, 'when the service cases are — e.g. 9:30 AM',
      function (v) { c.serviceTimes = v; touch(); });
    onTimingChange(svcT);
    card.appendChild(miniField('Service case time(s)', svcT, 'cf-svctimes'));
    var until = textInput(c.until, 'est.', function (v) { c.until = v; touch(); });
    until.setAttribute('data-until', c.id);
    onTimingChange(until);
    card.appendChild(miniField('Done by', until, 'cf-until'));
    card.appendChild(miniField('Notes',
      textInput(c.notes, 'no Peds OR…', function (v) { c.notes = v; touch(); }), 'cf-notes'));

    var assign = el('div', { class: 'case-assign', 'data-assign-for': c.id });
    card.appendChild(assign);
    renderCaseAssign(c, assign);
    return card;
  }

  /* live suggestions — recomputed from the board on every refresh */

  var suggMap = {};
  function computeSuggestions() {
    suggMap = {};
    if (!window.Assign || !window.Assign.suggest) return;
    try {
      window.Assign.suggest(App.state.cases, App.roster, data(), App.board).forEach(function (s) {
        suggMap[s.caseId] = s;
      });
    } catch (e) {
      if (window.console) console.error('suggest failed', e);
    }
  }

  function needsResident(c) { return c.serviceCount > 0 && !trim(c.assigned); }

  function spanText(spans) {
    var S = window.Status;
    if (!S || !spans || !spans.length) return '';
    return spans.map(function (sp) { return S.fmtClock(sp.start) + '–' + S.fmtClock(sp.end); }).join(', ');
  }

  function isToday() { return App.state && App.state.date === isoOf(new Date()); }
  function nowMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  function assignedCheck(c, info) {
    var b = App.board;
    var name = trim(c.assigned);
    if (!b || !name || !b.byName[name] || !info) return null;
    var st = b.statusDuringSpans(name, info.spans, { exclude: c.id });
    if (st.kind === 'out') return { cls: 'warn-line bad', text: '⚠ ' + name + ' is out (' + st.label + ') — pick someone else' };
    if (st.kind === 'case') return { cls: 'warn-line bad', text: '⚠ ' + name + ' is double-booked — ' + statusShort(st) };
    if (st.kind === 'clinic') return { kind: 'clinic', cls: 'status-line', text: name + ' leaves ' + (st.clinic || 'clinic') + (st.covering && st.covering !== name ? ' (covering for ' + st.covering + ')' : '') + ' for this case' };
    if (st.kind === 'duty') return { cls: 'status-line', text: name + ' is on ' + st.label };
    return { cls: 'status-line ok', text: '✓ ' + name + ' is free then (' + st.label + ')' };
  }

  function renderCaseAssign(c, host) {
    clearNode(host);
    var b = App.board;
    var info = b && b.caseInfo[c.id];
    var sugg = suggMap[c.id];
    var assigned = trim(c.assigned);
    var service = c.serviceCount > 0;

    // Timing line: when the resident is busy for this case
    if (info && (service || assigned)) {
      var t = 'Resident busy ' + spanText(info.spans) + (info.estimated ? ' (est. — type "Done by" to fix)' : '');
      if (info.unknownStart) t += ' · no start time, assumed 7:30';
      var timing = el('div', { class: 'assign-timing', text: t });
      if (isToday() && assigned && info.spans.length) {
        var now = nowMinutes();
        var last = info.spans[info.spans.length - 1];
        if (now >= info.spans[0].start && now < last.end) {
          timing.appendChild(el('button', {
            type: 'button', class: 'btn btn-small', text: 'Done now',
            title: 'Mark the case finished — ' + assigned + ' is free from now',
            onclick: function () {
              c.until = window.Status.fmtHHMM(nowMinutes());
              touch();
              refreshAssignAreas();
              var inp = document.querySelector('input[data-until="' + c.id + '"]');
              if (inp) inp.value = c.until;
              toast(assigned + ' marked free from now');
            }
          }));
        }
      }
      host.appendChild(timing);
    }

    if (!service && !assigned) {
      host.appendChild(el('div', { class: 'assign-row-inline' }, [
        el('span', { class: 'mini-label', text: 'Resident' }),
        el('span', { class: 'field-hint', text: 'Private — no resident needed' }),
        residentPicker('', function (v) { c.assigned = v; touch(); refreshAssignAreas(); },
          { spans: info && info.spans, exclude: c.id, emptyLabel: 'assign anyway…' })
      ]));
      return;
    }

    // Resident row: one-click suggestion + availability-grouped dropdown
    var row = el('div', { class: 'assign-row-inline' });
    row.appendChild(el('span', { class: 'mini-label', text: 'Resident' }));
    if (!assigned && sugg && sugg.name) {
      row.appendChild(el('button', {
        type: 'button', class: 'btn btn-small btn-primary sugg-chip',
        title: (sugg.reasons || []).join(' · '),
        text: '✓ ' + sugg.name + ' · ' + suggVia(sugg),
        onclick: function () { c.assigned = sugg.name; touch(); refreshAssignAreas(); }
      }));
    }
    row.appendChild(residentPicker(assigned, function (v) {
      c.assigned = v;
      touch();
      refreshAssignAreas();
    }, { spans: info && info.spans, exclude: c.id, suggested: !assigned && sugg ? sugg.name : '', emptyLabel: 'unassigned' }));
    if (!assigned) row.appendChild(el('span', { class: 'unassigned-text', text: '⚠ UNASSIGNED' }));
    host.appendChild(row);

    // Clinic backup: who covers the clinic this case pulls the resident from
    var plan = null;
    if (assigned && window.Assign && window.Assign.backupPlan && b) {
      try { plan = window.Assign.backupPlan(c, App.roster, data(), App.state.cases, b); } catch (e) { plan = null; }
    }

    if (assigned) {
      var chk = assignedCheck(c, info);
      // the backup box below already says who leaves which clinic
      if (chk && !(plan && chk.kind === 'clinic')) host.appendChild(el('div', { class: chk.cls, text: chk.text }));
    } else if (sugg) {
      var why = el('div', { class: 'sugg-why' });
      (sugg.reasons || []).forEach(function (r) { why.appendChild(el('span', { class: 'sugg-reason', text: r })); });
      if ((sugg.skipped || []).length) {
        why.appendChild(el('span', {
          class: 'sugg-skipped',
          text: 'Skipped: ' + sugg.skipped.slice(0, 4).map(function (s) { return s.name + ' (' + s.why + ')'; }).join('; ')
        }));
      }
      host.appendChild(why);
      (sugg.warnings || []).forEach(function (w) { host.appendChild(el('div', { class: 'warn-line', text: '⚠ ' + w })); });
    }

    if (plan || trim(c.backup)) host.appendChild(backupRow(c, plan));
  }

  function suggVia(s) {
    var r = (s.reasons && s.reasons[0]) || '';
    var i = r.lastIndexOf('→ ');
    var via = i === -1 ? r : r.slice(i + 2);
    return via.replace(/ \(remaining-cases chain\)$/, '');
  }

  function backupNoteFor(c, plan) {
    var S = window.Status;
    var t = 'to cover ' + String(plan.clinic || 'clinic').toLowerCase() + ' clinic';
    if (plan.owner && plan.owner !== trim(c.assigned)) t += ' (for ' + plan.owner + ')';
    t += ' during case';
    var info = App.board && App.board.caseInfo[c.id];
    if (S && info && plan.window && info.start < plan.window.start) t += ' if it runs past ' + S.fmtClock(plan.window.start);
    if (plan.second) t += ', 2nd backup ' + plan.second.name + ' (' + plan.second.source + ')';
    return t;
  }

  function backupRow(c, plan) {
    var S = window.Status;
    var wrap = el('div', { class: 'backup-box' + (plan && !trim(c.backup) ? ' needs' : '') });
    var head = plan
      ? trim(c.assigned) + ' leaves ' + plan.clinic + ' clinic' + (plan.owner !== trim(c.assigned) ? ' (for ' + plan.owner + ')' : '') +
        (S && plan.window ? ' ' + S.fmtClock(plan.window.start) + '–' + S.fmtClock(plan.window.end) : '') + ' → backup covers it'
      : 'Backup';
    wrap.appendChild(el('div', { class: 'backup-head', text: head }));
    var row = el('div', { class: 'assign-row-inline' });
    if (plan && plan.primary && !trim(c.backup)) {
      row.appendChild(el('button', {
        type: 'button', class: 'btn btn-small sugg-chip-2',
        text: '✓ ' + plan.primary.name + ' · ' + plan.primary.source,
        onclick: function () {
          c.backup = plan.primary.name;
          c.backupNote = backupNoteFor(c, plan);
          touch();
          refreshAssignAreas();
        }
      }));
    } else if (plan && !plan.primary && !trim(c.backup)) {
      row.appendChild(el('span', { class: 'warn-line', text: '⚠ Nobody on the coverage chain is free — pick someone or mark NC' }));
    }
    var spans = plan && plan.window ? [{ start: plan.window.start, end: plan.window.end }] : null;
    row.appendChild(residentPicker(c.backup === 'NC' ? 'NC' : c.backup, function (v) {
      c.backup = v;
      if (v && v !== 'NC' && plan && !trim(c.backupNote)) c.backupNote = backupNoteFor(c, plan);
      touch();
      refreshAssignAreas();
    }, {
      spans: spans, exclude: c.id, emptyLabel: 'backup…', hideNames: [trim(c.assigned)],
      suggested: plan && plan.primary && !trim(c.backup) ? plan.primary.name : '',
      extra: [{ value: 'NC', text: 'NC — clinic not covered' }]
    }));
    wrap.appendChild(row);
    var note = el('input', {
      type: 'text', class: 'covnote',
      placeholder: 'backup note — e.g. to cover glaucoma clinic during case if after 1 PM',
      value: c.backupNote || ''
    });
    note.addEventListener('input', function () { c.backupNote = note.value; touch(); });
    wrap.appendChild(note);
    return wrap;
  }

  // Re-render every case's resident area (and the counters) against a fresh
  // board — inputs keep their focus because only these areas are rebuilt.
  function refreshAssignAreas() {
    if (assignRefreshTimer) { clearTimeout(assignRefreshTimer); assignRefreshTimer = null; }
    computeBoard();
    computeSuggestions();
    (App.state.cases || []).forEach(function (c) {
      var host = document.querySelector('.case-assign[data-assign-for="' + c.id + '"]');
      if (host) renderCaseAssign(c, host);
    });
    renderSurgeryToolbar();
    renderAvailStrip();
    renderBadges();
  }

  function acceptAllSuggestions() {
    computeBoard();
    computeSuggestions();
    var n = 0;
    App.state.cases.forEach(function (c) {
      var s = suggMap[c.id];
      if (s && s.name && needsResident(c)) { c.assigned = s.name; n++; }
    });
    touch();
    computeBoard();
    renderSurgeryTab();
    toast(n ? 'Accepted ' + n + ' suggestion' + (n === 1 ? '' : 's') : 'Nothing to accept — every service case has a resident');
  }

  function renderSurgeryToolbar() {
    var host = $('surgeryToolbar');
    if (!host) return;
    clearNode(host);
    var cases = App.state.cases || [];
    var svc = cases.filter(function (c) { return c.serviceCount > 0; }).length;
    var needs = cases.filter(needsResident);
    var acceptable = needs.filter(function (c) { return suggMap[c.id] && suggMap[c.id].name; }).length;
    var bar = el('div', { class: 'toolbar card-lite surgery-toolbar' });
    bar.appendChild(el('span', { class: 'toolbar-count' }, [
      el('b', { text: String(svc) }), ' service case' + (svc === 1 ? '' : 's') + ' · ',
      el('b', { class: needs.length ? 'count-warn' : 'count-ok', text: String(needs.length) }),
      ' need' + (needs.length === 1 ? 's' : '') + ' a resident'
    ]));
    bar.appendChild(el('button', {
      type: 'button', class: 'btn btn-primary', disabled: !acceptable,
      text: 'Accept all suggestions' + (acceptable ? ' (' + acceptable + ')' : ''),
      onclick: acceptAllSuggestions
    }));
    bar.appendChild(el('span', {
      class: 'toolbar-note',
      text: 'Suggestions follow the how-to chains and skip anyone out or already in a case at that time. Nothing is assigned until you click.'
    }));
    host.appendChild(bar);
  }

  function renderCaseSections() {
    var wrap = $('caseSections');
    clearNode(wrap);
    SURGERY_ORDER.forEach(function (key) {
      var secDef = CASE_SECTIONS.filter(function (s) { return s.key === key; })[0];
      var list = App.state.cases.filter(function (c) { return c.section === secDef.key; });

      var det = el('details', { class: 'card case-section', open: !!caseSectionOpen[secDef.key] });
      det.addEventListener('toggle', function () { caseSectionOpen[secDef.key] = det.open; });

      // The button lives inside <summary>: preventDefault + stopPropagation so
      // adding a case never toggles the <details> open/closed state.
      var addBtn = el('button', {
        type: 'button', class: 'btn btn-small', text: '+ Add case',
        onclick: function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          caseSectionOpen[secDef.key] = true;
          addCase(secDef.key);
        }
      });
      var nNeed = list.filter(needsResident).length;
      det.appendChild(el('summary', { class: 'case-summary' }, [
        el('span', { class: 'case-summary-title', text: secDef.label }),
        el('span', { class: 'count-badge', text: list.length + (list.length === 1 ? ' case' : ' cases') }),
        nNeed ? el('span', { class: 'count-badge count-badge-warn', text: nNeed + ' need a resident' }) : null,
        addBtn
      ]));

      var body = el('div', { class: 'case-section-body' });
      if (secDef.key === 'private') {
        body.appendChild(el('p', { class: 'field-hint', text: 'Private-only cases keep Service at 0 — no resident needed.' }));
      }
      if (!list.length) {
        body.appendChild(el('div', { class: 'case-empty' }, [
          el('span', { class: 'empty-note', text: 'No cases yet — add the first one.' }),
          el('button', {
            type: 'button', class: 'btn btn-small', text: '+ Add case',
            onclick: function () { addCase(secDef.key); }
          })
        ]));
      } else {
        list.forEach(function (c) { body.appendChild(caseCard(c)); });
      }
      det.appendChild(body);
      wrap.appendChild(det);
    });
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
    var from = session === 'am' ? b.dayStart : b.noon;
    var to = session === 'am' ? b.noon : b.dayEnd;
    staff.forEach(function (name) {
      if (!b.byName[name]) return;
      var base = b.base[name][session];
      if (base.kind === 'out') {
        out.away[name] = true;
        var abs = base.absence || {};
        var cov = session === 'am' ? abs.coverAM : abs.coverPM;
        out.lines.push({
          text: name + ' out (' + base.label + ')' + (cov && cov !== 'NC' ? ' → ' + cov + ' covers' : cov === 'NC' ? ' — NC' : ' — nobody covering yet'),
          bad: !cov
        });
        return;
      }
      if (base.covering && base.text !== label) {
        out.away[name] = true;
        out.lines.push({ text: name + ' is covering ' + base.covering + ' (' + base.text + ') — not here', bad: false });
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
        var txt = name + ' in ' + sg.label + ' ' + S.fmtClock(s0) + '–' + S.fmtClock(s1);
        if (info && info.backup === 'NC' && !who.some(function (w) { return w.name; })) {
          txt += ' — NC';
          gap = false;
        } else if (who.length === 1) {
          txt += who[0].name ? ' → ' + who[0].name + ' covers' : ' — nobody covering';
        } else {
          txt += ' → ' + who.map(function (w) {
            return (w.name || 'nobody') + ' ' + S.fmtClock(w.start).replace(/ [AP]M$/, '') + '–' + S.fmtClock(w.end).replace(/ [AP]M$/, '');
          }).join(', ');
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
    eff.staff.forEach(function (name) {
      var chip = nameChip(name, function () { removeClinicStaff(label, session, name); });
      if (notes.away[name]) chip.classList.add('chip-away');
      chips.appendChild(chip);
    });
    var addSel = residentPicker('', function (v) {
      addClinicStaff(label, session, v);
    }, {
      session: (session === 'am' || session === 'pm') ? session : null,
      emptyLabel: '+ add…', hideNames: eff.staff
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

    var countIn = el('input', {
      type: 'text', class: 'clinic-count', placeholder: 'e.g. 29x3',
      value: (cc && cc.count) || ''
    });
    countIn.addEventListener('input', function () {
      clinicCountEntry(key).count = countIn.value;
      touch();
      updateDressBanner();
    });
    row.appendChild(countIn);

    var extraIn = el('input', {
      type: 'text', class: 'clinic-extra', placeholder: 'note',
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
      standing: true, subLabel: 'daily post-op checks — typically the operating PGY-4s'
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

  function addCpecCase(e, opts) {
    var c = newCase('wills');
    c.surgeon = e.attending || '';
    c.start = e.time || '';           // 'AM TF' goes in start as text
    if (e.count != null) c.count = e.count;
    c.serviceCount = 0;               // unknown — user fills
    c.category = 'cataract';
    var noteBits = [];
    var site = CPEC_SITE_LABELS[e.site];
    if (site) noteBits.push(site);
    if (e.note) noteBits.push(e.note);
    c.notes = noteBits.join('; ');
    // The sheet says who covers — unless that resident is out today, then
    // leave it open so the suggestion walks the chain instead.
    var cover = cpecCoverName(e.cover);
    var outNote = '';
    if (cover && App.board && window.Status) {
      var spans = window.Status.caseSpans(c, data()).spans;
      if (App.board.statusDuringSpans(cover, spans).kind === 'out') { outNote = cover; cover = ''; }
    }
    c.assigned = cover;
    App.state.cases.push(c);
    caseSectionOpen.wills = true;
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

  function renderCpecCard() {
    var host = $('cpecCard');
    if (!host) return;
    clearNode(host);
    var info = cpecInfo();
    var entries = (info && info.entries) || [];
    if (!entries.length) return; // weekend / out-of-year / sheet not loaded

    var r = App.roster || {};
    var card = el('div', { class: 'card cpec-card' });
    var title = 'CPEC surgical block sheet';
    if (r.nth && r.weekdayLabel) title += ' — ' + ordinal(r.nth) + ' ' + r.weekdayLabel;
    var pending = entries.filter(function (e) {
      return (e.privateOnly || !e.cover) ? !cpecPrivateAdded(e.attending || '') : !cpecAlreadyAdded(e.attending || '', e.time || '');
    }).length;
    card.appendChild(el('div', { class: 'card-head' }, [
      el('h2', {}, [
        title + ' ',
        el('span', { class: 'h-note', text: 'step 3–4 of the how-to: scheduled cataracts' })
      ]),
      el('button', {
        type: 'button', class: 'btn btn-small' + (pending ? ' btn-primary' : ''), disabled: !pending,
        text: pending ? '+ Add all ' + pending : 'all added',
        onclick: function () { addAllCpec(entries); }
      })
    ]));

    CPEC_GROUPS.forEach(function (g) {
      var list = entries.filter(function (e) {
        if (g.key === 'private') return !!e.privateOnly || !e.cover;
        return !e.privateOnly && e.cover === g.key;
      });
      if (!list.length) return;
      var head = el('div', { class: 'cpec-group-title', text: g.label });
      if (g.key !== 'private') {
        var cov = cpecCoverName(g.key);
        if (cov) head.appendChild(el('span', { class: 'cpec-cover', text: '→ ' + cov }));
      }
      card.appendChild(head);
      list.forEach(function (e) {
        var isPrivate = g.key === 'private';
        var added = isPrivate
          ? cpecPrivateAdded(e.attending || '')
          : cpecAlreadyAdded(e.attending || '', e.time || '');
        var row = el('div', { class: 'cpec-row' });
        row.appendChild(el('span', { class: 'cpec-entry', text: cpecEntryText(e) }));
        row.appendChild(el('button', {
          type: 'button', class: 'btn btn-small cpec-add', disabled: added,
          text: added ? 'added' : (isPrivate ? '+ Add to Privates' : '+ Add as case'),
          onclick: function () { if (isPrivate) addCpecPrivate(e); else addCpecCase(e); }
        }));
        card.appendChild(row);
      });
    });

    card.appendChild(el('p', {
      class: 'field-hint cpec-note',
      text: 'From the CPEC sheet effective 5/1/2026 — nth weekday of the month; confirm against Cerner/NextGen. (n) = sheet case count, editable.'
    }));
    host.appendChild(card);
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
    if (n.type === 'absence') {
      row.appendChild(el('div', { class: 'need-text' }, [
        el('b', { text: n.name + ' out ' + n.session.toUpperCase() }),
        ' — ' + n.duty + ': nobody covering yet' + (n.auto ? ' (Night Float — no Day Float to cover)' : '')
      ]));
      if (!n.auto) {
        actions.appendChild(el('button', {
          type: 'button', class: 'btn btn-small', text: 'Pick cover on Out today',
          onclick: function () { setTab('out'); }
        }));
      }
    } else if (n.type === 'clinic') {
      var when = S ? S.fmtClock(n.start) + '–' + S.fmtClock(n.end) : '';
      var who = n.owner !== n.holder ? ' (covering for ' + n.owner + ')' : '';
      row.appendChild(el('div', { class: 'need-text' }, [
        el('b', { text: n.clinic + ' ' + n.session.toUpperCase() + ' ' + when }),
        ' — ' + n.holder + who + ' is ' + n.why +
          (n.whyKind === 'case' ? ' and nobody is covering' : ', so nobody is left for ' + n.holder + '’s spot')
      ]));
      if (n.whyKind === 'case' && n.caseId) {
        var target = caseById(chainEndCase(n.caseId, n.start + 1));
        var plan = null;
        if (target && window.Assign && window.Assign.backupPlan && b) {
          try { plan = window.Assign.backupPlan(target, App.roster, data(), App.state.cases, b); } catch (e) { plan = null; }
        }
        if (target && plan && plan.primary) {
          actions.appendChild(el('button', {
            type: 'button', class: 'btn btn-small btn-primary',
            text: '✓ ' + plan.primary.name + ' covers (' + plan.primary.source + ')',
            onclick: function () {
              target.backup = plan.primary.name;
              target.backupNote = backupNoteFor(target, plan);
              touch();
              refreshEverything();
            }
          }));
        }
        if (target) {
          actions.appendChild(el('button', {
            type: 'button', class: 'btn btn-small', text: 'NC — leave uncovered',
            onclick: function () { target.backup = 'NC'; touch(); refreshEverything(); }
          }));
        }
      } else {
        actions.appendChild(el('button', {
          type: 'button', class: 'btn btn-small',
          text: 'Take ' + n.holder + ' off ' + n.clinic + ' ' + n.session.toUpperCase(),
          onclick: function () { removeClinicStaff(n.clinic, n.session, n.holder); refreshEverything(); }
        }));
      }
    }
    row.appendChild(actions);
    return row;
  }

  function renderNeedsCard(host, title, note) {
    var b = App.board;
    var needs = (b && b.needs) || [];
    var warns = (b && b.warnings) || [];
    if (!needs.length && !warns.length) {
      host.appendChild(el('div', { class: 'card ok-card' }, [
        el('span', { class: 'ok-mark', text: '✓' }),
        ' Every clinic is covered and every absence has a decision.'
      ]));
      return;
    }
    var card = el('div', { class: 'card needs-card' + (needs.length ? '' : ' heads-up') });
    card.appendChild(el('h2', {}, needs.length
      ? [title + ' ', el('span', { class: 'h-note', text: note })]
      : ['Heads-up ', el('span', { class: 'h-note', text: 'nothing uncovered — just worth knowing' })]));
    needs.forEach(function (n) { card.appendChild(needItem(n)); });
    warns.forEach(function (w) { card.appendChild(el('div', { class: 'warn-line', text: '⚠ ' + w })); });
    host.appendChild(card);
  }

  function renderClinicNeeds() {
    var host = $('clinicNeeds');
    if (!host) return;
    clearNode(host);
    if (!App.board || !App.board.order.length) return;
    renderNeedsCard(host, 'Needs coverage', 'clinics left short by vacations or by residents pulled into cases');
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
    var reason = el('select', { class: 'sel abs-reason' });
    REASONS.forEach(function (r) { reason.appendChild(el('option', { value: r.key, text: r.label })); });
    reason.value = a.reason;
    reason.addEventListener('change', function () { a.reason = reason.value; outChanged(); });
    top.appendChild(reason);
    top.appendChild(el('button', {
      type: 'button', class: 'btn-icon danger', title: 'Remove', text: '×',
      onclick: function () { st.absences.splice(idx, 1); outChanged(); }
    }));
    card.appendChild(top);

    if (!a.name) {
      card.appendChild(el('p', { class: 'field-hint', text: 'Pick the resident — their assignments and a coverage picker appear here.' }));
      return card;
    }

    // Role warning: a Surg role on vacation changes the whole day
    var role = App.board && App.board.surgRole[a.name];
    if (role) {
      card.appendChild(el('div', { class: 'warn-line' }, [
        '⚠ ' + a.name + ' is Surg ' + role + ' today — while out, their cases go to the next person in each chain (the Surgery tab does this automatically).'
      ]));
    }
    if ((App.roster.dayFloat || []).indexOf(a.name) !== -1) {
      card.appendChild(el('div', { class: 'warn-line' }, ['⚠ ' + a.name + ' is the Day Float — check who covers the Night Float resident today.']));
    }

    ['am', 'pm'].forEach(function (s) {
      if (!a[s]) return;
      var key = s === 'am' ? 'coverAM' : 'coverPM';
      var duty = dutyOf(a.name, s) || '—';
      var line = el('div', { class: 'abs-sess' });
      line.appendChild(el('span', { class: 'badge ' + (s === 'am' ? 'badge-am' : 'badge-pm'), text: s.toUpperCase() }));
      line.appendChild(el('span', { class: 'abs-duty' }, ['would be ', el('b', { text: duty })]));
      line.appendChild(el('span', { class: 'abs-arrow', text: 'covered by' }));
      var noCover = ((data().availability || {}).noCoverTexts || ['PT', 'Day Float']).indexOf(duty) !== -1;
      line.appendChild(residentPicker(a[key], function (v) { a[key] = v; outChanged(); }, {
        session: s, hideNames: [a.name].concat(others), emptyLabel: noCover ? 'no cover needed…' : 'covered by…',
        extra: [{ value: 'NC', text: 'NC — not covered' }]
      }));
      var cov = a[key];
      if (cov && cov !== 'NC') {
        var own = dutyOf(cov, s);
        if (own) line.appendChild(el('span', { class: 'field-hint', text: cov + ' leaves ' + own }));
      } else if (!cov && !noCover) {
        line.appendChild(el('span', { class: 'unassigned-text', text: 'decide: someone or NC' }));
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
    var d = parseISO(st.date);
    var n = strengthCount();

    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', {}, [
      'Who’s out — ' + weekdayName(d) + ' ' + fmtMDYY(d) + ' ',
      el('span', { class: 'h-note', text: 'step 1 of the how-to: vacation, sick, conferences — check the Google Calendar' })
    ]));
    if (!(r.residents || []).length) {
      card.appendChild(el('p', { class: 'empty-note', text: 'No block schedule for this date — pick a weekday inside the academic year.' }));
      host.appendChild(card);
      return;
    }

    var named = st.absences.filter(function (a) { return trim(a.name); });
    if (!st.absences.length) {
      if (st.outConfirmed) {
        card.appendChild(el('div', { class: 'ok-banner' }, [
          el('span', { text: '✓ No resident vacation — ' + n + ' strong' }),
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
    host.appendChild(card);

    // Night Float — automatic, and the Day Float rule made visible
    var b = App.board;
    var nf = b && b.nightFloat;
    if (nf) {
      var nfCard = el('div', { class: 'card' });
      nfCard.appendChild(el('h2', {}, ['Night Float ', el('span', { class: 'h-note', text: 'from the call schedule — change it on the Roster tab' })]));
      var nfAbs = b.absences.filter(function (x) { return x.auto; })[0];
      var duty = [dutyOf(nf, 'am'), dutyOf(nf, 'pm')];
      var dutyStr = duty[0] === duty[1] ? duty[0] : duty.filter(Boolean).join(' / ');
      var txt = nf + ' is on Night Float — out for the day (post-call).';
      if (nfAbs && nfAbs.coverAM) txt += ' Day Float ' + nfAbs.coverAM + ' covers ' + nf + '’s ' + (dutyStr || 'daytime') + '.';
      else if ((b.dayFloats || []).indexOf(nf) !== -1) txt += ' ' + nf + ' is also the Day Float, so there is no Day Float today — nothing to cover.';
      else txt += ' No Day Float on the roster today — ' + nf + '’s ' + (dutyStr || 'daytime') + ' is uncovered.';
      nfCard.appendChild(el('p', { class: 'ref-para', text: txt }));
      nfCard.appendChild(el('p', { class: 'field-hint', text: 'Day Float only ever covers the Night Float resident — never vacations.' }));
      host.appendChild(nfCard);
    }

    var notes = el('div', { class: 'card' });
    notes.appendChild(el('h2', {}, ['Other notes for the Vacation section ', el('span', { class: 'h-note', text: 'optional — printed after the lines above' })]));
    var ta = el('textarea', { rows: '2', placeholder: 'e.g. Djulbegovic at AAO Fri' });
    ta.value = st.vacation;
    ta.addEventListener('input', function () { st.vacation = ta.value; touch(); });
    notes.appendChild(ta);
    host.appendChild(notes);

    host.appendChild(stepFoot('roster'));
  }

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

  function setCoverageTime(t, followNow) {
    coverageTime = t;
    coverageFollowNow = !!followNow;
    renderCoverageBody();
    renderAvailStrip();
  }

  var KIND_CLASS = { free: 'k-free', 'case': 'k-case', clinic: 'k-clinic', duty: 'k-duty', out: 'k-out', off: 'k-off' };

  function timeBar(t) {
    var S = window.Status;
    var bar = el('div', { class: 'toolbar card-lite time-bar' });
    bar.appendChild(el('span', { class: 'time-label', text: 'As of' }));
    var inp = el('input', { type: 'time', value: S.fmtHHMM(t).replace(/^(\d\d)(\d\d)$/, '$1:$2'), step: '300' });
    inp.addEventListener('change', function () {
      var m = /^(\d{1,2}):(\d{2})/.exec(inp.value);
      if (m) setCoverageTime((+m[1]) * 60 + (+m[2]), false);
    });
    bar.appendChild(inp);
    if (isToday()) {
      bar.appendChild(el('button', {
        type: 'button', class: 'btn btn-small' + (coverageFollowNow ? ' btn-primary' : ''), text: 'Now',
        onclick: function () { setCoverageTime(null, true); }
      }));
    }
    [[450, '7:30'], [600, '10:00'], [780, '1:00'], [900, '3:00']].forEach(function (p) {
      bar.appendChild(el('button', {
        type: 'button', class: 'btn btn-small' + (!coverageFollowNow && t === p[0] ? ' btn-primary' : ''), text: p[1],
        onclick: function () { setCoverageTime(p[0], false); }
      }));
    });
    bar.appendChild(el('span', {
      class: 'toolbar-note',
      text: isToday() ? 'Today — follows the clock unless you pick a time.' : 'Planning view — pick a time to test.'
    }));
    return bar;
  }

  function freeCard(t) {
    var S = window.Status;
    var b = App.board;
    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', {}, ['Free at ' + S.fmtClock(t) + ' ', el('span', { class: 'h-note', text: 'no clinic, no case, not out — CPEC, PT, or a Surg/OR block with nothing booked' })]));
    var free = b.freeAt(t);
    var seniors = free.filter(function (n) { return b.byName[n].year === 'pgy4'; });
    var juniors = free.filter(function (n) { return b.byName[n].year !== 'pgy4'; });
    [['Seniors', seniors], ['Juniors', juniors]].forEach(function (g) {
      var row = el('div', { class: 'free-row' }, [el('span', { class: 'free-label', text: g[0] })]);
      if (!g[1].length) row.appendChild(el('span', { class: 'empty-note', text: 'nobody free' }));
      g[1].forEach(function (n) {
        var st = b.statusAt(n, t);
        var until = nextChange(n, t);
        row.appendChild(el('span', { class: 'free-chip ' + yearOf(n) }, [
          el('b', { text: n }),
          el('span', { class: 'free-sub', text: st.label + (until ? ' · until ' + S.fmtClock(until) : '') })
        ]));
      });
      card.appendChild(row);
    });
    var pull = b.order.filter(function (n) { return b.statusAt(n, t).kind === 'clinic'; });
    if (pull.length) {
      card.appendChild(el('p', { class: 'field-hint' }, [
        el('b', { text: 'In clinic (can be pulled, then someone covers): ' }),
        pull.map(function (n) { var st = b.statusAt(n, t); return n + ' (' + (st.clinic || st.label) + ')'; }).join(', ')
      ]));
    }
    return card;
  }

  // When does this resident's status next change after t? (for "free until")
  function nextChange(name, t) {
    var b = App.board;
    var segs = b.segments(name);
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].start <= t && t < segs[i].end) return segs[i].end < b.dayEnd ? segs[i].end : null;
    }
    return null;
  }

  function planCard(t) {
    var S = window.Status;
    var b = App.board;
    var card = el('div', { class: 'card plan-card' });
    card.appendChild(el('h2', {}, ['If something comes in at ' + S.fmtClock(t) + ' ', el('span', { class: 'h-note', text: 'walks the how-to chain against who is busy right then' })]));
    var kinds = el('div', { class: 'plan-kinds' });
    (window.Assign.ADDON_KINDS || []).forEach(function (k) {
      kinds.appendChild(el('button', {
        type: 'button', class: 'filter-chip' + (planKind === k.key ? ' active' : ''), text: k.label,
        onclick: function () { planKind = k.key; renderCoverageBody(); }
      }));
    });
    card.appendChild(kinds);

    var plan = window.Assign.planAddOn(planKind, t, App.roster, data(), b);
    card.appendChild(el('div', { class: 'field-hint plan-chain', text: plan.hierLabel + ' chain, then the remaining-cases chain, then any free senior, then any free junior.' }));
    var ol = el('ol', { class: 'plan-steps' });
    var shownAlt = 0;
    plan.steps.some(function (s) {
      if (s.verdict === 'alt') { if (shownAlt >= 2) return true; shownAlt++; }
      var li = el('li', { class: 'plan-step ' + s.verdict }, [
        el('span', { class: 'plan-verdict', text: s.verdict === 'take' ? '✓ takes it' : s.verdict === 'skip' ? 'skip' : 'next' }),
        el('b', { text: s.name }),
        el('span', { class: 'plan-via', text: ' ' + s.via }),
        el('span', { class: 'plan-why', text: ' — ' + (s.why || statusBrief(s.status)) })
      ]);
      ol.appendChild(li);
      return false;
    });
    card.appendChild(ol);

    if (!plan.pick) {
      card.appendChild(el('div', { class: 'warn-line bad', text: '⚠ Nobody is free — this one needs the chiefs.' }));
      return card;
    }
    var ho = plan.handoff;
    if (ho) {
      var hoText = plan.pick.name + ' leaves ' + ho.clinic + (ho.owner !== plan.pick.name ? ' (covering for ' + ho.owner + ')' : '') + ' → ';
      card.appendChild(el('div', { class: 'handoff ' + (ho.primary ? '' : 'bad') }, [
        hoText,
        ho.primary ? el('b', { text: ho.primary.name }) : el('b', { text: 'nobody free to cover' }),
        ho.primary ? ' (' + ho.primary.source + ') covers ' + ho.clinic + ' ' + S.fmtClock(ho.window.start) + '–' + S.fmtClock(ho.window.end) : ''
      ]));
    }
    var def = (window.Assign.ADDON_KINDS || []).filter(function (k) { return k.key === planKind; })[0] || {};
    card.appendChild(el('div', { class: 'plan-actions' }, [
      el('button', {
        type: 'button', class: 'btn btn-primary',
        text: 'Add it as an add-on case → ' + plan.pick.name + (ho && ho.primary ? ' (backup ' + ho.primary.name + ')' : ''),
        onclick: function () {
          var c = newCase('wills');
          c.category = def.category || 'trauma';
          c.addOn = true;
          c.count = 1;
          c.serviceCount = 1;
          // The surgeon is rarely known yet — name the case by its kind so the
          // copied line reads '-Globe x1 (1330 start) - …', never '-? x1'.
          c.surgeon = def.key === 'globe' ? 'Globe/trauma' : (def.label || 'Add-on');
          c.notes = 'surgeon TBD';
          c.start = S.fmtHHMM(t);
          c.assigned = plan.pick.name;
          if (ho && ho.primary) {
            c.backup = ho.primary.name;
            c.backupNote = 'to cover ' + ho.clinic.toLowerCase() + ' clinic' + (ho.owner !== plan.pick.name ? ' (for ' + ho.owner + ')' : '') + ' during case';
          }
          App.state.cases.push(c);
          caseSectionOpen.wills = true;
          touch();
          refreshEverything();
          toast(def.label + ' added at ' + S.fmtClock(t) + ' → ' + plan.pick.name + ' — fill in the surgeon on Surgery');
        }
      }),
      el('span', { class: 'field-hint', text: 'Adds it to Surgery (Wills/ASC) so the board, clinics and the copied schedule all follow.' })
    ]));
    return card;
  }

  function boardCard(t) {
    var S = window.Status;
    var b = App.board;
    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', {}, ['Everyone’s day ', el('span', { class: 'h-note', text: '7 AM – 5 PM · the line is ' + S.fmtClock(t) })]));
    var legend = el('div', { class: 'tl-legend' });
    [['free', 'free'], ['case', 'in a case'], ['clinic', 'clinic'], ['duty', 'ER / consults / Day Float / off-site'], ['out', 'out']].forEach(function (k) {
      legend.appendChild(el('span', { class: 'tl-key' }, [el('span', { class: 'tl-swatch ' + KIND_CLASS[k[0]] }), k[1]]));
    });
    card.appendChild(legend);
    var span = b.dayEnd - b.dayStart;
    var pct = function (m) { return ((Math.min(Math.max(m, b.dayStart), b.dayEnd) - b.dayStart) / span * 100).toFixed(2) + '%'; };
    // Surg roles first (in order), then the rest by year
    var order = [];
    Object.keys(b.surgRole).forEach(function (n) { order.push(n); });
    order.sort(function (x, y) { return (+b.surgRole[x]) - (+b.surgRole[y]); });
    ['pgy4', 'pgy3', 'pgy2'].forEach(function (yk) {
      b.order.forEach(function (n) { if (b.byName[n].year === yk && order.indexOf(n) === -1) order.push(n); });
    });
    var groupLabel = { pgy4: 'PGY-4', pgy3: 'PGY-3', pgy2: 'PGY-2' };
    var lastGroup = '';
    order.forEach(function (n) {
      var g = b.surgRole[n] ? 'surg' : b.byName[n].year;
      if (g !== lastGroup) {
        card.appendChild(el('div', { class: 'tl-group', text: g === 'surg' ? 'Surg roles' : groupLabel[g] }));
        lastGroup = g;
      }
      var st = b.statusAt(n, t);
      var row = el('div', { class: 'tl-row' });
      row.appendChild(el('div', { class: 'tl-name' }, [
        el('span', { class: 'res-name ' + b.byName[n].year, text: n }),
        b.surgRole[n] ? el('span', { class: 'tl-role', text: 'Surg ' + b.surgRole[n] }) : null
      ]));
      var track = el('div', { class: 'tl-track' });
      b.segments(n).forEach(function (sg) {
        if (sg.kind === 'off') return;
        track.appendChild(el('span', {
          class: 'tl-seg ' + KIND_CLASS[sg.kind],
          style: 'left:' + pct(sg.start) + ';width:calc(' + pct(sg.end) + ' - ' + pct(sg.start) + ')',
          title: S.fmtClock(sg.start) + '–' + S.fmtClock(sg.end) + ': ' + sg.label
        }));
      });
      track.appendChild(el('span', { class: 'tl-now', style: 'left:' + pct(t) }));
      track.appendChild(el('span', { class: 'tl-noon', style: 'left:' + pct(b.noon) }));
      row.appendChild(track);
      row.appendChild(el('div', { class: 'tl-status ' + KIND_CLASS[st.kind], text: statusShort(st) }));
      card.appendChild(row);
    });
    return card;
  }

  function renderCoverageTab() {
    renderCoverageBody();
    renderAddOnsCard();
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
    host.appendChild(timeBar(t));
    var needsHost = el('div');
    renderNeedsCard(needsHost, 'Needs coverage', 'fix here or on Clinics / Out today');
    host.appendChild(needsHost);
    var grid = el('div', { class: 'cov-grid' }, [freeCard(t), planCard(t)]);
    host.appendChild(grid);
    host.appendChild(boardCard(t));
  }

  /* ------------------------------------------------------------------ */
  /* availability strip + tab badges (visible on every workflow tab)     */
  /* ------------------------------------------------------------------ */

  function renderAvailStrip() {
    var host = $('availStrip');
    if (!host) return;
    clearNode(host);
    var b = App.board;
    var S = window.Status;
    var show = WORKFLOW_TABS.indexOf(App.activeTab) !== -1 && b && b.order.length && S;
    host.classList.toggle('hidden', !show);
    if (!show) return;
    function list(items) {
      if (!items.length) return [el('span', { class: 'strip-none', text: 'nobody' })];
      return items.map(function (x, i) {
        return el('span', { class: 'strip-name ' + yearOf(x.name) + (x.partial ? ' partial' : ''), title: x.title || '' },
          [x.name + (x.partial ? ' ' + x.partial : '') + (i < items.length - 1 ? ',' : '')]);
      });
    }
    function sessionItems(s) {
      return b.freeInSession(s).map(function (x) {
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
    if (isToday()) {
      var now = nowMinutes();
      if (now >= S.DAY_START && now < S.DAY_END) {
        inner.appendChild(el('span', { class: 'strip-part' }, [el('b', { class: 'strip-key', text: 'Free now (' + S.fmtClock(now) + '):' })].concat(
          list(b.freeAt(now).map(function (n) { return { name: n, title: b.statusAt(n, now).label }; })))));
      }
    }
    inner.appendChild(el('span', { class: 'strip-part' }, [el('b', { class: 'strip-key', text: 'Free AM:' })].concat(list(sessionItems('am')))));
    inner.appendChild(el('span', { class: 'strip-part' }, [el('b', { class: 'strip-key', text: 'Free PM:' })].concat(list(sessionItems('pm')))));
    var nNeeds = b.needs.length;
    inner.appendChild(el('button', {
      type: 'button', class: 'strip-link' + (nNeeds ? ' warn' : ''),
      text: nNeeds ? '⚠ ' + nNeeds + ' need coverage →' : 'Coverage →',
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
    var needRes = (st.cases || []).filter(needsResident).length;
    setBadge('badge-surgery', needRes ? String(needRes) : '', 'warn');
    var clinicGaps = b ? b.needs.filter(function (n) { return n.type === 'clinic'; }).length : 0;
    setBadge('badge-clinics', clinicGaps ? String(clinicGaps) : '', 'warn');
    var all = b ? b.needs.length : 0;
    setBadge('badge-coverage', all ? String(all) : '', 'warn');
  }

  function stepFoot(next) {
    var wrap = el('div', { class: 'step-foot-inner' });
    if (next && TAB_TITLES[next]) {
      wrap.appendChild(el('button', {
        type: 'button', class: 'btn btn-primary', text: 'Next: ' + TAB_TITLES[next] + ' →',
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
  /* tab 4 — Preview & Copy                                              */
  /* ------------------------------------------------------------------ */

  function renderPreview() {
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
  /* How-to view — friendly onboarding cards (static)                    */
  /* ------------------------------------------------------------------ */

  function bulletList(items, cls) {
    var u = el('ul', { class: 'ref-note-list' + (cls ? ' ' + cls : '') });
    items.forEach(function (t) { u.appendChild(el('li', { text: t })); });
    return u;
  }

  var CHAIN_TOKEN_LABELS = {
    COOPER: 'Cooper (PGY-4)',
    WILLS_OR: 'Wills OR',
    RETINA: 'Retina',
    PEDS_OR_JUNIOR: 'junior on Peds OR',
    FREE_JUNIOR: 'free junior',
    PLASTICS_OR_PGY2: 'PGY-2 on Plastics OR',
    PLASTICS_OR_JUNIOR: 'junior on Plastics OR'
  };

  function chainText(key, fallback) {
    var h = (data().hierarchy || {})[key];
    if (!h || !(h.chain || []).length) return fallback;
    return h.chain.map(function (tok) { return CHAIN_TOKEN_LABELS[tok] || tok; }).join(' → ');
  }

  /* ------------------------------------------------------------------ */
  /* tab — CPEC Block Schedule (full sheet reference)                    */
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
      el('span', { class: 'h-note', text: 'effective ' + fmtMDYY(parseISO(sheet.effective)) + ' — rows are the 1st–5th weekday of each calendar month' })
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
    card.appendChild(el('div', { class: 'table-scroll' }, [tbl]));
    card.appendChild(el('p', { class: 'field-hint', text: 'Sites: SP = Stadium, CH = Cherry Hill. Starred entries operate only in the listed months. The highlighted cell is the selected schedule date; use the card on Cases & Clinics to add that day’s attendings as cases.' }));
    host.appendChild(card);
  }

  function renderHowto() {
    var host = $('howtoBody');
    if (!host) return;
    clearNode(host);

    // 1. The flow — the six numbered tabs, in the how-to's order
    var flow = refCard('The flow');
    [
      { tab: 'out', num: '1', title: 'Out today', text: 'Check the Google Calendar first. Press “No one out”, or add who is out (all day / AM / PM) and pick who covers each session — or NC. Anyone out disappears from every dropdown.' },
      { tab: 'roster', num: '2', title: 'Roster', text: 'Everyone’s block assignment, Surg 1–5 (Surg 3 and 4 are all day), WER, consults and clinics fill in automatically. Night Float comes from the call schedule; Day Float covers only the Night Float resident.' },
      { tab: 'surgery', num: '3', title: 'Surgery', text: 'Add the CPEC-sheet cataracts, then copy the rest of the case list out of Cerner/NextGen. Each case shows the suggested resident — one click to accept — and the dropdowns show who is free at that time.' },
      { tab: 'clinics', num: '4', title: 'Clinics', text: 'Patient counts from the EMRs. Each clinic shows who is out or pulled into a case and who covers; anything left short is listed at the top.' },
      { tab: 'coverage', num: '5', title: 'Coverage', text: 'Who is free right now (or at any time you pick), what happens if a globe comes in, every resident’s day on one screen, and the add-on call names.' },
      { tab: 'preview', num: '6', title: 'Preview & Copy', text: 'The document, exactly in the usual format — Copy formatted and paste.' }
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
    host.appendChild(flow);

    // 2. What fills itself in vs what you type
    var av = refCard('What fills itself in — and what you type');
    av.appendChild(el('div', { class: 'howto-cols' }, [
      el('div', { class: 'howto-col' }, [
        el('h3', { text: 'Fills itself in' }),
        bulletList([
          'Rosters & block assignments for every resident',
          'Surg 1–5 roles',
          'WER & Jeff/Cooper consult coverage',
          'Clinic staffing',
          'Cooper buddies (from the buddy call schedule)',
          'Special clinic days (Bilyk, Wasserman, …)'
        ])
      ]),
      el('div', { class: 'howto-col' }, [
        el('h3', { text: 'You type' }),
        bulletList([
          'Cases from the EMRs',
          'Clinic patient counts',
          'Night float',
          'Add-ons (call coverage)',
          'Vacation',
          'Lectures & events'
        ])
      ])
    ]));
    av.appendChild(el('p', { class: 'field-hint howto-note', text: 'Several EMRs, no interfaces — the case list is deliberately manual.' }));
    host.appendChild(av);

    // 3. The rules in 30 seconds — condensed chains (pulled from SCHED_DATA)
    var rules = refCard('The rules in 30 seconds');
    rules.appendChild(bulletList([
      'Scheduled cornea → Surg 3. Scheduled glaucoma → Surg 4.',
      'Cataracts → ' + chainText('scheduledCataract', 'Surg 1 → Surg 5 → Wills OR') + ' (per the lounge-wall block schedule).',
      'Peds → ' + chainText('peds', 'junior on Peds OR → free junior → Surg 4 → Surg 3') + '.',
      'Trauma → Surg 2 first (unless corneal tissue is needed — then cornea).',
      'Everything else, chronologically: ' + chainText('remaining', 'Surg 2 → Surg 3 → Surg 4 → Cooper → Surg 1 → Surg 5') + '.',
      'Clinic coverage: ' + chainText('clinicCoverage', 'Surg 2 → Surg 3 → Surg 4 → Cooper → Surg 1 → Surg 5 → Wills OR → Retina') + '.'
    ], 'howto-rules'));
    rules.appendChild(el('div', { class: 'howto-foot' }, [
      el('span', { class: 'field-hint', text: 'Full chains, notes, and the block grids live in the Reference tab.' }),
      el('button', {
        type: 'button', class: 'btn btn-small', text: 'Open Reference',
        onclick: function () { setTab('reference'); }
      })
    ]));
    host.appendChild(rules);

    // 4. Tips for new schedulers — from the how-to deck
    var tips = refCard('Tips for new schedulers');
    tips.appendChild(bulletList([
      'Check the Google Calendar for lectures and vacations first — before anything else.',
      'Surg 3 and Surg 4 should reach out to the attendings about their scheduled cases beforehand.',
      'The schedule is built the evening before — expect late changes and add-ons.',
      'Surg 2 is the boss — give them some grace.'
    ]));
    if (data().quote) tips.appendChild(el('p', { class: 'ref-quote howto-quote', text: data().quote }));
    host.appendChild(tips);
  }

  /* ------------------------------------------------------------------ */
  /* tab 5 — Reference                                                   */
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
    var hTbl = el('table', { class: 'tbl' });
    hTbl.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Case type' }), el('th', { text: 'Chain' }), el('th', { text: 'Note' })
    ])]));
    var hBody = el('tbody');
    Object.keys(d.hierarchy || {}).forEach(function (key) {
      var h = d.hierarchy[key];
      hBody.appendChild(el('tr', {}, [
        el('td', {}, [el('strong', { text: h.label })]),
        el('td', { text: (h.chain || []).join(' → ') }),
        el('td', {}, [el('span', { class: 'field-hint', text: h.note || '' })])
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
      text: 'All schedule knowledge lives in one configuration object — the block schedules and ' +
        'block dates, the CPEC surgical block sheet, Cooper buddy call, the Night Float schedule, ' +
        'and the assignment hierarchy. Download it, edit or replace the data for the new academic ' +
        'year, then upload it back. Uploaded configurations live only in this browser — nothing is sent anywhere.'
    }));
    host.appendChild(intro);

    // 2. Download
    var dl = refCard('Download current configuration');
    dl.appendChild(el('p', {
      class: 'field-hint setup-hint',
      text: 'Saves the ACTIVE configuration (including any import) as surg-schedule-config.json.'
    }));
    dl.appendChild(el('button', {
      type: 'button', class: 'btn btn-primary', text: 'Download configuration (JSON)',
      onclick: downloadConfig
    }));
    host.appendChild(dl);

    // 3. Upload (file input + paste alternative)
    var up = refCard('Upload configuration');
    up.appendChild(el('p', {
      class: 'field-hint setup-hint',
      text: 'Pick the edited JSON file — or paste its contents below. It is validated before it replaces anything.'
    }));
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
    saveNow(); // flush pending edits for the old date
    App.state = loadState(dateISO);
    stateDirty = false;   // freshly loaded — nothing user-edited yet
    refreshAddOnsForDate(); // untouched add-on rows follow the schedule date
    coverageTime = null;
    coverageFollowNow = true;
    computeRoster();
    renderAll();
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
    // Carry over who is on call, but re-anchor the dates to THIS schedule day.
    var fresh = defaultAddOns(App.state.date);
    App.state.addOns = Array.isArray(prev.addOns)
      ? prev.addOns.map(function (a, i) {
          return {
            date: (fresh[i] && fresh[i].date) || App.state.date,
            period: (fresh[i] && fresh[i].period) || 'night',
            label: '',
            name: String((a && a.name) || ''),
            auto: !trim(a && a.name)
          };
        })
      : fresh;
    syncAddOnLabels();
    stateDirty = true; // explicit user action — this day now really has content
    saveNow();
    renderAll();
    toast('Copied night float, who’s out, lectures & add-ons from ' + src + (App.state.absences.length ? ' — pick today’s coverers on Out today' : ''));
  }

  function clearDay() {
    if (!window.confirm('Clear everything saved for ' + App.state.date + '? This cannot be undone.')) return;
    lsRemove(LS_PREFIX + App.state.date);
    App.state = defaultState(App.state.date);
    stateDirty = false; // back to untouched — don't resurrect the key on next save
    computeRoster(); // re-prefill Night Float / buddies and rebuild the board
    renderAll();
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

  // Big home button: 'Create Surg Schedule →', or 'Open schedule for M/D/YY'
  // with a 'saved draft' hint when a draft already exists for the chosen date.
  function updateHomeCreate() {
    var hd = $('homeDate');
    var btn = $('btnHomeCreate');
    var hint = $('homeDraftHint');
    if (!hd || !btn) return;
    var v = hd.value;
    var hasDraft = !!(v && lsGet(LS_PREFIX + v));
    if (hasDraft) {
      btn.textContent = 'Open schedule for ' + fmtMDYY(parseISO(v));
      if (hint) {
        hint.textContent = 'saved draft — picks up right where you left off';
        hint.classList.remove('hidden');
      }
    } else {
      btn.textContent = 'Create Surg Schedule →';
      if (hint) {
        hint.textContent = '';
        hint.classList.add('hidden');
      }
    }
  }

  function renderHome() {
    var hd = $('homeDate');
    if (hd && !hd.value) hd.value = tomorrowISO();
    updateHomeCreate();
    var host = $('homeRecent');
    if (!host) return;
    clearNode(host);
    var dates = savedDayISOs();
    dates.reverse();
    dates = dates.slice(0, 4);
    if (!dates.length) {
      host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
    host.appendChild(el('span', { class: 'home-recent-label', text: 'Recent days' }));
    dates.forEach(function (dISO) {
      var d = parseISO(dISO);
      host.appendChild(el('button', {
        type: 'button', class: 'chip chip-recent',
        text: WEEKDAY_NAMES[d.getDay()].slice(0, 3) + ' ' + fmtMDYY(d),
        onclick: function () { enterApp(dISO); }
      }));
    });
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

  var VALID_ROUTES = ['home', 'out', 'roster', 'surgery', 'clinics', 'coverage', 'preview', 'howto', 'cpec', 'reference', 'setup'];
  // Links saved before the Surgery/Clinics split keep working.
  var ROUTE_ALIASES = { cases: 'surgery', assign: 'surgery' };

  function routeFromHash() {
    var h = String(window.location.hash || '').replace(/^#\/?/, '');
    if (ROUTE_ALIASES[h]) h = ROUTE_ALIASES[h];
    return VALID_ROUTES.indexOf(h) !== -1 ? h : null;
  }

  // Record the applied route and mirror it into the URL. Writing
  // location.hash pushes a history entry; when the change came FROM the
  // hash (Back/Forward), the hash already matches and nothing is written.
  function syncHash(route, replace) {
    App.currentRoute = route;
    var target = '#/' + route;
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
    if (!route || route === App.currentRoute) return;
    if (route === 'home') {
      goHome();
    } else if (document.body.classList.contains('home-active')) {
      // Deep link / Forward into a tab while sitting on Home.
      var hd = $('homeDate');
      enterApp((hd && hd.value) || tomorrowISO(), route);
    } else {
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
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
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
    // changed (an absence, a case, a clinic edit) shows up in the next.
    if (WORKFLOW_TABS.indexOf(tab) !== -1) { computeBoard(); computeSuggestions(); }
    if (tab === 'out') renderOutTab();
    if (tab === 'roster') renderRosterTab();
    if (tab === 'surgery') renderSurgeryTab();
    if (tab === 'clinics') renderClinicsTab();
    if (tab === 'coverage') renderCoverageTab();
    if (tab === 'preview') renderPreview();
    if (tab === 'cpec') renderCpecReference(); // re-render so the selected date's cell is highlighted
    if (tab === 'setup') renderSetup(); // status line + saved-day count stay fresh
    // 'howto' and 'reference' are static — rendered once at boot.
    renderAvailStrip();
    renderBadges();
    syncHash(tab);
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

    // Library menu (How-to, CPEC sheet, block schedules, Setup)
    var libBtns = document.querySelectorAll('#libMenu [data-lib]');
    for (var li = 0; li < libBtns.length; li++) {
      (function (btn) {
        btn.addEventListener('click', function () { setTab(btn.getAttribute('data-lib')); });
      })(libBtns[li]);
    }
    renderStepFoots();
    function closeMoreMenu() {
      var m = $('moreMenu');
      if (m) m.removeAttribute('open');
    }
    $('btnYesterday').addEventListener('click', function () { closeMoreMenu(); startFromYesterday(); });
    var btnSetupMenu = $('btnSetupMenu');
    if (btnSetupMenu) {
      btnSetupMenu.addEventListener('click', function () { closeMoreMenu(); setTab('setup'); });
    }
    $('btnClear').addEventListener('click', function () { closeMoreMenu(); clearDay(); });
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
        toast(ok ? 'Formatted schedule copied' : 'Copy failed — select the preview text and copy manually', ok);
      });
    });
    $('btnCopyText').addEventListener('click', function () {
      window.ExportFmt.copyText(exportDay()).then(function (ok) {
        toast(ok ? 'Plain-text schedule copied' : 'Copy failed', ok);
      });
    });
    $('btnCopyAddons').addEventListener('click', function () {
      var any = (App.state.addOns || []).some(function (a) { return a && trim(a.name); });
      if (!any) { toast('No add-ons entered yet — fill them in on Day Roster or Cases & Clinics', false); return; }
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
        enterApp((homeDate && homeDate.value) || tomorrowISO());
      });
    }
    var btnHomeHowto = $('btnHomeHowto');
    if (btnHomeHowto) {
      btnHomeHowto.addEventListener('click', function () {
        enterApp((homeDate && homeDate.value) || tomorrowISO(), 'howto');
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

    window.addEventListener('beforeunload', saveNow);

    // First render. A stored override that passed validation can still crash
    // a renderer — that must never brick the boot (Reference/Howto/CPEC empty,
    // routing dead, Setup unreachable), so fall back to the built-in data and
    // surface the problem instead. The dead blob stays in localStorage;
    // renderSetup shows it with a Remove button.
    function firstRender() {
      renderReference();
      renderHowto();
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
      enterApp(initial, initialRoute);
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
