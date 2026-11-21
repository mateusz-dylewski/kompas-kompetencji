// Faza 4: zestawienia bez średniej i bez sugestii wyniku, K_MIN dla zespołu, AI niczego nie zapisuje i nie dostaje nazwisk
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, asManager, asEmployee, todayStr } from './helpers.mjs';

// Atrapa Ollama: zapisuje prompty, odpowiada stałym tekstem
const prompts = [];
let mock, srv, mgr, emp1;
before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:14b' }] }));
      prompts.push(JSON.parse(b));
      res.end(JSON.stringify({ message: { content: 'Propozycja pytań (atrapa modelu).' } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(ok => mock.once('listening', ok));
  srv = await startServer({ KK_AI_URL: `http://127.0.0.1:${mock.address().port}` });
  mgr = await asManager(srv); emp1 = await asEmployee(srv, 1);
});
after(async () => { await srv.stop(); mock.close(); });

// Rekurencyjnie: nazwy kluczy w odpowiedzi
const keysDeep = (o, out = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); keysDeep(v, out); } return out; };

describe('zestawienie dla przełożonego', () => {
  test('liczba dowodów i check-inów na wskaźnik, daty, rozkład poziomów – bez średniej i bez wyniku', async () => {
    const id1 = (await emp1.get('/api/me')).body.user.id;
    const r = await mgr.get(`/api/summary?employeeId=${id1}`);
    assert.equal(r.status, 200, r.text);
    const s = r.body;
    assert.ok(s.indicators.length > 0);
    for (const i of s.indicators) {
      assert.ok(i.evidenceCount + i.feedbackCount > 0);
      if (i.evidenceCount) assert.ok(i.firstDate <= i.lastDate);
      assert.ok(i.checkinsWithEvidence <= i.evidenceMonths.length);
      assert.deepEqual(Object.keys(i.feedbackLevels), ['1', '3', '5', '7', '9']);
    }
    assert.ok(s.checkins.total >= 2);
    for (const c of s.competencies) assert.equal(Object.values(c.distribution).reduce((a, b) => a + b, 0), c.partials.length);
    const banned = keysDeep(s).filter(k => /avg|mean|sredn|średn|predict|sugg|wynik|score|forecast/i.test(k));
    assert.deepEqual(banned, [], 'zestawienie nie zawiera średnich ani sugestii wyniku');
  });
  test('uprawnienia i walidacja okresu', async () => {
    const id1 = (await emp1.get('/api/me')).body.user.id;
    assert.equal((await emp1.get(`/api/summary?employeeId=${id1}`)).status, 403);
    assert.equal((await mgr.get(`/api/summary?employeeId=${id1}&from=2026-05-01&to=2026-01-01`)).status, 400);
    assert.equal((await mgr.get('/api/summary?employeeId=999')).status, 404);
  });
});

describe('agregaty zespołu od K_MIN', () => {
  test('5 złożonych ocen → widoczne; 4 → ukryte', async () => {
    const a = (await mgr.get('/api/dashboard')).body.aggregate;
    assert.equal(a.kMin, 5);
    assert.equal(a.n, 5);
    assert.equal(a.suppressed, false);
    const db = new DatabaseSync(path.join(srv.dir, 'kompas.db'));
    const id = db.prepare("SELECT id FROM evals WHERE status='submitted' ORDER BY id LIMIT 1").get().id;
    db.prepare("UPDATE evals SET status='draft' WHERE id=?").run(id);
    const b = (await mgr.get('/api/dashboard')).body.aggregate;
    assert.equal(b.n, 4);
    assert.equal(b.suppressed, true);
    assert.equal(b.competencies, undefined);
    db.prepare("UPDATE evals SET status='submitted' WHERE id=?").run(id);
    db.close();
  });
});

describe('asystent AI', () => {
  const snapshot = async () => {
    const team = (await mgr.get('/api/dashboard')).body.team;
    return JSON.stringify({
      evals: (await mgr.get('/api/evals')).body.evals.map(e => ({ id: e.id, status: e.status, data: e.data })),
      evidence: (await mgr.get('/api/evidence')).body.evidence,
      partials: (await mgr.get('/api/partials')).body.partials,
      checkins: (await mgr.get('/api/checkins')).body.checkins,
      feedback: (await mgr.get('/api/feedback')).body.feedback,
      team,
    });
  };
  test('przeformułowanie i pytania do rozmowy nie zmieniają i nie zapisują ocen', async () => {
    const before = await snapshot();
    const evals = (await mgr.get('/api/evals')).body.evals;
    const id1 = (await emp1.get('/api/me')).body.user.id;
    for (const e of evals.slice(0, 3)) {
      assert.equal((await mgr.post('/api/ai/talk', { evalId: e.id })).body.source, 'ai');
      assert.equal((await mgr.post('/api/ai/formal', { evalId: e.id })).body.source, 'ai');
    }
    const ck = await mgr.post('/api/ai/checkin', { employeeId: id1 });
    assert.equal(ck.status, 200);
    assert.equal(ck.body.source, 'ai');
    assert.equal((await emp1.post('/api/ai/development')).status, 200);
    assert.equal(await snapshot(), before);
    assert.equal((await emp1.post('/api/ai/checkin', { employeeId: id1 })).status, 403);
  });
  test('prompt nie zawiera imion ani nazwisk – także wpisanych w uzasadnienie (z odmianą)', async () => {
    const draft = (await mgr.get('/api/evals')).body.evals.find(e => e.status === 'draft');
    const emp = (await mgr.get('/api/dashboard')).body.team.find(t => t.id === draft.employee_id);
    const [first, last] = emp.name.split(' ');
    const key = Object.keys(draft.data.ratings)[0];
    draft.data.ratings[key].ex = `Rozmowa: ${emp.name} przygotował(a) raport; uwagi od ${first.slice(0, -1)}y i ${last}a. Kontakt: pracownik6@demo.kk`;
    assert.equal((await mgr.put(`/api/evals/${draft.id}`, { data: draft.data })).status, 200);
    prompts.length = 0;
    await mgr.post('/api/ai/talk', { evalId: draft.id });
    await mgr.post('/api/ai/formal', { evalId: draft.id });
    await mgr.post('/api/ai/checkin', { employeeId: draft.employee_id, month: todayStr().slice(0, 7) });
    assert.equal(prompts.length, 3);
    const all = JSON.stringify(prompts);
    assert.ok(all.includes('[osoba]'), 'nazwisko zastąpione znacznikiem');
    for (const t of [first, last, first.slice(0, -1), 'pracownik6@demo.kk', 'Mazur']) assert.ok(!all.includes(t), `prompt zawiera: ${t}`);
  });
  test('każda podpowiedź AI jest zapisana w ai_log', async () => {
    const r = (await mgr.get('/api/audit')).body;
    assert.ok(r.ai.some(x => x.action === 'checkin'));
    assert.ok(r.ai.every(x => ['ai', 'rules'].includes(x.source)));
  });
});
