// Faza 3: check-iny, przegląd miesiąca, feedback, oceny cząstkowe kwartalne
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, asManager, asEmployee, todayStr, monthStr } from './helpers.mjs';

let srv, mgr, emp1, emp2, id1, id2;
before(async () => {
  srv = await startServer();
  mgr = await asManager(srv); emp1 = await asEmployee(srv, 1); emp2 = await asEmployee(srv, 2);
  id1 = (await emp1.get('/api/me')).body.user.id; id2 = (await emp2.get('/api/me')).body.user.id;
});
after(() => srv.stop());
const lastAudit = async (action, target) => (await mgr.get('/api/audit')).body.audit.find(a => a.action === action && a.target === target);
const quarterNow = () => { const d = todayStr(); return `${d.slice(0, 4)}-Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`; };

describe('check-iny', () => {
  test('3 pola bez punktacji; duplikat miesiąca → 409; zmiany w dzienniku', async () => {
    const month = '2026-01';
    const r = await mgr.post('/api/checkins', { employeeId: id2, month, done: 'Zamknięto 3 sprawy', attention: 'Terminy zależne', goal: 'Lista kontrolna', date: '2026-01-28', status: 'odbyty' });
    assert.equal(r.status, 201, r.text);
    assert.equal((await mgr.post('/api/checkins', { employeeId: id2, month })).status, 409);
    const up = await mgr.put(`/api/checkins/${r.body.checkin.id}`, { goal: 'Jedna lista kontrolna do raportu' });
    assert.equal(up.status, 200);
    const a = await lastAudit('update_checkin', `checkin:${r.body.checkin.id}`);
    assert.deepEqual(JSON.parse(a.prev_value), { goal: 'Lista kontrolna' });
    assert.deepEqual(JSON.parse(a.new_value), { goal: 'Jedna lista kontrolna do raportu' });
  });
  test('punktacja w check-inie jest odrzucana', async () => {
    const r = await mgr.post('/api/checkins', { employeeId: id2, month: '2026-02', done: 'x', level: 5, ocena: 7 });
    assert.equal(r.status, 400);
    assert.match(r.body.fields.level, /punktacji/);
    assert.ok(r.body.fields.ocena);
  });
  test('odbyty check-in wymaga daty i trzech pól; miesiąc nie z przyszłości', async () => {
    assert.equal((await mgr.post('/api/checkins', { employeeId: id2, month: '2026-03', status: 'odbyty', done: 'x' })).status, 400);
    assert.equal((await mgr.post('/api/checkins', { employeeId: id2, month: '2999-01' })).status, 400);
    assert.equal((await mgr.post('/api/checkins', { employeeId: id2, month: '2026-03' })).status, 201); // planowany: pola mogą być puste
  });
  test('pracownik widzi swoje check-iny, nie może ich zapisywać', async () => {
    const mine = (await emp2.get('/api/checkins')).body.checkins;
    assert.ok(mine.length >= 2 && mine.every(c => c.employeeId === id2));
    assert.equal((await emp2.post('/api/checkins', { employeeId: id2, month: '2026-04' })).status, 403);
  });
});

describe('przegląd miesiąca', () => {
  test('dowody według wskaźników; wskaźniki bez dowodów w miesiącu są pominięte', async () => {
    const m = monthStr();
    const r = await mgr.get(`/api/month?employeeId=${id1}&month=${m}`);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.groups.length > 0, 'dane demo mają dowody w bieżącym miesiącu');
    assert.ok(r.body.groups.every(g => g.evidence.length > 0 && g.evidence.every(e => e.date.startsWith(m) && e.indicator === g.indicator)));
    const all = (await mgr.get('/api/model')).body.model.reduce((n, c) => n + c.w.length, 0);
    assert.ok(r.body.groups.length < all);
    assert.equal(r.body.groups.reduce((n, g) => n + g.evidence.length, 0), r.body.evidenceCount);
    assert.ok(!('avg' in r.body) && !('score' in r.body), 'brak punktacji w przeglądzie');
    const empty = await mgr.get(`/api/month?employeeId=${id1}&month=2020-01`);
    assert.deepEqual(empty.body.groups, []);
    assert.equal((await emp1.get(`/api/month?employeeId=${id1}`)).status, 403);
  });
});

describe('feedback', () => {
  const base = () => ({ employeeId: id1, indicator: 'RZETELNOŚĆ|1', source: 'ZAD-77: sprawozdanie', justification: 'Sprawozdanie przekazane w terminie, bez korekt.', relation: 'odbiorca', date: todayStr() });
  test('uzasadnienie wymagane', async () => {
    const r = await mgr.post('/api/feedback', { ...base(), justification: '' });
    assert.equal(r.status, 400);
    assert.ok(r.body.fields.justification);
  });
  test('zakaz pól o czasie pracy, obecności i aktywności', async () => {
    for (const k of ['czasPracy', 'obecnosc', 'aktywnosc', 'hours', 'attendance', 'lastActivity']) {
      const r = await mgr.post('/api/feedback', { ...base(), [k]: 1 });
      assert.equal(r.status, 400, k);
      assert.match(r.body.fields[k], /rezultatu zadania/, k);
    }
  });
  test('poziom opcjonalny w skali 1/3/5/7/9', async () => {
    assert.equal((await mgr.post('/api/feedback', { ...base(), level: 4 })).status, 400);
    const r = await mgr.post('/api/feedback', { ...base(), level: 7 });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.feedback.level, 7);
    const r2 = await mgr.post('/api/feedback', base());
    assert.equal(r2.body.feedback.level, null);
  });
  test('pracownik widzi swój feedback (i tylko swój); edycja w dzienniku', async () => {
    const r = await mgr.post('/api/feedback', base());
    const mine = (await emp1.get('/api/feedback')).body.feedback;
    assert.ok(mine.some(f => f.id === r.body.feedback.id));
    assert.ok(mine.every(f => f.employeeId === id1));
    assert.ok(!(await emp2.get('/api/feedback')).body.feedback.some(f => f.id === r.body.feedback.id));
    assert.equal((await emp1.post('/api/feedback', base())).status, 403);
    const up = await mgr.put(`/api/feedback/${r.body.feedback.id}`, { level: 5 });
    assert.equal(up.status, 200);
    const a = await lastAudit('update_feedback', `feedback:${r.body.feedback.id}`);
    assert.deepEqual(JSON.parse(a.prev_value), { level: null });
    assert.deepEqual(JSON.parse(a.new_value), { level: 5 });
    assert.equal((await mgr.put(`/api/feedback/${r.body.feedback.id}`, { obecnosc: 'tak' })).status, 400);
  });
});

describe('oceny cząstkowe kwartalne', () => {
  let evId, otherCompEv;
  before(async () => {
    evId = (await mgr.post('/api/evidence', { employeeId: id2, date: todayStr(), indicator: 'ORGANIZACJA PRACY|0', situation: 'Plan prac', action: 'Ustalono kolejność', result: 'Plan przyjęty' })).body.evidence.id;
    otherCompEv = (await mgr.post('/api/evidence', { employeeId: id2, date: todayStr(), indicator: 'KOMUNIKACJA|0', situation: 'Spotkanie', action: 'Protokół', result: 'Bez pytań' })).body.evidence.id;
  });
  const p = () => ({ employeeId: id2, quarter: quarterNow(), competency: 'ORGANIZACJA PRACY', pts: 5, justification: 'Plan prac przyjęty bez zmian; terminy dotrzymane.', evidenceIds: [evId] });
  test('przypisana do kwartału, nie do miesiąca', async () => {
    const r = await mgr.post('/api/partials', { ...p(), month: monthStr() });
    assert.equal(r.status, 400);
    assert.match(r.body.fields.month, /kwartał/);
    assert.equal((await mgr.post('/api/partials', { ...p(), quarter: monthStr() })).status, 400);
    assert.equal((await mgr.post('/api/partials', { ...p(), quarter: '2999-Q1' })).status, 400);
  });
  test('skala 1/3/5/7/9, wymagane uzasadnienie i dowody tej osoby z tego kryterium', async () => {
    const bad = await mgr.post('/api/partials', { ...p(), pts: 6, justification: '', evidenceIds: [] });
    assert.equal(bad.status, 400);
    for (const f of ['pts', 'justification', 'evidenceIds']) assert.ok(bad.body.fields[f], f);
    assert.equal((await mgr.post('/api/partials', { ...p(), evidenceIds: [otherCompEv] })).status, 400);
    assert.equal((await emp2.post('/api/partials', p())).status, 403);
  });
  test('zapis, duplikat → 409, zmiana w dzienniku, pracownik widzi swoje', async () => {
    const r = await mgr.post('/api/partials', p());
    assert.equal(r.status, 201, r.text);
    assert.equal((await mgr.post('/api/partials', p())).status, 409);
    const up = await mgr.put(`/api/partials/${r.body.partial.id}`, { pts: 7, justification: 'Plan przyjęty; dodatkowo uporządkowano rejestr zadań.' });
    assert.equal(up.status, 200, up.text);
    const a = await lastAudit('update_partial', `partial:${r.body.partial.id}`);
    assert.equal(JSON.parse(a.prev_value).pts, 5);
    assert.equal(JSON.parse(a.new_value).pts, 7);
    assert.equal((await mgr.put(`/api/partials/${r.body.partial.id}`, { quarter: '2026-Q1' })).status, 400);
    const mine = (await emp2.get('/api/partials')).body.partials;
    assert.ok(mine.some(x => x.id === r.body.partial.id) && mine.every(x => x.employeeId === id2));
  });
});
