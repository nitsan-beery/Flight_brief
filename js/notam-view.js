// מסך סיכום ה-NOTAM (requirements.md, 5.3, אושר כבסיס בהדמיה).
// כרטיס לכל שדה רלוונטי, קבוצות לפי נושא, טקסט ה-NOTAM כמו שהוא (LTR), והערך של קטגוריית המטוס מודגש.
// הלוגיקה עצמה ב-notam.js. כאן רק בניית ה-DOM, עם textContent (בלי HTML מהתדריך).

import { GROUPS, GROUP_LABEL, groupOf, validLabel, hhColon, REASON_LABEL, ROLE_LABEL, roleLabel } from './notam.js';
import { hasMap, loadMap, drawMap, resolve } from './notam-map.js';

const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
const MAP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/></svg>';

// טקסט LTR בתוך משפט בעברית: בידוד כיווניות (LRI … PDI), כדי שלא יתהפך הסדר.
const ltr = (t) => `\u2066${t}\u2069`;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** הטקסט של NOTAM: בלי הקטעים המושמטים, עם <mark> על הערך של הקטגוריה. */
function notamText(n) {
  const box = el('div', 'nt-tx');
  box.dir = 'ltr';
  for (const s of n.segments) {
    if (s.omit) continue;
    let at = 0;
    for (const [a, b] of [...s.marks].sort((x, y) => x[0] - y[0])) {
      if (a < at) continue;
      box.append(s.text.slice(at, a), el('mark', null, s.text.slice(a, b)));
      at = b;
    }
    box.append(s.text.slice(at));
  }
  // הקטע הראשון שהושמט יכול להשאיר רווח או שורה ריקה בהתחלה.
  if (box.firstChild?.nodeType === 3) box.firstChild.textContent = box.firstChild.textContent.replace(/^\s+/, '');
  return box;
}

function notamItem(n, reason, fleet) {
  const item = el('div', 'nt');
  const meta = el('div', 'nt-meta');
  meta.dir = 'ltr';
  meta.append(el('span', null, n.id), el('span', null, validLabel(n.valid)));
  if (n.temporary) meta.append(el('span', 'nt-tmp', 'זמני'));
  if (n.newPerm && !reason) meta.append(el('span', 'nt-tmp', 'PERM חדש'));
  if (!reason && fleet && n.closures?.some((c) => c.forUs)) { const ch = el('span', 'nt-closed', `סגור ל-${ltr(`Code ${fleet.code}`)}`); ch.dir = 'rtl'; meta.append(ch); }
  if (!reason && n.closures?.length) {
    const pin = el('button', 'nt-pin');
    pin.type = 'button';
    pin.hidden = true;
    pin.setAttribute('aria-label', 'הצג במפה');
    pin.innerHTML = PIN;
    meta.append(pin);
  }
  if (reason) { const why = el('span', 'nt-why', REASON_LABEL[reason] ?? reason); why.dir = 'rtl'; meta.append(why); }
  item.append(meta);
  if (reason) {
    const tx = el('div', 'nt-tx', n.lines.join('\n'));
    tx.dir = 'ltr';
    item.append(tx);
  } else item.append(notamText(n));
  return item;
}

function windowLabel(roles) {
  const w = roles.map((r) => r.window).filter(Boolean);
  if (!w.length) return 'חלון לא ידוע';
  const from = Math.min(...w.map((x) => x.from));
  const to = Math.max(...w.map((x) => x.to));
  return `${hhColon(from)}–${hhColon(to)}Z`;
}

/** מפת הסגירות בכרטיס (5.3.3): נבנית בלחיצה הראשונה. */
function mapPanel(c, fleet, body) {
  const panel = el('div', 'nt-mapbox');
  panel.hidden = true;
  const msg = el('p', 'nt-mapmsg');
  let ctl = null;
  async function open(items, zoom) {
    if (!ctl) {
      const map = await loadMap(c.icao);
      if (!map) { panel.hidden = false; panel.replaceChildren(el('p', 'nt-mapmsg', 'המפה של השדה לא נטענה.')); return; }
      ctl = drawMap(map);
      ctl.map = map;
      panel.replaceChildren(ctl.svg, msg, el('p', 'nt-osm', `© OpenStreetMap contributors · ${map.date}`));
    }
    panel.hidden = false;
    body.classList.add('has-map');
    const res = resolve(ctl.map, items.flatMap((n) => n.closures));
    ctl.show(res, zoom);
    const parts = [];
    if (res.missing.length) parts.push(`לא נמצא במפה: ${ltr(res.missing.join(', '))}.`);
    if (res.whole.length) parts.push(`הקטע לא זוהה, מסומן כל ה-TWY: ${ltr(res.whole.join(', '))}.`);
    if (zoom && fleet && items.some((n) => n.closures.some((x) => x.forUs))) parts.push(`סגור ל-${ltr(`Code ${fleet.code}`)}: המטוס מחוץ למגבלה.`);
    if (!res.lines.length && !res.dots.length && !parts.length) parts.push('אין מה לסמן במפה.');
    msg.textContent = parts.join(' ');
    if (matchMedia('(max-width: 899px)').matches) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  return { panel, open };
}

// הכרטיסים הפתוחים (לפי שדה), עד שנטען תדריך אחר.
let openRes = null;
const openCards = new Set();

function card(c, fleet) {
  const box = el('section', 'nt-card');
  const hd = el('div', 'nt-hd');
  hd.setAttribute('role', 'button');
  hd.tabIndex = 0;
  const chev = el('span', 'nt-chev');
  chev.innerHTML = CHEV;
  const icao = el('span', 'nt-icao', c.icao);
  icao.dir = 'ltr';
  hd.append(chev, icao);
  // ‏LTR, כדי ש-"3% ERA" יוצג עם האחוז משמאל.
  for (const r of c.roles) { const chip = el('span', 'nt-chip', roleLabel(r)); if (r.pct) chip.dir = 'ltr'; hd.append(chip); }
  const win = el('span', 'nt-win', windowLabel(c.roles));
  win.dir = 'ltr';
  const cnt = el('span', 'nt-cnt', String(c.shown.length));
  hd.append(win, cnt);
  box.append(hd);
  // מקופל כברירת מחדל. לחיצה על הכותרת פותחת וסוגרת (לא על כפתור שבתוכה).
  const setOpen = (on) => {
    box.classList.toggle('open', on);
    hd.setAttribute('aria-expanded', String(on));
    if (on) openCards.add(c.icao); else openCards.delete(c.icao);
  };
  setOpen(openCards.has(c.icao));
  hd.addEventListener('click', (e) => { if (!e.target.closest('button')) setOpen(!box.classList.contains('open')); });
  hd.addEventListener('keydown', (e) => {
    if (e.target === hd && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(!box.classList.contains('open')); }
  });
  for (const r of c.roles) if (r.note) box.append(el('p', 'nt-empty', `${ROLE_LABEL[r.role]}: ${r.note}. ה-NOTAM מוצגים בלי סינון לפי זמן.`));

  const body = el('div', 'nt-body');
  const list = el('div', 'nt-list');
  body.append(list);
  box.append(body);
  if (!c.shown.length) list.append(el('p', 'nt-empty', 'אין NOTAM רלוונטי'));
  const groups = new Map(GROUPS.map((g) => [g, []]));
  for (const n of c.shown) groups.get(groupOf(n)).push(n);
  const closing = [];
  for (const [g, items] of groups) {
    if (!items.length) continue;
    list.append(el('div', 'nt-grp', GROUP_LABEL[g]));
    for (const n of items) {
      const item = notamItem(n, null, fleet);
      list.append(item);
      if (n.closures?.length) closing.push([n, item]);
    }
  }

  // מפת סגירות: רק כשיש סגירה ויש קובץ מפה לשדה.
  if (closing.length) {
    const { panel, open } = mapPanel(c, fleet, body);
    body.prepend(panel);
    const allBtn = el('button', 'nt-mapbtn');
    allBtn.type = 'button';
    allBtn.hidden = true;
    allBtn.innerHTML = MAP_ICON;
    allBtn.setAttribute('aria-label', 'מפת סגירות');
    allBtn.title = 'מפת סגירות';
    hd.append(allBtn);
    const select = (item) => { for (const [, it] of closing) it.classList.toggle('on', it === item); };
    allBtn.addEventListener('click', () => { setOpen(true); select(null); open(closing.map(([n]) => n), false); });
    for (const [n, item] of closing) {
      const pin = item.querySelector('.nt-pin');
      pin.addEventListener('click', () => { select(item); open([n], true); });
    }
    hasMap(c.icao).then((ok) => {
      if (!ok) return;
      allBtn.hidden = false;
      for (const [, item] of closing) item.querySelector('.nt-pin').hidden = false;
    });
  }

  if (c.hidden.length) {
    const counts = {};
    for (const n of c.hidden) counts[n.reason] = (counts[n.reason] || 0) + 1;
    const det = el('details', 'nt-hidden');
    // כותרת "הוסתרו N", ומתחתיה הסיבות בשורה אחת: מספר מודגש ואחריו הסיבה, מופרדות בפסיק (אושר בהדמיה, גרסה 72).
    // כל סיבה מבודדת (bdi), כדי שהמספר יישאר ליד הסיבה שלו גם כשיש בה טקסט באנגלית.
    const sum = el('summary', null, `הוסתרו ${c.hidden.length}`);
    const whyLine = el('div', 'nt-hidden-why');
    Object.entries(counts).forEach(([k, v], i) => {
      if (i) whyLine.append(', ');
      const why = el('bdi');
      why.dir = 'rtl';
      why.append(el('b', null, String(v)), ` ${REASON_LABEL[k] ?? k}`);
      whyLine.append(why);
    });
    sum.append(whyLine);
    det.append(sum);
    det.addEventListener('toggle', () => {
      if (!det.open || det.dataset.built) return;
      det.dataset.built = '1';
      for (const n of c.hidden) det.append(notamItem(n, n.reason));
    });
    box.append(det);
  }
  return box;
}

/**
 * @param {HTMLElement} slot
 * @param {ReturnType<import('./notam.js').analyzeBrief>} res
 */
export function renderNotams(slot, res) {
  slot.replaceChildren();
  if (!res.ok) { slot.append(el('p', 'note', res.error)); return; }
  const { ctx } = res;
  const f = ctx.fleet;
  const sum = el('p', 'nt-sum');
  if (f) { const b = el('bdi', null, `${f.key} · CAT ${f.apchCat} · Code ${f.code}`); b.dir = 'ltr'; sum.append(b); }
  else sum.append(`סוג מטוס לא מזוהה (${ctx.type})`);
  sum.append(` · מוצגים ${res.shown} מתוך ${res.total}`);
  slot.append(sum);
  for (const w of ctx.warnings) slot.append(el('p', 'note nt-warn', w));
  if (openRes !== res) { openRes = res; openCards.clear(); }
  for (const c of res.cards) slot.append(card(c, f));
}
