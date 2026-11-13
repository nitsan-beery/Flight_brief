// מסך סיכום ה-NOTAM (requirements.md, 5.3, אושר כבסיס בהדמיה).
// כרטיס לכל שדה רלוונטי, קבוצות לפי נושא, טקסט ה-NOTAM כמו שהוא (LTR), והערך של קטגוריית המטוס מודגש.
// הלוגיקה עצמה ב-notam.js. כאן רק בניית ה-DOM, עם textContent (בלי HTML מהתדריך).

import { GROUPS, GROUP_LABEL, groupOf, validLabel, hhColon, REASON_LABEL, ROLE_LABEL } from './notam.js';

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

function notamItem(n, reason) {
  const item = el('div', 'nt');
  const meta = el('div', 'nt-meta');
  meta.dir = 'ltr';
  meta.append(el('span', null, n.id), el('span', null, validLabel(n.valid)));
  if (n.temporary) meta.append(el('span', 'nt-tmp', 'זמני'));
  if (reason) meta.append(el('span', 'nt-why', REASON_LABEL[reason] ?? reason));
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

function card(c) {
  const box = el('section', 'nt-card');
  const hd = el('div', 'nt-hd');
  const icao = el('span', 'nt-icao', c.icao);
  icao.dir = 'ltr';
  hd.append(icao);
  for (const r of c.roles) hd.append(el('span', 'nt-chip', ROLE_LABEL[r.role]));
  const win = el('span', 'nt-win', `${windowLabel(c.roles)} · ${c.shown.length}`);
  win.dir = 'ltr';
  hd.append(win);
  box.append(hd);
  for (const r of c.roles) if (r.note) box.append(el('p', 'nt-empty', `${ROLE_LABEL[r.role]}: ${r.note}. ה-NOTAM מוצגים בלי סינון לפי זמן.`));

  if (!c.shown.length) box.append(el('p', 'nt-empty', 'אין NOTAM רלוונטי'));
  const groups = new Map(GROUPS.map((g) => [g, []]));
  for (const n of c.shown) groups.get(groupOf(n)).push(n);
  for (const [g, list] of groups) {
    if (!list.length) continue;
    box.append(el('div', 'nt-grp', GROUP_LABEL[g]));
    for (const n of list) box.append(notamItem(n));
  }

  if (c.hidden.length) {
    const counts = {};
    for (const n of c.hidden) counts[n.reason] = (counts[n.reason] || 0) + 1;
    const det = el('details', 'nt-hidden');
    const sum = el('summary', null, `הוסתרו ${c.hidden.length}: ${Object.entries(counts).map(([k, v]) => `${REASON_LABEL[k] ?? k} ${v}`).join(', ')}`);
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
  for (const c of res.cards) slot.append(card(c));
}
