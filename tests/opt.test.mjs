// בדיקות לניתוח קובץ ה-OPT (requirements.md, 5.1.3), על נתונים סינתטיים בלבד.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpt, planOpt } from '../js/opt.js';

const L = (...t) => t.map((text) => ({ text }));
const GOOD = L(
  '============================================',
  'OPT TAKEOFF CALCULATION RESULTS',
  '-----------------------------------',
  '| XYZ | EDDF 25C DRY |',
  '| WIND:10 KT | OAT:20 C | QNH:1013.0 HPa |',
  '| BLEEDS ON | A/I OFF | IMCLB: NONE |',
  '| TOW: 70100 KG | TO ATM 45 | FLAP 5 |',
  '| N1: 94.2 | TO SPEEDS: 142 / 147 / 153 KT |',
  '| STAB: 5.50| ACCEL HT: 1000 ft AGL|',
);

test('N1 ו-V1/VR/V2 מקובץ OPT', () => {
  assert.deepEqual(parseOpt(GOOD), { ok: true, opt: { ac: 'XYZ', apt: 'EDDF', rwy: '25C', tow: '70100', flap: '5', n1: '94.2', v1: '142', vr: '147', v2: '153' } });
});

test('קובץ שאינו OPT נדחה', () => {
  const r = parseOpt(GOOD.filter((l) => !l.text.startsWith('OPT')));
  assert.equal(r.ok, false);
});

test('חסרות מהירויות: נדחה, בלי ניחוש', () => {
  const r = parseOpt(GOOD.map((l) => (l.text.includes('N1:') ? { text: '| N1: 94.2 |' } : l)));
  assert.equal(r.ok, false);
  assert.match(r.error, /V1\/VR\/V2/);
});

const opt = parseOpt(GOOD).opt;
const empty = { flap: '', n1: '', v1: '', vr: '', v2: '', cg: '24.5' };

const same = { org: 'EDDF', reg: '4XXYZ' };

test('שדות ריקים, אותו שדה ומטוס: נטען בלי שאלה', () => {
  assert.deepEqual(planOpt(opt, same, empty), { ask: null, warn: null });
});

test('כבר יש ערכים: שאלה עם קיים וחדש', () => {
  const r = planOpt(opt, same, { ...empty, n1: '93.0', v1: '140' });
  assert.deepEqual(r.ask, ['FLAPS — → 5', 'N1 93.0 → 94.2', 'V1 140 → 142', 'VR — → 147', 'V2 — → 153']);
  assert.equal(r.warn, null);
});

test('בלי FLAP: נדחה', () => {
  const r = parseOpt(GOOD.map((l) => ({ text: l.text.replace('FLAP 5', '') })));
  assert.equal(r.ok, false);
  assert.match(r.error, /FLAPS/);
});

test('שדה אחר: אזהרה, לא דחייה (גרסה 46)', () => {
  const r = planOpt(opt, { ...same, org: 'LLBG' }, empty);
  assert.equal(r.warn.length, 1);
  assert.match(r.warn[0], /EDDF.*LLBG/);
});

test('מטוס אחר: אזהרה (גרסה 45)', () => {
  const r = planOpt(opt, { ...same, reg: '4XABC' }, { ...empty, n1: '93.0' });
  assert.equal(r.warn.length, 1);
  assert.match(r.warn[0], /למטוס XYZ, והתדריך למטוס ABC\./);
  assert.ok(r.ask);
});

test('שדה ומטוס אחרים: שתי שורות באותה אזהרה', () => {
  const r = planOpt(opt, { org: 'LLBG', reg: '4XABC' }, empty);
  assert.equal(r.warn.length, 2);
  assert.match(r.warn[0], /LLBG/);
  assert.match(r.warn[1], /למטוס ABC\./);
});

test('בלי רישום בתדריך: אזהרה, בלי ניחוש', () => {
  assert.match(planOpt(opt, { ...same, reg: '' }, empty).warn[0], /לא נמצא/);
});
