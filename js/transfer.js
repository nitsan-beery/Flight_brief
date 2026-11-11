// העברת נתונים בין Safari, Chrome והאפליקציה ממסך הבית, שיש להם אחסון נפרד באייפד. requirements.md, סעיף 3.2.
//
// קוד טקסט בלוח: PREFIX ואחריו JSON ב-base64. בלי קובץ ה-PDF ובלי מיקומי המקור, רק מה שהדפית צריכה.
// קוד טהור, בלי DOM: הלוח עצמו ב-app.js.

import { flightLabel } from './brief.js';

const PREFIX = 'FLIGHT-BRIEF:1:';
const BRIEF_KEYS = ['number', 'day', 'dateCode', 'org', 'dst', 'reg', 'ofp'];
const FIELD_KEYS = ['std', 'sta', 'ete', 'tf', 'tow', 'bf', 'type', 'date'];
const TEXT_KEYS = ['bf', 'cg', 'sob', 'n1', 'v1', 'vr', 'v2'];

const toB64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const fromB64 = (s) => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

/** הקוד להעתקה. */
export function encodeTransfer(brief, manual) {
  const b = { pages: brief.pages, fields: {} };
  for (const k of BRIEF_KEYS) b[k] = brief[k];
  for (const k of FIELD_KEYS) {
    const f = brief.fields[k];
    b.fields[k] = !f || f.missing ? { missing: true } : { value: f.value };
  }
  const m = { ck: [...manual.ck], cab: [...manual.cab] };
  for (const k of TEXT_KEYS) m[k] = String(manual[k] ?? '');
  return PREFIX + toB64(JSON.stringify({ b, m }));
}

const isStr = (v) => typeof v === 'string';

/**
 * @returns {{ok:true, brief, manual} | {ok:false, error:string}}
 * אין ניחוש שקט: קוד שחסר בו שדה נדחה כולו.
 */
export function decodeTransfer(text) {
  const t = String(text ?? '').trim();
  if (!t.startsWith(PREFIX)) return { ok: false, error: 'בלוח אין נתונים שהועתקו מהאפליקציה. לחץ קודם "העתק נתונים" בצד השני.' };
  const bad = { ok: false, error: 'הנתונים בלוח פגומים. העתק אותם שוב.' };
  let data;
  try { data = JSON.parse(fromB64(t.slice(PREFIX.length))); } catch { return bad; }
  const { b, m } = data ?? {};
  if (!b || !m || !b.fields) return bad;
  if (!BRIEF_KEYS.every((k) => isStr(b[k]))) return bad;
  if (!/^\d{2}[A-Za-z]{3}\d{2}$/.test(b.dateCode)) return bad;
  const brief = { fields: {} };
  for (const k of BRIEF_KEYS) brief[k] = b[k];
  brief.pages = Number.isFinite(b.pages) ? b.pages : null;
  brief.flight = flightLabel(brief);
  for (const k of FIELD_KEYS) {
    const f = b.fields[k];
    if (f?.missing === true) brief.fields[k] = { missing: true };
    else if (isStr(f?.value)) brief.fields[k] = { value: f.value };
    else return bad;
  }
  const list = (l) => Array.isArray(l) && l.length > 0 && l.every(isStr);
  if (!list(m.ck) || !list(m.cab) || !TEXT_KEYS.every((k) => isStr(m[k]))) return bad;
  const manual = { ck: [...m.ck], cab: [...m.cab] };
  for (const k of TEXT_KEYS) manual[k] = m[k];
  return { ok: true, brief, manual };
}
