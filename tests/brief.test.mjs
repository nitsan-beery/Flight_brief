// בדיקות לניתוח עמוד 1, על נתונים סינתטיים בלבד (CLAUDE.md: אסור תדריך אמיתי בריפו).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBrief, toLines, briefLabel, sameFlight, bfBox } from '../js/brief.js';

/** עמוד סינתטי: כל שורה היא רשימת [x, טקסט]. השורות במרווח 12 יחידות. */
function page(rows) {
  const items = [];
  rows.forEach((row, i) => {
    for (const [x, s] of row) items.push({ s, x, y: 20 + i * 12, w: s.length * 6, h: 8 });
  });
  return { items };
}

const GOOD = [
  [[60, 'ELY 123/05Mar27/LLBG-EDDF Reg:4XABC OFP:2/0/1']],
  [[300, 'RELEASE TIME 08.00']],
  [[10, 'ACFT REG 4XABC'], [300, 'DATE 05/03/27']],
  [[10, 'ACFT TYPE 737-800W.. CFM56-7B26'], [300, 'CTOT:....']],
  [[10, 'IFR FLIGHT ELY123/05 LLBG-EDDF .... EDDK ....'], [300, '12345']],
  [[220, 'LLBG STD 08.00 ETD 08.00']],
  [[290, 'ETE 04.05']],
  [[220, 'EDDF STA 11.30 PTA 11.35']],
  [[10, 'TRIP FUEL     9876 04.05 1500 1600'], [220, 'ETWT 70100 MTWT 79242']],
  [[10, 'ALTN/EDDK     1500 00.30'], [220, 'ETOW 69950 MTOW 79015']],
  [[10, 'TOTAL FUEL 13049']],
  [[330, 'Page 1 of 40']],
];

test('שדות הדפית מעמוד 1', () => {
  const res = parseBrief(page(GOOD));
  assert.equal(res.ok, true);
  const b = res.brief;
  assert.equal(b.flight, '123 / 05');
  assert.equal(b.org, 'LLBG');
  assert.equal(b.dst, 'EDDF');
  assert.equal(b.reg, '4XABC');
  assert.equal(b.ofp, '2/0/1');
  assert.equal(b.pages, 40);
  assert.equal(briefLabel(b), '123 · 05 Mar 27 · LLBG–EDDF');
  const v = (k) => b.fields[k].value;
  assert.equal(v('date'), '05/03/27');
  assert.equal(v('type'), '737-800W');
  assert.equal(v('std'), '08:00');
  assert.equal(v('sta'), '11:30');
  assert.equal(v('ete'), '04:05');
  assert.equal(v('tf'), '9,876');
  assert.equal(v('tow'), '70.0');
  assert.equal(v('bf'), '13,049');
});

test('B.F לתיבה: טונות, מעוגל כלפי מעלה', () => {
  assert.equal(bfBox('13,049'), '13.1');
  assert.equal(bfBox('13,001'), '13.1');
  assert.equal(bfBox('13,000'), '13.0');
  assert.equal(bfBox('9,401'), '9.5');
  assert.equal(bfBox('9.4'), '9.4');
});

test('לכל שדה שנמצא יש מלבן מקור בשורה הנכונה', () => {
  const b = parseBrief(page(GOOD)).brief;
  const box = b.fields.tf.box;
  assert.ok(box);
  assert.equal(box.x, 10);
  assert.ok(box.y < 20 + 8 * 12 && box.y + box.h >= 20 + 8 * 12 - 1);
});

test('שדה חסר מסומן כחסר, בלי ניחוש', () => {
  const rows = GOOD.filter((r) => !r[0][1].startsWith('TOTAL FUEL'));
  const b = parseBrief(page(rows)).brief;
  assert.deepEqual(b.fields.bf, { missing: true });
  assert.equal(b.fields.tf.value, '9,876');
});

test('STD של שדה אחר מהמוצא לא נלקח', () => {
  const rows = GOOD.map((r) => (r[0][1].startsWith('LLBG STD') ? [[220, 'LCLK STD 08.00 ETD 08.00']] : r));
  assert.deepEqual(parseBrief(page(rows)).brief.fields.std, { missing: true });
});

test('קובץ בלי שורת הכותרת או בלי "Page 1 of" נדחה', () => {
  assert.equal(parseBrief(page(GOOD.slice(1))).ok, false);
  assert.equal(parseBrief(page(GOOD.slice(0, -1))).ok, false);
});

test('סוג מטוס: נקודות ומנוע מוסרים', () => {
  const rows = GOOD.map((r) => (r[0][1].startsWith('ACFT TYPE') ? [[10, 'ACFT TYPE B787-8..TRENT 1000-AE3']] : r));
  assert.equal(parseBrief(page(rows)).brief.fields.type.value, 'B787-8');
});

test('פריטים באותו גובה מתחברים לשורה אחת משמאל לימין', () => {
  const lines = toLines([{ s: 'FUEL', x: 50, y: 10, w: 20, h: 8 }, { s: 'TRIP', x: 10, y: 11, w: 20, h: 8 }, { s: 'X', x: 10, y: 30, w: 6, h: 8 }]);
  assert.deepEqual(lines.map((l) => l.text), ['TRIP FUEL', 'X']);
});

test('אותה טיסה: אותו מספר, תאריך ומסלול', () => {
  const a = parseBrief(page(GOOD)).brief;
  const b = { ...a, ofp: '3/0/1' };
  assert.equal(sameFlight(a, b), true);
  assert.equal(sameFlight(a, { ...a, dateCode: '06Mar27' }), false);
  assert.equal(sameFlight(null, a), false);
});
