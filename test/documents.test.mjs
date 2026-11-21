// Testy obliczeń oceny: levelFor i computeResults (rozporządzenie z 4.04.2016, Dz. U. poz. 470)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levelFor, computeResults, periodicVerdict, PTS5 } from '../lib/documents.mjs';

// Minimalny model: 3 kryteria po 2 wskaźniki
const MODEL = [
  { k: 'RZETELNOŚĆ', n: 'Rzetelność', w: [{ w: 'w1' }, { w: 'w2' }] },
  { k: 'KOMUNIKACJA', n: 'Komunikacja', w: [{ w: 'w1' }, { w: 'w2' }] },
  { k: 'WSPÓŁPRACA', n: 'Współpraca', w: [{ w: 'w1' }, { w: 'w2' }] },
];
const KEYS = MODEL.map(c => c.k);
// Ocena okresowa w nowym kształcie: oceny cząstkowe przyznaje oceniający
const periodic = (pts, extra = {}) => ({
  typ: 'C',
  data: { schema: 2, criteria: KEYS.slice(0, pts.length), ratings: {},
    partials: Object.fromEntries(pts.map((p, i) => [KEYS[i], p === null ? undefined : { pts: p }]).filter(([, v]) => v)), ...extra },
});

describe('levelFor – § 11 ust. 1 pkt 2 (przedziały średniej)', () => {
  const cases = [
    [1, 'znacznie poniżej oczekiwań'], [2, 'znacznie poniżej oczekiwań'],
    [2.01, 'poniżej oczekiwań'], [3, 'poniżej oczekiwań'], [4, 'poniżej oczekiwań'],
    [4.01, 'na poziomie oczekiwań'], [5, 'na poziomie oczekiwań'], [6, 'na poziomie oczekiwań'],
    [6.01, 'powyżej oczekiwań'], [7, 'powyżej oczekiwań'], [8, 'powyżej oczekiwań'],
    [8.01, 'znacznie powyżej oczekiwań'], [9, 'znacznie powyżej oczekiwań'],
  ];
  for (const [avg, lvl] of cases) test(`${avg} pkt → ${lvl}`, () => assert.equal(levelFor(avg), lvl));
  test('brak danych → „—”', () => {
    assert.equal(levelFor(null), '—');
    assert.equal(levelFor(undefined), '—');
  });
});

describe('computeResults – ocena okresowa (B/C)', () => {
  test('każdy poziom 1/3/5/7/9 jako jedyna ocena cząstkowa', () => {
    const expected = { 1: 'znacznie poniżej oczekiwań', 3: 'poniżej oczekiwań', 5: 'na poziomie oczekiwań', 7: 'powyżej oczekiwań', 9: 'znacznie powyżej oczekiwań' };
    for (const p of PTS5) {
      const r = computeResults(periodic([p]), MODEL);
      assert.equal(r.crit[0].partial, p);
      assert.equal(r.crit[0].source, 'oceniajacy');
      assert.equal(r.avg, p);
      assert.equal(r.level, expected[p]);
      assert.equal(r.wynik, p <= 3 ? 'negatywna' : 'pozytywna', `wynik dla ${p} pkt`);
      assert.equal(r.wynikSource, 'wyliczony');
    }
  });

  test('średnia arytmetyczna ocen cząstkowych', () => {
    const r = computeResults(periodic([5, 7, 9]), MODEL);
    assert.equal(r.avg, 7);
    assert.equal(r.level, 'powyżej oczekiwań');
    const r2 = computeResults(periodic([5, 5, 7]), MODEL); // 5,666…
    assert.equal(r2.avg, 5.7);
    assert.equal(r2.level, 'na poziomie oczekiwań');
  });

  test('granica 4 pkt: dokładnie 4 → poniżej oczekiwań i ocena negatywna', () => {
    const r = computeResults(periodic([3, 5]), MODEL);
    assert.equal(r.avg, 4);
    assert.equal(r.level, 'poniżej oczekiwań');
    assert.equal(r.wynik, 'negatywna');
    assert.match(r.wynikReasons[0], /§ 11 ust\. 4/);
  });

  test('granica: średnia nieco powyżej 4 (3,5,5 → 4,33) → na poziomie, ocena pozytywna', () => {
    const r = computeResults(periodic([3, 5, 5]), MODEL);
    assert.equal(r.level, 'na poziomie oczekiwań');
    assert.equal(r.wynik, 'pozytywna');
  });

  test('granica 2/6/8 pkt jest włączona do niższego przedziału', () => {
    assert.equal(computeResults(periodic([1, 3]), MODEL).level, 'znacznie poniżej oczekiwań'); // 2
    assert.equal(computeResults(periodic([5, 7]), MODEL).level, 'na poziomie oczekiwań'); // 6
    assert.equal(computeResults(periodic([7, 9]), MODEL).level, 'powyżej oczekiwań'); // 8
  });

  test('§ 11 ust. 4: jedna ocena cząstkowa „znacznie poniżej” → negatywna mimo dobrej średniej', () => {
    const r = computeResults(periodic([1, 9, 9]), MODEL); // średnia 6,33 – powyżej oczekiwań
    assert.equal(r.level, 'powyżej oczekiwań');
    assert.equal(r.wynik, 'negatywna');
    assert.equal(r.wynikReasons.length, 1);
    assert.match(r.wynikReasons[0], /znacznie poniżej/);
  });

  test('wynik jest wyliczany: ręcznie wpisany „pozytywna” nie nadpisuje reguły', () => {
    const r = computeResults(periodic([1, 3, 3], { wynik: 'pozytywna' }), MODEL);
    assert.equal(r.wynik, 'negatywna');
    assert.equal(r.wynikReasons.length, 2);
  });

  test('brak danych → null', () => {
    const r = computeResults({ typ: 'B', data: { schema: 2, criteria: [], ratings: {}, partials: {} } }, MODEL);
    assert.equal(r.avg, null);
    assert.equal(r.level, '—');
    assert.equal(r.wynik, null);
    const r2 = computeResults({ typ: 'B', data: {} }, MODEL);
    assert.equal(r2.avg, null);
    assert.equal(r2.wynik, null);
  });

  test('niepełne oceny cząstkowe → brak wyniku, średnia z przyznanych', () => {
    const r = computeResults(periodic([5, null, 7]), MODEL);
    assert.equal(r.complete, false);
    assert.equal(r.crit[1].partial, null);
    assert.equal(r.avg, 6);
    assert.equal(r.wynik, null);
  });

  test('wartość spoza skali 1/3/5/7/9 jest odrzucana', () => {
    const ev = periodic([5]); ev.data.partials[KEYS[0]].pts = 6;
    assert.equal(computeResults(ev, MODEL).crit[0].partial, null);
  });

  test('wskaźniki „brak podstaw do oceny” nie wchodzą do średniej pomocniczej', () => {
    const ev = periodic([5]);
    ev.data.ratings = { 'RZETELNOŚĆ|0': { lvl: 4 }, 'RZETELNOŚĆ|1': { lvl: 'none' } };
    const c = computeResults(ev, MODEL).crit[0];
    assert.equal(c.indicatorAvg, 9);
    assert.equal(c.rows[1].none, true);
    assert.equal(c.partial, 5); // ocena cząstkowa pozostaje decyzją oceniającego
  });
});

describe('computeResults – dane sprzed migracji i pierwsza ocena', () => {
  test('ocena okresowa sprzed migracji: ocena cząstkowa = średnia wskaźników, zachowany wynik ręczny', () => {
    const ev = { typ: 'B', data: { criteria: ['RZETELNOŚĆ'], ratings: { 'RZETELNOŚĆ|0': { lvl: 2 }, 'RZETELNOŚĆ|1': { lvl: 3 } }, wynik: 'pozytywna' } };
    const r = computeResults(ev, MODEL);
    assert.equal(r.crit[0].partial, 6);
    assert.equal(r.crit[0].source, 'wyliczona');
    assert.equal(r.wynik, 'pozytywna');
    assert.equal(r.wynikSource, 'reczny_sprzed_migracji');
  });

  test('ocena sprzed migracji bez wyniku: wynik wyliczony z reguły', () => {
    const ev = { typ: 'B', data: { criteria: ['RZETELNOŚĆ'], ratings: { 'RZETELNOŚĆ|0': { lvl: 0 }, 'RZETELNOŚĆ|1': { lvl: 0 } } } };
    const r = computeResults(ev, MODEL);
    assert.equal(r.wynik, 'negatywna');
    assert.equal(r.wynikSource, 'wyliczony');
  });

  test('pierwsza ocena: skala 3/5/7 (do weryfikacji), wynik wskazuje oceniający', () => {
    const ev = { typ: 'pierwsza', data: { criteria: ['RZETELNOŚĆ'], ratings: { 'RZETELNOŚĆ|0': { lvl: 1 }, 'RZETELNOŚĆ|1': { lvl: 3 } }, wynik: 'pozytywna' } };
    const r = computeResults(ev, MODEL);
    assert.deepEqual(r.crit[0].rows.map(x => x.pts), [3, 7]);
    assert.equal(r.crit[0].partial, 5);
    assert.equal(r.wynik, 'pozytywna');
    assert.equal(r.wynikSource, 'oceniajacy');
  });
});

describe('periodicVerdict', () => {
  test('pusta lista → brak wyniku', () => assert.deepEqual(periodicVerdict([], null), { wynik: null, reasons: [] }));
  test('5/5/5 → pozytywna bez uzasadnień', () => assert.deepEqual(periodicVerdict([5, 5, 5], 5), { wynik: 'pozytywna', reasons: [] }));
});
