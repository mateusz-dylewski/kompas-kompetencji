// Proces oceny: ponowna ocena 6 miesięcy po negatywnej, rozmowa rozpoczynająca (30 dni, zapoznanie = część I),
// zbiorcze metryki wsparcia przełożonego (od K_MIN przełożonych, bez danych o osobach), anonimowa ankieta przygotowania.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, asManager, asEmployee, todayStr } from './helpers.mjs';
import { nextDueAfter, timingCheck, kickoffDue, addDays, REEVAL_MONTHS, KICKOFF_DAYS } from '../lib/cycle.mjs';

const ev = (id, typ, status, period_to, data = {}) => ({ id, typ, status, period_to, data, updated: '2026-07-01T10:00:00Z' });

describe('terminy (lib/cycle.mjs)', () => {
  test('po ocenie negatywnej ponowna ocena po 6 miesiącach, po pozytywnej po 24', () => {
    assert.equal(REEVAL_MONTHS, 6);
    assert.deepEqual(nextDueAfter(ev(1, 'B', 'submitted', '2026-06-30', { wynik: 'negatywna' })), { nextDue: '2026-12-30', dueReason: 'ponowna_po_negatywnej' });
    assert.deepEqual(nextDueAfter(ev(1, 'B', 'submitted', '2026-06-30', { wynik: 'pozytywna' })), { nextDue: '2028-06-30', dueReason: 'cykl_24' });
    assert.deepEqual(nextDueAfter(null), { nextDue: null, dueReason: null });
    const t = timingCheck([ev(1, 'C', 'discussed', '2026-06-30', { wynik: 'negatywna' })], '2026-12-30');
    assert.equal(t.ok, true);
    assert.equal(t.nextDue, '2026-12-30');
  });
  test('rozmowa rozpoczynająca: 30 dni od poprzedniej oceny', () => {
    assert.equal(KICKOFF_DAYS, 30);
    assert.equal(kickoffDue(ev(1, 'B', 'submitted', '2026-06-30')), '2026-07-30');
    assert.equal(kickoffDue(null), null);
    assert.equal(addDays('2026-12-15', 30), '2027-01-14');
  });
});

describe('rozmowa rozpoczynająca (API)', () => {
  let srv, mgr, emp, empId, otherId, kick;
  const body = extra => ({ employeeId: empId, typ: 'C', date: todayStr(), extraCriteria: extra,
    duties: 'Obsługa wniosków i przygotowanie analiz.', expectations: 'Terminowe i rzetelne przygotowanie analiz.', goals: 'Skrócenie czasu obsługi wniosków o 10%.' });
  before(async () => {
    srv = await startServer(); mgr = await asManager(srv);
    // Pracownik bez ocen okresowych – nowy okres zaczyna się od rozmowy rozpoczynającej
    const team = (await mgr.get('/api/dashboard')).body.team;
    const evals = (await mgr.get('/api/evals')).body.evals;
    const free = team.find(t => !evals.some(e => e.employee_id === t.id && e.typ !== 'pierwsza'));
    empId = free.id;
    otherId = team.find(t => t.id !== empId).id;
    emp = await srv.client().login(emailOf(srv, empId));
  });
  after(() => srv.stop());

  test('walidacja: arkusz B/C, maks. 3 kryteria dodatkowe, bez obowiązkowych, pola min. 10 znaków', async () => {
    const r = await mgr.post('/api/kickoffs', { ...body(['KREATYWNOŚĆ', 'NEGOCJOWANIE', 'WYSTĄPIENIA PUBLICZNE', 'MYŚLENIE ANALITYCZNE']), typ: 'A', duties: 'krótko' });
    assert.equal(r.status, 400);
    assert.ok(r.body.fields.typ && r.body.fields.duties);
    assert.match((await mgr.post('/api/kickoffs', body(['KREATYWNOŚĆ', 'NEGOCJOWANIE', 'WYSTĄPIENIA PUBLICZNE', 'MYŚLENIE ANALITYCZNE']))).body.fields.extraCriteria, /Najwyżej 3/);
    assert.match((await mgr.post('/api/kickoffs', body(['RZETELNOŚĆ']))).body.fields.extraCriteria, /obowiązkowe/);
    assert.equal((await emp.post('/api/kickoffs', body([]))).status, 403);
  });
  test('zapis, zapoznanie pracownika (część I), blokada zmian po zapoznaniu, dziennik', async () => {
    const r = await mgr.post('/api/kickoffs', body(['KREATYWNOŚĆ', 'NEGOCJOWANIE']));
    assert.equal(r.status, 201, r.text);
    kick = r.body.kickoff;
    assert.equal(kick.criteria.filter(c => c.mandatory).length, 5);
    assert.deepEqual(kick.extraCriteria, ['KREATYWNOŚĆ', 'NEGOCJOWANIE']);
    const alerts = (await mgr.get('/api/dashboard')).body.alerts;
    assert.ok(alerts.some(a => a.kind === 'kickoff_ack' && a.employeeId === empId));
    // Pracownik widzi ustalenia na pulpicie i potwierdza zapoznanie
    const d = (await emp.get('/api/dashboard')).body;
    assert.equal(d.kickoff.id, kick.id);
    assert.equal(d.kickoff.ackAt, null);
    assert.equal((await (await srv.client().login(emailOf(srv, otherId))).post(`/api/kickoffs/${kick.id}/acknowledge`)).status, 404, 'cudza rozmowa');
    assert.equal((await emp.post(`/api/kickoffs/${kick.id}/acknowledge`)).status, 201);
    assert.equal((await emp.post(`/api/kickoffs/${kick.id}/acknowledge`)).status, 409);
    assert.equal((await mgr.put(`/api/kickoffs/${kick.id}`, { goals: 'Inny cel na ten okres oceny.' })).status, 409);
    const log = (await mgr.get('/api/audit')).body.audit;
    assert.ok(log.some(a => a.action === 'create_kickoff' && a.target === `kickoff:${kick.id}`));
  });
  test('nowa ocena przejmuje kryteria dodatkowe i początek okresu (dzień zapoznania)', async () => {
    const r = await mgr.post('/api/evals', { employeeId: empId, typ: 'C', periodTo: addDays(todayStr(), 700) });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.kickoffId, kick.id);
    const e = (await mgr.get(`/api/evals/${r.body.id}`)).body.eval;
    assert.equal(e.period_from, todayStr());
    assert.ok(e.data.criteria.includes('KREATYWNOŚĆ') && e.data.criteria.includes('NEGOCJOWANIE'));
    assert.equal(e.data.kickoff.id, kick.id);
    // Zapis szkicu przez klienta nie usuwa ustaleń z rozmowy
    assert.equal((await mgr.put(`/api/evals/${r.body.id}`, { data: { ...e.data, kickoff: null } })).status, 200);
    assert.equal((await mgr.get(`/api/evals/${r.body.id}`)).body.eval.data.kickoff.id, kick.id);
    assert.equal((await mgr.get('/api/kickoffs')).body.kickoffs.find(k => k.id === kick.id).evalId, r.body.id);
  });
});

// E-mail pracownika po id (z bazy testowej)
function emailOf(srv, id) {
  const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
  const e = db.prepare('SELECT email FROM users WHERE id=?').get(id).email;
  db.close();
  return e;
}

describe('ponowna ocena po negatywnej na pulpicie', () => {
  test('termin 6 miesięcy i opis w terminach zespołu', async () => {
    const srv = await startServer();
    try {
      const mgr = await asManager(srv);
      const evs = (await mgr.get('/api/evals')).body.evals;
      // Osoba bez rozmowy rozpoczynającej (dane demo mają część rozmów już zapisanych)
      const team = (await mgr.get('/api/dashboard')).body.team;
      const e = evs.find(x => x.typ !== 'pierwsza' && x.status !== 'draft' && !team.find(t => t.id === x.employee_id)?.kickoff);
      const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
      const data = { ...e.data, wynik: 'negatywna', terminOceny: '2026-06-30' };
      db.prepare('UPDATE evals SET data=? WHERE id=?').run(JSON.stringify(data), e.id);
      db.close();
      const d = (await mgr.get('/api/dashboard')).body;
      const row = d.deadlines.find(x => x.id === e.employee_id);
      assert.equal(row.due, '2026-12-30');
      assert.equal(row.dueReason, 'ponowna_po_negatywnej');
      assert.match(row.text, /po ocenie negatywnej|Termin minął/);
      assert.ok(d.alerts.some(a => a.kind === 'kickoff' && a.employeeId === e.employee_id), 'brak rozmowy rozpoczynającej po ocenie');
    } finally { await srv.stop(); }
  });
});

describe('metryki wsparcia: tylko zbiorczo, od K_MIN przełożonych', () => {
  let srv, mgr;
  before(async () => { srv = await startServer(); mgr = await asManager(srv); });
  after(() => srv.stop());
  test('jeden przełożony → ukryte; pracownik → 403', async () => {
    const m = (await mgr.get('/api/metrics')).body;
    assert.equal(m.suppressed, true);
    assert.equal(m.kMin, 5);
    assert.equal(m.coverage, undefined);
    assert.equal((await (await asEmployee(srv, 1)).get('/api/metrics')).status, 403);
  });
  test('ankieta: raz na ocenę, bez osoby i bez oceny w zapisie', async () => {
    const e = (await mgr.get('/api/evals')).body.evals.find(x => x.status !== 'draft');
    const d = (await mgr.get('/api/evals')).body.evals.find(x => x.status === 'draft');
    assert.equal((await mgr.post(`/api/evals/${d.id}/survey`, { rating: 4 })).status, 409);
    assert.equal((await mgr.post(`/api/evals/${e.id}/survey`, { rating: 7 })).status, 400);
    assert.equal((await mgr.post(`/api/evals/${e.id}/survey`, { rating: 4 })).status, 201);
    assert.equal((await mgr.post(`/api/evals/${e.id}/survey`, { rating: 5 })).status, 409);
    const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
    assert.deepEqual(db.prepare('PRAGMA table_info(prep_survey)').all().map(c => c.name), ['id', 'rating', 'month']);
    db.close();
  });
  test('5 przełożonych → mediany i odsetki, bez kluczy z osobami', async () => {
    const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
    // Fikcyjni przełożeni z jedną złożoną oceną każdy (tylko na potrzeby testu agregacji)
    const emp = db.prepare("SELECT id FROM users WHERE role='pracownik' LIMIT 1").get().id;
    const ins = db.prepare("INSERT INTO users(email,name,role,pass) VALUES(?,?,'przelozony','')");
    for (const i of [1, 2, 3, 4]) {
      const mid = Number(ins.run(`p${i}@test.kk`, `Przełożony ${i}`).lastInsertRowid);
      db.prepare("INSERT INTO evals(employee_id,evaluator_id,typ,period_from,period_to,status,data,created,updated) VALUES(?,?,'C','2024-01-01','2025-12-31','submitted','{}',?,?)")
        .run(emp, mid, '2025-12-01T00:00:00Z', '2025-12-20T00:00:00Z');
    }
    for (const r of [3, 4, 4, 5]) db.prepare('INSERT INTO prep_survey(rating,month) VALUES(?,?)').run(r, '2026-11');
    db.close();
    const m = (await mgr.get('/api/metrics')).body;
    assert.equal(m.suppressed, false, JSON.stringify(m));
    assert.ok(m.managers >= 5);
    assert.ok(m.coverage.medianPct >= 0 && m.coverage.medianPct <= 100);
    assert.equal(m.prep.n, 5);
    assert.equal(m.prep.median, 4);
    const keys = JSON.stringify(m);
    assert.ok(!/employee|evaluator|name|email|user/i.test(keys), 'brak danych o osobach');
  });
});
