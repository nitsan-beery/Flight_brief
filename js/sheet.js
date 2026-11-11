// דפית הטיסה במסך האפליקציה: ערכים מהתדריך (בלי תיבה) ושדות להזנה ידנית. בלי קישורים לקובץ (החלטת הבעלים).
// requirements.md, סעיפים 5.1 ו-5.1.1.

import { flightLabel, sameFlight } from './brief.js';

export const MISSING = 'לא נמצא';

/** ערכי ברירת המחדל של השדות הידניים. B.F מתחיל מערך התכנון. */
export function emptyManual(brief) {
  const bf = brief.fields.bf;
  return { bf: bf.missing ? '' : bf.value, ck: [''], cab: [''], cg: '', sob: '', n1: '', v1: '', vr: '', v2: '' };
}

const LS_OPT = ['cg', 'sob', 'n1', 'v1', 'vr', 'v2'];

/**
 * הנתונים הידניים לתדריך שנטען, לפי התדריך הקודם (requirements.md, 5.0, גרסה 17).
 * @param {{brief, manual}|null} prev
 * @returns {{manual, keep:object|null}} keep: הנתונים אם המשתמש יבחר "השאר"; null כשאין שאלה.
 */
export function nextManual(prev, brief) {
  const fresh = emptyManual(brief);
  if (!prev || !sameFlight(prev.brief, brief)) return { manual: fresh, keep: null };
  const manual = { ...fresh, ck: prev.manual.ck, cab: prev.manual.cab };
  const has = LS_OPT.some((k) => String(prev.manual[k] ?? '').trim());
  if (prev.brief.reg !== brief.reg || !has) return { manual, keep: null };
  const keep = { ...manual };
  for (const k of LS_OPT) keep[k] = prev.manual[k] ?? '';
  return { manual, keep };
}

/** שורות הערכים הקיימים לחלון השאלה: Loadsheet ו-OPT, רק מה שיש בו ערך. */
export function keptLines(m) {
  const t = (k) => String(m[k] ?? '').trim();
  const ls = [t('cg') && `CG ${t('cg')}`, t('sob') && `SOB ${t('sob')}`].filter(Boolean);
  const sp = ['v1', 'vr', 'v2'].map(t);
  const opt = [t('n1') && `N1 ${t('n1')}`, sp.some(Boolean) && sp.map((x) => x || '—').join(' / ')].filter(Boolean);
  return [ls.length && `Loadsheet:  ${ls.join(' · ')}`, opt.length && `OPT:  ${opt.join(' · ')}`].filter(Boolean);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const val = (f) => (f.missing ? MISSING : f.value);

function briefCell(label, keys, fields) {
  const fs = keys.split(',').map((k) => fields[k]);
  const missing = fs.some((f) => f.missing);
  const text = fs.map(val).join(' – ');
  return `<div class="cell"><div class="lb">${label}</div><div class="v${missing ? ' missing' : ''}">${esc(text)}</div></div>`;
}

function inputCell(label, key, value, mode) {
  return `<div class="cell"><div class="lb">${label}</div><input data-k="${key}" inputmode="${mode}" autocomplete="off" value="${esc(value)}" aria-label="${label}"></div>`;
}

/** תיבה אחת בתוך משבצת המהירויות של OPT (requirements.md, 5.1.1). */
function speed(label, key, value) {
  return `<div><div class="lb">${label}</div><input data-k="${key}" inputmode="numeric" autocomplete="off" value="${esc(value)}" aria-label="${label}"></div>`;
}

function crewCell(label, list, names) {
  const rows = (names.length ? names : ['']).map((n, i) => `<input class="nm" data-list="${list}" data-i="${i}" placeholder="שם" autocomplete="off" value="${esc(n)}" aria-label="${label} ${i + 1}">`).join('');
  return `<div class="cell"><div class="lb heb">${label}</div><div class="names" data-list="${list}">${rows}</div><button type="button" class="add" data-add="${list}">+ הוסף</button></div>`;
}

/**
 * בונה את הדפית בתוך slot.
 * @param {{onChange:(manual)=>void}} on
 * @returns {HTMLElement} הדפית עצמה (כדי שאפשר יהיה להעביר אותה לחלון צף ב-Windows)
 */
export function renderSheet(slot, brief, manual, on) {
  const f = brief.fields;
  const plan = f.bf.missing ? null : f.bf.value;
  const type = f.type.missing ? MISSING : f.type.value;
  const el = document.createElement('div');
  el.className = 'fs';
  el.id = 'sheet';
  el.innerHTML = `
    <div class="fs-head">
      <div><div class="fs-flight">${esc(flightLabel(brief))}</div><div class="fs-route">${esc(`${brief.org} → ${brief.dst} · ${brief.reg} · ${type}`)}</div></div>
      <div class="fs-meta">${esc(val(f.date))}<br>OFP ${esc(brief.ofp)}</div>
    </div>
    <div class="sec">זמנים</div>
    <div class="grid" style="grid-template-columns:2fr 1fr">${briefCell('STD – STA', 'std,sta', f)}${briefCell('ETE', 'ete', f)}</div>
    <div class="sec">דלק ומשקל</div>
    <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      ${briefCell('T.F', 'tf', f)}${briefCell('T.O.W', 'tow', f)}
      <div class="cell"><div class="lb">B.F (${esc(plan ?? MISSING)})</div><input data-k="bf" inputmode="decimal" autocomplete="off" value="${esc(manual.bf)}" aria-label="B.F"></div>
    </div>
    <div class="sec">צוות</div>
    <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));align-items:start">${crewCell('קבינה', 'cab', manual.cab)}${crewCell('קוקפיט', 'ck', manual.ck)}</div>
    <div class="sec">Loadsheet</div>
    <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">${inputCell('CG (MACTOW)', 'cg', manual.cg, 'decimal')}${inputCell('SOB', 'sob', manual.sob, 'numeric')}</div>
    <div class="sec">OPT</div>
    <div class="grid opt">${inputCell('N1', 'n1', manual.n1, 'decimal')}<div class="cell speeds">${speed('V1', 'v1', manual.v1)}${speed('VR', 'vr', manual.vr)}${speed('V2', 'v2', manual.v2)}</div></div>
    <div class="legend">כלי עזר בלבד</div>`;

  const bfInput = el.querySelector('input[data-k="bf"]');
  const markBf = () => bfInput.classList.toggle('chg', plan !== null && bfInput.value.trim() !== plan);
  markBf();

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k) manual[t.dataset.k] = t.value;
    else if (t.dataset.list) manual[t.dataset.list][Number(t.dataset.i)] = t.value;
    else return;
    if (t === bfInput) markBf();
    on.onChange(manual);
  });
  el.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const list = add.dataset.add;
      manual[list].push('');
      const box = el.querySelector(`.names[data-list="${list}"]`);
      const i = manual[list].length - 1;
      const input = Object.assign(el.ownerDocument.createElement('input'), { className: 'nm', placeholder: 'שם', autocomplete: 'off' });
      input.dataset.list = list;
      input.dataset.i = String(i);
      input.setAttribute('aria-label', `${list === 'ck' ? 'קוקפיט' : 'קבינה'} ${i + 1}`);
      box.append(input);
      input.focus();
      on.onChange(manual);
    }
  });

  slot.replaceChildren(el);
  return el;
}
