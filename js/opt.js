// ניתוח קובץ ההדפסה של אפליקציית ה-OPT (mainScreenPrint.pdf) לשדות OPT בדפית. requirements.md, 5.1.3.
//
// קוד טהור, בלי PDF.js: מקבל את שורות העמוד (toLines) ומחזיר FLAPS, ‏N1 ו-V1/VR/V2.
// אין ניחוש שקט: קובץ שחסר בו אחד מהם נדחה כולו. ATM לא נלקח (החלטת הבעלים). CG אינו בקובץ.

const TITLE = /OPT TAKEOFF CALCULATION RESULTS/;
const RWY = /^\|\s*(\S+)\s*\|\s*([A-Z]{4})\s+(\S+)/; // | EKI | LSZH 28 WET |: קוד המטוס, שדה, מסלול
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
 * @returns {{ok:true, opt:{ac, apt, rwy, tow, flap, n1, v1, vr, v2}} | {ok:false, error:string}}
 * ac: קוד המטוס, שלוש האותיות האחרונות של הרישום (EKI ל-4XEKI). tow: ק"ג כמחרוזת, או null כשאינו בקובץ (מוצג בהודעה בלבד).
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
  return { ok: true, opt: { ac: rwy[1], apt: rwy[2], rwy: rwy[3], tow: tow ? tow[1] : null, flap: flap[1], n1: n1[1], v1: sp[1], vr: sp[2], v2: sp[3] } };
}

export const OPT_KEYS = ['flap', 'n1', 'v1', 'vr', 'v2'];
const LABEL = { flap: 'FLAPS' };

/**
 * מה לעשות עם הנתונים מול התדריך והדפית.
 * @returns {{ask:string[]|null, warn:string[]|null}} ask: שורות "קיים → חדש" כשיש כבר ערכים. warn: שדה אחר
 *   ו/או מטוס אחר, שורה לכל אחד, לשאלה "טען" או "בטל" (requirements.md, 5.1.3, גרסאות 45–46).
 */
export function planOpt(opt, brief, manual) {
  const cur = (k) => String(manual[k] ?? '').trim();
  const has = OPT_KEYS.some(cur);
  const ask = has ? OPT_KEYS.map((k) => `${LABEL[k] ?? k.toUpperCase()} ${cur(k) || '—'} → ${opt[k]}`) : null;
  const warn = [];
  if (opt.apt !== brief.org) warn.push(`קובץ ה-OPT הוא ל-${opt.apt}, והתדריך יוצא מ-${brief.org}.`);
  const reg = String(brief.reg ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!reg) warn.push(`קובץ ה-OPT הוא למטוס ${opt.ac}, ורישום המטוס לא נמצא בתדריך.`);
  else if (!reg.endsWith(opt.ac.toUpperCase())) warn.push(`קובץ ה-OPT הוא למטוס ${opt.ac}, והתדריך למטוס ${brief.reg}.`);
  return { ask, warn: warn.length ? warn : null };
}
