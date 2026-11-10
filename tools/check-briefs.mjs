// בדיקה מול תדריכים אמיתיים: מנתח את עמוד 1 בכל קובץ PDF בתיקייה ומדפיס את שדות הדפית.
// התדריכים לא נכנסים לריפו (CLAUDE.md). ברירת המחדל היא תיקיית הדוגמאות ב-OneDrive.
//
// הרצה:  node tools/check-briefs.mjs [תיקייה]

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPdf, extractPage } from '../js/pdf/extract.js';
import { parseBrief, briefLabel } from '../js/brief.js';

const dir = process.argv[2] ?? join(process.env.OneDrive ?? join(process.env.USERPROFILE ?? '', 'OneDrive'), 'Code_Dev/Claude/Flight_brief/samples');
const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
const KEYS = ['date', 'type', 'std', 'sta', 'ete', 'tf', 'tow', 'bf'];

let failures = 0;
for (const f of files) {
  const doc = await openPdf(await readFile(join(dir, f)));
  const res = parseBrief(await extractPage(doc, 1));
  await doc.destroy();
  if (!res.ok) { failures++; console.log(`✗ ${f}: ${res.error}`); continue; }
  const b = res.brief;
  const missing = KEYS.filter((k) => b.fields[k].missing);
  if (missing.length) failures++;
  const vals = KEYS.map((k) => `${k}=${b.fields[k].missing ? '—' : b.fields[k].value}`).join(' ');
  console.log(`${missing.length ? '✗' : '✓'} ${briefLabel(b)} ${b.flight} ${b.reg} OFP ${b.ofp} (${b.pages}p)  ${vals}${missing.length ? `  חסר: ${missing.join(', ')}` : ''}`);
}
console.log(`\n${files.length} קבצים, ${failures} עם בעיה`);
process.exitCode = failures ? 1 : 0;
