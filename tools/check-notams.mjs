// בדיקת סינון ה-NOTAM מול תדריכים אמיתיים (requirements.md, 5.3–5.3.2).
// לכל תדריך: השדות הרלוונטיים וחלונות הזמן, ספירה של מוצג ומוסתר לפי סיבה, ורשימת ה-NOTAM.
// התדריכים לא נכנסים לריפו (CLAUDE.md). ברירת המחדל היא תיקיית הדוגמאות ב-OneDrive.
//
// הרצה:  node tools/check-notams.mjs [תיקייה] [--shown] [--hidden] [--only=LY347]
//   --shown   ה-NOTAM המוצגים במלואם. [✂ ...] קטע מושמט (גישה לא מאושרת), «...» טקסט מובלט
//   --hidden  רשימת ה-NOTAM שהוסתרו בשדות רלוונטיים, עם הסיבה

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPdf, extractPage } from '../js/pdf/extract.js';
import { parseBrief, toLines } from '../js/brief.js';
import { parseBulletin, flightContext, filterNotams, REASON_LABEL, ROLE_LABEL, SUBJECT_LABEL } from '../js/notam.js';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const dir = args.find((a) => !a.startsWith('--')) ?? join(process.env.OneDrive ?? join(process.env.USERPROFILE ?? '', 'OneDrive'), 'Code_Dev/Claude/Flight_brief/samples');

const hhmm = (t) => new Date(t).toISOString().slice(11, 16);
const win = (w) => (w ? `${hhmm(w.from)}–${hhmm(w.to)}` : 'לא ידוע');
const FILTER_REASONS = ['approach', 'size', 'apch-cat', 'rffs', 'mtow'];

const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
const total = {};
for (const f of files) {
  if (only && !f.includes(only)) continue;
  const doc = await openPdf(await readFile(join(dir, f)));
  const pages = [];
  let page1 = null;
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await extractPage(doc, p);
    if (p === 1) page1 = pg;
    pages.push(toLines(pg.items).map((l) => l.text));
  }
  await doc.destroy();

  const res = parseBrief(page1);
  if (!res.ok) { console.log(`✗ ${f}: ${res.error}`); continue; }
  const b = res.brief;
  const all = pages.flat();
  const bul = parseBulletin(all);
  if (!bul.ok) { console.log(`✗ ${f}: ${bul.error}`); continue; }
  const startPage = pages.findIndex((ls) => ls.some((l) => /LIDO-NOTAM-BULLETIN INCLUDES/.test(l)));
  const ctx = flightContext(pages[0], pages.slice(0, startPage).flat(), { org: b.org, dst: b.dst, reg: b.reg, type: b.fields.type.value });
  if (!ctx.ok) { console.log(`✗ ${f}: ${ctx.error}`); continue; }
  const out = filterNotams(bul.notams, ctx);

  const shown = out.filter((n) => n.shown);
  console.log(`\n══ LY${b.number} ${b.org}–${b.dst} · ${ctx.type} (${ctx.fleet?.key ?? 'לא מזוהה'}) · MTOW ${ctx.mtowKg} (${ctx.mtowSource === 'brief' ? 'מהתדריך' : 'מהטבלה'})`);
  for (const w of ctx.warnings) console.log(`   ⚠ ${w}`);
  console.log(`   ${out.length} NOTAM · מוצגים ${shown.length}`);
  for (const ap of ctx.airports.values()) {
    const here = out.filter((n) => n.place === ap.icao);
    const roles = ap.roles.map((r) => `${ROLE_LABEL[r.role]} ${win(r.window)}`).join(' · ');
    const reasons = {};
    for (const n of here.filter((x) => !x.shown)) reasons[n.reason] = (reasons[n.reason] || 0) + 1;
    const subj = {};
    for (const n of here.filter((x) => x.shown)) for (const s of n.subjects) subj[s] = (subj[s] || 0) + 1;
    console.log(`   ${ap.icao}  ${roles}`);
    console.log(`      מוצגים ${here.filter((x) => x.shown).length}${here.length ? '' : ' (אין NOTAM בבולטין)'}  ${Object.entries(subj).map(([k, v]) => `${SUBJECT_LABEL[k]} ${v}`).join(', ')}`);
    if (Object.keys(reasons).length) console.log(`      מוסתרים ${here.length - here.filter((x) => x.shown).length}: ${Object.entries(reasons).map(([k, v]) => `${REASON_LABEL[k]} ${v}`).join(', ')}`);
    if (flag('--shown')) for (const n of here.filter((x) => x.shown)) {
      console.log(`        ✓ ${n.id}  ${n.valid.raw}`);
      const body = n.segments.map((s) => {
        if (s.omit) return `[✂ ${s.flat}]${/\n/.test(s.text) ? '\n' : ' '}`;
        let t = s.text;
        for (const [a, b] of [...s.marks].sort((x, y) => y[0] - x[0])) t = `${t.slice(0, a)}«${t.slice(a, b)}»${t.slice(b)}`;
        return t;
      }).join('');
      for (const l of body.split('\n')) if (l.trim()) console.log(`              ${l.trim()}`);
    }
    if (flag('--hidden')) for (const n of here.filter((x) => !x.shown && (flag('--all-reasons') || FILTER_REASONS.includes(x.reason) || x.reason === 'subject' || x.reason === 'sid'))) {
      console.log(`        ✗ ${n.id} [${REASON_LABEL[n.reason]}] ${n.lines.slice(0, 3).join(' / ').slice(0, 160)}`);
    }
  }
  const away = {};
  for (const n of out.filter((x) => !x.shown && !ctx.airports.has(x.place))) away[n.reason] = (away[n.reason] || 0) + 1;
  console.log(`   מחוץ לשדות הרלוונטיים: ${Object.entries(away).map(([k, v]) => `${REASON_LABEL[k]} ${v}`).join(', ')}`);
  for (const n of out) { const k = n.shown ? 'shown' : n.reason; total[k] = (total[k] || 0) + 1; }
}
console.log(`\nסה"כ: ${Object.entries(total).map(([k, v]) => `${k === 'shown' ? 'מוצגים' : REASON_LABEL[k]} ${v}`).join(' · ')}`);
