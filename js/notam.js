// סיכום NOTAM: פירוק הבולטין של Lido וסינון לפי השדות, חלונות הזמן, הנושאים והמטוס.
// requirements.md, סעיפים 5.3–5.3.2.
//
// קוד טהור, בלי PDF.js: מקבל שורות טקסט (מ-toLines ב-brief.js) ומחזיר NOTAM עם החלטה לכל אחד.
// אין ניחוש שקט: כשאי אפשר לקבוע שה-NOTAM לא חל – הוא מוצג. כל הסתרה נושאת סיבה.
// משמש את מסך ה-NOTAM (notam-view.js) ואת tools/check-notams.mjs.

// ---------- נתוני הצי (5.3.1) ----------

/** מקור: FCOM (מידות, משקלים) ו-OMA (קטגוריות). רק מספרים, בלי טקסט מהמסמכים. */
export const FLEET = [
  { key: '737-800', match: /^737-800/, spanM: 35.79, code: 'C', apchCat: 'D', rffs: 7, mtowKg: 79242 },
  { key: '737-900ER', match: /^737-900/, spanM: 35.79, code: 'C', apchCat: 'D', rffs: 7, mtowKg: 85366 },
  { key: '787-8', match: /^B?787-8$|^B?788$/, spanM: 60.1, code: 'E', apchCat: 'D', rffs: 8, mtowKg: 227930 },
  { key: '787-9', match: /^B?787-9$|^B?789$/, spanM: 60.1, code: 'E', apchCat: 'D', rffs: 9, mtowKg: 252650 },
  { key: '777-200', match: /^B?777-2/, spanM: 60.93, code: 'E', apchCat: 'C', rffs: 9, mtowKg: 285499 },
];

/** חריג OMA 8.1.5.6: ‏737-800 עם enhanced short field performance הם CAT C ב-LFLB בלבד. */
const APCH_CAT_EXCEPTIONS = [{ regs: ['4XEKH', '4XEKJ', '4XEKL'], icao: 'LFLB', apchCat: 'C' }];

/** @returns נתוני הסוג, או null לסוג לא מזוהה (מוצג ככזה, בלי ברירת מחדל). */
export function fleetFor(type) {
  const t = String(type || '').trim().toUpperCase();
  return FLEET.find((f) => f.match.test(t)) || null;
}

const FT_PER_M = 3.28084;
const CODES = 'ABCDEF';

// ---------- זמנים ----------

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "2611100630" → ms UTC. */
export function parseStamp(s) {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  return Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/** "VALID: 2611100630 - 2611101440 EST" (החלק שאחרי VALID:) → {from, to, open, raw}. to=null כשאין סוף. */
export function parseValid(raw) {
  const r = raw.replace(/\s+/g, ' ').trim();
  const m = /^(\d{10}) ?- ?(\d{10}|PERM|UFN)( EST)?\b/.exec(r);
  if (!m) return { from: null, to: null, raw: r, unknown: true };
  const from = parseStamp(m[1]);
  if (m[2] === 'PERM' || m[2] === 'UFN') return { from, to: null, raw: r, open: m[2] };
  // סיום מוערך: ייתכן שיוארך, ולכן כאילו אין סוף (5.3).
  if (m[3]) return { from, to: null, raw: r, open: 'EST', estTo: parseStamp(m[2]) };
  return { from, to: parseStamp(m[2]), raw: r };
}

const overlaps = (a, b) => (a.from ?? -Infinity) <= b.to && (a.to ?? Infinity) >= b.from;

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const SCHEDULE = /^(?:(DAILY|H24)\s+)?(?:((?:MON|TUE|WED|THU|FRI|SAT|SUN)(?:-(?:MON|TUE|WED|THU|FRI|SAT|SUN))?)\s+)?((?:\d{4}-\d{4}\s*)+)(?:EXC\s+((?:SAT|SUN)(?:[\s-](?:SAT|SUN))?))?$/;

/**
 * לוח זמנים בשורה הראשונה של ה-NOTAM (DAILY 1600-0800, MON-FRI 0500-1600). requirements.md 5.3.
 * @returns {null | {days:Set<number>, ranges:[number,number][]}} null כשהשורה אינה לוח זמנים בפורמט מוכר.
 */
export function parseSchedule(line) {
  const s = String(line || '').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  const m = SCHEDULE.exec(s);
  if (!m || (!m[1] && !m[2] && !/^\d{4}-\d{4}/.test(s))) return null;
  let days = new Set([0, 1, 2, 3, 4, 5, 6]);
  if (m[2]) {
    const [a, b] = m[2].split('-').map((d) => DOW.indexOf(d));
    days = new Set();
    if (b === undefined) days.add(a);
    else for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; }
  }
  if (m[4]) for (const d of m[4].split(/[\s-]/)) days.delete(DOW.indexOf(d));
  const ranges = [...m[3].matchAll(/(\d{2})(\d{2})-(\d{2})(\d{2})/g)].map((r) => [(+r[1]) * 60 + +r[2], (+r[3]) * 60 + +r[4]]);
  if (!ranges.length) return null;
  return { days, ranges };
}

/** האם לוח הזמנים פעיל בחלון כלשהו. */
function scheduleHits(sched, window) {
  const first = Math.floor(window.from / DAY) - 1;
  const last = Math.floor(window.to / DAY);
  for (let d = first; d <= last; d++) {
    if (!sched.days.has(new Date(d * DAY).getUTCDay())) continue;
    for (const [a, b] of sched.ranges) {
      const from = d * DAY + a * MIN;
      const to = d * DAY + (b <= a ? b + 24 * 60 : b) * MIN;
      if (from <= window.to && to >= window.from) return true;
    }
  }
  return false;
}

// ---------- הקשר הטיסה מעמוד 1 ----------

const hm = (h, m) => (+h) * HOUR + (+m) * MIN;

/**
 * השדות הרלוונטיים, התפקידים וחלון הזמן של כל אחד. requirements.md 5.3.
 * @param {string[]} page1 שורות עמוד 1
 * @param {string[]} ofp שורות כל עמודי ה-OFP (לטבלת ה-EDTO), יכול להיות ריק
 * @param {{org:string, dst:string, reg:string, type:string}} brief
 */
export function flightContext(page1, ofp, brief) {
  const text = page1.join('\n');
  const warnings = [];
  const date = /\bDATE (\d{2})\/(\d{2})\/(\d{2})\b/.exec(text);
  const std = new RegExp(`\\b${brief.org} STD (\\d{2})\\.(\\d{2})\\b`).exec(text);
  const eta = /\bETA (\d{2})\.(\d{2})\b/.exec(text);
  if (!date || !std) {
    return { ok: false, error: 'חסרים בעמוד 1 התאריך או ה-STD, ולכן אי אפשר לחשב חלונות זמן.' };
  }
  const day0 = Date.UTC(2000 + +date[3], +date[2] - 1, +date[1]);
  const stdT = day0 + hm(std[1], std[2]);
  let etaT = null;
  if (eta) { etaT = day0 + hm(eta[1], eta[2]); if (etaT < stdT) etaT += DAY; } else warnings.push('ETA לא נמצא בעמוד 1');
  const around = (t, before, after) => (t == null ? null : { from: t - before * HOUR, to: t + after * HOUR });

  const airports = new Map();
  const add = (icao, role, window, note, extra) => {
    if (!airports.has(icao)) airports.set(icao, { icao, roles: [] });
    airports.get(icao).roles.push({ role, window, note, ...extra });
  };
  add(brief.org, 'DEP', around(stdT, 1, 3));
  add(brief.dst, 'DEST', around(etaT, 1, 3));

  // IFR FLIGHT ... ORG-DST <T/O ALTN> <ALTN> <ALTN>: המשבצת הראשונה T/O ALTN (לא אומת, 4.2).
  const ifr = new RegExp(`\\bIFR FLIGHT \\S+ ${brief.org}-${brief.dst} (\\S+) (\\S+) (\\S+)`).exec(text);
  if (!ifr) warnings.push('שורת IFR FLIGHT לא נמצאה: האלטרנטיבות לא ידועות');
  const slot = (s) => (/^[A-Z]{4}$/.test(s) ? s : null);
  if (ifr && slot(ifr[1])) add(ifr[1], 'TO_ALTN', around(stdT, 1, 4));
  for (const alt of ifr ? [ifr[2], ifr[3]].map(slot).filter(Boolean) : []) {
    const line = new RegExp(`\\bALTN/${alt} \\d+ (\\d{2})\\.(\\d{2})\\b`).exec(text);
    if (line && etaT != null) add(alt, 'ALTN', around(etaT + hm(line[1], line[2]), 1, 3));
    else { add(alt, 'ALTN', null, 'זמן האלטרנטיבה לא נמצא'); warnings.push(`זמן האלטרנטיבה ${alt} לא נמצא`); }
  }

  // ‏ERA רק עם CONT n% ERA. ב-MIN CONT / MAX CONT אין.
  // האחוז (3% או 5%) מוצג בתגית (5.3).
  const era = /\bCONT (\d+)% ERA \d+ \d{2}\.\d{2} ([A-Z]{4})\b/.exec(text);
  if (era) add(era[2], 'ERA', around(etaT, 1, 3), undefined, { pct: +era[1] });

  // ‏EDTO ALTN: תקופת ההתאמה מה-OFP, שעה לפני עד 3 שעות אחרי.
  const edto = /\bEDTO ALTN ((?:[A-Z]{4} ?)+)/.exec(text);
  if (edto) {
    const ofpText = ofp.join('\n');
    for (const icao of edto[1].trim().split(' ')) {
      const p = new RegExp(`\\b${icao} \\((\\d{2})\\.(\\d{2})-(\\d{2})\\.(\\d{2})\\)`).exec(ofpText);
      if (!p) { add(icao, 'EDTO', null, 'תקופת ההתאמה לא נמצאה'); warnings.push(`תקופת ההתאמה של ${icao} לא נמצאה`); continue; }
      let from = day0 + hm(p[1], p[2]);
      if (from < stdT - 3 * HOUR) from += DAY;
      let to = day0 + hm(p[3], p[4]);
      while (to < from) to += DAY;
      add(icao, 'EDTO', { from: from - HOUR, to: to + 3 * HOUR });
    }
  }

  const mtow = /\bMTOW (\d{4,7})\b/.exec(text);
  const fleet = fleetFor(brief.type);
  if (!fleet) warnings.push(`סוג המטוס "${brief.type}" לא מזוהה: כללי המטוס לא הופעלו`);
  return {
    ok: true,
    org: brief.org,
    reg: brief.reg,
    type: brief.type,
    fleet,
    mtowKg: mtow ? +mtow[1] : fleet?.mtowKg ?? null,
    mtowSource: mtow ? 'brief' : fleet ? 'table' : null,
    std: stdT,
    eta: etaT,
    airports,
    warnings,
  };
}

// ---------- פירוק הבולטין ----------

const FIR_LINE = /^([A-Z]{4}) ([A-Z][A-Z .()/-]*\b(?:FIR|UIR|ARTCC|CTA|OCA)(?: LOWER| UPPER)?)$/;

/**
 * פירוק בולטין ה-NOTAM. requirements.md 5.3.
 * @param {string[]} lines שורות כל עמודי התדריך, לפי הסדר
 * @returns {{ok:true, notams:Notam[], sections:string[]} | {ok:false, error:string}}
 * Notam = {section, place, kind:'airport'|'fir', cat, id, valid, lines}
 */
export function parseBulletin(lines) {
  const start = lines.findIndex((l) => /LIDO-NOTAM-BULLETIN INCLUDES/.test(l));
  const end = lines.findIndex((l, i) => i > start && /END OF LIDO-NOTAM-BULLETIN/.test(l));
  if (start < 0 || end < 0) return { ok: false, error: 'בולטין ה-NOTAM לא נמצא בתדריך (חסרה שורת הפתיחה או הסיום).' };
  const body = lines.slice(start, end).filter((l) => !/^ELY \d+\/\S+\/[A-Z]{4}-[A-Z]{4} Reg:/.test(l) && !/^Page \d+ of \d+$/.test(l));
  const notams = [];
  const sections = [];
  let section = null, place = null, kind = null, cat = '', cur = null;
  const push = () => { if (cur) { while (cur.lines.length && !cur.lines.at(-1)) cur.lines.pop(); notams.push(cur); } cur = null; };
  for (let i = 0; i < body.length; i++) {
    const l = body[i].trim();
    if (/^=+$/.test(l) && body[i + 2] && /^=+$/.test(body[i + 2].trim())) {
      push(); section = body[i + 1].trim(); sections.push(section); place = null; kind = null; cat = ''; i += 2; continue;
    }
    if (/^-{5,}$/.test(l)) continue;
    const ap = /^([A-Z]{4}) \/(?:[A-Z]{3})?\b/.exec(l);
    if (ap && body[i + 1] && /^-{5,}$/.test(body[i + 1].trim())) { push(); place = ap[1]; kind = 'airport'; cat = ''; continue; }
    const fir = FIR_LINE.exec(l);
    if (fir && /AREA/.test(section || '')) { push(); place = fir[1]; kind = 'fir'; cat = ''; continue; }
    const c = /^\++ ?(.+?) ?\++$/.exec(l);
    if (c) { push(); cat = c[1].trim(); continue; }
    const id = /^([A-Z0-9]+\/\d{2}) VALID: ?(.*)$/.exec(l);
    if (id) {
      push();
      cur = { section, place, kind: kind || (/AREA/.test(section || '') ? 'fir' : 'airport'), cat, id: id[1], valid: parseValid(id[2]), lines: [] };
      continue;
    }
    if (cur && l) cur.lines.push(l);
  }
  push();
  return { ok: true, notams, sections };
}

// ---------- נושאים (5.3) ----------

const SUBJECTS = {
  stand: /\bSTANDS?\b|\bPRKG\b|\bPARKING\b|\bAPRON\b|\bAPN\b|\bGATES?\b|\bSPOTS?\b/,
  twy: /\bTWYS?\b|\bTWY-LINK\b|\bTAXIWAYS?\b|\bTXL\b|\bTAXI|\bTXY\b|\bTAXY/,
  rwy: /\bRWYS?\b|\bRUNWAYS?\b|\bTORA\b|\bTODA\b|\bASDA\b|\bLDA\b|\bD?THR\b/,
  sid: /\bSIDS?\b|DEPARTURE PROC|\bDEPARTURE\b.*\bTAKEOFF\b|TAKE-?OFF MINIM|TAKEOFF MINIM|\bODP\b|\bPDG\b/,
  star: /\bSTARS?\b|\bARRIVAL\b|\bTRANSITIONS?\b/,
  apch: /\bIAP\b|\bIAC\b|\bAPCH\b|\bAPPROACH|\bILS\b|\bLOC\b|\bRNP\b|\bRNAV\b|\bGLS\b|\bLPV\b|\bLNAV|\bOCA\b|\bOCH\b|\bOCA\/H|\bOCA ?\(H\)|\bDA\b|\bMDA\b|\bDH\b|\bMINIMA\b|\bMINIMUMS?\b|\bCIRCLING\b|\bMISSED\b|\bVDP\b|\bFAF\b/,
  ad: /\bAD(?: [A-Z]{4})? (?:CLSD|CLOSED|NOT AVBL)\b|\bAERODROME (?:CLSD|CLOSED)\b|\bAD (?:HR|HOURS|OPR|OPS)\b|\bOPR HR|OPERATING HOURS|HOURS OF (?:OPERATION|SERVICE)|\bPPR\b|CLSD TO ALL|NOT (?:TO BE )?PLANNED AS (?:ALTN|ALTERNATE)/,
  light: /\bALSF?\b|\bPAPI\b|\bVASIS?\b|\bLGTS?\b|\bLIGHT|\bRCLL\b|\bRTZL\b|\bREDL\b|\bRENL\b|\bRTIL\b|\bTDZ\b|\bGP\b|\bGS\b|GLIDE ?(?:PATH|SLOPE)|\bDME\b|\bVOR\b|\bNDB\b|\bILS\b|\bLOC\b|\bLLZ\b|\bGBAS\b/,
  rffs: /\bRFFS?\b|\bARFFS\b|FIRE ?FIGHTING|RESCUE AND FIRE|\bFIRE CAT/,
};
const NAVAID = /\b(?:D?VOR|DME|NDB|TACAN|VORTAC|LOCATOR)\b/;
const NAVAID_KEEP = /\bILS\b|\bLOC\b|\bLOCALI[SZ]ER\b|\bLLZ\b|\bGP\b|\bGS\b|GLIDE ?(?:PATH|SLOPE)|\bIAP\b|\bIAC\b|\bAPCH\b|\bAPPROACH|\bPROC(?:EDURES?)?\b|\bSIDS?\b|\bSTARS?\b|\bDEPARTURE\b|\bARRIVAL\b|\bTRANSITION\b|\bOCA\b|\bOCH\b|\bMDA\b|\bMINIMA\b|\bMINIMUMS?\b|\bRWY\b/;

export const SUBJECT_LABEL = { stand: 'חניה', twy: 'הסעה', rwy: 'מסלול', sid: 'SID', star: 'STAR', apch: 'גישה ומינימות', ad: 'סגירה ושעות', light: 'תאורה ועזרי ניווט', rffs: 'RFFS' };

function subjectsOf(n, text) {
  const s = new Set(Object.keys(SUBJECTS).filter((k) => SUBJECTS[k].test(text)));
  if (n.cat === 'RUNWAY') s.add('rwy');
  if (n.cat === 'APPROACH PROCEDURE') s.add('apch');
  if (n.cat === 'SID/STAR' && !s.has('sid') && !s.has('star')) { s.add('sid'); s.add('star'); }
  return s;
}

// ---------- כללי המטוס (5.3.2) ----------

const APCH_BAD = /\bLPV\b|\(AR\)|\bRNP ?AR\b|\bSA CAT ?I{1,2}\b|\bRNP 0?\.[0-2]\d*\b/;
const APCH_GOOD = /\bLNAV\b|\bVNAV\b|\bILS\b|\bLOC\b|\bVOR\b|\bNDB\b|\bCIRCL|\bGLS\b|\bLDA\b|\bPAR\b|\bSRA\b|\bVISUAL\b|\bRNP 0?\.[3-9]|\bRNP 1(?:\.0)?\b/;

/** מוטה ו-Code letter: האם ה-NOTAM מוגדר רק לקבוצת מטוסים שהמטוס לא בה. */
const GROUP_CODE = [
  /\bRESTRICTED TO (?:ICAO )?CODE (?:LETTER )?([A-F])\b/g,
  /\bUP TO (?:ICAO )?CODE (?:LETTER )?([A-F])\b/g,
  /\bCODE (?:LETTER )?([A-F]) (?:AND|OR) (?:BELOW|SMALLER|LOWER|LESS)\b/g,
  /\bMAX(?:IMUM)? (?:ACFT )?CODE (?:LETTER )?([A-F])\b/g,
];
const GROUP_SPAN = /\b(?:MAX(?:IMUM)? ?(?:WING ?)?SPAN|WING ?SPAN (?:OF )?(UP TO|LESS THAN|BELOW|MAX(?:IMUM)?|NOT EXCEEDING))(?: OF)? (\d+(?:\.\d+)?) ?(M|FT)\b/g;

/** ניסוחים שמגבילים את השימוש לקבוצה (5.3.2, כלל 2). לכל אחד: איפה בטקסט, והאם המטוס בתוכה. */
function groupRestriction(text, fleet) {
  const out = [];
  const ci = (c) => CODES.indexOf(c);
  for (const re of GROUP_CODE) for (const m of text.matchAll(re)) out.push({ at: m.index, inGroup: ci(fleet.code) <= ci(m[1]) });
  for (const m of text.matchAll(GROUP_SPAN)) {
    const lim = m[3] === 'FT' ? +m[2] / FT_PER_M : +m[2];
    out.push({ at: m.index, inGroup: /LESS|BELOW/.test(m[1] ?? '') ? fleet.spanM < lim : fleet.spanM <= lim });
  }
  return out;
}

// ---------- סגירות למפה (5.3.3) ----------

const K_STAND = String.raw`(?:(?:ACFT |PRKG )?STANDS?|ACFT PSN|PRKG POS(?:ITIONS?)?)`;
const K_TWY = String.raw`(?:TWYS?|TAXIWAYS?|TXL)`;
const K_RWY = String.raw`RWYS?`;
const K_ANY = `(?:${K_STAND}|${K_TWY}|${K_RWY})`;
const ID = String.raw`(?!(?:OF|TO|AT|IS|BY|ON|IN|NO|NR|OR|AN|BE|AS|FOR|DUE|AND)\b)(?:LINK \d{1,2}|INNER|OUTER|[A-Z]{1,3}\d{1,3}[A-Z]?|[A-Z]{1,2}|\d{1,3}[A-Z]?)`;
const RWY_ID = String.raw`\d{2}[LRC]?(?:/\d{2}[LRC]?)?`;
const IDS = `${ID}(?:(?: ?, ?| AND | ?- ?| TO | THRU )${ID})*`;
const NR = String.raw`(?: NR\.?| NO\.)?`;
const ANCHOR = `(?:(${K_ANY})${NR} )?(${RWY_ID}|${ID})`;
// קבוצות: 1 סוג, 2 מזהים; ‏BTN: ‏3–6; צד: 7–9; ליד (BEHIND/ABEAM): 10–11; מסלול: 12.
const ELEM = new RegExp(String.raw`\b(${K_STAND}|${K_TWY})${NR}( ${IDS})(?: (?:BTN|BETWEEN) ${ANCHOR} AND ${ANCHOR}| (NORTH|SOUTH|EAST|WEST) OF ${ANCHOR}| (?:BEHIND|ABEAM|ADJ(?:ACENT)?(?: TO)?|NEAR|IFO|IN FRONT OF) ${ANCHOR}(?:(?: ?- ?| AND )${ID})*)?(?![A-Z0-9])|\b${K_RWY} (${RWY_ID}(?:(?: ?, ?| AND )${RWY_ID})*)\b`, 'g');
// קטע שמופיע אחרי CLSD: "TWY A NORTH CLSD BTN TWY C AND TWY E".
const SEG_AFTER = new RegExp(String.raw`^ (?:(?:BTN|BETWEEN) ${ANCHOR} AND ${ANCHOR}|(NORTH|SOUTH|EAST|WEST) OF ${ANCHOR})`);
const kindOf = (w) => (!w ? null : new RegExp(`^${K_TWY}$`).test(w) ? 'twy' : new RegExp(`^${K_RWY}$`).test(w) ? 'rwy' : 'stand');

/** רשימת מזהים: "H11, H12 AND H14", "X02-X05" (טווח עם אותה תחילית). */
function idList(s) {
  const out = [];
  const parts = s.trim().split(/ ?, ?| AND /);
  for (const p of parts) {
    const r = /^([A-Z]*)(\d+)(?: ?- ?| TO | THRU )\1?(\d+)$/.exec(p);
    if (r && +r[3] > +r[2] && +r[3] - +r[2] < 30) {
      for (let i = +r[2]; i <= +r[3]; i++) out.push(r[1] + String(i).padStart(r[2].length, '0'));
    } else out.push(...p.split(/ ?- ?| TO | THRU /));
  }
  return out.filter(Boolean);
}

/** המרכיבים (חניה, מסלול הסעה, מסלול) שבטקסט, עם הקטע אם יש. */
function elementsIn(s, kindHint) {
  const out = [];
  if (kindHint) {
    // פריט ברשימה אחרי "CLOSURE OF THE FLW TWY:" – לפעמים בלי המילה TWY.
    s = s.replace(/^-\s*/, '').replace(/^SECTION OF /, '');
    if (!new RegExp(`^${K_ANY}\\b`).test(s)) s = `${kindHint === 'twy' ? 'TWY' : 'STAND'} ${s}`;
  }
  for (const m of s.matchAll(ELEM)) {
    if (m[12]) { for (const r of m[12].split(/ ?, ?| AND /)) out.push({ kind: 'rwy', ref: r }); continue; }
    const kind = kindOf(m[1]);
    let seg = null;
    if (m[4]) seg = { rel: 'btn', a: { kind: kindOf(m[3]), ref: m[4] }, b: { kind: kindOf(m[5]), ref: m[6] } };
    else if (m[7]) seg = { rel: m[7][0], a: { kind: kindOf(m[8]), ref: m[9] } };
    // ליד חניה או צומת (BEHIND ACFT STAND 524-525): קטע שאי אפשר לחתוך – כל מסלול ההסעה, עם הערה.
    else if (m[11]) seg = { rel: 'near', a: { kind: kindOf(m[10]), ref: m[11] } };
    for (const ref of idList(m[2])) out.push(seg && kind === 'twy' ? { kind, ref, seg } : { kind, ref });
  }
  return out;
}

const CLOSED = /\b(?:CLSD|CLOSED)\b/;
const LIST_HEAD = new RegExp(`CLOSURE OF (?:THE )?(?:FLW|FOLLOWING) (${K_STAND}|${K_TWY})`);

/**
 * הסגירות שב-NOTAM, לציור במפה (5.3.3). רק מה שסגור, ומגבלה לקבוצה שהמטוס מחוץ לה (forUs).
 * @returns {{kind:'stand'|'twy'|'rwy', ref:string, seg?:object, forUs?:boolean}[]}
 */
export function closuresOf(n, fleet) {
  const out = [];
  let listKind = null;
  for (const s of n.segments ?? segmentsOf(n.lines)) {
    if (s.omit) continue;
    const t = s.flat.trim();
    if (listKind && /^-/.test(t)) {
      // רק השורה הראשונה של הפריט. שורה שלא מתחילה ב-"-" (‏"IMPACT ON OPS:") – סוף הרשימה.
      const [first, ...more] = s.text.trim().split('\n');
      out.push(...elementsIn(first.trim(), listKind));
      if (more.some((l) => l.trim() && !/^-/.test(l.trim()))) listKind = null;
      continue;
    }
    listKind = null;
    const head = LIST_HEAD.exec(t);
    if (head) {
      listKind = kindOf(head[1]);
      const rest = t.slice(head.index + head[0].length).replace(/^[:\s]+/, '');
      if (rest) out.push(...elementsIn(rest, listKind));
      continue;
    }
    const c = CLOSED.exec(t);
    if (c && !/\bNOT (?:CLSD|CLOSED)\b|\bWILL BE CLSD\b/.test(t)) {
      // סגירה חלקית של מסלול (‏CLSD FOR TKOF, ‏FOR LDG) – לא במפה.
      if (/^ FOR (?:TKOF|TAKE-?OFF|LDG|LANDING|ARR|DEP)/.test(t.slice(c.index + c[0].length))) continue;
      // רק הפסוקית שלפני CLSD: "STANDS 204-206 EXIT ONLY ... DUE TO TWY C1 CLSD" – רק C1.
      let pre = t.slice(0, c.index);
      const cut = [...pre.matchAll(/\b(?:DUE TO|BECAUSE OF|EXC(?:EPT)?|ONLY|WITH)\b/g)].at(-1);
      if (cut) pre = pre.slice(cut.index + cut[0].length);
      const els = elementsIn(pre);
      const after = SEG_AFTER.exec(t.slice(c.index + c[0].length));
      const twys = els.filter((e) => e.kind === 'twy' && !e.seg);
      if (after && twys.length === 1) {
        twys[0].seg = after[2]
          ? { rel: 'btn', a: { kind: kindOf(after[1]), ref: after[2] }, b: { kind: kindOf(after[3]), ref: after[4] } }
          : { rel: after[5][0], a: { kind: kindOf(after[6]), ref: after[7] } };
      }
      out.push(...els);
      continue;
    }
    if (fleet) {
      const outside = groupRestriction(t, fleet).filter((g) => !g.inGroup);
      if (outside.length) for (const e of elementsIn(t.slice(0, Math.min(...outside.map((g) => g.at))))) out.push({ ...e, forUs: true });
    }
  }
  // אותו מרכיב פעמיים – פעם אחת.
  const seen = new Set();
  return out.filter((e) => {
    const k = [e.kind, e.ref, e.seg?.rel, e.seg?.a.ref, e.seg?.b?.ref].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function sizeRule(text, fleet) {
  const conds = [];
  const ci = (c) => CODES.indexOf(c);
  // ‏NOTAM עם כמה סעיפים (רשימה) כולל בדרך כלל גם הוראות לכל המטוסים: מוצג.
  const listy = /(?:^|\s)(?:-|\d\.|[a-z]\))\s/.test(text) || text.length > 300;

  // ניסוח שמגביל את השימוש לקבוצה: המטוס בתוכה – מוסתר; מחוצה לה – מוצג (בשבילו זו סגירה).
  const inGroup = groupRestriction(text, fleet).map((g) => g.inGroup);
  if (inGroup.length) return !listy && inGroup.every(Boolean) ? 'restrict' : null;

  for (const m of text.matchAll(/(?:GREATER|LARGER|BIGGER|HIGHER) THAN (?:ICAO )?CODE (?:LETTER )?([A-F])\b/g)) conds.push(ci(fleet.code) > ci(m[1]));
  for (const m of text.matchAll(/\bCODE (?:LETTER )?([A-F]) (?:AND|OR) (?:HIGHER|ABOVE|UPPER|LARGER|BIGGER)\b/g)) conds.push(ci(fleet.code) >= ci(m[1]));
  for (const m of text.matchAll(/\bCODE (?:LETTER )?([A-F](?:(?:, ?| AND | OR |\/)[A-F])+)\b/g)) conds.push(m[1].includes(fleet.code));
  for (const m of text.matchAll(/WING ?SPAN (?:OF )?(?:GREATE[RD]?|MORE|LARGER|WIDER)(?: THAN)?( OR EQUAL(?: TO)?)? (\d+(?:\.\d+)?) ?(M|FT)\b/g)) {
    const lim = m[3] === 'FT' ? +m[2] / FT_PER_M : +m[2];
    conds.push(m[1] ? fleet.spanM >= lim : fleet.spanM > lim);
  }
  if (!conds.length) return null;
  if (conds.some(Boolean)) return null;
  // ניסוח הגבלה שלא זוהה למעלה – מוצג.
  if (/RESTRICTED TO|\bONLY\b|\bUP TO\b|PERMITTED/.test(text)) return null;
  if (listy) return null;
  return 'size';
}

/** קטגוריות הגישה שה-NOTAM מזכיר. */
function apchCats(text) {
  const s = new Set();
  let all = /\bALL CATS?\b/.test(text);
  for (const m of text.matchAll(/\bCAT(?:EGORY|S)? ?([A-E](?:(?: ?[/,-] ?| AND )(?:[A-E]|DL)\b)*)(?![A-Z0-9])(?! AIRPORT)/g)) {
    const g = m[1];
    const range = /([A-E]) ?- ?([A-E]|DL)/.exec(g);
    if (range) {
      const to = range[2] === 'DL' ? 'D' : range[2];
      for (let c = range[1].charCodeAt(0); c <= to.charCodeAt(0); c++) s.add(String.fromCharCode(c));
    }
    for (const c of g.match(/[A-E]/g)) s.add(c);
  }
  return { cats: s, all };
}

const RFFS_CAT = /\bCAT(?:EGORY)? ?(\d{1,2})\b/g;

/**
 * חלוקת הטקסט לקטעים (משפטים). requirements.md 5.3.2, כלל 1.
 * גבול: אחרי נקודה שאחריה רווח או סוף שורה (לא נקודה עשרונית), ולפני שורה שמתחילה ב-"-", "1." או "a)".
 * חיבור ה-text של כל הקטעים מחזיר בדיוק את הטקסט המקורי (השורות מחוברות ב-\n).
 * @returns {{text:string, flat:string, omit:boolean, marks:[number,number][]}[]}
 */
export function segmentsOf(lines) {
  const text = lines.join('\n');
  const segs = [];
  let start = 0;
  const push = (end) => {
    if (end <= start) return;
    const t = text.slice(start, end);
    segs.push({ text: t, flat: t.replace(/\s+/g, ' ').trim(), omit: false, marks: [] });
    start = end;
  };
  for (const m of text.matchAll(/\.(?=\s)|\n(?=(?:-|\d+\.|[a-z]\))\s)/g)) push(m[0] === '.' ? m.index + 1 : m.index);
  push(text.length);
  return segs;
}

const CANCEL = /\b(?:RESTRICTIONS?|LIMITATIONS?|GRADIENTS?|PROHIBITIONS?|REQUIREMENTS?)\b.*\b(?:CANCELL?ED|CNL|CNLD|LIFTED|WITHDRAWN|REMOVED|RESCINDED|NO LONGER)\b|\b(?:SUP|SUPPLEMENT)\b.*\b(?:CANCELL?ED|CNL|CNLD|WITHDRAWN)\b|\bWORKS? (?:COMPLETED|FINISHED)\b/;
const EMPTY_SEG = /^(?:ALL OTHER\b.*\bUNCHANGED\.?|REF\b.*|AIP\b.*)$/;

/** האם כל הקטעים בעלי התוכן הם ביטול מגבלה (5.3). */
function cancelsOnly(segments) {
  const real = segments.filter((s) => !s.omit && s.flat && !EMPTY_SEG.test(s.flat));
  return real.length > 0 && real.every((s) => CANCEL.test(s.flat));
}

/** הטקסט להצגה: בלי הקטעים המושמטים. */
export const displayText = (n) => n.segments.filter((s) => !s.omit).map((s) => s.text).join('').trim();

/**
 * ההחלטה לכל NOTAM.
 * @returns Notam עם shown, reason (כשמוסתר), subjects, roles, segments (קטעים, עם omit ו-marks להבלטה)
 */
export function filterNotams(notams, ctx) {
  return notams.map((n) => {
    const d = decide(n, ctx);
    // סגירות למפה (5.3.3), רק ל-NOTAM מוצגים.
    if (d.shown) d.closures = closuresOf(d, ctx.fleet);
    return d;
  });
}

const PERM_AGE = 56 * 24 * 3600 * 1000;

function decide(n, ctx) {
  // שורות נשברות באמצע ביטוי (ICAO / CODE C), ולכן ההתאמה על הטקסט המחובר ברווח.
  const text = n.lines.join(' ');
  const out = { ...n, shown: true, reason: null, subjects: [], roles: [], segments: segmentsOf(n.lines) };
  const hide = (reason) => ({ ...out, shown: false, reason });
  if (n.kind === 'fir') return hide('fir');
  const company = n.cat === 'COMPANY NOTAM' || /^CO\d+\/\d{2}$/.test(n.id);
  const ap = ctx.airports.get(n.place);
  if (!ap) return hide(company ? 'company' : 'airport');
  out.roles = ap.roles.map((r) => r.role);
  // ‏NOTAM של החברה בשדה רלוונטי: תמיד, בלי שום סינון (5.3, נקבע על ידי הבעלים).
  if (company) return { ...out, company: true };

  // חלון זמן: תוקף שחופף לחלון של אחד התפקידים. חלון לא ידוע – לא מסננים לפי זמן.
  const windows = ap.roles.map((r) => r.window);
  if (windows.every(Boolean) && n.valid.from != null) {
    const hit = windows.filter((w) => overlaps(n.valid, w));
    if (!hit.length) return hide('time');
    const sched = parseSchedule(n.lines[0]);
    // "זמני": מתחיל או נגמר בתוך החלון, או לפי לוח זמנים – משתנה במהלך הטיסה (5.3, תצוגה).
    out.temporary = !!sched || hit.some((w) => n.valid.from > w.from || (n.valid.to != null && n.valid.to < w.to));
    if (sched) {
      const clipped = hit.map((w) => ({ from: Math.max(w.from, n.valid.from), to: Math.min(w.to, n.valid.to ?? Infinity) }));
      if (!clipped.some((w) => scheduleHits(sched, w))) return hide('schedule');
    }
  }

  // ‏PERM ותיק – כבר בדפיות Jeppesen. חדש (עד שני מחזורי AIRAC) – מוצג עם תגית (5.3).
  if (n.valid.open === 'PERM' && n.valid.from != null) {
    if (ctx.std - n.valid.from > PERM_AGE) return hide('perm');
    out.newPerm = true;
  }

  // נושאים.
  const subj = subjectsOf(n, text);
  out.subjects = [...subj];
  const isDep = out.roles.includes('DEP');
  // ‏NOTAM של SID (בקטגוריית SID/STAR, או שמתחיל ב-SID) מזכיר בדרך כלל גם מסלול – עדיין SID בלבד.
  // ‏RNAV/RNP ב-SID הם מפרט הניווט שלו (RNAV 5), לא גישה. גישה רק לפי מילים חד-משמעיות.
  const apchStrong = /\bIAP\b|\bIAC\b|\bAPCH\b|\bAPPROACH|\bILS\b|\bLOC\b|\bOCA|\bOCH\b|\bMDA\b|\bMINIMA\b|\bCIRCLING\b|\bMISSED\b/.test(text);
  const sidOnly = subj.has('sid') && !subj.has('star') && !apchStrong && (n.cat === 'SID/STAR' || /^SID\b/.test(n.lines[0] || ''));
  if (sidOnly && !isDep) return hide('sid');
  const relevant = [...subj].filter((s) => s !== 'sid' || isDep);
  if (!relevant.length) return hide(subj.has('sid') ? 'sid' : 'subject');

  // עזרי ניווט שאינם ILS (5.3): NOTAM שעוסק רק במצב העזר. ‏NOTAM על ILS או על נוהל – נשאר.
  if (NAVAID.test(text) && !NAVAID_KEEP.test(text) && relevant.every((s) => s === 'light' || s === 'apch')) return hide('navaid');

  const f = ctx.fleet;
  if (!f) return cancelsOnly(out.segments) ? hide('cancel') : out;

  // RFFS: רק כשהקטגוריה בשדה יורדת מתחת לזו של המטוס. NOTAM שכל עניינו RFFS ובלי מספר – מוצג.
  if (subj.has('rffs') && relevant.length === 1) {
    const cats = [...text.matchAll(RFFS_CAT)].map((m) => +m[1]);
    if (cats.length && cats.every((c) => c >= f.rffs)) return hide('rffs');
  }

  // כלל 1: סוג גישה לא מאושר. קטע (משפט) על גישה לא מאושרת מושמט; אם לא נשאר כלום רלוונטי – מוסתר.
  if (APCH_BAD.test(text) && !APCH_GOOD.test(text)) return hide('approach');
  const usNoCat2 = /^737/.test(f.key) && /^K/.test(n.place);
  const unapproved = (s) => (APCH_BAD.test(s) && !APCH_GOOD.test(s)) || (usNoCat2 && /\bCAT ?(?:II|III|IIIA|IIIB)\b/.test(s) && !/\bCAT I\b/.test(s));
  for (const seg of out.segments) if (unapproved(seg.flat)) seg.omit = true;
  if (out.segments.some((s) => s.omit)) {
    const rest = out.segments.filter((s) => !s.omit).map((s) => s.flat).join(' ');
    const restSubj = [...subjectsOf({ cat: '' }, rest)].filter((s) => s !== 'apch' && (s !== 'sid' || isDep));
    if (!APCH_GOOD.test(rest) && !restSubj.length) return hide('approach');
  }

  // ‏NOTAM שמבטל מגבלה (5.3).
  if (cancelsOnly(out.segments)) return hide('cancel');

  // כלל 2: מוטה ו-Code.
  const size = sizeRule(text, f);
  if (size) return hide(size);

  // כלל 3: קטגוריית גישה. הבלטה של הערך של המטוס, עד הפסיק או סוף השורה.
  if (subj.has('apch')) {
    const exc = APCH_CAT_EXCEPTIONS.find((e) => e.icao === n.place && e.regs.includes(ctx.reg));
    const mine = exc ? exc.apchCat : f.apchCat;
    const { cats, all } = apchCats(text);
    if (cats.size && !all && !cats.has(mine)) return hide('apch-cat');
    const own = new RegExp(`\\bCAT(?:EGORY|S)? ?(?:[A-E](?:/| ?, ?| AND | ?- ?))*${mine}(?:(?:/| ?- ?| AND )DL)?\\b[^,\\n]*(?:\\n\\d[^,\\n]*)?`, 'g');
    for (const seg of out.segments) {
      if (seg.omit) continue;
      for (const m of seg.text.matchAll(own)) seg.marks.push([m.index, m.index + m[0].replace(/[\s.]+$/, '').length]);
    }
  }

  // כלל 5: MTOW.
  const kg = [...text.matchAll(/\bMTOW (?:OF )?(\d+(?:[.,]\d+)?) ?(TONS?|T|KG)\b/g)].map((m) => {
    const v = +m[1].replace(',', '.');
    return /^T/.test(m[2]) ? v * 1000 : v;
  });
  if (kg.length && ctx.mtowKg && kg.every((v) => v > ctx.mtowKg)) return hide('mtow');

  return out;
}

// ---------- תצוגה (5.3, אושר כבסיס בהדמיה) ----------

/** סדר הכרטיסים לפי התפקיד הראשון של השדה. */
const ROLE_ORDER = ['DEP', 'DEST', 'ALTN', 'ERA', 'TO_ALTN', 'EDTO'];
/** סדר הקבוצות בתוך כרטיס. */
export const GROUPS = ['company', 'ad', 'rwy', 'apch', 'proc', 'taxi', 'rffs', 'other'];
export const GROUP_LABEL = { company: 'NOTAM של החברה', ad: 'סגירה ושעות', rwy: 'מסלולים', apch: 'גישה, מינימות ותאורה', proc: 'SID ו-STAR', taxi: 'הסעה וחניה', rffs: 'RFFS', other: 'אחר' };

const AD_STRONG = /\bAD(?: [A-Z]{4})? (?:CLSD|CLOSED|NOT AVBL)\b|\bAERODROME (?:CLSD|CLOSED)\b|\bAD (?:HR|HOURS|OPR|OPS)\b|\bOPR HR|OPERATING HOURS|HOURS OF (?:OPERATION|SERVICE)|CLSD TO ALL|NOT (?:TO BE )?PLANNED AS (?:ALTN|ALTERNATE)/;
const APCH_WORDS = /\bIAP\b|\bIAC\b|\bAPCH\b|\bAPPROACH|\bMINIMA\b|\bMINIMUMS?\b|\bOCA|\bOCH\b|\bMDA\b|\bD[AH]\b|\bILS\b|\bLOC\b|\bGP\b|GLIDE|\bPAPI\b|\bALSF?\b|\bCIRCLING\b|\bMISSED\b|\bRNP\b|\bLNAV|\bLGT|\bLIGHT/;

/** הקבוצה של NOTAM מוצג: נושא אחד, הראשון לפי הסדר. */
export function groupOf(n) {
  const text = n.lines.join(' ');
  const first = n.lines[0] || '';
  const s = new Set(n.subjects);
  if (n.company) return 'company';
  // ‏PPR לבד (למשל "FOR LOWER MINIMA PPR FOCA") אינו סגירה: רק ניסוח חד-משמעי.
  if (AD_STRONG.test(text)) return 'ad';
  if ((s.has('sid') || s.has('star')) && (n.cat === 'SID/STAR' || /^(?:SID|STAR)\b/.test(first))) return 'proc';
  // ‏NOTAM שפותח במסלול הסעה או בחניה שייך להסעה, גם כשהוא מזכיר תאורה (AREA MARKED AND LGTD).
  if (/^(?:TWYS?|TAXIWAY|TXL|APN|APRON|(?:ACFT )?STANDS?|AFTER LDG)\b/.test(first)) return 'taxi';
  if (APCH_WORDS.test(text)) return 'apch';
  if ((s.has('twy') || s.has('stand')) && !/^RWYS?\b/.test(first)) return 'taxi';
  if (s.has('rwy')) return 'rwy';
  if (s.has('sid') || s.has('star')) return 'proc';
  if (s.has('ad')) return 'ad';
  if (s.has('rffs')) return 'rffs';
  return 'other';
}

const two = (x) => String(x).padStart(2, '0');
const dd = (t) => { const d = new Date(t); return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`; };
const hhmm = (t) => { const d = new Date(t); return `${two(d.getUTCHours())}${two(d.getUTCMinutes())}`; };
export const hhColon = (t) => { const d = new Date(t); return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };

/** התוקף בקיצור: "10/11 0800–1100", ‏"09/11 0830 – 27/11 2259", ‏"PERM". */
export function validLabel(v) {
  if (v.unknown) return v.raw;
  if (v.open === 'PERM' || v.open === 'UFN') return `${dd(v.from)} ${hhmm(v.from)} – ${v.open}`;
  const to = v.to ?? v.estTo;
  const est = v.open === 'EST' ? ' EST' : '';
  if (dd(v.from) === dd(to)) return `${dd(v.from)} ${hhmm(v.from)}–${hhmm(to)}${est}`;
  return `${dd(v.from)} ${hhmm(v.from)} – ${dd(to)} ${hhmm(to)}${est}`;
}

/**
 * כל הניתוח לתדריך אחד: שורות כל העמודים (מ-toLines) ופרטי עמוד 1 → כרטיס לכל שדה רלוונטי.
 * @returns {{ok:false, error:string} | {ok:true, ctx, total:number, shown:number, cards:Card[]}}
 * Card = {icao, roles:[{role, window}], shown:Notam[], hidden:Notam[]}
 */
export function analyzeBrief(pages, brief) {
  const bul = parseBulletin(pages.flat());
  if (!bul.ok) return bul;
  const start = pages.findIndex((ls) => ls.some((l) => /LIDO-NOTAM-BULLETIN INCLUDES/.test(l)));
  const ctx = flightContext(pages[0], pages.slice(0, start).flat(), brief);
  if (!ctx.ok) return ctx;
  const all = filterNotams(bul.notams, ctx);
  const first = (ap) => Math.min(...ap.roles.map((r) => ROLE_ORDER.indexOf(r.role)));
  const cards = [...ctx.airports.values()].sort((a, b) => first(a) - first(b)).map((ap) => {
    const here = all.filter((n) => n.place === ap.icao);
    return { icao: ap.icao, roles: ap.roles, shown: here.filter((n) => n.shown), hidden: here.filter((n) => !n.shown) };
  });
  return { ok: true, ctx, total: all.length, shown: all.filter((n) => n.shown).length, cards };
}

export const REASON_LABEL = {
  fir: 'NOTAM לפי FIR',
  company: 'NOTAM של החברה בשדה שאינו רלוונטי',
  airport: 'שדה לא רלוונטי',
  time: 'מחוץ לחלון הזמן',
  schedule: 'לוח הזמנים מחוץ לחלון',
  sid: 'SID שלא בשדה המוצא',
  subject: 'נושא לא רלוונטי',
  rffs: 'RFFS לא יורד מתחת לקטגוריית המטוס',
  approach: 'סוג גישה לא מאושר',
  size: 'מוטה / Code של מטוסים אחרים',
  'apch-cat': 'קטגוריית גישה אחרת',
  mtow: 'MTOW מעל המטוס',
  cancel: 'ביטול מגבלה',
  navaid: 'עזר ניווט שאינו ILS',
  perm: 'PERM ותיק (בדפיות Jeppesen)',
  restrict: 'מגבלת מוטה / Code שהמטוס עומד בה',
};

/** התווית של תפקיד בכרטיס: "3% ERA" – האחוז מעמוד 1, משמאל למילה (נקבע על ידי הבעלים). */
export const roleLabel = (r) => (r.pct ? `${r.pct}% ${ROLE_LABEL[r.role]}` : ROLE_LABEL[r.role]);

export const ROLE_LABEL = { DEP: 'מוצא', DEST: 'יעד', TO_ALTN: 'T/O ALTN', ALTN: 'ALTN', ERA: 'ERA', EDTO: 'EDTO ALTN' };
