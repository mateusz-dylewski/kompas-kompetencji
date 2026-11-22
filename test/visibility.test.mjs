// Etap 2 modułu przełożonego: przełożony widzi tylko swoich podopiecznych.
// Drugi przełożony (z własnym zespołem) nie może odczytać ani zmienić danych zespołu pierwszego – na żadnej trasie.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, asManager, asEmployee, todayStr } from './helpers.mjs';

const PASS2 = 'Drugi-przelozony-2026';
const hash = pw => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
let srv, mgr1, mgr2, emp2, own;   // own: identyfikatory obiektów zespołu 1
const NOT_SEEN = [403, 404];

before(async () => {
  srv = await startServer();
  mgr1 = await asManager(srv);
  // Drugi przełożony z jednym pracownikiem (dane fikcyjne)
  const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
  const m2 = Number(db.prepare("INSERT INTO users(email,name,role,position,unit,pass) VALUES('przelozony2@demo.kk','Przełożony Drugi','przelozony','Naczelnik','Wydział B',?)").run(hash(PASS2)).lastInsertRowid);
  db.prepare("INSERT INTO users(email,name,role,position,unit,manager_id,pass) VALUES('pracownik.b@demo.kk','Pracownik Wydziału','pracownik','Specjalista','Wydział B',?,?)").run(m2, hash(PASS2));
  db.close();
  mgr2 = await srv.client().login('przelozony2@demo.kk', PASS2);
  emp2 = await srv.client().login('pracownik.b@demo.kk', PASS2);
  // Obiekty zespołu 1 (tworzone przez przełożonego 1)
  const d1 = (await mgr1.get('/api/dashboard')).body;
  const evals = (await mgr1.get('/api/evals')).body.evals;
  const empId = d1.team[0].id;
  const kick = (await mgr1.post('/api/kickoffs', { employeeId: empId, typ: 'C', date: todayStr(), extraCriteria: [], duties: 'Obowiązki testowe zespołu 1.', expectations: 'Oczekiwania testowe zespołu 1.', goals: 'Cele testowe zespołu 1 na okres.' })).body.kickoff;
  own = {
    empId,
    evalDraft: evals.find(e => e.status === 'draft').id,
    evalDone: evals.find(e => e.status !== 'draft').id,
    evidence: (await mgr1.get('/api/evidence')).body.evidence[0].id,
    checkin: (await mgr1.get('/api/checkins')).body.checkins[0].id,
    feedback: (await mgr1.get('/api/feedback')).body.feedback[0].id,
    partial: (await mgr1.get('/api/partials')).body.partials[0].id,
    kickoff: kick.id,
    goal: (await (await asEmployee(srv, 1)).get('/api/goals')).body.goals[0].id,
  };
});
after(() => srv.stop());

test('listy drugiego przełożonego nie zawierają rekordów zespołu 1', async () => {
  const d = (await mgr2.get('/api/dashboard')).body;
  assert.deepEqual(d.team.map(t => t.name), ['Pracownik Wydziału']);
  for (const [url, key] of [['/api/evals', 'evals'], ['/api/evidence', 'evidence'], ['/api/checkins', 'checkins'], ['/api/feedback', 'feedback'],
    ['/api/partials', 'partials'], ['/api/kickoffs', 'kickoffs'], ['/api/goals', 'goals']]) {
    const r = await mgr2.get(url);
    assert.equal(r.status, 200, url);
    assert.deepEqual(r.body[key], [], `${url} pokazuje cudze rekordy`);
    const f = await mgr2.get(`${url}?employeeId=${own.empId}`);
    assert.ok(f.status !== 200 || f.body[key].length === 0, `${url}?employeeId= pokazuje cudze rekordy`);
  }
  const a = (await mgr2.get('/api/audit')).body;
  assert.ok(a.audit.every(x => !String(x.target).includes(`:${own.evidence}`) || x.action === 'login'), 'dziennik tylko własnych działań');
});

test('trasy z identyfikatorem obiektu zespołu 1 → 403/404', async () => {
  const e = own.evalDone, dft = own.evalDraft;
  const calls = [
    ['GET', `/api/evals/${e}`], ['GET', `/api/evals/${e}/document`], ['GET', `/api/evals/${dft}/document?variant=szkic`], ['GET', `/api/evals/${e}/signatures`],
    ['PUT', `/api/evals/${dft}`, { data: {} }], ['POST', `/api/evals/${dft}/submit`], ['POST', `/api/evals/${e}/discuss`, { dev: 'x' }],
    ['POST', `/api/evals/${e}/sign`], ['POST', `/api/evals/${dft}/early-exception`, { reason: 'uzasadnienie testowe' }],
    ['POST', `/api/evals/${e}/objection-decision`, { result: 'nieuwzglednione' }], ['POST', `/api/evals/${e}/survey`, { rating: 3 }],
    ['PUT', `/api/evidence/${own.evidence}`, { situation: 'zmiana przez obcego' }], ['PUT', `/api/checkins/${own.checkin}`, { done: 'zmiana przez obcego' }],
    ['PUT', `/api/feedback/${own.feedback}`, { justification: 'zmiana przez obcego przełożonego' }], ['PUT', `/api/partials/${own.partial}`, { justification: 'zmiana przez obcego przełożonego' }],
    ['PUT', `/api/kickoffs/${own.kickoff}`, { goals: 'zmiana przez obcego przełożonego' }], ['PATCH', `/api/goals/${own.goal}`, { step: 0, done: true }],
    ['POST', `/api/employees/${own.empId}/activation`],
    ['POST', '/api/ai/talk', { evalId: e }], ['POST', '/api/ai/formal', { evalId: e }],
  ];
  for (const [m, url, body] of calls) {
    const r = await mgr2.req(m, url, m === 'GET' ? undefined : (body || {}));
    assert.ok(NOT_SEEN.includes(r.status), `${m} ${url} → ${r.status}`);
  }
});

test('tworzenie i odczyt dla pracownika zespołu 1 → 404', async () => {
  const id = own.empId, ind = Object.keys((await mgr1.get(`/api/evals/${own.evalDraft}`)).body.eval.data.ratings)[0] || 'KOMUNIKACJA|0';
  const calls = [
    ['POST', '/api/evals', { employeeId: id, typ: 'C' }],
    ['POST', '/api/evidence', { employeeId: id, date: todayStr(), indicator: ind, situation: 'abc', action: 'abc', result: 'abc' }],
    ['POST', '/api/checkins', { employeeId: id, month: todayStr().slice(0, 7) }],
    ['POST', '/api/feedback', { employeeId: id, indicator: ind, source: 'test', justification: 'uzasadnienie testowe', relation: 'przelozony', date: todayStr() }],
    ['POST', '/api/partials', { employeeId: id, quarter: '2026-Q1', competency: 'KOMUNIKACJA', pts: 5, justification: 'uzasadnienie testowe', evidenceIds: [own.evidence] }],
    ['POST', '/api/kickoffs', { employeeId: id, typ: 'C', date: todayStr(), extraCriteria: [], duties: 'x'.repeat(12), expectations: 'x'.repeat(12), goals: 'x'.repeat(12) }],
    ['GET', `/api/summary?employeeId=${id}`], ['GET', `/api/month?employeeId=${id}`], ['GET', `/api/devplan?employeeId=${id}`], ['GET', `/api/goals/trend?employeeId=${id}`], ['GET', `/api/evals/compare?employeeId=${id}`],
    ['PUT', '/api/devplan', { employeeId: id, plan: 'Plan od obcego przełożonego.' }],
    ['POST', '/api/goals', { employeeId: id, s: 'a', m: 'b', a: 'c', r: 'd', t: '2027-06-30', steps: ['krok'] }],
    ['POST', '/api/ai/checkin', { employeeId: id }], ['POST', '/api/ai/brief', { employeeId: id }],
  ];
  for (const [m, url, body] of calls) {
    const r = await mgr2.req(m, url, m === 'GET' ? undefined : body);
    assert.ok(NOT_SEEN.includes(r.status), `${m} ${url} → ${r.status}`);
  }
});

test('pracownik innego zespołu nie widzi obiektów zespołu 1', async () => {
  for (const [m, url] of [['GET', `/api/evals/${own.evalDone}`], ['POST', `/api/evals/${own.evalDone}/acknowledge`], ['POST', `/api/kickoffs/${own.kickoff}/acknowledge`],
    ['PATCH', `/api/goals/${own.goal}`]]) {
    const r = await emp2.req(m, url, m === 'GET' ? undefined : { step: 0, done: true });
    assert.ok(NOT_SEEN.includes(r.status), `${m} ${url} → ${r.status}`);
  }
  for (const [url, key] of [['/api/evidence', 'evidence'], ['/api/checkins', 'checkins'], ['/api/feedback', 'feedback'], ['/api/partials', 'partials'], ['/api/evals', 'evals']]) {
    assert.deepEqual((await emp2.get(url)).body[key], [], url);
  }
});
