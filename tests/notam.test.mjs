// בדיקות לסינון NOTAM, על נתונים סינתטיים בלבד (CLAUDE.md: אסור תדריך אמיתי בריפו).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseValid, parseSchedule, parseBulletin, flightContext, filterNotams, fleetFor, segmentsOf, displayText, closuresOf } from '../js/notam.js';
import { resolve } from '../js/notam-map.js';

const T = (s) => Date.UTC(2000 + +s.slice(0, 2), +s.slice(2, 4) - 1, +s.slice(4, 6), +s.slice(6, 8), +s.slice(8, 10));

const PAGE1 = [
  'ELY 123/05Mar27/LLBG-EDDF Reg:4XABC OFP:2/0/1',
  'ACFT REG 4XABC DATE 05/03/27',
  'ACFT TYPE 737-800W.. CFM56-7B26 CTOT:....',
  'IFR FLIGHT ELY123/05 LLBG-EDDF .... EDDK .... 12345',
  'LLBG STD 08.00 ETD 08.00',
  'ROUTE TLVFRA ETA 12.05',
  'ALTN/EDDK 1500 00.30 0100 0110 ETOW 69950 MTOW 79015',
  'CONT 3% ERA 300 00.07 LGAV ELDW 60000 MLDW 66360',
];
const BRIEF = { org: 'LLBG', dst: 'EDDF', reg: '4XABC', type: '737-800W' };
const ctx737 = () => flightContext(PAGE1, [], BRIEF);

/** בולטין סינתטי: [מקטע, שדה, קטגוריה, מזהה, תוקף, שורות]. */
function bulletin(entries) {
  const lines = ['ELY 123/05Mar27/LLBG-EDDF Reg:4XABC OFP:2/0/1', 'NOTAM', 'LIDO-NOTAM-BULLETIN INCLUDES NOTAM, COMP NOTAM AND AIP-REGULATION'];
  let sec = null, place = null, cat = null;
  for (const [s, p, c, id, valid, text] of entries) {
    if (s !== sec) { lines.push('=====', s, '====='); sec = s; place = null; cat = null; }
    if (p !== place) {
      if (/FIR$/.test(p)) lines.push(p); else lines.push(`${p} /XXX SOMEWHERE - DETAILED INFO`, '----------');
      place = p; cat = null;
    }
    if (c && c !== cat) { lines.push(`+++++ ${c} +++++`); cat = c; }
    lines.push(`${id} VALID: ${valid}`, ...text);
  }
  lines.push('Page 3 of 9', 'END OF LIDO-NOTAM-BULLETIN');
  return lines;
}

const run = (entries, ctx = ctx737()) => filterNotams(parseBulletin(bulletin(entries)).notams, ctx);
const ALWAYS = '2701010000 - UFN';

test('תוקף: תאריכים, PERM, UFN ו-EST', () => {
  assert.deepEqual(parseValid('2703050600 - 2703050900'), { from: T('2703050600'), to: T('2703050900'), raw: '2703050600 - 2703050900' });
  assert.equal(parseValid('2703050600 - PERM').to, null);
  assert.equal(parseValid('2703050600 - UFN').open, 'UFN');
  const est = parseValid('2703050600 - 2703050900 EST');
  assert.equal(est.to, null);
  assert.equal(est.estTo, T('2703050900'));
  assert.equal(parseValid('משהו אחר').unknown, true);
});

test('לוח זמנים בשורה הראשונה', () => {
  assert.deepEqual(parseSchedule('DAILY 1600-0800').ranges, [[960, 480]]);
  assert.deepEqual([...parseSchedule('MON-FRI 0500-1600').days], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseSchedule('FRI-MON 0500-1600').days].sort(), [0, 1, 5, 6]);
  assert.deepEqual([...parseSchedule('0700-1500 EXC SAT SUN').days], [1, 2, 3, 4, 5]);
  assert.equal(parseSchedule('0200-0530 0730-0830').ranges.length, 2);
  assert.equal(parseSchedule('DAILY 0800 - 1600').ranges.length, 1);
  assert.equal(parseSchedule('NOV 03-06 0700-1600, NOV 09-10 0700-1600'), null);
  assert.equal(parseSchedule('RWY 09 CLSD'), null);
});

test('סוגי המטוסים בצי', () => {
  assert.equal(fleetFor('737-800W').key, '737-800');
  assert.equal(fleetFor('737-900W').key, '737-900ER');
  assert.equal(fleetFor('B787-8').key, '787-8');
  assert.equal(fleetFor('B789').key, '787-9');
  assert.equal(fleetFor('B777-258').key, '777-200');
  assert.equal(fleetFor('A320'), null);
});

test('השדות, התפקידים וחלונות הזמן מעמוד 1', () => {
  const c = ctx737();
  assert.equal(c.ok, true);
  assert.equal(c.mtowKg, 79015);
  assert.equal(c.mtowSource, 'brief');
  const w = (icao, role) => c.airports.get(icao).roles.find((r) => r.role === role).window;
  assert.deepEqual(w('LLBG', 'DEP'), { from: T('2703050700'), to: T('2703051100') });
  assert.deepEqual(w('EDDF', 'DEST'), { from: T('2703051105'), to: T('2703051505') });
  assert.deepEqual(w('EDDK', 'ALTN'), { from: T('2703051135'), to: T('2703051535') });
  assert.deepEqual(w('LGAV', 'ERA'), { from: T('2703051105'), to: T('2703051505') });
  assert.equal(c.airports.get('LGAV').roles.find((r) => r.role === 'ERA').pct, 3);
  assert.deepEqual([...c.airports.keys()], ['LLBG', 'EDDF', 'EDDK', 'LGAV']);
});

test('MIN CONT: אין ERA. T/O ALTN במשבצת הראשונה', () => {
  const p = PAGE1.map((l) => l.replace('CONT 3% ERA 300 00.07 LGAV', 'CONT 156 00.05').replace('.... EDDK', 'LLHA EDDK'));
  const c = flightContext(p, [], BRIEF);
  assert.equal(c.airports.has('LGAV'), false);
  assert.deepEqual(c.airports.get('LLHA').roles[0], { role: 'TO_ALTN', window: { from: T('2703050700'), to: T('2703051200') }, note: undefined });
});

test('EDTO: תקופת ההתאמה, שעה לפני ו-3 שעות אחרי, גם אחרי חצות', () => {
  const p = [...PAGE1, 'EDTO ALTN KBOS LPLA'];
  const c = flightContext(p, ['EDTO ALTNS (WX/NOTAM SUITABILITY PERIOD - GMT)', 'KBOS (21.42-00.54)'], BRIEF);
  assert.deepEqual(c.airports.get('KBOS').roles[0].window, { from: T('2703052042'), to: T('2703060354') });
  assert.equal(c.airports.get('LPLA').roles[0].window, null);
  assert.ok(c.warnings.some((w) => w.includes('LPLA')));
});

test('בלי ETA: אזהרה, וחלון לא ידוע ליעד', () => {
  const c = flightContext(PAGE1.filter((l) => !l.includes('ETA')), [], BRIEF);
  assert.equal(c.airports.get('EDDF').roles[0].window, null);
  assert.ok(c.warnings.length);
});

test('פירוק הבולטין: מקטעים, שדות, FIR וקטגוריות; כותרות עמוד מוסרות', () => {
  const lines = bulletin([
    ['DEPARTURE AIRPORT', 'LLBG', 'RUNWAY', '1A1/27', ALWAYS, ['RWY 12 CLSD.']],
    ['AREA ENROUTE DEPARTURE - DESTINATION', 'LCCC NICOSIA FIR', null, '1A2/27', ALWAYS, ['FREQ 123.4 NOT AVBL']],
  ]);
  lines.splice(lines.indexOf('RWY 12 CLSD.') + 1, 0, 'ELY 123/05Mar27/LLBG-EDDF Reg:4XABC OFP:2/0/1');
  const b = parseBulletin(lines);
  assert.equal(b.ok, true);
  assert.equal(b.notams.length, 2);
  assert.deepEqual(b.notams[0].lines, ['RWY 12 CLSD.']);
  assert.equal(b.notams[0].cat, 'RUNWAY');
  assert.equal(b.notams[1].kind, 'fir');
  assert.equal(b.notams[1].place, 'LCCC');
  assert.equal(parseBulletin(['שום דבר']).ok, false);
});

test('שדות לא רלוונטיים ו-FIR מוסתרים; NOTAM של החברה – רק בשדה רלוונטי, ושם בלי סינון', () => {
  const r = run([
    ['ENROUTE AIRPORT(S)', 'LIMC', 'RUNWAY', '1A1/27', ALWAYS, ['RWY 17L CLSD']],
    ['AREA ENROUTE DEPARTURE - DESTINATION', 'LCCC NICOSIA FIR', null, '1A2/27', ALWAYS, ['RWY X']],
    ['DESTINATION AIRPORT', 'EDDF', 'COMPANY NOTAM', 'CO5/26', ALWAYS, ['CO5/26 COMPANY NOTAM', 'RWY 18 NOTE']],
    ['FUEL ENROUTE AIRPORT', 'LGAV', 'RUNWAY', '1A3/27', ALWAYS, ['RWY 03L CLSD']],
    ['ENROUTE AIRPORT(S)', 'LIMC', 'COMPANY NOTAM', 'CO6/26', ALWAYS, ['CO6/26 COMPANY NOTAM', 'AD APPROVED']],
    // בלי סינון: מחוץ לחלון הזמן, PERM ותיק, LPV, נושא לא רלוונטי, Code של מטוס אחר.
    ['DESTINATION AIRPORT', 'EDDF', 'COMPANY NOTAM', 'CO7/26', '2601010000 - 2601020000', ['CO7/26 COMPANY NOTAM', 'GPU NOT AVBL']],
    ['DESTINATION AIRPORT', 'EDDF', 'COMPANY NOTAM', 'CO8/26', '2401010000 - PERM', ['CO8/26 COMPANY NOTAM', 'RNP RWY 07 LPV ONLY FOR ACFT GREATER THAN CODE E']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), ['airport', 'fir', null, null, 'company', null, null]);
  assert.deepEqual(r[3].roles, ['ERA']);
  assert.equal(r[2].company, true);
  assert.equal(r[6].lines.join(' '), 'CO8/26 COMPANY NOTAM RNP RWY 07 LPV ONLY FOR ACFT GREATER THAN CODE E');
  assert.ok(r[6].segments.every((x) => !x.omit));
});

test('חלון זמן ולוח זמנים', () => {
  const r = run([
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A1/27', '2703051600 - 2703051800', ['RWY 07C CLSD']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A2/27', '2703050000 - 2703052359', ['1600-1800', 'RWY 07C CLSD']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A3/27', '2703050000 - 2703052359', ['DAILY 1300-1400', 'RWY 07C CLSD']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A4/27', '2701010000 - 2703051200 EST', ['RWY 07C CLSD']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A5/27', '2703050000 - 2703052359', ['NOV 03-06 1600-1800', 'RWY 07C CLSD']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), ['time', 'schedule', null, null, null]);
});

test('נושאים: SID רק במוצא, נושא אחר מוסתר', () => {
  const r = run([
    ['DEPARTURE AIRPORT', 'LLBG', 'SID/STAR', '1A1/27', ALWAYS, ['ALL SID: MNM CMB GRADIENT 7.0 PERCENT']],
    ['DESTINATION AIRPORT', 'EDDF', 'SID/STAR', '1A2/27', ALWAYS, ['SID RWY 25C CHANGED']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A7/27', ALWAYS, ['SID RWY 16 - RNAV 5:', 'VEBIT 4S PDG CHANGED TO 5.3 PCT TO 2100FT.']],
    ['DESTINATION AIRPORT', 'EDDF', 'SID/STAR', '1A3/27', ALWAYS, ['STAR ROTEN 1A NOT AVBL']],
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A4/27', ALWAYS, ['CONCENTRATION OF BIRDS IN VICINITY OF AD']],
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A5/27', ALWAYS, ['STAND V155 CLSD']],
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A6/27', ALWAYS, ['PAPI RWY 25C U/S']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), [null, 'sid', 'sid', null, 'subject', null, null]);
});

test('קטעים: לפי משפטים, והחיבור מחזיר את הטקסט המקורי', () => {
  const lines = ['IAP X RWY 9, AMDT 2... LPV DA 319 ALL CATS. LNAV MDA 540', 'ALL CATS. NOTE: 1.5NM', '- ITEM ONE', '- ITEM TWO'];
  const s = segmentsOf(lines);
  assert.equal(s.map((x) => x.text).join(''), lines.join('\n'));
  assert.deepEqual(s.map((x) => x.flat), ['IAP X RWY 9, AMDT 2...', 'LPV DA 319 ALL CATS.', 'LNAV MDA 540 ALL CATS.', 'NOTE: 1.5NM', '- ITEM ONE', '- ITEM TWO']);
});

test('כלל 1: גישה לא מאושרת מוסתרת; במעורבת הקטעים שלה מושמטים', () => {
  const r = run([
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A1/27', ALWAYS, ['IAC RNP RWY 25C: LPV OCA/H CHANGED', 'CAT D: 500FT']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A2/27', ALWAYS, ['RNP Z RWY 07 (AR) NOT AVAILABLE']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A3/27', ALWAYS, ['IAP RNP RWY07L LNAV/VNAV INCREASED OCA CAT A: 456FT, CAT', 'D: 485FT.', 'IAP RNP RWY07L LPV INCREASED OCA CAT A: 456FT, CAT', 'D:', '485FT']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A4/27', ALWAYS, ['IAP RNAV (GPS) RWY 9... LPV DA 319/HAT 311 ALL CATS. LNAV MDA 540/HAT 532 ALL CATS.']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), ['approach', 'approach', null, null]);
  assert.equal(displayText(r[2]), 'IAP RNP RWY07L LNAV/VNAV INCREASED OCA CAT A: 456FT, CAT\nD: 485FT.');
  assert.equal(displayText(r[3]), 'IAP RNAV (GPS) RWY 9... LNAV MDA 540/HAT 532 ALL CATS.');
});

test('כלל 1: ‏737 בארה"ב – קטעי CAT II/III מושמטים', () => {
  const p = PAGE1.map((l) => l.replace(/EDDF/g, 'KJFK'));
  const c = flightContext(p, [], { ...BRIEF, dst: 'KJFK' });
  const e = [['DESTINATION AIRPORT', 'KJFK', 'APPROACH PROCEDURE', '1A1/27', ALWAYS, ['ILS RWY 4R CAT I DA 213. ILS RWY 4R CAT II DH 100.']]];
  assert.equal(displayText(run(e, c)[0]), 'ILS RWY 4R CAT I DA 213.');
  const eu = [['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A1/27', ALWAYS, ['ILS RWY 25C CAT I DA 500. ILS RWY 25C CAT II DH 100.']]];
  assert.equal(displayText(run(eu)[0]), 'ILS RWY 25C CAT I DA 500. ILS RWY 25C CAT II DH 100.');
});

test('NOTAM שמבטל מגבלה מוסתר; ביטול נוהל או מגבלה חדשה – מוצגים', () => {
  const r = run([
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A1/27', ALWAYS, ['IAC LOC RWY 28:', 'MISSED APCH: MNM CLIMB GRADIENT 4.5 PCT UP TO 5900FT DUE TO ASP', 'RESTRICTIONS CANCELLED.', 'ALL OTHER MISSED APCH INSTRUCTIONS REMAIN UNCHANGED.', 'REF AIP EDDF AD 2.24.10.3-5.']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A2/27', ALWAYS, ['IAC LOC RWY 28: MISSED APCH GRADIENT RESTRICTION CANCELLED.', 'ILS RWY 28 DA CHANGED TO 520 FT.']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A3/27', ALWAYS, ['ILS OR LOC RWY 07 PROC WITHDRAWN.']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A4/27', ALWAYS, ['INTERSECTION TAKE OFF FROM A2 RWY 16 NO LONGER PERMITTED.']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A5/27', ALWAYS, ['AIP SUP 047/2027 EDDF - RUNWAY', '07C/25C RESURFACING WORKS 2027 - WORKS COMPLETED. SUP CANCELLED', 'WIE.']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A6/27', ALWAYS, ['AIP SUP 012/2027 CANCELLED. RWY 07C CLSD 0100-0400.']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), ['cancel', null, null, null, 'cancel', null]);
});

test('עזרי ניווט שאינם ILS מוסתרים; ILS ונהלים – מוצגים', () => {
  const r = run([
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A1/27', ALWAYS, ["DME 'CGN' CH100Y U/S."]],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A2/27', ALWAYS, ['DVOR/DME STJ 113.200MHZ/CH 79X U/S']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A3/27', ALWAYS, ['ILS-LOC,GP,DME FOR RWY 16L U/S DUE TO CONST']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A4/27', ALWAYS, ['VOR Y RWY 36R PROCEDURE: MAPT D3.5 ALTITUDE 610FT']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A5/27', ALWAYS, ['DUE TO FAILURE OF VOR/DME, CONVENTIONAL INSTRUMENT APPROACH PROCEDURES NOT AVBL']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), ['navaid', 'navaid', null, null, null]);
});

test('כלל 2: מוטה ו-Code', () => {
  const big = [
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A1/27', ALWAYS, ['TWY K CLSD FOR ACFT GREATER THAN ICAO', 'CODE C (SPAN 36M).']],
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A2/27', ALWAYS, ['TWY Q CLSD TO ACFT WINGSPAN MORE THAN 214FT']],
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A3/27', ALWAYS, ['TWY J RESTRICTED TO CODE C ACFT. USE MNM PWR ONLY.']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A4/27', ALWAYS, ['LDG RWY 20 PROHIBITED TO ACFT WITH WINGSPAN GREATED OR EQUAL TO', '36M']],
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A5/27', ALWAYS, ['AD NOT TO BE PLANNED AS ALTN FOR ACFT CODE C, D, E AND F']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A6/27', ALWAYS, ['DUE TO RWY WORKS:', '- ALL ICAO CODE D AND HIGHER ACFT SHALL USE RWY 25C', '- MINIMUM RWY OCCUPANCY TIMES REQUIRED']],
  ];
  assert.deepEqual(run(big).map((n) => n.reason), ['size', 'size', 'restrict', 'size', null, null]);
  const p = PAGE1.map((l) => l.replace('737-800W', 'B789'));
  const c787 = flightContext(p, [], { ...BRIEF, type: 'B789' });
  assert.deepEqual(run(big, c787).map((n) => n.reason), [null, 'size', null, null, null, null]);
});

test('כלל 3: קטגוריית גישה – הבלטה, והסתרה רק כשאין את שלנו', () => {
  const r = run([
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A1/27', ALWAYS, ['ILS Z RWY 17 CAT A-B GP ANGLE 2.72']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A2/27', ALWAYS, ['VOR RWY 25C OCA CHANGED', 'CAT A 900', 'CAT D-DL 1010']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A3/27', ALWAYS, ['ILS RWY 25C DA 382 ALL CATS']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), ['apch-cat', null, null]);
  const marked = (n) => n.segments.flatMap((s) => s.marks.map(([a, b]) => s.text.slice(a, b)));
  assert.deepEqual(marked(r[1]), ['CAT D-DL 1010']);
  const r2 = run([['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A4/27', ALWAYS, ['NEW OCH: CAT A 67, CAT C 87, CAT D 103, CAT DL 108', 'CAT A/B/C/D 1602 (200), CAT D', '102.']]]);
  assert.deepEqual(marked(r2[0]), ['CAT D 103', 'CAT A/B/C/D 1602 (200)', 'CAT D\n102']);
});

test('חריג LFLB: ‏4X-EKH הוא CAT C שם', () => {
  const p = PAGE1.map((l) => l.replace(/EDDF/g, 'LFLB'));
  const c = flightContext(p, [], { ...BRIEF, dst: 'LFLB', reg: '4XEKH' });
  const e = [['DESTINATION AIRPORT', 'LFLB', 'APPROACH PROCEDURE', '1A1/27', ALWAYS, ['VOR RWY 18 CAT C ONLY OCA 3000']]];
  assert.equal(run(e, c)[0].shown, true);
  const c2 = flightContext(p, [], { ...BRIEF, dst: 'LFLB', reg: '4XEKA' });
  assert.equal(run(e, c2)[0].reason, 'apch-cat');
});

test('כלל 5: RFFS ו-MTOW', () => {
  const r = run([
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A1/27', ALWAYS, ['AD CAT 8 FOR FIRE FIGHTING PROVIDED.']],
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A2/27', ALWAYS, ['FIREFIGHTING AND RESCUE CAT CHANGED:', 'CAT 6 2300-0500']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A3/27', ALWAYS, ['RWY 13: ACFT WITH MTOW 45 TONS OR ABOVE MUST TURN ON PAD']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A4/27', ALWAYS, ['RWY 13: ACFT WITH MTOW 300 TONS OR ABOVE MUST TURN ON PAD']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A5/27', ALWAYS, ['RWY 13 180 DEG TURN PROHIBITED EXC ACFT MTOW OF 24 TONS AND LESS']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), ['rffs', null, null, 'mtow', null]);
});

test('סוג מטוס לא מזוהה: אזהרה, ובלי כללי מטוס', () => {
  const c = flightContext(PAGE1, [], { ...BRIEF, type: 'A320' });
  assert.equal(c.fleet, null);
  assert.ok(c.warnings.some((w) => w.includes('A320')));
  const r = run([['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A1/27', ALWAYS, ['IAC RNP RWY 25C: LPV OCA/H CHANGED']]], c);
  assert.equal(r[0].shown, true);
});

test('PERM ותיק מ-56 יום מוסתר; PERM חדש מוצג עם תגית; UFN נשאר', () => {
  // ‏STD ‏05/03/27 0800. ‏56 יום לפני: 08/01/27 0800.
  const r = run([
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A1/27', '2701080759 - PERM', ['RWY 07C TORA 3800M']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A2/27', '2701080801 - PERM', ['RWY 07C TORA 3800M']],
    ['DESTINATION AIRPORT', 'EDDF', 'RUNWAY', '1A3/27', '2601010000 - UFN', ['RWY 07C TORA 3800M']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), ['perm', null, null]);
  assert.deepEqual(r.map((n) => !!n.newPerm), [false, true, false]);
});

test('כלל 2: מגבלה לקבוצה – מוסתרת כשהמטוס בתוכה, מוצגת כשמחוצה לה', () => {
  const e = (id, text) => ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', id, ALWAYS, text];
  const list = [
    e('1A1/27', ['TWY INNER RESTRICTED TO CODE C ACFT. USE MNM PWR ONLY.']),
    e('1A2/27', ['STAND B12 AVBL FOR ACFT UP TO CODE C ONLY']),
    e('1A3/27', ['TWY L7 MAX WINGSPAN 36M']),
    e('1A4/27', ['TWY L8 MAX WINGSPAN 35M']),
    e('1A5/27', ['STAND 7 AVBL FOR ACFT WITH WING SPAN OF UP TO 65M']),
    e('1A6/27', ['APRON WORKS:', '- TWY A1 RESTRICTED TO CODE C ACFT', '- TWY A2 CLSD']),
    e('1A7/27', ['TEMPORARY CRANES UP TO 206 MSL 1.6NM W OF TWY A']),
  ];
  assert.deepEqual(run(list).map((n) => n.reason), ['restrict', 'restrict', 'restrict', null, 'restrict', null, null]);
  const p = PAGE1.map((l) => l.replace('737-800W', 'B789'));
  const c787 = flightContext(p, [], { ...BRIEF, type: 'B789' });
  assert.deepEqual(run(list, c787).map((n) => n.reason), [null, null, null, null, 'restrict', null, null]);
});

test('סגירות למפה: חניות, מסלולי הסעה וקטעים, מסלולים', () => {
  const f737 = fleetFor('737-800W'), f787 = fleetFor('B789');
  const C = (text, f = f737) => closuresOf({ lines: text.split('|') }, f);
  assert.deepEqual(C('ACFT STANDS H11, H12 AND H14 CLSD DUE TO WIP.').map((e) => e.ref), ['H11', 'H12', 'H14']);
  assert.deepEqual(C('STANDS X02-X04 CLSD').map((e) => e.ref), ['X02', 'X03', 'X04']);
  assert.deepEqual(C('TWY INNER EAST OF TWY K CLSD.'), [{ kind: 'twy', ref: 'INNER', seg: { rel: 'E', a: { kind: 'twy', ref: 'K' } } }]);
  assert.deepEqual(C('RWY 07C CLSD'), [{ kind: 'rwy', ref: '07C' }]);
  // רשימה אחרי CLOSURE OF THE FLW, עם SECTION OF ובלי המילה TWY.
  const sup = C('H24 CLOSURE OF THE FLW TWY:|- SECTION OF TWY B BTN DA1 AND BD9 EXCLUDED.|H24 CLOSURE OF THE FLW ACFT PSN:|- X02, X03 AND X04');
  assert.deepEqual(sup[0], { kind: 'twy', ref: 'B', seg: { rel: 'btn', a: { kind: null, ref: 'DA1' }, b: { kind: null, ref: 'BD9' } } });
  assert.deepEqual(sup.slice(1).map((e) => `${e.kind} ${e.ref}`), ['stand X02', 'stand X03', 'stand X04']);
  // לא סגירה: הוראה, תיאור, ומגבלה שהמטוס עומד בה.
  assert.deepEqual(C('AFTER LDG RWY 28 VACATING TO APN NORTH VIA TWY F ONLY WITH ATC CLEARANCE.'), []);
  assert.deepEqual(C('STAND IS MARKED WITH DASHED YELLOW LEAD-IN LINE'), []);
  assert.deepEqual(C('TWY F BTN TWY A AND LINK 3 RESTRICTED TO CODE C ACFT.'), []);
  // אותה מגבלה ב-787: סגור בשבילו.
  assert.deepEqual(C('TWY F BTN TWY A AND LINK 3 RESTRICTED TO CODE C ACFT.', f787), [{ kind: 'twy', ref: 'F', seg: { rel: 'btn', a: { kind: 'twy', ref: 'A' }, b: { kind: null, ref: 'LINK 3' } }, forUs: true }]);
});

test('מפה: קטע לפי צומת, חניה בלי אפס מוביל, ומה שלא נמצא', () => {
  // ‏INNER משני קווים שנפגשים בצומת 5. ‏K חוצה את INNER בצומת 7.
  const map = {
    rwy: [{ r: '10/28', w: 45, p: [0, 300, 1000, 300], j: [] }],
    twy: [
      { r: 'INNER', p: [0, 0, 200, 0, 400, 0], j: [[0, 1], [1, 7], [2, 5]] },
      { r: 'INNER', p: [400, 0, 600, 0], j: [[0, 5], [1, 9]] },
      { r: 'K', p: [200, -100, 200, 0, 200, 100], j: [[0, 11], [1, 7], [2, 12]] },
    ],
    stand: [['X4', 50, 50]],
    apron: [], term: [],
  };
  const r = resolve(map, [
    { kind: 'twy', ref: 'INNER', seg: { rel: 'E', a: { kind: 'twy', ref: 'K' } } },
    { kind: 'stand', ref: 'X04' },
    { kind: 'twy', ref: 'Q9' },
    { kind: 'twy', ref: 'K', seg: { rel: 'N', a: { kind: 'twy', ref: 'ZZ' } } },
    { kind: 'rwy', ref: '28' },
  ]);
  assert.deepEqual(r.lines[0].pts, [[200, 0], [400, 0], [600, 0]]);
  assert.deepEqual(r.dots, [{ x: 50, y: 50, label: 'X04' }]);
  assert.deepEqual(r.missing, ['TWY Q9']);
  assert.deepEqual(r.whole, ['K']);
  assert.equal(r.lines.at(-1).label, 'RWY 10/28');
});
