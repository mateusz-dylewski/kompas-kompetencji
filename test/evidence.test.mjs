// Faza 2: dowody (tabela evidence), walidacja przed złożeniem oceny, dziennik zmian
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, asManager, asEmployee, todayStr } from './helpers.mjs';

let srv, mgr, emp1;
const IND = 'RZETELNOŚĆ|0';
before(async () => { srv = await startServer(); mgr = await asManager(srv); emp1 = await asEmployee(srv, 1); });
after(() => srv.stop());

const empId = async () => (await emp1.get('/api/me')).body.user.id; // pracownik1 z danych demo
const validEvidence = id => ({ employeeId: id, date: todayStr(), indicator: IND, situation: 'Raport kwartalny', action: 'Sprawdzono dane źródłowe', result: 'Raport bez korekt', taskRef: 'ZAD-1' });

test('przełożony dodaje dowód; wpis w dzienniku z nową wartością', async () => {
  const id = await empId();
  const r = await mgr.post('/api/evidence', validEvidence(id));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.evidence.indicator, IND);
  assert.equal(r.body.evidence.competency, 'RZETELNOŚĆ');
  const log = (await mgr.get('/api/audit')).body;
  const e = log.audit.find(a => a.action === 'create_evidence' && a.target === `evidence:${r.body.evidence.id}`);
  assert.ok(e, 'brak wpisu create_evidence');
  assert.equal(e.prev_value, 'null');
  assert.match(e.new_value, /Raport kwartalny/);
  assert.equal(log.chainOk, true);
});

test('walidacja: brak pól, nieznany wskaźnik, zła data, link, nieznane pole → 400 z listą pól', async () => {
  const id = await empId();
  const r = await mgr.post('/api/evidence', { employeeId: id, date: '2026-13-40', indicator: 'NIEMA|0', situation: '', action: 'x', link: 'javascript:alert(1)', godziny: 8 });
  assert.equal(r.status, 400);
  for (const f of ['date', 'indicator', 'situation', 'action', 'result', 'link', 'godziny']) assert.ok(r.body.fields[f], `brak błędu pola ${f}`);
  const fut = await mgr.post('/api/evidence', { ...validEvidence(id), date: '2999-01-01' });
  assert.equal(fut.status, 400);
});

test('uprawnienia: pracownik nie dodaje dowodu, przełożony tylko dla swojego zespołu', async () => {
  const me = (await emp1.get('/api/me')).body.user;
  assert.equal((await emp1.post('/api/evidence', validEvidence(me.id))).status, 403);
  assert.equal((await mgr.post('/api/evidence', validEvidence(999))).status, 404);
  const self = (await mgr.get('/api/me')).body.user; // przełożony nie jest członkiem własnego zespołu
  assert.equal((await mgr.post('/api/evidence', validEvidence(self.id))).status, 404);
});

test('edycja dowodu zapisuje poprzednią i nową wartość', async () => {
  const id = await empId();
  const ev = (await mgr.post('/api/evidence', validEvidence(id))).body.evidence;
  const r = await mgr.put(`/api/evidence/${ev.id}`, { result: 'Raport przyjęty przez kierownictwo' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.changed, true);
  const e = (await mgr.get('/api/audit')).body.audit.find(a => a.action === 'update_evidence' && a.target === `evidence:${ev.id}`);
  assert.deepEqual(JSON.parse(e.prev_value), { result: 'Raport bez korekt' });
  assert.deepEqual(JSON.parse(e.new_value), { result: 'Raport przyjęty przez kierownictwo' });
  assert.equal((await mgr.put(`/api/evidence/${ev.id}`, { result: 'Raport przyjęty przez kierownictwo' })).body.changed, false);
  assert.equal((await mgr.put(`/api/evidence/${ev.id}`, { employeeId: 999 })).status, 400);
  assert.equal((await emp1.put(`/api/evidence/${ev.id}`, { result: 'xxx' })).status, 403);
});

test('lista z filtrem po wskaźniku i okresie; pracownik widzi tylko swoje dowody', async () => {
  const id = await empId();
  await mgr.post('/api/evidence', { ...validEvidence(id), date: '2026-02-10', indicator: 'KOMUNIKACJA|0' });
  const byInd = (await mgr.get(`/api/evidence?employeeId=${id}&indicator=${encodeURIComponent('KOMUNIKACJA|0')}`)).body.evidence;
  assert.ok(byInd.length >= 1 && byInd.every(e => e.indicator === 'KOMUNIKACJA|0'));
  const byPeriod = (await mgr.get(`/api/evidence?employeeId=${id}&from=2026-02-01&to=2026-02-28`)).body.evidence;
  assert.ok(byPeriod.length >= 1 && byPeriod.every(e => e.date >= '2026-02-01' && e.date <= '2026-02-28'));
  const byComp = (await mgr.get(`/api/evidence?employeeId=${id}&competency=${encodeURIComponent('KOMUNIKACJA')}`)).body.evidence;
  assert.ok(byComp.every(e => e.competency === 'KOMUNIKACJA'));
  assert.equal((await mgr.get('/api/evidence?from=2026-2-1')).status, 400);
  const mine = (await emp1.get(`/api/evidence?employeeId=${id + 1}`)).body.evidence;
  assert.ok(mine.length >= 1 && mine.every(e => e.employeeId === id));
});

test('złożenie oceny okresowej wymaga dowodu albo „brak podstaw do oceny” przy każdym ocenianym wskaźniku', async () => {
  const draft = (await mgr.get('/api/evals')).body.evals.find(e => e.status === 'draft' && e.typ !== 'pierwsza');
  assert.ok(draft, 'brak szkicu w danych demo');
  const r1 = await mgr.post(`/api/evals/${draft.id}/submit`);
  assert.equal(r1.status, 422);
  const noEv = r1.body.missing.filter(m => /bez informacji/.test(m));
  assert.equal(noEv.length, 2, JSON.stringify(r1.body.missing));
  // Jeden wskaźnik: jawna adnotacja „brak podstaw”, drugi: nowy dowód z okresu oceny
  const ratings = draft.data.ratings;
  const counts = {};
  for (const e of (await mgr.get(`/api/evidence?employeeId=${draft.employee_id}&from=${draft.period_from}&to=${draft.period_to}`)).body.evidence) counts[e.indicator] = 1;
  const lacking = Object.keys(ratings).filter(k => !counts[k]);
  assert.equal(lacking.length, 2);
  ratings[lacking[0]] = { lvl: 'none', ex: '' };
  assert.equal((await mgr.put(`/api/evals/${draft.id}`, { data: draft.data })).status, 200);
  assert.equal((await mgr.post('/api/evidence', { ...validEvidence(draft.employee_id), indicator: lacking[1], date: '2026-03-03' })).status, 201);
  // Dowód spoza okresu oceny się nie liczy – tu jest w okresie, więc ocena przechodzi
  const r2 = await mgr.post(`/api/evals/${draft.id}/submit`);
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const ev = (await mgr.get(`/api/evals/${draft.id}`)).body.eval;
  assert.equal(ev.data.wynikSource, 'wyliczony');
  assert.ok(['pozytywna', 'negatywna'].includes(ev.data.wynik));
  // Zmiana oceny przed złożeniem trafiła do dziennika (poprzednia i nowa wartość wskaźnika)
  const upd = (await mgr.get('/api/audit')).body.audit.find(a => a.action === 'update_eval' && a.target === String(draft.id));
  assert.ok(upd && JSON.parse(upd.new_value)[`ratings.${lacking[0]}`].lvl === 'none');
});

