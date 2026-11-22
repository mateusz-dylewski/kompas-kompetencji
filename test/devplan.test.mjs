// Moduł przełożonego, etap 4: plan rozwoju i komunikat pisze przełożony; pracownik czyta; historia wersji i dziennik.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, asManager, asEmployee } from './helpers.mjs';

let srv, mgr, emp, empId;
before(async () => { srv = await startServer(); mgr = await asManager(srv); emp = await asEmployee(srv, 3); empId = (await emp.get('/api/me')).body.user.id; });
after(() => srv.stop());

test('przełożony zapisuje plan i komunikat; pracownik widzi bieżący plan; historia wersji', async () => {
  assert.equal((await mgr.put('/api/devplan', { employeeId: empId, plan: 'krótko' })).status, 400);
  const r1 = await mgr.put('/api/devplan', { employeeId: empId, plan: 'Szkolenie z analizy danych do końca kwartału.', message: 'Świetna praca przy raporcie.' });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.body.changed, true);
  assert.equal((await mgr.put('/api/devplan', { employeeId: empId, plan: 'Szkolenie z analizy danych do końca kwartału.', message: 'Świetna praca przy raporcie.' })).body.changed, false);
  await mgr.put('/api/devplan', { employeeId: empId, plan: 'Szkolenie z analizy danych i mentoring do końca roku.', message: '' });
  const mine = (await emp.get('/api/devplan')).body;
  assert.match(mine.current.plan, /mentoring/);
  assert.equal(mine.current.author, 'przełożony');
  assert.equal(mine.history.length, 1);
  assert.equal((await emp.get('/api/dashboard')).body.devPlan.plan, mine.current.plan);
  const log = (await mgr.get('/api/audit')).body.audit.filter(a => a.action === 'update_devplan' && a.target === `devplan:${empId}`);
  assert.equal(log.length, 2);
  assert.ok(log[0].prev_value && log[0].new_value);
});

test('pracownik nie zapisuje planu; przełożony tylko dla swojego zespołu', async () => {
  assert.equal((await emp.put('/api/devplan', { employeeId: empId, plan: 'Własny plan rozwoju pracownika.' })).status, 403);
  assert.equal((await mgr.put('/api/devplan', { employeeId: 99999, plan: 'Plan dla osoby spoza zespołu.' })).status, 404);
  assert.equal((await mgr.get('/api/devplan?employeeId=99999')).status, 404);
});
