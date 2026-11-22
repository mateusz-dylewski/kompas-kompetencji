// Cele SMART (moduł przełożonego, etap 3): wyznacza przełożony, pracownik zgłasza wykonanie kroku, przełożony potwierdza.
// Postęp liczy tylko potwierdzone kroki. Termin: prawdziwa data, nie w przeszłości, najwyżej 5 lat. Plan rozwoju z oceny.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, asEmployee, asManager, todayStr } from './helpers.mjs';

let srv, mgr, emp, empId;
before(async () => {
  srv = await startServer(); mgr = await asManager(srv); emp = await asEmployee(srv, 2);
  empId = (await emp.get('/api/me')).body.user.id;
});
after(() => srv.stop());

const year = +todayStr().slice(0, 4);
const goal = (t, steps = ['Ukończone szkolenie', 'Pierwszy raport wysłany']) => ({ employeeId: empId, s: 'Raporty analityczne', m: '2 raporty miesięcznie', a: '2 h szkolenia tygodniowo', r: 'Przejęcie raportowania', t, steps });

test('cel wyznacza przełożony, tylko w swoim zespole; pracownik nie tworzy celu', async () => {
  assert.equal((await emp.post('/api/goals', goal(`${year + 1}-06-30`))).status, 403);
  assert.equal((await mgr.post('/api/goals', { ...goal(`${year + 1}-06-30`), employeeId: 99999 })).status, 404);
  const r = await mgr.post('/api/goals', goal(`${year + 1}-06-30`));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.goal.user_id, empId);
  assert.equal(r.body.goal.legacy, false);
  assert.ok((await emp.get('/api/goals')).body.goals.some(g => g.id === r.body.id), 'pracownik widzi cel');
  assert.ok((await mgr.get(`/api/goals?employeeId=${empId}`)).body.goals.some(g => g.id === r.body.id));
  const log = (await mgr.get('/api/audit')).body.audit;
  assert.ok(log.some(a => a.action === 'create_goal' && a.target === `goal:${r.body.id}` && a.new_value));
});

test('termin: prawdziwa data, nie w przeszłości, najwyżej 5 lat; wymagany co najmniej jeden krok', async () => {
  for (const [t, re] of [[`${year + 1}-02-30`, /prawdziwą datę/], [`${year + 1}-13-01`, /prawdziwą datę/], ['55.12.2026', /prawdziwą datę/],
    [`${year - 1}-06-01`, /przeszłości/], [`${year + 6}-01-01`, /5 lat/]]) {
    const r = await mgr.post('/api/goals', goal(t));
    assert.equal(r.status, 400, t);
    assert.match(r.body.fields.t, re, t);
  }
  assert.ok((await mgr.post('/api/goals', goal(`${year + 1}-06-30`, []))).body.fields.steps);
  assert.equal((await mgr.post('/api/goals', goal(`${year + 1}-06-30`, Array.from({ length: 9 }, (_, i) => `Krok ${i}`)))).status, 400);
});

test('zgłoszenie nie zmienia postępu, potwierdzenie zmienia; pracownik nie cofa potwierdzonego', async () => {
  const id = (await mgr.post('/api/goals', goal(`${year + 1}-06-30`, ['A – szkolenie', 'B – raport', 'C – prezentacja', 'D – wdrożenie']))).body.id;
  let g = (await emp.patch(`/api/goals/${id}`, { step: 0, reported: true })).body.goal;
  assert.equal(g.progress, 0);
  assert.equal(g.stepsReported, 1);
  assert.equal((await mgr.get('/api/dashboard')).body.team.find(t => t.id === empId).goalsToConfirm >= 1, true);
  assert.equal((await emp.patch(`/api/goals/${id}`, { step: 0, confirmed: true })).status, 403, 'pracownik nie potwierdza');
  assert.equal((await mgr.patch(`/api/goals/${id}`, { step: 0, reported: true })).status, 403, 'przełożony nie zgłasza za pracownika');
  g = (await mgr.patch(`/api/goals/${id}`, { step: 0, confirmed: true })).body.goal;
  assert.equal(g.progress, 25);
  assert.equal(g.stepsConfirmed, 1);
  assert.equal(g.steps[0].confirmed_by, (await mgr.get('/api/me')).body.user.id);
  assert.equal((await emp.patch(`/api/goals/${id}`, { step: 0, reported: false })).status, 409, 'potwierdzonego nie cofa pracownik');
  // Przełożony może potwierdzić także bez zgłoszenia; cel zrealizowany po wszystkich potwierdzeniach
  for (const i of [1, 2, 3]) g = (await mgr.patch(`/api/goals/${id}`, { step: i, confirmed: true })).body.goal;
  assert.equal(g.progress, 100);
  assert.equal(g.done, true);
  g = (await mgr.patch(`/api/goals/${id}`, { step: 2, confirmed: false })).body.goal;
  assert.equal(g.done, false);
  assert.equal(g.progress, 75);
  g = (await mgr.patch(`/api/goals/${id}`, { addStep: 'E – podsumowanie' })).body.goal;
  assert.equal(g.progress, 60);
  assert.equal((await emp.patch(`/api/goals/${id}`, { addStep: 'F' })).status, 403);
  assert.equal((await emp.patch(`/api/goals/${id}`, { done: true })).status, 400, 'cel z krokami nie jest odhaczany ręcznie');
  assert.equal((await emp.patch(`/api/goals/${id}`, { progress: 90 })).status, 400, 'brak ręcznego suwaka');
  assert.equal((await (await asEmployee(srv, 3)).patch(`/api/goals/${id}`, { step: 1, reported: true })).status, 404, 'cudzy cel');
  // Dziennik: poprzednia i nowa wartość kroków
  const log = (await mgr.get('/api/audit')).body.audit.filter(a => a.target === `goal:${id}`);
  assert.ok(log.some(a => a.action === 'goal_step_confirm' && a.prev_value && a.new_value));
});

test('przełożony zmienia treść i termin celu; pracownik nie', async () => {
  const id = (await mgr.post('/api/goals', goal(`${year + 1}-06-30`))).body.id;
  assert.equal((await emp.patch(`/api/goals/${id}`, { s: 'Inny cel' })).status, 403);
  const g = (await mgr.patch(`/api/goals/${id}`, { s: 'Raporty i prezentacje', t: `${year + 1}-09-30` })).body.goal;
  assert.equal(g.s, 'Raporty i prezentacje');
  assert.equal((await mgr.patch(`/api/goals/${id}`, { t: '2020-01-01' })).status, 400);
});

test('migracja: kroki { t, done } → potwierdzone; cel bez kroków – tylko zrealizowany / w toku', async () => {
  const s1 = await startServer({}, { keep: true });
  await s1.stop();
  const db = new DatabaseSync(path.join(s1.dir, 'kompas.db'));
  const empId = db.prepare("SELECT id FROM users WHERE email='pracownik2@demo.kk'").get().id;
  const legacy = Number(db.prepare("INSERT INTO goals(user_id,s,m,a,r,t,done,progress,steps,created) VALUES(?,?,?,?,?,?,0,50,?,?)")
    .run(empId, 'Stary cel', 'm', 'a', 'r', '2026-12-31', JSON.stringify([{ t: 'zrobione', done: true }, { t: 'otwarte', done: false }]), '2026-01-01T00:00:00Z').lastInsertRowid);
  const noSteps = Number(db.prepare("INSERT INTO goals(user_id,s,m,a,r,t,done,progress,created) VALUES(?,?,?,?,?,?,0,40,?)").run(empId, 'Cel bez kroków', 'm', 'a', 'r', '2026-12-31', '2026-01-01T00:00:00Z').lastInsertRowid);
  db.close();
  // Migracja przy kolejnym starcie na tej samej bazie
  const s2 = await startServer({}, { dir: s1.dir });
  try {
  const emp = await asEmployee(s2, 2);
  const goals = (await emp.get('/api/goals')).body.goals;
  const g = goals.find(x => x.id === legacy);
  assert.equal(g.legacy, true);
  assert.ok(g.steps[0].confirmed_at && !g.steps[1].confirmed_at);
  assert.equal('done' in g.steps[0], false);
  const d = (await emp.patch(`/api/goals/${noSteps}`, { done: true })).body.goal;
  assert.equal(d.done, true);
  assert.equal(d.progress, 100);
  } finally { await s2.stop(); }
});

test('demo: cele mają kroki w nowym formacie; plan rozwoju z ostatniej oceny z wnioskami', async () => {
  const d = (await emp.get('/api/dashboard')).body;
  assert.ok(d.goals.some(g => g.steps.length === 4 && g.steps.every(x => 'confirmed_at' in x)));
  if (d.latestDev) assert.ok(d.latestDevEval && d.latestDevEval.id);
  else assert.equal(d.latestDevEval, null);
  assert.ok('latestEvalId' in d);
});
