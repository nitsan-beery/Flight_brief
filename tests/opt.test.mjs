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
  assert.deepEqual(parseOpt(GOOD), { ok: true, opt: { apt: 'EDDF', rwy: '25C', tow: '70100', flap: '5', n1: '94.2', v1: '142', vr: '147', v2: '153' } });
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

test('שדה המראה שונה משדה המוצא: לא נטען', () => {
  const r = planOpt(opt, { org: 'LLBG' }, empty);
  assert.equal(r.ok, false);
  assert.match(r.error, /EDDF.*LLBG/);
});

test('שדות ריקים: נטען בלי שאלה', () => {
  const r = planOpt(opt, { org: 'EDDF' }, empty);
  assert.equal(r.ok, true);
  assert.equal(r.ask, null);
});

test('כבר יש ערכים: שאלה עם קיים וחדש', () => {
  const r = planOpt(opt, { org: 'EDDF' }, { ...empty, n1: '93.0', v1: '140' });
  assert.deepEqual(r.ask, ['FLAPS — → 5', 'N1 93.0 → 94.2', 'V1 140 → 142', 'VR — → 147', 'V2 — → 153']);
});

test('בלי FLAP: נדחה', () => {
  const r = parseOpt(GOOD.map((l) => ({ text: l.text.replace('FLAP 5', '') })));
  assert.equal(r.ok, false);
  assert.match(r.error, /FLAPS/);
});
