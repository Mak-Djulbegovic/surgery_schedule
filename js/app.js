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

  // Add-on rows for schedule date D:
  // "<weekday(D-1)> night (M/D/YY)", "<weekday(D)> day (M/D/YY)", "<weekday(D)> night (M/D/YY)"
  function defaultAddOns(dateISO) {
    var d = parseISO(dateISO);
    var prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    return [
      { label: weekdayName(prev) + ' night (' + fmtMDYY(prev) + ')', name: '' },
      { label: weekdayName(d) + ' day (' + fmtMDYY(d) + ')', name: '' },
      { label: weekdayName(d) + ' night (' + fmtMDYY(d) + ')', name: '' }
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
  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (App.state) lsSet(LS_PREFIX + App.state.date, JSON.stringify(App.state));
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }

  // Call after every manual input: debounced persist + live preview refresh.
  function touch() {
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
      start: '', category: 'cataract', addOn: false,
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

  function caseTable(list) {
    var tbl = el('table', { class: 'tbl case-tbl' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Surgeon' }), el('th', { text: 'Cases' }), el('th', { text: 'Service' }),
      el('th', { text: 'Start' }), el('th', { text: 'Category' }), el('th', { text: 'Add-on' }),
      el('th', { text: 'Notes' }), el('th', { text: '' })
    ])]));
    var tbody = el('tbody');
    list.forEach(function (c) {
      var addOn = el('input', { type: 'checkbox' });
      addOn.checked = c.addOn;
      addOn.addEventListener('change', function () { c.addOn = addOn.checked; touch(); });
      var cat = el('select');
      CATEGORIES.forEach(function (k) { cat.appendChild(el('option', { value: k, text: k })); });
      cat.value = c.category;
      cat.addEventListener('change', function () { c.category = cat.value; touch(); });
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [textInput(c.surgeon, 'Surgeon', function (v) { c.surgeon = v; touch(); })]),
        el('td', { class: 'num' }, [numInput(c.count, function (v) { c.count = v; touch(); })]),
        el('td', { class: 'num' }, [numInput(c.serviceCount, function (v) { c.serviceCount = v; touch(); })]),
        el('td', {}, [textInput(c.start, '0730', function (v) { c.start = v; touch(); })]),
        el('td', {}, [cat]),
        el('td', { class: 'num' }, [addOn]),
        el('td', {}, [textInput(c.notes, 'no Peds OR…', function (v) { c.notes = v; touch(); })]),
        el('td', { class: 'actions' }, [
          el('button', { type: 'button', class: 'btn-icon', title: 'Duplicate case', text: '⧉', onclick: function () { duplicateCase(c.id); } }),
          el('button', { type: 'button', class: 'btn-icon danger', title: 'Remove case', text: '×', onclick: function () { removeCase(c.id); } })
        ])
      ]));
    });
    tbl.appendChild(tbody);
    return el('div', { class: 'table-scroll' }, [tbl]);
  }

  function renderCaseSections() {
    var wrap = $('caseSections');
    clearNode(wrap);
    CASE_SECTIONS.forEach(function (secDef) {
      var card = el('div', { class: 'card' });
      var head = el('div', { class: 'card-head' }, [
        el('h2', { text: secDef.label }),
        el('button', {
          type: 'button', class: 'btn btn-small', text: '+ Add case',
          onclick: function () { addCase(secDef.key); }
        })
      ]);
      card.appendChild(head);
      if (secDef.key === 'private') {
        card.appendChild(el('p', { class: 'field-hint', text: 'Private-only cases keep Service at 0 — no resident needed.' }));
      }
      var list = App.state.cases.filter(function (c) { return c.section === secDef.key; });
      if (!list.length) card.appendChild(el('p', { class: 'empty-note', text: 'No cases yet.' }));
      else card.appendChild(caseTable(list));
      wrap.appendChild(card);
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

  function renderCasesTab() {
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

  function caseTitle(c) {
    var t = (trim(c.surgeon) || '?') + ' x' + c.count;
    if (trim(c.start)) t += ' (' + trim(c.start) + ')';
    return t;
  }

  function sectionLabel(key) {
    for (var i = 0; i < CASE_SECTIONS.length; i++) {
      if (CASE_SECTIONS[i].key === key) return CASE_SECTIONS[i].label;
    }
    return key;
  }

  function assignCaseCard(c) {
    var card = el('div', { class: 'assign-card' });
    var head = el('div', { class: 'assign-head' }, [
      el('span', { class: 'assign-title', text: caseTitle(c) }),
      el('span', { class: 'assign-meta', text: sectionLabel(c.section) }),
      el('span', { class: 'badge badge-cat', text: c.category })
    ]);
    if (c.addOn) head.appendChild(el('span', { class: 'badge badge-addon', text: 'ADD-ON' }));
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
    manual.appendChild(el('label', { text: 'Assigned' }));
    manual.appendChild(residentSelect(c.assigned, function (v) {
      c.assigned = v;
      touch();
      renderAssignTab();
    }, 'unassigned'));
    manual.appendChild(el('label', { text: 'Backup' }));
    manual.appendChild(residentSelect(c.backup, function (v) {
      c.backup = v;
      touch();
      renderAssignTab();
    }, '—'));
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

  function renderAssignCases() {
    var host = $('assignCases');
    clearNode(host);
    if (!App.state.cases.length) {
      host.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'empty-note', text: 'No cases yet — add them on the Cases & Clinics tab.' })
      ]));
      return;
    }
    CASE_SECTIONS.forEach(function (secDef) {
      App.state.cases.filter(function (c) { return c.section === secDef.key; })
        .forEach(function (c) { host.appendChild(assignCaseCard(c)); });
    });
  }

  function renderLoadPanel() {
    var host = $('loadPanel');
    clearNode(host);
    var r = App.roster;
    var loads = {};
    App.state.cases.forEach(function (c) {
      if (trim(c.assigned)) (loads[c.assigned] = loads[c.assigned] || []).push(c);
    });

    var order = [];
    var roleOf = {};
    Object.keys(r.surg || {}).sort(function (a, b) { return (+a) - (+b); }).forEach(function (n) {
      var name = r.surg[n].name;
      if (order.indexOf(name) === -1) { order.push(name); roleOf[name] = 'Surg ' + n; }
    });
    (r.cooperConsults || []).forEach(function (name) {
      if (order.indexOf(name) === -1) { order.push(name); roleOf[name] = 'Cooper Consults'; }
    });
    Object.keys(loads).forEach(function (name) {
      if (order.indexOf(name) === -1) order.push(name);
    });

    if (!order.length) {
      host.appendChild(el('p', { class: 'empty-note', text: 'No candidates on this date.' }));
      return;
    }
    order.forEach(function (name) {
      var cases = loads[name] || [];
      var res = null;
      (r.residents || []).forEach(function (x) { if (x.name === name) res = x; });
      var row = el('div', { class: 'load-row' });
      var top = el('div', { class: 'load-top' }, [
        el('span', { class: 'res-name ' + yearOf(name), text: name }),
        roleOf[name] ? el('span', { class: 'load-role', text: roleOf[name] }) : null,
        el('span', { class: 'load-count' + (cases.length >= 3 ? ' hot' : ''), text: cases.length + (cases.length === 1 ? ' case' : ' cases') })
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
      host.appendChild(row);
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
    saveNow();
    renderAll();
    toast('Copied night float, vacation, lectures & add-ons from ' + src);
  }

  function clearDay() {
    if (!window.confirm('Clear everything saved for ' + App.state.date + '? This cannot be undone.')) return;
    lsRemove(LS_PREFIX + App.state.date);
    App.state = defaultState(App.state.date);
    renderAll();
    toast('Cleared ' + App.state.date);
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

    window.addEventListener('beforeunload', saveNow);

    renderReference();
    setDate(initial);
  }

  App.setDate = setDate;
  App.setTab = setTab;
  App.saveNow = saveNow;
  App.exportDay = exportDay;
  window.App = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
