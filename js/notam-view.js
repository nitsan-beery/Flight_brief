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

/**
 * מפה אחת למסך כולו (5.3.3, גרסה 76): מוצגת תמיד. במסך רחב בחצי השמאלי, בצר בתחתית.
 * show(card, items, focus): השדה של הכרטיס, ועליו הסגירות של ה-NOTAM שנבחרו.
 */
function mapPane(fleet) {
  const pane = el('aside', 'nt-mappane');
  const head = el('div', 'nt-maphd');
  const title = el('span', 'nt-icao');
  title.dir = 'ltr';
  const what = el('span', 'nt-mapwhat');
  const tools = el('span', 'nt-maptools');
  const btn = (label, text, fn) => { const b = el('button', 'nt-zoom', text); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.addEventListener('click', fn); tools.append(b); return b; };
  head.append(title, what, tools);
  const stage = el('div', 'nt-mapstage');
  const msg = el('p', 'nt-mapmsg');
  const osm = el('p', 'nt-osm');
  pane.append(head, stage, msg, osm);

  let ctl = null, shownIcao = null, token = 0;
  btn('התקרבות', '+', () => ctl?.zoomBy(1 / 1.6));
  btn('התרחקות', '−', () => ctl?.zoomBy(1.6));
  btn('כל השדה', '⤢', () => ctl?.reset());

  // onPick(n): לחיצה על סגירה במפה – ה-NOTAM שלה (גרסה 81).
  let onPick = null;
  async function show(c, items, focus, pick) {
    onPick = pick ?? null;
    const my = ++token;
    title.textContent = c.icao;
    what.textContent = focus ? items[0].id : items.length ? 'כל הסגירות' : '';
    if (shownIcao !== c.icao) {
      ctl = null;
      shownIcao = c.icao;
      stage.replaceChildren(el('p', 'nt-mapmsg', 'טוען מפה…'));
      osm.textContent = '';
      const map = await loadMap(c.icao);
      if (my !== token) return;
      if (!map) {
        stage.replaceChildren(el('p', 'nt-nomap', navigator.onLine === false ? 'המפה לא ירדה (אין חיבור).' : `אין מפה לשדה ${ltr(c.icao)}.`));
        msg.textContent = '';
        tools.hidden = true;
        return;
      }
      ctl = drawMap(map);
      ctl.map = map;
      ctl.onPick = (i) => onPick?.(i);
      stage.replaceChildren(ctl.svg);
      osm.textContent = `© OpenStreetMap contributors · ${map.date}`;
      tools.hidden = false;
    }
    if (!ctl) return;
    // כל NOTAM בנפרד, וכל קו או נקודה מסומנים במספר ה-NOTAM (nid), כדי שלחיצה במפה תחזיר אליו.
    const res = { lines: [], dots: [], refs: [], missing: [], whole: [] };
    items.forEach((n, i) => {
      const r = resolve(ctl.map, n.closures ?? []);
      for (const l of r.lines) res.lines.push({ ...l, nid: i });
      for (const p of r.dots) res.dots.push({ ...p, nid: i });
      res.refs.push(...r.refs);
      res.missing.push(...r.missing);
      res.whole.push(...r.whole);
    });
    res.missing = [...new Set(res.missing)];
    res.whole = [...new Set(res.whole)];
    ctl.onPick = (i) => onPick?.(items[i]);
    ctl.show(res, focus);
    const parts = [];
    if (res.missing.length) parts.push(`לא נמצא במפה: ${ltr(res.missing.join(', '))}.`);
    if (res.whole.length) parts.push(`הקטע לא זוהה, מסומן כל ה-TWY: ${ltr(res.whole.join(', '))}.`);
    if (focus && fleet && items.some((n) => n.closures?.some((x) => x.forUs))) parts.push(`סגור ל-${ltr(`Code ${fleet.code}`)}: המטוס מחוץ למגבלה.`);
    msg.textContent = parts.join(' ');
  }
  return { pane, show };
}

// הכרטיסים הפתוחים (לפי שדה), עד שנטען תדריך אחר.
let openRes = null;
const openCards = new Set();

function card(c, fleet, pane) {
  const box = el('section', 'nt-card');
  box.dataset.icao = c.icao;
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

  const closing = c.shown.filter((n) => n.closures?.length);
  const items = [];
  const select = (item) => {
    for (const it of document.querySelectorAll('.nt-card .nt.on')) it.classList.remove('on');
    for (const cd of document.querySelectorAll('.nt-card.sel')) cd.classList.remove('sel');
    box.classList.add('sel');
    item?.classList.add('on');
  };
  // לחיצה על סגירה במפה: הכרטיס נפתח, ה-NOTAM מסומן ונגלל למקום, והמפה מתמקדת בו. לחיצה נוספת – בחזרה לכל השדה.
  const pick = (n) => {
    const item = items.find(([m]) => m === n)?.[1];
    if (!item) return;
    if (item.classList.contains('on')) { showAll(); return; }
    setOpen(true);
    select(item);
    pane.show(c, [n], true, pick);
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const showAll = () => { select(null); pane.show(c, closing, false, pick); };

  // מקופל כברירת מחדל. לחיצה על הכותרת פותחת וסוגרת (לא על כפתור שבתוכה). פתיחה מעבירה את המפה לשדה.
  const setOpen = (on) => {
    box.classList.toggle('open', on);
    hd.setAttribute('aria-expanded', String(on));
    if (on) openCards.add(c.icao); else openCards.delete(c.icao);
  };
  setOpen(openCards.has(c.icao));
  const toggle = () => { const on = !box.classList.contains('open'); setOpen(on); if (on) showAll(); };
  hd.addEventListener('click', (e) => { if (!e.target.closest('button')) toggle(); });
  hd.addEventListener('keydown', (e) => {
    if (e.target === hd && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); }
  });
  for (const r of c.roles) if (r.note) box.append(el('p', 'nt-empty', `${ROLE_LABEL[r.role]}: ${r.note}. ה-NOTAM מוצגים בלי סינון לפי זמן.`));

  const list = el('div', 'nt-list');
  box.append(list);
  if (!c.shown.length) list.append(el('p', 'nt-empty', 'אין NOTAM רלוונטי'));
  const groups = new Map(GROUPS.map((g) => [g, []]));
  for (const n of c.shown) groups.get(groupOf(n)).push(n);
  for (const [g, ns] of groups) {
    if (!ns.length) continue;
    list.append(el('div', 'nt-grp', GROUP_LABEL[g]));
    for (const n of ns) {
      const item = notamItem(n, null, fleet);
      list.append(item);
      if (n.closures?.length) items.push([n, item]);
    }
  }

  // כפתור המפה בכותרת (כל הסגירות בשדה) וסמלי המפה ליד NOTAM – רק כשיש לשדה מפה.
  if (closing.length) {
    const allBtn = el('button', 'nt-mapbtn');
    allBtn.type = 'button';
    allBtn.hidden = true;
    allBtn.innerHTML = MAP_ICON;
    allBtn.setAttribute('aria-label', 'מפת סגירות');
    allBtn.title = 'מפת סגירות';
    hd.append(allBtn);
    allBtn.addEventListener('click', () => { setOpen(true); showAll(); });
    // כשיש מפה לשדה: לחיצה בכל מקום ב-NOTAM עם סגירה (לא רק על הסמל) מתמקדת בו במפה (גרסה 77).
    hasMap(c.icao).then((ok) => {
      if (!ok) return;
      allBtn.hidden = false;
      for (const [n, item] of items) {
        item.querySelector('.nt-pin').hidden = false;
        item.classList.add('nt-mapitem');
        // לחיצה נוספת על ה-NOTAM שנבחר: בחזרה לכל השדה, בלי סימון (גרסה 80).
        item.addEventListener('click', () => { if (item.classList.contains('on')) showAll(); else { select(item); pane.show(c, [n], true, pick); } });
      }
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
  return { box, showAll };
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

  // שני חלקים: הכרטיסים (מימין, או למעלה) והמפה (משמאל, או למטה).
  const split = el('div', 'nt-split');
  const cards = el('div', 'nt-cards');
  const pane = mapPane(f);
  split.append(cards, pane.pane);
  slot.append(split);
  const built = res.cards.map((c) => { const b = card(c, f, pane); cards.append(b.box); return [c, b]; });

  // בכניסה: שדה היעד, ואם אין לו מפה – השדה הראשון ברשימה שיש לו.
  (async () => {
    const order = [...built].sort((a, b) => (a[0].roles.some((r) => r.role === 'DEST') ? -1 : 0) - (b[0].roles.some((r) => r.role === 'DEST') ? -1 : 0));
    for (const [c, b] of order) if (await hasMap(c.icao)) { b.showAll(); return; }
    const dest = built.find(([c]) => c.roles.some((r) => r.role === 'DEST')) ?? built[0];
    if (dest) dest[1].showAll();
  })();
}
