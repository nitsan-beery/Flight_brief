// בדיקות לסינון NOTAM, על נתונים סינתטיים בלבד (CLAUDE.md: אסור תדריך אמיתי בריפו).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseValid, parseSchedule, parseBulletin, flightContext, filterNotams, fleetFor } from '../js/notam.js';

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
const ALWAYS = '2701010000 - PERM';

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

test('שדות לא רלוונטיים, FIR ו-NOTAM של החברה מוסתרים', () => {
  const r = run([
    ['ENROUTE AIRPORT(S)', 'LIMC', 'RUNWAY', '1A1/27', ALWAYS, ['RWY 17L CLSD']],
    ['AREA ENROUTE DEPARTURE - DESTINATION', 'LCCC NICOSIA FIR', null, '1A2/27', ALWAYS, ['RWY X']],
    ['DESTINATION AIRPORT', 'EDDF', 'COMPANY NOTAM', 'CO5/26', ALWAYS, ['CO5/26 COMPANY NOTAM', 'RWY 18 NOTE']],
    ['FUEL ENROUTE AIRPORT', 'LGAV', 'RUNWAY', '1A3/27', ALWAYS, ['RWY 03L CLSD']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), ['airport', 'fir', 'company', null]);
  assert.deepEqual(r[3].roles, ['ERA']);
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
    ['DESTINATION AIRPORT', 'EDDF', 'SID/STAR', '1A3/27', ALWAYS, ['STAR ROTEN 1A NOT AVBL']],
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A4/27', ALWAYS, ['CONCENTRATION OF BIRDS IN VICINITY OF AD']],
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A5/27', ALWAYS, ['STAND V155 CLSD']],
    ['DESTINATION AIRPORT', 'EDDF', 'AIRPORT', '1A6/27', ALWAYS, ['PAPI RWY 25C U/S']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), [null, 'sid', null, 'subject', null, null]);
});

test('כלל 1: גישה לא מאושרת מוסתרת; מעורבת מוצגת עם עמעום', () => {
  const r = run([
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A1/27', ALWAYS, ['IAC RNP RWY 25C: LPV OCA/H CHANGED', 'CAT D: 500FT']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A2/27', ALWAYS, ['RNP Z RWY 07 (AR) NOT AVAILABLE']],
    ['DESTINATION AIRPORT', 'EDDF', 'APPROACH PROCEDURE', '1A3/27', ALWAYS, ['IAP RNP RWY 07 LNAV/VNAV INCREASED OCA CAT D 480FT', 'IAP RNP RWY 07 LPV INCREASED OCA CAT D 480FT']],
  ]);
  assert.deepEqual(r.map((n) => n.reason), ['approach', 'approach', null]);
  assert.deepEqual(r[2].dim, [1]);
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
  assert.deepEqual(run(big).map((n) => n.reason), ['size', 'size', null, 'size', null, null]);
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
  assert.deepEqual(r[1].highlight, [2]);
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
