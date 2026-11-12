// שמות הצוות מיומן גוגל – רשות. requirements.md, סעיף 3.3.
//
// היומן שהאורגנייזר (El Al Organizer) מסנכרן מהרומה. הקריאה מהדפדפן ישירות ל-Google Calendar API,
// בהרשאת קריאה בלבד, כמו באפליקציית הפיצויים (אותו Client ID). תיאור האירועים (שמות, טלפונים ומספרי
// עובד) מפוענח בזיכרון: לדפית עוברים רק השמות, ובמכשיר נשמר רק מספר העובד של בעל היומן.
// ספריית ההתחברות של גוגל נטענת רק כשמתחברים או קוראים, כך שמי שלא חיבר יומן אינו פונה לגוגל כלל.
// באפליקציית ה-iOS (requirements.md, 6.5) ההתחברות עוברת דרך התוסף GoogleAuth (Swift), ואסימון גישה
// חדש מתקבל בשקט, בלי חלון. הקריאה ליומן עצמה זהה.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/calendar/v3/';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];
/** מזהה ההתחברות של אפליקציית הפיצויים. אינו סוד, ומורשה רק ל-nitsan-beery.github.io. */
export const CLIENT_ID = '438961798736-7ctcj9og1mpao6uumnplvaamusutiroi.apps.googleusercontent.com';
/** מזהה ההתחברות של אפליקציית ה-iOS (סוג iOS, באותו פרויקט). אינו סוד, ומורשה רק ל-Bundle ID שלה. */
export const IOS_CLIENT_ID = '438961798736-1i84vmv5vemapf61d9sa7u66boq5oli5.apps.googleusercontent.com';
const SLIP_MARK = 'Slip details';
const TOKEN_KEY = 'calendar-token';
const DAY = 864e5;

// ---- התחברות ----

/** האפליקציה רצה כאפליקציית iOS (Capacitor), ולא בדפדפן. */
export const isNativeApp = () => globalThis.Capacitor?.isNativePlatform?.() === true;

let gisPromise = null;

function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('לא ניתן לטעון את ההתחברות של גוגל. בדוק את החיבור לרשת.')); };
    document.head.append(s);
  });
  return gisPromise;
}

/** טעינת ספריית ההתחברות מראש, כדי שהחלון של גוגל ייפתח מיד בלחיצה. */
export function preload() { if (!isNativeApp()) loadGis().catch(() => { /* תדווח בקריאה */ }); }

/** אסימון גישה שעוד בתוקף (שעה מההתחברות), לאותה לשונית בלבד. */
export function cachedToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null');
    return t && t.exp > Date.now() + 60000 ? t.token : null;
  } catch {
    return null;
  }
}

function forgetToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* אין אחסון לשונית */ }
}

/**
 * אסימון גישה מגוגל. פותח חלון של גוגל, ולכן רק בתגובה ללחיצה, ובלי המתנה לפניו (Safari חוסם חלון
 * שנפתח אחרי המתנה). `hint`: חשבון הגוגל שכבר חובר, כדי שהחלון ייסגר לבד.
 */
export function requestToken({ hint = null } = {}) {
  if (isNativeApp()) return nativeToken(hint);
  if (!globalThis.google?.accounts?.oauth2) return loadGis().then(() => tokenNow(hint));
  return tokenNow(hint);
}

function saveToken(token, expiresIn) {
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + Number(expiresIn ?? 3600) * 1000 })); } catch { /* בלי אחסון לשונית */ }
}

const googleAuth = (method, options) => globalThis.Capacitor.nativePromise('GoogleAuth', method, options);

/** באפליקציה: קודם רענון שקט, ורק בלעדיו חלון ההתחברות של iOS. */
async function nativeToken(hint) {
  if (!IOS_CLIENT_ID) throw new Error('חיבור היומן באפליקציה עוד לא הוגדר.');
  let r;
  try {
    try {
      r = await googleAuth('refresh', { clientId: IOS_CLIENT_ID });
    } catch (e) {
      if (e?.code !== 'no_refresh') throw e;
      r = await googleAuth('signIn', { clientId: IOS_CLIENT_ID, scopes: SCOPES.join(' '), hint });
    }
  } catch (e) {
    throw new Error(e?.message || 'ההתחברות לגוגל נכשלה.');
  }
  const granted = String(r.scope ?? '').split(' ');
  if (!SCOPES.every((sc) => granted.includes(sc))) {
    await googleAuth('signOut', {}).catch(() => {});
    throw new Error('לא ניתנה הרשאה לקרוא את היומן. סמן את שתי ההרשאות במסך של גוגל.');
  }
  saveToken(r.accessToken, r.expiresIn);
  return r.accessToken;
}

function tokenNow(hint) {
  const oauth2 = globalThis.google.accounts.oauth2;
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES.join(' '),
      prompt: '',
      ...(hint && { login_hint: hint }),
      callback: (r) => {
        if (r.error) { reject(new Error(r.error === 'access_denied' ? 'לא ניתנה הרשאה לקרוא את היומן.' : `ההתחברות לגוגל נכשלה (${r.error}).`)); return; }
        if (!oauth2.hasGrantedAllScopes(r, ...SCOPES)) { reject(new Error('לא ניתנה הרשאה לקרוא את היומן. סמן את שתי ההרשאות במסך של גוגל.')); return; }
        saveToken(r.access_token, r.expires_in);
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'החלון של גוגל נסגר לפני סיום ההתחברות.'
        : e?.type === 'popup_failed_to_open' ? 'הדפדפן חסם את החלון של גוגל. אפשר חלונות קופצים לאתר ונסה שוב.'
          : 'ההתחברות לגוגל נכשלה.')),
    });
    client.requestAccessToken();
  });
}

/** ביטול ההרשאה בגוגל ומחיקת האסימון מהמכשיר. */
export async function revoke() {
  const token = cachedToken();
  forgetToken();
  if (isNativeApp()) { await googleAuth('signOut', {}).catch(() => {}); return; }
  if (!token) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${encodeURIComponent(token)}` });
  } catch { /* הניתוק במכשיר כבר נעשה */ }
}

// ---- קריאה ----

async function api(token, path, params = {}) {
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('אין חיבור לרשת.');
  }
  if (res.status === 401) { forgetToken(); throw new Error('ההרשאה ליומן פגה. לחץ "עדכן מהיומן" בדפית.'); }
  if (!res.ok) throw new Error(`קריאת היומן נכשלה (${res.status}).`);
  return res.json();
}

async function pages(token, path, params) {
  const items = [];
  let pageToken;
  do {
    const r = await api(token, path, { ...params, pageToken });
    items.push(...(r.items ?? []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return items;
}

const slipEvents = (token, id, timeMin, timeMax) => pages(token, `calendars/${encodeURIComponent(id)}/events`, {
  q: SLIP_MARK, singleEvents: true, maxResults: 2500, fields: 'items(description,start,status),nextPageToken', timeMin, timeMax,
});

/**
 * חיבור: היומנים שיש בהם אירועי סבב (מהחדש לישן), חשבון הגוגל ובעל היומן.
 * @returns {{calendars:{id,name}[], hint:string|null, owner:string|null}}
 */
export async function discover(token) {
  const list = await pages(token, 'users/me/calendarList', { fields: 'items(id,summary,primary),nextPageToken', maxResults: 250 });
  const now = Date.now();
  const timeMin = new Date(now - 120 * DAY).toISOString(), timeMax = new Date(now + 60 * DAY).toISOString();
  const found = [];
  const all = [];
  for (const c of list) {
    let items;
    try { items = await slipEvents(token, c.id, timeMin, timeMax); } catch { continue; }
    const latest = items.map((e) => e.start?.dateTime ?? '').sort().at(-1);
    if (!latest) continue;
    found.push({ id: c.id, name: c.summary ?? c.id, latest });
    all.push(...items);
  }
  found.sort((a, b) => b.latest.localeCompare(a.latest));
  return { calendars: found.map(({ id, name }) => ({ id, name })), hint: list.find((c) => c.primary)?.id ?? null, owner: calendarOwner(all) };
}

/** אירועי הסבב סביב תאריך הטיסה: סבב יכול להתחיל ימים לפני הרגל. */
export async function eventsAround(token, calendars, brief) {
  const d = flightDate(brief);
  if (!d) return [];
  const timeMin = new Date(d - 14 * DAY).toISOString(), timeMax = new Date(d + 2 * DAY).toISOString();
  const out = [];
  for (const c of calendars) out.push(...await slipEvents(token, c.id, timeMin, timeMax));
  return out;
}

// ---- פענוח (קוד טהור) ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** תאריך הטיסה (UTC, ms) מ-dateCode של התדריך ("10Nov26"), או null. */
function flightDate(brief) {
  const m = /^(\d{2})([A-Za-z]{3})(\d{2})$/.exec(brief.dateCode ?? '');
  const mon = m && MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  return m && mon >= 0 ? Date.UTC(2000 + Number(m[3]), mon, Number(m[1])) : null;
}

const CREW_LINE = /^\s*([A-Z]{2,4})\s+(\d{3,})\s+([A-Z0-9]{1,4})\s+(.+?)\s*(\[|$)/;
const LEG_LINE = /^\s*\d+\)\s+(\d{1,4})\s+\S+\s+[A-Z]{3}-[A-Z]{3}\s+\[(\d\d)\.(\d\d)\s/;
const staffId = (s) => s.replace(/^0+(?=\d)/, '');

/** אירוע סבב: רשימת הקוקפיט, הקבינה של כל הסבב, והרגליים עם הקבינה של כל אחת. */
export function parseSlip(description) {
  const lines = String(description ?? '').split(/\r?\n/);
  const slip = { cockpit: [], cabin: null, legs: [] };
  let block = null; // הרשימה שנאספת כרגע
  let leg = null;
  for (const line of lines) {
    if (!line.trim()) { block = null; continue; }
    if (/^\s*Cockpit:\s*$/.test(line)) { block = slip.cockpit; continue; }
    if (/^\s*Cabin:\s*$/.test(line)) {
      block = [];
      if (leg) leg.cabin = block; else slip.cabin = block;
      continue;
    }
    const l = LEG_LINE.exec(line);
    if (l) { leg = { number: String(Number(l[1])), day: l[2], month: l[3], cabin: null }; slip.legs.push(leg); block = null; continue; }
    if (/:\s*$/.test(line) || /^\s*Slip details/.test(line)) { block = null; continue; }
    const c = block && CREW_LINE.exec(line);
    if (c) block.push({ status: c[1], id: staffId(c[2]), rank: c[3], name: c[4].replace(/\s+/g, ' ').trim() });
  }
  return slip;
}

/**
 * בעל היומן: מספר העובד שברשימת ה-Cockpit בלפחות 80% מהסבבים (לפחות 3), כמו באפליקציית הפיצויים.
 * אחרת null.
 */
export function calendarOwner(items) {
  const counts = new Map();
  let slips = 0;
  for (const ev of items ?? []) {
    if (ev.status === 'cancelled' || !(ev.description ?? '').includes(SLIP_MARK)) continue;
    const ids = new Set(parseSlip(ev.description).cockpit.map((p) => p.id));
    if (!ids.size) continue;
    slips++;
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const [first, second] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (slips < 3 || !first || first[1] < 0.8 * slips || (second && second[1] === first[1])) return null;
  return first[0];
}

const cap = (w) => w.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_, p, ch) => p + ch.toUpperCase());
const words = (name) => name.split(' ').filter(Boolean).map(cap);

/** "LEVI DANA" → "Dana Levi": המילה הראשונה ביומן היא שם המשפחה. */
export function fullName(name) {
  const [last, ...first] = words(name);
  return [...first, last].filter(Boolean).join(' ');
}

/** השם הפרטי בלבד. */
export function firstName(name) {
  const [last, ...first] = words(name);
  return first.length ? first.join(' ') : last ?? '';
}

/**
 * השמות לדפית מהרגל של התדריך (requirements.md, 3.3).
 * @returns {{ok:true, ck:string[], cab:string[]} | {ok:false, error:string}}
 */
export function crewFor(items, brief, owner) {
  const d = flightDate(brief);
  const want = { number: String(Number(brief.number)), day: String(brief.day).padStart(2, '0'), month: d ? String(new Date(d).getUTCMonth() + 1).padStart(2, '0') : '' };
  for (const ev of items ?? []) {
    if (ev.status === 'cancelled') continue;
    const slip = parseSlip(ev.description);
    const leg = slip.legs.find((l) => l.number === want.number && l.day === want.day && l.month === want.month);
    if (!leg) continue;
    const working = (p) => !/^DH/.test(p.status);
    const ck = slip.cockpit.filter((p) => working(p) && p.id !== owner).map((p) => fullName(p.name));
    const cabin = (leg.cabin ?? slip.cabin ?? []).filter(working);
    const pursers = cabin.filter((p) => p.rank === 'PUR').map((p) => fullName(p.name));
    const rest = cabin.filter((p) => p.rank !== 'PUR').map((p) => firstName(p.name)).join(', ');
    const cab = [...pursers, ...(rest ? [rest] : [])];
    return { ok: true, ck: ck.length ? ck : [''], cab: cab.length ? cab : [''] };
  }
  return { ok: false, error: `טיסה ${want.number} ב-${want.day}/${want.month} לא נמצאה ביומן.` };
}
