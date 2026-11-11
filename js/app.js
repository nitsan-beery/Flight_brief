// תדריך טיסה: מסך פתיחה ומסך דפית טיסה. requirements.md, סעיף 5.0.
// כל העיבוד במכשיר. קובץ התדריך לא יוצא ממנו.

import { openPdf, extractPage } from './pdf/extract.js';
import { parseBrief, briefLabel, flightLabel } from './brief.js';
import { renderSheet, nextManual, keptLines } from './sheet.js';
import { createFloat } from './float.js';
import { encodeTransfer, decodeTransfer } from './transfer.js';
import { loadCurrent, saveCurrent, getSetting, putSetting, deleteSetting } from './store.js';
import * as cal from './calendar.js';

// מספר הגרסה. תמיד שווה למספר שב-CACHE ב-sw.js (CLAUDE.md).
const APP_VERSION = 24;

const $ = (s) => document.querySelector(s);
const root = document.documentElement;

/** {fileName, bytes, brief, manual} או null. אחרי הדבקה (3.2): fileName ו-bytes הם null. */
let current = null;
let sheetEl = null;
/** היומן המחובר (3.3): {calendars:[{id,name}], hint, owner} או null. */
let calSetting = null;
let calBusy = false;

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

// ---- החלון הצף ----

const float = createFloat({
  canvas: $('#pip-canvas'),
  video: $('#pip-video'),
  getData: () => current && { brief: current.brief, manual: current.manual },
  getSheet: () => sheetEl,
  onState: (open, mode) => {
    $('#float-btn span').textContent = open ? 'סגור חלון צף' : 'חלון צף';
    for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(open && b.dataset.mode === mode));
    if (open) hideFloatMsg();
    showSheetPlacement();
  },
  onDocClosed: () => { if (location.hash === '#sheet') renderSheetView(); },
});

function hideFloatMsg() { for (const m of document.querySelectorAll('.float-msg')) m.hidden = true; }

/** הודעה על חלון צף שלא נפתח, במסך שמוצג כרגע. */
function showFloatMsg(text) {
  hideFloatMsg();
  if (!text) return;
  const screen = $('#home').hidden ? $('#sheet-view') : $('#home');
  const m = screen.querySelector('.float-msg');
  m.querySelector('.msg-text').textContent = text;
  m.hidden = false;
}

/** פותח דפית בחלון צף (requirements.md, 5.1.2). לחיצה על הדפית שכבר מוצגת סוגרת את החלון. */
async function openFloat(mode) {
  if (float.mode() === mode) { float.close(); return; }
  hideFloatMsg();
  // ב-Windows הדפית המלאה עוברת לחלון כמו שהיא, ולכן היא צריכה להיות בנויה גם כשפותחים ממסך הפתיחה.
  if (mode === 'full' && !float.docOpen() && !sheetEl?.isConnected) buildSheet();
  const msg = await float.open(mode);
  showFloatMsg(msg);
  return !msg;
}

/**
 * כפתורי החלון הצף במסך הפתיחה. "דפית טיסה" שלא נפתחת כחלון צף פותחת את מסך הדפית, בלי הודעה
 * (requirements.md, 5.0, גרסה 20).
 */
async function onModeButton(mode) {
  const wasOpen = float.mode() === mode;
  const ok = await openFloat(mode);
  if (mode === 'full' && !wasOpen && !ok) { hideFloatMsg(); openSheet(); }
}

function openSheet() { history.pushState({ fromHome: true }, '', '#sheet'); route(); }

/** כפתור "חלון צף" במסך הדפית: פותח את הדפית המלאה וחוזר למסך הפתיחה (requirements.md, 5.0). */
async function onFloatButton() {
  if (float.isOpen()) { float.close(); return; }
  if (await openFloat('full')) goHome();
}

function goHome() {
  if (history.state?.fromHome) history.back();
  else { history.replaceState(null, '', location.pathname); route(); }
}

// ---- מסכים ----

function route() {
  const wantSheet = location.hash === '#sheet' && current;
  if (location.hash === '#sheet' && !current) history.replaceState(null, '', location.pathname);
  if (!wantSheet) hideFloatMsg();
  $('.cal-msg').hidden = true;
  $('#home').hidden = !!wantSheet;
  $('#sheet-view').hidden = !wantSheet;
  if (wantSheet) renderSheetView(); else renderHome();
  window.scrollTo(0, 0);
}

function renderHome() {
  const drop = $('#drop');
  drop.classList.toggle('loaded', !!current);
  $('#float-box').hidden = !current;
  $('.xfer-copy').disabled = !current;
  renderCal();
  if (current) {
    $('.drop-label').textContent = briefLabel(current.brief);
    $('.drop-name').textContent = current.bytes ? current.fileName : 'הועבר מהעתקה – אין קובץ PDF';
    $('.drop-name').dir = current.bytes ? 'ltr' : 'rtl';
    $('.drop-file').classList.toggle('nofile', !current.bytes);
    float.prepare();
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

function buildSheet() {
  sheetEl = renderSheet($('#sheet-slot'), current.brief, current.manual, {
    onChange: (manual) => { current.manual = manual; float.update(); scheduleSave(); },
    ...(calSetting && { onCalendar: () => fillFromCalendar(calToken(), { fromSheet: true }) }),
  });
}

function renderSheetView() {
  if (float.docOpen()) { showSheetPlacement(); return; }
  buildSheet();
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

/** `pending`: ההרשאה ליומן, שהתבקשה ברגע הלחיצה (`calToken`), או null. */
async function loadFile(file, pending = null) {
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
    const next = nextManual(current, brief);
    if (float.isOpen()) float.close();
    const manual = next.keep && (await askKeep(current.brief, brief, next.keep)) ? next.keep : next.manual;
    current = { fileName: file.name, bytes, brief, manual };
    await saveCurrent(current).catch(() => {});
    float.update();
    renderHome();
    // טיסה אחרת (הצוות התאפס): השמות מהיומן. אותה טיסה: השמות הקיימים נשארים (requirements.md, 3.3).
    if (calSetting && crewEmpty(manual)) await fillFromCalendar(pending);
  } finally {
    drop.classList.remove('busy');
    $('.drop-state').textContent = 'לא נבחר קובץ';
  }
}

/** "השאר" או "אפס". סגירה בלי בחירה (Esc) משאירה את הערכים (requirements.md, 5.0). */
function askKeep(prevBrief, brief, keep) {
  const dlg = $('#keep-dlg');
  dlg.querySelector('.dlg-reg').textContent = brief.reg;
  dlg.querySelector('.dlg-ofp').textContent = `${prevBrief.ofp} → ${brief.ofp}`;
  dlg.querySelector('.dlg-vals').textContent = keptLines(keep).join('\n');
  dlg.returnValue = '';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue !== 'reset'), { once: true });
    dlg.showModal();
  });
}

// ---- העברת נתונים בהעתקה והדבקה (requirements.md, 3.2) ----

function showXferMsg(text, ok) {
  const m = $('.xfer-msg');
  m.querySelector('.msg-text').textContent = text;
  m.classList.toggle('ok', ok);
  m.classList.toggle('bad', !ok);
  m.hidden = false;
}

async function copyData() {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(encodeTransfer(current.brief, current.manual));
    showXferMsg('הנתונים הועתקו. ב-Safari לחץ "הדבק נתונים".', true);
  } catch {
    showXferMsg('לא ניתן להעתיק ללוח.', false);
  }
}

/** ההדבקה מחליפה הכול: התדריך והנתונים הידניים, בלי שאלה (נקבע על ידי הבעלים). */
async function pasteData() {
  let text;
  try { text = await navigator.clipboard.readText(); } catch { showXferMsg('לא ניתן לקרוא מהלוח.', false); return; }
  const res = decodeTransfer(text);
  if (!res.ok) { showXferMsg(res.error, false); return; }
  if (float.isOpen()) float.close();
  current = { fileName: null, bytes: null, brief: res.brief, manual: res.manual };
  await saveCurrent(current).catch(() => {});
  float.update();
  renderHome();
  showXferMsg('הנתונים הודבקו.', true);
}

// ---- שמות הצוות מיומן גוגל (requirements.md, 3.3) ----

const CAL_KEY = 'calendar';
const crewEmpty = (m) => ![...m.ck, ...m.cab].some((s) => s.trim());

/**
 * ההרשאה ליומן. מתבקשת מיד, בתוך הלחיצה: כשהקודמת פגה גוגל פותח חלון, ו-Safari חוסם חלון שלא נפתח
 * בתגובה ישירה ללחיצה. null: אין יומן, או שאין הרשאה בתוקף והלחיצה כבר פגה.
 */
function calToken() {
  if (!calSetting || calBusy) return null;
  const t = cal.cachedToken();
  if (t) return Promise.resolve(t);
  if (navigator.userActivation && !navigator.userActivation.isActive) return null;
  const p = cal.requestToken({ hint: calSetting.hint });
  p.catch(() => {}); // השגיאה מדווחת כשממתינים לה
  return p;
}

let calNote = { text: '', ok: true };
function setCalNote(text, ok, fromSheet = false) {
  calNote = { text, ok };
  renderCal();
  const m = $('.cal-msg');
  if (fromSheet) {
    m.querySelector('.msg-text').textContent = text;
    m.classList.toggle('ok', ok);
    m.classList.toggle('bad', !ok);
    m.hidden = false;
  }
}

function renderCal() {
  const name = $('.cal-name'), note = $('.cal-note'), btn = $('.cal-btn');
  name.textContent = calSetting ? calSetting.calendars.map((c) => c.name).join(', ') : 'לא מחובר';
  name.classList.toggle('off', !calSetting);
  note.textContent = calBusy ? 'קורא מהיומן…' : calNote.text;
  note.className = `cal-note${calBusy || !calNote.text ? '' : calNote.ok ? ' ok' : ' bad'}`;
  btn.textContent = calSetting ? 'נתק' : 'חבר יומן';
  btn.disabled = calBusy;
  $('.cal-sync').hidden = !calSetting;
  $('.cal-sync').disabled = calBusy;
}

async function onCalButton() {
  if (calSetting) {
    await cal.revoke();
    calSetting = null;
    calNote = { text: '', ok: true };
    await deleteSetting(CAL_KEY).catch(() => {});
    renderCal();
    return;
  }
  const pending = cal.requestToken();
  calBusy = true;
  renderCal();
  try {
    const token = await pending;
    const found = await cal.discover(token);
    if (!found.calendars.length) throw new Error('לא נמצאו ביומנים שלך אירועי סבב של האורגנייזר.');
    calSetting = found;
    await putSetting(CAL_KEY, calSetting).catch(() => {});
    calNote = { text: '', ok: true };
  } catch (e) {
    calNote = { text: e.message, ok: false };
  }
  calBusy = false;
  renderCal();
  // תדריך שכבר טעון, בלי שמות: ממלאים מיד, באותה הרשאה.
  const token = cal.cachedToken();
  if (calSetting && current && token && crewEmpty(current.manual)) await fillFromCalendar(Promise.resolve(token));
}

/**
 * "עדכון": היומנים ובעל היומן מחדש, ואז השמות לתדריך הטעון, במקום השמות שבדפית (requirements.md, 3.3,
 * גרסה 23). בלי יומן חדש נשארים היומנים שכבר מחוברים.
 */
async function onCalSync() {
  const pending = calToken();
  if (!pending) return;
  calBusy = true;
  renderCal();
  let ok = false;
  try {
    const found = await cal.discover(await pending);
    if (found.calendars.length) {
      calSetting = { calendars: found.calendars, hint: found.hint ?? calSetting.hint, owner: found.owner ?? calSetting.owner };
      await putSetting(CAL_KEY, calSetting).catch(() => {});
      calNote = { text: 'היומן עודכן.', ok: true };
    } else {
      calNote = { text: 'לא נמצאו ביומנים שלך אירועי סבב של האורגנייזר.', ok: false };
    }
    ok = true;
  } catch (e) {
    calNote = { text: e.message, ok: false };
  }
  calBusy = false;
  renderCal();
  if (ok && current) await fillFromCalendar(pending);
}

/** השמות מהיומן לטיסה של התדריך, במקום השמות שבדפית. */
async function fillFromCalendar(pending, { fromSheet = false } = {}) {
  if (!calSetting || !current) return;
  if (!pending) {
    if (!calBusy) setCalNote('לא ניתן לגשת ליומן בלי לחיצה. לחץ "עדכן מהיומן" בדפית.', false, fromSheet);
    return;
  }
  calBusy = true;
  renderCal();
  let note;
  try {
    const token = await pending;
    const brief = current.brief;
    const r = cal.crewFor(await cal.eventsAround(token, calSetting.calendars, brief), brief, calSetting.owner);
    if (r.ok && current.brief === brief) {
      current.manual = { ...current.manual, ck: r.ck, cab: r.cab };
      await saveCurrent(current).catch(() => {});
      float.update();
      if (!$('#sheet-view').hidden && !float.docOpen()) buildSheet();
    }
    note = r.ok ? [`הצוות של ${flightLabel(brief)} נלקח מהיומן.`, true] : [r.error, false];
  } catch (e) {
    note = [e.message, false];
  }
  calBusy = false;
  setCalNote(...note, fromSheet);
}

function wireDrop() {
  const drop = $('#drop');
  const input = drop.querySelector('input');
  // ההרשאה ליומן מתבקשת כאן, ברגע הבחירה, לפני קריאת הקובץ (`calToken`).
  input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) loadFile(f, calToken()); });
  // כשהתדריך טעון, רק הכפתור פותח את בחירת הקובץ.
  drop.addEventListener('click', (e) => {
    if (e.target.closest('.drop-xfer, .xfer-msg')) { e.preventDefault(); return; }
    if (e.target.closest('.drop-pick')) { e.preventDefault(); input.click(); return; }
    if (e.target.closest('.drop-file')) { e.preventDefault(); openBriefFile(); return; }
    if (e.target.closest('.drop-sheet')) { e.preventDefault(); openSheet(); return; }
    if (drop.classList.contains('loaded') && e.target !== input) e.preventDefault();
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); });
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadFile(f, calToken()); });
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
  for (const b of document.querySelectorAll('.msg-close')) b.addEventListener('click', () => { b.closest('.msg').hidden = true; });
  $('.xfer-copy').addEventListener('click', copyData);
  $('.xfer-paste').addEventListener('click', pasteData);
  $('.cal-btn').addEventListener('click', onCalButton);
  $('.cal-sync').addEventListener('click', onCalSync);
  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => onModeButton(b.dataset.mode));
  $('.back').addEventListener('click', (e) => { e.preventDefault(); goHome(); });
  addEventListener('popstate', route);
  addEventListener('hashchange', route);
  wireDrop();
  registerServiceWorker();
  calSetting = await getSetting(CAL_KEY);
  if (calSetting) cal.preload();
  const saved = await loadCurrent();
  if (saved?.brief && saved.manual) current = { fileName: saved.fileName, bytes: saved.bytes, brief: saved.brief, manual: saved.manual };
  route();
}

start();
