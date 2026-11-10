// דפית הטיסה במסך האפליקציה: ערכים מהתדריך (בלי תיבה, עם אייקון מקור) ושדות להזנה ידנית.
// requirements.md, סעיפים 5.1 ו-5.1.1.

export const ICON_SOURCE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6"/></svg>';
export const MISSING = 'לא נמצא';

/** ערכי ברירת המחדל של השדות הידניים. B.F מתחיל מערך התכנון. */
export function emptyManual(brief) {
  const bf = brief.fields.bf;
  return { bf: bf.missing ? '' : bf.value, ck: [''], cab: [''], cg: '', sob: '', n1: '', v1: '', vr: '', v2: '' };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const val = (f) => (f.missing ? MISSING : f.value);
const src = (keys, label) => `<button type="button" class="src" data-src="${keys}" aria-label="המקור בתדריך: ${label}">${ICON_SOURCE}</button>`;

function briefCell(label, keys, fields) {
  const fs = keys.split(',').map((k) => fields[k]);
  const missing = fs.some((f) => f.missing);
  const text = fs.map(val).join(' – ');
  return `<div class="cell"><div class="lb">${label}</div><div class="v${missing ? ' missing' : ''}">${esc(text)}${src(keys, label)}</div></div>`;
}

function inputCell(label, key, value, mode) {
  return `<div class="cell"><div class="lb">${label}</div><input data-k="${key}" inputmode="${mode}" autocomplete="off" value="${esc(value)}" aria-label="${label}"></div>`;
}

function crewCell(label, list, names) {
  const rows = (names.length ? names : ['']).map((n, i) => `<input class="nm" data-list="${list}" data-i="${i}" placeholder="שם" autocomplete="off" value="${esc(n)}" aria-label="${label} ${i + 1}">`).join('');
  return `<div class="cell"><div class="lb heb">${label}</div><div class="names" data-list="${list}">${rows}</div><button type="button" class="add" data-add="${list}">+ הוסף</button></div>`;
}

/**
 * בונה את הדפית בתוך slot.
 * @param {{onChange:(manual)=>void, onSource:(keys:string[])=>void}} on
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
      <div><div class="fs-flight">${esc(brief.flight)}${src('header', 'כותרת')}</div><div class="fs-route">${esc(`${brief.org} → ${brief.dst} · ${brief.reg} · ${type}`)}</div></div>
      <div class="fs-meta">${esc(val(f.date))}<br>OFP ${esc(brief.ofp)}</div>
    </div>
    <div class="sec">זמנים</div>
    <div class="grid" style="grid-template-columns:2fr 1fr">${briefCell('STD – STA', 'std,sta', f)}${briefCell('ETE', 'ete', f)}</div>
    <div class="sec">דלק ומשקל</div>
    <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      ${briefCell('T.F', 'tf', f)}${briefCell('T.O.W', 'tow', f)}
      <div class="cell"><div class="lb">B.F (${esc(plan ?? MISSING)})${src('bf', 'B.F')}</div><input data-k="bf" inputmode="decimal" autocomplete="off" value="${esc(manual.bf)}" aria-label="B.F"></div>
    </div>
    <div class="sec">צוות</div>
    <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));align-items:start">${crewCell('קבינה', 'cab', manual.cab)}${crewCell('קוקפיט', 'ck', manual.ck)}</div>
    <div class="sec">Loadsheet</div>
    <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">${inputCell('CG (MACTOW)', 'cg', manual.cg, 'decimal')}${inputCell('SOB', 'sob', manual.sob, 'numeric')}</div>
    <div class="sec">OPT</div>
    <div class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">${inputCell('N1', 'n1', manual.n1, 'decimal')}${inputCell('V1', 'v1', manual.v1, 'numeric')}${inputCell('VR', 'vr', manual.vr, 'numeric')}${inputCell('V2', 'v2', manual.v2, 'numeric')}</div>
    <div class="legend"><span>${ICON_SOURCE} מהתדריך</span><span><i class="box"></i> הזנה ידנית</span><span>כלי עזר בלבד</span></div>`;

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
      return;
    }
    const s = e.target.closest('[data-src]');
    if (s) on.onSource(s.dataset.src.split(','));
  });

  slot.replaceChildren(el);
  return el;
}
