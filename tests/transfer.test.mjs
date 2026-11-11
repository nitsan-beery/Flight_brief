// העברת נתונים בהעתקה והדבקה (requirements.md, 3.2). נתונים סינתטיים בלבד.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeTransfer, decodeTransfer } from '../js/transfer.js';

const brief = {
  flight: '123 / 05', number: '123', day: '05', dateCode: '05Mar27', org: 'LLBG', dst: 'EDDF', reg: '4XABC', ofp: '2/0/1', pages: 40,
  headerBox: { x: 1, y: 2, w: 3, h: 4 },
  fields: {
    std: { value: '09:00', raw: 'LLBG STD 09.00', box: {} }, sta: { value: '13:10' }, ete: { value: '04:10' },
    tf: { value: '6,175' }, tow: { value: '67.9' }, bf: { value: '9.4' }, type: { missing: true }, date: { value: '05/03/27' },
  },
};
const manual = { bf: '9.6', ck: ['ישראל ישראלי', 'שם שני'], cab: [''], cg: '24.5', sob: '162', flap: '5', n1: '94.2', v1: '142', vr: '147', v2: '153' };

test('העתקה והדבקה מחזירות את אותם נתונים, בלי PDF ומיקומי מקור', () => {
  const code = encodeTransfer(brief, manual);
  assert.match(code, /^FLIGHT-BRIEF:1:[A-Za-z0-9+/=]+$/);
  const r = decodeTransfer(`  ${code}\n`);
  assert.equal(r.ok, true);
  assert.deepEqual(r.manual, manual);
  assert.equal(r.brief.flight, '123 / 05');
  assert.equal(r.brief.reg, '4XABC');
  assert.equal(r.brief.pages, 40);
  assert.deepEqual(r.brief.fields.std, { value: '09:00' });
  assert.deepEqual(r.brief.fields.type, { missing: true });
  assert.equal(r.brief.headerBox, undefined);
});

test('טקסט אחר בלוח נדחה עם הודעה', () => {
  const r = decodeTransfer('שלום');
  assert.equal(r.ok, false);
  assert.match(r.error, /אין נתונים/);
  assert.equal(decodeTransfer(undefined).ok, false);
});

test('קוד פגום או חסר נדחה', () => {
  const code = encodeTransfer(brief, manual);
  assert.match(decodeTransfer(code.slice(0, -8)).error, /פגומים/);
  const json = (o) => `FLIGHT-BRIEF:1:${btoa(unescape(encodeURIComponent(JSON.stringify(o))))}`;
  const ok = JSON.parse(decodeURIComponent(escape(atob(code.slice(15)))));
  assert.equal(decodeTransfer(json(ok)).ok, true);
  assert.equal(decodeTransfer(json({ ...ok, b: { ...ok.b, reg: 5 } })).ok, false);
  assert.equal(decodeTransfer(json({ ...ok, b: { ...ok.b, fields: { ...ok.b.fields, ete: {} } } })).ok, false);
  assert.equal(decodeTransfer(json({ ...ok, m: { ...ok.m, ck: [] } })).ok, false);
  assert.equal(decodeTransfer(json({ ...ok, m: { ...ok.m, n1: null } })).ok, false);
});

test('קוד מגרסה שלפני FLAPS: תקין, ו-FLAPS ריק', () => {
  const ok = JSON.parse(decodeURIComponent(escape(atob(encodeTransfer(brief, manual).slice(15)))));
  delete ok.m.flap;
  const r = decodeTransfer(`FLIGHT-BRIEF:1:${btoa(unescape(encodeURIComponent(JSON.stringify(ok))))}`);
  assert.equal(r.ok, true);
  assert.equal(r.manual.flap, '');
});
