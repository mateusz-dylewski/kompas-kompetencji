// Cele SMART: termin jako prawdziwa data (nie w przeszłości, najwyżej 5 lat), postęp z kroków (deterministyczny),
// plan rozwoju z ostatniej oceny z wnioskami.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, asEmployee, asManager, todayStr } from './helpers.mjs';

let srv, emp;
before(async () => { srv = await startServer(); emp = await asEmployee(srv, 2); });
after(() => srv.stop());

const year = +todayStr().slice(0, 4);
const goal = (t, steps = ['Ukończone szkolenie', 'Pierwszy raport wysłany']) => ({ s: 'Raporty analityczne', m: '2 raporty miesięcznie', a: '2 h szkolenia tygodniowo', r: 'Przejęcie raportowania', t, steps });

test('termin: prawdziwa data, nie w przeszłości, najwyżej 5 lat; wymagany co najmniej jeden krok', async () => {
  for (const [t, re] of [[`${year + 1}-02-30`, /prawdziwą datę/], [`${year + 1}-13-01`, /prawdziwą datę/], ['55.12.2026', /prawdziwą datę/],
    [`${year - 1}-06-01`, /przeszłości/], [`${year + 6}-01-01`, /5 lat/]]) {
    const r = await emp.post('/api/goals', goal(t));
    assert.equal(r.status, 400, t);
    assert.match(r.body.fields.t, re, t);
  }
  const r = await emp.post('/api/goals', goal(`${year + 1}-06-30`, []));
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.steps);
  assert.equal((await emp.post('/api/goals', goal(`${year + 1}-06-30`, Array.from({ length: 9 }, (_, i) => `Krok ${i}`)))).status, 400);
});

test('postęp = wykonane kroki / wszystkie; cel zrealizowany dopiero po wszystkich krokach', async () => {
  const r = await emp.post('/api/goals', goal(`${year + 1}-06-30`, ['A – szkolenie', 'B – raport', 'C – prezentacja', 'D – wdrożenie']));
  assert.equal(r.status, 201, r.text);
  const id = r.body.id;
  assert.equal(r.body.goal.progress, 0);
  let g = (await emp.patch(`/api/goals/${id}`, { step: 0, done: true })).body.goal;
  assert.equal(g.progress, 25);
  assert.equal(g.stepsDone, 1);
  assert.equal(g.done, false);
  for (const i of [1, 2, 3]) g = (await emp.patch(`/api/goals/${id}`, { step: i, done: true })).body.goal;
  assert.equal(g.progress, 100);
  assert.equal(g.done, true);
  g = (await emp.patch(`/api/goals/${id}`, { step: 2, done: false })).body.goal;
  assert.equal(g.done, false);
  assert.equal(g.progress, 75);
  // Dopisany krok obniża postęp – nadal wynika z kroków, nie z deklaracji
  g = (await emp.patch(`/api/goals/${id}`, { addStep: 'E – podsumowanie' })).body.goal;
  assert.equal(g.steps.length, 5);
  assert.equal(g.progress, 60);
  assert.equal((await emp.patch(`/api/goals/${id}`, { done: true })).status, 400, 'cel z krokami nie jest odhaczany ręcznie');
  assert.equal((await emp.patch(`/api/goals/${id}`, { progress: 90 })).status, 400, 'brak ręcznego suwaka');
  assert.equal((await emp.patch(`/api/goals/${id}`, { step: 9, done: true })).status, 400);
  assert.equal((await (await asEmployee(srv, 3)).patch(`/api/goals/${id}`, { step: 0, done: true })).status, 404, 'cudzy cel');
});

test('cel bez kroków (sprzed zmiany): tylko zrealizowany / w toku', async () => {
  const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
  const uid = db.prepare("SELECT id FROM users WHERE email='pracownik2@demo.kk'").get().id;
  const id = Number(db.prepare("INSERT INTO goals(user_id,s,m,a,r,t,done,progress,created) VALUES(?,?,?,?,?,?,0,40,?)").run(uid, 'Stary cel', 'm', 'a', 'r', '2026-12-31', new Date().toISOString()).lastInsertRowid);
  db.close();
  const g = (await emp.get('/api/goals')).body.goals.find(x => x.id === id);
  assert.deepEqual(g.steps, []);
  const d = (await emp.patch(`/api/goals/${id}`, { done: true })).body.goal;
  assert.equal(d.done, true);
  assert.equal(d.progress, 100);
});

test('demo: cele mają kroki; plan rozwoju z ostatniej oceny z wnioskami', async () => {
  const d = (await emp.get('/api/dashboard')).body;
  assert.ok(d.goals.every(g => Array.isArray(g.steps)));
  assert.ok(d.goals.some(g => g.steps.length === 4));
  if (d.latestDev) assert.ok(d.latestDevEval && d.latestDevEval.id);
  else assert.equal(d.latestDevEval, null);
  assert.ok('latestEvalId' in d);
  assert.ok((await asManager(srv)));
});
