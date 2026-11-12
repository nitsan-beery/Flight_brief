// בדיקות לדפית Cold weather (requirements.md, 5.1.2, גרסה 36).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLD, fitSize } from '../js/cold.js';

const measure = (t, size) => t.length * size * 0.5;

test('ארבעה שלבים, משמאל לימין', () => {
  assert.equal(COLD.title, 'Cold weather operations');
  assert.deepEqual(COLD.steps.map(([l]) => l), ['Preflight', 'Before Taxi', 'Line Up', 'After T.O']);
});

test('גודל הטקסט: 20 כשנכנס, וקטן עד שהשורה הארוכה נכנסת', () => {
  assert.equal(fitSize(['abc'], 200, measure), 20);
  assert.equal(fitSize(['abcdefghijklmn'], 120, measure), 17); // 14 תווים: 17*7 = 119
  assert.equal(fitSize(['x'.repeat(100)], 50, measure), 12); // לא קטן מ-12
});
