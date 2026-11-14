// תדריך טיסה: מסך פתיחה, מסכי תוצרים ופס החלון הצף. requirements.md, סעיף 5.0.
// כל העיבוד במכשיר. קובץ התדריך לא יוצא ממנו.

import { openPdf, extractPage } from './pdf/extract.js';
import { parseBrief, briefLabel, flightLabel, toLines } from './brief.js';
import { parseOpt } from './opt.js';
import { renderSheet, nextManual, keptLines } from './sheet.js';
import { createFloat } from './float.js';
import { loadCurrent, saveCurrent, getSetting, putSetting, deleteSetting } from './store.js';
import * as cal from './calendar.js';
import { analyzeBrief } from './notam.js';
import { renderNotams } from './notam-view.js';
import { ensureMaps } from './notam-map.js';

// מספר הגרסה. תמיד שווה למספר שב-CACHE ב-sw.js (CLAUDE.md).
const APP_VERSION = 83;

const $ = (s) => document.querySelector(s);
const root = document.documentElement;

/** {fileName, bytes, brief, manual} או null. תדריך שהודבק עד גרסה 43 (3.2): fileName ו-bytes הם null. */
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
    for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(open && b.dataset.mode === mode));
    if (open) hideFloatMsg();
    showSheetPlacement();
  },
  onDocClosed: () => { if (location.hash === '#sheet') renderSheetView(); },
});

function hideFloatMsg() { for (const m of document.querySelectorAll('.float-msg')) m.hidden = true; }

/** הודעה על חלון צף שלא נפתח, מעל הפס. */
function showFloatMsg(text) {
  hideFloatMsg();
  if (!text) return;
  const m = $('.float-msg');
  m.querySelector('.msg-text').textContent = text;
  m.hidden = false;
}

/**
 * כפתור בפס החלון הצף: פותח את הדפית בחלון צף ונשאר במסך (requirements.md, 5.0, 5.1.2, גרסה 37).
 * לחיצה על הדפית שכבר מוצגת סוגרת את החלון.
 */
async function openFloat(mode) {
  if (float.mode() === mode) { float.close(); return; }
  hideFloatMsg();
  // ב-Windows הדפית המלאה עוברת לחלון כמו שהיא, ולכן היא צריכה להיות בנויה גם כשפותחים ממסך הפתיחה.
  if (mode === 'full' && !float.docOpen() && !sheetEl?.isConnected) buildSheet();
  const msg = await float.open(mode);
  showFloatMsg(msg);
  return !msg;
}

const VIEWS = ['sheet', 'wx', 'notam'];
const viewOf = () => VIEWS.find((v) => location.hash === `#${v}`) ?? null;

/** אריח במסך הפתיחה: מסך חדש בהיסטוריה. המתג במסך התוצר: מחליף מסך בלי להוסיף להיסטוריה. */
function openView(view, { replace = false } = {}) {
  if (replace) history.replaceState(history.state, '', `#${view}`);
  else history.pushState({ fromHome: true }, '', `#${view}`);
  route();
}

function goHome() {
  if (history.state?.fromHome) history.back();
  else { history.replaceState(null, '', location.pathname); route(); }
}

// ---- מסכים ----

function route() {
  const view = current ? viewOf() : null;
  if (location.hash && !view) history.replaceState(null, '', location.pathname);
  hideFloatMsg();
  $('.cal-msg').hidden = true;
  $('#home').hidden = !!view;
  $('#product-view').hidden = !view;
  // Cold weather לא תלויה בתדריך, ולכן מוצגת בפס גם לפני טעינת תדריך (requirements.md, 5.0, גרסה 36).
  for (const b of document.querySelectorAll('.dock-bar [data-mode]')) b.hidden = !current && b.dataset.mode !== 'cold';
  float.prepare();
  if (view) renderProductView(view); else renderHome();
  window.scrollTo(0, 0);
}

function renderHome() {
  const drop = $('#drop');
  drop.classList.toggle('loaded', !!current);
  $('#products').hidden = !current;
  renderCal();
  if (current) {
    $('.drop-label').textContent = briefLabel(current.brief);
    $('.drop-name').textContent = current.bytes ? current.fileName : 'הועבר מהעתקה – אין קובץ PDF';
    $('.drop-name').dir = current.bytes ? 'ltr' : 'rtl';
    $('.drop-file').classList.toggle('nofile', !current.bytes);
  }
}

// קובץ ה-PDF השמור, לפתיחה בלחיצה על שם הקובץ (requirements.md, 3.1). כתובת blob: מהמכשיר עצמו.
let fileUrl = null;
let fileUrlBytes = null;
function openBriefFile() {
  if (!current?.bytes) return;
  // באפליקציית ה-iOS window.open לא פותח דבר: הקובץ נפתח ב-Quick Look, דרך תוסף (requirements.md, 6.5, גרסה 52).
  const C = globalThis.Capacitor;
  if (C?.isPluginAvailable?.('OpenFile')) {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result).split(',')[1];
      C.nativePromise('OpenFile', 'open', { name: current.fileName ?? 'brief.pdf', data }).catch(() => {});
    };
    reader.readAsDataURL(new Blob([current.bytes], { type: 'application/pdf' }));
    return;
  }
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
    readOpt,
    ...(calSetting && { onCalendar: () => fillFromCalendar(calToken(), { fromSheet: true }) }),
  });
}

/** קריאת קובץ ההדפסה של ה-OPT (requirements.md, 5.1.3). הקובץ לא נשמר. */
async function readOpt(file) {
  try {
    const doc = await openPdf(await file.arrayBuffer());
    const page = await extractPage(doc, 1);
    await doc.destroy();
    return parseOpt(toLines(page.items));
  } catch {
    return { ok: false, error: 'לא ניתן לקרוא את הקובץ כ-PDF.' };
  }
}

/** מסך תוצר: המתג מסמן את התוצר, ורק החלק שלו מוצג (requirements.md, 5.0, גרסה 37). */
function renderProductView(view) {
  for (const a of document.querySelectorAll('.seg a')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  for (const p of document.querySelectorAll('.pane')) p.hidden = p.dataset.pane !== view;
  if (view === 'sheet') renderSheetView();
  if (view === 'notam') renderNotamView();
}

// ---- סיכום NOTAM (requirements.md, 5.3) ----

/** הניתוח של התדריך הפתוח. מחושב מקובץ ה-PDF בכניסה הראשונה למסך, ונשמר בזיכרון עד שנטען תדריך אחר. */
let notamCache = { bytes: null, res: null, busy: null };

async function analyzeNotams() {
  const doc = await openPdf(current.bytes);
  try {
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push(toLines((await extractPage(doc, p)).items).map((l) => l.text));
    const b = current.brief;
    return analyzeBrief(pages, { org: b.org, dst: b.dst, reg: b.reg, type: b.fields.type.value });
  } finally {
    await doc.destroy();
  }
}

/** מתחיל את ניתוח ה-NOTAM של התדריך הפתוח (פעם אחת לכל קובץ). */
function startNotams() {
  const bytes = current.bytes;
  if (notamCache.bytes !== bytes) {
    notamCache = { bytes, res: null, busy: analyzeNotams().catch(() => ({ ok: false, error: 'לא ניתן לקרוא את ה-NOTAM מקובץ התדריך.' })) };
  }
  return notamCache.busy;
}

/** מפות השדות של התדריך (5.3.3): ניתוח ברקע, והורדה של המפות לשדות הרלוונטיים כשיש רשת. */
function prefetchMaps() {
  if (!current?.bytes) return;
  startNotams().then((res) => { if (res.ok) return ensureMaps([...res.ctx.airports.keys()]); }).catch(() => {});
}

async function renderNotamView() {
  const slot = $('#notam-slot');
  if (!current.bytes) { slot.replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: 'התדריך הועבר מהעתקה, בלי קובץ PDF, ולכן אין ממנו NOTAM. טען את קובץ התדריך.' })); return; }
  const bytes = current.bytes;
  startNotams();
  if (!notamCache.res) {
    slot.replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: 'קורא את ה-NOTAM מהתדריך…' }));
    const res = await notamCache.busy;
    if (notamCache.bytes !== bytes) return;
    notamCache.res = res;
    if (viewOf() !== 'notam') return;
  }
  renderNotams(slot, notamCache.res);
}

function renderSheetView() {
  if (float.docOpen()) { showSheetPlacement(); return; }
  buildSheet();
  showSheetPlacement();
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
    prefetchMaps();
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
  // באפליקציית ה-iOS ההרשאה מתחדשת בשקט, בלי חלון, ולכן גם בלי לחיצה (requirements.md, 6.5).
  if (!cal.isNativeApp() && navigator.userActivation && !navigator.userActivation.isActive) return null;
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
      if (viewOf() === 'sheet' && !float.docOpen()) buildSheet();
    }
    note = r.ok ? [`הצוות של ${flightLabel(brief)} נלקח מהיומן.`, true] : [r.error, false];
  } catch (e) {
    note = [e.message, false];
  }
  calBusy = false;
  setCalNote(...note, fromSheet);
}

/**
 * PDF מתפריט "שתף" באפליקציית ה-iOS (requirements.md, 3.1, 6.5). קובץ OPT נטען לסעיף OPT בדפית, וכל קובץ
 * אחר נטען כתדריך, בדיוק כמו בבחירת קובץ. בדפדפן, או בבנייה ישנה בלי התוסף: כלום.
 */
function wireIncoming() {
  const C = globalThis.Capacitor;
  if (!cal.isNativeApp() || !C.isPluginAvailable?.('IncomingFile')) return;
  const take = async () => {
    const r = await C.nativePromise('IncomingFile', 'take', {}).catch(() => null);
    if (!r?.data) return;
    const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    const file = new File([bytes], r.name || 'brief.pdf', { type: 'application/pdf' });
    if ((await readOpt(file)).ok) {
      if (!current) { goHome(); $('.drop-error').textContent = `${file.name}: קובץ OPT. בחר קודם תדריך.`; return; }
      if (viewOf() !== 'sheet') openView('sheet', { replace: !!viewOf() });
      sheetEl?.loadOpt?.(file);
      return;
    }
    goHome();
    loadFile(file, calToken());
  };
  addEventListener('incomingfile', take);
  take();
}

function wireDrop() {
  const drop = $('#drop');
  const input = drop.querySelector('input');
  // ההרשאה ליומן מתבקשת כאן, ברגע הבחירה, לפני קריאת הקובץ (`calToken`).
  input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) loadFile(f, calToken()); });
  // כשהתדריך טעון, רק הכפתור פותח את בחירת הקובץ.
  drop.addEventListener('click', (e) => {
    if (e.target.closest('.cal-row')) { e.preventDefault(); return; }
    if (e.target.closest('.drop-pick')) { e.preventDefault(); input.click(); return; }
    if (e.target.closest('.drop-file')) { e.preventDefault(); openBriefFile(); return; }
    if (drop.classList.contains('loaded') && e.target !== input) e.preventDefault();
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); });
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadFile(f, calToken()); });
}

// ---- גרסה ועדכונים (requirements.md, 6.2) ----

function registerServiceWorker() {
  $('#app-version').textContent = `גרסה ${APP_VERSION}`;
  if (cal.isNativeApp()) { nativeUpdates(); return; }
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

/**
 * באפליקציית ה-iOS, במקום ה-Service Worker (requirements.md, 6.5): מדווחים שהאפליקציה עלתה, ובודקים ברקע
 * אם יש גרסה חדשה. כשהיא הורדה ואומתה – אותו כפתור, והלחיצה עוברת אליה. בנייה ישנה בלי התוסף: כלום.
 */
function nativeUpdates() {
  const C = globalThis.Capacitor;
  if (!C.isPluginAvailable?.('WebUpdate')) return;
  const call = (method, options = {}) => C.nativePromise('WebUpdate', method, options);
  const button = $('#app-update');
  let ready = 0;
  call('ready', { version: APP_VERSION }).catch(() => {});
  const check = () => {
    if (!navigator.onLine) return;
    call('check').then((r) => {
      if (!(r?.ready > APP_VERSION)) return;
      ready = r.ready;
      button.textContent = `גרסה ${ready} מוכנה – לחץ לרענון`;
      button.hidden = false;
    }).catch(() => {});
  };
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, 60 * 60 * 1000);
  button.addEventListener('click', () => { if (ready) call('apply', { version: ready }).catch(() => {}); });
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
  for (const b of document.querySelectorAll('.msg-close')) b.addEventListener('click', () => { b.closest('.msg').hidden = true; });
  $('.cal-btn').addEventListener('click', onCalButton);
  $('.cal-sync').addEventListener('click', onCalSync);
  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => openFloat(b.dataset.mode));
  for (const a of document.querySelectorAll('.tile')) a.addEventListener('click', (e) => { e.preventDefault(); openView(a.hash.slice(1)); });
  for (const a of document.querySelectorAll('.seg a')) a.addEventListener('click', (e) => { e.preventDefault(); openView(a.dataset.view, { replace: true }); });
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
  prefetchMaps();
  wireIncoming();
}

start();
