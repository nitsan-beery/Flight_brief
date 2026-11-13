// הורדת מפות שדות מ-OpenStreetMap למפת הסגירות (requirements.md, 5.3.3).
// לכל שדה: מסלולים, מסלולי הסעה (עם הצמתים), חניות, רחבות וטרמינלים, בקואורדינטות מקומיות במטרים
// (x מזרחה, y דרומה, ממרכז המסלולים). הקבצים ב-data/maps/ICAO.json, והרשימה ב-data/maps/index.json.
// הנתונים: © OpenStreetMap contributors, ‏ODbL.
//
// הרצה:  node tools/fetch-maps.mjs LSZH LFPG ...

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'maps');
const API = 'https://overpass-api.de/api/interpreter';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(q) {
  for (let i = 1; i <= 6; i++) {
    const res = await fetch(API, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'flight-brief-map-tool' } }).catch(() => null);
    if (res?.ok) return res.json();
    console.log(`  Overpass ${res?.status ?? 'ללא חיבור'} – ניסיון נוסף בעוד ${i * 10} שניות`);
    await sleep(i * 10000);
  }
  throw new Error('Overpass לא זמין');
}

const FEATURES = 'way[aeroway~"^(runway|taxiway|taxilane|parking_position|apron|terminal)$"]';
const query = (scope) => `[out:json][timeout:180];${scope}(${FEATURES}(area.a);node[aeroway=parking_position](area.a););out geom;`;

/** Douglas–Peucker על [[x,y],...]. */
function dp(a, eps) {
  if (a.length < 3) return a;
  const [x1, y1] = a[0], [x2, y2] = a.at(-1);
  const L = Math.hypot(x2 - x1, y2 - y1) || 1;
  let im = 0, dm = 0;
  for (let i = 1; i < a.length - 1; i++) {
    const d = Math.abs((y2 - y1) * a[i][0] - (x2 - x1) * a[i][1] + x2 * y1 - y2 * x1) / L;
    if (d > dm) { dm = d; im = i; }
  }
  return dm > eps ? [...dp(a.slice(0, im + 1), eps).slice(0, -1), ...dp(a.slice(im), eps)] : [a[0], a.at(-1)];
}

/** פישוט ששומר את הנקודות שבאינדקסים keep. מחזיר את הנקודות ואת האינדקסים החדשים שלהן. */
function simplifyKeep(pts, keep, eps) {
  const cuts = [...new Set([0, ...keep, pts.length - 1])].sort((a, b) => a - b);
  const out = [pts[0]];
  const at = new Map([[0, 0]]);
  for (let k = 1; k < cuts.length; k++) {
    const piece = dp(pts.slice(cuts[k - 1], cuts[k] + 1), eps);
    out.push(...piece.slice(1));
    at.set(cuts[k], out.length - 1);
  }
  return { pts: out, at };
}

const flat = (pts) => pts.flat();
const isRing = (g) => g.length > 3 && g[0].lat === g.at(-1).lat && g[0].lon === g.at(-1).lon;
const clean = (s) => (s ?? '').trim().toUpperCase();

async function build(icao) {
  let data = await overpass(query(`area["icao"="${icao}"]->.a;`));
  if (!data.elements.length) throw new Error(`לא נמצא שטח שדה עם icao=${icao} ב-OSM`);
  const ways = data.elements.filter((e) => e.type === 'way' && e.geometry);
  const rwyWays = ways.filter((e) => e.tags.aeroway === 'runway' && !isRing(e.geometry));
  const base = rwyWays.length ? rwyWays : ways;
  const all = base.flatMap((w) => w.geometry);
  const lat0 = all.reduce((t, p) => t + p.lat, 0) / all.length;
  const lon0 = all.reduce((t, p) => t + p.lon, 0) / all.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  const P = (p) => [Math.round((p.lon - lon0) * kx), Math.round((lat0 - p.lat) * ky)];

  // צמתים: נקודה שמשותפת לכמה מסלולי הסעה או מסלולים, או קצה של מסלול הסעה עם שם.
  const lineWays = ways.filter((e) => /^(taxiway|taxilane|runway)$/.test(e.tags.aeroway) && !isRing(e.geometry));
  const count = new Map();
  for (const w of lineWays) for (const n of new Set(w.nodes)) count.set(n, (count.get(n) || 0) + 1);
  const jid = new Map();
  const J = (n) => { if (!jid.has(n)) jid.set(n, jid.size + 1); return jid.get(n); };

  const twy = [], rwy = [], stand = [], apron = [], term = [];
  for (const w of ways) {
    const t = w.tags, g = w.geometry, pts = g.map(P);
    if (t.aeroway === 'taxiway' || t.aeroway === 'taxilane') {
      if (isRing(g)) continue;
      const r = clean(t.ref);
      if (!r) { twy.push({ p: flat(dp(pts, 1.5)) }); continue; }
      const keep = [];
      w.nodes.forEach((n, i) => { if (count.get(n) > 1 || i === 0 || i === w.nodes.length - 1) keep.push(i); });
      const s = simplifyKeep(pts, keep, 1.5);
      twy.push({ r, p: flat(s.pts), j: keep.map((i) => [s.at.get(i), J(w.nodes[i])]) });
    } else if (t.aeroway === 'runway') {
      if (isRing(g)) continue;
      const keep = [];
      w.nodes.forEach((n, i) => { if (count.get(n) > 1) keep.push(i); });
      const s = simplifyKeep(pts, keep, 2);
      rwy.push({ r: clean(t.ref), w: Math.round(+t.width || 45), p: flat(s.pts), j: keep.map((i) => [s.at.get(i), J(w.nodes[i])]) });
    } else if (t.aeroway === 'parking_position') {
      const r = clean(t.ref || t.name);
      if (!r) continue;
      const c = pts[Math.floor((pts.length - 1) / 2)];
      stand.push([r, c[0], c[1]]);
    } else if (t.aeroway === 'apron' && isRing(g)) {
      const h = pts.length >> 1;
      apron.push({ r: clean(t.ref || t.name), p: flat([...dp(pts.slice(0, h + 1), 2).slice(0, -1), ...dp(pts.slice(h), 2)]) });
    } else if (t.aeroway === 'terminal' && isRing(g)) {
      const h = pts.length >> 1;
      term.push(flat([...dp(pts.slice(0, h + 1), 2).slice(0, -1), ...dp(pts.slice(h), 2)]));
    }
  }
  for (const n of data.elements.filter((e) => e.type === 'node')) {
    const r = clean(n.tags?.ref || n.tags?.name);
    if (r) stand.push([r, ...P(n)]);
  }
  const date = new Date().toISOString().slice(0, 10);
  const map = { icao, date, src: '© OpenStreetMap contributors (ODbL)', rwy, twy, stand, apron, term };
  return { map, stats: `מסלולים ${rwy.length}, מסלולי הסעה ${twy.length} (עם שם ${twy.filter((t) => t.r).length}), חניות ${stand.length}, רחבות ${apron.length}` };
}

const list = process.argv.slice(2).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{4}$/.test(s));
if (!list.length) { console.log('הרצה: node tools/fetch-maps.mjs LSZH LFPG ...'); process.exit(1); }
await mkdir(OUT, { recursive: true });
const indexPath = join(OUT, 'index.json');
const index = JSON.parse(await readFile(indexPath, 'utf8').catch(() => '{"maps":{}}'));
for (const icao of list) {
  try {
    const { map, stats } = await build(icao);
    const text = JSON.stringify(map);
    await writeFile(join(OUT, `${icao}.json`), text);
    index.maps[icao] = map.date;
    console.log(`✓ ${icao}: ${stats} · ${(text.length / 1024).toFixed(0)} KB`);
  } catch (e) {
    console.log(`✗ ${icao}: ${e.message}`);
  }
  await sleep(3000);
}
index.maps = Object.fromEntries(Object.entries(index.maps).sort());
await writeFile(indexPath, JSON.stringify(index, null, 1) + '\n');
