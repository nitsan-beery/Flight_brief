// תדריך טיסה: מסך פתיחה ומסך דפית טיסה. requirements.md, סעיף 5.0.
// כל העיבוד במכשיר. קובץ התדריך לא יוצא ממנו.

import { openPdf, extractPage } from './pdf/extract.js';
import { parseBrief, briefLabel, sameFlight } from './brief.js';
import { renderSheet, emptyManual } from './sheet.js';
import { createFloat } from './float.js';
import { createSource } from './source.js';
import { loadCurrent, saveCurrent } from './store.js';

// מספר הגרסה. תמיד שווה למספר שב-CACHE ב-sw.js (CLAUDE.md).
const APP_VERSION = 5;

const $ = (s) => document.querySelector(s);
const root = document.documentElement;

/** {fileName, bytes, brief, manual} או null */
let current = null;
let sheetEl = null;

// ---- ערכת צבעים: לפי המכשיר, וכפתור שמחליף בין בהיר לכהה ----

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && darkQuery.matches);
const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

function paintThemeButtons() {
  for (const b of document.querySelectorAll('.theme-btn')) {
    b.innerHTML = isDark() ? SUN : MOON;
    b.setAttribute('aria-label', isDark() ? 'מעבר למצב בהיר' : 'מעבר למצב כהה');
  }
}

function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  // בחירה ששווה להגדרת המכשיר מחזירה ל"לפי המכשיר".
  if ((next === 'dark') === darkQuery.matches) delete root.dataset.theme; else root.dataset.theme = next;
  try {
    if (root.dataset.theme) localStorage.setItem('theme', root.dataset.theme); else localStorage.removeItem('theme');
  } catch { /* אחסון חסום: הבחירה תקפה עד סגירת הדף */ }
  paintThemeButtons();
  float.update();
}

// ---- החלון הצף והמקור בתדריך ----

const float = createFloat({
  canvas: $('#pip-canvas'),
  video: $('#pip-video'),
  getData: () => current && { brief: current.brief, manual: current.manual },
  getSheet: () => sheetEl,
  onState: (open) => {
    $('#float-btn span').textContent = open ? 'סגור חלון צף' : 'חלון צף';
    if (open) hideFloatMsg();
    showSheetPlacement();
  },
  onDocClosed: () => { if (location.hash === '#sheet') renderSheetView(); },
});

const source = createSource({
  dialog: $('#source'), body: $('#source-body'), page: $('#source-page'),
  canvas: $('#source-canvas'), mark: $('#source-mark'),
  getBytes: () => current?.bytes ?? null,
});

function openSource(keys) {
  const f = current.brief.fields;
  const boxes = keys.map((k) => (k === 'header' ? current.brief.headerBox : f[k]?.box));
  source.open(boxes).catch(() => {});
}

function hideFloatMsg() { $('#float-msg').hidden = true; }

async function onFloatButton() {
  if (float.isOpen()) { float.close(); return; }
  hideFloatMsg();
  const msg = await float.open();
  $('#float-msg .msg-text').textContent = msg ?? '';
  $('#float-msg').hidden = !msg;
}

// ---- מסכים ----

function route() {
  const wantSheet = location.hash === '#sheet' && current;
  if (location.hash === '#sheet' && !current) history.replaceState(null, '', location.pathname);
  if (!wantSheet) hideFloatMsg();
  $('#home').hidden = !!wantSheet;
  $('#sheet-view').hidden = !wantSheet;
  if (wantSheet) renderSheetView(); else renderHome();
  window.scrollTo(0, 0);
}

function renderHome() {
  const drop = $('#drop');
  drop.classList.toggle('loaded', !!current);
  $('#outputs').hidden = !current;
  if (current) {
    $('.drop-label').textContent = briefLabel(current.brief);
    $('.drop-name').textContent = current.fileName;
  }
}

// קובץ ה-PDF השמור, לפתיחה בלחיצה על שם הקובץ (requirements.md, 3.1). כתובת blob: מהמכשיר עצמו.
let fileUrl = null;
let fileUrlBytes = null;
function openBriefFile() {
  if (!current?.bytes) return;
  if (fileUrlBytes !== current.bytes) {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = URL.createObjectURL(new Blob([current.bytes], { type: 'application/pdf' }));
    fileUrlBytes = current.bytes;
  }
  window.open(fileUrl, '_blank');
}

function renderSheetView() {
  if (float.docOpen()) { showSheetPlacement(); return; }
  sheetEl = renderSheet($('#sheet-slot'), current.brief, current.manual, {
    onChange: (manual) => { current.manual = manual; float.update(); scheduleSave(); },
    onSource: openSource,
  });
  showSheetPlacement();
  float.prepare();
}

function showSheetPlacement() {
  const away = float.docOpen();
  $('#sheet-away').hidden = !away;
  $('#sheet-slot').hidden = away;
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCurrent(current).catch(() => {}), 300);
}

// ---- טעינת תדריך (requirements.md, 3.1) ----

async function loadFile(file) {
  const drop = $('#drop');
  const err = $('.drop-error');
  err.textContent = '';
  drop.classList.add('busy');
  $('.drop-state').textContent = 'קורא את הקובץ…';
  try {
    const bytes = await file.arrayBuffer();
    let res;
    try {
      const doc = await openPdf(bytes);
      res = parseBrief(await extractPage(doc, 1));
      await doc.destroy();
    } catch {
      res = { ok: false, error: 'לא ניתן לקרוא את הקובץ כ-PDF.' };
    }
    if (!res.ok) { err.textContent = `${file.name}: ${res.error}`; return; }
    const brief = res.brief;
    const manual = current && sameFlight(current.brief, brief)
      ? { ...current.manual, bf: emptyManual(brief).bf }
      : emptyManual(brief);
    if (float.isOpen()) float.close();
    current = { fileName: file.name, bytes, brief, manual };
    await saveCurrent(current).catch(() => {});
    float.update();
    renderHome();
  } finally {
    drop.classList.remove('busy');
    $('.drop-state').textContent = 'לא נבחר קובץ';
  }
}

function wireDrop() {
  const drop = $('#drop');
  const input = drop.querySelector('input');
  input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) loadFile(f); });
  // כשהתדריך טעון, רק הכפתור פותח את בחירת הקובץ.
  drop.addEventListener('click', (e) => {
    if (e.target.closest('.drop-pick')) { e.preventDefault(); input.click(); return; }
    if (e.target.closest('.drop-file')) { e.preventDefault(); openBriefFile(); return; }
    if (drop.classList.contains('loaded') && e.target !== input) e.preventDefault();
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); });
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
}

// ---- גרסה ועדכונים (requirements.md, 6.2) ----

function registerServiceWorker() {
  $('#app-version').textContent = `גרסה ${APP_VERSION}`;
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((registration) => {
    const check = () => { if (navigator.onLine) registration.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch(() => { /* האפליקציה עובדת גם בלי */ });
  showUpdate();
  navigator.serviceWorker.addEventListener('controllerchange', showUpdate);
  $('#app-update').addEventListener('click', () => location.reload());
}

/** גרסה חדשה שהותקנה בזמן שהדף פתוח: כפתור "גרסה N מוכנה – לחץ לרענון". */
async function showUpdate() {
  const keys = await caches.keys().catch(() => []);
  const cached = Math.max(0, ...keys.map((k) => Number(k.match(/^flight-brief-v(\d+)$/)?.[1] ?? 0)));
  const button = $('#app-update');
  button.hidden = cached <= APP_VERSION;
  if (cached > APP_VERSION) button.textContent = `גרסה ${cached} מוכנה – לחץ לרענון`;
}

// ---- התחלה ----

async function start() {
  paintThemeButtons();
  darkQuery.addEventListener('change', () => { paintThemeButtons(); float.update(); });
  for (const b of document.querySelectorAll('.theme-btn')) b.addEventListener('click', toggleTheme);
  $('#float-btn').addEventListener('click', onFloatButton);
  $('#float-msg .msg-close').addEventListener('click', hideFloatMsg);
  $('.back').addEventListener('click', (e) => {
    e.preventDefault();
    if (history.state?.fromHome) history.back(); else { history.replaceState(null, '', location.pathname); route(); }
  });
  $('.output').addEventListener('click', (e) => { e.preventDefault(); history.pushState({ fromHome: true }, '', '#sheet'); route(); });
  addEventListener('popstate', route);
  addEventListener('hashchange', route);
  wireDrop();
  registerServiceWorker();
  const saved = await loadCurrent();
  if (saved?.brief && saved.bytes) current = { fileName: saved.fileName, bytes: saved.bytes, brief: saved.brief, manual: saved.manual };
  route();
}

start();
