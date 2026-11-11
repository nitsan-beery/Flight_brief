// הנתונים הידניים בטעינת תדריך מעודכן (requirements.md, 5.0, גרסה 17). נתונים סינתטיים בלבד.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextManual, keptLines, emptyManual } from '../js/sheet.js';

const brief = (o = {}) => ({ number: '123', day: '05', dateCode: '05Mar27', org: 'LLBG', dst: 'EDDF', reg: '4XABC', ofp: '2/0/1', fields: { bf: { value: '9.0' } }, ...o });
const filled = { bf: '8.5', ck: ['א', 'ב'], cab: ['ג'], cg: '24.5', sob: '162', flap: '15', n1: '94.2', v1: '142', vr: '147', v2: '' };
const prev = { brief: brief(), manual: filled };

test('טיסה אחרת: הכול מתאפס', () => {
  const r = nextManual(prev, brief({ number: '124', fields: { bf: { value: '7.0' } } }));
  assert.equal(r.keep, null);
  assert.deepEqual(r.manual, emptyManual(brief({ fields: { bf: { value: '7.0' } } })));
  assert.deepEqual(nextManual(null, brief()).manual, emptyManual(brief()));
});

test('אותה טיסה, מטוס אחר: הצוות נשמר, Loadsheet ו-OPT מתאפסים, בלי שאלה', () => {
  const r = nextManual(prev, brief({ reg: '4XDEF', ofp: '3/0/1', fields: { bf: { value: '9.6' } } }));
  assert.equal(r.keep, null);
  assert.deepEqual(r.manual, { bf: '9.6', ck: ['א', 'ב'], cab: ['ג'], cg: '', sob: '', flap: '', n1: '', v1: '', vr: '', v2: '' });
});

test('אותה טיסה ואותו מטוס עם ערכים: שואלים', () => {
  const r = nextManual(prev, brief({ ofp: '3/0/1', fields: { bf: { value: '9.6' } } }));
  assert.deepEqual(r.manual, { bf: '9.6', ck: ['א', 'ב'], cab: ['ג'], cg: '', sob: '', flap: '', n1: '', v1: '', vr: '', v2: '' });
  assert.deepEqual(r.keep, { bf: '9.6', ck: ['א', 'ב'], cab: ['ג'], cg: '24.5', sob: '162', flap: '15', n1: '94.2', v1: '142', vr: '147', v2: '' });
  assert.deepEqual(keptLines(r.keep), ['Loadsheet:  CG 24.5 · SOB 162', 'OPT:  FLAPS 15 · N1 94.2 · 142 / 147 / —']);
});

test('אותה טיסה ואותו מטוס בלי ערכים: בלי שאלה', () => {
  const r = nextManual({ brief: brief(), manual: { ...filled, cg: ' ', sob: '', flap: '', n1: '', v1: '', vr: '', v2: '' } }, brief({ ofp: '3/0/1' }));
  assert.equal(r.keep, null);
  assert.deepEqual(r.manual.ck, ['א', 'ב']);
});

test('שורות הערכים: רק מה שמולא', () => {
  assert.deepEqual(keptLines({ cg: '', sob: '150', n1: '', v1: '', vr: '', v2: '' }), ['Loadsheet:  SOB 150']);
});
