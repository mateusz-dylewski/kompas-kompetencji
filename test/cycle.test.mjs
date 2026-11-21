// Faza 5: terminy ocen – cykl 24 miesiące i reguła 6 miesięcy między ocenami
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, timingCheck, refDate, lastPeriodic, CYCLE_MONTHS, MIN_GAP_MONTHS } from '../lib/cycle.mjs';

test('stałe cyklu', () => { assert.equal(CYCLE_MONTHS, 24); assert.equal(MIN_GAP_MONTHS, 6); });
test('addMonths: zwykłe daty, koniec miesiąca, rok przestępny', () => {
  assert.equal(addMonths('2026-06-30', 6), '2026-12-30');
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(addMonths('2027-08-31', 6), '2028-02-29');
  assert.equal(addMonths('2026-01-15', 24), '2028-01-15');
});
const ev = (id, typ, status, period_to, data = {}) => ({ id, typ, status, period_to, data, updated: '2026-07-01T10:00:00Z' });
test('refDate: termin sporządzenia > koniec okresu > data złożenia', () => {
  assert.equal(refDate(ev(1, 'B', 'submitted', '2026-06-30', { terminOceny: '2026-07-10' })), '2026-07-10');
  assert.equal(refDate(ev(1, 'B', 'submitted', '2026-06-30')), '2026-06-30');
  assert.equal(refDate({ ...ev(1, 'B', 'submitted', ''), data: '{}' }), '2026-07-01');
});
test('lastPeriodic pomija szkice, pierwszą ocenę i bieżącą ocenę', () => {
  const list = [ev(1, 'pierwsza', 'discussed', '2026-10-01'), ev(2, 'B', 'draft', '2026-11-01'), ev(3, 'C', 'submitted', '2026-03-31'), ev(4, 'B', 'submitted', '2026-06-30')];
  assert.equal(lastPeriodic(list).id, 4);
  assert.equal(lastPeriodic(list, 4).id, 3);
});
test('timingCheck: zbyt wcześnie, dokładnie 6 miesięcy, brak poprzedniej oceny', () => {
  const list = [ev(4, 'B', 'submitted', '2026-06-30')];
  const early = timingCheck(list, '2026-12-29');
  assert.equal(early.ok, false);
  assert.equal(early.earliest, '2026-12-30');
  assert.equal(early.nextDue, '2028-06-30');
  assert.equal(timingCheck(list, '2026-12-30').ok, true);
  assert.equal(timingCheck([], '2026-01-01').ok, true);
});
