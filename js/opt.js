// ניתוח קובץ ההדפסה של אפליקציית ה-OPT (mainScreenPrint.pdf) לשדות OPT בדפית. requirements.md, 5.1.3.
//
// קוד טהור, בלי PDF.js: מקבל את שורות העמוד (toLines) ומחזיר FLAPS, ‏N1 ו-V1/VR/V2.
// אין ניחוש שקט: קובץ שחסר בו אחד מהם נדחה כולו. ATM לא נלקח (החלטת הבעלים). CG אינו בקובץ.

const TITLE = /OPT TAKEOFF CALCULATION RESULTS/;
const RWY = /^\|\s*\S+\s*\|\s*([A-Z]{4})\s+(\S+)/;
const N1 = /\bN1:\s*(\d+(?:\.\d+)?)\b/;
const SPEEDS = /\bTO SPEEDS:\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\b/;
const TOW = /\bTOW:\s*(\d+)\s*KG\b/;
const FLAP = /\bFLAP\s+(\d+)\b/;

const first = (lines, re) => {
  for (const l of lines) {
    const m = re.exec(l.text);
    if (m) return m;
  }
  return null;
};

/**
 * @param {{text:string}[]} lines שורות העמוד
 * @returns {{ok:true, opt:{apt, rwy, tow, flap, n1, v1, vr, v2}} | {ok:false, error:string}}
 * tow: ק"ג כמחרוזת, או null כשאינו בקובץ (מוצג בהודעה בלבד).
 */
export function parseOpt(lines) {
  if (!first(lines, TITLE)) return { ok: false, error: 'הקובץ לא זוהה כהדפסה של ה-OPT.' };
  const rwy = first(lines, RWY);
  const n1 = first(lines, N1);
  const sp = first(lines, SPEEDS);
  const flap = first(lines, FLAP);
  const missing = [!rwy && 'שדה ומסלול', !flap && 'FLAPS', !n1 && 'N1', !sp && 'V1/VR/V2'].filter(Boolean);
  if (missing.length) return { ok: false, error: `בקובץ ה-OPT לא נמצא: ${missing.join(', ')}. הנתונים לא נטענו.` };
  const tow = first(lines, TOW);
  return { ok: true, opt: { apt: rwy[1], rwy: rwy[2], tow: tow ? tow[1] : null, flap: flap[1], n1: n1[1], v1: sp[1], vr: sp[2], v2: sp[3] } };
}

export const OPT_KEYS = ['flap', 'n1', 'v1', 'vr', 'v2'];
const LABEL = { flap: 'FLAPS' };

/**
 * מה לעשות עם הנתונים מול התדריך והדפית.
 * @returns {{ok:false, error} | {ok:true, ask:string[]|null}} ask: שורות "קיים → חדש" כשיש כבר ערכים.
 */
export function planOpt(opt, brief, manual) {
  if (opt.apt !== brief.org) return { ok: false, error: `קובץ ה-OPT הוא ל-${opt.apt}, והתדריך יוצא מ-${brief.org}. הנתונים לא נטענו.` };
  const cur = (k) => String(manual[k] ?? '').trim();
  const has = OPT_KEYS.some(cur);
  const ask = has ? OPT_KEYS.map((k) => `${LABEL[k] ?? k.toUpperCase()} ${cur(k) || '—'} → ${opt[k]}`) : null;
  return { ok: true, ask };
}
