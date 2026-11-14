// מפת סגירות בשדה (requirements.md, 5.3.3). מפה מ-OpenStreetMap (data/maps/ICAO.json, מ-tools/fetch-maps.mjs),
// ועליה באדום מה שסגור לפי ה-NOTAM: חניות, מסלולי הסעה (או הקטע), מסלולים.
// קואורדינטות במטרים: x מזרחה, y דרומה. בלי ניחוש: מה שלא נמצא – נכתב.

const NS = 'http://www.w3.org/2000/svg';

// ---------- טעינה לפי תדריך (5.3.3) ----------
// המפות לא באפליקציה עצמה: יורדות לשדות של התדריך מאתר האפליקציה, ונשמרות ב-IndexedDB לטיסה בלי רשת.
// באפליקציית ה-iOS הדף לא מ-GitHub Pages, ולכן כתובת מלאה (האתר שולח Access-Control-Allow-Origin: *).
const SITE = 'https://nitsan-beery.github.io/Flight_brief/';
const url = (path) => (/^https?:$/.test(location.protocol) ? path : SITE + path);
const KEEP_DAYS = 60;

let dbP = null;
function db() {
  dbP ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('flight-brief-maps', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('maps', { keyPath: 'icao' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbP;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('maps', mode);
    const r = fn(t.objectStore('maps'));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}
const getRec = (icao) => tx('readonly', (s) => s.get(icao)).catch(() => null);
const putRec = (rec) => tx('readwrite', (s) => s.put(rec)).catch(() => {});

let indexP = null;
/** רשימת המפות באתר: {ICAO: תאריך}, או null בלי רשת. פעם אחת לכל הפעלה. */
function siteIndex() {
  indexP ??= fetch(url('data/maps/index.json'), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => j.maps ?? {})
    .catch(() => { indexP = null; return null; });
  return indexP;
}

/** מוריד ושומר את המפות של השדות (רק חסרות או שהתעדכנו). בלי רשת – לא עושה כלום. */
export async function ensureMaps(icaos) {
  const idx = await siteIndex();
  if (!idx) return;
  const now = Date.now();
  for (const icao of new Set(icaos)) {
    const have = await getRec(icao);
    if (!idx[icao]) continue;
    if (have?.date === idx[icao]) { await putRec({ ...have, used: now }); continue; }
    try {
      const r = await fetch(url(`data/maps/${icao}.json`), { cache: 'no-cache' });
      if (r.ok) await putRec({ icao, date: idx[icao], used: now, map: await r.json() });
    } catch { /* בלי רשת באמצע – נשאר מה שיש */ }
  }
  // ניקוי: מפה שלא נעשה בה שימוש 60 יום.
  tx('readwrite', (s) => {
    s.openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      if (now - (c.value.used ?? 0) > KEEP_DAYS * 864e5) c.delete();
      c.continue();
    };
  }).catch(() => {});
}

/** המפה של השדה מהמכשיר (ואם אין – ניסיון להוריד), או null. */
export async function loadMap(icao) {
  let rec = await getRec(icao);
  if (!rec) { await ensureMaps([icao]); rec = await getRec(icao); }
  return rec?.map ?? null;
}

/** האם יש מפה לשדה (במכשיר, או שהורדה עכשיו). */
export async function hasMap(icao) {
  return !!(await loadMap(icao));
}

/** שם להשוואה: אותיות גדולות, רווח אחד, בלי אפסים מובילים במספר (X04 = X4). */
const norm = (s) => String(s).toUpperCase().replace(/\s+/g, ' ').trim().replace(/(^|[A-Z ])0+(\d)/g, '$1$2');
const pts = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
const rwyMatch = (r, want) => { const w = norm(want); return norm(r).split('/').includes(w) || norm(r) === w; };

/** מסלולי ההסעה עם השם, מחוברים לשרשראות לפי הצמתים שבקצוות. כל נקודה: [x, y, צומת]. */
function chains(map, ref) {
  const segs = map.twy.filter((t) => t.r && norm(t.r) === norm(ref)).map((t) => {
    const p = pts(t.p).map(([x, y]) => [x, y, 0]);
    for (const [i, j] of t.j ?? []) if (p[i]) p[i][2] = j;
    return p;
  });
  const out = [];
  while (segs.length) {
    let c = segs.shift();
    for (let grown = true; grown;) {
      grown = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], cs = c[0][2], ce = c.at(-1)[2], ss = s[0][2], se = s.at(-1)[2];
        if (ce && ce === ss) c = c.concat(s.slice(1));
        else if (ce && ce === se) c = c.concat(s.slice(0, -1).reverse());
        else if (cs && cs === se) c = s.concat(c.slice(1));
        else if (cs && cs === ss) c = s.slice(1).reverse().concat(c);
        else continue;
        segs.splice(i, 1);
        grown = true;
        break;
      }
    }
    out.push(c);
  }
  return out;
}

/** נקודת הייחוס של קטע על השרשרת: אינדקס, או null. */
function anchorIndex(map, chain, a) {
  const kinds = a.kind ? [a.kind] : ['twy', 'stand'];
  for (const kind of kinds) {
    if (kind === 'twy' || kind === 'rwy') {
      const src = kind === 'twy' ? map.twy.filter((t) => t.r && norm(t.r) === norm(a.ref)) : map.rwy.filter((r) => rwyMatch(r.r, a.ref));
      const js = new Set(src.flatMap((t) => (t.j ?? []).map(([, j]) => j)));
      const i = chain.findIndex((p) => p[2] && js.has(p[2]));
      if (i >= 0) return i;
    } else {
      const st = map.stand.find((s) => norm(s[0]) === norm(a.ref));
      if (!st) continue;
      let bi = -1, bd = 150; // עד 150 מ' מהחניה
      chain.forEach(([x, y], i) => { const d = Math.hypot(x - st[1], y - st[2]); if (d < bd) { bd = d; bi = i; } });
      if (bi >= 0) return bi;
    }
  }
  return null;
}

const mean = (c, k) => c.reduce((t, p) => t + p[k], 0) / c.length;

/** קטע של מסלול הסעה, או null כשהצמתים לא נמצאו. */
function segment(map, chs, seg) {
  for (const c of chs) {
    const i = anchorIndex(map, c, seg.a);
    if (i == null) continue;
    if (seg.rel === 'btn') {
      const j = anchorIndex(map, c, seg.b);
      if (j == null || j === i) continue;
      return c.slice(Math.min(i, j), Math.max(i, j) + 1);
    }
    const a = c.slice(0, i + 1), b = c.slice(i);
    if (a.length < 2) return b;
    if (b.length < 2) return a;
    const k = seg.rel === 'E' || seg.rel === 'W' ? 0 : 1;
    const more = seg.rel === 'E' || seg.rel === 'S';
    return (mean(a, k) > mean(b, k)) === more ? a : b;
  }
  return null;
}

/** מיקום של נקודת ייחוס (לתווית בלבד). */
function anchorPoint(map, a) {
  if (a.kind !== 'twy' && a.kind !== 'rwy') {
    const st = map.stand.find((s) => norm(s[0]) === norm(a.ref));
    if (st) return [st[1], st[2]];
  }
  const t = a.kind === 'rwy' ? map.rwy.find((r) => rwyMatch(r.r, a.ref)) : map.twy.find((x) => x.r && norm(x.r) === norm(a.ref));
  if (!t) return null;
  const p = pts(t.p);
  return p[Math.floor(p.length / 2)];
}

/**
 * מהסגירות של NOTAM (closuresOf) – מה לצייר.
 * @returns {{lines:{pts, label}[], dots:{x,y,label}[], refs:{x,y,label}[], missing:string[], whole:string[]}}
 */
export function resolve(map, closures) {
  nameRunways(map);
  const r = { lines: [], dots: [], refs: [], missing: [], whole: [] };
  for (const c of closures) {
    if (c.kind === 'stand') {
      const hits = map.stand.filter((s) => norm(s[0]) === norm(c.ref));
      if (!hits.length) r.missing.push(c.ref);
      for (const s of hits) r.dots.push({ x: s[1], y: s[2], label: c.ref });
    } else if (c.kind === 'rwy') {
      const hits = map.rwy.filter((x) => rwyMatch(x.r, c.ref));
      if (!hits.length) r.missing.push(`RWY ${c.ref}`);
      for (const h of hits) r.lines.push({ pts: pts(h.p), label: `RWY ${h.r}`, w: h.w });
    } else {
      const chs = chains(map, c.ref);
      if (!chs.length) { r.missing.push(`TWY ${c.ref}`); continue; }
      // ‏"BEHIND/ABEAM STAND" – אין גבולות לקטע: כל מסלול ההסעה, עם הערה.
      const part = c.seg && c.seg.rel !== 'near' && segment(map, chs, c.seg);
      if (c.seg && !part) r.whole.push(c.ref);
      if (part) r.lines.push({ pts: part.map(([x, y]) => [x, y]), label: c.ref });
      else for (const ch of chs) r.lines.push({ pts: ch.map(([x, y]) => [x, y]), label: c.ref });
      if (c.seg) for (const a of [c.seg.a, c.seg.b].filter(Boolean)) {
        const p = anchorPoint(map, a);
        if (p) r.refs.push({ x: p[0], y: p[1], label: a.ref });
      }
    }
  }
  r.missing = [...new Set(r.missing)];
  r.whole = [...new Set(r.whole)];
  return r;
}

const el = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent?.append(e);
  return e;
};
const d = (p) => 'M' + p.map(([x, y]) => `${x} ${y}`).join('L');

/**
 * מסלול שמחולק ב-OSM לכמה קטעים, ורק לחלק מהם יש שם (LSZH: הקטע הדרומי של 16/34): קטע בלי שם
 * שמתחבר בקצה שלו לקצה של מסלול עם שם, באותו כיוון (עד 10°), מקבל את השם. בלי זה ‏34 נכתב באמצע המסלול
 * ו-RWY 34 CLSD לא מסמן את כולו (גרסה 82).
 */
export function nameRunways(map) {
  if (map._named) return map;
  const endJ = (r) => { const n = r.p.length / 2 - 1; return (r.j ?? []).filter(([i]) => i === 0 || i === n).map(([, j]) => j); };
  const dir = (r) => { const p = pts(r.p), a = p[0], b = p.at(-1), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  for (let changed = true; changed;) {
    changed = false;
    for (const u of map.rwy) {
      if (u.r) continue;
      const ju = new Set(endJ(u));
      const named = map.rwy.find((r) => r.r && endJ(r).some((j) => ju.has(j)) && Math.abs(dir(r)[0] * dir(u)[0] + dir(r)[1] * dir(u)[1]) > Math.cos(Math.PI / 18));
      if (named) { u.r = named.r; changed = true; }
    }
  }
  map._named = true;
  return map;
}

/**
 * קצות המסלולים ושמותיהם: "10/28" – ‏10 בקצה שממנו הכיוון הוא כ-100°, ‏28 בקצה השני.
 * כמה קטעים עם אותו שם (מסלול שמחולק ב-OSM) – הקצוות הרחוקים ביותר לאורך הציר.
 * ux, uy: כיוון מהקצה לתוך המסלול (התווית נכתבת מעבר לקצה). שם שאינו מספר מסלול – בלי תווית.
 */
export function runwayEnds(rwys) {
  const out = [];
  const byRef = new Map();
  for (const r of rwys) if (r.r) byRef.set(r.r, [...(byRef.get(r.r) ?? []), ...pts(r.p)]);
  for (const [ref, p] of byRef) {
    const names = ref.split('/');
    const n0 = parseInt(names[0], 10);
    if (names.length !== 2 || !(n0 >= 1 && n0 <= 36) || p.length < 2) continue;
    // הציר: בין שתי הנקודות הרחוקות זו מזו.
    let a = p[0], b = p[1], best = -1;
    for (const q of p) for (const w of p) { const dd = (q[0] - w[0]) ** 2 + (q[1] - w[1]) ** 2; if (dd > best) { best = dd; a = q; b = w; } }
    const len = Math.sqrt(best);
    if (!len) continue;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    // כיוון מ-a ל-b במעלות (x מזרחה, y דרומה).
    const hdg = ((Math.atan2(ux, -uy) * 180) / Math.PI + 360) % 360;
    const diff = Math.abs(((hdg - n0 * 10 + 540) % 360) - 180);
    const [first, second] = diff < 90 ? [a, b] : [b, a];
    const fx = (second[0] - first[0]) / len, fy = (second[1] - first[1]) / len;
    out.push({ name: names[0], x: first[0], y: first[1], ux: fx, uy: fy });
    out.push({ name: names[1], x: second[0], y: second[1], ux: -fx, uy: -fy });
  }
  return out;
}

/**
 * SVG של השדה, עם זום והזזה (5.3.3): צביטה וגרירה במגע, גלגלת וגרירה בעכבר.
 * מחזיר {svg, show(resolved, focus), zoomBy(factor), reset()}.
 * התוויות והנקודות המודגשות שומרות על גודל קבוע על המסך בכל זום.
 */
export function drawMap(map) {
  nameRunways(map);
  const all = [...map.rwy, ...map.twy].flatMap((t) => pts(t.p));
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const full = all.length
    ? [Math.min(...xs) - 60, Math.min(...ys) - 60, Math.max(...xs) - Math.min(...xs) + 120, Math.max(...ys) - Math.min(...ys) + 120]
    : [-1000, -1000, 2000, 2000];
  const svg = el('svg', { class: 'nt-svg', viewBox: full.join(' '), role: 'img', 'aria-label': `מפת ${map.icao}` });
  const base = el('g', { class: 'm-base' }, svg);
  for (const a of map.apron) el('path', { d: d(pts(a.p)) + 'Z', class: 'm-apron' }, base);
  for (const t of map.term) el('path', { d: d(pts(t)) + 'Z', class: 'm-term' }, base);
  for (const r of map.rwy) el('path', { d: d(pts(r.p)), class: 'm-rwy', 'stroke-width': r.w }, base);
  for (const t of map.twy) el('path', { d: d(pts(t.p)), class: 'm-twy' }, base);
  for (const s of map.stand) el('circle', { cx: s[1], cy: s[2], r: 5, class: 'm-stand' }, base);
  const rl = el('g', {}, svg), hl = el('g', {}, svg), lb = el('g', {}, svg);
  const ends = runwayEnds(map.rwy);

  let vb = [...full];
  let cur = { lines: [], dots: [], refs: [] };
  let showRefs = false;

  /** מטרים לפיקסל במסך, ומיקום התוכן בתוך האלמנט (preserveAspectRatio: meet, ממורכז). */
  const geom = () => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return { s: Math.max(vb[2], vb[3]) / 400, r, ox: 0, oy: 0 };
    const s = Math.max(vb[2] / r.width, vb[3] / r.height);
    return { s, r, ox: (r.width - vb[2] / s) / 2, oy: (r.height - vb[3] / s) / 2 };
  };
  const toMap = (cx, cy) => {
    const g = geom();
    return [vb[0] + (cx - g.r.left - g.ox) * g.s, vb[1] + (cy - g.r.top - g.oy) * g.s];
  };

  /** התוויות והנקודות המודגשות, בגודל קבוע על המסך. */
  function overlay() {
    const { s } = geom();
    hl.replaceChildren();
    lb.replaceChildren();
    // שמות המסלולים בתחילתם, קצת מעבר לסף (גרסה 78).
    rl.replaceChildren();
    for (const e of ends) {
      const off = 14 * s;
      el('text', { x: e.x - e.ux * off, y: e.y - e.uy * off, 'font-size': 13 * s, class: 'm-rwylb' }, rl).textContent = e.name;
    }
    for (const l of cur.lines) {
      // מסלול – ברוחב האמיתי (ועוד קצת); מסלול הסעה – 7 פיקסלים בכל זום.
      if (l.w) el('path', { d: d(l.pts), class: 'm-hl', 'stroke-width': Math.max(l.w + 8, 7 * s) }, hl);
      else el('path', { d: d(l.pts), class: 'm-hl', 'stroke-width': 7 * s }, hl);
      // אזור לחיצה רחב ובלתי נראה, לאצבע (5.3.3, גרסה 81).
      if (l.nid != null) el('path', { d: d(l.pts), class: 'm-hit', 'stroke-width': Math.max((l.w ?? 0) + 8, 26 * s), 'data-nid': l.nid }, hl);
    }
    for (const p of cur.dots) {
      el('circle', { cx: p.x, cy: p.y, r: 7 * s, class: 'm-hl-dot' }, hl);
      if (p.nid != null) el('circle', { cx: p.x, cy: p.y, r: 16 * s, class: 'm-hit', 'data-nid': p.nid }, hl);
    }
    const fs = 14 * s;
    const seen = new Set();
    const label = (x, y, text, cls) => {
      if (seen.has(cls + text)) return;
      seen.add(cls + text);
      el('text', { x: x + fs * 0.4, y: y - fs * 0.4, 'font-size': fs, class: cls }, lb).textContent = text;
    };
    for (const l of cur.lines) { const p = l.pts[Math.floor(l.pts.length / 2)]; label(p[0], p[1], l.label, 'm-lb'); }
    for (const p of cur.dots) label(p.x, p.y, p.label, 'm-lb');
    if (showRefs) for (const r of cur.refs) label(r.x, r.y, r.label, 'm-ref');
  }

  // גבולות הזום: מ-150 מ' לרוחב ועד פי 2 מהשדה כולו.
  const minW = 150, maxW = Math.max(full[2], full[3]) * 2;
  function setVB(v) {
    const k = Math.min(Math.max(v[2], minW), maxW) / v[2];
    const cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2;
    vb = [cx - (v[2] * k) / 2, cy - (v[3] * k) / 2, v[2] * k, v[3] * k];
    svg.setAttribute('viewBox', vb.map((n) => Math.round(n * 10) / 10).join(' '));
    overlay();
  }
  /** זום סביב נקודה במסך (או סביב המרכז). factor < 1 – התקרבות. */
  function zoomAt(f, cx, cy) {
    const [px, py] = cx == null ? [vb[0] + vb[2] / 2, vb[1] + vb[3] / 2] : toMap(cx, cy);
    const w = Math.min(Math.max(vb[2] * f, minW), maxW), k = w / vb[2];
    vb = [px - (px - vb[0]) * k, py - (py - vb[1]) * k, vb[2] * k, vb[3] * k];
    svg.setAttribute('viewBox', vb.map((n) => Math.round(n * 10) / 10).join(' '));
    overlay();
  }

  // ---- מגע ועכבר ----
  const ptrs = new Map();
  let start = null;
  const snap = () => {
    const p = [...ptrs.values()];
    const mid = p.length === 2 ? [(p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2] : p.length ? [p[0].x, p[0].y] : null;
    start = { vb: [...vb], s: geom().s, mid, dist: p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0, anchor: mid && toMap(...mid) };
  };
  // לחיצה (בלי גרירה) על סגירה מסומנת: ה-NOTAM שלה (onPick). גרירה של יותר מ-6 פיקסלים אינה לחיצה.
  let tap = null;
  svg.addEventListener('pointerdown', (e) => {
    tap = ptrs.size === 0 ? { x: e.clientX, y: e.clientY, nid: e.target.closest?.('[data-nid]')?.getAttribute('data-nid') ?? null } : null;
    try { svg.setPointerCapture(e.pointerId); } catch { /* בלי לכידה – הגרירה עדיין עובדת בתוך המפה */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    snap();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !start) return;
    if (ptrs.size > 1) tap = null;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...ptrs.values()];
    if (p.length === 1) {
      const dx = (p[0].x - start.mid[0]) * start.s, dy = (p[0].y - start.mid[1]) * start.s;
      vb = [start.vb[0] - dx, start.vb[1] - dy, start.vb[2], start.vb[3]];
      svg.setAttribute('viewBox', vb.map((n) => Math.round(n * 10) / 10).join(' '));
    } else if (p.length === 2 && start.dist) {
      const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const w = Math.min(Math.max(start.vb[2] * (start.dist / dist), minW), maxW), k = w / start.vb[2];
      const mid = [(p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2];
      const s = start.s * k;
      const [ax, ay] = start.anchor;
      // הנקודה שהייתה בין האצבעות נשארת ביניהן.
      vb = [ax - (mid[0] - start.mid[0]) * s - (ax - start.vb[0]) * k, ay - (mid[1] - start.mid[1]) * s - (ay - start.vb[1]) * k, start.vb[2] * k, start.vb[3] * k];
      svg.setAttribute('viewBox', vb.map((n) => Math.round(n * 10) / 10).join(' '));
      overlay();
    }
  });
  const end = (e) => {
    if (!ptrs.delete(e.pointerId)) return;
    snap();
    overlay();
    if (e.type === 'pointerup' && tap?.nid != null && !ptrs.size && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 6) api.onPick?.(+tap.nid);
    if (!ptrs.size) tap = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  // גודל האלמנט השתנה (סיבוב מסך, מעבר בין רחב לצר): התוויות מחושבות מחדש.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => overlay()).observe(svg);

  /** focus: זום למה שמסומן (NOTAM אחד). אחרת – כל השדה. */
  function show(res, focus) {
    cur = res;
    showRefs = !!focus;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = ([x, y]) => { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); };
    for (const l of res.lines) l.pts.forEach(grow);
    for (const p of res.dots) grow([p.x, p.y]);
    if (focus) res.refs.forEach((r) => grow([r.x, r.y]));
    if (focus && box[0] < Infinity) {
      const w = Math.max(box[2] - box[0], 300) * 1.5, h = Math.max(box[3] - box[1], 300) * 1.5;
      setVB([(box[0] + box[2]) / 2 - w / 2, (box[1] + box[3]) / 2 - h / 2, w, h]);
    } else setVB([...full]);
  }
  const api = { svg, show, zoomBy: (f) => zoomAt(f), reset: () => setVB([...full]), onPick: null };
  return api;
}
