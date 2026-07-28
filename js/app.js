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

  var App = {
    state: null,     // per-date persisted state (SPEC state shape)
    roster: null,    // Engine DayRoster for state.date
    activeTab: 'roster'
  };

  // Local UI state — never persisted.
  var assignFilter = 'needs';                 // 'needs' | 'assigned' | 'all'
  var assignExpanded = {};                    // caseId -> true (compact row expanded inline)
  var caseSectionOpen = { wills: true, private: true, jhn: true, other: true };

  function data() { return window.SCHED_DATA; }

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
  function defaultAddOns() {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    return [
      { label: weekdayName(today) + ' night (' + fmtMDYY(today) + ')', name: '' },
      { label: weekdayName(tomorrow) + ' day (' + fmtMDYY(tomorrow) + ')', name: '' },
      { label: weekdayName(tomorrow) + ' night (' + fmtMDYY(tomorrow) + ')', name: '' }
    ];
  }

  function defaultState(dateISO) {
    return {
      date: dateISO,
      lectures: '',
      nightFloat: '',
      vacation: '24 strong',
      cooperBuddyAM: { name: '', note: '' },
      cooperBuddyPM: { name: '', note: '' },
      addOns: defaultAddOns(),
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
      backupNote: String(c.backupNote || '')
    };
  }

  function normalizeState(raw, dateISO) {
    var st = (raw && typeof raw === 'object') ? raw : {};
    var out = defaultState(dateISO);
    if (typeof st.lectures === 'string') out.lectures = st.lectures;
    if (typeof st.nightFloat === 'string') out.nightFloat = st.nightFloat;
    if (typeof st.vacation === 'string') out.vacation = st.vacation;
    if (st.cooperBuddyAM) out.cooperBuddyAM = normBuddy(st.cooperBuddyAM);
    if (st.cooperBuddyPM) out.cooperBuddyPM = normBuddy(st.cooperBuddyPM);
    if (Array.isArray(st.addOns)) {
      out.addOns = st.addOns.map(function (a) {
        return { label: String((a && a.label) || ''), name: String((a && a.name) || '') };
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

  // Call after every manual input: debounced persist + live preview refresh.
  function touch() {
    stateDirty = true;
    scheduleSave();
    if (App.activeTab === 'preview') renderPreview();
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

  /* ------------------------------------------------------------------ */
  /* header                                                              */
  /* ------------------------------------------------------------------ */

  function renderHeader() {
    $('ayLabel').textContent = data().ayLabel;
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

  function cellDiv(cell) {
    var isSurg = /^Surg \d+$/.test(cell.text || '');
    var wrap = el('div', {}, [
      el('div', { class: 'cell-text' + (isSurg ? ' is-surg' : ''), text: cell.text || '—' })
    ]);
    (cell.notes || []).forEach(function (n) {
      wrap.appendChild(el('div', { class: 'cell-note', text: n }));
    });
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
        tbody.appendChild(el('tr', {}, [
          nameTd,
          el('td', {}, [el('span', { class: 'res-block', text: 'B' + res.block })]),
          el('td', {}, [cellDiv(res.am)]),
          el('td', {}, [cellDiv(res.pm)])
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
      if (s.am && !s.pm) tile.appendChild(el('div', { class: 'glance-sess', text: 'AM only · PM: ' + (s.pmText || '—') }));
      else if (s.pm && !s.am) tile.appendChild(el('div', { class: 'glance-sess', text: 'PM only · AM: ' + (s.amText || '—') }));
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
    if ((r.dayFloat || []).length) row.appendChild(glanceKV('Day Float', r.dayFloat.join(', ')));
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

  function renderManualInputs() {
    var host = $('manualInputs');
    clearNode(host);
    var st = App.state;

    var lectures = el('textarea', { rows: '3', placeholder: 'Grand rounds, wet lab, journal club…' });
    lectures.value = st.lectures;
    lectures.addEventListener('input', function () { st.lectures = lectures.value; touch(); });
    host.appendChild(labeledField('Lectures / Events', lectures));

    var nf = el('input', { type: 'text', placeholder: 'resident name', value: st.nightFloat });
    nf.addEventListener('input', function () { st.nightFloat = nf.value; touch(); renderSummary(); });
    host.appendChild(labeledField('Night Float', nf));

    var buddies = el('div', {}, [
      buddyRow('AM', st.cooperBuddyAM),
      buddyRow('PM', st.cooperBuddyPM)
    ]);
    var buddiesField = labeledField('Cooper buddies', buddies);
    buddiesField.appendChild(el('span', { class: 'field-hint hidden', id: 'buddyHint' }));
    host.appendChild(buddiesField);
    updateBuddyHint();

    var vac = el('textarea', { rows: '2', placeholder: '24 strong' });
    vac.value = st.vacation;
    vac.addEventListener('input', function () { st.vacation = vac.value; touch(); });
    host.appendChild(labeledField('Vacation', vac));

    var addOnsField = labeledField('Add-ons (call coverage)', addOnsEditor());
    addOnsField.classList.add('field-wide');
    host.appendChild(addOnsField);
  }

  // Shared add-ons editor — rendered on both the Day Roster tab and the
  // Cases & Clinics tab; both views edit the same rows.
  function addOnsEditor() {
    var st = App.state;
    var wrap = el('div');
    st.addOns.forEach(function (row, idx) {
      var line = el('div', { class: 'addon-row' });
      var label = el('input', { type: 'text', placeholder: 'e.g. Tuesday night (7/21/26)', value: row.label });
      label.addEventListener('input', function () { row.label = label.value; touch(); });
      line.appendChild(label);
      line.appendChild(residentSelect(row.name, function (v) { row.name = v; touch(); }, 'resident…'));
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
        st.addOns.push({ label: '', name: '' });
        touch();
        renderAddOnsEverywhere();
      }
    }));
    return wrap;
  }

  function renderAddOnsCard() {
    var host = $('addOnsCases');
    if (!host) return;
    clearNode(host);
    host.appendChild(addOnsEditor());
  }

  function renderAddOnsEverywhere() {
    renderManualInputs();
    renderAddOnsCard();
  }

  function renderRosterTab() {
    renderRosterGrid();
    renderSummary();
    renderManualInputs();
  }

  /* ------------------------------------------------------------------ */
  /* tab 2 — Cases & Clinics                                             */
  /* ------------------------------------------------------------------ */

  function newCase(section) {
    var id = 'c' + App.state.seq;
    App.state.seq += 1;
    return {
      id: id, section: section, surgeon: '', count: 1,
      serviceCount: section === 'private' ? 0 : 1,
      start: '', serviceTimes: '', category: 'cataract', addOn: false,
      notes: '', assigned: '', backup: ''
    };
  }

  function addCase(section) {
    App.state.cases.push(newCase(section));
    touch();
    renderCasesTab();
  }

  function removeCase(id) {
    App.state.cases = App.state.cases.filter(function (c) { return c.id !== id; });
    if (App.state.suggestions) delete App.state.suggestions[id];
    touch();
    renderCasesTab();
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
    App.state.cases.splice(idx + 1, 0, copy);
    touch();
    renderCasesTab();
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

  function caseCard(c) {
    var card = el('div', { class: 'case-card', 'data-case-id': c.id });

    card.appendChild(miniField('Surgeon',
      textInput(c.surgeon, 'Surgeon', function (v) { c.surgeon = v; touch(); }), 'cf-surgeon'));
    card.appendChild(miniField('Cases',
      numInput(c.count, function (v) { c.count = v; touch(); }), 'cf-num'));
    card.appendChild(miniField('Service',
      numInput(c.serviceCount, function (v) { c.serviceCount = v; touch(); }), 'cf-num'));
    card.appendChild(miniField('Start',
      textInput(c.start, '0730', function (v) { c.start = v; touch(); }), 'cf-start'));

    var cat = el('select');
    CATEGORIES.forEach(function (k) { cat.appendChild(el('option', { value: k, text: k })); });
    cat.value = c.category;
    cat.addEventListener('change', function () { c.category = cat.value; touch(); });
    card.appendChild(miniField('Category', cat, 'cf-cat'));

    var box = el('input', { type: 'checkbox' });
    box.checked = c.addOn;
    var pill = el('label', { class: 'pill-check' + (c.addOn ? ' on' : '') }, [box, 'Add-on']);
    box.addEventListener('change', function () {
      c.addOn = box.checked;
      pill.classList.toggle('on', box.checked);
      touch();
    });
    card.appendChild(el('div', { class: 'cf-pill' }, [pill]));

    card.appendChild(el('div', { class: 'case-actions' }, [
      el('button', { type: 'button', class: 'btn-icon', title: 'Duplicate case', text: '⧉', onclick: function () { duplicateCase(c.id); } }),
      el('button', { type: 'button', class: 'btn-icon danger', title: 'Remove case', text: '×', onclick: function () { removeCase(c.id); } })
    ]));

    card.appendChild(miniField('Service case time(s)',
      textInput(c.serviceTimes, 'when the resident/service cases are — e.g. 9:30 AM',
        function (v) { c.serviceTimes = v; touch(); }), 'cf-svctimes'));
    card.appendChild(miniField('Notes',
      textInput(c.notes, 'no Peds OR…', function (v) { c.notes = v; touch(); }), 'cf-notes'));
    return card;
  }

  function renderCaseSections() {
    var wrap = $('caseSections');
    clearNode(wrap);
    CASE_SECTIONS.forEach(function (secDef) {
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
      det.appendChild(el('summary', { class: 'case-summary' }, [
        el('span', { class: 'case-summary-title', text: secDef.label }),
        el('span', { class: 'count-badge', text: list.length + (list.length === 1 ? ' case' : ' cases') }),
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
    renderClinicRows();
  }

  function addClinicStaff(label, session, name) {
    if (!name) return;
    var key = label + '|' + session;
    var ov = clinicOverride(key, true);
    var ri = ov.removed.indexOf(name);
    if (ri !== -1) ov.removed.splice(ri, 1);
    else if (ov.added.indexOf(name) === -1) ov.added.push(name);
    touch();
    renderClinicRows();
  }

  function clinicCountEntry(key) {
    var cc = App.state.clinicCounts[key];
    if (!cc) cc = App.state.clinicCounts[key] = { count: '', extra: '' };
    return cc;
  }

  function renderClinicRows() {
    var host = $('clinicRows');
    clearNode(host);
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

        var row = el('div', { class: 'clinic-row' });
        row.appendChild(el('span', { class: 'clinic-label' }, [
          label + ' ',
          el('span', { class: 'badge ' + (session === 'am' ? 'badge-am' : 'badge-pm'), text: session.toUpperCase() })
        ]));

        var chips = el('span', { class: 'clinic-chips' });
        eff.staff.forEach(function (name) {
          chips.appendChild(nameChip(name, function () { removeClinicStaff(label, session, name); }));
        });
        var addSel = residentSelect('', function (v) {
          addClinicStaff(label, session, v);
        }, '+ add…');
        addSel.className = 'clinic-add';
        chips.appendChild(addSel);
        row.appendChild(chips);

        var countIn = el('input', {
          type: 'text', class: 'clinic-count', placeholder: 'e.g. 29x3',
          value: (cc && cc.count) || ''
        });
        countIn.addEventListener('input', function () {
          clinicCountEntry(key).count = countIn.value; touch();
        });
        row.appendChild(countIn);

        var extraIn = el('input', {
          type: 'text', class: 'clinic-extra', placeholder: 'note',
          value: (cc && cc.extra) || ''
        });
        extraIn.addEventListener('input', function () {
          clinicCountEntry(key).extra = extraIn.value; touch();
        });
        row.appendChild(extraIn);

        host.appendChild(row);
      });
    });
    if (!any) host.appendChild(el('p', { class: 'empty-note', text: 'No clinic sessions on this date.' }));
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

  function addCpecCase(e) {
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
    c.assigned = cpecCoverName(e.cover);
    App.state.cases.push(c);
    caseSectionOpen.wills = true;
    touch();
    renderCasesTab();
    toast('Case added from the CPEC sheet — everything stays editable');
  }

  function addCpecPrivate(e) {
    var c = newCase('private');
    c.surgeon = e.attending || '';
    if (e.count != null) c.count = e.count;
    c.serviceCount = 0;
    App.state.cases.push(c);
    caseSectionOpen.private = true;
    touch();
    renderCasesTab();
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
    card.appendChild(el('h2', {}, [
      title + ' ',
      el('span', { class: 'h-note', text: 'attending cataract blocks for this date' })
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

  function renderCasesTab() {
    renderCpecCard();
    renderCaseSections();
    renderClinicRows();
    renderAddOnsCard();
  }

  /* ------------------------------------------------------------------ */
  /* tab 3 — Assign                                                      */
  /* ------------------------------------------------------------------ */

  function suggestAll() {
    if (!window.Assign || !window.Assign.suggest) {
      toast('Assign engine not loaded', false);
      return;
    }
    var results = window.Assign.suggest(App.state.cases, App.roster, data());
    App.state.suggestions = {};
    results.forEach(function (s) { App.state.suggestions[s.caseId] = s; });
    touch();
    renderAssignTab();
    toast('Suggestions computed for ' + results.length + ' case' + (results.length === 1 ? '' : 's'));
  }

  function acceptAll() {
    var n = 0;
    App.state.cases.forEach(function (c) {
      var s = App.state.suggestions[c.id];
      if (s && s.name && !trim(c.assigned)) { c.assigned = s.name; n++; }
    });
    touch();
    renderAssignTab();
    toast(n ? 'Accepted ' + n + ' suggestion' + (n === 1 ? '' : 's') : 'Nothing to accept — suggest first, or all cases already assigned');
  }

  // 'Huang x7 (0730; svc 1030 & 1300)' — start + service-case times.
  function caseTitle(c) {
    var t = (trim(c.surgeon) || '?') + ' x' + c.count;
    var bits = [];
    if (trim(c.start)) bits.push(trim(c.start));
    if (trim(c.serviceTimes)) bits.push('svc ' + trim(c.serviceTimes));
    if (bits.length) t += ' (' + bits.join('; ') + ')';
    return t;
  }

  function sectionLabel(key) {
    for (var i = 0; i < CASE_SECTIONS.length; i++) {
      if (CASE_SECTIONS[i].key === key) return CASE_SECTIONS[i].label;
    }
    return key;
  }

  function assignCaseCard(c, collapsible) {
    var card = el('div', { class: 'assign-card' });
    var head = el('div', { class: 'assign-head' }, [
      el('span', { class: 'assign-title', text: caseTitle(c) }),
      el('span', { class: 'assign-meta', text: sectionLabel(c.section) }),
      el('span', { class: 'badge badge-cat', text: c.category })
    ]);
    if (c.addOn) head.appendChild(el('span', { class: 'badge badge-addon', text: 'ADD-ON' }));
    if (collapsible) {
      head.appendChild(el('button', {
        type: 'button', class: 'btn btn-small assign-collapse', text: 'Done',
        title: 'Collapse back to one line',
        onclick: function () { delete assignExpanded[c.id]; renderAssignTab(); }
      }));
    }
    if (window.Assign && window.Assign.classify) {
      var hier = (data().hierarchy || {})[window.Assign.classify(c)];
      if (hier) head.appendChild(el('span', { class: 'assign-meta', text: '· ' + hier.label }));
    }
    if (c.serviceCount > 0) {
      head.appendChild(el('span', { class: 'assign-meta', text: '· x' + c.serviceCount + ' service' }));
    }
    card.appendChild(head);

    var s = App.state.suggestions[c.id];
    if (s) {
      var accepted = s.name && trim(c.assigned) === s.name;
      var box = el('div', {
        class: 'sugg-box' + (accepted ? ' sugg-accepted' : (s.name ? '' : ' sugg-none'))
      });
      if (s.name) {
        box.appendChild(el('div', {}, [
          el('span', { class: 'sugg-name', text: s.name }),
          accepted ? el('span', { class: 'sugg-reason', text: ' — accepted' }) : null
        ]));
      } else {
        box.appendChild(el('div', {}, [el('span', { class: 'sugg-name', text: 'No suggestion' })]));
      }
      (s.reasons || []).forEach(function (rr) {
        box.appendChild(el('div', { class: 'sugg-reason', text: rr }));
      });
      (s.warnings || []).forEach(function (w) {
        box.appendChild(el('span', { class: 'warn-line', text: '⚠ ' + w }));
      });
      if (s.name || (s.alternates || []).length) {
        var actions = el('div', { class: 'sugg-actions' });
        var pick = el('select');
        if (s.name) pick.appendChild(el('option', { value: s.name, text: s.name + ' (suggested)' }));
        (s.alternates || []).forEach(function (alt) {
          if (isResidentName(alt)) pick.appendChild(el('option', { value: alt, text: alt }));
          else pick.appendChild(el('option', { value: '', text: alt, disabled: true }));
        });
        actions.appendChild(pick);
        actions.appendChild(el('button', {
          type: 'button', class: 'btn btn-small btn-primary', text: 'Accept',
          onclick: function () {
            if (!pick.value) return;
            c.assigned = pick.value;
            touch();
            renderAssignTab();
          }
        }));
        box.appendChild(actions);
      }
      card.appendChild(box);
    }

    // Clinic-coverage backup (how-to Step 3): offered when the assigned
    // resident staffs a PM clinic this case could pull them out of.
    var plan = null;
    if (window.Assign && window.Assign.backupPlan) {
      try { plan = window.Assign.backupPlan(c, App.roster, data(), App.state.cases); } catch (e) { plan = null; }
    }
    if (plan && !trim(c.backup)) {
      var covText = plan.primary.name + ' (' + plan.primary.source + ') to cover ' +
        plan.clinic + ' clinic during the case if after 1 PM' +
        (plan.second ? ' · 2nd backup ' + plan.second.name + ' (' + plan.second.source + ')' : '');
      var covBox = el('div', { class: 'cover-suggest' }, [
        el('span', { class: 'cover-text', text: 'Clinic backup: ' + covText }),
        el('button', {
          type: 'button', class: 'btn btn-small', text: 'Use as backup',
          onclick: function () {
            c.backup = plan.primary.name;
            c.backupNote = 'to cover ' + plan.clinic.toLowerCase() +
              ' clinic during case if after 1 PM' +
              (plan.second ? ', 2nd backup ' + plan.second.name + ' (' + plan.second.source + ')' : '');
            touch();
            renderAssignTab();
          }
        })
      ]);
      card.appendChild(covBox);
    }

    var manual = el('div', { class: 'assign-manual' });
    // Each label + select is grouped in a .assign-pair so flex wrapping can
    // never split a label from its control at narrow widths.
    manual.appendChild(el('span', { class: 'assign-pair' }, [
      el('label', { text: 'Assigned' }),
      residentSelect(c.assigned, function (v) {
        c.assigned = v;
        touch();
        renderAssignTab();
      }, 'unassigned')
    ]));
    manual.appendChild(el('span', { class: 'assign-pair' }, [
      el('label', { text: 'Backup' }),
      residentSelect(c.backup, function (v) {
        c.backup = v;
        touch();
        renderAssignTab();
      }, '—')
    ]));
    if (!trim(c.assigned) && c.serviceCount > 0) {
      manual.appendChild(el('span', { class: 'unassigned-text', text: '⚠ UNASSIGNED' }));
    }
    card.appendChild(manual);

    var covNote = el('input', {
      type: 'text', class: 'covnote',
      placeholder: 'backup note — e.g. to cover glaucoma clinic during case if after 1 PM, 2nd backup …',
      value: c.backupNote || ''
    });
    covNote.addEventListener('input', function () { c.backupNote = covNote.value; touch(); });
    card.appendChild(covNote);
    return card;
  }

  // A case still needs a resident: has service cases and nobody assigned yet.
  function needsResident(c) { return c.serviceCount > 0 && !trim(c.assigned); }

  function renderAssignFilters() {
    var host = $('assignFilters');
    if (!host) return;
    clearNode(host);
    var cases = App.state.cases;
    var nNeeds = 0, nAssigned = 0;
    cases.forEach(function (c) {
      if (needsResident(c)) nNeeds++;
      if (trim(c.assigned)) nAssigned++;
    });
    [
      { key: 'needs', label: 'Needs resident', count: nNeeds },
      { key: 'assigned', label: 'Assigned', count: nAssigned },
      { key: 'all', label: 'All', count: cases.length }
    ].forEach(function (f) {
      host.appendChild(el('button', {
        type: 'button',
        class: 'filter-chip' + (assignFilter === f.key ? ' active' : ''),
        onclick: function () {
          assignFilter = f.key;
          renderAssignFilters();
          renderAssignCases();
        }
      }, [f.label + ' ', el('span', { class: 'filter-count', text: String(f.count) })]));
    });
  }

  // Compact one-line row: '✓ Huang x7 (0730) → Bair; backup Calotti' + Edit.
  function assignCompactRow(c) {
    var assigned = trim(c.assigned);
    var row = el('div', { class: 'assign-row' });
    row.appendChild(el('span', { class: 'row-check' + (assigned ? '' : ' none'), text: assigned ? '✓' : '—' }));
    row.appendChild(el('span', { class: 'row-title', text: caseTitle(c) }));
    if (assigned) {
      row.appendChild(el('span', { class: 'row-arrow', text: '→' }));
      row.appendChild(el('b', { class: 'row-assigned', text: assigned }));
      if (trim(c.backup)) row.appendChild(el('span', { class: 'row-meta', text: '; backup ' + trim(c.backup) }));
    } else {
      row.appendChild(el('span', { class: 'row-meta', text: 'private — no resident needed' }));
    }
    row.appendChild(el('button', {
      type: 'button', class: 'btn btn-small row-edit', text: 'Edit',
      onclick: function () { assignExpanded[c.id] = true; renderAssignCases(); }
    }));
    return row;
  }

  function assignEmptyCard(text, btnLabel, btnTab, primary) {
    var kids = [el('p', { class: 'empty-note', text: text })];
    if (btnLabel) {
      kids.push(el('button', {
        type: 'button', class: 'btn btn-small' + (primary ? ' btn-primary' : ''), text: btnLabel,
        onclick: function () { setTab(btnTab); }
      }));
    }
    return el('div', { class: 'card assign-empty' }, kids);
  }

  function renderAssignCases() {
    var host = $('assignCases');
    clearNode(host);
    var cases = App.state.cases;

    if (!cases.length) {
      host.appendChild(assignEmptyCard(
        'No cases yet — add them on the Cases & Clinics tab.',
        'Go to Cases & Clinics', 'cases', false));
      return;
    }

    var shown = [];
    CASE_SECTIONS.forEach(function (secDef) {
      cases.forEach(function (c) {
        if (c.section !== secDef.key) return;
        if (assignFilter === 'needs' && !needsResident(c)) return;
        if (assignFilter === 'assigned' && !trim(c.assigned)) return;
        shown.push(c);
      });
    });

    if (!shown.length) {
      if (assignFilter === 'needs') {
        host.appendChild(assignEmptyCard(
          'Everything has a resident — check the output.',
          'Go to Preview & Copy', 'preview', true));
      } else {
        host.appendChild(assignEmptyCard(
          'Nothing assigned yet — suggest and accept, or pick residents on the cards.', null, null, false));
      }
      return;
    }

    shown.forEach(function (c) {
      if (needsResident(c)) host.appendChild(assignCaseCard(c, false));
      else if (assignExpanded[c.id]) host.appendChild(assignCaseCard(c, true));
      else host.appendChild(assignCompactRow(c));
    });
  }

  // "+ case" on an Assignments row: new Wills case pre-assigned to the
  // resident, then jump to the Cases tab focused on the fresh card.
  function addCaseForResident(name) {
    var c = newCase('wills');
    c.assigned = name;
    App.state.cases.push(c);
    caseSectionOpen.wills = true;
    touch();
    setTab('cases');
    var firstInput = document.querySelector('.case-card[data-case-id="' + c.id + '"] input');
    if (firstInput) { try { firstInput.focus(); } catch (e) { } }
    toast('Case added for ' + name + ' — fill in surgeon and counts on Cases & Clinics');
  }

  function loadRow(name, role, cases, r) {
    var res = null;
    (r.residents || []).forEach(function (x) { if (x.name === name) res = x; });
    var row = el('div', { class: 'load-row' });
    var top = el('div', { class: 'load-top' }, [
      el('span', { class: 'res-name ' + yearOf(name), text: name }),
      role ? el('span', { class: 'load-role', text: role }) : null,
      el('button', {
        type: 'button', class: 'btn btn-small load-add', text: '+ case',
        title: 'Add a Wills case assigned to ' + name,
        onclick: function () { addCaseForResident(name); }
      })
    ]);
    row.appendChild(top);
    if (res) {
      row.appendChild(el('div', { class: 'load-role' }, [
        el('span', { class: 'badge badge-am', text: 'AM' }), ' ' + (res.am.text || '—') + '   ',
        el('span', { class: 'badge badge-pm', text: 'PM' }), ' ' + (res.pm.text || '—')
      ]));
    }
    if (cases.length) {
      var chips = el('div');
      cases.forEach(function (c) {
        chips.appendChild(el('span', { class: 'case-chip', text: caseTitle(c) }));
      });
      row.appendChild(chips);
    }
    return row;
  }

  // Assignments panel: Surgical (Surg 1..6 + anyone on OR blocks) vs
  // Clinic / Consults (Cooper Consults + any other assigned resident).
  // No count pills; everyone gets the "+ case" option.
  function renderLoadPanel() {
    var host = $('loadPanel');
    clearNode(host);
    var r = App.roster;
    var loads = {};
    App.state.cases.forEach(function (c) {
      var a = trim(c.assigned);
      if (a) (loads[a] = loads[a] || []).push(c);
    });

    var seen = {};
    var roleOf = {};
    var surgical = [];
    var clinical = [];
    function add(list, name, role) {
      if (!name || seen[name]) return;
      seen[name] = true;
      roleOf[name] = role || '';
      list.push(name);
    }

    Object.keys(r.surg || {}).sort(function (a, b) { return (+a) - (+b); }).forEach(function (n) {
      add(surgical, r.surg[n].name, 'Surg ' + n);
    });
    Object.keys(r.orBlocks || {}).sort().forEach(function (blk) {
      ['am', 'pm'].forEach(function (sess) {
        (((r.orBlocks[blk] || {})[sess]) || []).forEach(function (p) {
          add(surgical, typeof p === 'string' ? p : p && p.name, blk);
        });
      });
    });
    (r.cooperConsults || []).forEach(function (name) {
      add(clinical, name, 'Cooper Consults');
    });
    Object.keys(loads).forEach(function (name) {
      add(clinical, name, '');
    });

    if (!surgical.length && !clinical.length) {
      host.appendChild(el('p', { class: 'empty-note', text: 'No candidates on this date.' }));
      return;
    }
    [
      { title: 'Surgical', names: surgical },
      { title: 'Clinic / Consults', names: clinical }
    ].forEach(function (g) {
      if (!g.names.length) return;
      host.appendChild(el('div', { class: 'load-group-title', text: g.title }));
      g.names.forEach(function (name) {
        host.appendChild(loadRow(name, roleOf[name], loads[name] || [], r));
      });
    });
  }

  function renderCoveragePanel() {
    var host = $('coveragePanel');
    clearNode(host);
    var cov = [];
    try {
      if (window.Assign && window.Assign.clinicCoverage) {
        cov = window.Assign.clinicCoverage(App.roster, data()) || [];
      }
    } catch (e) {
      if (window.console) console.error('clinicCoverage failed', e);
    }
    if (!cov.length) {
      host.appendChild(el('p', { class: 'empty-note', text: 'No coverage chain for this date.' }));
      return;
    }
    var ol = el('ol', { class: 'coverage-list' });
    cov.forEach(function (item) {
      ol.appendChild(el('li', {}, [
        el('span', { class: 'res-name ' + yearOf(item.name), text: item.name }),
        el('span', { class: 'coverage-src', text: ' — ' + item.source })
      ]));
    });
    host.appendChild(ol);
  }

  function renderAssignSide() {
    renderLoadPanel();
    renderCoveragePanel();
  }

  function renderAssignTab() {
    renderAssignFilters();
    renderAssignCases();
    renderAssignSide();
    if (App.activeTab === 'preview') renderPreview();
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
    COOPER: 'Cooper',
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
      [el('th', { text: '' })].concat(data().weekdays.map(function (d) {
        return el('th', { text: CPEC_DAY_LABELS[d] || d });
      }))
    )]));
    var body = el('tbody');
    [1, 2, 3, 4, 5].forEach(function (nth) {
      var row = el('tr', {}, [el('td', { class: 'cpec-ref-nth', text: ordinal(nth) })]);
      data().weekdays.forEach(function (d) {
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

    // 1. The flow — four numbered rows mirroring the tabs
    var flow = refCard('The flow');
    [
      { tab: 'roster', num: '1', title: 'Day Roster', text: 'Pick the date — everyone’s block assignment, Surg 1–5, WER, consults and clinics fill in automatically. You type night float, add-ons and vacation.' },
      { tab: 'cases', num: '2', title: 'Cases & Clinics', text: 'Copy the case list out of Cerner/NextGen by hand — count, start time, service vs private. Enter clinic patient counts.' },
      { tab: 'assign', num: '3', title: 'Assign', text: 'Press Suggest all — the how-to hierarchy proposes a resident per case, with warnings. Accept or override, and use the clinic-backup suggestions.' },
      { tab: 'preview', num: '4', title: 'Preview & Copy', text: 'The document, exactly in the usual format — Copy formatted and paste.' }
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
        d.weekdays.map(function (wk) { return el('th', { text: dayLabel[wk] || wk }); })
      ))]));
      var gBody = el('tbody');
      Object.keys(y.grid).sort(function (a, b) { return (+a) - (+b); }).forEach(function (block) {
        var cells = [el('td', {}, [el('strong', { text: block }),
          (y.taskmasterBlocks || []).indexOf(+block) !== -1 ? el('span', { class: 'badge badge-tm', text: ' TM' }) : null])];
        d.weekdays.forEach(function (wk) {
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
          var block = range.blocks[n];
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
  /* header actions                                                      */
  /* ------------------------------------------------------------------ */

  function setDate(dateISO) {
    saveNow(); // flush pending edits for the old date
    App.state = loadState(dateISO);
    stateDirty = false;   // freshly loaded — nothing user-edited yet
    assignExpanded = {};  // case ids restart at 'c1' per date — expansion must not leak
    computeRoster();
    renderAll();
  }

  function createSchedule() {
    computeRoster();
    renderAll();
    var r = App.roster;
    toast('Roster built for ' + r.weekdayLabel + ' ' + fmtMDYY(parseISO(App.state.date)) + ' — manual entries kept');
  }

  // One-click sync: flush edits, recompute the roster, re-render every tab so
  // the Preview & Copy output reflects everything entered anywhere in the app.
  function updateSync() {
    saveNow();
    computeRoster();
    renderAll();
    toast('Updated — clinics, cases & Preview/Copy are in sync');
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
    App.state.nightFloat = String(prev.nightFloat || '');
    App.state.vacation = String(prev.vacation || '');
    App.state.lectures = String(prev.lectures || '');
    App.state.addOns = Array.isArray(prev.addOns)
      ? prev.addOns.map(function (a) {
          return { label: String((a && a.label) || ''), name: String((a && a.name) || '') };
        })
      : [];
    stateDirty = true; // explicit user action — this day now really has content
    saveNow();
    renderAll();
    toast('Copied night float, vacation, lectures & add-ons from ' + src);
  }

  function clearDay() {
    if (!window.confirm('Clear everything saved for ' + App.state.date + '? This cannot be undone.')) return;
    lsRemove(LS_PREFIX + App.state.date);
    App.state = defaultState(App.state.date);
    stateDirty = false; // back to untouched — don't resurrect the key on next save
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
    setTab(tab || 'roster');
    if (!tab || tab === 'roster') {
      toast('Roster built for ' + App.roster.weekdayLabel + ' ' + fmtMDYY(parseISO(dateISO)) + ' — manual entries kept');
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

  var VALID_ROUTES = ['home', 'roster', 'cases', 'assign', 'preview', 'howto', 'cpec', 'reference'];

  function routeFromHash() {
    var h = String(window.location.hash || '').replace(/^#\/?/, '');
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
    App.activeTab = tab;
    var tabs = document.querySelectorAll('.tabbar .tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
    }
    var panels = document.querySelectorAll('.panel');
    for (var j = 0; j < panels.length; j++) {
      panels[j].classList.toggle('active', panels[j].id === 'panel-' + tab);
    }
    if (tab === 'roster') renderRosterTab();
    if (tab === 'cases') renderCasesTab();
    if (tab === 'assign') renderAssignTab();
    if (tab === 'preview') renderPreview();
    if (tab === 'cpec') renderCpecReference(); // re-render so the selected date's cell is highlighted
    // 'howto' and 'reference' are static — rendered once at boot.
    syncHash(tab);
  }

  function renderAll() {
    renderHeader();
    renderRosterTab();
    renderCasesTab();
    if (App.activeTab === 'assign') renderAssignTab();
    if (App.activeTab === 'preview') renderPreview();
  }

  function boot() {
    if (!window.SCHED_DATA) {
      document.body.insertBefore(
        el('div', { class: 'banner', text: 'js/data.js failed to load — the app cannot start.' }),
        document.body.firstChild
      );
      return;
    }

    var dp = $('datePicker');
    var initial = tomorrowISO();
    dp.value = initial;
    dp.addEventListener('change', function () { if (dp.value) setDate(dp.value); });

    // Steer both date pickers to the academic year (defaults stay "tomorrow"
    // from the real clock — nothing is pinned to any particular month).
    var d = data();
    [dp, $('homeDate')].forEach(function (inp) {
      if (inp && d.ayStart && d.ayEnd) {
        inp.min = d.ayStart;
        inp.max = d.ayEnd;
      }
    });

    var tabs = document.querySelectorAll('.tabbar .tab');
    for (var i = 0; i < tabs.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { setTab(btn.getAttribute('data-tab')); });
      })(tabs[i]);
    }

    $('btnCreate').addEventListener('click', createSchedule);
    $('btnUpdate').addEventListener('click', updateSync);
    function closeMoreMenu() {
      var m = $('moreMenu');
      if (m) m.removeAttribute('open');
    }
    $('btnYesterday').addEventListener('click', function () { closeMoreMenu(); startFromYesterday(); });
    $('btnClear').addEventListener('click', function () { closeMoreMenu(); clearDay(); });
    document.addEventListener('click', function (ev) {
      var m = $('moreMenu');
      if (m && m.hasAttribute('open') && !m.contains(ev.target)) m.removeAttribute('open');
    });
    $('btnSuggestAll').addEventListener('click', suggestAll);
    $('btnAcceptAll').addEventListener('click', acceptAll);

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

    window.addEventListener('beforeunload', saveNow);

    renderReference();
    renderHowto();
    renderCpecReference();
    setDate(initial);

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
