// מעתיק את קבצי האפליקציה ל-native/www, ש-Capacitor אורז לתוך אפליקציית ה-iOS. requirements.md, סעיף 6.5.
//
// הרשימה היא SHELL ב-sw.js: אותם קבצים שהאפליקציה צריכה כדי לעבוד בלי רשת. כך אין רשימה שנייה לתחזק.
// גם sw.js עצמו נכנס, כדי שהאפליקציה תדע איזו גרסה ארוזה בה (עדכון מהרשת, WebUpdatePlugin).

import { readFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'native', 'www');

const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const block = sw.match(/const SHELL = \[([\s\S]*?)\];/);
if (!block) throw new Error('SHELL לא נמצא ב-sw.js');
const files = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((f) => f !== './').concat('sw.js');
if (!files.includes('index.html')) throw new Error('index.html חסר ב-SHELL');

rmSync(out, { recursive: true, force: true });
for (const f of files) {
  mkdirSync(dirname(join(out, f)), { recursive: true });
  copyFileSync(join(root, f), join(out, f));
}
console.log(`הועתקו ${files.length} קבצים ל-native/www`);
