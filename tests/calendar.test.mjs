// שמות הצוות מאירועי היומן (requirements.md, 3.3). נתונים סינתטיים בלבד: שמות, מספרים וטלפונים מומצאים.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlip, crewFor, calendarOwner, fullName, firstName } from '../js/calendar.js';

const crew = (status, id, rank, name) => `${status} ${id} ${rank.padEnd(3)} ${name.padEnd(20)} [phone:0500000000,ASN     ,   ,000001, ]`;

// קבינה אחרי כל רגל
const PER_LEG = [
  'Updated at: 01.01.27 09:00', 'Pickup (LT): 05.03 06:30', '', '',
  'Cockpit:', crew('OPR', '011111', 'CAP', 'OWNER ME'), crew('OPR', '022222', 'FO', 'LEVI DANA'), crew('OPR', '033333', 'OBS', 'COHEN ARIE BEN'), crew('DHD', '044444', 'FO', 'DEAD HEAD'), '',
  'Slip details (UTC):',
  '1) 0123 EKI TLV-FRA [05.03 06:30 - 05.03 11:05 , 04:35 Hrs]',
  'Cabin:', crew('OPR', '055555', 'PUR', 'MIZRAHI TAL'), crew('OPR', '066666', 'ST', 'GOLAN NOA'), crew('OPR', '077777', 'JU', 'BAR ON YAEL'), crew('DHD', '088888', 'JU', 'PASS ENGER'), crew('OPR', '099999', 'PUR', 'AMIR GIL'), '',
  '2) 0124 EKI FRA-TLV [06.03 11:40 - 06.03 15:50 , 04:10 Hrs]',
  'Cabin:', crew('OPR', '012121', 'PUR', 'SHANI ROTEM'), crew('OPR', '013131', 'ST', 'PERETZ OR'), '',
].join('\r\n');

// קבינה אחת לכל הסבב, לפני Slip details
const PER_SLIP = [
  'Cockpit:', crew('OPR', '011111', 'CAP', 'OWNER ME'), crew('OPR', '021212', 'FO', 'KATZ ROY'), '',
  'Cabin:', crew('OPR', '031313', 'PUR', 'LEV ADI'), crew('OPR', '041414', 'ST', "O'BRIEN MAYA-LI"), '',
  'Slip details (UTC):',
  '1) 5175 EKO TLV-VRN [01.11 13:15 - 01.11 17:31 , 04:16 Hrs]',
  '2) 5176 EKO VRN-TLV [01.11 18:40 - 01.11 22:11 , 03:31 Hrs]',
].join('\r\n');

const brief = (number, day, dateCode) => ({ number, day, dateCode });
const ev = (description) => ({ description, status: 'confirmed' });

test('פענוח אירוע: קוקפיט, רגליים וקבינה לכל רגל', () => {
  const s = parseSlip(PER_LEG);
  assert.equal(s.cockpit.length, 4);
  assert.deepEqual(s.cockpit[1], { status: 'OPR', id: '22222', rank: 'FO', name: 'LEVI DANA' });
  assert.deepEqual(s.legs.map((l) => [l.number, l.day, l.month, l.cabin.length]), [['123', '05', '03', 5], ['124', '06', '03', 2]]);
  assert.equal(s.cabin, null);
});

test('הצוות לרגל של התדריך: בלי בעל היומן ובלי DH, פרסרים בשורה משלהם והשאר בשורה אחת', () => {
  const r = crewFor([ev(PER_SLIP), ev(PER_LEG)], brief('123', '05', '05Mar27'), '11111');
  assert.deepEqual(r, { ok: true, ck: ['Dana Levi', 'Arie Ben Cohen'], cab: ['Tal Mizrahi', 'Gil Amir', 'Noa, On Yael'] });
  const back = crewFor([ev(PER_LEG)], brief('124', '06', '06Mar27'), '11111');
  assert.deepEqual(back.cab, ['Rotem Shani', 'Or']);
});

test('קבינה של כל הסבב, ואותיות גדולות אחרי מקף וגרש', () => {
  const r = crewFor([ev(PER_SLIP)], brief('5176', '01', '01Nov26'), '11111');
  assert.deepEqual(r, { ok: true, ck: ['Roy Katz'], cab: ['Adi Lev', 'Maya-Li'] });
});

test('בעל היומן לא זוהה: כל הקוקפיט מוצג', () => {
  assert.deepEqual(crewFor([ev(PER_SLIP)], brief('5175', '01', '01Nov26'), null).ck, ['Me Owner', 'Roy Katz']);
});

test('טיסה שאינה ביומן, או בתאריך אחר', () => {
  assert.deepEqual(crewFor([ev(PER_LEG)], brief('123', '06', '06Mar27'), null), { ok: false, error: 'טיסה 123 ב-06/03 לא נמצאה ביומן.' });
  assert.equal(crewFor([ev(PER_LEG)], brief('123', '05', '05Apr27'), null).ok, false);
  assert.equal(crewFor([{ description: PER_LEG, status: 'cancelled' }], brief('123', '05', '05Mar27'), null).ok, false);
});

test('בעל היומן: מי שבקוקפיט ברוב הסבבים', () => {
  const slips = [PER_LEG, PER_SLIP, PER_SLIP].map(ev);
  assert.equal(calendarOwner(slips), '11111');
  assert.equal(calendarOwner(slips.slice(0, 2)), null);
});

test('שמות', () => {
  assert.equal(fullName('LEVI DANA'), 'Dana Levi');
  assert.equal(fullName('SOLO'), 'Solo');
  assert.equal(firstName('BAR ON YAEL'), 'On Yael');
  assert.equal(firstName('SOLO'), 'Solo');
});
