// ניתוח עמוד 1 של התדריך (Flight Release) לשדות דפית הטיסה. requirements.md, סעיפים 4 ו-5.1.
//
// קוד טהור, בלי PDF.js: מקבל את פריטי הטקסט של העמוד (x, y, s) ומחזיר שדות.
// כל שדה שנמצא מחזיר גם את המלבן שלו בעמוד, כדי שאפשר יהיה להראות את המקור.
// אין ניחוש שקט: שדה שלא נמצא מוחזר כ-missing, ופורמט לא מוכר נדחה עם הודעה.

const HEADER = /ELY\s*(\d+)\s*\/\s*(\d{2})([A-Za-z]{3})(\d{2})\s*\/\s*([A-Z]{4})\s*-\s*([A-Z]{4})\s+Reg:\s*(\S+)\s+OFP:\s*(\S+)/;
const PAGE_ONE = /Page\s+1\s+of\s+(\d+)/;

/**
 * קיבוץ פריטים לשורות לפי y. בכל שורה: הטקסט המחובר (רווח אחד בין פריטים, רווחים כפולים בתוך פריט מכווצים)
 * ומיקום התחלה וסוף של כל פריט בטקסט, לחישוב המלבן של התאמה.
 */
export function toLines(items, tol = 3) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  let cur = null;
  for (const it of sorted) {
    if (cur && Math.abs(it.y - cur.y) < tol) cur.items.push(it);
    else { cur = { y: it.y, items: [it] }; rows.push(cur); }
  }
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let text = '';
    const spans = [];
    for (const it of r.items) {
      if (text) text += ' ';
      const s = it.s.replace(/\s+/g, ' ');
      spans.push({ start: text.length, end: text.length + s.length, it });
      text += s;
    }
    return { text, spans };
  });
}

/** מלבן (x, y עליון, w, h ביחידות PDF) של טווח תווים בשורה. */
function boxOf(line, start, end) {
  const its = line.spans.filter((sp) => sp.start < end && sp.end > start).map((sp) => sp.it);
  if (!its.length) return null;
  const x0 = Math.min(...its.map((i) => i.x));
  const x1 = Math.max(...its.map((i) => i.x + i.w));
  const top = Math.min(...its.map((i) => i.y - (i.h || 8)));
  const bottom = Math.max(...its.map((i) => i.y));
  return { x: x0, y: top, w: x1 - x0, h: bottom - top };
}

/** ההתאמה הראשונה לביטוי בשורות העמוד. */
function find(lines, re) {
  const rx = new RegExp(re.source, re.flags.includes('d') ? re.flags : `${re.flags}d`);
  for (const line of lines) {
    const m = rx.exec(line.text);
    if (m) return { m, box: boxOf(line, m.indices[0][0], m.indices[0][1]) };
  }
  return null;
}

const hhmm = (h, m) => `${h}:${m}`;
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const tonnes = (kg) => (Math.round(kg / 100) / 10).toFixed(1);

/**
 * B.F לתיבה: TOTAL FUEL בטונות, מעוגל כלפי מעלה ל-100 ק"ג. requirements.md, 5.1.
 * @param {string} kg ערך השדה bf, המספר המלא מהתדריך עם מפריד אלפים ("13,049")
 * @returns {string} "13.1"; ערך שאינו מספר ק"ג שלם (נתונים שהועתקו מגרסה ישנה) חוזר כמו שהוא.
 */
export function bfBox(kg) {
  if (!/^\d{1,3}(,\d{3})*$/.test(kg)) return kg;
  return (Math.ceil(Number(kg.replace(/,/g, '')) / 100) / 10).toFixed(1);
}

/**
 * @param {{items: {s:string,x:number,y:number,w:number,h:number}[]}} page1 פריטי הטקסט של עמוד 1
 * @returns {{ok:true, brief:Brief} | {ok:false, error:string}}
 * Brief = {flight, number, day, org, dst, reg, type, date, ofp, pages, fields}
 * fields[key] = {value, raw, box} או {missing:true}
 */
export function parseBrief(page1) {
  const lines = toLines(page1.items);
  const head = find(lines, HEADER);
  const pageOne = find(lines, PAGE_ONE);
  if (!head || !pageOne) {
    return { ok: false, error: 'הקובץ לא זוהה כתדריך טיסה: חסרה שורת הכותרת הקבועה או "Page 1 of".' };
  }
  const [, number, day, mon, yy, org, dst, reg, ofp] = head.m;
  const fields = {};
  const put = (key, re, fmt) => {
    const hit = find(lines, re);
    fields[key] = hit ? { value: fmt(hit.m), raw: hit.m[0], box: hit.box } : { missing: true };
  };

  put('std', new RegExp(`\\b${org} STD (\\d{2})\\.(\\d{2})\\b`), (m) => hhmm(m[1], m[2]));
  put('sta', new RegExp(`\\b${dst} STA (\\d{2})\\.(\\d{2})\\b`), (m) => hhmm(m[1], m[2]));
  put('ete', /\bETE (\d{2})\.(\d{2})\b/, (m) => hhmm(m[1], m[2]));
  put('tf', /\bTRIP FUEL (\d+)\b/, (m) => thousands(m[1]));
  put('tow', /\bETOW (\d+)\b/, (m) => tonnes(Number(m[1])));
  put('bf', /\bTOTAL FUEL (\d+)\b/, (m) => thousands(m[1]));
  put('type', /\bACFT TYPE (\S+)/, (m) => m[1].split('..')[0].replace(/\.+$/, ''));
  put('date', /\bDATE (\d{2})\/(\d{2})\/(\d{2})\b/, (m) => `${m[1]}/${m[2]}/${m[3]}`);

  return {
    ok: true,
    brief: {
      flight: flightLabel({ number, day }),
      number,
      day,
      dateCode: `${day}${mon}${yy}`,
      org,
      dst,
      reg,
      ofp,
      pages: Number(pageOne.m[1]),
      headerBox: head.box,
      fields,
    },
  };
}

/** מספר הטיסה ויום בחודש, בלי LY: "347 / 10" (requirements.md, 5.1.1). מחושב בכל הצגה, גם לתדריך ששמור מגרסה קודמת. */
export const flightLabel = (b) => `${b.number} / ${b.day}`;

/** זיהוי קצר לכרטיס התדריך, בלי LY ועם רווחים בתאריך: "347 · 10 Nov 26 · LLBG–LSZH". */
export const briefLabel = (b) => `${b.number} · ${b.dateCode.replace(/^(\d{2})([A-Za-z]{3})(\d{2})$/, '$1 $2 $3')} · ${b.org}–${b.dst}`;

/** אותה טיסה באותו יום (למשל OFP מעודכן): הנתונים הידניים נשמרים (requirements.md, 5.0). */
export const sameFlight = (a, b) => !!a && !!b && a.number === b.number && a.dateCode === b.dateCode && a.org === b.org && a.dst === b.dst;
