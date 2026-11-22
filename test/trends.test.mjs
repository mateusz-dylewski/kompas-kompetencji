// Moduł przełożonego, etap 5: trendy bez średnich i prognoz.
// Między spotkaniami: potwierdzone kroki celów narastająco w miesiącach. W 2 lata: zmiana ocen cząstkowych między ocenami okresowymi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, asManager, todayStr } from './helpers.mjs';

let srv, mgr;
before(async () => { srv = await startServer(); mgr = await asManager(srv); });
after(() => srv.stop());
const keysDeep = (o, out = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); keysDeep(v, out); } return out; };
const BANNED = /avg|mean|sredn|średn|predict|forecast|prognoz|wynik|score/i;

test('trend celu: potwierdzone kroki narastająco, liczba od ostatniej rozmowy', async () => {
  const empId = (await mgr.get('/api/dashboard')).body.team[0].id;
  const id = (await mgr.post('/api/goals', { employeeId: empId, s: 'Cel trendu', m: 'm', a: 'a', r: 'r', t: `${+todayStr().slice(0, 4) + 1}-06-30`, steps: ['k1', 'k2', 'k3'] })).body.id;
  await mgr.patch(`/api/goals/${id}`, { step: 0, confirmed: true });
  await mgr.patch(`/api/goals/${id}`, { step: 1, confirmed: true });
  const r = (await mgr.get(`/api/goals/trend?employeeId=${empId}`)).body;
  const g = r.goals.find(x => x.id === id);
  assert.equal(g.total, 3);
  assert.equal(g.series.at(-1).month, todayStr().slice(0, 7));
  assert.equal(g.series.at(-1).confirmed, 2);
  if (r.lastTalk && r.lastTalk < todayStr()) assert.equal(g.sinceLastTalk, 2);
  assert.deepEqual(keysDeep(r).filter(k => BANNED.test(k)), []);
  assert.equal((await mgr.get('/api/goals/trend?employeeId=99999')).status, 404);
});

test('porównanie ocen okresowych: punkty poprzednio i teraz, kierunek; bez średniej i wyniku', async () => {
  const evals = (await mgr.get('/api/evals')).body.evals.filter(e => ['B', 'C'].includes(e.typ) && e.status !== 'draft');
  const cur = evals[0];
  const before1 = (await mgr.get(`/api/evals/compare?employeeId=${cur.employee_id}`)).body;
  assert.equal(before1.available, false, 'jedna ocena – brak porównania');
  // Wcześniejsza ocena okresowa tego samego pracownika (inne punkty cząstkowe)
  const data = { ...cur.data, terminOceny: '2024-06-30', partials: Object.fromEntries(Object.entries(cur.data.partials || {}).map(([k, v], i) => [k, { pts: i % 2 ? 9 : 1 }])) };
  const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
  db.prepare("INSERT INTO evals(employee_id,evaluator_id,typ,period_from,period_to,status,data,created,updated) VALUES(?,?,?,?,?,'discussed',?,?,?)")
    .run(cur.employee_id, cur.evaluator_id, cur.typ, '2022-07-01', '2024-06-30', JSON.stringify(data), '2024-06-30T00:00:00Z', '2024-06-30T00:00:00Z');
  db.close();
  const r = (await mgr.get(`/api/evals/compare?employeeId=${cur.employee_id}`)).body;
  assert.equal(r.available, true);
  assert.equal(r.previousEval.date, '2024-06-30');
  assert.ok(r.competencies.length > 0);
  for (const c of r.competencies) {
    assert.ok([1, 3, 5, 7, 9].includes(c.previous) || typeof c.previous === 'number');
    assert.equal(c.direction, c.current > c.previous ? 'wzrost' : c.current < c.previous ? 'spadek' : 'bez zmian');
  }
  assert.deepEqual(keysDeep(r).filter(k => BANNED.test(k)), [], 'bez średniej, wyniku i prognozy');
  assert.equal((await mgr.get('/api/evals/compare?employeeId=99999')).status, 404);
});
