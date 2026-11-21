// Baza pytań asystenta: kompletność i zasady (bez oceniania)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'asystent', 'baza-pytan.json'), 'utf8'));
const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'kompetencje.js'), 'utf8').replace(/^\s*window\.KK_MODEL\s*=\s*/, '').replace(/;\s*$/, ''));

test('baza pytań: każda kompetencja ma pytania dla niskiego i wysokiego wyniku', () => {
  assert.equal(bank.kompetencje.length, 14);
  for (const k of bank.kompetencje) {
    assert.ok(k.niski.length >= 2 && k.wysoki.length >= 2, k.match);
  }
  for (const m of model) {
    assert.ok(bank.kompetencje.some(x => m.k.toUpperCase().startsWith(x.match.slice(0, 12))), `brak pytań dla ${m.k}`);
  }
});

test('pytania są otwarte i nie zawierają oceny osoby ani wyroku', () => {
  const zakazane = /jest leniwy|brakuje mu|brakuje jej|nie nadaje się|zwolnić|zwolnienie|awans|podwyżk|ocena negatywna/i;
  const all = [...bank.ogolne, ...bank.kompetencje.flatMap(k => [...k.niski, ...k.wysoki])];
  for (const q of all) {
    assert.ok(q.endsWith('?'), `pytanie bez znaku zapytania: ${q}`);
    assert.ok(!zakazane.test(q), `zakazane sformułowanie: ${q}`);
  }
});

test('zasady asystenta są zapisane i zgodne z instrukcją', () => {
  assert.ok(bank.zasady.length >= 4);
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'asystent-instrukcja.md'), 'utf8');
  assert.ok(doc.includes('Czego asystent nie robi'));
  assert.ok(doc.includes('baza-pytan.json'));
});
